import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { ATTACK_COST, Field, PLAIN, RIVER, SAND } from '../src/core/field.js';
import { applyScenario } from '../src/core/scenario.js';
import { loadScenario } from '../src/core/scenario-store.js';
import { SOVEREIGN_SCENARIO_ID } from '../src/core/visuals.js';
import { EXPANDED_MAP_ID, expandMap } from '../src/core/expanded-map.js';
import {
  FIRST_REGIONAL_BATTLE_REVISION, FIRST_REGIONAL_LAYOUT_REVISION, EXPANDED_WARDS_BATTLE_REVISION, EXPANDED_WARDS_LAYOUT_REVISION,
  ALIGNED_APPROACH_BATTLE_REVISION, ALIGNED_APPROACH_LAYOUT_REVISION, CORNER_BATTLE_REVISION, CORNER_LAYOUT_REVISION,
  REGIONAL_BATTLE_REVISION, REGIONAL_LAYOUT_REVISION,
} from '../src/core/regional-battlefields.js';
import { skirmishMap } from '../src/core/skirmish-maps.js';
import { waterColor, waterDepth } from '../src/war/surface.js';
import { blockedTerrain, gateNormal, siegeRing } from '../src/core/siege.js';
import { peekSuspend, suspend, suspendToken } from '../src/core/suspend.js';

const base = JSON.parse(readFileSync(new URL('../data/game-data.json', import.meta.url)));
const D = expandMap(applyScenario(base, await loadScenario(SOVEREIGN_SCENARIO_ID, base)));
G.setData(D, EXPANDED_MAP_ID);
const key = (x, y) => `${x},${y}`;
const keyOf = ({ x, y }) => key(x, y);
const step = ([a, b], [x, y]) => Math.abs(x - a) + Math.abs(y - b);
const war = (city, from, size = 10) => ({ city, from, attacker: 0, defender: 4, day: 1,
  att: { ids: Array.from({ length: size }, (_, i) => i + 40), gold: 100, rice: 9999 },
  def: { ids: Array.from({ length: size }, (_, i) => i + 50), gold: 100, rice: 9999 } });
const fresh = () => G.newGame(4, 1, 7);

test('水色连续过渡，外海呈深蓝，内陆河道呈灰绿', () => {
  const depth = waterDepth(6, 5, x => x > 0);
  assert.equal(depth(0, 2), 0);
  assert.equal(depth(0.5, 2), 0.5);
  assert.ok(depth(5, 2) > depth(1, 2));
  const [near, far] = [depth(1, 2), depth(5, 2)].map(d => waterColor(d, true));
  assert.ok(near[1] > far[1] && far[2] > far[1]);
  assert.ok(waterColor(1, false)[0] > near[0]);
});

test('39 处地图、146 条来路的布阵和官道均遵守实际通行，设施和关轴不会随来路旋转', () => {
  const g = fresh(), layouts = new Set();
  let entries = 0, beaches = 0, layoutsWithCorners = 0;
  assert.equal(g.campaignRevision, REGIONAL_BATTLE_REVISION);
  for (const city of D.cities) {
    let layout;
    for (const from of city.roads) {
      const title = `${D.cities[from].name} → ${city.name}`, f = new Field(g, war(city.id, from), 'att');
      const { siege, approaches } = f, { routes, barriers } = approaches;
      const shape = JSON.stringify([f.castle(), siege.walls, siege.gates, siege.moatCells, approaches.sites.filter(s => s.kind === 'house')]);
      layout ??= shape;
      assert.equal(shape, layout, title);
      assert.equal(new Set(f.units.map(keyOf)).size, 20, title);
      for (const side of ['att', 'def']) {
        const zones = f.deploymentZones(side), cells = zones.flatMap(z => z.cells);
        const keys = new Set(cells.map(p => key(...p)));
        assert.equal(cells.length, keys.size, title);
        assert.ok(cells.every(([x, y]) => f.deployable(x, y)), title);
        assert.ok(f.side(side).every(u => keys.has(keyOf(u))), title);
      }
      const z = f.deploymentZones('att'), u = f.side('att')[0];
      assert.ok(!z.some(zone => zone.cells.some(p => key(...p) === keyOf(approaches.post))), title);
      assert.ok([PLAIN, SAND].includes(f.terr(approaches.post.x, approaches.post.y)), title);
      if (z[0].corner) {
        layoutsWithCorners++;
        assert.equal(z.length, 4, title);
        assert.equal(new Set(z.map(zone => zone.corner)).size, 4, title);
        const outer = siege.gates.filter(g => g.ring === siege.outer);
        const extents = [Math.min(...siege.walls.map(w => w.x)), Math.max(...siege.walls.map(w => w.x)),
          Math.min(...siege.walls.map(w => w.y)), Math.max(...siege.walls.map(w => w.y))];
        assert.ok(z.every(zone => zone.cells.length >= 10 && zone.cells.every(([x,y]) =>
          Math.max(extents[0] - x, x - extents[1], extents[2] - y, y - extents[3]) >= 5
          && outer.every(g => step([x,y],[g.x,g.y]) >= 5))), title);
        const [dx, dy] = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] }[f.entryDirection];
        assert.ok((z[0].anchor[0] - siege.cx) * dx + (z[0].anchor[1] - siege.cy) * dy > 0, title);
      } else if (z.length > 1) {
        beaches++;
        assert.equal(z.length, 2, title);
        assert.ok(step(z[0].anchor, z[1].anchor) >= 14, title);
        assert.ok(z.every(zone => zone.cells.length >= 10), title);
      }
      assert.ok(f.side('att').every(o => z[0].cells.some(p => key(...p) === keyOf(o))), title);
      const entrances = routes.filter(route => route.goal.kind !== 'camp');
      assert.ok(new Set(entrances.map(r => keyOf(r.goal))).size >= (siege.type === 'capital' ? 3 : 2), title);
      if (siege.camp) f.campSecured = true;
      for (const { cells, goal } of routes) {
        assert.ok(z.some(zone => step(cells[0], zone.anchor) === 0), title);
        assert.deepEqual(cells.at(-1), [goal.x, goal.y], title);
        assert.ok(cells.every((p, i) => f.deployable(...p) && (i === 0 || step(p, cells[i - 1]) === 1)), title);
        for (const [army, soldiers] of [['平', 700], ['山', 450], ['水', 900]]) {
          Object.assign(f.O(u.id), { army, soldiers });
          assert.ok(cells.every(p => Number.isFinite(f.cost(u, ...p))), title);
        }
      }
      for (const [k] of barriers) assert.equal(f.cost(u, ...k.split(',').map(Number)), Infinity, title);
      for (const v of f.units) if (v !== u) v.gone = true;
      const reach = f.reach(u, Infinity);
      assert.ok(z.every(zone => zone.cells.every(p => reach.dist.has(key(...p)))), title);
      assert.ok(reach.dist.has(key(...f.castle())), title);
      const shops = f.reach(u, Infinity, (x,y) => !siege.districts.has(key(x,y)));
      assert.deepEqual(f.villages.map(v => v.kind), (D.villages[city.id] ?? []).map(v => v.kind), title);
      const center = { x: (Math.min(...siege.walls.map(w => w.x)) + Math.max(...siege.walls.map(w => w.x))) / 2,
        y: (Math.min(...siege.walls.map(w => w.y)) + Math.max(...siege.walls.map(w => w.y))) / 2 };
      if (z[0].corner) assert.equal(new Set(f.villages.map(v => `${v.x < center.x},${v.y < center.y}`)).size, f.villages.length, title);
      for (const shop of f.villages) {
        assert.ok(shops.dist.has(keyOf(shop)), `${title} ${shop.kind}城外可达`);
        assert.equal(f.terr(shop.x,shop.y), PLAIN, title);
        assert.ok(!approaches.roads.has(keyOf(shop)), title);
        assert.ok(!z.some(zone => zone.cells.some(p => key(...p) === keyOf(shop))), title);
        assert.ok(f.villages.every(other => shop === other || step([shop.x,shop.y],[other.x,other.y]) >= 4), title);
        assert.ok(step([shop.x,shop.y],[approaches.post.x,approaches.post.y]) >= 4, title);
      }
      const outerGates = siege.gates.filter(gate => gate.ring === siege.outer);
      for (const gate of outerGates) {
        const wardReach = f.reach({ ...u, x: gate.x, y: gate.y }, Infinity, (x,y) => siege.districts.has(key(x,y)));
        assert.ok(wardReach.dist.has(key(...f.castle())), `${title} ${gate.face}门的城内通路`);
      }
      entries++;
    }
    const f = new Field(g, war(city.id, city.roads[0]), 'att');
    layouts.add(JSON.stringify(f.map));
    const old = new Field({ ...g, campaignRevision: FIRST_REGIONAL_BATTLE_REVISION }, f.war, 'att');
    assert.equal(old.siege.revision, FIRST_REGIONAL_LAYOUT_REVISION);
    assert.equal(f.siege.revision, REGIONAL_LAYOUT_REVISION);
    assert.ok(f.siege.districts.size > old.siege.districts.size, city.name);
    if (f.siege.type !== 'pass') {
      assert.ok(f.siege.streets.size >= 2 * f.siege.gates.length, city.name);
      assert.ok([...f.siege.streets].every(cell => f.deployable(...cell.split(',').map(Number))), city.name);
    }
  }
  assert.equal(layouts.size, 39);
  assert.equal(entries, 146);
  assert.equal(beaches, 2, '建安和夷洲的双向海路均可分两处登陆');
  assert.equal(layoutsWithCorners, 134, '有四角旱地的陆路城战均支持满编整队选角');
});

test('修订 9 中断战斗保留既有分散站位与通路，战役升级后新战采用整队集结', () => {
  const g = { ...fresh(), campaignRevision: CORNER_BATTLE_REVISION }, w = war(2, 5);
  const legacy = new Field(g, w, 'att');
  assert.equal(legacy.siege.revision, CORNER_LAYOUT_REVISION);
  assert.ok(legacy.dep.attackerZones.every(zone => legacy.side('att').some(o => zone.cells.some(p => key(...p) === keyOf(o)))));
  const newest = fresh(), resumed = Field.restore(newest, w, legacy.snapshot());
  assert.equal(resumed.siege.revision, CORNER_LAYOUT_REVISION);
  assert.deepEqual(resumed.units, legacy.units);
  assert.deepEqual(resumed.dep, legacy.dep);
  assert.deepEqual(resumed.approaches, legacy.approaches);
  assert.deepEqual(resumed.map, legacy.map);
  assert.equal(new Field(newest, w, 'att').dep.grouped, true);
});

test('建业进攻徐州时，优先从进攻一侧能更快抵达外门的角区出发', () => {
  const city = D.cities.find(c => c.name === '徐州'), from = D.cities.find(c => c.name === '建业');
  const f = new Field(fresh(), war(city.id, from.id, 1), 'att'), [u] = f.side('att');
  const [defaultZone, alternative] = f.deploymentZones('att');
  Object.assign(f.O(u.id), { soldiers: 700, army: '平' });
  f.side('def')[0].gone = true; f.weather = 'clear';
  const cost = ([x, y]) => {
    const { dist } = f.reach({ ...u, x, y }, Infinity);
    return Math.min(...f.siege.gates.filter(g => g.ring === f.siege.outer).map(g => dist.get(keyOf(g)) ?? Infinity));
  };
  assert.ok(cost(defaultZone.anchor) + 10 < cost(alternative.anchor));
});

test('兖州在城外三个新址可行军到达并使用米店、武器店和医馆', () => {
  const f = new Field(fresh(), war(11,14,1), 'att'), [u] = f.side('att');
  const chest = f.chest('att'), officer = f.O(u.id);
  Object.assign(chest, { gold:3000, rice:900 });
  Object.assign(officer, { hp:10, war:99, virtue:99 });
  for (const enemy of f.side('def')) enemy.gone = true;
  const go = kind => {
    const shop = f.villages.find(v => v.kind === kind), { x, y } = shop;
    const reachable = f.reach(u, Infinity), cost = reachable.dist.get(keyOf(shop));
    assert.ok(Number.isFinite(cost), kind);
    f.pool.att = cost;
    f.move(u, x, y, cost, f.path(reachable,x,y));
    assert.equal(f.village(u), shop);
  };
  go('米店');
  assert.equal(f.buyRice(u,10), '买米 10');
  assert.equal(chest.rice, 910);
  go('武器店');
  const bought = f.shopStock().find(e => f.buyEquip(u,e.id).ok);
  assert.ok(bought);
  go('病院');
  const gold = chest.gold;
  assert.match(f.hospital(u), /体力 \+/);
  assert.ok(officer.hp > 10);
  assert.equal(chest.gold, gold - 50);
});

test('襄阳桥面和浅滩区分通行、天气和白兵地形，剑阁栈道绕开外关并通往内关', () => {
  const g = fresh(), river = new Field(g, war(30, 13, 1), 'att');
  const a = river.side('att')[0], d = river.side('def')[0];
  Object.assign(river.O(a.id), { army: '平', soldiers: 700 });
  const tiles = [...river.approaches.roads.values()];
  const harbor = river.approaches.sites.find(s => s.kind === 'harbor');
  assert.ok(harbor && river.deployable(harbor.x, harbor.y));
  assert.ok([[1,0], [-1,0], [0,1], [0,-1]].some(([dx,dy]) =>
    river.approaches.barriers.get(key(harbor.x + dx, harbor.y + dy)) === '深水'));
  const bridge = tiles.find(p => p.kind === 'bridge' && river.terr(p.x, p.y) === RIVER);
  const ford = tiles.find(p => p.kind === 'ford' && river.terr(p.x, p.y) === RIVER);
  const rates = () => [river.cost(a, bridge.x, bridge.y), river.cost(a, ford.x, ford.y)];
  river.weather = 'clear';
  const [bridgeClear, fordClear] = rates();
  river.weather = 'rain';
  const [bridgeRain, fordRain] = rates();
  assert.equal(bridgeRain, bridgeClear);
  assert.ok(fordRain > fordClear);
  assert.match(river.ground(bridge.x, bridge.y), /桥道/);
  assert.match(river.ground(ford.x, ford.y), /浅滩/);
  Object.assign(d, { x: bridge.x, y: bridge.y });
  const clash = river.attack(a, d).battle;
  assert.equal(clash.terrain, PLAIN);
  assert.equal(clash.sceneProfile.tacticalSite, 'bridge');
  assert.equal(clash.map[1][7], 3);
  Object.assign(a, ford);
  const threat = river.threat('att', a);
  assert.ok(threat.size > 0);
  assert.ok([...threat].every(k => !river.approaches.barriers.has(k)));

  const pass = new Field(g, war(36, 25, 1), 'att');
  const plank = pass.approaches.routes.find(r => r.goal.label === '栈道至内关');
  const gate = pass.siege.gates.find(g => keyOf(g) === keyOf(plank.goal));
  assert.equal(gate.ring, pass.siege.inner);
  assert.ok(plank.cells.some(p => pass.approaches.roads.get(key(...p))?.kind === 'plank'));
  assert.ok(!plank.cells.some(p => pass.siege.gates.some(g => g.ring === pass.siege.outer && key(...p) === keyOf(g))));
  const cliff = [...pass.approaches.barriers].find(([, type]) => type === '断崖')[0].split(',').map(Number);
  const [x,y] = cliff, left = { x: x - 1, y }, right = { x: x + 1, y };
  assert.ok(blockedTerrain(pass.approaches.barriers, left, right));
  assert.ok(blockedTerrain(pass.approaches.barriers, right, left));
});

test('六种局部白兵布置保留四套阵法位置和贯穿战线的地面通路', () => {
  for (const [tacticalSite, terrain] of [['bridge', 2], ['ford', 3], ['plank', 2], ['camp', 2], ['streets', 5], ['beach', 1]]) {
    const original = D.skirmish_maps[terrain], map = skirmishMap(original, terrain, { tacticalSite });
    const formations = D.formations.slice(0, terrain === 5 ? 6 : 4);
    for (const [i, layout] of formations.entries()) for (const [a, y, d] of layout) {
      if (i < 4) assert.equal(map[y][a], original[y][a], tacticalSite);
      const x = i >= 4 ? 15 - a : d;
      assert.equal(map[y][x], original[y][x], tacticalSite);
    }
    assert.ok(map.filter(row => row[7] === 0 && row[8] === 0).length >= 2, tacticalSite);
  }
});

test('宛城前阵阻挡破门，电脑先攻前阵，中断继续后保留解锁及已破城门', () => {
  const g = fresh(), w = war(32, 13, 3), f = new Field(g, w, 'def');
  const a = f.side('att')[0], [commander, soldier, reserve] = f.side('def'), camp = f.siege.camp;
  const gate = f.siege.gates.find(g => g.ring === f.siege.outer);
  const [dx, dy] = gateNormal(f.siege, gate);
  assert.deepEqual([commander.x, commander.y], f.castle());
  assert.deepEqual([soldier.x, soldier.y], [camp.x, camp.y]);
  assert.notDeepEqual([camp.x, camp.y], f.castle());
  assert.ok([-1,0,1].every(dx => [-1,0,1].every(dy => f.terr(camp.x + dx,camp.y + dy) === PLAIN)));
  assert.ok(f.siege.walls.every(wall => step([wall.x,wall.y],[camp.x,camp.y]) >= 4));
  assert.equal(f.cost(a, gate.x, gate.y), Infinity);
  assert.ok(Number.isFinite(f.cost(soldier, gate.x, gate.y)));
  assert.equal(f.over, null);
  f.captureUnit(soldier, a, true);
  f.checkCommanders();
  assert.equal(f.over, null, '外营部将被俘时攻城照常继续');
  Object.assign(commander, { x: gate.x - dx, y: gate.y - dy });
  Object.assign(a, { x: camp.x - 2, y: camp.y });
  Object.assign(f.O(a.id), { soldiers: 700 });
  for (const u of [...f.side('att').slice(1), soldier, reserve]) u.gone = true;
  f.pool.att = 8;
  assert.ok([...f.aiActions('att')].some(event => event.type === 'move' && event.path.some(p => key(...p) === keyOf(camp))));
  assert.equal(f.campSecured, true);
  assert.equal(f.over, null);
  const closed = f.cost(a, gate.x, gate.y);
  assert.ok(Number.isFinite(closed));
  f.move(a, gate.x, gate.y, closed);
  assert.equal(f.cost(a, gate.x, gate.y), closed - 2);
  assert.equal(siegeRing(f.siege, a), f.siege.outer);

  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), store = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: k => store.get(k) ?? null, setItem: (k, value) => store.set(k, String(value)), removeItem: k => store.delete(k),
  } });
  try {
    assert.equal(suspend(g, w, f, { side: 'def', start: {}, after: { kind: 'def' } }), true);
    const token = suspendToken(), rec = peekSuspend(token), restored = Field.restore(rec.g, rec.war, rec.field);
    assert.equal(restored.campSecured, true);
    assert.equal(restored.siege.gates.find(g => keyOf(g) === keyOf(gate)).open, true);
    assert.deepEqual(restored.units, f.units);
    assert.equal(suspendToken(), token);
    rec.field.campSecured = false;
    assert.equal(peekSuspend(JSON.stringify(rec)), null);
    rec.field.campSecured = true;
    const wall = restored.siege.walls[0];
    Object.assign(rec.field.units.find(v => !v.gone), { x: wall.x, y: wall.y });
    assert.equal(peekSuspend(JSON.stringify(rec)), null);
    assert.equal(suspendToken(), token);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});

function campEncounter() {
  const f = new Field(fresh(), war(32, 13, 3), 'att');
  const { camp } = f.siege, [, guard] = f.side('def'), [enemy, reinforcement, reserve] = f.side('att');
  Object.assign(f.O(guard.id), { soldiers: 800, hp: 90, int: 10, army: '平' });
  Object.assign(f.O(enemy.id), { soldiers: 500, hp: 90 });
  Object.assign(enemy, { x: camp.x - 2, y: camp.y });
  reinforcement.gone = true; reserve.gone = true;
  assert.ok(f.deployable(enemy.x, enemy.y));
  f.weather = 'clear'; f.turn = 'def'; f.pool.def = ATTACK_COST + 7;
  return { f, camp, guard, enemy, reinforcement };
}

test('宛城外营守军可出营迎击孤军，恢复战斗后仍可接战和回营', () => {
  const { f, camp, guard, enemy } = campEncounter(), initial = f.pool.def;
  const move = f.aiActions('def', u => u === guard).next().value;
  assert.equal(move?.type, 'move');
  assert.notEqual(keyOf(guard), keyOf(camp));
  assert.equal(f.dist(guard, enemy), 1);
  assert.equal(f.pool.def, initial - move.cost);
  assert.ok(f.pool.def >= ATTACK_COST);

  const restored = Field.restore(f.g, f.war, f.snapshot()), [target] = restored.side('att');
  const sentry = restored.side('def').find(u => u.id === guard.id);
  const actions = restored.aiActions('def', u => u === sentry);
  const strike = actions.next().value;
  assert.equal(strike?.type, 'attack');
  assert.equal(strike.d, target);
  assert.equal(restored.pool.def, initial - move.cost - ATTACK_COST);
  target.gone = true;
  assert.equal(actions.next().value?.type, 'move');
  assert.equal(keyOf(sentry), keyOf(camp));
  assert.equal(restored.campSecured, false);
  assert.ok(restored.siege.gates.every(gate => !gate.open));
});

test('宛城外营遇多支敌军、兵力不足或机动力不足时，营格守军留守', () => {
  for (const reason of ['多支敌军', '兵力不足', '机动力不足']) {
    const { f, camp, guard, enemy, reinforcement } = campEncounter();
    if (reason === '多支敌军') Object.assign(reinforcement, { x: camp.x, y: camp.y + 2, gone: false });
    if (reason === '兵力不足') f.O(enemy.id).soldiers = 950;
    if (reason === '机动力不足') f.pool.def = ATTACK_COST;
    const action = f.aiDecide(guard);
    assert.notEqual(action?.type, 'move', reason);
    assert.equal(keyOf(guard), keyOf(camp), reason);
    assert.equal(f.human, 'att');
    assert.equal(f.campSecured, false);
  }
});

test('宛城已有守军占住营格时，营侧电脑副将可出击', () => {
  const { f, camp, guard, reinforcement } = campEncounter(), reserve = f.side('def')[2];
  Object.assign(reserve, { x: camp.x - 1, y: camp.y + 1 });
  Object.assign(f.O(reserve.id), { soldiers: 800, hp: 90, int: 10, army: '平' });
  Object.assign(reinforcement, { x: camp.x, y: camp.y + 2, gone: false });
  Object.assign(f.O(reinforcement.id), { soldiers: 500, hp: 90 });
  assert.notEqual(f.aiDecide(guard)?.type, 'move');
  const actions = f.aiActions('def', u => u === reserve);
  assert.equal(actions.next().value?.type, 'move');
  assert.equal(actions.next().value?.type, 'attack');
  assert.equal(f.unitAt(camp.x, camp.y), guard);
});

test('有天然河道的城池四向连通，桥头能平接两岸', () => {
  const g = fresh();
  for (const city of D.cities) {
    const f = new Field(g, war(city.id, city.roads[0], 1), 'att');
    if (!['capital', 'river', 'field'].includes(f.siege.type)) continue;
    const moats = new Set(f.siege.moatCells.filter(v => v.wet).map(keyOf));
    const cells = f.map.flatMap((row, y) => row.flatMap((t, x) => t === RIVER && !moats.has(key(x,y)) ? [[x,y]] : []));
    const unseen = new Set(cells.map(p => key(...p))), queue = [cells[0]];
    assert.ok(unseen.delete(key(...cells[0])), city.name);
    for (const [x, y] of queue) for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      if (unseen.delete(key(x + dx, y + dy))) queue.push([x + dx, y + dy]);
    }
    assert.equal(unseen.size, 0, city.name);
    const roads = f.approaches.roads;
    for (const { x, y, kind, face } of roads.values()) {
      if (kind !== 'bridge') continue;
      if (f.terr(x,y) !== RIVER) {
        assert.ok([PLAIN, SAND].includes(f.terr(x,y)), city.name);
        assert.equal(f.unitTerrain(x,y), PLAIN, city.name);
      }
      if (moats.has(key(x,y))) continue;
      const horizontal = face === 'e' || face === 'w';
      for (const dir of [-1, 1]) {
        const bx = x + (horizontal ? dir : 0), by = y + (horizontal ? 0 : dir);
        if (roads.get(key(bx,by))?.kind === 'bridge') continue;
        const ashore = f.terr(x,y) !== RIVER || (f.deployable(bx,by) && f.terr(bx,by) !== RIVER);
        assert.ok(ashore, `${city.name}桥头 ${x},${y}`);
      }
    }
  }
});

test('战役升级后，修订 6 的宛城可按原前阵和站位续玩', () => {
  const g = fresh(), w = war(32, 12, 3);
  const legacy = new Field({ ...g, campaignRevision: FIRST_REGIONAL_BATTLE_REVISION }, w, 'att');
  const [commander] = legacy.side('def');
  assert.deepEqual([commander.x, commander.y], [legacy.siege.camp.x, legacy.siege.camp.y]);
  const resumed = Field.restore(g,w,legacy.snapshot());
  assert.deepEqual(resumed.map, legacy.map);
  assert.deepEqual(resumed.siege, legacy.siege);
  assert.deepEqual(resumed.units, legacy.units);
});

test('西安阳和长安攻并州时，西岸可布阵并沿同一条引道过桥直达西门', () => {
  const g = fresh();
  for (const from of [5,8]) {
    const w = war(2,from,1), f = new Field({ ...g, campaignRevision: ALIGNED_APPROACH_BATTLE_REVISION },w,'att'), [u] = f.side('att');
    Object.assign(f.O(u.id), { soldiers:700, army:'平' });
    f.weather = 'clear';
    const gate = f.siege.gates.find(g => g.face === 'w' && g.ring === f.siege.outer);
    const route = f.approaches.routes[0];
    const reach = f.reach(u,Infinity,(x,y) => !f.siege.districts.has(key(x,y)) || key(x,y) === keyOf(gate));
    const path = f.path(reach,gate.x,gate.y);
    assert.deepEqual(route.goal,{ x:gate.x, y:gate.y, label:'西门' });
    assert.ok(path.length <= 13 && path.every(([,y]) => y === gate.y));
    assert.ok(reach.dist.get(keyOf(gate)) <= 17, '晴天大部队应可在约十五点机动力下走到西门');
    const firstWater = path.find(([x,y]) => f.terr(x,y) === RIVER);
    assert.ok(firstWater);
    assert.ok(f.deploymentZones('att')[0].cells.every(([x,y]) => x < firstWater[0] && f.terr(x,y) !== RIVER));
    const next = new Field(g,w,'att'), first = next.side('att')[0];
    next.weather = 'clear';
    assert.equal(next.siege.revision, REGIONAL_LAYOUT_REVISION);
    assert.ok(next.deploymentZones('att')[0].cells.every(([x,y]) => x < firstWater[0] && next.terr(x,y) !== RIVER));
    assert.ok(next.reach(first,Infinity).dist.get(keyOf(gate)) < 24, '新角区靠木桥同一侧，保留西门近路');
    const nextRestored = Field.restore(g,w,f.snapshot());
    assert.equal(nextRestored.siege.revision,ALIGNED_APPROACH_LAYOUT_REVISION);
    assert.deepEqual(nextRestored.approaches,f.approaches);
    assert.deepEqual(nextRestored.units,f.units);
    const old = new Field({ ...g, campaignRevision:EXPANDED_WARDS_BATTLE_REVISION },w,'att');
    assert.equal(old.siege.revision,EXPANDED_WARDS_LAYOUT_REVISION);
    assert.ok(old.reach(old.side('att')[0],Infinity).dist.get(keyOf(gate)) > reach.dist.get(keyOf(gate)));
    const restored = Field.restore(g,w,old.snapshot());
    assert.deepEqual(restored.map,old.map);
    assert.deepEqual(restored.approaches,old.approaches);
    assert.deepEqual(restored.units,old.units);
  }
});
