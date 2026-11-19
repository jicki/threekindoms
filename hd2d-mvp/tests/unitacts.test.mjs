// The selected general's commands must leave his move cells clickable (group feedback G01, 2026-11-04). Since D32 they stand in his
// card whoever he is and wherever he stands (they used to stand beside him and dock into the card where every spot covered a cell):
// on the flat and the 3D map, at the edges and in a crowd, no command and no card takes the click of a move cell.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startGame, newCampaign, closeMessages, warRest } from './game.mjs';

const SIZES = [{ width: 1440, height: 900 }, { width: 1024, height: 600 }];

// A campaign's first field, deployed, on the player's turn.
async function field(game, query, opts) {
  const p = await game.open(query, opts);
  await p.evaluate(async () => { (await import('./src/pace.js')).setPace(4); (await import('./src/vignette.js')).setVignettes(false); });
  await newCampaign(p, '董卓');
  await p.evaluate(() => {
    const { g, G, debug } = window.__game, home = g.factions[g.player].city;
    const to = G.roads(home).map((c) => g.cities[c]).find((c) => c.faction !== g.player && c.faction !== G.NONE && c.officers.length);
    for (const id of [...g.cities[home].officers, ...to.officers]) g.officers[id].soldiers ||= 500;
    const ids = g.cities[home].officers.slice(0, 3);
    debug.fieldWar(debug.setupWar(g, { from: home, to: to.id, ids, commander: ids[0], gold: 100, rice: 400 }), 'att');
  });
  await p.waitForFunction(() => !!window.__game.war?.finishDeploy);
  const stop = closeMessages(p);
  try {
    await p.waitForTimeout(1000);
    await p.evaluate(() => window.__game.war.finishDeploy());
    await p.waitForFunction(() => { const v = window.__game.war; return v.field.turn === v.field.human && !document.querySelector('.banner,.panel.msg'); }, null, { timeout: 60000 });
  } finally { stop(); }
  return p;
}

// Selects the first general at (x, y) with this much mobility and reports every move cell a command or a card takes the click of.
const select = (p, at, pool) => p.evaluate(async ({ at, pool }) => {
  const v = window.__game.war, f = v.field, u = f.side(f.human)[0];
  v.cancel(); v.cancel();
  if (at && !f.unitAt(...at)) { u.x = at[0]; u.y = at[1]; }
  f.pool[f.human] = pool; v.clickCell(u.x, u.y);
}, { at, pool });

const coverage = (p) => p.evaluate(() => {
  const v = window.__game.war, marks = v.flatState().marks.filter((m) => m.kind === 'move');
  const taken = marks.flatMap((m) => {
    const c = v.screenOf(m.x, m.y);
    if (c.x < 0 || c.y < 0 || c.x >= innerWidth || c.y >= innerHeight) return [];
    // The flat board has its band to itself; on the 3D map the camera slides the cells out from under the cards, so only the bar counts.
    const by = document.elementFromPoint(c.x, c.y)?.closest(v.flat ? '.unitacts, .unitpanel, .actpanel, .war-rosterbtn' : '.unitacts, .actpanel, .war-rosterbtn');
    return by ? [{ x: m.x, y: m.y, by: by.className }] : [];
  });
  const buttons = [...document.querySelectorAll('.unitpanel:not(.compare) .acts button')].filter((b) => b.checkVisibility({ visibilityProperty: true })).map((b) => b.textContent);
  return { flat: !!v.flat, moves: marks.length, taken, buttons };
});

for (const [view, query] of [['flat', '&flat'], ['3D', '']]) {
  test(`no command covers a move cell (${view})`, { timeout: 300000 }, async () => {
    const game = await startGame(SIZES[0]);
    try {
      // On the 3D map each camera move is run on to rest by the view's own update (tests/game.mjs warRest jump): the test looks
      // at where the cells and the bar end up, not at the ease.
      const p = await field(game, query, { clock: view === '3D' });
      const rest = () => (view === '3D' ? warRest(p, { jump: true }) : null);
      for (const size of SIZES) {
        await p.setViewportSize(size); await p.waitForTimeout(500); await rest();
        for (const [at, pool] of [[null, 30], [[15, 10], 30], [[10, 10], 30], [[20, 10], 30], [[15, 7], 30], [[0, 5], 30], [[31, 5], 30], [[15, 10], 3], [[20, 10], 1]]) {
          await select(p, at, pool); await rest(); await p.waitForTimeout(view === '3D' ? 250 : 150); // the 3D camera comes to rest and the bar settles (its .16 s actsIn)
          const r = await coverage(p), where = `${size.width}×${size.height} at ${at ?? 'start'} pool ${pool}`;
          assert.equal(r.flat, view === 'flat');
          assert.deepEqual(r.taken, [], `${where}: ${r.moves} move cells, these take no click: ${JSON.stringify(r.taken)}`);
          assert.ok(r.buttons.includes('退却') || r.buttons.includes('计略'), `${where}: his commands stay reachable: ${JSON.stringify(r.buttons)}`);
        }
      }
      assert.deepEqual(p.errors, []);
    } finally { await game.close(); }
  });
}

// 计略 opens its list in the action panel, on the screen at the smallest window.
test('the 计略 list opens from the card and fits the window (flat)', { timeout: 180000 }, async () => {
  const game = await startGame(SIZES[1]);
  try {
    const p = await field(game, '&flat');
    await select(p, [15, 7], 30); await p.waitForTimeout(200);
    await p.locator('.unitpanel:not(.compare) .acts button', { hasText: '计略' }).click();
    await p.waitForSelector('.actpanel.strats'); await p.waitForTimeout(250);
    const r = await p.evaluate(() => { const b = document.querySelector('.actpanel').getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, W: innerWidth, H: innerHeight }; });
    assert.ok(r.l >= 0 && r.r <= r.W && r.t >= 0 && r.b <= r.H, JSON.stringify(r));
    await p.keyboard.press('Escape');
    assert.deepEqual(p.errors, []);
  } finally { await game.close(); }
});

// What the players did: a cell the bar used to sit on is walked to with a real click, and the general selected again keeps it so.
test('a walk to a cell next to him is a real click, and selecting him again leaves the cells clear (flat)', { timeout: 180000 }, async () => {
  const game = await startGame(SIZES[1]);
  try {
    const p = await field(game, '&flat');
    await select(p, [15, 7], 30); await p.waitForTimeout(150);
    const to = await p.evaluate(() => { const v = window.__game.war, u = v.st.sel, ms = v.flatState().marks.filter((m) => m.kind === 'move'); const m = ms.sort((a, b) => (Math.abs(a.x - u.x - 2) + Math.abs(a.y - u.y)) - (Math.abs(b.x - u.x - 2) + Math.abs(b.y - u.y)))[0]; const c = v.screenOf(m.x, m.y); return { x: m.x, y: m.y, px: c.x, py: c.y, id: u.id }; });
    await p.mouse.click(to.px, to.py);
    await p.waitForFunction(({ x, y, id }) => { const v = window.__game.war, u = v.field.alive.find((a) => a.id === id); return u.x === x && u.y === y && !v.st.busy; }, to, { timeout: 20000 });
    await p.evaluate(({ x, y }) => { const v = window.__game.war; v.cancel(); v.cancel(); v.field.pool[v.field.human] = 30; v.clickCell(x, y); }, to);
    await p.waitForTimeout(200);
    assert.deepEqual((await coverage(p)).taken, []);
    assert.deepEqual(p.errors, []);
  } finally { await game.close(); }
});

// The 攻击 confirmation stands in the action panel (D32 §6), whole on the screen, whatever cells are round the target.
test('the attack confirmation stays up among move cells', { timeout: 180000 }, async () => {
  const game = await startGame(SIZES[0]);
  try {
    const p = await field(game, '&flat');
    const ok = await p.evaluate(() => {
      const v = window.__game.war, f = v.field, u = f.side(f.human)[0], t = f.alive.find((a) => a.side !== f.human);
      const spots = f.map.flatMap((row, y) => row.map((_, x) => [x, y]));
      const pair = spots.find(([x, y]) => [y, y + 1].every((row) => f.inside(x, row)
        && !f.unitAt(x, row) && f.deployable(x, row) && f.terr(x, row) === 2));
      if (!pair) throw new Error('缺少两个相邻的空地格');
      [t.x, t.y] = pair;
      u.x = t.x; u.y = t.y + 1; f.pool[f.human] = 30;
      v.clickCell(u.x, u.y); v.clickCell(t.x, t.y);
      return !!document.querySelector('.actpanel.strike');
    });
    assert.ok(ok, 'the attack confirmation was asked');
    await p.waitForTimeout(200);
    const ask = await p.evaluate(() => { const e = document.querySelector('.actpanel.strike'), r = e.getBoundingClientRect(), g = e.querySelector('.ap-go').getBoundingClientRect(); return { on: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && g.bottom <= r.bottom, text: e.textContent }; });
    assert.ok(ask.on, `the confirmation is on screen: ${ask.text}`);
    assert.deepEqual(p.errors, []);
  } finally { await game.close(); }
});

// The commands have a place of their own in the card: nothing in it runs under them or out of it, with the foe's card beside it or not.
test('the commands in the card cover none of it (flat)', { timeout: 240000 }, async () => {
  const game = await startGame(SIZES[0]);
  try {
    const p = await field(game, '&flat');
    for (const width of [1024, 1201, 1280, 1366, 1381, 1440, 1700, 1860, 1920]) {
      await p.setViewportSize({ width, height: width > 1100 ? 800 : 600 }); await p.waitForTimeout(400);
      for (const compare of [false, true]) {
        await select(p, [15, 7], 30); await p.waitForTimeout(200);
        if (compare) await p.evaluate(() => { const v = window.__game.war, f = v.field, t = f.alive.find((a) => a.side !== f.human); v.clickCell(t.x, t.y); });
        await p.waitForTimeout(150);
        const r = await p.evaluate(() => {
          const card = document.querySelector('.unitpanel:not(.compare)'), acts = card.querySelector('.acts'), band = innerHeight - (innerWidth <= 1200 ? 196 : 128);
          const box = acts?.getBoundingClientRect(), edge = card.getBoundingClientRect(), lines = (c) => [...c.querySelectorAll('.bar b, dd, .gear span, h3')].map((e) => { const g = document.createRange(); g.selectNodeContents(e); const b = g.getBoundingClientRect(); return { t: e.textContent, l: b.left, r: b.right, top: b.top, bottom: b.bottom }; });
          const under = acts?.childElementCount ? lines(card).filter((b) => b.r > box.left && b.l < box.right && b.bottom > box.top && b.top < box.bottom).map((b) => b.t) : [];
          const out = [...document.querySelectorAll('.unitpanel')].flatMap((c) => { const e = c.getBoundingClientRect(); return lines(c).filter((b) => b.r > e.right + 0.5).map((b) => `${c.className}: ${b.t}`); });
          const meet = [...document.querySelectorAll('.unitpanel, .logbox, .wardock')].map((e) => e.getBoundingClientRect());
          return { docked: !!acts?.childElementCount, under, out, cardTop: edge.top, band, overlaps: meet.flatMap((a, i) => meet.slice(i + 1).filter((b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top).map(() => 1)).length };
        });
        const where = `${width} compare ${compare}`;
        assert.ok(r.docked || compare, `${where}: his commands are in his card`);
        assert.deepEqual(r.under, [], `${where}: under the commands`);
        assert.deepEqual(r.out, [], `${where}: out of the card`);
        assert.equal(r.overlaps, 0, `${where}: the cards and the log keep apart`);
        assert.ok(r.cardTop >= r.band - 1 - (width > 1200 ? 0 : 196), `${where}: the card stays in its band (${r.cardTop} vs ${r.band})`);
      }
    }
    assert.deepEqual(p.errors, []);
  } finally { await game.close(); }
});
