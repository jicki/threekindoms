import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { applyScenario } from '../src/core/scenario.js';
import { loadScenario } from '../src/core/scenario-store.js';
import { EXPANDED_MAP_ID, expandMap } from '../src/core/expanded-map.js';
import { Tactical } from '../src/core/tactical.js';
import { officerSpecialty } from '../src/core/troop-specialties.js';
import { suspend, takeSuspend } from '../src/core/suspend.js';
import { Field } from '../src/core/field.js';

const base = JSON.parse(readFileSync(new URL('../data/game-data.json', import.meta.url)));
const scenario = await loadScenario('builtin-sovereigns', base);
const data = expandMap(applyScenario(base, scenario));
const stats = {
  '孙尚香': [88, 89, 76, 80], '甄宓': [78, 62, 91, 86], '貂蝉': [81, 70, 89, 82], '蔡琰': [78, 42, 94, 85],
  '王异': [86, 85, 86, 90], '辛宪英': [76, 40, 94, 90], '黄夫人': [78, 42, 93, 90], '祝融夫人': [88, 88, 72, 78],
};
const fields = ['hp', 'war', 'int', 'virtue'];
const values = (o) => fields.map((key) => o[key]);
const idOf = (name) => data.officers.find((o) => o.name === name).id;
const setup = () => { G.setData(data, EXPANDED_MAP_ID); return G.newGame(4, 1, 13); };

test('新局八名女将分别提升且不改变登场、装备、技能及其他武将', () => {
  const original = JSON.stringify(data), g = setup();
  for (const [name, want] of Object.entries(stats)) {
    const id = idOf(name), current = g.officers[id], source = data.officers[id];
    assert.deepEqual(values(current), want, name);
    for (const [i, key] of fields.entries()) assert.ok(want[i] > source[key], `${name} ${key} 应有提升`);
    assert.equal(G.maxHp(current), want[0], name);
    for (const key of ['weapon', 'armor', 'level', 'army', 'loyalty', 'soldiers']) assert.equal(current[key], source[key], `${name} ${key}`);
    assert.equal(current.status, G.UNAPPEARED, `${name} 的登场状态`);
    assert.ok(G.debutInfo(id).kind === 'search', `${name} 的登场方式`);
    assert.ok(want.every((value) => value > 0 && value <= 95), `${name} 属性应保持上限`);
  }
  for (const source of data.officers.filter((o) => !Object.hasOwn(stats, o.name))) {
    assert.deepEqual(values(g.officers[source.id]), values(source), `${source.name} 不受本次调整影响`);
  }
  assert.equal(JSON.stringify(data), original, '静态剧本及技能关系不被修改');
  assert.ok(g.officers[idOf('孙尚香')].war < g.officers[38].war, '孙尚香武力低于关羽');
  assert.ok(g.officers[idOf('祝融夫人')].war < g.officers[75].war, '祝融武力低于黄忠');
  assert.ok(g.officers[idOf('蔡琰')].int < g.officers[109].int, '蔡琰智力低于诸葛亮');
  G.setData(base);
});

test('原版、旧君主列传和管理员自定义版本的新局不套用内置调整', () => {
  G.setData(base); const original = G.newGame(4, 1, 13);
  assert.deepEqual(values(original.officers[38]), values(base.officers[38]));
  for (const scenarioId of ['builtin-sovereigns', 'v-0123456789abcdef0123456789abcdef']) {
    G.setData(data, scenarioId); const g = G.newGame(4, 1, 13);
    for (const name of Object.keys(stats)) {
      const id = idOf(name); assert.deepEqual(values(g.officers[id]), values(data.officers[id]), `${scenarioId} ${name}`);
      assert.equal(g.officers[id].maxHp, undefined);
    }
  }
  G.setData(base);
});

test('各君主与各难度的新局均使用同一组女将属性', () => {
  G.setData(data, EXPANDED_MAP_ID);
  for (const faction of data.factions) for (const difficulty of [0, 1, 2]) {
    const g = G.newGame(faction.id, difficulty, 15);
    for (const [name, want] of Object.entries(stats)) assert.deepEqual(values(g.officers[idOf(name)]), want, `${faction.name}/${difficulty}/${name}`);
  }
  G.setData(base);
});

test('普通存档与战场中断恢复各自保留新旧女将能力和治疗上限', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), entries = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, String(value)),
    removeItem: (key) => entries.delete(key), key: (i) => [...entries.keys()][i] ?? null, get length() { return entries.size; },
  } });
  try {
    const current = setup(), old = structuredClone(current), id = idOf('孙尚香'), source = data.officers[id];
    for (const name of Object.keys(stats)) {
      const officerId = idOf(name), original = data.officers[officerId];
      Object.assign(old.officers[officerId], Object.fromEntries(fields.map((key) => [key, original[key]]))); delete old.officers[officerId].maxHp;
    }
    assert.ok(G.save(current, 1)); assert.ok(G.save(old, 2));
    const restored = G.load(1), oldRestored = G.load(2);
    for (const [name, want] of Object.entries(stats)) {
      const officerId = idOf(name), original = data.officers[officerId];
      assert.deepEqual(values(restored.officers[officerId]), want, name); assert.equal(G.maxHp(restored.officers[officerId]), want[0]);
      assert.deepEqual(values(oldRestored.officers[officerId]), values(original), name); assert.equal(G.maxHp(oldRestored.officers[officerId]), original.hp);
    }
    assert.deepEqual(values(restored.officers[id]), stats['孙尚香']); assert.equal(G.maxHp(restored.officers[id]), 88);
    assert.deepEqual(values(oldRestored.officers[id]), values(source)); assert.equal(G.maxHp(oldRestored.officers[id]), source.hp);
    const hospital = data.cities.find((city) => city.facilities.hospital).id;
    for (const [g, cap] of [[restored, 88], [oldRestored, source.hp]]) {
      g.cities[hospital].gold = 1000; g.officers[id].hp = cap - 1;
      assert.equal(G.heal(g, hospital, id).ok, true); assert.equal(g.officers[id].hp, cap);
    }
    for (const [g, cap] of [[restored, 88], [oldRestored, source.hp]]) {
      const foe = g.cities.find((city) => city.faction !== 4 && city.faction !== G.NONE && city.officers.length).officers[0];
      const war = { city: 1, from: 0, attacker: 4, defender: 0, att: { ids: [id], gold: 0, rice: 100 }, def: { ids: [foe], gold: 0, rice: 100 } };
      const field = new Field(g, war, 'att');
      assert.ok(suspend(g, war, field, { side: 'att', start: {}, after: { kind: 'att', faction: 4, pts: 0 } }));
      const saved = takeSuspend(), resumed = Field.restore(saved.g, saved.war, saved.field);
      assert.equal(resumed.O(id).hp, cap); assert.equal(G.maxHp(resumed.O(id)), cap);
    }
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else delete globalThis.localStorage;
    G.setData(base);
  }
});

test('女将保持既有兵种、装备和单挑技能，白兵数值使用新属性', () => {
  const g = setup(), sun = idOf('孙尚香'), wang = idOf('王异'), zhurong = idOf('祝融夫人');
  for (const id of [sun, wang, zhurong]) g.officers[id].soldiers = 1000;
  assert.equal(officerSpecialty(data, g, sun)?.kind, 'arc');
  assert.equal(officerSpecialty(data, g, wang)?.kind, 'inf');
  assert.equal(officerSpecialty(data, g, zhurong)?.kind, 'arc');
  assert.equal(data.officers[sun].duelSkill, 'gongyao'); assert.equal(data.officers[wang].duelSkill, 'shoucheng');
  assert.equal(data.officers[zhurong].duelSkill, 'zhurong');
  const battle = new Tactical(g, sun, 38, 2, () => 0, { human: 'a' }); battle.deploy();
  assert.equal(battle.side.a.o.war, 89); assert.equal(battle.gen('a').hp, 88);
  assert.ok(battle.units.some((u) => u.side === 'a' && u.special === 'unit-archer-bow'));
  assert.ok(battle.side.a.F < new Tactical(g, 38, sun, 2, () => 0, { human: 'a' }).side.a.F, '关羽白兵战力仍高于孙尚香');
  G.setData(base);
});
