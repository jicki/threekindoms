// 电脑好战 (g.warlike): an option, off by default, chosen on the setup screen or in ☰ 系统 and kept with the record.
// What it changes in the AI's march is tested in ai.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, skipIntro, closeMessages } from './game.mjs';

let game, page;
const errors = [];
before(async () => { game = await startGame({ scenario: 'original' }); page = await game.open(); page.on('pageerror', (e) => errors.push(e.message)); });
after(() => game?.close());

const item = () => page.locator('.sysmenu-list button', { hasText: '电脑进攻' });

test('the setup screen offers it, off, and a game started with it on carries the flag', async () => {
  await skipIntro(page);
  await page.getByText('新的征程').click();
  const btn = page.locator('.setup-opts .opt', { hasText: '电脑好战' });
  assert.equal(await btn.getAttribute('aria-pressed'), 'false');
  await btn.click();
  assert.equal(await btn.getAttribute('aria-pressed'), 'true');
  if (process.env.WARLIKE_SHOT) await page.screenshot({ path: `${process.env.WARLIKE_SHOT}/setup.png` });
  await page.locator('.level', { hasText: 'LEVEL 1' }).click();
  await page.locator('.ruler', { hasText: '曹操' }).click(); await page.locator('.ruler', { hasText: '曹操' }).click();
  await page.waitForFunction(() => document.body.dataset.screen === 'strategy');
  const stop = closeMessages(page, { aiTurns: true });
  try { await page.waitForFunction(() => { const g = window.__game.g; return g.current === g.player && !document.querySelector('.aiturn, .panel.msg'); }, null, { timeout: 90000 }); } finally { stop(); }
  assert.equal(await page.evaluate(() => window.__game.g.warlike), true);
});

test('☰ 系统 shows the state and switches it; the record keeps it', async () => {
  await page.getByRole('button', { name: '☰ 系统', exact: true }).click();
  assert.equal((await item().textContent()).trim(), '电脑进攻 好战');
  if (process.env.WARLIKE_SHOT) await page.screenshot({ path: `${process.env.WARLIKE_SHOT}/sysmenu.png` });
  assert.equal(await page.evaluate(() => { const { g, G } = window.__game; G.save(g, 3); return JSON.parse(localStorage.getItem('haou-hd2d-save:3')).warlike; }), true);
  await item().click();
  assert.equal((await item().textContent()).trim(), '电脑进攻 原版');
  assert.equal(await page.evaluate(() => window.__game.g.warlike), false);
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
});
