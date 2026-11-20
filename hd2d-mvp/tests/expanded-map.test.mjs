import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { aiDomestic, aiTurn } from '../src/core/ai.js';
import { Field } from '../src/core/field.js';
import { setupWar, resolveWar, autoBattle } from '../src/core/warcore.js';
import { chooseRaid, resolveAiRaid } from '../src/core/raids.js';
import { suspend, peekSuspend, takeSuspend } from '../src/core/suspend.js';
import { applyScenario } from '../src/core/scenario.js';
import { loadScenario } from '../src/core/scenario-store.js';
import { SOVEREIGN_SCENARIO_ID } from '../src/core/visuals.js';
import { EXPANDED_MAP_ID, EXPANDED_NODES, CROSSING_ROADS, expandMap, expandedFlatBoard, expandedSandMeta } from '../src/core/expanded-map.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const base = read('../data/game-data.json'), scenario = await loadScenario(SOVEREIGN_SCENARIO_ID, base);
const standard = applyScenario(base, scenario);
const use = () => G.setData(expandMap(standard), EXPANDED_MAP_ID);
const game = (seed = 1) => { use(); return G.newGame(4, 1, seed); };

test('扩展地图增加四个城市和五处关隘，双向道路与原始数据独立', () => {
  const before = JSON.stringify(standard), d = use(), g = G.newGame(4, 1, 7);
  assert.equal(JSON.stringify(standard), before);
  assert.equal(d.cities.length, 39); assert.equal(G.cityCount(), 34);
  assert.deepEqual(d.cities.slice(30).map((c) => c.name), ['襄阳', '江州', '宛城', '虎牢关', '函谷关', '武关', '剑阁', '望垣峡', '夷洲']);
  assert.equal(d.cities.filter((c) => c.kind === 'pass').length, 5);
  for (const c of d.cities) for (const n of c.roads) assert.ok(d.cities[n].roads.includes(c.id), `${c.name} → ${d.cities[n].name}`);
  for (const n of EXPANDED_NODES) {
    const [a, b] = n.road;
    assert.ok(!d.cities[a].roads.includes(b)); assert.ok(d.cities[a].roads.includes(n.id));
    const additional = CROSSING_ROADS.filter((r) => r.via === n.id).map((r) => r.road[1]);
    assert.ok(d.cities[b].roads.includes(n.id)); assert.deepEqual(d.cities[n.id].roads, [a, b, ...additional]);
    assert.equal(g.cities[n.id].faction, G.NONE);
  }
  assert.equal(G.books(g, 4), standard.rules.books[G.citiesOf(g, 4).length]);
});

test('平面和三维地图的关隘与城市都落在被拆分的道路上', () => {
  for (const [data, dims, build] of [
    [read('../assets/ai/sandtable/flat/board.json'), 2, expandedFlatBoard],
    [read('../assets/ai/sandtable/board/board.json'), 3, expandedSandMeta],
  ]) {
    const result = build(data);
    assert.equal(result.cities.length, 37); assert.equal(result.roads.length, data.roads.length + 7);
    for (const n of EXPANDED_NODES) {
      const segments = result.roads.filter((r) => r.a === n.id || r.b === n.id);
      assert.equal(segments.length, 2 + CROSSING_ROADS.filter((r) => r.via === n.id).length);
      const endpoints = segments.map((r) => r.a === n.id ? r.p.slice(0, dims) : r.p.slice(-dims));
      for (const point of endpoints.slice(1)) assert.deepEqual(endpoints[0], point, `${n.name} 的道路必须连续`);
      if (dims === 2) assert.deepEqual(endpoints[0], [result.cities[n.id].cx, result.cities[n.id].cy]);
      else assert.deepEqual(endpoints[0], [result.cities[n.id].x, result.cities[n.id].y, result.cities[n.id].z]);
    }
  }
});

test('宛城和襄阳错开相邻城市，通过短支路连回原道路', () => {
  for (const [data, dims, build] of [
    [read('../assets/ai/sandtable/flat/board.json'), 2, expandedFlatBoard],
    [read('../assets/ai/sandtable/board/board.json'), 3, expandedSandMeta],
  ]) {
    const old = JSON.stringify(data), result = build(data);
    const xy = (p) => dims === 2 ? [p[0], p[1]] : [p[0], p[2]];
    const seat = (city) => dims === 2 ? [city.cx, city.cy] : [city.x, city.z];
    const minDistance = (p, ids) => Math.min(...ids.map((id) => {
      const q = seat(data.cities[id]); return Math.hypot(p[0] - q[0], p[1] - q[1]);
    }));
    for (const id of [30, 32]) {
      const node = EXPANDED_NODES.find((n) => n.id === id), original = data.roads.find((r) =>
        (r.a === node.road[0] && r.b === node.road[1]) || (r.b === node.road[0] && r.a === node.road[1]));
      const length = original.p.length / dims, cut = Math.round((length - 1) * node.fraction);
      const junction = original.p.slice(cut * dims, (cut + 1) * dims);
      const segments = result.roads.filter((r) => r.a === id || r.b === id);
      const spur = segments.map((r) => r.spur).find((p) => p && junction.every((value, i) => p[i] === value));
      assert.ok(spur?.length > dims * 2, `${node.name}需要可绘制的连接道路`);
      assert.deepEqual(spur.slice(0, dims), junction);
      assert.deepEqual(xy(spur.slice(-dims)), seat(result.cities[id]));
      assert.ok(minDistance(seat(result.cities[id]), node.road) > minDistance(xy(junction), node.road), `${node.name}与两端的最近距离应增加`);
      for (const r of segments) if (r.sea) assert.equal(r.sea.length, r.p.length / dims);
    }
    assert.equal(JSON.stringify(data), old, '不得改写原版地图数据');
  }
});

test('荆州和新野从不同的接线进出襄阳，运输可逐段经过襄阳', () => {
  for (const [map, build] of [
    ['flat', expandedFlatBoard], ['board', expandedSandMeta],
  ]) {
    const original = read(`../assets/ai/sandtable/${map}/board.json`);
    const { roads } = build(original);
    const between = (a, b) => roads.find(r => [r.a, r.b].includes(a) && [r.a, r.b].includes(b));
    const width = map === 'flat' ? 2 : 3;
    const north = between(13, 30), south = between(21, 30);
    assert.ok(north.spur && south.spur);
    assert.notDeepEqual(north.spur.slice(0, width), south.spur.slice(0, width));
    assert.deepEqual(north.spur.slice(-width), south.spur.slice(-width));
    assert.equal(between(13, 21), undefined);
  }
  const g = game();
  const owner = g.cities[21].faction;
  g.cities[13].faction = g.cities[30].faction = owner;
  assert.deepEqual(G.transportRoutes(g, 21).get(13), [21, 30, 13]);
  assert.ok(!G.roads(21).includes(13));
});

test('新增道路两端及关隘的战场均可部署与恢复', () => {
  const g = game(), D = G.data();
  for (const n of EXPANDED_NODES) for (const from of n.road) for (const [city, source] of [[n.id, from], [from, n.id]]) {
    assert.ok(D.deploy[city][source], `${city} ← ${source} 缺少布阵`);
    const war = { city, from: source, attacker: 0, defender: 4, day: 1,
      att: { ids: [40], gold: 100, rice: 300 }, def: { ids: [41], gold: 100, rice: 300 } };
    const field = new Field(g, war, 'att'), resumed = Field.restore(g, war, field.snapshot());
    assert.equal(field.units.length, 2); assert.deepEqual(resumed.units, field.units);
    assert.ok(field.map[field.castle()[1]]?.[field.castle()[0]] === 5, `${city} 必须有可争夺的城门`);
  }
});

test('关隘可驻军、补给和争夺，但不增加城市数、税收或内政', () => {
  const g = game(), source = g.cities[13], f = source.faction;
  const id = source.officers.find((i) => i !== g.factions[f].ruler);
  const count = G.citiesOf(g, f).length, books = G.books(g, f);
  assert.ok(G.moveOfficers(g, 13, 35, [id]).ok);
  const gate = g.cities[35]; assert.equal(gate.faction, f); assert.deepEqual(gate.officers, [id]);
  assert.equal(G.citiesOf(g, f).length, count); assert.equal(G.books(g, f), books);
  gate.gold = 200; gate.rice = 200;
  G.income(g, 'gold'); G.income(g, 'rice');
  assert.equal(gate.gold, 200); assert.equal(gate.rice, 200);
  assert.equal(G.develop(g, 35, id, 'land', 10).ok, false);
  assert.equal(G.conscript(g, 35, 1).ok, false);
  assert.equal(G.search(g, 35, id).ok, false);
  g.year = 190; g.seed = 7; g.cities.filter((c) => c.faction === f && !G.isPass(c.id)).forEach((c) => { c.rice = 0; });
  assert.equal(chooseRaid(g, f), null, '关隘不能成为山贼袭城目标');
});

test('最后一座城市不能将所有武将移往关隘，但可以派部分武将', () => {
  const g = game(), city = g.cities[13], f = city.faction, ids = [...city.officers];
  assert.equal(G.citiesOf(g, f).length, 1);
  assert.ok(ids.length > 1);
  const result = G.moveOfficers(g, city.id, 35, ids);
  assert.equal(result.ok, false);
  assert.match(result.msg, /留守/);
  assert.deepEqual(city.officers, ids);
  assert.equal(g.cities[35].faction, G.NONE);
  assert.ok(G.moveOfficers(g, city.id, 35, [ids.at(-1)]).ok);
  assert.equal(city.faction, f);
});

test('扩展地图统一按三十四城判断，关隘不计入胜利', async () => {
  const g = game(), events = [];
  for (const c of g.cities.slice(0, 30)) c.faction = g.player;
  Object.assign(g, { current: g.player, books: 3, over: null });
  const io = { event: async (e) => events.push(e.type), playerTurn: async () => { g.over = { type: 'test' }; } };
  await G.run(g, io); assert.equal(g.over.type, 'test'); assert.ok(!events.includes('unify'));
  for (const c of g.cities.slice(30, 33)) c.faction = g.player;
  g.cities[33].faction = 0; g.over = null;
  await G.run(g, io); assert.equal(g.over.type, 'test'); assert.ok(!events.includes('unify'));
  g.cities[38].faction = g.player; g.over = null;
  await G.run(g, io); assert.equal(g.over.type, 'unify'); assert.ok(events.includes('unify'));
});

test('势力失去最后一座城市后，剩余关隘和驻军按灭亡处理', async () => {
  const g = game(), f = 8, source = g.cities[13], gate = g.cities[35], ids = [...source.officers];
  source.officers = []; source.faction = G.NONE;
  gate.officers = ids; gate.faction = f; g.factions[f].city = gate.id;
  const events = [];
  await G.checkFactions(g, { event: async (e) => events.push(e), chooseHeir: async () => assert.fail('君主仍在') });
  assert.equal(g.factions[f].ruler, null); assert.equal(gate.faction, G.NONE); assert.deepEqual(gate.officers, []);
  assert.ok(ids.every((id) => g.officers[id].status === G.RONIN));
  assert.ok(events.some((e) => e.type === 'fall' && e.faction === f));
});

function lastCityFixture() {
  const g = game(), f = g.player, ruler = g.factions[f].ruler, city = g.cities[g.factions[f].city];
  const guard = city.officers.find((id) => id !== ruler);
  const gate = g.cities[35];
  Object.assign(gate, { faction: f, officers: city.officers.filter((id) => id !== guard) });
  city.officers = [guard]; g.factions[f].city = gate.id;
  g.ageless = false; g.current = null; g.books = 0; g.monthDone = true;
  return { g, f, ruler, city, guard };
}

test('最后一城守将病逝时，即使君主驻守关隘也立即判定灭亡', async () => {
  const { g, f, city, guard } = lastCityFixture(), events = [];
  G.data().officers[guard].death = 0; g.year = 196;
  g.turnIdx = G.data().rules.turn_orders[g.order].indexOf(f) - 1;
  await G.run(g, { event: async (e) => events.push(e), playerTurn: async () => assert.fail('失去最后城市后不能继续回合'),
    aiTurn: async () => assert.fail('应先轮到玩家'), chooseHeir: async () => assert.fail('君主未病逝') });
  assert.equal(city.faction, G.NONE); assert.equal(g.over.type, 'gameover');
  assert.ok(events.some((e) => e.type === 'fall' && e.faction === f));
});

test('电脑诱纳最后守将使城市无主时，在电脑回合后判定灭亡', async () => {
  const { g, f, city, guard } = lastCityFixture(), events = [], attacker = g.factions.find((x) => x.id !== f && x.ruler != null).id;
  const source = G.citiesOf(g, attacker).find((c) => c.officers.length && c.officers.length < 10), actor = source.officers[0];
  Object.assign(g.officers[actor], { int: 99, virtue: 99, level: 5 }); g.officers[guard].loyalty = 0;
  g.turnIdx = G.data().rules.turn_orders[g.order].indexOf(attacker) - 1;
  await G.run(g, { event: async (e) => events.push(e), playerTurn: async () => assert.fail('失去最后城市后不能继续回合'),
    aiTurn: async (who) => { assert.equal(who, attacker); assert.equal(G.lure(g, source.id, actor, guard).joined, guard); },
    chooseHeir: async () => assert.fail('君主未病逝') });
  assert.equal(city.faction, G.NONE); assert.equal(g.over.type, 'gameover');
  assert.ok(events.some((e) => e.type === 'fall' && e.faction === f));
});

test('关隘战斗只改变关隘归属，不占领或破坏相邻城市', () => {
  const g = game();
  for (const c of g.cities) c.officers = c.officers.filter((id) => ![40, 41, 42].includes(id));
  const src = g.cities[12], gate = g.cities[34], adjacent = g.cities[8];
  Object.assign(src, { faction: 0, officers: [40, 41], gold: 500, rice: 500 });
  Object.assign(gate, { faction: 4, officers: [42], gold: 50, rice: 100 });
  const oldAdjacent = structuredClone(adjacent), oldSrc = { pop: src.pop, land: src.land, industry: src.industry, faction: src.faction };
  for (const id of [40, 41, 42]) { g.officers[id].status = G.SERVING; g.officers[id].soldiers = 500; }
  const war = setupWar(g, { from: 12, to: 34, ids: [41], commander: 41, gold: 20, rice: 100 });
  const field = new Field(g, war, 'att'); assert.equal(field.units.length, 2);
  resolveWar(g, war, { loser: 'def', survivors: { att: [41], def: [42] }, dead: [], captured: { byAtt: [], byDef: [] }, retreated: [], chests: { att: { gold: 20, rice: 80 }, def: { gold: 50, rice: 80 } } });
  assert.equal(gate.faction, 0); assert.ok(gate.officers.includes(41));
  assert.deepEqual(adjacent, oldAdjacent);
  assert.deepEqual({ pop: src.pop, land: src.land, industry: src.industry, faction: src.faction }, oldSrc);
  assert.equal(gate.land, 0); assert.equal(gate.industry, 0);
});

test('普通和快捷存档分离，扩展地图记录不能被旧地图误读', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), records = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k) => records.get(k) ?? null, setItem: (k, v) => records.set(k, String(v)), removeItem: (k) => records.delete(k) } });
  try {
    G.setData(structuredClone(standard), SOVEREIGN_SCENARIO_ID);
    const old = G.newGame(4, 1, 5); old.year = 195; assert.ok(G.save(old, 1)); assert.ok(G.saveQuick(old));
    const fresh = game(); fresh.year = 196; assert.ok(G.save(fresh, 1)); assert.ok(G.saveQuick(fresh));
    assert.equal(G.load(1).year, 196); assert.equal(G.loadQuick().cities.length, 39); assert.equal(G.upgrade(structuredClone(old)), null);
    G.setData(structuredClone(standard), SOVEREIGN_SCENARIO_ID);
    assert.equal(G.load(1).year, 195); assert.equal(G.loadQuick().cities.length, 30); assert.equal(G.upgrade(structuredClone(fresh)), null);
  } finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage; }
});

test('电脑内政能处理编号 32 的新城，关隘不参与内政循环', () => {
  const g = game(), d = G.data();
  for (const c of g.cities) { c.faction = G.NONE; c.officers = []; }
  Object.assign(g.cities[32], { faction: 4, officers: [20], gold: 500 });
  Object.assign(g.cities[35], { faction: 4, officers: [21], gold: 500 });
  g.aiCursor[4] = 31; d.rules.ai_domestic.faction_development_threshold_out_of_80.fill(80);
  aiDomestic(g, 4, 10, () => 0);
  assert.ok(g.cities[32].gold < 500); assert.equal(g.cities[35].gold, 500);
});

function aiFixture(seed) {
  const g = game(seed), d = G.data();
  for (const row of d.rules.ai_dispatch) row.weights = [16, 0, 0];
  for (const c of g.cities) { c.faction = G.NONE; c.officers = []; c.gold = 0; c.rice = 0; }
  Object.assign(g.cities[8], { faction: 4, officers: [20, 22, 23, 24, 25, 26], gold: 5000, rice: 5000 });
  Object.assign(g.cities[34], { faction: 4, officers: [21], gold: 1000, rice: 1000 });
  Object.assign(g.cities[12], { faction: 0, officers: [100], gold: 100, rice: 300 });
  Object.assign(g.factions[4], { ruler: 20, city: 8, ai: true });
  Object.assign(g.factions[0], { ruler: 100, city: 12, ai: false });
  for (const id of [20, 21, 22, 23, 24, 25, 26, 100]) Object.assign(g.officers[id], { status: G.SERVING, soldiers: 1000, loyalty: id === 20 || id === 100 ? 100 : 90 });
  g.year = 190; g.seed = seed; return g;
}

test('电脑可从城池调兵至关隘并向关隘另一侧进攻', async () => {
  let fought = 0;
  for (let seed = 0; seed < 50 && !fought; seed++) {
    const g = aiFixture(seed); let war = null;
    await aiTurn(g, 4, { event: async () => {}, war: async (w) => { war = w; }, afterWar: async () => {} });
    if (!war) continue;
    assert.equal(war.from, 34); assert.equal(war.city, 12);
    assert.ok(g.cities[8].officers.length >= 1); assert.ok(g.cities[34].officers.length >= 1);
    assert.ok(war.att.ids.length >= 1); fought++;
  }
  assert.equal(fought, 1, '至少一个种子应从关隘出兵');
});

test('电脑不会把仅剩的城市撤空到关隘导致势力自行灭亡', async () => {
  for (let seed = 0; seed < 80; seed++) {
    const g = game(seed), d = G.data();
    for (const row of d.rules.ai_dispatch) row.weights = [16, 0, 0];
    for (const c of g.cities) { c.faction = G.NONE; c.officers = []; }
    Object.assign(g.cities[8], { faction: 4, officers: [20], gold: 1000, rice: 1000 });
    Object.assign(g.cities[34], { faction: 4, officers: [21], gold: 0, rice: 100 });
    Object.assign(g.factions[4], { ruler: 20, city: 8, ai: true });
    for (const id of [20, 21]) Object.assign(g.officers[id], { status: G.SERVING, soldiers: 500, loyalty: id === 20 ? 100 : 90 });
    g.year = 190; g.seed = seed;
    await aiTurn(g, 4, { event: async () => {}, war: async () => assert.fail('没有敌人'), afterWar: async () => {} });
    assert.equal(g.cities[8].faction, 4, `种子 ${seed} 不应撤空最后一城`);
    assert.ok(g.cities[8].officers.length > 0);
  }
});

test('不战死的君主被俘时，可安置到有空位的己方关隘', () => {
  const g = game(), ruler = g.factions[4].ruler;
  g.noWarDeath = true;
  const ids = g.officers.filter((o) => !G.isRuler(g, o.id)).slice(0, 41).map((o) => o.id);
  for (const c of g.cities) { c.faction = G.NONE; c.officers = []; }
  Object.assign(g.cities[8], { faction: 0, officers: ids.slice(0, 10) });
  Object.assign(g.cities[11], { faction: 4, officers: ids.slice(10, 20) });
  Object.assign(g.cities[12], { faction: 4, officers: ids.slice(20, 30) });
  Object.assign(g.cities[35], { faction: 0, officers: [ids[30]] });
  Object.assign(g.cities[33], { faction: 4, officers: [] });
  for (const id of [...ids, ruler]) g.officers[id].status = G.SERVING;
  const war = { city: 33, from: 11, attacker: 0, defender: 4, day: 1,
    att: { ids: ids.slice(31, 41), gold: 0, rice: 0 }, def: { ids: [ruler], gold: 0, rice: 0 } };
  resolveWar(g, war, { loser: 'def', survivors: { att: ids.slice(31, 41), def: [] }, dead: [],
    captured: { byAtt: [ruler], byDef: [] }, sparedRulers: [ruler], retreated: [],
    chests: { att: { gold: 0, rice: 0 }, def: { gold: 0, rice: 0 } } });
  assert.equal(G.officerCity(g, ruler)?.id, 35);
  assert.equal(g.officers[ruler].status, G.SERVING);
});

test('电脑关隘补兵必须连接己方城市，优先使用城市后备兵', async () => {
  let replenished = false;
  for (let seed = 0; seed < 50; seed++) for (const connected of [false, true]) {
    const g = game(seed), d = G.data();
    for (const row of d.rules.ai_dispatch) row.weights = [0, 16, 0];
    d.rules.ai_domestic.faction_development_threshold_out_of_80.fill(0);
    for (const c of g.cities) { c.faction = G.NONE; c.officers = []; c.gold = 0; c.rice = 0; c.reserve = 0; }
    Object.assign(g.cities[2], { faction: 4, officers: [20, 22, 23], gold: 5000, rice: 1000 });
    Object.assign(g.cities[34], { faction: 4, officers: [21], gold: 5000, rice: 1000 });
    if (connected) Object.assign(g.cities[8], { faction: 4, officers: [24], reserve: 500, gold: 0 });
    Object.assign(g.factions[4], { ruler: 20, city: 2, ai: true });
    for (const id of [20, 22, 23, 24]) Object.assign(g.officers[id], { status: G.SERVING, soldiers: 1000, loyalty: id === 20 ? 100 : 90 });
    Object.assign(g.officers[21], { status: G.SERVING, soldiers: 500, loyalty: 90 });
    g.year = 190; g.seed = seed;
    await aiTurn(g, 4, { event: async () => {}, war: async () => assert.fail('此测试不出征'), afterWar: async () => {} });
    if (!connected) assert.equal(g.officers[21].soldiers, 500, '关隘自身的金不能凭空征兵');
    else if (g.officers[21].soldiers > 500) {
      assert.equal(g.officers[21].soldiers, 1000);
      assert.equal(g.cities[8].reserve, 0, '先使用连通城市的后备兵');
      assert.equal(g.cities[34].gold, 5000, '关隘不消耗金来征兵');
      replenished = true;
    }
  }
  assert.ok(replenished, '连通城市有后备兵时应能补给关隘');
});

test('电脑可对玩家驻守的关隘发起真实战场，遵守原有不战死结算', async () => {
  let fought = false;
  for (let seed = 0; seed < 50 && !fought; seed++) {
    const g = game(seed), d = G.data(), ruler = g.factions[4].ruler;
    for (const row of d.rules.ai_dispatch) row.weights = [16, 0, 0];
    for (const c of g.cities) c.officers = c.officers.filter((id) => ![40, 41, 42, 43, 44, ruler].includes(id));
    Object.assign(g.cities[12], { faction: 0, officers: [40, 41, 42, 43, 44], gold: 5000, rice: 5000 });
    Object.assign(g.cities[33], { faction: 4, officers: [ruler], gold: 0, rice: 300 });
    g.factions[4].city = 33; g.factions[4].ai = false; g.noWarDeath = true; g.year = 190; g.seed = seed;
    for (const id of [40, 41, 42, 43, 44]) Object.assign(g.officers[id], { status: G.SERVING, soldiers: 1000, loyalty: 90 });
    g.officers[ruler].status = G.SERVING; g.officers[ruler].soldiers = 1000;
    let war = null;
    await aiTurn(g, 0, { event: async () => {}, war: async (w) => { war = w; }, afterWar: async () => {} });
    if (!war || war.city !== 33) continue;
    assert.equal(war.from, 12); assert.equal(war.defender, 4);
    const field = new Field(g, war, 'def'); assert.equal(field.human, 'def');
    const chests = { att: { gold: war.att.gold, rice: war.att.rice }, def: { gold: war.def.gold, rice: war.def.rice } };
    resolveWar(g, war, { loser: 'def', survivors: { att: war.att.ids, def: [] }, dead: [],
      captured: { byAtt: [ruler], byDef: [] }, sparedRulers: [ruler], retreated: [], chests });
    assert.notEqual(g.officers[ruler].status, G.DEAD);
    assert.equal(g.cities[33].faction, 0);
    fought = true;
  }
  assert.ok(fought, '电脑应能进攻玩家驻守的关隘');
});

test('电脑对电脑的关隘战斗不会将相邻城市计为已攻陷', () => {
  const g = aiFixture(4), adjacent = structuredClone(g.cities[8]);
  const war = setupWar(g, { from: 12, to: 34, ids: [100], commander: 100, gold: 0, rice: 100 });
  const result = autoBattle(g, war);
  assert.equal(typeof result.attWins, 'boolean'); assert.deepEqual(g.cities[8], adjacent);
  assert.equal(G.isPass(34), true);
});

test('扩展地图关隘战斗可以中断、切回标准地图并继续原战场', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), records = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k) => records.get(k) ?? null, setItem: (k, v) => records.set(k, String(v)), removeItem: (k) => records.delete(k) } });
  try {
    const g = game();
    for (const c of g.cities) c.officers = c.officers.filter((id) => ![40, 41, 42].includes(id));
    Object.assign(g.cities[12], { faction: 0, officers: [40, 41], gold: 500, rice: 500 });
    Object.assign(g.cities[34], { faction: 4, officers: [42], gold: 50, rice: 100 });
    for (const id of [40, 41, 42]) g.officers[id].status = G.SERVING;
    const war = setupWar(g, { from: 12, to: 34, ids: [41], commander: 41, gold: 20, rice: 100 });
    const field = new Field(g, war, 'att');
    assert.ok(suspend(g, war, field, { side: 'att', start: {}, after: { kind: 'att', faction: 0, pts: 0 } }));
    G.setData(structuredClone(standard), SOVEREIGN_SCENARIO_ID); assert.equal(peekSuspend(), null);
    use(); const saved = takeSuspend(); assert.equal(saved.war.city, 34);
    assert.deepEqual(Field.restore(saved.g, saved.war, saved.field).units, field.units);
    assert.equal(peekSuspend(), null);
  } finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage; }
});

test('多种子真实回合中电脑可争夺关隘和新城，资源与武将名册保持一致', async () => {
  const STOP = Symbol('3 年'), totals = { wars: 0, gateWars: 0, gates: 0, newCities: 0 };
  for (let seed = 1; seed <= 12; seed++) {
    const g = game(seed);
    const inspect = () => {
      if (g.year >= 192) throw STOP;
      const seen = new Set();
      for (const c of g.cities) {
        assert.ok(c.officers.length <= 10);
        for (const key of ['gold', 'rice', 'pop', 'land', 'industry', 'reserve']) assert.ok(Number.isFinite(c[key]) && c[key] >= 0, `${c.id} ${key}`);
        for (const id of c.officers) { assert.ok(!seen.has(id), `武将 ${id} 重复驻守`); seen.add(id); assert.equal(g.officers[id].status, G.SERVING); }
      }
    };
    const io = {
      event: async (e) => { if (e.type === 'autobattle') { assert.ok(G.roads(e.war.from).includes(e.war.city), '电脑自动战必须沿相邻道路出阵'); totals.wars++; if (G.isPass(e.war.city)) totals.gateWars++; } },
      chooseHeir: async (f) => G.autoHeir(g, f), allianceOffer: async () => false,
      war: async (war) => { assert.ok(G.roads(war.from).includes(war.city), '电脑攻城必须沿相邻道路出阵'); totals.wars++; if (G.isPass(war.city)) totals.gateWars++; autoBattle(g, war); await G.checkFactions(g, io); },
      afterWar: async () => G.checkFactions(g, io),
      aiTurn: async (f) => { inspect(); await aiTurn(g, f, io); },
      playerTurn: async (f) => { inspect(); await aiTurn(g, f, io); g.endTurn = true; },
      raid: async (f) => { const plan = chooseRaid(g, f); if (plan) { resolveAiRaid(g, plan); await G.checkFactions(g, io); } },
    };
    try { await G.run(g, io); } catch (error) { if (error !== STOP) throw error; }
    totals.gates += g.cities.slice(33).filter((c) => c.faction !== G.NONE).length;
    totals.newCities += g.cities.slice(30, 33).filter((c) => c.faction !== G.NONE).length;
  }
  assert.ok(totals.wars > 0); assert.ok(totals.gateWars > 0);
  assert.ok(totals.gates > 0); assert.ok(totals.newCities > 0);
});
