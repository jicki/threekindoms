import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { aiTurn, housekeeping } from '../src/core/ai.js';
import { Field, PLAIN } from '../src/core/field.js';
import { realChance } from '../src/core/origrng.js';
import { relationDisposition, recruitDisposition, recruitThreshold, recruitLoyaltyWithRelation } from '../src/core/relationships.js';
import { applyScenario, validateScenario } from '../src/core/scenario.js';
import { loadScenario } from '../src/core/scenario-store.js';
import { SOVEREIGN_SCENARIO_ID } from '../src/core/visuals.js';
import { autoSkillBonus, fight, setupWar, autoBattle } from '../src/core/warcore.js';

const base = JSON.parse(readFileSync(new URL('../data/game-data.json', import.meta.url)));
const scenario = await loadScenario(SOVEREIGN_SCENARIO_ID, base);
function setup() {
  const data = applyScenario(base, scenario); data.relationships = [];
  G.setData(data, SOVEREIGN_SCENARIO_ID);
  return { data, g: G.newGame(7, 1, 1) };
}
function fieldFor(g) {
  const att = g.cities[0].officers.filter((id) => id !== g.factions[7].ruler).slice(0, 2);
  const def = g.cities.find((city) => city.faction === 4 && city.officers.length >= 2).officers.slice(0, 2);
  return new Field(g, { city: 1, from: 0, attacker: 7, defender: 4, day: 1,
    att: { ids: att, gold: 100, rice: 1000 }, def: { ids: def, gold: 100, rice: 1000 } }, 'att');
}

test('新开局保存两项设置，旧记录、原版和旧版本保留原规则', () => {
  const { g } = setup();
  try {
    assert.equal(g.relationshipEffects, true); assert.equal(g.autoBattleSkills, true);
    const restored = G.upgrade(JSON.parse(JSON.stringify(g))); assert.equal(restored.relationshipEffects, true); assert.equal(restored.autoBattleSkills, true);
    const old = structuredClone(g); delete old.relationshipEffects; delete old.autoBattleSkills;
    assert.ok(G.upgrade(old)); assert.equal(old.relationshipEffects, undefined); assert.equal(old.autoBattleSkills, undefined);
    for (const key of ['relationshipEffects', 'autoBattleSkills']) {
      const invalid = structuredClone(g); invalid[key] = 'true'; assert.equal(G.upgrade(invalid), null);
      const invalidScenario = structuredClone(scenario); invalidScenario[key] = 1;
      assert.throws(() => validateScenario(invalidScenario, base));
      const legacy = structuredClone(scenario); delete legacy[key]; assert.doesNotThrow(() => validateScenario(legacy, base));
    }
    G.setData(base); const original = G.newGame(4, 1, 1);
    assert.equal(original.relationshipEffects, undefined); assert.equal(original.autoBattleSkills, undefined);
  } finally { G.setData(base); }
});

test('关系双向生效、不叠加，敌对与亲近冲突抵消，自定义关系不猜测含义', () => {
  const { data, g } = setup(), ruler = g.factions[7].ruler, target = 38;
  try {
    data.relationships = [{ from: target, to: ruler, kind: '父女' }, { from: ruler, to: target, kind: '朋友' }];
    assert.equal(relationDisposition(data, g, ruler, target), 1);
    assert.equal(relationDisposition(data, g, target, ruler), 1);
    assert.equal(recruitLoyaltyWithRelation(data, g, 7, target, 60), 65);
    assert.equal(recruitLoyaltyWithRelation(data, g, 7, target, 95), 95);
    data.relationships.push({ from: ruler, to: target, kind: '宿敌' });
    assert.equal(relationDisposition(data, g, ruler, target), 0);
    assert.equal(recruitLoyaltyWithRelation(data, g, 7, target, 60), 60);
    data.relationships = [{ from: ruler, to: target, kind: '同乡' }];
    assert.equal(relationDisposition(data, g, ruler, target), 0);
    data.relationships = [{ from: ruler, to: target, kind: '对手' }];
    assert.equal(recruitLoyaltyWithRelation(data, g, 7, target, 60), 55);
    g.relationshipEffects = false; assert.equal(relationDisposition(data, g, ruler, target), 0);
  } finally { G.setData(base); }
});

test('有关系的实际招募概率增减不超过五个百分点，不突破禁止条件', () => {
  const { data, g } = setup(), target = 38, ruler = g.factions[7].ruler, opponent = g.factions[4].ruler;
  try {
    for (const [kind, sign] of [['朋友', 1], ['宿敌', -1]]) {
      data.relationships = [{ from: ruler, to: target, kind }];
      for (let p = 1; p < 100; p++) {
        const next = recruitThreshold(data, g, 7, target, p, 4), diff = realChance(next) - realChance(p);
        assert.ok(sign * diff >= 0 && Math.abs(diff) <= 5 + 1e-9, `${kind}: ${p} => ${next}, ${diff}`);
      }
      assert.equal(recruitThreshold(data, g, 7, target, 0, 4), 0);
      assert.equal(recruitThreshold(data, g, 7, target, 105, 4), 105);
    }
    data.relationships = [{ from: ruler, to: target, kind: '朋友' }, { from: opponent, to: target, kind: '朋友' }];
    assert.equal(recruitDisposition(data, g, 7, target, 4), 0);
    assert.equal(recruitThreshold(data, g, 7, target, 50, 4, false), 50);
    data.relationships = [{ from: opponent, to: target, kind: '朋友' }];
    assert.equal(recruitThreshold(data, g, 7, target, 50, 4, false), 45);
  } finally { G.setData(base); }
});

test('寻访与出价入仕实际应用关系，旧记录不改变结果', () => {
  const { data, g } = setup(), ruler = g.factions[7].ruler;
  const candidate = g.officers.find((o) => o.status === G.UNAPPEARED).id;
  try {
    data.relationships = [{ from: ruler, to: candidate, kind: '朋友' }];
    data.officers[candidate].year = 189; data.search_table['0'] = [candidate];
    data.rules.search_preference = { 4: [candidate] };
    for (const key of Object.keys(data.search_outcomes)) data.search_outcomes[key] = Array(8).fill(5);
    let changed = false;
    for (let seed = 1; seed <= 2000 && !changed; seed++) {
      const old = structuredClone(g), next = structuredClone(g); old.seed = next.seed = seed; old.relationshipEffects = false;
      const a = G.search(old, 0, g.cities[0].officers[0]), b = G.search(next, 0, g.cities[0].officers[0]);
      if (b.joined === candidate && a.refused === candidate) { assert.match(b.msg, /旧交情/); changed = true; }
    }
    assert.ok(changed, '固定种子应能体现寻访的关系加成');
    const old = structuredClone(g), next = structuredClone(g); old.relationshipEffects = false;
    old.officers[candidate].status = next.officers[candidate].status = G.RONIN;
    old.officers[candidate].loyalty = next.officers[candidate].loyalty = 40;
    assert.equal(G.hire(old, 0, candidate, 10).joined, candidate);
    assert.equal(G.hire(next, 0, candidate, 10).joined, candidate);
    assert.equal(next.officers[candidate].loyalty, old.officers[candidate].loyalty + 5);
  } finally { G.setData(base); }
});

test('电脑实际寻访同样使用关系和忠诚加成', () => {
  const { data, g } = setup(), ruler = g.factions[7].ruler;
  const candidate = g.officers.find((o) => o.status === G.UNAPPEARED).id;
  try {
    data.relationships = [{ from: ruler, to: candidate, kind: '朋友' }];
    data.officers[candidate].year = 189; data.search_table['0'] = [candidate];
    data.rules.search_preference['7'] = [];
    const run = (enabled) => {
      const game = structuredClone(g); game.relationshipEffects = enabled; let n = 0;
      const r = (limit) => limit === 100 ? [0, 12, 99][n++] ?? 99 : 0;
      housekeeping(game, 7, r, () => true); return game;
    };
    const old = run(false), next = run(true);
    assert.equal(old.officers[candidate].status, G.UNAPPEARED);
    assert.equal(next.officers[candidate].status, G.SERVING);
    assert.equal(next.officers[candidate].loyalty, Math.min(90, g.officers[candidate].loyalty + 5));
  } finally { G.setData(base); }
});

test('内政诱纳按关系调整成功率和入仕忠诚，保持无资格时的硬限制', () => {
  const { data, g } = setup(), ruler = g.factions[7].ruler, actor = g.cities[0].officers.find((id) => id !== ruler);
  const city = g.cities.find((c) => c.faction === 4 && c.officers.some((id) => id !== g.factions[4].ruler));
  const target = city.officers.find((id) => id !== g.factions[4].ruler);
  try {
    data.relationships = [{ from: ruler, to: target, kind: '朋友' }];
    Object.assign(g.officers[actor], { int: 90, virtue: 90 }); g.officers[target].loyalty = 60;
    let changed = false;
    for (let seed = 1; seed <= 2000 && !changed; seed++) {
      const old = structuredClone(g), next = structuredClone(g); old.seed = next.seed = seed; old.relationshipEffects = false;
      const a = G.lure(old, 0, actor, target), b = G.lure(next, 0, actor, target);
      if (a.failed && b.joined === target) {
        const baseline = G.recruitLoyalty(g.officers[ruler].virtue, 60);
        assert.equal(next.officers[target].loyalty, Math.min(90, baseline + 5)); changed = true;
      }
    }
    assert.ok(changed, '关系应能在部分随机种子下影响诱纳');
    g.officers[target].loyalty = 76;
    for (let seed = 1; seed <= 30; seed++) { const next = structuredClone(g); next.seed = seed; assert.equal(G.lure(next, 0, actor, target).failed, true); }
  } finally { G.setData(base); }
});

test('电脑回合实际诱纳使用关系加成和新忠诚', async () => {
  const { data, g } = setup(), ruler = g.factions[7].ruler;
  const enemyCity = g.cities.find((c) => c.faction === 4 && c.officers.some((id) => id !== g.factions[4].ruler));
  const target = enemyCity.officers.find((id) => id !== g.factions[4].ruler);
  try {
    data.relationships = [{ from: ruler, to: target, kind: '朋友' }];
    for (const row of data.rules.ai_dispatch) row.weights = [0, 16, 0];
    for (const key of Object.keys(data.search_table)) data.search_table[key] = [];
    for (const c of g.cities) if (c.faction !== 7 && c.faction !== G.NONE) for (const id of c.officers) if (!G.isRuler(g, id)) g.officers[id].loyalty = 90;
    for (const id of g.cities[0].officers) g.officers[id].level = 1;
    Object.assign(g.officers[target], { loyalty: 40, virtue: 40, level: 1 });
    let seed = 0;
    for (let candidate = 1; candidate <= 20000 && !seed; candidate++) {
      const probe = { seed: candidate }, r = G.rng(probe);
      for (let i = 0; i < 4; i++) r(100); // 一城两次内政前置，各检查寻访和在野人才
      r(16); if (r(50) >= 10) continue;
      const action = r(90), roll = r(100);
      if (action >= 30 && action < 60 && roll >= 22 && roll < 27) seed = candidate;
    }
    assert.ok(seed, '应有可区分关系影响的固定随机种子');
    const run = async (enabled) => {
      const game = structuredClone(g), events = []; game.relationshipEffects = enabled; game.seed = seed;
      await aiTurn(game, 7, { event: async (event) => events.push(event), war: async () => {}, allianceOffer: async () => false });
      return { game, events };
    };
    const old = await run(false), next = await run(true);
    assert.equal(old.events.some((event) => event.type === 'aiLure' && event.id === target), false);
    assert.equal(next.events.some((event) => event.type === 'aiLure' && event.id === target), true);
    assert.equal(next.game.officers[target].loyalty, Math.min(90, G.recruitLoyalty(g.officers[ruler].virtue, 40) + 5));
  } finally { G.setData(base); }
});

test('新规则避免电脑诱纳负概率回绕，旧记录仍按原版计算', async () => {
  const { data, g } = setup();
  const enemyCity = g.cities.find((c) => c.faction === 4 && c.officers.some((id) => id !== g.factions[4].ruler));
  const target = enemyCity.officers.find((id) => id !== g.factions[4].ruler);
  try {
    for (const row of data.rules.ai_dispatch) row.weights = [0, 16, 0];
    for (const key of Object.keys(data.search_table)) data.search_table[key] = [];
    for (const c of g.cities) for (const id of c.officers) {
      if (c.faction === 7) g.officers[id].level = 1;
      else if (c.faction !== G.NONE && !G.isRuler(g, id)) g.officers[id].loyalty = 90;
    }
    Object.assign(g, { level: 0, seed: 25 });
    Object.assign(g.officers[target], { loyalty: 69, virtue: 60, level: 8 });
    const run = async (safe) => {
      const game = structuredClone(g), events = [];
      if (!safe) delete game.safeAiLure;
      await aiTurn(game, 7, { event: async (e) => events.push(e), war: async () => {}, allianceOffer: async () => false });
      return events.some((e) => e.type === 'aiLure' && e.id === target);
    };
    assert.equal(g.safeAiLure, true);
    assert.equal(await run(false), true, '旧规则将 -11 回绕成 245');
    assert.equal(await run(true), false, '新规则将负概率限制为零');
    const legacy = structuredClone(g); delete legacy.safeAiLure;
    assert.equal(G.upgrade(legacy).safeAiLure, undefined);
    for (const value of [null, 1, 'true']) {
      const badGame = structuredClone(g); badGame.safeAiLure = value; assert.equal(G.upgrade(badGame), null);
      const badScenario = structuredClone(scenario); badScenario.safeAiLure = value; assert.throws(() => validateScenario(badScenario, base));
    }
    G.setData(base); assert.equal(G.newGame(4, 0, 1).safeAiLure, undefined);
  } finally { G.setData(base); }
});

test('继位与战场笼络使用关系效果，旧规则和忠诚硬限制不变', () => {
  const { data, g } = setup(), ruler = g.factions[7].ruler, field = fieldFor(g);
  try {
    const heir = g.cities[0].officers.find((id) => id !== ruler), target = g.cities[0].officers.find((id) => id !== ruler && id !== heir);
    data.succession['7'] = []; data.relationships = [{ from: heir, to: target, kind: '朋友' }];
    g.officers[target].loyalty = 60;
    const old = structuredClone(g), next = structuredClone(g); old.relationshipEffects = false;
    G.crown(old, 7, heir, ruler); G.crown(next, 7, heir, ruler);
    assert.equal(next.officers[target].loyalty, old.officers[target].loyalty + 2);
    const u = field.side('att')[0], t = field.side('def')[1];
    Object.assign(u, { x: 5, y: 5 }); Object.assign(t, { x: 5, y: 6 });
    field.map = field.map.map((row) => [...row]); field.map[6][5] = PLAIN;
    g.officers[u.id].int = 99; g.officers[t.id].loyalty = 60; field.pool.att = 60;
    data.relationships = [{ from: ruler, to: t.id, kind: '朋友' }];
    g.relationshipEffects = false; const previous = field.lureChance(u, t);
    g.relationshipEffects = true; const adjusted = field.lureChance(u, t);
    assert.ok(adjusted > previous && realChance(adjusted) - realChance(previous) <= 5);
    field.r = () => 0; const baseLoyalty = G.recruitLoyalty(g.officers[ruler].virtue, 60);
    assert.equal(field.cast(u, 8, t).hit, true);
    assert.equal(g.officers[t.id].loyalty, Math.min(90, baseLoyalty + 5));
    g.officers[t.id].loyalty = 71; t.side = 'def'; assert.equal(field.lureChance(u, t), 0);
  } finally { G.setData(base); }
});

test('电脑自动战斗技能按双方、可用机动力和资源计入，有上限且不改武将属性', () => {
  const { data, g } = setup();
  try {
    const attackers = g.cities[0].officers.slice(0, 3), defenders = g.cities.find((c) => c.faction === 4 && c.officers.length >= 2).officers.slice(0, 2);
    const prior = structuredClone(g.officers);
    const bonus = autoSkillBonus(g, attackers, defenders, 100, 7, 1000);
    assert.ok(bonus > 0 && bonus <= 10 && bonus <= 12);
    assert.deepEqual(g.officers, prior);
    assert.equal(autoSkillBonus({ ...g, autoBattleSkills: false }, attackers, defenders, 100, 7, 1000), 0);
    assert.equal(autoSkillBonus(g, attackers, [], 100, 7, 1000), 0);
    const id = attackers[0]; data.officers[id].skills = [16]; delete data.officers[id].duelSkill;
    data.customSkills[0] = { id: 16, cost: 60, soldiers: 1000, hp: 0, stop: 0, rice: 0 };
    g.officers[id].soldiers = 100;
    assert.equal(autoSkillBonus(g, [id], defenders, 100, 7, 1000), 0, '无法负担的计略不应生效');
    data.customSkills[0] = { id: 16, cost: 5, soldiers: 0, hp: 0, stop: 0, rice: 1000 };
    assert.equal(autoSkillBonus(g, [id], defenders, 100, 7, 0), 0, '敌军无粮时损粮计略不能产生加成');
    assert.ok(autoSkillBonus(g, [id], defenders, 100, 7, 1000) > 0);
  } finally { G.setData(base); }
});

test('电脑自动结算的技能影响胜负，未改变的结果不追加随机抽取', () => {
  const { data, g } = setup();
  try {
    const att = g.cities[0].officers.slice(0, 3), def = g.cities.find((c) => c.faction === 4 && c.officers.length >= 3).officers.slice(0, 3);
    for (const id of [...att, ...def]) { g.officers[id].soldiers = 600; g.officers[id].hp = 90; g.officers[id].loyalty = 100; data.officers[id].skills = []; delete data.officers[id].duelSkill; }
    data.officers[att[0]].duelSkill = 'baima'; data.officers[att[0]].skills = [16];
    const war = { attacker: 7, defender: 4, day: 1, att: { ids: att, gold: 0, rice: 9999 }, def: { ids: def, gold: 0, rice: 9999 } };
    let changed = false, same = false;
    for (let seed = 1; seed <= 3000 && !(changed && same); seed++) {
      const old = structuredClone(g), next = structuredClone(g); old.seed = next.seed = seed; old.autoBattleSkills = false;
      const a = fight(old, structuredClone(war)), b = fight(next, structuredClone(war));
      assert.ok(b.autoSkillBonus?.att > 0); assert.equal(b.autoSkillBonus.def, 0);
      if (a.attWins !== b.attWins) { assert.equal(b.attWins, true); changed = true; }
      else { assert.equal(next.seed, old.seed); assert.deepEqual(next.officers, old.officers); same = true; }
    }
    assert.ok(changed && same);
  } finally { G.setData(base); }
});

test('真实电脑战争结算保留技能战报并遵循不战死规则', () => {
  const { g } = setup();
  try {
    const from = 0, to = G.roads(from).find((id) => g.cities[id].faction !== 7 && g.cities[id].officers.length);
    const ids = g.cities[from].officers.slice(0, 3); g.noWarDeath = true;
    for (const id of [...ids, ...g.cities[to].officers]) g.officers[id].soldiers = 800;
    const war = setupWar(g, { from, to, ids, commander: ids[0], gold: 100, rice: 1500 });
    const result = autoBattle(g, war);
    assert.ok(result.autoSkillBonus?.att > 0);
    assert.deepEqual(result.dead, []);
    assert.ok(g.cities.every((city) => city.officers.length <= 10));
  } finally { G.setData(base); }
});
