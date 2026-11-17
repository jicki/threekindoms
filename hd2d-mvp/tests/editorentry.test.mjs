// The save editor is reached from the title's 系统 → 记录编辑 and leads back with 返回游戏, as the desktop
// package has no address bar. Unwritten changes are asked about in the page (the desktop shell blocks a
// beforeunload without a dialog), and the title's opening is not replayed on the way back.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, skipIntro, newCampaign } from './game.mjs';

let game, page;
before(async () => { game = await startGame({ scenario: 'original' }); page = await game.open(); });
after(() => game?.close());

test('系统 → 记录编辑 opens the editor and 返回游戏 comes back to the title without its opening', async () => {
  await page.evaluate(() => { const { G } = window.__game; G.save(G.newGame(4, 1, 1), 1); });
  await skipIntro(page);
  await page.click('.sysmenu-btn');
  await page.locator('.sysmenu-list button', { hasText: '记录编辑' }).click();
  await page.waitForFunction(() => location.pathname.endsWith('/save-editor.html') && window.__editor?.g, null, { timeout: 30000 });
  assert.match(page.url(), /\?mute/, 'the query (mute) is kept');

  // an unwritten change: 返回游戏 asks first, and 取消 stays
  await page.evaluate(() => { window.__editor.g.officers[0].war = 1; });
  await page.click('#back');
  await page.locator('.modal', { hasText: '会丢失' }).waitFor();
  await page.locator('.modal button', { hasText: '取消' }).click();
  assert.ok(page.url().includes('save-editor.html'), '取消 stays in the editor');

  await page.click('#back');
  await page.locator('.modal button', { hasText: '放弃并返回' }).click();
  await page.waitForFunction(() => window.__game?.debug && document.querySelector('.tt'), null, { timeout: 60000 });
  assert.match(page.url(), /\/index\.html\?mute$/);
  assert.ok(await page.evaluate(() => !!document.querySelector('.tt.done, .tt.instant')), 'the title shows at once');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('haou-hd2d-save:1')).officers[0].war !== 1), true, 'the change was not written');
});

test('the in-game 系统 menu has no 记录编辑 (a running game would be lost)', async () => {
  await page.click('.sysmenu-btn');
  assert.equal(await page.locator('.sysmenu-list button', { hasText: '记录编辑' }).count(), 1, 'on the title it is there');
  await page.click('.sysmenu-btn');
  await page.getByText('新的征程').click(); await page.waitForTimeout(800);
  await page.locator('.level', { hasText: 'LEVEL 1' }).click();
  await page.locator('.ruler', { hasText: '刘备' }).click(); await page.locator('.ruler', { hasText: '刘备' }).click();
  await page.waitForFunction(() => document.body.dataset.screen === 'strategy');
  await page.waitForFunction(() => !!document.querySelector('.sysmenu-btn'));
  await page.evaluate(() => document.querySelector('.sysmenu-btn').click());
  assert.equal(await page.locator('.sysmenu-list button', { hasText: '记录编辑' }).count(), 0);
});

// 系统 → 回到标题 (devblog #97/#101, 2026-11-03): the way to the title, and so to 记录编辑, without closing the game.
test('回到标题 warns, 取消 stays in the game, and it offers a record first only when one can be made', async () => {
  const p = await game.open(); await newCampaign(p);
  const year = await p.evaluate(() => { window.__game.g.year = 199; return window.__game.g.year; });
  const ask = async () => { await p.click('.sysmenu-btn'); await p.locator('.sysmenu-list button', { hasText: '回到标题' }).click(); await p.locator('.modal', { hasText: '未记录的进度会丢失' }).waitFor(); };
  await ask();
  await p.locator('.modal button', { hasText: '取消' }).click();
  assert.equal(await p.evaluate(() => window.__game.g?.year), year, '取消 keeps the running game');

  await ask();
  await p.keyboard.press('Escape');
  assert.equal(await p.evaluate(() => window.__game.g?.year), year, 'Esc keeps it too');

  // 先记录 then backing out of the slots stays as well, with nothing written
  await ask();
  await p.locator('.modal button', { hasText: '先记录' }).click();
  await p.locator('.modal .slot').first().waitFor();
  await p.locator('.modal button', { hasText: '取消' }).click();
  assert.equal(await p.evaluate(() => window.__game.g?.year), year);
  assert.equal(await p.evaluate(() => window.__game.G.saves().some(Boolean)), false);

  // a record cannot be made now: the dialog says why and has no 先记录
  await p.evaluate(() => window.__game.debug.holdCommand(true));
  await ask();
  assert.equal(await p.locator('.modal button', { hasText: '先记录' }).count(), 0);
  await p.locator('.modal', { hasText: '请先完成当前命令' }).waitFor();
  await p.locator('.modal button', { hasText: '取消' }).click();
  await p.evaluate(() => window.__game.debug.holdCommand(false));
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

const atTitle = (p) => p.waitForFunction(() => document.body.dataset.screen === 'title' && document.querySelector('.tt.done, .tt.instant') && !window.__game.g, null, { timeout: 60000 });
test('先记录 writes the record, then the title shows at once with 记录编辑', async () => {
  const p = await game.open(); await newCampaign(p);
  const year = await p.evaluate(() => { const { g } = window.__game; g.year = 199; return g.year; });
  await p.click('.sysmenu-btn'); await p.locator('.sysmenu-list button', { hasText: '回到标题' }).click();
  await p.locator('.modal button', { hasText: '先记录' }).click();
  await p.locator('.modal .slot').nth(2).click();
  await atTitle(p);
  const rec = await p.evaluate(() => window.__game.G.saves()[2]);
  assert.equal(rec.year, year, 'the record holds the game as it was');
  await p.click('.sysmenu-btn');
  assert.equal(await p.locator('.sysmenu-list button', { hasText: '记录编辑' }).count(), 1);
  assert.equal(await p.locator('.sysmenu-list button', { hasText: '回到标题' }).count(), 0, 'not offered on the title itself');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('不记录 leaves the game for the title with nothing written', async () => {
  const p = await game.open(); await newCampaign(p);
  await p.click('.sysmenu-btn'); await p.locator('.sysmenu-list button', { hasText: '回到标题' }).click();
  await p.locator('.modal button', { hasText: '不记录' }).click();
  await atTitle(p);
  assert.equal(await p.evaluate(() => window.__game.G.saves().some(Boolean)), false);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('no page errors', () => assert.deepEqual(page.errors, []));

// A mouse's side buttons go history back/forward in Chromium and Electron, and a game is never saved on its own:
// a brushed side button after 记录编辑 → 返回游戏 used to drop the running game for the editor page.
test('a mouse side button does not leave a running game', async () => {
  const p = await game.open(); await skipIntro(p);
  await p.click('.sysmenu-btn');
  await p.locator('.sysmenu-list button', { hasText: '记录编辑' }).click();
  await p.waitForFunction(() => location.pathname.endsWith('/save-editor.html') && window.__editor, null, { timeout: 30000 });
  await p.click('#back');
  await p.waitForFunction(() => window.__game?.debug && document.querySelector('.tt'), null, { timeout: 60000 });
  assert.equal(await p.evaluate(() => history.length), 2, 'the trip to the editor and back leaves no history entries (the first is about:blank)');
  await newCampaign(p);
  // an entry to go back to, as a page with history would have: the side buttons must not use it
  await p.evaluate(() => { history.pushState({}, '', location.href); window.__popped = 0; addEventListener('popstate', () => window.__popped++); window.__alive = true; });
  const cdp = await p.context().newCDPSession(p);
  for (const button of ['back', 'forward']) {
    for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: 400, y: 300, button, clickCount: 1 });
  }
  await p.waitForTimeout(1000);
  assert.equal(await p.evaluate(() => window.__alive && window.__popped), 0, 'still in the same game, history untouched');
  assert.equal(await p.evaluate(() => document.body.dataset.screen), 'strategy');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});
