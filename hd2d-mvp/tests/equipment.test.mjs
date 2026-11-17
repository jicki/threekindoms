import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyScenario, newDraft, validateScenario } from '../src/core/scenario.js';
import { loadScenario } from '../src/core/scenario-store.js';
import { FEMALE_SCENARIO_ID } from '../src/core/visuals.js';
import { ensureFemaleGear, equipmentIconUrl } from '../src/core/equipment.js';
import { Tactical, GW, GH } from '../src/core/tactical.js';
import { Field } from '../src/core/field.js';
import { Duel } from '../src/core/skirmish.js';
import { setOfficer } from '../src/core/saveedit.js';
import { equip, housekeeping } from '../src/core/ai.js';
import * as G from '../src/core/game.js';

const base = JSON.parse(readFileSync(new URL('../data/game-data.json', import.meta.url)));
const female = await loadScenario(FEMALE_SCENARIO_ID, base);
const customized = () => applyScenario(base, female);

test('女性版本配置弓、扇和护甲，且不改变原版或旧版本数据', () => {
  const before = JSON.stringify(base), data = customized(), [sun, zhen, diao] = female.officers;
  assert.equal(data.equipment[sun.weapon].cat, '弓');
  assert.equal(data.equipment[zhen.weapon].cat, '扇');
  assert.equal(data.equipment[diao.weapon].cat, '扇');
  for (const officer of female.officers) assert.equal(data.equipment[24 + officer.armor].name, '锦鳞轻甲');
  assert.equal(data.equipment[sun.weapon].icon, 'b-bow');
  assert.equal(equipmentIconUrl(data.equipment[sun.weapon].icon), 'assets/equipment/bow.webp');
  assert.ok(data.cities[8].shop.includes(sun.weapon));
  assert.ok(data.cities[12].field_shop.includes(24 + sun.armor));
  assert.equal(JSON.stringify(base), before);
  const old = { ...newDraft(base), id: `v-${'a'.repeat(32)}` }; delete old.armors;
  assert.equal(validateScenario(old, base), true);
  assert.deepEqual(applyScenario(base, old).equipment, base.equipment);
});

test('三类装备各有五级，普通装备在有武器屋的城市出售，高级装备有属性和城市限制', () => {
  const data = customized(), cities = base.cities.filter((c) => c.facilities.weapons).map((c) => c.id);
  for (const [category, items] of [
    ['弓', female.weapons.filter((w) => w.cat === '弓')],
    ['扇', female.weapons.filter((w) => w.cat === '扇')],
    ['防具', female.armors],
  ]) {
    assert.deepEqual(items.map((item) => item.grade).sort((a, b) => a - b), [1, 2, 3, 4, 5], category);
    for (const item of items.filter((entry) => entry.grade <= 2)) {
      assert.deepEqual(item.shops, cities); assert.equal(item.requirements, undefined);
    }
    for (const item of items) for (const city of item.shops) {
      assert.ok(data.cities[city].shop.includes(item.id));
      assert.ok(data.cities[city].field_shop.includes(item.id));
      assert.ok(data.cities[city].ai_shop.includes(item.id));
    }
  }
  const byName = (name) => data.equipment.find((item) => item.name === name);
  G.setData(data, female.id);
  try {
    const g = G.newGame(4, 1, 1), bow = byName('落日弓'), fan = byName('洛神羽扇'), armor = byName('凤羽宝衣');
    assert.equal(bow.atk, 15); assert.equal(bow.requirements.war, 85);
    assert.equal(G.equipBlock(g, 237, bow.id), null); assert.match(G.equipBlock(g, 238, bow.id), /需武力85/);
    assert.equal(G.equipBlock(g, 238, fan.id), null); assert.match(G.equipBlock(g, 239, fan.id), /需智力85/);
    assert.equal(G.equipBlock(g, 238, armor.id), null); assert.match(G.equipBlock(g, 237, armor.id), /需人德80/);
    g.officers[237].war = 84; assert.match(G.equipBlock(g, 237, bow.id), /需武力85/);
    g.officers[237].war = 85; assert.equal(G.equipBlock(g, 237, bow.id), null);
    g.cities[1].gold = 1000;
    assert.equal(G.buyEquip(g, 1, 237, bow.id).msg, '此城不卖');
    assert.equal(g.cities[1].gold, 1000);
    assert.equal(G.buyEquip(g, 1, 238, byName('木弓').id).ok, true);
  } finally { G.setData(base); }
});

test('指定武将和属性限制同时作用于城市及战场购买，失败不扣钱', () => {
  const scenario = structuredClone(female), restricted = scenario.weapons.find((w) => w.name === '落日弓');
  restricted.requirements = { war: 85, officers: [237] };
  G.setData(applyScenario(base, scenario), scenario.id);
  try {
    const g = G.newGame(4, 1, 1); g.cities[15].gold = 1000;
    assert.match(G.buyEquip(g, 15, 238, restricted.id).msg, /仅限孙尚香购买/);
    assert.equal(g.cities[15].gold, 1000);
    g.officers[237].war = 84;
    assert.match(G.buyEquip(g, 15, 237, restricted.id).msg, /需武力85/);
    assert.equal(g.cities[15].gold, 1000);
    g.officers[237].war = 85;
    assert.equal(G.buyEquip(g, 15, 237, restricted.id).ok, true);
    assert.equal(g.cities[15].gold, 600);

    const war = { city: 15, from: 12, attacker: 4, defender: 2,
      att: { ids: [237, 238], gold: 1000, rice: 500 }, def: { ids: [38], gold: 0, rice: 500 } };
    const field = new Field(g, war, 'att'), shop = field.villages.find((v) => v.kind === '武器店');
    const denied = field.units.find((u) => u.id === 238), allowed = field.units.find((u) => u.id === 237);
    Object.assign(denied, { x: shop.x, y: shop.y }); Object.assign(allowed, { x: shop.x, y: shop.y });
    assert.match(field.buyEquip(denied, restricted.id).msg, /仅限孙尚香购买/);
    assert.equal(war.att.gold, 1000);
    assert.equal(field.buyEquip(allowed, restricted.id).ok, true);
    assert.equal(war.att.gold, 600);
  } finally { G.setData(base); }
});

test('电脑跳过无资格或买不起的高级装备，仍可购买符合条件的低级装备', () => {
  const data = customized(), byName = (name) => data.equipment.find((item) => item.name === name);
  const basic = byName('木弓'), middle = byName('角弓'), high = byName('穿云弓'), top = byName('落日弓');
  G.setData(data, female.id);
  try {
    const g = G.newGame(4, 1, 1), city = g.cities[15]; city.officers = [237];
    data.cities[15].ai_shop = [top.id, high.id, middle.id];
    g.officers[237].weapon = basic.id; g.officers[237].war = 69; city.gold = 1000;
    assert.equal(equip(g, city, () => 0, () => false), true);
    assert.equal(g.officers[237].weapon, middle.id); assert.equal(city.gold, 870);
    g.officers[237].weapon = basic.id; g.officers[237].war = 85; city.gold = 150;
    assert.equal(equip(g, city, () => 0, () => false), true);
    assert.equal(g.officers[237].weapon, middle.id); assert.equal(city.gold, 20);
    top.requirements.officers = [238]; g.officers[237].weapon = basic.id; city.gold = 1000;
    assert.equal(equip(g, city, () => 0, () => false), true);
    assert.equal(g.officers[237].weapon, high.id); assert.equal(city.gold, 700);
    top.requirements.officers = [237]; g.officers[237].weapon = basic.id; city.gold = 1000;
    assert.equal(equip(g, city, () => 0, () => false), true);
    assert.equal(g.officers[237].weapon, top.id); assert.equal(city.gold, 600);
  } finally { G.setData(base); }
});

test('新人物按配置的城市和年份进入搜索队列，年份之前无法登场', () => {
  const data = customized(); G.setData(data, female.id);
  try {
    const g = G.newGame(4, 1, 1);
    for (const [id, city, year, birthYear] of [[237, 15, 209, null], [238, 4, 200, 183], [239, 8, 191, null]]) {
      assert.equal(data.officers[id].birthYear, birthYear); assert.equal(data.officers[id].birthCity, null);
      assert.deepEqual([data.officers[id].name, G.debutInfo(id).city, G.debutInfo(id).year], [female.officers[id - 237].name, city, year]);
      const queue = G.searchQueue(city);
      for (const other of queue) if (other !== id) g.officers[other].status = G.SERVING;
      g.year = year - 1; assert.deepEqual(G.queueHead(g, queue), { id, ready: false });
      g.year = year; assert.deepEqual(G.queueHead(g, queue), { id, ready: true });
      g.sangu = true; g.visits = {}; g.cities[city].officers = [0];
      const outcomes = [G.search(g, city, 0), G.search(g, city, 0), G.search(g, city, 0)];
      assert.ok(outcomes.some((result) => result.joined === id));
      assert.ok(g.cities[city].officers.includes(id));
    }
  } finally { G.setData(base); }
});

test('电脑搜索也遵守新人物的城市和登场年份', () => {
  G.setData(customized(), female.id);
  try {
    for (const [id, city, year] of [[237, 15, 209], [238, 4, 200], [239, 8, 191]]) {
      const g = G.newGame(4, 1, 1), faction = g.cities[city].faction;
      for (const officer of g.officers) if (officer.status === G.UNAPPEARED) officer.status = G.SERVING;
      g.officers[id].status = G.UNAPPEARED; g.year = year - 1;
      housekeeping(g, faction, () => 0, () => true);
      assert.equal(g.officers[id].status, G.UNAPPEARED);
      g.year = year; housekeeping(g, faction, () => 0, () => true);
      assert.equal(g.officers[id].status, G.SERVING);
      assert.ok(g.cities[city].officers.includes(id));
    }
  } finally { G.setData(base); }
});

test('交错添加武器和防具保持编号稳定，并拒绝错误装备引用', () => {
  const version = { ...newDraft(base), id: `v-${'b'.repeat(32)}` };
  const sun = ensureFemaleGear(version, base, 'sun'), zhen = ensureFemaleGear(version, base, 'zhen');
  assert.deepEqual([sun.weapon, sun.armor + 24, zhen.weapon, zhen.armor + 24], [32, 33, 34, 33]);
  version.weapons[0].price = 123; version.weapons[0].shops = [15];
  const repeated = ensureFemaleGear(version, base, 'diao'); assert.deepEqual(repeated, zhen);
  assert.equal(version.weapons[0].price, 123); assert.deepEqual(version.weapons[0].shops, [15]);
  const armorId = base.equipment.length + version.weapons.length + version.armors.length, weaponId = armorId + 1;
  version.armors.push({ id: armorId, name: '青羽铠', dfn: 10, weight: 6, price: 300, icon: 28, shops: [8] });
  version.weapons.push({ id: weaponId, name: '轻弓', cat: '弓', atk: 13, weight: 5, price: 300, icon: 'b-bow', shops: [8] });
  const data = applyScenario(base, version);
  assert.deepEqual(data.equipment.slice(-2).map((item) => [item.id, item.kind]), [[armorId, 'armor'], [weaponId, 'weapon']]);
  assert.deepEqual(data.equipment.slice(32).map((item) => item.id), Array.from({ length: weaponId - 31 }, (_, i) => i + 32));
  const duplicate = structuredClone(version); duplicate.armors.at(-1).id = 34;
  assert.throws(() => validateScenario(duplicate, base), /编号/);
  const gap = structuredClone(version); gap.weapons.at(-1).id = weaponId + 1;
  assert.throws(() => validateScenario(gap, base), /编号/);
  const unsafe = structuredClone(version); unsafe.weapons[0].icon = '../../.env';
  assert.throws(() => validateScenario(unsafe, base), /图标/);
  const wrong = structuredClone(female); wrong.officers[0].armor = wrong.officers[0].weapon - 24;
  assert.throws(() => validateScenario(wrong, base), /防具/);
});

test('旧巾帼存档的装备编号在新增品级后仍指向原来的物品', () => {
  const legacy = structuredClone(female);
  legacy.weapons = legacy.weapons.filter((item) => item.id <= 34);
  legacy.armors = legacy.armors.filter((item) => item.id <= 34);
  for (const item of [...legacy.weapons, ...legacy.armors]) { delete item.grade; delete item.requirements; }
  const snapshot = JSON.stringify(legacy), records = new Map(), oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => records.get(key) ?? null, setItem: (key, value) => records.set(key, String(value)), removeItem: (key) => records.delete(key),
  } });
  try {
    G.setData(applyScenario(base, legacy), legacy.id);
    const previous = G.newGame(4, 1, 1);
    assert.equal(G.save(previous, 1), true);
    G.setData(customized(), female.id);
    const restored = G.load(1), data = G.data();
    assert.deepEqual(restored.officers.slice(237).map((o) => [data.equipment[o.weapon].name, data.equipment[24 + o.armor].name]),
      [['朱雀弓', '锦鳞轻甲'], ['白羽扇', '锦鳞轻甲'], ['白羽扇', '锦鳞轻甲']]);
    assert.equal(JSON.stringify(legacy), snapshot);
  } finally {
    G.setData(base);
    if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else delete globalThis.localStorage;
  }
});

test('新装备可购买、用于战斗、存档并在记录编辑器中重新选择', () => {
  const data = customized(), oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), records = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => records.get(key) ?? null, setItem: (key, value) => records.set(key, String(value)), removeItem: (key) => records.delete(key),
  } });
  G.setData(data, female.id);
  try {
    const g = G.newGame(4, 1, 1), officer = female.officers[0], armorId = 24 + officer.armor;
    g.cities[8].gold = 2000; g.officers[officer.id].armor = 0;
    assert.equal(G.buyEquip(g, 8, officer.id, armorId).ok, true);
    assert.equal(g.officers[officer.id].armor, officer.armor);
    const battle = new Tactical(g, officer.id, female.officers[1].id, 2, () => 0, { human: 'a' });
    assert.equal(battle.side.a.eq.atk, 11); assert.equal(battle.side.a.eq.def, 8);
    assert.equal(battle.side.a.eq.wgrp, 4); assert.equal(battle.side.d.eq.wgrp, 3);
    assert.equal(new Duel(battle.side, () => 0, g).hitChance('a'), 80);
    assert.equal(setOfficer(g, officer.id, 'armor', officer.armor), officer.armor);
    assert.equal(G.save(g, 1), true); assert.equal(G.load(1).officers[officer.id].armor, officer.armor);
  } finally {
    G.setData(base);
    if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else delete globalThis.localStorage;
  }
});

test('电脑购买新增防具时按配置价格计费，不会把弓升级为扇', () => {
  const scenario = structuredClone(female);
  const id = base.equipment.length + scenario.weapons.length + scenario.armors.length;
  scenario.weapons.push({ id, name: '改良弓', cat: '弓', atk: 14, weight: 5, price: 300, icon: 'b-bow', shops: [8] });
  const data = applyScenario(base, scenario), officer = female.officers[0]; G.setData(data, female.id);
  try {
    const g = G.newGame(4, 1, 1), city = g.cities[8]; city.officers = [officer.id]; city.gold = 1000;
    data.cities[8].ai_shop = [female.officers[1].weapon, id];
    assert.equal(equip(g, city, () => 0, () => false), true);
    assert.equal(g.officers[officer.id].weapon, id); assert.equal(city.gold, 700);
    g.officers[officer.id].armor = 0; data.cities[8].ai_shop = [24 + officer.armor];
    assert.equal(equip(g, city, () => 0, () => false), true);
    assert.equal(g.officers[officer.id].armor, officer.armor); assert.equal(city.gold, 480);
  } finally { G.setData(base); }
});

test('电脑买不起原版防具时仍可选择商店里买得起的新防具', () => {
  const data = customized(), affordable = data.equipment.find((item) => item.name === '绫罗轻衣'); G.setData(data, female.id);
  try {
    const g = G.newGame(4, 1, 1), city = g.cities[8]; city.officers = [237]; city.gold = 100;
    g.officers[237].weapon = 32; g.officers[237].armor = 0;
    assert.ok(data.cities[8].ai_shop.some((id) => id >= 24 && id < 32));
    assert.ok(data.cities[8].ai_shop.includes(affordable.id));
    assert.equal(equip(g, city, () => 0, () => false), true);
    assert.equal(g.officers[237].armor, affordable.id - 24); assert.equal(city.gold, 20);
  } finally { G.setData(base); }
});

test('高武力武将买不起装备时不会阻挡其他武将购买新防具', () => {
  const data = customized(), affordable = data.equipment.find((item) => item.name === '绫罗轻衣'); G.setData(data, female.id);
  try {
    const g = G.newGame(4, 1, 1), city = g.cities[8]; city.officers = [237, 238]; city.gold = 100;
    g.officers[237].weapon = 32; g.officers[237].armor = 4;
    g.officers[238].weapon = 34; g.officers[238].armor = 0;
    assert.equal(equip(g, city, () => 0, () => false), true);
    assert.equal(g.officers[237].armor, 4); assert.equal(g.officers[238].armor, affordable.id - 24);
    assert.equal(city.gold, 20);
  } finally { G.setData(base); }
});

test('战场武器店按价格出售新弓和新防具', () => {
  G.setData(customized(), female.id);
  try {
    const g = G.newGame(4, 1, 1), officer = female.officers[0], war = { city: 8, from: 12, attacker: 4, defender: 2,
      att: { ids: [officer.id], gold: 300, rice: 500 }, def: { ids: [38], gold: 0, rice: 500 } };
    g.officers[officer.id].weapon = 0; g.officers[officer.id].armor = 0;
    const field = new Field(g, war, 'att'), unit = field.units.find((u) => u.id === officer.id);
    const shop = field.villages.find((v) => v.kind === '武器店'); Object.assign(unit, { x: shop.x, y: shop.y });
    assert.equal(field.buyEquip(unit, officer.weapon).ok, true);
    assert.equal(g.officers[officer.id].weapon, officer.weapon); assert.equal(war.att.gold, 80);
    assert.equal(field.buyEquip(unit, 24 + officer.armor).ok, false);
    war.att.gold = 300;
    assert.equal(field.buyEquip(unit, 24 + officer.armor).ok, true);
    assert.equal(g.officers[officer.id].armor, officer.armor); assert.equal(war.att.gold, 80);
  } finally { G.setData(base); }
});

test('弓将领可沿直线射两格，遮挡和距离限制生效，贴身仍单挑', () => {
  G.setData(customized(), female.id);
  try {
    const g = G.newGame(4, 1, 1), t = new Tactical(g, 237, 238, 2, () => 0, { human: 'a' });
    t.map = Array.from({ length: GH }, () => Array(GW).fill(0));
    const a = { side: 'a', kind: 'gen', idx: 0, id: 237, x: 7, y: 4, hp: 82 };
    const d = { side: 'd', kind: 'gen', idx: 0, id: 238, x: 9, y: 4, hp: 70 };
    t.units = [a, d]; t.side.a.fx.xbow = 3; t.side.a.fx.fire = 3;
    assert.equal(t.pickTarget(a, 'advance')?.ranged, true);
    const hp = t.side.d.hp, shot = t.act(a);
    assert.equal(shot.type, 'attack'); assert.equal(shot.ranged, true); assert.equal(shot.fire, false); assert.ok(t.side.d.hp < hp);
    d.x = 10; assert.equal(t.pickTarget(a, 'advance'), null);
    d.x = 9; t.map[4][8] = 1; assert.equal(t.pickTarget(a, 'advance'), null);
    t.map[4][8] = 0; t.units.push({ side: 'a', kind: 'inf', idx: 1, x: 8, y: 4, hp: 100 });
    assert.equal(t.pickTarget(a, 'advance'), null);
    t.units.pop(); d.x = 8;
    assert.equal(t.act(a).type, 'duel');
    assert.ok(t.duel.hitChance('a') >= 0);
  } finally { G.setData(base); }
});

test('弓将远射折减战力和武器攻击，双方一致且近战和原版弓兵不受影响', () => {
  const data = customized(), bow = data.equipment.find((item) => item.name === '落日弓'); G.setData(data, female.id);
  try {
    const g = G.newGame(4, 1, 1); g.officers[237].weapon = bow.id; g.officers[238].weapon = bow.id;
    const damage = (side, ranged, kind = 'gen', target = 'inf') => {
      const t = new Tactical(g, 237, 238, 2, () => 0, { human: 'a' });
      const other = side === 'a' ? 'd' : 'a';
      t.side[side].F = 60; t.side[side].hp = 82; t.side[other].eq.def = 8;
      const attacker = { side, kind, idx: 0, id: t.side[side].id, hp: 82 };
      const defender = { side: other, kind: target, idx: 0, hp: 100 };
      if (target === 'gen') t.side[other].hp = 100;
      return t.attack(attacker, defender, ranged).dmg;
    };
    for (const side of ['a', 'd']) {
      assert.equal(damage(side, true), 35);
      assert.equal(damage(side, false), 63);
      assert.equal(damage(side, true, 'gen', 'gen'), 9);
      assert.equal(damage(side, false, 'gen', 'gen'), 23);
      assert.equal(damage(side, true, 'arc'), 35);
      assert.equal(damage(side, false, 'arc'), 30);
    }
  } finally { G.setData(base); }
});

test('电脑侧的弓将领也可远射，致命伤遵守不战死规则', () => {
  G.setData(customized(), female.id);
  try {
    const g = G.newGame(4, 1, 1); g.noWarDeath = true;
    g.officers[238].weapon = female.officers[0].weapon;
    const t = new Tactical(g, 237, 238, 2, () => 0, { human: 'a' });
    t.map = Array.from({ length: GH }, () => Array(GW).fill(0));
    const a = { side: 'a', kind: 'gen', idx: 0, id: 237, x: 9, y: 4, hp: 1 };
    const d = { side: 'd', kind: 'gen', idx: 0, id: 238, x: 7, y: 4, hp: 70 };
    t.units = [a, d]; t.side.a.hp = 1; t.side.d.F = 99;
    const shot = t.act(d);
    assert.equal(shot.ranged, true); assert.equal(shot.spared, 'captured');
    assert.equal(t.result().a.fate, 'captured');
  } finally { G.setData(base); }
});
