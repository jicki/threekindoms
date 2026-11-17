// 白兵 撤退追击 (bank14 $A407–$A4F6; docs/原版白兵撤退追击逻辑与修复交接_2026-11-07.md): a general who leaves over his
// own edge faces one pursuit draw. U(100) < 32 gets him away untouched (no damage draw); otherwise 5+U(10) off his HP,
// clamped at 0, and at 0 the 退却 becomes a death or, under 武将不战死, a capture.
// The same for both sides, AI or player, any difficulty, whatever the distance or the troops; squads never draw.
// Feedback: 德华小酸奶@小红书, 2026-11-07.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { Tactical, GW, GH } from '../src/core/tactical.js';
G.setData(JSON.parse(readFileSync(new URL('../data/game-data.json', import.meta.url))));

// A scripted draw for the pursuit's U(100) and U(10): each takes the next value and is logged; any other draw (the
// step's own axis picks) answers 0, and so does a pursuit draw past the script.
function script(values) {
  const calls = [];
  const r = (n) => { const v = (n === 100 || n === 10) && values.length ? values.shift() : 0; calls.push([n, v]); return v % n; };
  return { r, calls };
}
// Side s's general one step from his own edge, the foe general far off on the other side; no squads unless asked.
function edge(s, { hp = 42, level = 1, human = null, ruler = false, noWarDeath = false, squads = [] } = {}) {
  const g = G.newGame(4, 1, level), live = g.officers.filter((o) => o.status === 2);
  const rulers = new Set(g.factions?.map?.((f) => f.ruler) || []);
  const pick = live.filter((o) => (ruler ? G.isRuler(g, o.id) : !G.isRuler(g, o.id)));
  const me = pick[0].id, foe = live.find((o) => o.id !== me && !rulers.has(o.id)).id;
  g.noWarDeath = noWarDeath;
  const [aId, dId] = s === 'a' ? [me, foe] : [foe, me];
  const t = new Tactical(g, aId, dId, 2, () => 0, { human });
  t.map = Array.from({ length: GH }, () => Array(GW).fill(0));
  t.side[s].hp = hp;
  const o = s === 'a' ? 'd' : 'a';
  const x = s === 'a' ? 0 : GW - 1, fx = s === 'a' ? GW - 1 : 0;
  t.units = [{ side: s, kind: 'gen', idx: 0, x, y: 4, hp, id: t.side[s].id }, { side: o, kind: 'gen', idx: 0, x: fx, y: 4, hp: t.side[o].hp, id: t.side[o].id },
    ...squads.map(([sx, y, men], i) => ({ side: s, kind: 'inf', idx: i + 1, x: sx, y, hp: men }))];
  t.side[s].cmd.gen = 'retreat';
  return { t, gu: t.units[0], g };
}
const out = (t, gu, values) => { const R = script(values); t.r = R.r; const ev = t.move(gu, gu.side === 'a' ? -1 : GW, gu.y, true); return { ev, calls: R.calls }; };

for (const s of ['a', 'd']) {
  test(`side ${s}: a draw of 31 gets him away untouched, with no damage draw`, () => {
    const { t, gu } = edge(s);
    const { ev, calls } = out(t, gu, [31]);
    assert.equal(ev.type, 'exit'); assert.deepEqual(ev.pursuit, { hit: false, dmg: 0 });
    assert.deepEqual(calls.filter(([n]) => n === 100 || n === 10), [[100, 31]]);
    assert.equal(t.side[s].hp, 42); assert.equal(t.over.why, 'retreat'); assert.equal(t.result()[s].fate, null);
  });
  test(`side ${s}: a draw of 32 is pursued, U(10)=0 costs 5 and 9 costs 14`, () => {
    for (const [roll, dmg] of [[0, 5], [9, 14]]) {
      const { t, gu } = edge(s);
      const { ev } = out(t, gu, [32, roll]);
      assert.deepEqual(ev.pursuit, { hit: true, dmg, rolled: dmg, from: 42 });
      assert.equal(t.side[s].hp, 42 - dmg); assert.equal(gu.hp, 42 - dmg);
      assert.equal(t.result()[s].hp, 42 - dmg); assert.equal(t.result()[s].fate, null); assert.equal(t.over.why, 'retreat');
    }
  });
  test(`side ${s}: HP equal to or under the blow falls to 0 and dies; one more and he lives on 1`, () => {
    for (const [hp, alive] of [[14, false], [3, false], [15, true]]) {
      const { t, gu } = edge(s, { hp });
      const { ev } = out(t, gu, [99, 9]);
      assert.equal(ev.pursuit.dmg, Math.min(hp, 14), 'the loss shown is what he lost');
      assert.equal(t.side[s].hp, alive ? 1 : 0);
      assert.equal(t.result()[s].fate, alive ? null : 'dead');
      assert.equal(t.over.why, alive ? 'retreat' : 'dead');
      assert.equal(!!gu.dead, !alive);
    }
  });
}

test('the rule does not change with difficulty, player or AI', () => {
  for (const level of [0, 1, 2]) for (const human of [null, 'a', 'd']) for (const s of ['a', 'd']) {
    const { t, gu } = edge(s, { level, human });
    assert.deepEqual(out(t, gu, [32, 4]).ev.pursuit, { hit: true, dmg: 9, rolled: 9, from: 42 });
    const e2 = edge(s, { level, human });
    assert.deepEqual(out(e2.t, e2.gu, [31]).ev.pursuit, { hit: false, dmg: 0 });
  }
});

test('a squad leaving the field draws nothing and keeps its men; the general later draws once', () => {
  const { t, gu } = edge('a', { squads: [[0, 6, 80]] });
  const sq = t.units[2];
  const R = script([32, 2]); t.r = R.r;
  const e1 = t.move(sq, -1, sq.y, true);
  assert.equal(e1.type, 'exit'); assert.equal(e1.pursuit, undefined); assert.equal(t.over, null);
  assert.equal(R.calls.filter(([n]) => n === 100).length, 0);
  const e2 = t.move(gu, -1, gu.y, true);
  assert.deepEqual(e2.pursuit, { hit: true, dmg: 7, rolled: 7, from: 42 });
  assert.equal(t.result().a.soldiers, 80, 'the squad that left keeps its men');
  assert.equal(t.side.a.hp, 35);
});

test('a 后退 order short of the edge costs nothing; stepping, reading and rendering after the exit draw no more', () => {
  const { t, gu } = edge('a');
  gu.x = 3;
  const R = script([]); t.r = R.r;
  const mv = t.move(gu, -1, gu.y, true);
  assert.equal(mv.type, 'move'); assert.equal(t.side.a.hp, 42); assert.equal(R.calls.filter(([n]) => n === 100).length, 0);
  gu.x = 0;
  const R2 = script([50, 3]); t.r = R2.r;
  t.move(gu, -1, gu.y, true);
  const n = R2.calls.length, hp = t.side.a.hp;
  for (let i = 0; i < 5; i++) { assert.equal(t.step(), null); t.result(); }
  assert.equal(R2.calls.length, n); assert.equal(t.side.a.hp, hp);
});

test('both at 0 men, the foe general across the field: still the same draw', () => {
  const { t, gu } = edge('d', { hp: 20 });
  assert.equal(t.troops('a') + t.troops('d'), 0);
  assert.equal(out(t, gu, [80, 5]).ev.pursuit.dmg, 10);
  assert.equal(t.side.d.hp, 10);
});

test('武将不战死: a pursuit to 0 takes both officer and ruler captive; off, they die', () => {
  const on = edge('a', { hp: 5, noWarDeath: true });
  assert.equal(out(on.t, on.gu, [99, 9]).ev.pursuit.fell, 'captured');
  assert.equal(on.t.result().a.fate, 'captured'); assert.equal(on.t.result().a.hp, G.SPARED_HP); assert.equal(on.t.over.why, 'capture');
  const ruler = edge('a', { hp: 5, noWarDeath: true, ruler: true });
  assert.equal(out(ruler.t, ruler.gu, [99, 9]).ev.pursuit.fell, 'captured');
  assert.equal(ruler.t.result().a.fate, 'captured');
  const off = edge('a', { hp: 5 });
  assert.equal(out(off.t, off.gu, [99, 9]).ev.pursuit.fell, 'dead');
  const offRuler = edge('a', { hp: 5, ruler: true });
  assert.equal(out(offRuler.t, offRuler.gu, [99, 9]).ev.pursuit.fell, 'dead');
});

test('a general who broke off a 单挑 still faces the 白兵 pursuit when he leaves the field', () => {
  const { t, gu } = edge('a', { hp: 30 });
  t.startDuel('a'); t.side.a.hp = 18; t.duel.result = { retreated: t.side.a.id }; // the duel's own chase already cost 12
  t.resolveDuel();
  assert.equal(gu.hp, 18);
  assert.equal(out(t, gu, [40, 0]).ev.pursuit.dmg, 5);
  assert.equal(t.result().a.hp, 13);
});

test('manual stepping and runAuto agree on the same draws, and the general is pursued once', () => {
  const seq = () => Array.from({ length: 4000 }, (_, i) => (i * 37 + 11) % 256);
  const setup = () => { const e = edge('a', { hp: 25, squads: [[2, 6, 60]] }); e.t.side.a.withdraw = true; const R = script(seq()); e.t.r = R.r; return { ...e, R }; };
  const auto = setup(), resAuto = auto.t.runAuto();
  const man = setup(); let exits = 0;
  for (const s of ['a', 'd']) man.t.aiCommands(s);
  while (!man.t.over) { const ev = man.t.step(); if (ev?.type === 'exit' && ev.pursuit) exits++; if (man.t.duel) man.t.autoDuel(); else if (!ev && !man.t.over) break; }
  assert.deepEqual(man.t.result(), resAuto);
  assert.deepEqual(auto.R.calls, man.R.calls);
  assert.equal(exits, 1);
  assert.equal(resAuto.why === 'retreat' || resAuto.why === 'dead', true);
});
