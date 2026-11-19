// Original-ROM BEC7/BEE6/C298: enter domestic once, charge successful actions only,
// and stop on the third city-scan wrap. These tests exercise the public AI turn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { aiTurn } from '../src/core/ai.js';
import { Tactical } from '../src/core/tactical.js';

const original = JSON.parse(readFileSync(new URL('../data/game-data.json', import.meta.url)));
const io = { event: async () => {}, war: async () => assert.fail('this fixture must not launch a war'), afterWar: async () => {} };

function fixture(owned, { seed = 0, cursor = 0, weights = [0, 0, 1] } = {}) {
  const D = structuredClone(original);
  for (const row of D.rules.ai_dispatch) row.weights = weights;
  D.rules.ai_domestic.faction_development_threshold_out_of_80.fill(0);
  for (const c of D.cities) c.facilities = { weapons: false, school: false, market: false, hospital: false };
  G.setData(D);
  const g = G.newGame(0, 0, seed);
  // No search or medical side effects; each own city holds one distinct, fully equipped officer.
  for (const o of g.officers) Object.assign(o, { status: G.SERVING, int: 80, loyalty: 100, weapon: 23, armor: 7 });
  for (const c of g.cities) Object.assign(c, { faction: G.NONE, officers: [], gold: 0, rice: 0 });
  for (const cid of owned) Object.assign(g.cities[cid], { faction: 4, officers: [cid], gold: 1000 });
  g.factions[4].ruler = owned[0] ?? 20;
  g.aiCursor[4] = cursor;
  return { g, D };
}

for (const [city, cursor, wantDraws] of [[0, 0, 9], [2, 0, 11], [29, 0, 11], [0, 30, 9]]) {
  test(`no eligible work: city ${city}, cursor ${cursor} stops at the third wrap`, async () => {
    const { g } = fixture([city], { cursor });
    let value = g.seed, draws = 0;
    Object.defineProperty(g, 'seed', { get: () => value, set: (v) => { value = v; draws++; }, enumerable: true });
    await aiTurn(g, 4, io);
    assert.equal(g.aiCursor[4], 30, 'save the original terminal cursor, before wrapping it to zero');
    // Two prelude passes of two draws, one main dispatch, then two draws per visited own city.
    assert.equal(draws, wantDraws, 'failed work must reach the scan boundary without repeated main dispatches');
    assert.equal(g.cities[city].gold, 1000);
  });
}

test('empty poor cities do not spend the budget before a later city can work', async () => {
  const { g } = fixture(Array.from({ length: 30 }, (_, i) => i));
  for (const c of g.cities) c.gold = 0;
  g.cities[29].gold = 1000;
  g.officers[29].int = 50;
  g.officers[29].loyalty = 50; // a reward is also useful work if the random choice does not select study
  await aiTurn(g, 4, io);
  assert.ok(g.cities[29].gold < 1000, 'reach city 29 even after more than 26 failed domestic attempts');
  assert.equal(g.aiCursor[4], 30);
});

test('三档好战只给电脑按实际储备和资金补兵，旧档沿用既有规则', async () => {
  for (const [level, want] of [[0, [650, 0, 860]], [1, [800, 0, 840]], [2, [1000, 1000, 600]]]) {
    const { g } = fixture([2]);
    Object.assign(g, { level, warlike: true, warlikeTiers: true });
    const city = g.cities[2];
    city.officers = [2, 3]; city.reserve = 0; g.factions[4].city = city.id;
    for (const id of city.officers) Object.assign(g.officers[id], { soldiers: 0, hp: 99 });
    await aiTurn(g, 4, io);
    // 步长是每 20 金征 100 人，购入后的余兵仍留在该城。
    assert.deepEqual([g.officers[2].soldiers, g.officers[3].soldiers, city.gold], want);
    assert.equal(city.reserve, level === 0 ? 50 : 0);
  }
  const { g } = fixture([2]);
  Object.assign(g, { warlike: true, level: 2 });
  g.officers[2].soldiers = 0;
  await aiTurn(g, 4, io);
  assert.equal(g.officers[2].soldiers, 0);
  assert.equal(g.cities[2].gold, 1000);
});

test('上级好战的收入增幅有上限，玩家、初中级和旧档的收入保持对应原数值', () => {
  for (const level of [0, 1, 2]) for (const kind of ['gold', 'rice']) {
    const { g } = fixture([2, 3]);
    g.level = level; g.cities[3].faction = g.player;
    for (const id of [2, 3]) Object.assign(g.cities[id], { pop: 9000, land: 990, industry: 990, gov: 95 });
    const reference = new Map(G.income(structuredClone(g), kind));
    const legacy = new Map(G.income({ ...structuredClone(g), warlike: true }, kind));
    const stronger = new Map(G.income({ ...g, warlike: true, warlikeTiers: true }, kind));
    assert.deepEqual(legacy, reference);
    assert.equal(stronger.get(3), reference.get(3));
    assert.equal(stronger.get(2), reference.get(2) + (level === 2 ? Math.min(250, Math.floor(reference.get(2) / 5)) : 0));
  }
});

test('after redeployment the turn stays domestic instead of reinforcing again', async () => {
  const { g } = fixture([2], { weights: [0, 16, 0] });
  g.cities[2].officers = [20, 21, 22];
  g.cities[2].gold = 9999;
  g.factions[4].ruler = 20;
  for (const id of [20, 21, 22]) g.officers[id].soldiers = 0;
  await aiTurn(g, 4, io);
  assert.equal(G.troopsOf(g, g.cities[2]), 1000, 'BD7A is run once, before the continuous domestic phase');
});

test('the last successful five-point action stops the domestic phase immediately', async () => {
  const { g, D } = fixture([2]);
  D.rules.books[1] = 1; // ten points, enough for exactly two successful domestic actions
  g.officers[2].int = 50;
  g.officers[2].loyalty = 50; // either reward or study can succeed
  await aiTurn(g, 4, io);
  const spent = 1000 - g.cities[2].gold;
  assert.ok(spent >= 40 && spent <= 58, `exactly two 20–29 gold actions, spent ${spent}`);
  assert.equal(g.aiCursor[4], 2, 'budget exhaustion precedes a third scan wrap');
});

test('A00F runs the prelude twice, reading the dispatch weights between the two passes', async () => {
  const { g, D } = fixture([2]);
  D.cities[2].facilities.market = true;
  D.cities[2].rice_rate = [1, 1]; // gold stays under 50 after the first sale, so the second pass sells too
  Object.assign(g.cities[2], { gold: 0, rice: 2000 });
  g.officers[2].soldiers = 0;
  const riceAtWeights = [], find = D.rules.ai_dispatch.find;
  D.rules.ai_dispatch.find = function (...args) { riceAtWeights.push(g.cities[2].rice); return find.apply(this, args); };
  await aiTurn(g, 4, io);
  assert.deepEqual(riceAtWeights, [1700], 'weights are read once, after the first 300 sale');
  assert.equal(g.cities[2].rice, 1400, 'the second pass sells another 300');
});

function warFixture() {
  const { g, D } = fixture([2], { weights: [16, 0, 0] });
  const target = G.roads(2)[0], source = g.cities[2];
  g.year = 190;
  source.officers = [20, 21, 22, 23, 24];
  Object.assign(source, { gold: 5000, rice: 5000 });
  for (const id of source.officers) Object.assign(g.officers[id], { int: 60, loyalty: 90, soldiers: 1000 });
  g.factions[4].ruler = 20;
  Object.assign(g.cities[target], { faction: 0, officers: [100], gold: 100, rice: 100 });
  Object.assign(g.officers[100], { soldiers: 1000, loyalty: 90 });
  return { g, D, source };
}

// A8D7 settles the war and ends through CA19 in JMP $BEC7: one expedition, then domestic work on the rest.
for (const defender of ['player', 'ai']) {
  test(`after a war against the ${defender} the turn goes on to domestic work`, async () => {
    let fought = 0;
    for (let seed = 0; seed < 40 && !fought; seed++) {
      const { g, source } = warFixture();
      g.seed = seed;
      g.factions[0].ai = defender === 'ai';
      let goldAfterWar = null;
      await aiTurn(g, 4, {
        event: async () => {},
        war: async () => { goldAfterWar = source.gold; },
        afterWar: async () => { goldAfterWar = source.gold; },
      });
      if (goldAfterWar == null) continue; // this seed drew the vacant-city branch instead
      fought++;
      assert.ok(source.gold < goldAfterWar, `spent ${goldAfterWar - source.gold} gold after the war`);
    }
    assert.equal(fought, 1, 'one of the seeds launches the war');
  });
}

// 电脑好战 (g.warlike): defenders+2 instead of +3 at the source, A303 givers one below their threshold, one fewer
// kept at home. No draw is added, so a seed takes the same branches with the option on or off.
async function march(g) {
  let war = null;
  await aiTurn(g, 4, { event: async () => {}, war: async (w) => { war = w; }, afterWar: async () => {} });
  return war;
}
function warlikeFixture(seed, warlike, { source = 5, defenders = 3 } = {}) {
  const { g, source: src } = warFixture();
  g.seed = seed; g.factions[0].ai = false; if (warlike) g.warlike = true;
  src.officers = [20, 21, 22, 23, 24, 25, 26, 27, 28].slice(0, source);
  for (const id of src.officers) Object.assign(g.officers[id], { int: 60, loyalty: 90, soldiers: 1000 });
  const target = g.cities[G.roads(2)[0]];
  target.officers = [100, 101, 102, 103, 104].slice(0, defenders);
  for (const id of target.officers) Object.assign(g.officers[id], { soldiers: 1000, loyalty: 90 });
  return { g, src, target };
}

test('电脑好战 is off in a new game and the original needs defenders+3 at the source', async () => {
  for (let seed = 0; seed < 40; seed++) {
    const { g } = warlikeFixture(seed, false);
    assert.equal(g.warlike, undefined);
    assert.equal(await march(g), null, `seed ${seed}: five officers do not march on three`);
  }
});

test('电脑好战: defenders+2 at the source is enough to march', async () => {
  let wars = 0;
  for (let seed = 0; seed < 40; seed++) { const { g } = warlikeFixture(seed, true); if (await march(g)) wars++; }
  assert.ok(wars > 20, `most seeds march (the rest draw the empty-city branch), got ${wars}`);
  for (let seed = 0; seed < 40; seed++) { const { g } = warlikeFixture(seed, true, { source: 4 }); assert.equal(await march(g), null, 'defenders+1 is still not enough'); }
});

test('电脑好战: one fewer stays behind, on the same draws, and never nobody', async () => {
  let compared = 0;
  for (let seed = 0; seed < 40; seed++) {
    const off = await march(warlikeFixture(seed, false, { source: 6, defenders: 1 }).g);
    const on = warlikeFixture(seed, true, { source: 6, defenders: 1 }), war = await march(on.g);
    assert.equal(!!off, !!war, `seed ${seed}: the option does not change which branch is drawn`);
    if (!off) continue;
    compared++;
    assert.equal(war.att.ids.length, Math.min(5, off.att.ids.length + 1));
    assert.ok(on.src.officers.length >= 1);
  }
  assert.ok(compared > 20);
});

// A303 for 刘备: a rear city gives while it holds 3 (original) or 2 (好战); the last officer never leaves.
function gatherFixture(seed, warlike, rear) {
  const { g, src, target } = warlikeFixture(seed, warlike, { source: 2, defenders: 1 });
  const front = new Set(G.roads(target.id)), givers = [];
  g.factions[4].ruler = 39; // in no city: C50E would otherwise walk the ruler out of the frontier source first
  let id = 40;
  for (const a of G.roads(2)) for (const b of [a, ...G.roads(a)]) {
    const c = g.cities[b];
    if (c === src || c === target || c.faction === 4 || front.has(b)) continue;
    c.faction = 4; c.officers = []; c.gold = 1000;
    for (let k = 0; k < rear; k++, id++) { c.officers.push(id); Object.assign(g.officers[id], { int: 60, loyalty: 90, soldiers: 1000 }); }
    givers.push(c);
  }
  assert.ok(givers.length >= 2, 'the fixture has rear cities to draw on');
  return { g, src, givers };
}

test('电脑好战: rear cities give down to one officer, the original keeps them at two', async () => {
  let wars = 0;
  for (let seed = 0; seed < 40; seed++) {
    const off = gatherFixture(seed, false, 2);
    assert.equal(await march(off.g), null, 'original: no city holds its threshold of three, so nobody gathers');
    assert.ok(off.givers.every((c) => c.officers.length === 2));
    const on = gatherFixture(seed, true, 2);
    if (await march(on.g)) wars++;
    assert.ok(on.givers.every((c) => c.officers.length >= 1 && c.faction === 4), 'no city is emptied');
    const last = gatherFixture(seed, true, 1);
    assert.equal(await march(last.g), null, 'a last officer is never taken');
    assert.ok(last.givers.every((c) => c.officers.length === 1));
  }
  assert.ok(wars > 20, `gathered and marched on most seeds, got ${wars}`);
});

test('a faction without a city terminates its scan', async () => {
  const { g } = fixture([]);
  await aiTurn(g, 4, io);
  assert.equal(g.cities.some((c) => c.faction === 4), false);
});

// D3C7/D594: counts 2/3/4..11 use thresholds 40/70/100. The four-threat layout
// was checked against all 256 original RNG cursors in the preceding investigation.
for (const side of ['a', 'd']) for (const [count, draw, fires] of [[2, 39, true], [2, 40, false], [3, 69, true], [3, 70, false], [4, 90, true], [6, 99, true]]) {
  test(`side ${side}: ${count} fire threats, draw ${draw} ${fires ? 'uses' : 'skips'} fire arrows`, () => {
    G.setData(structuredClone(original));
    const g = G.newGame(4, 0, 0), t = new Tactical(g, 20, 21, 2, () => 0);
    const foe = side === 'a' ? 'd' : 'a';
    t.units = [
      { side, kind: 'gen', idx: 0, x: 0, y: 0, hp: 99, id: 20 },
      { side, kind: 'arc', idx: 1, x: 6, y: 5, hp: 100, id: 20 },
      { side: foe, kind: 'gen', idx: 0, x: 15, y: 9, hp: 99, id: 21 },
      ...[[6, 3], [6, 7], [6, 2], [6, 8], [3, 5], [4, 5]].slice(0, count).map(([x, y], i) => ({ side: foe, kind: 'inf', idx: i + 1, x, y, hp: 100, id: 21 })),
    ];
    t.side[side].tp = 10; // blast cannot precede fire
    t.r = (n) => Math.min(draw, n - 1);
    t.aiTactic(side);
    assert.equal(!!t.side[side].fx.fire, fires);
    if (fires) assert.equal(t.side[side].tp, 0);
  });
}
