import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { applyScenario, validateScenario } from '../src/core/scenario.js';
import { loadScenario } from '../src/core/scenario-store.js';
import { SOVEREIGN_SCENARIO_ID } from '../src/core/visuals.js';
import { Field } from '../src/core/field.js';
import { realChance } from '../src/core/origrng.js';
import { fight } from '../src/core/warcore.js';

const base = JSON.parse(readFileSync(new URL('../data/game-data.json', import.meta.url)));
const scenario = await loadScenario(SOVEREIGN_SCENARIO_ID, base);
const use = () => G.setData(applyScenario(base, scenario), SOVEREIGN_SCENARIO_ID);
const fieldFor = (g) => {
  const own = g.cities[0].officers.filter((id) => id !== g.factions[7].ruler).slice(0, 2);
  const enemy = g.cities.find((c) => c.faction === 4 && c.officers.length).officers.slice(0, 2);
  const war = { city: 1, from: 0, attacker: 7, defender: 4, day: 1,
    att: { ids: own, gold: 100, rice: 1000 }, def: { ids: enemy, gold: 100, rice: 1000 } };
  return new Field(g, war, 'att');
};

test('增强规则只给新开局启用，旧记录和原版保留原有被动', () => {
  use();
  try {
    const fresh = G.newGame(7, 1, 10), old = structuredClone(fresh);
    assert.equal(fresh.enhancedRulerPassives, true);
    delete old.enhancedRulerPassives;
    const restored = G.upgrade(JSON.parse(JSON.stringify(old)));
    assert.ok(restored); assert.equal(restored.enhancedRulerPassives, undefined);
    assert.deepEqual(G.rulerPassive(restored, 7).effects, [{ kind: 'gold', value: 11 }, { kind: 'reserve', value: 9 }]);
    assert.equal(G.rulerPassive(restored, 7).combat, undefined);
    restored.enhancedRulerPassives = true;
    assert.deepEqual(G.rulerPassive(restored, 7).effects, [{ kind: 'gold', value: 44 }, { kind: 'reserve', value: 45 }]);
    restored.enhancedRulerPassives = 'true'; assert.equal(G.upgrade(restored), null);
    G.setData(base); const original = G.newGame(4, 1, 1);
    assert.equal(original.enhancedRulerPassives, undefined); assert.equal(G.rulerPassive(original, 4), null);
  } finally { G.setData(base); }
});

test('每个君主的增强效果受约束，双方计策实际概率增幅不超过配置', () => {
  use();
  try {
    const g = G.newGame(7, 1, 1), field = fieldFor(g);
    for (const faction of g.factions) {
      const p = G.rulerPassive(g, faction.id);
      assert.ok(p.combat.war >= 1 && p.combat.war <= 4);
      assert.ok(p.combat.int >= 0 && p.combat.int <= 2);
      assert.ok(p.combat.strategy >= 1 && p.combat.strategy <= 3);
      assert.equal(p.combat.mobility, 1);
      assert.ok([0, 1].includes(p.combat.tacticRounds));
    }
    const a = field.side('att')[0], d = field.side('def')[0];
    Object.assign(a, { x: 5, y: 5 }); Object.assign(d, { x: 5, y: 6 });
    let increases = 0;
    for (const caster of [a, d]) for (let intelligence = 10; intelligence <= 99; intelligence++) {
      const target = caster === a ? d : a;
      g.officers[caster.id].int = intelligence; g.officers[target.id].int = 50;
      g.enhancedRulerPassives = false; const old = realChance(field.hitChance(caster, target));
      g.enhancedRulerPassives = true; const next = realChance(field.hitChance(caster, target));
      assert.ok(next >= old && next - old <= field.combatPassive(caster.side).strategy + 1e-9);
      if (next > old) increases++;
    }
    assert.ok(increases > 0, '计策增益应在可表示的随机阈值处生效');
  } finally { G.setData(base); }
});

test('战术持续回合仅增强己方增益，双方及旧规则均正确', () => {
  use();
  try {
    const g = G.newGame(7, 1, 1), field = fieldFor(g), a = field.side('att')[0], d = field.side('def')[0];
    const battle = field.attack(a, d).pending;
    for (const side of ['a', 'd']) {
      const S = battle.side[side], bonus = field.combatPassive(side === 'a' ? 'att' : 'def').tacticRounds;
      S.tp = 100;
      for (const [id, rounds] of [['xbow', 3], ['fire', 3], ['morale', 4]]) {
        S.fx = {}; S.usedThisRound = false;
        assert.equal(battle.tactic(side, id).ok, true);
        assert.equal(S.fx[id], rounds + bonus, `${side}:${id}`);
      }
      S.fx = {}; S.usedThisRound = false;
      battle.r = () => 1;
      assert.equal(battle.tactic(side, 'bind').ok, true);
      assert.equal(S.fx.bind, 4, '控制敌方的咒缚不得延长');
    }
    g.enhancedRulerPassives = false;
    const old = field.attack(a, d).pending;
    for (const side of ['a', 'd']) {
      old.side[side].tp = 100;
      assert.equal(old.tactic(side, 'xbow').ok, true);
      assert.equal(old.side[side].fx.xbow, 3);
    }
  } finally { G.setData(base); }
});

test('战场恢复、威胁范围及白兵使用同一增益，且不永久修改武将', () => {
  use();
  try {
    const g = G.newGame(7, 1, 1), field = fieldFor(g), a = field.side('att')[0], d = field.side('def')[0];
    const before = structuredClone(g.officers[a.id]);
    g.enhancedRulerPassives = false; field.pool.att = field.pool.def = 0; field.recover();
    const oldPool = { ...field.pool }, oldReach = field.reach(a).dist;
    g.enhancedRulerPassives = true; field.pool.att = field.pool.def = 0; field.recover();
    assert.equal(field.pool.att, oldPool.att + 1); assert.equal(field.pool.def, oldPool.def + 1);
    const nextReach = field.reach(a).dist;
    for (const cell of oldReach.keys()) assert.ok(nextReach.has(cell));
    assert.ok(nextReach.size >= oldReach.size);
    const passive = field.combatPassive('att'), result = field.attack(a, d), battle = result.pending;
    assert.ok(battle); assert.equal(battle.side.a.o.war, Math.min(99, before.war + passive.war));
    assert.equal(battle.side.a.o.int, Math.min(99, before.int + passive.int));
    assert.deepEqual(g.officers[a.id], before, '战斗属性不能写回基础武将');
    const ruler = g.factions[7].ruler;
    field.units.push({ id: ruler, side: 'att', gone: true });
    assert.equal(field.combatPassive('att'), null, '战场中君主已被击败时不再加成');
    g.factions[7].ruler = a.id;
    assert.ok(G.rulerPassive(g, 7).name.startsWith(G.name(a.id)));
    assert.ok(field.combatPassive('att'), '继位者应立即提供自己的被动');
  } finally { G.setData(base); }
});

test('白兵中升级后，战斗属性仍跟随基础属性并叠加临时被动', () => {
  use();
  try {
    const g = G.newGame(7, 1, 1), field = fieldFor(g), a = field.side('att')[0], d = field.side('def')[0];
    const officer = g.officers[a.id], startLevel = officer.level, bonus = field.combatPassive('att');
    officer.exp = G.data().rules.level_exp[startLevel - 1] - 1;
    const battle = field.attack(a, d).pending; battle.deploy();
    const unit = battle.units.find((u) => u.side === 'a' && u.kind !== 'gen');
    const target = battle.units.find((u) => u.side === 'd' && u.kind !== 'gen');
    assert.ok(unit && target); unit.hp = target.hp = 100;
    battle.attack(unit, target, false);
    assert.equal(officer.level, startLevel + 1, '战斗获得经验应触发升级');
    assert.equal(battle.side.a.o.level, officer.level, '白兵和单挑应看到升级后的等级');
    assert.equal(battle.side.a.o.war, Math.max(officer.war, Math.min(99, officer.war + bonus.war)));
    assert.equal(battle.side.a.o.int, Math.max(officer.int, Math.min(99, officer.int + bonus.int)));
  } finally { G.setData(base); }
});

test('电脑自动战争也计算君主战斗武力，不更改原有属性', () => {
  use();
  try {
    const template = G.newGame(7, 1, 1), attackers = template.cities[0].officers.slice(0, 3);
    const defenders = template.cities.find((c) => c.faction === 4 && c.officers.length >= 3).officers.slice(0, 3);
    template.factions[4].ruler = null;
    const war = { attacker: 7, defender: 4, day: 1,
      att: { ids: attackers, gold: 0, rice: 9999 }, def: { ids: defenders, gold: 0, rice: 9999 } };
    let changed = false;
    for (let seed = 1; seed <= 2000 && !changed; seed++) {
      const old = structuredClone(template), enhanced = structuredClone(template);
      old.seed = enhanced.seed = seed; old.enhancedRulerPassives = false;
      const before = attackers.map((id) => enhanced.officers[id].war);
      const a = fight(old, structuredClone(war)), b = fight(enhanced, structuredClone(war));
      assert.deepEqual(attackers.map((id) => enhanced.officers[id].war), before);
      if (a.attWins !== b.attWins) { assert.equal(b.attWins, true); changed = true; }
    }
    assert.ok(changed, '至少一个固定随机种子应体现自动战斗增益');
  } finally { G.setData(base); }
});

test('版本校验允许缺省旧规则，拒绝无基础被动的增强规则', () => {
  const legacy = structuredClone(scenario); delete legacy.enhancedRulerPassives;
  assert.equal(validateScenario(legacy, base), true);
  for (const value of [null, 1, 'true', [], {}]) {
    const bad = structuredClone(scenario); bad.enhancedRulerPassives = value;
    assert.throws(() => validateScenario(bad, base));
  }
  const bad = structuredClone(scenario); delete bad.rulerPassives;
  assert.throws(() => validateScenario(bad, base), /需要先启用/);
});
