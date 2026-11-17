import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { applyScenario, validateScenario } from '../src/core/scenario.js';
import { loadScenario } from '../src/core/scenario-store.js';
import { SOVEREIGN_SCENARIO_ID } from '../src/core/visuals.js';
import { expandMap, EXPANDED_MAP_ID } from '../src/core/expanded-map.js';
import { setOfficer } from '../src/core/saveedit.js';
import { duelLoot } from '../src/core/tactical.js';
import { Field } from '../src/core/field.js';
import { setupWar, resolveWar } from '../src/core/warcore.js';
import { fight } from '../src/core/warcore.js';
import { Tactical } from '../src/core/tactical.js';

const base = JSON.parse(readFileSync(new URL('../data/game-data.json', import.meta.url)));
const scenario = await loadScenario(SOVEREIGN_SCENARIO_ID, base);
const use = (version = scenario) => G.setData(expandMap(applyScenario(base, version)), EXPANDED_MAP_ID);

test('十位君主的新被动各有一个基础类别和独立专属效果，旧记录与原版保持原规则', () => {
  use();
  try {
    const g = G.newGame(4, 1, 1), expected = ['army', 'field', 'strategy', 'army', 'army', 'army', 'army', 'field', 'army', 'strategy'];
    const skills = new Set();
    for (const [i, f] of g.factions.entries()) {
      const passive = G.rulerPassive(g, f.id), c = passive.combat;
      assert.equal(passive.category, expected[i], G.name(f.ruler));
      const groups = [passive.effects.length > 0, !!(c.war || c.int), !!(c.mobility || c.tacticRounds), !!c.strategy];
      assert.equal(groups.filter(Boolean).length, 1, G.name(f.ruler));
      assert.ok(c.unique); assert.match(passive.text, /专属/); skills.add(c.unique);
      assert.ok(c.war <= 4 && c.int <= 3 && c.strategy <= 3 && c.mobility <= 1);
    }
    assert.equal(skills.size, 10); assert.equal(g.focusedRulerPassives, true); assert.equal(g.battleRulerPassives, true);
    assert.ok(g.factions.every((f) => G.rulerPassive(g, f.id).effects.length === 0));
    const saved = G.upgrade(JSON.parse(JSON.stringify(g))); assert.equal(saved.battleRulerPassives, true);
    delete saved.battleRulerPassives;
    assert.deepEqual(G.rulerPassive(saved, 7).effects, [{ kind: 'gold', value: 44 }], '旧精简记录保留原方案');
    delete saved.focusedRulerPassives;
    assert.ok(G.upgrade(saved));
    assert.deepEqual(G.rulerPassive(saved, 7).effects, [{ kind: 'gold', value: 44 }, { kind: 'reserve', value: 45 }]);
    const corrupt = structuredClone(g); corrupt.focusedRulerPassives = 'true'; assert.equal(G.upgrade(corrupt), null);
    G.setData(base); assert.equal(G.rulerPassive(G.newGame(4, 1, 1), 4), null);
  } finally { G.setData(base); }
});

test('十位君主开局各有绑定武器，不在商店出售、不能分配给其他人物', () => {
  const data = use();
  try {
    const g = G.newGame(4, 1, 1), ids = new Set();
    const ordinaryMax = Math.max(...data.equipment.filter((w) => w.kind === 'weapon' && w.exclusiveRuler === undefined).map((w) => w.atk));
    for (const f of g.factions) {
      const weapon = data.equipment[g.officers[f.ruler].weapon];
      assert.equal(weapon.exclusiveRuler, f.ruler); assert.equal(weapon.kind, 'weapon');
      assert.ok(weapon.atk >= ordinaryMax && weapon.atk <= 22); assert.notEqual(weapon.cat, '弓'); ids.add(weapon.id);
      for (const city of data.cities) for (const shop of [city.shop, city.field_shop, city.ai_shop]) assert.ok(!shop.includes(weapon.id));
      assert.match(G.equipBlock(g, f.ruler, weapon.id), /不可购买或转移/);
      const other = g.officers.find((o) => o.id !== f.ruler);
      assert.match(G.wearEquip(g, other.id, weapon.id), /不可购买或转移/);
      assert.equal(setOfficer(g, other.id, 'weapon', weapon.id), null);
    }
    assert.equal(ids.size, 10);
    const original = G.newGame(4, 1, 1), weapon = original.officers[original.factions[7].ruler].weapon;
    const corrupt = structuredClone(original); corrupt.officers[38].weapon = weapon;
    assert.equal(G.upgrade(corrupt), null);
    G.setData(base); const vanilla = G.newGame(4, 1, 1);
    assert.equal(vanilla.officers[131].weapon, base.officers[131].weapon);
  } finally { G.setData(base); }
});

test('绑定武器跟随人物而非职位，自愿更换后不可再次获取', () => {
  const data = use();
  try {
    const g = G.newGame(7, 1, 4), original = g.factions[7].ruler, held = g.officers[original].weapon;
    const heir = g.cities[0].officers.find((id) => id !== original);
    G.crown(g, 7, heir, original);
    assert.equal(g.officers[original].weapon, held); assert.ok(G.upgrade(JSON.parse(JSON.stringify(g))));
    assert.equal(duelLoot(g, original, 131, () => 0), null, '自动武器战利品不能覆盖绑定装备');
    assert.equal(g.officers[original].weapon, held);
    assert.equal(duelLoot(g, original, 222, () => 0), 31, '护甲战利品不受影响');
    const city = g.cities[1], item = data.cities[1].shop.find((id) => data.equipment[id].kind === 'weapon' && id !== held);
    city.gold = 9999;
    assert.equal(G.buyEquip(g, city.id, original, item).ok, true);
    assert.equal(g.officers[original].weapon, item);
    assert.equal(setOfficer(g, original, 'weapon', held), null);
    assert.match(G.wearEquip(g, original, held), /不可购买或转移/);
    assert.ok(!data.cities.some((c) => c.shop.includes(held) || c.field_shop.includes(held)));
  } finally { G.setData(base); }
});

test('选择其他君主或势力灭亡均不会转移或自动移除专属武器', () => {
  const draft = structuredClone(scenario), candidate = draft.officers.find((o) => o.name === '田豫').id;
  draft.rulers.push({ faction: 7, officer: candidate }); use(draft);
  try {
    const g = G.newGame(7, 1, 1, { ruler: candidate }), original = scenario.factions[0].ruler;
    const held = g.officers[original].weapon;
    assert.equal(G.data().equipment[held].exclusiveRuler, original);
    assert.notEqual(g.officers[candidate].weapon, held);
    G.destroyFaction(g, 7);
    assert.equal(g.officers[original].weapon, held); assert.ok(G.upgrade(JSON.parse(JSON.stringify(g))));
  } finally { G.setData(base); }
});

test('君主被俘、继位后为敌方效力以及下野时都继续持有专属武器', async () => {
  use();
  try {
    const g = G.newGame(4, 1, 17), cao = g.factions[2].ruler, held = g.officers[cao].weapon;
    const target = G.officerCity(g, cao), source = g.cities.find((city) => city.faction === 4), attacker = source.officers[0];
    g.officers[cao].loyalty = 10;
    const war = setupWar(g, { from: source.id, to: target.id, ids: [attacker], commander: attacker, gold: 0, rice: 0 });
    resolveWar(g, war, { loser: 'def', survivors: { att: [attacker], def: [] }, dead: [],
      captured: { byAtt: [...war.def.ids], byDef: [] }, retreated: [], chests: { att: war.att, def: war.def }, skipCut: true });
    await G.checkFactions(g, { event: async () => {}, chooseHeir: async (_f, ids) => ids[0] });
    assert.equal(G.isRuler(g, cao), false); assert.equal(G.factionOf(g, cao), 4);
    assert.equal(g.officers[cao].weapon, held); assert.ok(G.upgrade(JSON.parse(JSON.stringify(g))));
    G.toRonin(g, cao); assert.equal(g.officers[cao].status, G.RONIN);
    assert.equal(g.officers[cao].weapon, held); assert.ok(G.upgrade(JSON.parse(JSON.stringify(g))));
  } finally { G.setData(base); }
});

test('战场商店自愿更换后消失，未购买的专属武器不进入战场货架', () => {
  const data = use();
  try {
    const g = G.newGame(7, 1, 4), owner = g.factions[7].ruler, held = g.officers[owner].weapon;
    const war = { city: 15, from: 0, attacker: 7, defender: 4,
      att: { ids: [owner], gold: 2000, rice: 500 }, def: { ids: [g.factions[4].ruler], gold: 0, rice: 500 } };
    const field = new Field(g, war, 'att'), unit = field.side('att')[0], shop = field.villages.find((v) => v.kind === '武器店');
    Object.assign(unit, { x: shop.x, y: shop.y });
    assert.ok(!field.shopStock().some((item) => item.id === held));
    const item = field.shopStock().find((entry) => entry.kind === 'weapon');
    assert.ok(item); assert.equal(field.buyEquip(unit, item.id).ok, true);
    assert.equal(g.officers[owner].weapon, item.id); assert.equal(war.att.gold, 2000 - data.equipment[item.id].price);
    assert.match(G.wearEquip(g, owner, held), /不可购买或转移/);
  } finally { G.setData(base); }
});

test('专属装备和新规则的版本校验禁止商店出售、重复绑定和非所属人物持有', () => {
  const invalid = (edit) => { const s = structuredClone(scenario); edit(s); assert.throws(() => validateScenario(s, base)); };
  invalid((s) => { s.weapons.find((w) => w.exclusiveRuler !== undefined).shops = [4]; });
  invalid((s) => { const w = s.weapons.filter((x) => x.exclusiveRuler !== undefined); w[1].exclusiveRuler = w[0].exclusiveRuler; });
  invalid((s) => { const w = s.weapons.find((x) => x.exclusiveRuler !== undefined); s.officers.find((o) => o.id === 38).weapon = w.id; });
  invalid((s) => { delete s.enhancedRulerPassives; });
  invalid((s) => { s.expandedOpening = 'true'; });
  invalid((s) => { delete s.focusedRulerPassives; });
  invalid((s) => { s.frontierMap = 'true'; });
});

test('战场版曹操、刘璋和袁术的专属效果按条件作用于实际白兵', () => {
  const data = use();
  try {
    const g = G.newGame(7, 1, 10), byName = (name) => data.officers.find((o) => o.name === name).id;
    const war = { city: 1, from: 0, attacker: 7, defender: 4,
      att: { ids: g.cities[0].officers.slice(0, 4), gold: 100, rice: 1000 },
      def: { ids: g.cities[2].officers.slice(0, 3), gold: 100, rice: 1000 } };
    const field = new Field(g, war, 'att'), [a] = field.side('att'), [d] = field.side('def');
    const battle = (bonuses) => new Tactical(g, a.id, d.id, 2, () => 0, { human: 'a', bonuses });
    g.factions[7].ruler = byName('曹操');
    let b = battle({ a: field.combatPassive('att') }); b.side.a.tp = 20;
    assert.equal(b.tactic('a', 'xbow').ok, true); assert.equal(b.side.a.fx.xbow, 4);
    const originalRice = war.att.rice; field.turn = 'def';
    const daily = Math.floor(field.troops('att') * 4 / 1000); field.endTurn();
    assert.equal(originalRice - war.att.rice, daily, '新版不再改变粮耗');

    g.factions[4].ruler = byName('刘璋');
    const guard = field.combatPassive('def'); assert.equal(guard.fortify, true);
    const damage = (bonus, attacker = 'a', target = 'd') => {
      const t = battle(bonus); t.side[attacker].F = 90;
      return t.attack({ side: attacker, kind: 'inf', hp: 100 }, { side: target, kind: 'inf', hp: 100 }, false).dmg;
    };
    assert.ok(damage({ d: guard }) < damage({}));
    assert.ok(damage({ a: guard }, 'd', 'a') < damage({}, 'd', 'a'), '守方主动白兵仍受保护');
    assert.equal(field.combatPassive('att').fortify, undefined, '攻击方不获得守备');

    g.factions[7].ruler = byName('袁术');
    const massed = field.combatPassive('att'); assert.equal(massed.massed, true);
    assert.ok(damage({ a: massed }) > damage({}));
    const savedSoldiers = field.side('att').slice(2).map((u) => [u.id, g.officers[u.id].soldiers]);
    savedSoldiers.forEach(([id]) => { g.officers[id].soldiers = 0; });
    assert.equal(field.combatPassive('att').massed, undefined, '无兵部队不计入集结');
    savedSoldiers.forEach(([id, soldiers]) => { g.officers[id].soldiers = soldiers; });
    field.side('att').slice(2).forEach((u) => { u.gone = true; });
    assert.equal(field.combatPassive('att').massed, undefined, '不足三将时不生效');
    for (const u of field.units) u.gone = false;
    for (const id of [...war.att.ids, ...war.def.ids]) Object.assign(g.officers[id], { soldiers: 1000, hp: 99, war: 99 });
    g.officers[war.att.ids[0]].exp = 4096;
    assert.ok((fight(structuredClone(g), structuredClone(war)).autoRulerBonus?.att ?? 0) > 0, '电脑自动战斗估算专属效果');
    const old = structuredClone(g); delete old.battleRulerPassives;
    assert.equal(G.rulerPassive(old, 7).combat.unique, 'tax');
  } finally { G.setData(base); }
});

test('战场版不增加金米，非指定继任者也不使用经济被动', () => {
  use();
  try {
    const g = G.newGame(4, 1, 1), old = structuredClone(g);
    old.enhancedRulerPassives = false;
    for (const kind of ['gold', 'rice']) {
      const a = structuredClone(g), b = structuredClone(old);
      assert.deepEqual(G.income(a, kind), G.income(b, kind));
    }
    const successor = g.officers.find((o) => !g.factions.some((f) => f.ruler === o.id) && o.status === G.SERVING);
    successor.virtue = 99; successor.int = 20; successor.war = 20;
    g.factions[4].ruler = successor.id;
    assert.equal(G.rulerPassive(g, 4).category, 'strategy'); assert.deepEqual(G.rulerPassive(g, 4).effects, []);
    const damaged = structuredClone(g); damaged.battleRulerPassives = 'true'; assert.equal(G.upgrade(damaged), null);
  } finally { G.setData(base); }
});
