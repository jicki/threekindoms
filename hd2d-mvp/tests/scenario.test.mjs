import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyScenario, newDraft, validateScenario } from '../src/core/scenario.js';
import * as G from '../src/core/game.js';
import { peekSuspend, suspend } from '../src/core/suspend.js';
import { setOfficer } from '../src/core/saveedit.js';
import { Tactical } from '../src/core/tactical.js';
import { skirmish } from '../src/core/skirmish.js';
import { Field } from '../src/core/field.js';
import { setupWar } from '../src/core/warcore.js';

const base = JSON.parse(readFileSync(new URL('../data/game-data.json', import.meta.url)));
const editable = (o) => Object.fromEntries(['id', 'name', 'hp', 'war', 'int', 'virtue', 'loyalty', 'level', 'exp', 'soldiers', 'weapon', 'armor', 'army', 'year', 'death', 'appear', 'city', 'faction'].map((k) => [k, o[k]]));
const draft = () => ({ ...newDraft(base), id: `v-${'a'.repeat(32)}` });

test('a version applies new officers, weapons, skills and relationships without changing the original data', () => {
  const before = JSON.stringify(base), s = draft(), id = base.officers.length;
  const shop = base.cities.find((c) => c.facilities.weapons).id;
  s.weapons.push({ id: 32, name: '新剑', cat: '剑', atk: 20, weight: 5, price: 150, icon: 0, shops: [shop] });
  s.skills.push({ id: 16, name: '新战法', cost: 4, soldiers: 50, hp: 5, stop: 1, rice: 10 });
  s.officers.push({ ...editable(base.officers[0]), id, name: '新武将', year: 190, birthYear: 170, birthCity: 2, portraitId: 0, weapon: 32, skills: [16] });
  s.relations.push({ from: 0, to: id, kind: '朋友' });
  const result = applyScenario(base, s);
  assert.equal(result.officers[id].name, '新武将');
  assert.equal(result.officers[id].weapon, 32); assert.deepEqual(result.officers[id].skills, [16]);
  assert.ok(result.search_table[String(result.officers[id].city)].includes(id));
  assert.deepEqual(result.search_table[String(result.officers[id].city)].map((n) => result.officers[n].year),
    result.search_table[String(result.officers[id].city)].map((n) => result.officers[n].year).sort((a, b) => a - b));
  assert.equal(result.equipment[32].name, '新剑'); assert.ok(result.cities[shop].shop.includes(32));
  assert.deepEqual(result.relationships, s.relations); assert.deepEqual(result.customSkills, s.skills);
  assert.equal(JSON.stringify(base), before);
});

test('invalid imports cannot add code-shaped fields, unsafe names or inconsistent references', () => {
  const s = draft(), id = base.officers.length;
  s.officers.push({ ...editable(base.officers[0]), id, name: '新武将', birthYear: 170, birthCity: null, portraitId: 0, skills: [] });
  const badName = structuredClone(s); badName.officers[0].name = '<img onerror=alert(1)>';
  assert.throws(() => validateScenario(badName, base), /姓名/);
  const badField = structuredClone(s); badField.officers[0].clone = true;
  assert.throws(() => validateScenario(badField, base), /不支持的字段/);
  const badSkill = structuredClone(s); badSkill.officers[0].skills = [16];
  assert.throws(() => validateScenario(badSkill, base), /技能编号/);
  const badYear = structuredClone(s); badYear.officers[0].birthYear = 999;
  assert.throws(() => validateScenario(badYear, base), /出生年份/);
  const badBase = structuredClone(s); badBase.base = 'other';
  assert.throws(() => validateScenario(badBase, base), /基础数据/);
});

test('a changed debut is moved between queues and rulers cannot be detached from their faction', () => {
  const s = draft(), actor = { ...editable(base.officers[0]), birthYear: null, birthCity: null, portraitId: 0, skills: [] };
  actor.city = 1; actor.year = 195; s.officers.push(actor);
  const result = applyScenario(base, s);
  assert.ok(!result.search_table['28'].includes(0)); assert.ok(result.search_table['1'].includes(0));
  const ruler = base.officers[base.factions[0].ruler];
  s.officers.push({ ...editable(ruler), appear: 'search_city', faction: null, birthYear: null, birthCity: null, portraitId: ruler.id, skills: [] });
  assert.throws(() => applyScenario(base, s), /君主/);
});

test('a city becomes neutral when its last starting officer moves, and regains its owner if replaced', () => {
  const city = base.cities.find((c) => c.officers.length === 1 && !base.factions.some((f) => f.ruler === c.officers[0]));
  const officer = base.officers[city.officers[0]], s = draft();
  s.officers.push({ ...editable(officer), appear: 'search_city', city: city.id, faction: null,
    birthYear: null, birthCity: null, portraitId: officer.id, skills: [] });
  const result = applyScenario(base, s);
  assert.deepEqual(result.cities[city.id].officers, []);
  assert.equal(result.cities[city.id].faction, G.NONE);
  assert.ok(result.search_table[String(city.id)].includes(officer.id));
  try {
    G.setData(result, s.id);
    assert.equal(G.newGame(4, 1, 1).cities[city.id].faction, G.NONE);
  } finally { G.setData(base); }
  const id = base.officers.length;
  s.officers.push({ ...editable(base.officers[0]), id, name: '替补武将', year: 189, appear: 'initial',
    city: city.id, faction: city.faction, birthYear: null, birthCity: null, portraitId: 0, skills: [] });
  const replaced = applyScenario(base, s);
  assert.deepEqual(replaced.cities[city.id].officers, [id]);
  assert.equal(replaced.cities[city.id].faction, city.faction);
});

test('original and custom versions keep numbered saves, quick saves and suspended battles separate', () => {
  const savedStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key),
  } });
  try {
    G.setData(base); const original = G.newGame(4, 1, 2); original.year = 190;
    assert.equal(G.save(original, 1), true); assert.equal(G.saveQuick(original), true);
    assert.equal(suspend(original, { city: 1 }, { snapshot: () => ({ units: [] }) }, { side: 'att', after: { kind: 'att' } }), true);
    const s = draft(), customData = applyScenario(base, s);
    G.setData(customData, s.id); const custom = G.newGame(4, 1, 3); custom.year = 200;
    assert.equal(G.load(1), null); assert.equal(G.loadQuick(), null); assert.equal(peekSuspend(), null);
    assert.equal(G.save(original, 2), false); assert.equal(G.upgrade(original), null);
    assert.equal(G.save(custom, 1), true); assert.equal(G.saveQuick(custom), true);
    assert.equal(suspend(custom, { city: 2 }, { snapshot: () => ({ units: [] }) }, { side: 'att', after: { kind: 'att' } }), true);
    G.setData(base); assert.equal(G.load(1).year, 190); assert.equal(G.loadQuick().year, 190); assert.equal(peekSuspend().war.city, 1);
    G.setData(customData, s.id); assert.equal(G.load(1).year, 200); assert.equal(G.loadQuick().year, 200); assert.equal(peekSuspend().war.city, 2);
  } finally {
    G.setData(base);
    if (savedStorage) Object.defineProperty(globalThis, 'localStorage', savedStorage); else delete globalThis.localStorage;
  }
});

test('a new weapon can be bought and its class and attack are used by tactical combat', () => {
  const s = draft(), shop = base.cities.find((c) => c.facilities.weapons).id;
  s.weapons.push({ id: 32, name: '新刀', cat: '刀', atk: 45, weight: 5, price: 150, icon: 8, shops: [shop] });
  const custom = applyScenario(base, s);
  try {
    G.setData(custom, s.id); const g = G.newGame(4, 1, 3), id = g.factions[g.player].ruler;
    g.cities[shop].gold = 1000;
    assert.equal(G.buyEquip(g, shop, id, 32).ok, true); assert.equal(g.officers[id].weapon, 32);
    const combat = new Tactical(g, id, base.factions[0].ruler, 2, () => 0);
    assert.equal(combat.side.a.eq.atk, 45); assert.equal(combat.side.a.eq.wgrp, 1);
    g.officers[id].soldiers = 500; g.officers[base.factions[0].ruler].soldiers = 500;
    const resolved = skirmish(g, id, base.factions[0].ruler, 2, G.rng(g));
    assert.equal(resolved.side.a.eq.atk, 45); assert.equal(resolved.side.a.eq.wgrp, 1);
    assert.equal(setOfficer(g, id, 'weapon', 32), 32);
    assert.ok(custom.cities[shop].field_shop.includes(32)); assert.ok(custom.cities[shop].ai_shop.includes(32));
  } finally { G.setData(base); }
});

test('an assigned new skill combines its configured effects and spends mobility', () => {
  const s = draft(), ruler = base.officers[base.factions[4].ruler];
  s.skills.push({ id: 16, name: '新战法', cost: 4, soldiers: 50, hp: 5, stop: 2, rice: 10 });
  s.officers.push({ ...editable(ruler), birthYear: null, birthCity: null, portraitId: ruler.id, skills: [16] });
  const enemy = base.officers[base.cities.find((c) => c.faction !== G.NONE && c.faction !== 4 && c.officers.length).officers[0]];
  s.officers.push({ ...editable(enemy), birthYear: null, birthCity: null, portraitId: enemy.id, skills: [16] });
  try {
    G.setData(applyScenario(base, s), s.id); const g = G.newGame(4, 1, 1);
    const to = g.cities.find((c) => c.faction !== G.NONE && c.faction !== g.player && c.officers.length);
    const from = g.cities[g.factions[g.player].city], id = from.officers[0];
    const f = new Field(g, setupWar(g, { from: from.id, to: to.id, ids: [id], commander: id, gold: 100, rice: 9000 }), 'att');
    const me = f.alive.find((u) => u.side === 'att'), foe = f.alive.find((u) => u.side === 'def');
    Object.assign(me, { x: 10, y: 10 }); Object.assign(foe, { x: 12, y: 10 });
    f.O(foe.id).soldiers = 500; f.O(foe.id).hp = 80; f.war.def.rice = 500; f.pool.att = 99; f.r = () => 0;
    assert.ok(f.strategies(me).some((skill) => skill.id === 16));
    assert.equal(f.legal(me, 16, me), false, 'a skill cannot target a friendly unit');
    f.pool.att = 3; assert.equal(f.canCast(me, 16, foe), false, 'mobility is required'); f.pool.att = 99;
    const result = f.cast(me, 16, foe);
    assert.equal(result.hit, true); assert.equal(f.O(foe.id).soldiers, 450); assert.equal(f.O(foe.id).hp, 75);
    assert.equal(foe.stop, 2); assert.equal(f.war.def.rice, 490); assert.equal(f.pool.att, 95);
    f.turn = 'def'; f.pool.def = 99; foe.stop = 0; foe.role = 0; f.O(foe.id).hp = 80; f.O(foe.id).soldiers = 500;
    const aiAction = f.aiDecide(foe);
    assert.equal(aiAction?.type, 'strategy'); assert.equal(aiAction.id, 16, 'AI can use an assigned custom skill');
  } finally { G.setData(base); }
});
