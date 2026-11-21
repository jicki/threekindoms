// 废除同盟 (feedback V01, 2026-10-31): an ally chosen under 谋 → 同盟 is let go for one book, both sides'
// timers cleared and nothing else, as bank 28 $CEAD→$CEC7 does. Rules only, in Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
const D = JSON.parse(readFileSync(new URL('../data/game-data.json', import.meta.url)));
G.setData(D);

function allied() {
  const g = G.newGame(4, 1, 1), me = g.player, [a, b] = g.factions.map((f) => f.id).filter((i) => i !== me);
  for (const [x, y, t] of [[me, a, 7], [me, b, 3], [a, b, 9]]) { g.factions[x].alliance[y] = t; g.factions[y].alliance[x] = t; }
  return { g, me, a, b };
}

test('breaking clears both sides and leaves every other alliance as it was', () => {
  const { g, me, a, b } = allied(), before = g.factions.map((f) => [...f.alliance]);
  const res = G.breakAlliance(g, me, a);
  assert.equal(g.factions[me].alliance[a], 0); assert.equal(g.factions[a].alliance[me], 0);
  for (const f of g.factions) for (const [i, t] of f.alliance.entries()) {
    if ((f.id === me && i === a) || (f.id === a && i === me)) continue;
    assert.equal(t, before[f.id][i], `${f.id}→${i}`);
  }
  assert.equal(g.factions[me].alliance[b], 3); assert.equal(g.factions[a].alliance[b], 9);
  assert.equal(res.ok, true); assert.ok(!res.noBook, 'it spends the book'); assert.equal(res.plain, true);
  assert.match(res.msg, /的同盟已经废除$/);
});

test('it costs nothing but the book: gold, rice, loyalty and officers are untouched', () => {
  const { g, me, a } = allied(), snap = JSON.stringify([g.cities, g.officers]);
  G.breakAlliance(g, me, a);
  assert.equal(JSON.stringify([g.cities, g.officers]), snap);
});
