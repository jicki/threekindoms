import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { Field } from '../src/core/field.js';
import { setupWar, resolveWar } from '../src/core/warcore.js';
import { aiTurn } from '../src/core/ai.js';
import { suspend, takeSuspend } from '../src/core/suspend.js';
import { checkRecord } from '../src/core/saveedit.js';
import { chooseRaid } from '../src/core/raids.js';
import { applyScenario } from '../src/core/scenario.js';
import { loadScenario } from '../src/core/scenario-store.js';
import { EXPANDED_MAP_ID, expandMap, expandedSandMeta, expandedFlatBoard } from '../src/core/expanded-map.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const base = read('../data/game-data.json'), scenario = await loadScenario('builtin-sovereigns', base);
const modern = () => expandMap(applyScenario(base, scenario));
const prior = () => { const s = structuredClone(scenario); delete s.frontierMap; delete s.battleRulerPassives; return expandMap(applyScenario(base, s)); };

test('望垣峡和夷洲连接现有道路，原版及未启用据点的版本不增加地点', () => {
  const d = modern(); G.setData(d, EXPANDED_MAP_ID);
  try {
    const g = G.newGame(4, 1, 2);
    assert.equal(d.cities.length, 39); assert.equal(G.cityCount(), 34);
    assert.deepEqual(d.cities[37].roads, [9, 26]); assert.equal(d.cities[37].kind, 'pass');
    assert.deepEqual(d.cities[38].roads, [17]); assert.notEqual(d.cities[38].kind, 'pass');
    assert.ok(d.cities[9].roads.includes(37) && !d.cities[9].roads.includes(26));
    assert.ok(d.cities[26].roads.includes(37) && d.cities[17].roads.includes(38));
    assert.ok([37, 38].every((id) => g.cities[id].faction === G.NONE));
    assert.equal(d.cities[37].facilities.weapons, false); assert.equal(d.rules.books.length, 35);
    for (const [to, from] of [[37, 9], [37, 26], [9, 37], [26, 37], [38, 17], [17, 38]]) {
      assert.ok(d.deploy[to][from], `${to} ← ${from}`);
      const war = { city: to, from, attacker: 0, defender: 4,
        att: { ids: [40], gold: 100, rice: 300 }, def: { ids: [41], gold: 100, rice: 300 } };
      const field = new Field(g, war, 'att');
      assert.equal(field.units.length, 2); assert.equal(field.map[field.castle()[1]][field.castle()[0]], 5);
    }
    assert.equal(prior().cities.length, 37); assert.equal(base.cities.length, 30);
  } finally { G.setData(base); }
});

test('平面与三维沙盘均在截图对应区域绘制新据点和完整航线', () => {
  const sand = expandedSandMeta(read('../assets/ai/sandtable/board/board.json'), true);
  const flat = expandedFlatBoard(read('../assets/ai/sandtable/flat/board.json'), true);
  assert.equal(sand.cities.length, 39); assert.equal(flat.cities.length, 39);
  for (const [board, dims] of [[sand, 3], [flat, 2]]) {
    const segments = board.roads.filter((r) => r.a === 37 || r.b === 37);
    assert.equal(segments.length, 2);
    const ends = segments.map((r) => r.a === 37 ? r.p.slice(0, dims) : r.p.slice(-dims));
    assert.deepEqual(ends[0], ends[1]);
    const lane = board.roads.find((r) => r.a === 17 && r.b === 38);
    assert.ok(lane?.generated); assert.ok(lane.p.length > 100);
    if (dims === 2) {
      assert.deepEqual(lane.p.slice(-2), [flat.cities[38].cx, flat.cities[38].cy]);
      assert.ok(lane.sea.some(Boolean) && lane.sea.some((v) => !v));
    } else {
      assert.deepEqual(lane.p.slice(-3).filter((_, i) => i !== 1), [sand.cities[38].x, sand.cities[38].z]);
    }
  }
  for (const kind of ['tree-broad', 'tree-pine']) {
    const trees = sand.pieces[kind], { x, z } = sand.cities[38];
    for (let i = 0; i < trees.length; i += 6) assert.ok((trees[i] - x) ** 2 + (trees[i + 2] - z) ** 2 > 0.45 ** 2);
  }
});

test('新增据点能移动和进行守城结算；海岛按近海触发海贼', () => {
  const d = modern(); G.setData(d, EXPANDED_MAP_ID);
  try {
    const g = G.newGame(4, 1, 5), guard = g.cities[9].officers.at(-1);
    assert.equal(G.moveOfficers(g, 9, 37, [guard]).ok, true);
    const attacker = g.cities[26].officers.find((id) => id !== g.factions[5].ruler);
    const war = setupWar(g, { from: 26, to: 37, ids: [attacker], commander: attacker, gold: 0, rice: 100 });
    assert.ok(new Field(g, war, 'att').units.length >= 2);
    resolveWar(g, war, { loser: 'def', survivors: { att: [attacker], def: [guard] }, dead: [],
      captured: { byAtt: [], byDef: [] }, retreated: [], chests: { att: war.att, def: war.def }, skipCut: true });
    assert.equal(g.cities[37].faction, 5);
    const f = 3, coast = g.cities[17], id = coast.officers[0];
    assert.equal(G.moveOfficers(g, 17, 38, [id]).ok, true);
    Object.assign(g.cities[38], { rice: 500, riot: 0 }); g.officers[id].soldiers = 800; g.year = 190; g.over = null;
    for (const c of g.cities) if (c.faction === f && c.id !== 38) c.rice = 0;
    let raid = null;
    for (let seed = 0; seed < 500 && !raid; seed++) { g.seed = seed; delete g.raidHistory; g.factions[f].ai = false; raid = chooseRaid(g, f); }
    assert.equal(raid?.city, 38); assert.equal(raid?.kind, 'pirate');
  } finally { G.setData(base); }
});

test('电脑可经建安占领夷洲，海岛攻防可完成实际战场和战后结算', async () => {
  const d = modern(); G.setData(d, EXPANDED_MAP_ID);
  try {
    for (const row of d.rules.ai_dispatch) row.weights = [16, 0, 0];
    let occupied = false;
    for (let seed = 0; seed < 150 && !occupied; seed++) {
      const g = G.newGame(4, 1, seed);
      for (const c of g.cities) Object.assign(c, { faction: G.NONE, officers: [] });
      Object.assign(g.cities[17], { faction: 3, officers: [20, 21, 22, 23, 24], gold: 5000, rice: 5000 });
      Object.assign(g.factions[3], { ruler: 20, city: 17, ai: true });
      for (const id of g.cities[17].officers) Object.assign(g.officers[id], { status: G.SERVING, soldiers: 1000, loyalty: id === 20 ? 100 : 90 });
      g.year = 194; g.seed = seed;
      await aiTurn(g, 3, { event: async () => {}, war: async () => assert.fail('此场景没有敌军'), afterWar: async () => {} });
      if (g.cities[38].faction === 3) {
        assert.ok(g.cities[38].officers.length > 0);
        assert.ok(g.cities[17].officers.length > 0);
        occupied = true;
      }
    }
    assert.ok(occupied, '至少一个种子下电脑应通过海路占领夷洲');

    const g = G.newGame(3, 1, 9), reinforcement = g.cities[16].officers[0];
    assert.equal(G.moveOfficers(g, 16, 17, [reinforcement]).ok, true);
    const attacker = g.cities[17].officers[0], from = g.cities[12];
    const defender = from.officers.find((id) => id !== g.factions[0].ruler);
    from.officers = from.officers.filter((id) => id !== defender);
    Object.assign(g.cities[38], { faction: 0, officers: [defender], rice: 500 });
    for (const id of [attacker, defender]) Object.assign(g.officers[id], { soldiers: 600, hp: 80 });
    const war = setupWar(g, { from: 17, to: 38, ids: [attacker], commander: attacker, gold: 0, rice: 300 });
    const field = new Field(g, war, null);
    for (let turn = 0; !field.over && turn < 200; turn++) {
      for (const event of field.aiActions(field.turn)) if (event.res?.pending) event.res.auto();
      field.endTurn();
    }
    assert.ok(field.over, '海岛战场应在回合限制内结束');
    const result = field.result(); resolveWar(g, war, result);
    assert.equal(g.cities[38].faction, result.loser === 'def' ? 3 : 0);
    assert.ok(G.upgrade(structuredClone(g)), '海岛战后记录应可读取');
  } finally { G.setData(base); }
});

test('旧扩展地图普通、快捷及中断战斗记录可恢复，原状态不被重置', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), records = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (k) => records.get(k) ?? null, setItem: (k, v) => records.set(k, String(v)), removeItem: (k) => records.delete(k),
  } });
  try {
    G.setData(prior(), EXPANDED_MAP_ID);
    const g = G.newGame(4, 1, 7); g.cities[13].gold = 123; g.officers[222].weapon = 2;
    assert.equal(g.cities.length, 37); assert.ok(G.save(g, 1)); assert.ok(G.saveQuick(g));
    const old = structuredClone(g), from = g.cities[9], to = g.cities[26], attacker = from.officers.at(-1);
    const war = setupWar(g, { from: 9, to: 26, ids: [attacker], commander: attacker, gold: 0, rice: 100 });
    const field = new Field(g, war, 'att');
    assert.ok(suspend(g, war, field, { side: 'att', start: {}, after: { kind: 'att', faction: from.faction, pts: 0 } }));
    G.setData(modern(), EXPANDED_MAP_ID);
    for (const restored of [G.load(1), G.loadQuick(), G.upgrade(structuredClone(old))]) {
      assert.ok(restored); assert.equal(restored.cities.length, 39); assert.equal(restored.cities[13].gold, 123);
      assert.equal(restored.officers[222].weapon, 2); assert.equal(restored.frontierMap, true);
      assert.equal(restored.battleRulerPassives, undefined);
      assert.ok([37, 38].every((id) => restored.cities[id].faction === G.NONE));
    }
    assert.equal(checkRecord(old), null, '旧导出记录也可以导入');
    const saved = takeSuspend(); assert.ok(saved); assert.equal(saved.g.cities.length, 39);
    assert.deepEqual(Field.restore(saved.g, saved.war, saved.field).units, field.units);
    const damaged = structuredClone(old); damaged.frontierMap = true;
    assert.equal(G.upgrade(damaged), null, '已标记新地图但缺据点的记录不能当作旧记录');
  } finally {
    G.setData(base);
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage;
  }
});
