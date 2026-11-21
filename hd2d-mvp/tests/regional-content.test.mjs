import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { applyScenario } from '../src/core/scenario.js';
import { loadScenario } from '../src/core/scenario-store.js';
import { EXPANDED_MAP_ID, expandMap } from '../src/core/expanded-map.js';
import { SOVEREIGN_SCENARIO_ID, visualUrl } from '../src/core/visuals.js';
import { ADDITIONAL_OFFICERS, REGIONAL_OFFICERS, REGIONAL_REVISION, REGIONAL_WEAPONS } from '../src/core/regional-content.js';
import { APPROACH_CAMPAIGN_REVISION } from '../src/core/battle-approaches.js';
import { famousLabel } from '../src/core/famous-skills.js';
import { officerPassive } from '../src/core/battle-rules.js';
import { SPECIAL_TROOPS, officerSpecialty, officerTroopType } from '../src/core/troop-specialties.js';
import { officerRelationships, relationshipAffinity } from '../src/core/relationships.js';
import { equipmentIconUrl } from '../src/core/equipment.js';
import { equip } from '../src/core/ai.js';
import { Field } from '../src/core/field.js';
import { Tactical } from '../src/core/tactical.js';
import { setOfficer } from '../src/core/saveedit.js';
import { replacementWeaponMotion } from '../src/weapon-motion.js';
import { legacyRoster } from './legacy-roster.mjs';

const base = JSON.parse(readFileSync(new URL('../data/game-data.json', import.meta.url)));
const sovereign = await loadScenario(SOVEREIGN_SCENARIO_ID, base);
const game = () => { G.setData(expandMap(applyScenario(base, sovereign)), EXPANDED_MAP_ID); return G.newGame(4, 1, 7); };
const added = name => 265 + REGIONAL_OFFICERS.length + ADDITIONAL_OFFICERS.findIndex(o => o.name === name);

test('新增名将名臣无重名，可在指定城市按年寻访并取得个人被动与立绘', () => {
  for (const [index, spec] of [...REGIONAL_OFFICERS, ...ADDITIONAL_OFFICERS].entries()) {
    const g = game(), D = G.data();
    assert.equal(g.officers.length, 284);
    const id = 265 + index, c = g.cities[spec.city];
    assert.equal(D.officers.filter(o => o.name === spec.name).length, 1);
    assert.equal(G.debutInfo(id).city, c.id);
    assert.equal(famousLabel(D, g, id), spec.title);
    assert.equal(officerPassive(D, g, id).name, spec.passive.name);
    assert.ok(SPECIAL_TROOPS[officerTroopType(D, g, id)]);
    const portrait = visualUrl(D.officers[id].visual.portrait);
    assert.ok(readFileSync(new URL(`../${portrait}`, import.meta.url)).length > 1000);
    // 逐个验证三顾入口，排除同城其他待寻访者与城市容量的干扰。
    c.officers = [g.factions[g.player].ruler]; c.faction = g.player;
    const executor = c.officers[0];
    for (const other of G.searchOrder(g, c.id)) if (other !== id) g.officers[other].status = G.DEAD;
    g.year = spec.year - 1;
    assert.equal(G.queueHead(g, G.searchOrder(g, c.id)).ready, false);
    g.year++; g.sangu = true; g.visits = { [id]: 2 }; g.books = 5;
    assert.equal(G.search(g, c.id, executor, () => 0).joined, id);
    assert.equal(g.officers[id].status, G.SERVING);
  }
});

test('地方刀扇弓按货架和门槛购买，并沿用白兵、单挑与远射的装备组', () => {
  const g = game(), D = G.data(), id = g.factions[g.player].ruler;
  const groups = { 刀: 1, 扇: 3, 弓: 4 };
  for (const e of REGIONAL_WEAPONS) {
    assert.equal(G.weaponGroup(e.id), groups[e.cat]);
    assert.equal(replacementWeaponMotion(g, id, groups[e.cat]), { 刀: 'blade', 扇: 'fan', 弓: 'bow' }[e.cat]);
    assert.ok(readFileSync(new URL(`../${equipmentIconUrl(e.icon)}`, import.meta.url)).length > 1000);
    for (const c of D.cities) for (const stock of ['shop', 'ai_shop', 'field_shop']) assert.equal(G.equipmentStock(g, c.id, stock).includes(e.id), e.shops.includes(c.id));
    assert.equal(G.buyEquip(g, 12, id, e.id).ok, false);
    const city = e.shops[0];
    g.cities[city].gold = e.price;
    const threshold = Object.entries(e.requirements ?? {})[0];
    if (threshold) {
      const [key, value] = threshold;
      g.officers[id][key] = value - 1;
      assert.equal(G.buyEquip(g, city, id, e.id).ok, false);
      assert.equal(g.cities[city].gold, e.price);
      g.officers[id][key] = value;
    }
    assert.equal(G.buyEquip(g, city, id, e.id).ok, true);
    assert.equal(g.cities[city].gold, 0);
    assert.equal(g.officers[id].weapon, e.id);
    assert.equal(new Tactical(g, id, 38, 2, () => 0).side.a.eq.atk, e.atk);
  }
  assert.ok(REGIONAL_WEAPONS.filter(e => e.cat === '弓').every(e => e.atk <= 13));
});

test('地方铁铺补充电脑与军中购物，沿用金钱和旧档规则', () => {
  const g = game(), D = G.data(), city = g.cities[30], officer = g.officers[38], bow = REGIONAL_WEAPONS.at(-1);
  city.officers = [officer.id]; city.gold = bow.price;
  Object.assign(officer, { weapon: 36, war: 85 });
  assert.equal(equip(g, city, () => 0, () => false), true);
  assert.equal(officer.weapon, bow.id);
  assert.equal(city.gold, 0);
  const war = { city: city.id, from: 13, attacker: 4, defender: 9, day: 1,
    att: { ids: [38], rice: 500, gold: bow.price }, def: { ids: [51], rice: 500, gold: 0 } };
  const field = new Field(g, war, 'att');
  const shop = field.villages.find(v => v.kind === '武器店');
  assert.ok(shop);
  const u = field.side('att')[0]; Object.assign(u, { x: shop.x, y: shop.y });
  assert.ok(field.shopStock().some(e => e.id === bow.id));
  assert.equal(field.buyEquip(u, bow.id).ok, true);
  assert.equal(war.att.gold, 0);
  officer.weapon = 36; city.gold = bow.price;
  legacyRoster(g);
  assert.ok(G.upgrade(structuredClone(g)));
  assert.ok(!field.shopStock().some(e => e.id === bow.id));
  assert.equal(G.equipmentStock(g, city.id, 'ai_shop').includes(bow.id), false);
  assert.equal(setOfficer(g, officer.id, 'weapon', bow.id), null);
  assert.equal(D.equipment[56].name, '刘表佩剑');
});

test('修订 9 分身、寻访进度与势力引用安全迁移，原版没有地区武器', () => {
  const g = legacyRoster(game()), first = g.officers.length;
  g.officers.push({ ...g.officers[0], id: first, status: G.SERVING, debut: g.year });
  g.clones = [first];
  const f = g.factions[g.player], city = g.cities[f.city];
  city.officers.push(first); f.ruler = first; f.fallen = first;
  g.visits = { [first]: 2, 262: 1 };
  g.battlefields = 1;
  delete g.siegeTactics;
  assert.equal(G.recordOfficerName(g, first), G.data().officers[0].name);
  const snapshot = structuredClone(g);
  assert.ok(G.upgradeCampaign(g));
  assert.equal(g.campaignRevision, APPROACH_CAMPAIGN_REVISION);
  assert.equal(g.battlefields, 2);
  assert.equal(g.siegeTactics, true);
  assert.deepEqual(g.officers.slice(0, first), snapshot.officers.slice(0, first));
  const clone = first + REGIONAL_OFFICERS.length + ADDITIONAL_OFFICERS.length;
  assert.deepEqual(g.clones, [clone]);
  assert.equal(g.factions[g.player].ruler, clone);
  assert.equal(g.factions[g.player].fallen, clone);
  assert.equal(g.cities[f.city].officers.at(-1), clone);
  assert.equal(g.visits[clone], 2);
  assert.equal(g.visits[262], 1);
  assert.equal(G.name(first), '谯周');
  assert.equal(G.upgradeCampaign(g), false);
  assert.ok(G.loadSnapshot(structuredClone(g)));
  G.setData(structuredClone(base));
  const original = G.newGame(4, 1, 7);
  assert.equal(original.officers.length, base.officers.length);
  assert.equal(G.data().equipment.length, 32);
  assert.equal(G.campaignUpgradeAvailable(original), false);
});

test('谯周的开发被动仅增加人口并遵守上限', () => {
  const fresh = game(), oldRules = { ...structuredClone(fresh), campaignRevision: 7 };
  for (const state of [fresh, oldRules]) Object.assign(state.cities[26], { pop: 450, land: 300, gold: 900 });
  assert.equal(G.develop(fresh, 26, 265, 'land', 20).gain, G.develop(oldRules, 26, 265, 'land', 20).gain);
  assert.equal(G.develop(fresh, 26, 265, 'pop', 20).gain - G.develop(oldRules, 26, 265, 'pop', 20).gain, 2);
  fresh.cities[26].pop = 9998;
  assert.equal(G.develop(fresh, 26, 265, 'pop', 20).gain, 1);
});

test('修订 10 先按旧名单读取，升级保留地方武器并迁移与陈群编号重叠的分身', () => {
  const current = game(), first = added('陈群'), old = legacyRoster(structuredClone(current), REGIONAL_REVISION);
  const city = old.cities[old.factions[old.player].city];
  old.clones = [first];
  old.officers.push({ ...old.officers[0], id: first, status: G.SERVING, loc: city.id, weapon: 65 });
  old.officers[38].weapon = 64;
  city.officers.push(first); old.visits = { [first]: 2 };
  const loaded = G.loadSnapshot(structuredClone(old));
  assert.ok(loaded);
  assert.equal(G.name(first), '阿会喃');
  assert.equal(G.recordOfficerName(current, first), '陈群');
  assert.ok(G.equipmentStock(loaded, 30, 'shop').includes(65));
  assert.equal(officerRelationships(G.data(), loaded).some(r => r.from === first || r.to === first), false);
  assert.equal(G.upgradeCampaign(loaded), true);
  assert.equal(G.name(first), '陈群');
  assert.equal(G.name(284), '阿会喃');
  assert.deepEqual(loaded.officers.slice(0, first), old.officers.slice(0, first));
  assert.equal(loaded.officers[284].weapon, 65);
  assert.ok(loaded.cities[city.id].officers.includes(284));
  assert.equal(loaded.visits[284], 2);
  assert.equal(relationshipAffinity(G.data(), loaded, first, 268), 1);
  assert.ok(G.loadSnapshot(structuredClone(loaded)));
  assert.equal(G.upgrade({ ...old, famousRoster: 3 }), null);
});

test('寻访重试、同盟报价和米市进账只在对应人物参与时调整', () => {
  const g = game(), town = g.cities[8], chen = added('陈群'), zong = added('宗预'), liu = added('刘巴');
  const control = g.factions[g.player].ruler, D = G.data();
  Object.assign(g.officers[control], { int: g.officers[chen].int, virtue: g.officers[chen].virtue });
  g.year = 192;
  const candidate = added('钟繇');
  for (const other of G.searchOrder(g, town.id)) if (other !== candidate) g.officers[other].status = G.DEAD;
  town.officers = [control];
  let retrySeed = null;
  for (let seed = 1; seed <= 500 && retrySeed === null; seed++) {
    g.seed = seed;
    const plain = G.search(structuredClone(g), town.id, control), special = G.search(structuredClone(g), town.id, chen);
    if (plain.msg === '什么也没有找到' && special.joined === candidate) retrySeed = seed;
  }
  assert.notEqual(retrySeed, null);
  const early = { ...structuredClone(g), seed: retrySeed, year: 191 };
  assert.equal(G.search(early, town.id, chen).msg, '什么也没有找到');
  Object.assign(g.officers[control], { int: g.officers[zong].int, virtue: g.officers[zong].virtue });
  let alliance = null;
  for (let seed = 1; seed <= 500 && !alliance; seed++) {
    g.seed = seed;
    const offer = G.allianceOffer(g, town.id, control, 4);
    if (offer.quote !== undefined) alliance = { seed, offer };
  }
  assert.ok(alliance);
  g.seed = alliance.seed;
  const diplomatic = G.allianceOffer(g, town.id, zong, 4);
  assert.equal(diplomatic.kind, alliance.offer.kind);
  assert.equal(diplomatic.quote, alliance.offer.quote - Math.floor(alliance.offer.quote * 0.08));
  assert.equal(G.riceSellRate(g, town.id), D.cities[town.id].rice_rate[0]);
  Object.assign(town, { officers: [liu], gold: 1000, rice: 1000 });
  const [saleRate] = D.cities[town.id].rice_rate;
  assert.equal(G.riceSellRate(g, town.id), saleRate + 5);
  assert.equal(G.sellRice(g, town.id, 100).ok, true);
  assert.equal(town.gold, 1000 + saleRate + 5);
  assert.equal(G.buyRice(g, town.id, 100).ok, true);
  assert.equal(town.rice, 1000);
  assert.ok(town.gold < 1000);
  D.cities[town.id].rice_rate = [97, 100];
  assert.equal(G.riceSellRate(g, town.id), 100);
  const gold = town.gold;
  assert.ok(G.sellRice(g, town.id, 100).ok && G.buyRice(g, town.id, 100).ok);
  assert.equal(town.gold, gold);
});

test('新名臣的灾害减免、施舍门槛与开发专项保持原上限', () => {
  const g = game(), cid = 26, town = g.cities[cid], dong = added('董和'), lu = added('陆凯');
  const control = g.factions[g.player].ruler;
  Object.assign(town, { officers: [control], faction: g.player, gold: 2000, rice: 2000, pop: 800, disaster: 0, gov: 59 });
  g.officers[dong].soldiers = g.officers[control].soldiers;
  G.data().rules.flood_cities = [cid]; G.data().rules.drought_cities = [cid];
  for (const kind of ['flood', 'drought']) {
    let baseline = null, seed = 1;
    for (; seed <= 100 && !baseline; seed++) {
      g.seed = seed;
      baseline = G.disaster(structuredClone(g), kind)[0]?.[2];
    }
    assert.ok(baseline);
    g.seed = seed - 1;
    const led = structuredClone(g); led.cities[cid].officers = [dong];
    assert.deepEqual(G.disaster(led, kind)[0][2], { ...baseline, pop: baseline.pop - Math.floor(baseline.pop * 0.15) });
  }
  g.officers[control].virtue = g.officers[lu].virtue;
  for (const gov of [59, 60]) {
    town.gov = gov;
    const led = structuredClone(g); led.cities[cid].officers = [lu];
    const plain = structuredClone(g);
    G.charity(led, cid, 100, 100); G.charity(plain, cid, 100, 100);
    assert.equal(led.cities[cid].gov - plain.cities[cid].gov, gov < 60 ? 2 : 0);
  }
  const wang = added('王连'), zhang = added('张裔');
  for (const id of [wang, zhang]) g.officers[id].int = g.officers[control].int;
  assert.equal(G.develop(structuredClone(g), cid, wang, 'industry', 20).gain
    - G.develop(structuredClone(g), cid, control, 'industry', 20).gain, 3);
  assert.equal(G.prevent(structuredClone(g), cid, zhang, 20).gain
    - G.prevent(structuredClone(g), cid, control, 20).gain, 3);
  town.industry = 998;
  assert.equal(G.develop(g, cid, wang, 'industry', 20).gain, 1);
});

test('霍峻守城、陆抗持久战和文鸯轻骑各自在指定回合生效', () => {
  const g = game(), huo = added('霍峻'), lu = added('陆抗'), wen = added('文鸯'), D = G.data();
  assert.equal(officerSpecialty(D, g, huo).name, '普通盾兵');
  g.officers[huo].level = 3;
  assert.equal(officerSpecialty(D, g, huo).name, '重甲重盾兵');
  assert.equal(officerSpecialty(D, g, lu).name, '普通枪兵');
  g.officers[lu].level = 3;
  assert.equal(officerSpecialty(D, g, lu).name, '重甲枪兵');
  assert.equal(officerSpecialty(D, g, wen).name, '普通轻骑');
  const damage = ({ attacker, defender, terrain, round, aTroops, dTroops, kind, without }) => {
    const state = structuredClone(g);
    state.officers[attacker].soldiers = aTroops; state.officers[defender].soldiers = dTroops;
    const t = new Tactical(state, attacker, defender, terrain, () => 0);
    t.deploy(); t.round = round;
    const a = t.units.find(u => u.side === 'a' && u.kind === kind);
    const d = t.units.find(u => u.side === 'd' && u.kind === 'inf');
    if (without) t.side[without].passive = null;
    return t.attack(a, d, false).dmg;
  };
  const castle = { attacker: 38, defender: huo, terrain: 5, round: 1, aTroops: 800, dTroops: 400, kind: 'inf' };
  assert.ok(damage(castle) < damage({ ...castle, without: 'd' }));
  for (const other of [{ round: 2 }, { terrain: 2 }, { dTroops: 800 }]) {
    assert.equal(damage({ ...castle, ...other }), damage({ ...castle, ...other, without: 'd' }));
  }
  const cavalry = { ...castle, attacker: wen, terrain: 2, kind: 'cav' };
  assert.ok(damage(cavalry) > damage({ ...cavalry, without: 'a' }));
  assert.equal(damage({ ...cavalry, round: 2 }), damage({ ...cavalry, round: 2, without: 'a' }));
  const longWar = new Tactical(g, lu, 38, 2, () => 0, { human: 'a' });
  longWar.deploy();
  const points = longWar.side.a.tp;
  longWar.round = 4; longWar.endRound();
  assert.equal(longWar.side.a.tp, points);
  longWar.round = 5; longWar.endRound();
  assert.equal(longWar.side.a.tp, points + 1);
  longWar.round = 10; longWar.endRound();
  assert.equal(longWar.side.a.tp, points + 1);
});
