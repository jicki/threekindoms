import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { Field, FOREST } from '../src/core/field.js';
import { realChance, roll100 } from '../src/core/origrng.js';
import { applyScenario } from '../src/core/scenario.js';
import { loadScenario } from '../src/core/scenario-store.js';
import { SOVEREIGN_SCENARIO_ID } from '../src/core/visuals.js';
import { suspend, takeSuspend } from '../src/core/suspend.js';

const base = JSON.parse(readFileSync(new URL('../data/game-data.json', import.meta.url)));
const scenario = await loadScenario(SOVEREIGN_SCENARIO_ID, base);
const data = applyScenario(base, scenario);

function fieldFor(g) {
  const war = { city: 1, from: 0, attacker: 7, defender: 4, day: 1,
    att: { ids: g.cities[0].officers.slice(0, 2), gold: 100, rice: 1000 },
    def: { ids: g.cities.find((c) => c.faction === 4 && c.officers.length).officers.slice(0, 1), gold: 100, rice: 1000 } };
  const f = new Field(g, war, 'att'), a = f.side('att')[0], b = f.side('def')[0];
  a.x = 10; a.y = 10; b.x = 11; b.y = 10; f.terr = () => FOREST;
  return { f, a, b, war };
}

function setup() {
  G.setData(data, SOVEREIGN_SCENARIO_ID);
  const g = G.newGame(7, 1, 12); g.enhancedRulerPassives = false;
  return { g, ...fieldFor(g) };
}

test('新版完整数值在高优势时封顶，普通阈值和实际随机表概率保持一致', () => {
  const { g, f, a, b } = setup();
  assert.equal(g.safeStrategyChance, true);
  Object.assign(f.O(a.id), { int: 99, level: 8 }); Object.assign(f.O(b.id), { int: 1, level: 1, soldiers: 1000 });
  assert.equal(f.hitChance(a, b), 95); assert.equal(f.odds(a, 0, b), 95);
  let hits = 0;
  for (let cursor = 0; cursor < 256; cursor++) {
    f.r = (n) => n === 256 ? cursor : 0; f.pool.att = 99;
    Object.assign(f.O(a.id), { int: 99, level: 8, exp: 0 }); f.O(b.id).soldiers = 1000;
    hits += Number(f.cast(a, 0, b, true).hit);
  }
  assert.equal(hits, 244); assert.equal(realChance(95), 244 / 256 * 100);
  Object.assign(f.O(a.id), { int: 90, level: 5 }); Object.assign(f.O(b.id), { int: 70, level: 3 }); b.x = 12;
  assert.equal(f.hitChance(a, b), 39); assert.equal(f.odds(a, 0, b), 44);
  G.setData(base);
});

test('玩家和电脑在各难度与距离下，智力或等级优势增加不会降低成功率', () => {
  const { g, f, a, b } = setup();
  for (const side of ['att', 'def']) for (const difficulty of [0, 1, 2]) for (const distance of [1, 2, 3, 4, 5]) {
    g.level = difficulty; const caster = side === 'att' ? a : b, target = side === 'att' ? b : a;
    caster.x = 10; caster.y = 10; target.x = 10 + distance; target.y = 10;
    Object.assign(f.O(target.id), { int: 1, level: 1 });
    for (let level = 1; level <= 8; level++) {
      let last = -1; f.O(caster.id).level = level;
      for (let intelligence = 1; intelligence <= 99; intelligence++) {
        f.O(caster.id).int = intelligence; const p = f.hitChance(caster, target);
        assert.ok(p >= last && p <= 95, `${side}/${difficulty}/${distance}/${level}/${intelligence}: ${last} → ${p}`);
        last = p;
      }
    }
    f.O(caster.id).int = 99; let last = -1;
    for (let level = 1; level <= 8; level++) {
      f.O(caster.id).level = level; const p = f.hitChance(caster, target);
      assert.ok(p >= last, `${side}/${difficulty}/${distance}: 等级 ${level} ${last} → ${p}`); last = p;
    }
  }
  G.setData(base);
});

test('127 至 128 的溢出边界之外，新旧规则的普通判定保持一致', () => {
  const { g, f, a, b } = setup();
  Object.assign(f.O(b.id), { int: 1, level: 1 });
  for (let level = 1; level <= 8; level++) for (let intelligence = 1; intelligence <= 99; intelligence++) {
    Object.assign(f.O(a.id), { int: intelligence, level });
    const raw = 10 + (intelligence - 1) + 2 * (level - 1) + 10;
    g.safeStrategyChance = true; const fixed = f.hitChance(a, b);
    g.safeStrategyChance = false; const prior = f.hitChance(a, b);
    if (raw < 128) assert.equal(fixed, prior, `阈值 ${raw}`);
    else { assert.equal(fixed, 95, `修正阈值 ${raw}`); assert.equal(prior, 5, `旧阈值 ${raw}`); }
  }
  G.setData(base);
});

test('君主加成仍按实际百分点限制，笼络忠诚上限与新版专属计策保持原规则', () => {
  const { g, f, a, b } = setup();
  g.enhancedRulerPassives = true; g.battleRulerPassives = true; g.factions[7].ruler = 131;
  Object.assign(f.O(a.id), { int: 80, virtue: 80, level: 3 }); Object.assign(f.O(b.id), { int: 80, level: 3, loyalty: 50 });
  const bonus = f.combatPassive('att')?.strategy; assert.equal(bonus, 3);
  const withBonus = f.hitChance(a, b); g.enhancedRulerPassives = false;
  const withoutBonus = f.hitChance(a, b);
  assert.ok(realChance(withBonus) > realChance(withoutBonus));
  assert.ok(realChance(withBonus) - realChance(withoutBonus) <= 3);
  const customId = data.customSkills[0].id, lure = f.lureChance(a, b), custom = f.odds(a, customId, b);
  g.safeStrategyChance = false;
  assert.equal(f.lureChance(a, b), lure); assert.equal(f.odds(a, customId, b), custom);
  f.O(b.id).loyalty = 71; assert.equal(f.lureChance(a, b), 0);
  G.setData(base);
});

test('新版专属计策与电脑自动战场都使用修正后的成功率', () => {
  const { g, f, a, b } = setup();
  Object.assign(f.O(a.id), { int: 99, level: 8, exp: 0 }); Object.assign(f.O(b.id), { int: 1, level: 1, soldiers: 1000 });
  f.human = null;
  assert.equal(f.hitChance(a, b), 95);
  const cursor = Array.from({ length: 256 }, (_, n) => n).find((n) => roll100(() => n) === 50);
  const skill = data.customSkills[0].id;
  f.r = (n) => n === 256 ? cursor : 0; f.pool.att = 99;
  assert.equal(f.cast(a, skill, b, true).hit, true, '新版同一随机值应命中');
  const old = structuredClone(g); delete old.safeStrategyChance;
  const prior = fieldFor(old); prior.f.human = null; prior.f.r = (n) => n === 256 ? cursor : 0; prior.f.pool.att = 99;
  assert.equal(prior.f.cast(prior.a, skill, prior.b, true).hit, false, '旧版仍按原规则失败');
  G.setData(base);
});

test('原版和缺少新标记的旧新版存档继续使用原来的 8 位判定', () => {
  const { g, f, a, b } = setup();
  Object.assign(f.O(a.id), { int: 99, level: 8 }); Object.assign(f.O(b.id), { int: 1, level: 1 });
  const legacy = structuredClone(g); delete legacy.safeStrategyChance;
  assert.equal(G.upgrade(legacy).safeStrategyChance, undefined);
  const old = fieldFor(legacy); old.a.x = 10; old.b.x = 11; old.a.y = old.b.y = 10;
  assert.equal(old.f.hitChance(old.a, old.b), 5);
  for (const value of ['true', 1, null, {}]) { const bad = structuredClone(g); bad.safeStrategyChance = value; assert.equal(G.upgrade(bad), null); }
  G.setData(base); const original = G.newGame(4, 1, 1);
  assert.equal(original.safeStrategyChance, undefined);
  const from = original.cities[original.factions[4].city], enemy = original.cities.find((c) => c.faction !== 4 && c.faction !== G.NONE && c.officers.length);
  const war = { city: 1, from: 0, attacker: 4, defender: enemy.faction, att: { ids: [from.officers[0]], gold: 0, rice: 100 }, def: { ids: [enemy.officers[0]], gold: 0, rice: 100 } };
  const field = new Field(original, war, 'att'), attacker = field.side('att')[0], defender = field.side('def')[0];
  attacker.x = 10; attacker.y = 10; defender.x = 11; defender.y = 10;
  Object.assign(field.O(attacker.id), { int: 99, level: 8 }); Object.assign(field.O(defender.id), { int: 1, level: 1 });
  assert.equal(field.hitChance(attacker, defender), 5);
});

test('新版标记随普通存档及战场中断恢复，旧记录不被自动启用', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), entries = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, String(value)),
    removeItem: (key) => entries.delete(key), key: (i) => [...entries.keys()][i] ?? null, get length() { return entries.size; },
  } });
  try {
    const { g, f, a, b, war } = setup();
    Object.assign(g.officers[a.id], { int: 99, level: 8 }); Object.assign(g.officers[b.id], { int: 1, level: 1 });
    assert.ok(G.save(g, 1)); const loaded = G.load(1); assert.equal(loaded.safeStrategyChance, true);
    const loadedField = fieldFor(loaded); assert.equal(loadedField.f.hitChance(loadedField.a, loadedField.b), 95);
    assert.ok(suspend(g, war, f, { side: 'att', start: {}, after: { kind: 'att', faction: 7, pts: 0 } }));
    const saved = takeSuspend(); assert.equal(saved.g.safeStrategyChance, true);
    const restored = Field.restore(saved.g, saved.war, saved.field);
    assert.equal(restored.hitChance(restored.side('att')[0], restored.side('def')[0]), 95);
    const old = structuredClone(g); delete old.safeStrategyChance;
    assert.ok(G.save(old, 2)); const oldLoaded = G.load(2); assert.equal(oldLoaded.safeStrategyChance, undefined);
    const prior = fieldFor(oldLoaded); assert.equal(prior.f.hitChance(prior.a, prior.b), 5);
    assert.ok(suspend(oldLoaded, prior.war, prior.f, { side: 'att', start: {}, after: { kind: 'att', faction: 7, pts: 0 } }));
    const oldSaved = takeSuspend(); assert.equal(oldSaved.g.safeStrategyChance, undefined);
    const oldRestored = Field.restore(oldSaved.g, oldSaved.war, oldSaved.field);
    assert.equal(oldRestored.hitChance(oldRestored.side('att')[0], oldRestored.side('def')[0]), 5);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else delete globalThis.localStorage;
    G.setData(base);
  }
});
