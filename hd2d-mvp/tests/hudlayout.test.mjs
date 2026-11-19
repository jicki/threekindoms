// The strategy HUD's panels make way for each other at the sizes the desktop window allows (feedback D47,
// 2026-11-12): the dock and the command list a group opens above it (placeFly, 2026-11-14) never cover the city panel,
// 结束本月行动, the log or the top bar, whichever group is open, and every officer row's numbers can be scrolled into
// full view. src/app.js placeStrategyHud and placeFly, src/ui.css.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, newCampaign, openCmds } from './game.mjs';

let game, page;
before(async () => {
  game = await startGame({ width: 1600, height: 900 }); page = await game.open(); await newCampaign(page, '刘备');
  await page.waitForSelector('.dock');
  // A crowded home city, as in the player's photo: seven officers, a search note and wide top-bar numbers (in memory).
  await page.evaluate(() => {
    const { g, G, strategy } = window.__game, home = g.factions[g.player].city, t = g.cities[home], rulers = new Set(g.factions.map((f) => f.ruler));
    for (const c of g.cities) for (let i = c.officers.length - 1; c !== t && i >= 0 && t.officers.length < 7; i--) if (!rulers.has(c.officers[i])) t.officers.push(...c.officers.splice(i, 1));
    t.gold = 12094; t.rice = 20644; (g.searched ||= {})[home] = { at: g.year * 12 + g.month, what: '发现了米 81' };
    strategy.refresh(g);
    [...document.querySelectorAll('.ctag')].find((e) => e.textContent.includes(G.cityName(home))).click();
  });
  await page.waitForFunction(() => document.querySelectorAll('.citypanel .off').length === 7);
});
after(() => game?.close());

const look = () => page.evaluate(async () => {
  const R = (s) => { const e = document.querySelector(s); return e && e.getClientRects().length ? e.getBoundingClientRect() : null; };
  const ov = (a, b) => (a && b ? Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) : 0);
  const b = { top: R('.topbar'), city: R('.citypanel'), dock: R('.dock'), fly: R('.dock .acts'), end: R('.endturn'), log: R('.rightcol .logbox'), sys: R('.sysbtns') };
  const keys = Object.keys(b), overlaps = [];
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) if (ov(b[keys[i]], b[keys[j]]) > 0) overlaps.push(`${keys[i]}/${keys[j]}`);
  const hidden = [];
  for (const row of document.querySelectorAll('.citypanel .off')) {
    row.scrollIntoView({ block: 'nearest' }); await new Promise((f) => requestAnimationFrame(f));
    for (const el of [row.querySelector('.tr'), row.querySelector('.sub')]) {
      const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.right - 2, r.bottom - 6);
      if (!hit || !el.contains(hit)) hidden.push(row.querySelector('.nm').textContent);
    }
  }
  // The list's notch stands on its group's button: how far its middle is from the button's.
  const on = R('.dock .tabs .btn.on'), cx = b.fly && on ? b.fly.left + parseFloat(getComputedStyle(document.querySelector('.dock .acts')).getPropertyValue('--fly-caret')) : null;
  const caret = cx == null || Number.isNaN(cx) ? null : Math.round(Math.abs(cx - (on.left + on.width / 2)));
  return { overlaps, hidden: [...new Set(hidden)], caret, offscreen: keys.filter((k) => b[k] && (b[k].left < 0 || b[k].top < 0 || b[k].right > innerWidth || b[k].bottom > innerHeight)) };
});

for (const [width, height] of [[1024, 600], [1100, 650], [1101, 650], [1280, 720]]) {
  test(`${width}×${height}: no HUD panel covers another, whichever group is open`, async () => {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(100); // the resize event places the panels
    for (const tab of ['城', '军', '仓', '町']) {
      await openCmds(page, tab);
      await page.mouse.move(3, 3);
      const r = await look();
      assert.deepEqual({ overlaps: r.overlaps, hidden: r.hidden, offscreen: r.offscreen }, { overlaps: [], hidden: [], offscreen: [] }, `${width}×${height} ${tab}`);
      assert.ok(r.caret != null && r.caret <= 2, `${width}×${height} ${tab}: the notch points at its group (${r.caret})`);
    }
  });
}

test('at 1600×900 the dock stays in the middle of the screen', async () => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const mid = () => page.evaluate(() => { const d = document.querySelector('.dock').getBoundingClientRect(); return Math.round(d.left + d.width / 2); });
  await page.waitForFunction(() => innerWidth === 1600);
  await page.waitForTimeout(100); // the resize event places it
  assert.ok(Math.abs((await mid()) - 800) <= 1, String(await mid()));
});

test('resize while the list is open: it is placed again', async () => {
  await page.setViewportSize({ width: 1600, height: 900 }); await page.waitForTimeout(100);
  await openCmds(page, '军');
  await page.setViewportSize({ width: 1024, height: 600 }); await page.waitForTimeout(150);
  const r = await look();
  assert.deepEqual([r.overlaps, r.offscreen], [[], []]); assert.ok(r.caret != null && r.caret <= 2, String(r.caret));
});

test('the dock is as wide closed as with any group open', async () => {
  await page.setViewportSize({ width: 1600, height: 900 }); await page.waitForTimeout(100);
  const w = () => page.evaluate(() => Math.round(document.querySelector('.dock').getBoundingClientRect().width));
  await openCmds(page, '城'); await page.locator('.dock .tabs .btn.on').click(); // closed
  const closed = await w();
  for (const tab of ['城', '町', '军']) { await openCmds(page, tab); assert.equal(await w(), closed, tab); }
});

// The still of a command's 命令演出 stands beside the list, on the side with room, and over no panel.
test('the still stands beside the list, clear of the panels', async () => {
  await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(100);
  await openCmds(page, '城');
  await page.locator('.dock .acts .cmd', { hasText: '开发' }).hover();
  await page.waitForSelector('.cmd-preview.on canvas');
  const r = await page.evaluate(() => {
    const R = (s) => document.querySelector(s)?.getBoundingClientRect(), ov = (a, b) => (a && b ? Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) : 0);
    const pv = R('.cmd-preview'), fly = R('.dock .acts');
    return { over: ['.dock .acts', '.dock .tabs', '.citypanel', '.rightcol .logbox', '.topbar', '.endturn'].filter((s) => ov(pv, R(s)) > 0), beside: pv.right <= fly.left || pv.left >= fly.right, in: pv.left >= 0 && pv.right <= innerWidth && pv.top >= 0 };
  });
  assert.deepEqual(r, { over: [], beside: true, in: true });
  await page.mouse.move(3, 3);
});
