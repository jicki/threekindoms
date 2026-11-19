import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { Field } from '../src/core/field.js';
import { fight } from '../src/core/warcore.js';
import { battlefieldLayout, battlefieldProfile } from '../src/core/battlefields.js';
import { suspend, takeSuspend } from '../src/core/suspend.js';
import { applyScenario } from '../src/core/scenario.js';
import { loadScenario } from '../src/core/scenario-store.js';
import { SOVEREIGN_SCENARIO_ID } from '../src/core/visuals.js';
import { EXPANDED_MAP_ID, expandMap } from '../src/core/expanded-map.js';

const base = JSON.parse(readFileSync(new URL('../data/game-data.json', import.meta.url)));
const scenario = await loadScenario(SOVEREIGN_SCENARIO_ID, base);
const expanded = expandMap(applyScenario(base, scenario));
function game(seed = 7) { G.setData(expanded, EXPANDED_MAP_ID); const g = G.newGame(4, 1, seed); g.battlefields = 1; return g; }
function war(city, from) {
  return { city, from, attacker: 0, defender: 4, day: 1,
    att: { ids: [40, 41, 42], gold: 100, rice: 1500 }, def: { ids: [43, 44, 45], gold: 100, rice: 1500 } };
}

test('只有君主列传新开局启用场景，全图均有明确主题，旧记录及原版不改变', () => {
  const g = game(); assert.equal(g.battlefields, 1);
  for (const c of expanded.cities) assert.ok(battlefieldProfile(g, c.id)?.label, c.name);
  assert.equal(expanded.cities.filter((c) => battlefieldProfile(g, c.id).kind === 'pass').length, 5);
  const old = structuredClone(g); delete old.battlefields;
  assert.ok(G.upgrade(old)); assert.equal(battlefieldProfile(old, 34), null);
  const invalid = structuredClone(g); invalid.battlefields = 3; assert.equal(G.upgrade(invalid), null);
  G.setData(structuredClone(base), EXPANDED_MAP_ID); assert.equal(G.upgrade(g), null);
  assert.equal(G.newGame(4, 1, 7).battlefields, undefined);
  G.setData(structuredClone(base)); const original = G.newGame(4, 1, 7); assert.equal(original.battlefields, undefined);
});

test('九处新增据点有互不相同的地形，各路线的进攻方向不重复且可抵达城池', () => {
  const g = game(), maps = new Set();
  for (const city of expanded.cities.slice(30)) {
    const entries = new Set(); let cityMap;
    for (const from of city.roads) {
      const layout = battlefieldLayout(expanded, g, city.id, from); assert.ok(layout, `${city.name} ← ${from}`);
      cityMap ??= JSON.stringify(layout.map); assert.equal(JSON.stringify(layout.map), cityMap);
      assert.equal(layout.map.length, 19); assert.ok(layout.map.every((row) => row.length === 32));
      assert.deepEqual(layout.dep.defender[0], [15, 9]); assert.equal(layout.map[9][15], 5);
      const entry = layout.dep.attacker[0].join(','); assert.ok(!entries.has(entry), `${city.name}方向重复`); entries.add(entry);
      const f = new Field(g, war(city.id, from), 'att');
      assert.equal(new Set(f.units.map((u) => `${u.x},${u.y}`)).size, f.units.length);
      const full = war(city.id, from); full.att.ids = Array.from({ length: 10 }, (_, i) => i); full.def.ids = Array.from({ length: 10 }, (_, i) => i + 10);
      const fullField = new Field(g, full, 'att');
      assert.equal(fullField.units.length, 20); assert.equal(new Set(fullField.units.map((u) => `${u.x},${u.y}`)).size, 20, `${city.name}满员布阵不能重叠`);
      // 去掉单位占位以测地形本身；所有军种均能以有限机动力抵达城格。
      const u = f.side('att')[0]; f.units = [u];
      for (const army of ['平', '山', '水']) { f.O(u.id).army = army; f.O(u.id).soldiers = 700;
        assert.ok(f.reach(u, 120).dist.has('15,9'), `${city.name} ${army}军无法到达城池`); }
      const restored = Field.restore(g, war(city.id, from), f.snapshot()); assert.deepEqual(restored.map, f.map);
    }
    assert.ok(!maps.has(cityMap), `${city.name}与其他新增战场重复`); maps.add(cityMap);
  }
});

test('旧战场恢复使用旧地图和原部署，新战场中断后保留同一布局', () => {
  const g = game(), w = war(34, 8), old = structuredClone(g); delete old.battlefields;
  const legacy = new Field(old, w, 'att'), oldSnapshot = legacy.snapshot();
  assert.deepEqual(legacy.map, expanded.maps[34]);
  assert.deepEqual(Field.restore(old, w, oldSnapshot).map, expanded.maps[34]);
  const modern = new Field(g, war(34, 8), 'att');
  assert.notDeepEqual(modern.map, legacy.map);
  const resumed = Field.restore(structuredClone(g), war(34, 8), modern.snapshot());
  assert.deepEqual(resumed.map, modern.map); assert.deepEqual(resumed.dep, modern.dep);
});

test('新旧战斗经真实中断存取后继续各自的地形与布阵', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), store = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: (key) => store.delete(key),
  } });
  try {
    for (const modern of [false, true]) {
      const g = game(); if (!modern) delete g.battlefields;
      const w = war(34, 8), field = new Field(g, w, 'att');
      assert.equal(suspend(g, w, field, { side: 'att', start: {}, after: { kind: 'att' } }), true);
      const rec = takeSuspend(); assert.ok(rec);
      const restored = Field.restore(rec.g, rec.war, rec.field);
      assert.deepEqual(restored.map, field.map); assert.deepEqual(restored.dep, field.dep);
      assert.equal(rec.g.battlefields === 1, modern);
    }
  } finally { if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else delete globalThis.localStorage; }
});

test('电脑在所有新增战场和不同入口能推进并完整结束战斗', () => {
  for (const city of expanded.cities.slice(30)) for (const from of city.roads) {
    const g = game(city.id * 100 + from), w = war(city.id, from);
    for (const id of [...w.att.ids, ...w.def.ids]) Object.assign(g.officers[id], { soldiers: 700, hp: 90, loyalty: 100 });
    const f = new Field(g, w, null); let moves = 0, attacks = 0, turns = 0;
    while (!f.over && turns++ < 65) {
      for (const act of f.aiActions(f.turn)) { if (act.type === 'move') moves++; if (act.type === 'attack') attacks++; }
      f.endTurn();
    }
    assert.ok(f.over, `${city.name}战斗未结束`); assert.ok(moves > 0, `${city.name}没有行动`);
    assert.ok(attacks > 0 || f.over.why === 'castle' || f.over.why === 'commander', `${city.name}从${from}进攻始终未交战`);
  }
});

test('白兵继承所在据点主题和被攻击地形，城中守军使用守城阵型', () => {
  const g = game(), f = new Field(g, war(34, 8), 'att'), a = f.side('att')[0], d = f.side('def')[0];
  const result = f.attack(a, d), battle = result.battle;
  assert.equal(battle.sceneProfile.label, '函谷关道'); assert.equal(battle.terrain, f.terr(d.x, d.y));
  assert.equal(battle.castleDef, true); battle.deploy();
  assert.ok(battle.live.some((u) => u.side === 'd' && u.kind === 'gen'));
  const old = structuredClone(g); delete old.battlefields;
  assert.equal(new Field(old, war(34, 8), 'att').attack(a, d).battle.sceneProfile, null);
});

test('电脑自动战斗按当前战场而非旧模板判断水域君主被动', () => {
  const bonus = (modern) => {
    const g = game(), w = war(32, 12); if (!modern) delete g.battlefields;
    w.attacker = 3; w.att.ids.push(46, 47, 48);
    for (const id of [...w.att.ids, ...w.def.ids]) Object.assign(g.officers[id], { soldiers: 1000, hp: 90 });
    return fight(g, w).autoRulerBonus?.att ?? 0;
  };
  assert.equal(bonus(false), 1, '旧宛城模板有河流');
  assert.equal(bonus(true), 0, '新宛城平原没有河流');
});

test('多入口同条件模拟：兵力优势可取胜且增加总胜场', () => {
  let equalWins = 0, advantageWins = 0;
  for (const city of expanded.cities.slice(30)) {
    let won = 0;
    for (const from of city.roads) for (let seed = 0; seed < 12; seed++) for (const size of [3, 6]) {
      const g = game(seed + 800), w = war(city.id, from);
      if (size === 6) w.att.ids.push(46, 47, 48);
      for (const id of [...w.att.ids, ...w.def.ids]) Object.assign(g.officers[id], { soldiers: 700, hp: 90, loyalty: 100, war: 70, int: 60, level: 3 });
      const f = new Field(g, w, null);
      for (let turn = 0; !f.over && turn < 65; turn++) { for (const action of f.aiActions(f.turn)) void action; f.endTurn(); }
      assert.ok(f.over, `${city.name}战斗应结束`);
      if (f.over.loser === 'def') { if (size === 6) { advantageWins++; won++; } else equalWins++; }
    }
    assert.ok(won > 0, `${city.name}兵力优势时至少应有进攻胜局`);
  }
  assert.ok(advantageWins > equalWins, '增加进攻兵力应提高模拟中的胜场');
});
