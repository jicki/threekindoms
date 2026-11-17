// 武将不能读书 (g.noStudy): an option, off by default, chosen on the setup screen or in ☰ 系统 and kept with the record.
// With it on no officer raises 智力 by study: the player's 学问所 is greyed out and the computer's study draw finds no one.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { aiDomestic } from '../src/core/ai.js';
import { startGame, skipIntro, closeMessages, openCmds, cmdRow } from './game.mjs';

const D = JSON.parse(readFileSync(new URL('../data/game-data.json', import.meta.url)));
G.setData(D);

test('G.study refuses while it is on', () => {
  const g = G.newGame(4, 1, 1), cid = D.cities.findIndex((c) => c.facilities.school);
  const id = g.cities[cid].officers[0] ?? g.factions[g.player].ruler;
  g.cities[cid].gold = 100; g.officers[id].int = 50; g.noStudy = true;
  const r = G.study(g, cid, id);
  assert.equal(r.ok, false); assert.equal(g.officers[id].int, 50); assert.equal(g.cities[cid].gold, 100);
  g.noStudy = false;
  assert.equal(G.study(g, cid, id).ok, true);
});

// The computer's domestic loop over many seeds: with the option off some officer studies, with it on none does.
const aiInt = (noStudy) => {
  let raised = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const g = G.newGame(4, 1, seed); if (noStudy) g.noStudy = true;
    for (const c of g.cities) { c.gold = 999; for (const id of c.officers) g.officers[id].int = Math.max(50, Math.min(79, g.officers[id].int)); }
    const before = g.officers.map((o) => o.int);
    for (const f of [0, 1, 2, 3, 5, 6]) aiDomestic(g, f, 60);
    raised += g.officers.filter((o, i) => o.int > before[i]).length;
  }
  return raised;
};
test('the computer studies under the original rules and not with it on', () => {
  assert.ok(aiInt(false) > 0);
  assert.equal(aiInt(true), 0);
});

let game, page;
const errors = [];
const item = () => page.locator('.sysmenu-list button', { hasText: '武将读书' });
const row = () => cmdRow(page, '学问所');
test('browser', async (t) => {
  game = await startGame({ scenario: 'original' }); page = await game.open(); page.on('pageerror', (e) => errors.push(e.message));
  try {
    await t.test('the setup screen offers it, off; a game started with it on carries the flag', async () => {
      await skipIntro(page);
      await page.getByText('新的征程').click();
      const btn = page.locator('.setup-opts .opt', { hasText: '武将不能读书' });
      assert.equal(await btn.getAttribute('aria-pressed'), 'false');
      await btn.click();
      assert.equal(await btn.getAttribute('aria-pressed'), 'true');
      if (process.env.NOSTUDY_SHOT) await page.screenshot({ path: `${process.env.NOSTUDY_SHOT}/setup.png` });
      await page.locator('.level', { hasText: 'LEVEL 1' }).click();
      await page.locator('.ruler', { hasText: '董卓' }).click(); await page.locator('.ruler', { hasText: '董卓' }).click();
      await page.waitForFunction(() => document.body.dataset.screen === 'strategy');
      const stop = closeMessages(page, { aiTurns: true });
      try { await page.waitForFunction(() => { const g = window.__game.g; return g.current === g.player && !document.querySelector('.aiturn, .panel.msg'); }, null, { timeout: 90000 }); } finally { stop(); }
      assert.equal(await page.evaluate(() => window.__game.g.noStudy), true);
    });
    await t.test('学问所 is greyed out with the reason', async () => {
      await openCmds(page, '町');
      assert.equal(await row().isDisabled(), true);
      assert.match(await row().textContent(), /武将不能读书/);
      if (process.env.NOSTUDY_SHOT) await page.screenshot({ path: `${process.env.NOSTUDY_SHOT}/dock.png` });
    });
    await t.test('☰ 系统 shows the state and switches it; the dock follows and the record keeps it', async () => {
      await page.getByRole('button', { name: '☰ 系统', exact: true }).click();
      assert.equal((await item().textContent()).trim(), '武将读书 不能');
      if (process.env.NOSTUDY_SHOT) await page.screenshot({ path: `${process.env.NOSTUDY_SHOT}/sysmenu.png` });
      assert.equal(await page.evaluate(() => { const { g, G } = window.__game; G.save(g, 3); return JSON.parse(localStorage.getItem('haou-hd2d-save:3')).noStudy; }), true);
      await item().click();
      assert.equal((await item().textContent()).trim(), '武将读书 原版');
      assert.equal(await page.evaluate(() => window.__game.g.noStudy), false);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await openCmds(page, '町');
      assert.equal(await row().isDisabled(), false);
      assert.doesNotMatch(await row().textContent(), /武将不能读书/);
      assert.deepEqual(errors, []);
    });
  } finally { await game?.close(); }
});
