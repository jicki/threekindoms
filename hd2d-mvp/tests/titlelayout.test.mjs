// D41: menu and legal/credit text share the available height at every save/suspension state.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { setupWar } from '../src/core/warcore.js';
import { Field } from '../src/core/field.js';
import { startGame, skipIntro } from './game.mjs';
G.setData(JSON.parse(readFileSync(new URL('../data/game-data.json', import.meta.url))));
let game;
const layouts = [];
before(async () => { game = await startGame({ scenario: 'original' }); });
after(async () => { await game?.close(); if (capture) writeFileSync(`${capture}/layouts.json`, '[\n' + layouts.map(r => JSON.stringify(r)).join(',\n') + '\n]\n'); });
const sizes = [[1280, 800], [800, 600], [1280, 720], [1024, 768], [1920, 1080], [1440, 900]];
const capture = process.env.TITLE_CAPTURE;
if (capture) mkdirSync(capture, { recursive: true });
function storage(count, held) {
  const records = {}, g = G.newGame(2, 1, 1);
  for (let i = 1; i <= count; i++) records[`haou-hd2d-save:${i}`] = JSON.stringify({ ...g, version: G.SAVE_VERSION, savedAt: i, slot: i });
  if (held) {
    const ids = g.cities[14].officers.slice(0, 2), war = setupWar(g, { from: 14, to: 12, ids, commander: ids[0], gold: 50, rice: 500 });
    records['haou-hd2d-suspend'] = JSON.stringify({ version: 1, savedAt: 1, g: { ...g, version: G.SAVE_VERSION }, war,
      side: 'att', start: Object.fromEntries([...war.att.ids, ...war.def.ids].map(id => [id, g.officers[id].soldiers])),
      after: { kind: 'att' }, field: new Field(g, war, 'att').snapshot() });
  }
  return records;
}
for (const count of [0, 1, 2]) for (const held of [false, true]) test(`${count} records, suspended battle ${held}: all buttons and footer fit without overlap, also after resize`, async () => {
  const page = await game.open('', { setup: ctx => ctx.addInitScript(records => {
    for (const [k, v] of Object.entries(records)) localStorage.setItem(k, v);
    sessionStorage.setItem('hd2d-title-seen', '1');
  }, storage(count, held)) });
  try {
    await skipIntro(page);
    await page.waitForFunction(() => !!document.querySelector('.tt-menu')?.style.top);
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('.tt-menu > button').count(), 1 + (count > 0 ? 1 : 0) + (count > 1 ? 1 : 0) + (held ? 1 : 0));
    const issues = [], check = (ok, message) => { if (!ok) issues.push(message); };
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      const rects = await page.evaluate(() => {
        const rect = e => { const { top, bottom, left, right, width, height } = e.getBoundingClientRect(); return { top, bottom, left, right, width, height }; };
        return { menu: rect(document.querySelector('.tt-menu')), foot: rect(document.querySelector('.tt-foot')), band: rect(document.querySelector('.tt-band')),
          buttons: [...document.querySelectorAll('.tt-menu > button')].map(rect) };
      });
      layouts.push({ count, held, width, height, ...rects });
      if (capture) await page.screenshot({ path: `${capture}/title-${count}-${held}-${width}x${height}.png` });
      const label = `${width}x${height}: ${JSON.stringify(rects)}`;
      check(rects.menu.bottom + 12 <= rects.foot.top, `menu leaves footer a readable gap: ${label}`);
      check(rects.band.bottom + 12 <= rects.menu.top, `menu stays below the landscape: ${label}`);
      for (const r of [...rects.buttons, rects.foot]) check(r.top >= 0 && r.bottom <= height && r.left >= 0 && r.right <= width, `visible within window: ${label}`);
      for (let i = 0; i < rects.buttons.length; i++) for (const b of rects.buttons.slice(i + 1)) {
        const a = rects.buttons[i]; check(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, `buttons don't overlap: ${label}`);
      }
    }
    if (capture) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
      await page.screenshot({ path: `${capture}/title-${count}-${held}-1440x900-2x.png` });
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp.detach();
    }
    // A late font metric change must reserve space without requiring another window resize.
    await page.evaluate(() => { document.querySelector('.tt-foot p').style.fontSize = '24px'; });
    await page.waitForFunction(() => document.querySelector('.tt-menu').getBoundingClientRect().bottom + 12 <= document.querySelector('.tt-foot').getBoundingClientRect().top, null, { timeout: 3000 }).catch(() => issues.push('footer font growth overlaps the menu'));
    assert.deepEqual(issues, []);
    assert.deepEqual(page.errors, []);
  } finally { await page.close(); }
});
