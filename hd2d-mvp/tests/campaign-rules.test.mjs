import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { Field, CASTLE, PLAIN, STRAT_INFO } from '../src/core/field.js';
import { Tactical } from '../src/core/tactical.js';
import { fight } from '../src/core/warcore.js';
import { aiTurn } from '../src/core/ai.js';
import { expandMap, EXPANDED_MAP_ID } from '../src/core/expanded-map.js';
import { SPECIAL_TROOPS } from '../src/core/troop-specialties.js';
import { passiveRiceUse } from '../src/core/ruler-passives.js';
import { chooseCampaignEvent, applyCampaignEvent } from '../src/core/campaign-events.js';
import { applyScenario, validateScenario } from '../src/core/scenario.js';
import { loadScenario } from '../src/core/scenario-store.js';
import { SOVEREIGN_SCENARIO_ID } from '../src/core/visuals.js';

const base = JSON.parse(readFileSync(new URL('../data/game-data.json', import.meta.url)));
const scenario = await loadScenario(SOVEREIGN_SCENARIO_ID, base);
const setup = () => { G.setData(applyScenario(base, scenario), SOVEREIGN_SCENARIO_ID); return G.newGame(7, 1, 10); };
const byName = (name) => G.data().officers.find((o) => o.name === name).id;
const chooseEvent = (g, faction) => chooseCampaignEvent(g, faction, { rng: G.rng, isPass: G.isPass });
const fieldFor = (g) => {
  const war = { city: 1, from: 0, attacker: 7, defender: 4, day: 1,
    att: { ids: g.cities[0].officers.slice(0, 4), gold: 100, rice: 1000 },
    def: { ids: g.cities.find((c) => c.faction === 4 && c.officers.length >= 2).officers.slice(0, 2), gold: 100, rice: 1000 } };
  return new Field(g, war, 'att');
};

test('连续计略逐次消耗机动力并保留随机及经验结果，效果生效或兵尽后停止', () => {
  const g = setup(), f = fieldFor(g), u = f.side('att')[1], t = f.side('def')[1];
  Object.assign(u, { x: 5, y: 5 }); Object.assign(t, { x: 6, y: 5 });
  Object.assign(g.officers[u.id], { int: 90, war: 10, level: 4, soldiers: 800 });
  Object.assign(g.officers[t.id], { soldiers: 1000, hp: 80 });
  f.map = f.map.map((row) => [...row]); f.map[5][5] = f.map[5][6] = 0; f.turn = 'att'; f.pool.att = 40; f.r = () => 0;
  const copy = Field.restore(structuredClone(g), structuredClone(f.war), f.snapshot()); copy.map = f.map; copy.r = () => 0;
  const cu = copy.units.find((v) => v.id === u.id), ct = copy.units.find((v) => v.id === t.id);
  const results = f.castMany(u, 3, t, 3), sequential = [copy.cast(cu, 3, ct), copy.cast(cu, 3, ct), copy.cast(cu, 3, ct)];
  assert.equal(results.length, 3); assert.deepEqual(results.map((x) => x.lines), sequential.map((x) => x.lines));
  assert.equal(f.pool.att, copy.pool.att); assert.deepEqual(g.officers[u.id], copy.g.officers[u.id]); assert.deepEqual(g.officers[t.id], copy.g.officers[t.id]);
  f.pool.att = 40; delete t.stop; assert.equal(f.castMany(u, 2, t, 3).length, 1);
  g.officers[t.id].soldiers = 1; f.pool.att = 40; assert.equal(f.castMany(u, 3, t, 3).length, 1);
  G.setData(base);
});

test('两名护卫夹住主将时，前方护卫让行并消耗正常机动力', () => {
  const g = setup(), f = fieldFor(g), [leader, front, other] = f.side('att'), foe = f.side('def')[0];
  Object.assign(leader, { x: 5, y: 5 }); Object.assign(front, { x: 6, y: 5, role: 3 });
  Object.assign(other, { x: 5, y: 4, role: 3 }); Object.assign(foe, { x: 10, y: 5 });
  f.units = [leader, front, other, foe]; f.pool.att = 40;
  const action = f.approach(front, leader);
  assert.equal(action?.type, 'move'); assert.notDeepEqual([front.x, front.y], [6, 5]);
  assert.equal(f.pool.att, 40 - action.cost); assert.equal(f.unitAt(6, 5), undefined);
  G.setData(base);
});

test('绕开友军后不会立即走回头路，下一日仍可脱困', () => {
  const g = setup(), f = fieldFor(g), [unit, blocker, blocker2] = f.side('att');
  g.campaignRules = false; f.map = f.map.map((row) => row.map(() => PLAIN));
  Object.assign(unit, { x: 2, y: 5, role: 1 }); Object.assign(blocker, { x: 3, y: 5 }); Object.assign(blocker2, { x: 3, y: 6 });
  f.units = [unit, blocker, blocker2]; f.pool.att = 50;
  const target = { x: 5, y: 5 }; assert.equal(f.approach(unit, target)?.type, 'move');
  assert.deepEqual([unit.x, unit.y], [2, 6]); assert.equal(f.approach(unit, target), null);
  f.day++; assert.equal(f.approach(unit, target)?.type, 'move'); assert.deepEqual([unit.x, unit.y], [2, 5]);
  G.setData(base);
});

test('敌军策动通报选择我方最高智力部将，不使用已离开的武将', () => {
  const g = setup(), ruler = g.factions[g.player].ruler;
  const ours = g.cities.filter((c) => c.faction === g.player).flatMap((c) => c.officers).filter((id) => id !== ruler);
  assert.ok(ours.length >= 2);
  for (const id of ours) g.officers[id].int = 10;
  g.officers[ours[0]].int = 98; g.officers[ours[1]].int = 80;
  assert.equal(G.playerAdvisor(g), ours[0]); g.officers[ours[0]].status = G.RONIN;
  assert.equal(G.playerAdvisor(g), ours[1]); G.setData(base);
});

test('十名君主有各自专属效果，新旧记录及关闭增强时正确隔离', () => {
  const g = setup();
  const effects = g.factions.map((f) => G.rulerPassive(g, f.id).combat.unique);
  assert.equal(new Set(effects).size, 10);
  assert.ok(effects.every(Boolean));
  const restored = G.upgrade(JSON.parse(JSON.stringify(g)));
  assert.deepEqual(restored.factions.map((f) => G.rulerPassive(restored, f.id).combat.unique), effects);
  delete restored.campaignRules;
  assert.ok(restored.factions.every((f) => !G.rulerPassive(restored, f.id).combat.unique));
  g.enhancedRulerPassives = false;
  assert.ok(g.factions.every((f) => G.rulerPassive(g, f.id).combat === undefined));
  G.setData(base);
  assert.equal(G.rulerPassive(G.newGame(4, 1, 1), 4), null);
});

test('曹操节粮、袁术征税和刘璋收获对电脑和玩家生效，数值封顶且不改无主城市', () => {
  const g = setup(); delete g.battleRulerPassives;
  const original = structuredClone(g);
  const taxFaction = g.factions.find((f) => G.name(f.ruler) === '袁术').id;
  const harvestFaction = g.factions.find((f) => G.name(f.ruler) === '刘璋').id;
  const cao = g.factions.find((f) => G.name(f.ruler) === '曹操').id;
  assert.equal(passiveRiceUse(101, G.rulerPassive(g, cao)), 91);
  assert.equal(passiveRiceUse(5, G.rulerPassive(g, cao)), 4);
  assert.equal(passiveRiceUse(1, G.rulerPassive(g, cao)), 1);
  delete original.campaignRules;
  for (const [kind, faction, limit] of [['gold', taxFaction, 40], ['rice', harvestFaction, 50]]) {
    const current = structuredClone(g), old = structuredClone(original);
    for (const c of [...current.cities, ...old.cities]) { c[kind] = 0; c.industry = 900; c.land = 900; c.pop = 250; c.gov = 100; }
    G.income(current, kind); G.income(old, kind);
    for (const c of current.cities) {
      const delta = c[kind] - old.cities[c.id][kind];
      if (c.faction === faction) assert.ok(delta > 0 && delta <= limit, `${kind}:${c.id} ${delta}`);
      else assert.equal(delta, 0);
    }
  }
  const heir = byName('田豫'); g.factions[cao].ruler = heir;
  assert.notEqual(G.rulerPassive(g, cao).combat.unique, 'supply');
  G.setData(base);
});

test('曹操的节粮在实际战场日结算和中断恢复后生效，旧记录不启用', () => {
  const template = setup(); delete template.battleRulerPassives; template.factions[7].ruler = byName('曹操');
  const play = (enabled, resume) => {
    const g = structuredClone(template); g.campaignRules = enabled;
    for (const id of g.cities[0].officers) g.officers[id].soldiers = 1000;
    let field = fieldFor(g); field.turn = 'def';
    if (resume) field = Field.restore(g, structuredClone(field.war), JSON.parse(JSON.stringify(field.snapshot())));
    const before = field.war.att.rice, daily = Math.floor(field.troops('att') * 4 / 1000);
    field.endTurn(); return { cost: before - field.war.att.rice, daily };
  };
  const old = play(false, false), current = play(true, false), resumed = play(true, true);
  assert.equal(old.cost, old.daily); assert.equal(current.cost, old.cost - 1);
  assert.deepEqual(resumed, current);
  G.setData(base);
});

test('电脑自动战斗逐日估算曹操节粮，其他君主保留原自动结算公式', () => {
  const g = setup(), cao = g.factions[2].ruler, yuan = g.factions[1].ruler;
  delete g.battleRulerPassives;
  for (const id of [cao, yuan]) Object.assign(g.officers[id], { soldiers: 1000, hp: 100 });
  const war = { city: 11, from: 4, attacker: 1, defender: 2,
    att: { ids: [yuan], gold: 100, rice: 1000 }, def: { ids: [cao], gold: 100, rice: 1000 } };
  const result = fight(structuredClone(g), structuredClone(war)), field = new Field(structuredClone(g), structuredClone(war), null);
  let cost = 0;
  for (let day = 0; day < result.days; day++) {
    field.turn = 'def'; const before = field.war.def.rice; field.endTurn(); cost += before - field.war.def.rice;
  }
  assert.equal(result.proj([cao], 2), cost);
  const without = structuredClone(g); without.enhancedRulerPassives = false;
  const original = fight(without, structuredClone(war));
  assert.equal(original.proj([cao], 2), Math.floor(10 * original.days * 4 / 10));
  G.setData(base);
});

test('刘备专属被动使用人物关系，但不启用已关闭的通用关系效果', () => {
  const g = setup();
  const war = { city: 1, from: 0, attacker: 4, defender: 7,
    att: { ids: g.cities[2].officers.slice(0, 3), gold: 100, rice: 1000 },
    def: { ids: g.cities[0].officers.slice(0, 2), gold: 100, rice: 1000 } };
  const f = new Field(g, war, null), baseChance = G.rulerPassive(g, 4).combat.strategy;
  assert.equal(f.combatPassive('att').strategy, baseChance + 2);
  g.relationshipEffects = false;
  assert.equal(f.combatPassive('att').strategy, baseChance + 2);
  f.side('att').find((u) => G.name(u.id) === '张飞').gone = true;
  assert.equal(f.combatPassive('att').strategy, baseChance);
  G.setData(base);
});

test('袁绍四将恢复与下一回合威胁预报一致；刘备关系和刘表守势有明确条件', () => {
  const g = setup(), f = fieldFor(g);
  g.factions[7].ruler = byName('袁绍'); f.pool.att = 0; f.turn = 'def';
  assert.ok(f.side('att').length >= 4);
  const forecast = f.poolWhenNext('att'); f.recover();
  assert.equal(f.pool.att, forecast);
  const full = f.mobilityBonus('att'); f.side('att').at(-1).gone = true;
  assert.equal(f.mobilityBonus('att'), full - 1);
  g.factions[7].ruler = byName('刘备');
  f.units = [{ id: byName('关羽'), side: 'att' }, { id: byName('张飞'), side: 'att' }, { id: byName('公孙瓒'), side: 'att' }, ...f.side('def')];
  assert.equal(f.combatPassive('att').strategy, G.rulerPassive(g, 7).combat.strategy + 2);
  f.units[1].gone = true;
  assert.equal(f.combatPassive('att').strategy, G.rulerPassive(g, 7).combat.strategy);
  g.factions[4].ruler = byName('刘表');
  assert.equal(f.combatPassive('def').war, G.rulerPassive(g, 4).combat.war + 1);
  g.campaignRules = false;
  assert.equal(f.combatPassive('def').war, G.rulerPassive(g, 4).combat.war);
  G.setData(base);
});

function damage(unique, { side = 'a', kind = 'inf', target = 'inf', terrain = 2, ranged = false, special, defenderUnique } = {}) {
  const g = setup(), ids = g.officers.filter((o) => o.status === 2).slice(0, 2).map((o) => o.id);
  const other = side === 'a' ? 'd' : 'a';
  const battle = new Tactical(g, ids[0], ids[1], terrain, () => 0, { bonuses: { [side]: { unique }, [other]: { unique: defenderUnique } } });
  battle.side[side].F = 90;
  const u = { side, kind, special, hp: 100 };
  const t = { side: other, kind: target, hp: 100 };
  battle.side[other].hp = 100; battle.side[other].eq.def = 0;
  return battle.attack(u, t, ranged).dmg;
}

test('武力类专属仅在对应攻守、地形和兵种生效，远射仍有原有折减', () => {
  for (const options of [
    { unique: 'assault', args: { side: 'a' }, miss: { side: 'd' } },
    { unique: 'river', args: { side: 'd', terrain: 3 }, miss: { side: 'd', terrain: 2 } },
    { unique: 'cavalry', args: { side: 'd', kind: 'cav' }, miss: { side: 'd', kind: 'inf' } },
    { unique: 'horsebow', args: { side: 'd', kind: 'cav', ranged: true, special: SPECIAL_TROOPS.horsebow.sprite }, miss: { side: 'd', kind: 'cav', ranged: false, special: SPECIAL_TROOPS.horsebow.sprite } },
  ]) {
    const before = damage(null, options.args), after = damage(options.unique, options.args);
    assert.ok(after > before && after <= Math.ceil(before * 1.08), options.unique);
    assert.equal(damage(options.unique, options.miss), damage(null, options.miss), options.unique);
    assert.equal(damage(options.unique, { ...options.args, target: 'gen' }), damage(null, { ...options.args, target: 'gen' }));
  }
  assert.ok(damage('horsebow', { kind: 'cav', ranged: true, special: SPECIAL_TROOPS.horsebow.sprite }) < damage(null, { kind: 'cav', ranged: false }));
  const ranged = { kind: 'arc', target: 'cav', ranged: true };
  assert.ok(damage(null, { ...ranged, defenderUnique: 'horsebow' }) < damage(null, ranged));
  assert.equal(damage(null, { ...ranged, ranged: false, defenderUnique: 'horsebow' }), damage(null, { ...ranged, ranged: false }));
  G.setData(base);
});

test('电脑自动结算对攻守双方估算专属被动，旧记录和空城无额外战力', () => {
  const g = setup(), att = g.officers.filter((o) => o.status === 2).slice(0, 8).map((o) => o.id);
  const def = g.officers.filter((o) => o.status === 2).slice(8, 16).map((o) => o.id);
  for (const id of [...att, ...def]) { g.officers[id].soldiers = 1000; g.officers[id].war = 99; }
  g.factions[7].ruler = byName('董卓'); g.factions[4].ruler = byName('刘表');
  const war = { city: 1, attacker: 7, defender: 4, att: { ids: att, gold: 100, rice: 9999 }, def: { ids: def, gold: 100, rice: 9999 } };
  const result = fight(structuredClone(g), structuredClone(war));
  assert.ok(result.autoRulerBonus.att > 0 && result.autoRulerBonus.att <= 2);
  assert.ok(result.autoRulerBonus.def > 0 && result.autoRulerBonus.def <= 2);
  const cavalry = structuredClone(g); cavalry.factions[7].ruler = byName('马腾');
  assert.ok(fight(cavalry, structuredClone(war)).autoRulerBonus.att > 0, '普通编成的骑兵也应参与估算');
  const infantry = structuredClone(g); infantry.factions[7].ruler = byName('马腾');
  for (const id of att) { infantry.officers[id].war = 20; infantry.officers[id].level = 1; }
  const infantryResult = fight(infantry, structuredClone(war));
  assert.equal(infantryResult.autoRulerBonus?.att ?? 0, 0, '没有骑兵时不计骑兵效果');
  const old = structuredClone(g); delete old.campaignRules;
  assert.equal(fight(old, structuredClone(war)).autoRulerBonus, undefined);
  const empty = structuredClone(war); empty.def.ids = [];
  assert.equal(fight(structuredClone(g), empty).autoRulerBonus, undefined);
  G.setData(base);
});

test('三种计策条件在实际施放和提示中生效，旧记录保持原有伤害', () => {
  for (const [name, profile] of [['荆襄固阵', 'fortress'], ['北疆守御', 'frontier'], ['牵招镇边', 'interdict']]) {
    const run = (enabled) => {
      const g = setup(); g.campaignRules = enabled;
      const field = fieldFor(g), a = field.side('att')[0], d = field.side('def')[0];
      field.map = field.map.map((row) => [...row]);
      Object.assign(a, { x: 5, y: 5, commander: true }); Object.assign(d, { x: 5, y: 6 });
      field.map[5][5] = profile === 'fortress' ? CASTLE : PLAIN;
      g.officers[d.id].soldiers = 600; field.pool.att = 50; field.turn = 'att'; field.r = () => 0;
      const skill = G.data().customSkills.find((s) => s.name === name);
      G.data().officers[a.id].skills = [skill.id];
      assert.equal(field.canCast(a, skill.id, d), true);
      const result = field.cast(a, skill.id, d);
      assert.ok(result.ok && result.hit); assert.equal(a.skillUses[skill.id], 1);
      return { soldiers: g.officers[d.id].soldiers, stop: d.stop, rice: field.war.def.rice, info: STRAT_INFO[skill.id].does };
    };
    const old = run(false), current = run(true);
    if (profile === 'fortress') assert.equal(old.soldiers - current.soldiers, 25);
    if (profile === 'frontier') assert.equal(current.stop - old.stop, 1);
    if (profile === 'interdict') assert.equal(old.rice - current.rice, 30);
    assert.notEqual(current.info, old.info);
  }
  const bad = structuredClone(scenario); bad.skills[0].effectProfile = 'arbitrary-code';
  assert.throws(() => validateScenario(bad, base), /条件效果/);
  G.setData(base);
});

test('地方建言受冷却和灾战限制，选择扣费一次且旧存档不会抽取', () => {
  const template = setup(); template.year = 190; template.month = 0;
  let g, plan;
  for (let seed = 0; seed < 1000 && !plan; seed++) {
    g = structuredClone(template); g.seed = seed; plan = chooseEvent(g, 8);
  }
  assert.ok(plan, '固定种子范围内应能触发');
  const c = g.cities[plan.city], before = { gold: c.gold, land: c.land, disaster: c.disaster };
  assert.equal(chooseEvent(g, 8), null);
  assert.equal(applyCampaignEvent(g, plan, 'works'), true);
  assert.equal(c.gold, before.gold - 80); assert.equal(c.land, before.land + 3); assert.equal(c.disaster, before.disaster + 5);
  assert.equal(applyCampaignEvent(g, plan, 'works'), false);
  const capped = structuredClone(g); delete capped.campaignEventHistory.applied;
  Object.assign(capped.cities[plan.city], { gold: 200, disaster: 100, land: 999, rice: 9999 });
  assert.equal(applyCampaignEvent(capped, plan, 'works'), false);
  assert.equal(applyCampaignEvent(capped, plan, 'rice'), false);
  assert.equal(capped.cities[plan.city].gold, 200);
  const restored = G.upgrade(JSON.parse(JSON.stringify(g))); assert.ok(restored);
  restored.month = 1; assert.equal(chooseEvent(restored, 8), null);
  restored.month = 2; restored.disasterFactions = { 8: restored.year * 12 + restored.month };
  assert.equal(chooseEvent(restored, 8), null);
  const invalid = structuredClone(g); invalid.campaignEventHistory.checked = [];
  assert.equal(G.upgrade(invalid), null);
  const old = structuredClone(template); delete old.campaignRules;
  assert.equal(chooseEvent(old, 8), null); assert.equal(old.campaignEventHistory, undefined);
  G.setData(base);
});

test('地方建言在真实回合中由玩家选择，读档后不会再次弹出', async () => {
  const template = setup(); template.year = 190; template.month = 0; template.ageless = true; template.monthDone = true;
  template.turnIdx = G.data().rules.turn_orders[template.order].indexOf(7) - 1;
  let selected, game;
  for (let seed = 1; seed < 1000 && !selected; seed++) {
    game = structuredClone(template); game.seed = seed;
    await G.run(game, { event: async () => {}, campaignEvent: async (plan) => { selected = plan; return 'rice'; },
      playerTurn: async () => { game.over = { type: 'test' }; } });
  }
  assert.ok(selected);
  const expected = template.cities[selected.city];
  assert.equal(game.cities[selected.city].gold, expected.gold - 80 + (G.rulerPassive(game, 7).effects.find((effect) => effect.kind === 'gold')?.value ?? 0));
  assert.equal(game.cities[selected.city].rice, expected.rice + 100);
  game.over = null; game = G.upgrade(JSON.parse(JSON.stringify(game))); assert.ok(game);
  let again = false;
  await G.run(game, { campaignEvent: async () => { again = true; }, playerTurn: async () => { game.over = { type: 'test' }; } });
  assert.equal(again, false);
  G.setData(base);
});

test('电脑直行被敌军阻挡时可绕行，旧记录仍保留原行为', () => {
  const g = setup(), f = fieldFor(g), attacker = f.side('att')[0], blocker = f.side('def')[0];
  f.map = Array.from({ length: 19 }, () => Array(32).fill(PLAIN)); f.villages = [];
  Object.assign(attacker, { x: 3, y: 5, role: 0 }); Object.assign(blocker, { x: 4, y: 5 });
  f.units = [attacker, blocker]; f.pool.att = 20;
  const target = { x: 8, y: 5 }, before = f.pool.att;
  g.campaignRules = false;
  assert.equal(f.approach(attacker, target), null);
  g.campaignRules = true;
  const action = f.approach(attacker, target);
  assert.equal(action?.type, 'move'); assert.equal(action.path.length, 1);
  assert.equal(f.pool.att, before - f.cost(attacker, attacker.x, attacker.y));
  assert.notDeepEqual([attacker.x, attacker.y], [4, 5]);
  G.setData(base);
});

test('电脑绕路连续前进且战场中断恢复后不走回头路', () => {
  const g = setup();
  const war = { city: 11, from: 4, attacker: 1, defender: 2,
    att: { ids: g.cities[4].officers.slice(0, 4), gold: 100, rice: 1000 },
    def: { ids: g.cities[11].officers.slice(0, 1), gold: 100, rice: 1000 } };
  let f = new Field(g, war, null);
  const [commander, unit, a, b] = f.side('att'), foe = f.side('def')[0], [x, y] = f.castle();
  for (const u of [commander, unit, a, b, foe]) Object.assign(g.officers[u.id], { soldiers: 800, hp: 100, army: '平' });
  Object.assign(commander, { x: 0, y: 0, stop: 3 }); Object.assign(unit, { x: 2, y: 1, role: 1 });
  Object.assign(a, { x: 3, y: 1, role: 7 }); Object.assign(b, { x: 2, y: 2, role: 7 }); Object.assign(foe, { x, y });
  f.units = [commander, unit, a, b, foe]; f.pool.att = 30;
  assert.equal(f.aiDecide(unit)?.type, 'move');
  f = Field.restore(g, structuredClone(war), JSON.parse(JSON.stringify(f.snapshot())));
  const resumed = f.units.find((u) => u.id === unit.id), path = [[2, 1], [resumed.x, resumed.y]];
  for (let i = 0; i < 4; i++) { assert.equal(f.aiDecide(resumed)?.type, 'move'); path.push([resumed.x, resumed.y]); }
  assert.equal(new Set(path.map((p) => p.join(','))).size, path.length, `不应重复往返：${JSON.stringify(path)}`);
  assert.ok(Math.abs(x - resumed.x) + Math.abs(y - resumed.y) < Math.abs(x - 2) + Math.abs(y - 1));
  assert.ok(f.pool.att >= 0);
  G.setData(base);
});

test('电脑同盟报价超过255时新版按全额转移，旧记录保留原版字节行为', async () => {
  const data = expandMap(applyScenario(base, scenario));
  G.setData(data, EXPANDED_MAP_ID);
  const template = G.newGame(4, 1, 1); template.year = 195; template.campaignRevision = 1;
  for (const row of data.rules.ai_dispatch) row.weights = [0, 16, 0];
  for (const key of Object.keys(data.search_table)) data.search_table[key] = [];
  for (const c of template.cities) { c.faction = G.NONE; c.officers = []; }
  const envoy = 20, ruler = template.factions[7].ruler, humanRuler = template.factions[4].ruler;
  Object.assign(template.cities[0], { faction: 7, officers: [ruler, envoy], gold: 9999, rice: 9999 });
  Object.assign(template.cities[1], { faction: 4, officers: [humanRuler], gold: 0, rice: 0 });
  Object.assign(template.cities[3], { faction: 0, officers: [template.factions[0].ruler] });
  for (const c of template.cities.filter((c) => !G.isPass(c.id) && ![0, 1, 3].includes(c.id)).slice(0, 18)) c.faction = 4;
  template.factions[7].city = 0; template.factions[4].city = 1;
  const run = async (seed, enhanced) => {
    const game = structuredClone(template), quotes = []; game.seed = seed; game.campaignRules = enhanced;
    await aiTurn(game, 7, { event: async () => {}, war: async () => {}, allianceOffer: async (_, kind, amount) => { quotes.push({ kind, amount }); return true; } });
    return { game, quotes };
  };
  let seed, current;
  for (let n = 1; n < 2000; n++) {
    current = await run(n, true);
    if (current.quotes[0]?.kind === 'gold') { seed = n; break; }
  }
  assert.ok(seed, '固定种子范围内应能发出超过255的同盟报价');
  const old = await run(seed, false);
  assert.equal(current.quotes[0].amount, 256); assert.equal(old.quotes[0].amount, 0);
  assert.equal(current.game.cities[0].gold, old.game.cities[0].gold - 256);
  assert.equal(current.game.cities[1].gold, old.game.cities[1].gold + 256);
  assert.equal(current.game.factions[7].alliance[4], 10);
  G.setData(base);
});
