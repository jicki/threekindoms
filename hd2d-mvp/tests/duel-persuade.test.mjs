// 单挑 说得 结果 2「退出单挑」(bank23 `$BF43`, research/skirmish-duel-evidence.md D08): the persuaded general is given
// result code 1, the code a retreat leaves, and back on the 白兵 field (`CDCF`) his general order turns to 退却. The remake
// left both orders as they were, so the two generals, still side by side, met in a new duel at the next general's action.
// Both seats, the player persuading the AI and the AI persuading the player. Results 3 and 4 end the 白兵 outright.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { Tactical, GW, GH } from '../src/core/tactical.js';
import { Field } from '../src/core/field.js';
import { setupWar, resolveWar } from '../src/core/warcore.js';
G.setData(JSON.parse(readFileSync(new URL('../data/game-data.json', import.meta.url))));

// The two generals side by side mid-field, both ordered forward; side p persuades and the draw picks result `out`.
function persuaded(p, out, human) {
  const g = G.newGame(4, 1, 1), live = g.officers.filter((o) => o.status === 2 && !G.isRuler(g, o.id));
  const t = new Tactical(g, live[0].id, live[1].id, 2, () => 0, { human });
  t.map = Array.from({ length: GH }, () => Array(GW).fill(0));
  const f = p === 'a' ? 'd' : 'a';
  Object.assign(t.side[p].o, { int: 99, virtue: 99 }); Object.assign(t.side[f].o, { loyalty: 20, hp: 40 });
  t.units = [{ side: 'a', kind: 'gen', idx: 0, x: 7, y: 4, hp: t.side.a.hp, id: t.side.a.id }, { side: 'd', kind: 'gen', idx: 0, x: 8, y: 4, hp: t.side.d.hp, id: t.side.d.id }];
  t.side.a.cmd.gen = t.side.d.cmd.gen = 'advance';
  const first = p === 'a' ? t.units[0] : t.units[1], second = first === t.units[0] ? t.units[1] : t.units[0];
  t.queue = [first, second, first, second];
  const ev = t.step(); assert.equal(ev.type, 'duel');
  const i = ev.duel.persuadeTable(p).indexOf(out); assert.ok(i >= 0, `result ${out} in the table`);
  ev.duel.r = () => i; assert.equal(ev.duel.act(p, 'persuade').out, out);
  return { t, f, end: t.resolveDuel(), gens: { a: t.units[0], d: t.units[1] } };
}

for (const human of ['a', 'd']) for (const p of ['a', 'd']) {
  test(`human ${human}, ${p} persuades: 退出单挑 turns the other general to 退却 and no duel follows`, () => {
    const { t, f, end, gens } = persuaded(p, 2, human);
    assert.equal(end.res.withdrew, t.side[f].id); assert.equal(end.res.retreated, undefined, 'not a 败走');
    assert.equal(t.over, null, 'the 白兵 goes on');
    assert.equal(t.side[f].cmd.gen, 'retreat'); assert.equal(t.side[p].cmd.gen, 'advance');
    const x0 = gens[f].x, seen = [];
    for (let k = 0; k < 2; k++) seen.push(t.step().type);
    assert.ok(!seen.includes('duel'), `no new duel: ${seen}`);
    assert.equal(gens[f].x, x0 + (f === 'a' ? -1 : 1), 'he falls back toward his own edge');
  });
}
test('不为所动 keeps the duel going; 说得 ends the 白兵 with defection', () => {
  for (const p of ['a', 'd']) {
    const g = G.newGame(4, 1, 1), live = g.officers.filter((o) => o.status === 2 && !G.isRuler(g, o.id));
    const t = new Tactical(g, live[0].id, live[1].id, 2, () => 0, { human: p }), f = p === 'a' ? 'd' : 'a';
    const d = t.startDuel(p).duel; Object.assign(t.side[f].o, { loyalty: 90, hp: 90 });
    d.r = () => d.persuadeTable(p).indexOf(1); d.act(p, 'persuade'); assert.equal(d.result, null);
    const e4 = persuaded(p, 4, p); assert.equal(e4.t.over.why, 'defection');
    assert.equal(e4.t.result()[f].fate, 'defected');
  }
});

for (const side of ['att', 'def']) for (const commander of [false, true]) test(`${side} 方被说得的${commander ? '主将' : '部将'}保留兵力并即时转投`, () => {
  const g = G.newGame(4, 1, 1), ids = g.officers.filter((o) => o.status === G.SERVING && !G.isRuler(g, o.id)).slice(0, 4).map((o) => o.id);
  const units = ids.map((id, i) => ({ id, side: i < 2 ? 'att' : 'def', commander: i % 2 === 0, x: i, y: 1, role: 1, gone: false }));
  const f = Object.assign(Object.create(Field.prototype), { g, war: { attacker: 0, defender: 1 }, units, over: null });
  const target = units.find((u) => u.side === side && u.commander === commander), attacker = units.find((u) => u.side !== side && !u.commander);
  const old = target.side, next = old === 'att' ? 'def' : 'att', loyalty = 20;
  Object.assign(g.officers[target.id], { loyalty, soldiers: 700 });
  const expected = G.recruitLoyalty(g.officers[g.factions[f.faction(next)].ruler].virtue, loyalty);
  f.applySkirmish(attacker, target, { a: { soldiers: 500, hp: 80 }, d: { soldiers: 321, hp: 40, fate: 'defected' } });
  assert.equal(target.side, next); assert.equal(target.commander, false); assert.equal(g.officers[target.id].soldiers, 321);
  assert.equal(g.officers[target.id].loyalty, expected);
  assert.equal(f.over?.loser ?? null, commander ? old : null);
});

test('电脑行动队列中的倒戈武将不再为原势力行动', () => {
  const target = { id: 1, side: 'att', gone: false }, f = Object.assign(Object.create(Field.prototype), { units: [target], over: null });
  f.adjustRoles = () => {}; let calls = 0;
  f.aiDecide = (u) => { calls++; u.side = 'def'; return { type: 'move', u }; };
  assert.equal([...f.aiActions('att')].length, 1); assert.equal(calls, 1);
});

test('说得转投贯通实际白兵、战场中断恢复和战后安置', () => {
  const g = G.newGame(4, 1, 1), from = 14, to = 12, ids = g.cities[from].officers.slice(0, 2);
  const war = setupWar(g, { from, to, ids, commander: ids[0], gold: 0, rice: 400 });
  const f = new Field(g, war, 'att'), a = f.side('att')[0], target = f.side('def').find((u) => !u.commander && !G.isRuler(g, u.id));
  assert.ok(target); Object.assign(g.officers[a.id], { int: 99, virtue: 99, soldiers: 800 });
  Object.assign(g.officers[target.id], { loyalty: 20, hp: 40, soldiers: 800 }); f.pool.att = 20;
  const pending = f.attack(a, target), battle = pending.battle; battle.deploy();
  const duel = battle.startDuel('a').duel, roll = duel.persuadeTable('a').indexOf(4); assert.ok(roll >= 0);
  duel.r = () => roll; duel.act('a', 'persuade'); battle.resolveDuel(); pending.settle();
  assert.equal(target.side, 'att'); const soldiers = g.officers[target.id].soldiers, loyalty = g.officers[target.id].loyalty;
  assert.ok(soldiers > 0); assert.notEqual(loyalty, 20);
  const restoredGame = structuredClone(g), restoredWar = structuredClone(war);
  const restored = Field.restore(restoredGame, restoredWar, f.snapshot());
  assert.equal(restored.units.find((u) => u.id === target.id).side, 'att');
  restored.end('def', 'time'); const result = restored.result(); resolveWar(restoredGame, restoredWar, result);
  assert.equal(restoredGame.officers[target.id].soldiers, soldiers); assert.equal(restoredGame.officers[target.id].loyalty, loyalty);
  const cities = restoredGame.cities.filter((c) => c.officers.includes(target.id));
  assert.equal(cities.length, 1); assert.equal(cities[0].faction, restoredWar.attacker);
});
