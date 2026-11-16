// Quick save is a separate record: the shortcut follows the same book rules and never discards a game silently.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, newCampaign, skipIntro } from './game.mjs';

let game, page;
const KEY = 'haou-hd2d-save:quick';
const idle = () => page.waitForFunction(() => {
  const g = window.__game?.g;
  return g && g.current === g.player && document.body.dataset.screen === 'strategy' && document.querySelector('.citypanel')
    && !document.querySelector('.banner, .panel.msg, .shade, #fade.on, .vig');
}, null, { timeout: 60000 });
const books = () => page.evaluate(() => window.__game.g.books);
const record = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
const dialog = () => page.locator('.shade .modal');
const accept = async () => { await dialog().locator('.btn.primary').click(); await page.waitForSelector('.shade', { state: 'detached' }); };
const cancel = async () => { await dialog().locator('.btn', { hasText: '取消' }).click(); await page.waitForSelector('.shade', { state: 'detached' }); };
before(async () => { game = await startGame(); page = await game.open(); await newCampaign(page, '曹操'); await idle(); });
after(() => game?.close());

test('first quick save explains the book cost and cancellation spends nothing', async () => {
  const before = await books();
  await page.keyboard.press('F2');
  await dialog().waitFor({ timeout: 4000 });
  assert.match(await dialog().innerText(), /命令书/);
  await cancel();
  assert.equal(await books(), before);
  assert.equal(await record(), null);
  await page.keyboard.press('F2');
  await dialog().waitFor({ timeout: 4000 });
  await accept();
  await page.waitForFunction((k) => !!localStorage.getItem(k), KEY);
  await page.waitForFunction((n) => window.__game.g.books === n, before - 1);
  assert.equal((await record()).books, before - 1);
  assert.equal(await page.evaluate(() => window.__game.g.slot ?? null), null);
});

test('free recording saves without a book, and a held key does not repeatedly save', async () => {
  const previous = await record();
  await page.evaluate(() => { window.__game.g.freeSave = true; window.__game.g.year = 200; });
  const before = await books();
  await page.keyboard.down('F2');
  await page.keyboard.down('F2');
  await page.keyboard.up('F2');
  await page.waitForFunction((k) => JSON.parse(localStorage.getItem(k))?.year === 200, KEY);
  assert.equal(await books(), before);
  assert.equal((await record()).books, before);
  assert.equal(await page.evaluate((k) => JSON.parse(localStorage.getItem(`${k}:bak`)).year, KEY), previous.year);
});

test('a failed quick save preserves the running progress, books and previous quick record', async () => {
  const before = await books(), old = await page.evaluate((k) => localStorage.getItem(k), KEY);
  await page.evaluate((k) => {
    const real = Storage.prototype.setItem;
    window.__quickRestoreStorage = () => { Storage.prototype.setItem = real; };
    Storage.prototype.setItem = function (key, value) { if (key === k) throw new Error('quota'); return real.call(this, key, value); };
  }, KEY);
  try {
    await page.evaluate(() => { window.__game.g.year = 201; });
    await page.keyboard.press('F2');
    await page.getByText(/记录失败/).first().waitFor({ timeout: 4000 });
    assert.equal(await books(), before);
    assert.equal(await page.evaluate((k) => localStorage.getItem(k), KEY), old);
  } finally { await page.evaluate(() => window.__quickRestoreStorage()); }
});

test('a different campaign cannot overwrite the quick record without confirmation', async () => {
  const old = await page.evaluate((k) => localStorage.getItem(k), KEY);
  const id = await page.evaluate(() => { const g = window.__game.g, id = g.quickId; g.quickId = 'another-campaign'; return id; });
  await page.keyboard.press('F2');
  await dialog().waitFor({ timeout: 4000 });
  assert.match(await dialog().innerText(), /覆盖/);
  await cancel();
  assert.equal(await page.evaluate((k) => localStorage.getItem(k), KEY), old);
  await page.evaluate((id) => { window.__game.g.quickId = id; }, id);
});

test('the last book requires confirmation before ending the month', async () => {
  await page.evaluate(() => { window.__game.g.freeSave = false; window.__game.g.books = 1; });
  await page.keyboard.press('F2');
  await dialog().waitFor({ timeout: 4000 });
  assert.match(await dialog().innerText(), /本月|结束/);
  await cancel();
  assert.equal(await books(), 1);
  await page.evaluate(() => { window.__game.g.freeSave = true; window.__game.g.books = 3; });
});

test('F8 can be cancelled; after confirmation it loads the quick record without binding a numbered slot', async () => {
  await page.evaluate(() => {
    const { g, G } = window.__game;
    g.cities[g.factions[g.player].city].gold = 4321; G.save(g, 2);
  });
  await page.keyboard.press('F2');
  await page.waitForFunction((k) => JSON.parse(localStorage.getItem(k))?.cities[window.__game.g.factions[window.__game.g.player].city].gold === 4321, KEY);
  await page.evaluate(() => { const g = window.__game.g; g.cities[g.factions[g.player].city].gold = 1234; });
  await page.keyboard.press('F8');
  await dialog().waitFor({ timeout: 4000 });
  assert.match(await dialog().innerText(), /未记录|未保存|丢失/);
  await cancel();
  assert.equal(await page.evaluate(() => { const g = window.__game.g; return g.cities[g.factions[g.player].city].gold; }), 1234);
  await page.keyboard.press('F8');
  await dialog().waitFor({ timeout: 4000 });
  await Promise.all([page.waitForEvent('load', { timeout: 30000 }), accept()]);
  await idle();
  assert.equal(await page.evaluate(() => { const g = window.__game.g; return g.cities[g.factions[g.player].city].gold; }), 4321);
  assert.equal(await page.evaluate(() => window.__game.g.slot), null);
  await page.click('.sysmenu-btn');
  await page.locator('.sysmenu-list button', { hasText: '记录进度' }).click();
  await page.locator('.shade .slot', { hasText: '记录二' }).click();
  await page.locator('.shade .modal', { hasText: '覆盖记录' }).waitFor({ timeout: 4000 });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await idle();
});

test('a quick record replaced while its read confirmation is open is not silently loaded', async () => {
  await page.evaluate(() => {
    const { g, G } = window.__game;
    g.freeSave = true; G.saveQuick(g); window.__quickSentinel = true;
  });
  await page.keyboard.press('F8');
  await dialog().waitFor({ timeout: 4000 });
  await page.evaluate(() => { const { g, G } = window.__game; G.saveQuick({ ...g, year: g.year + 1 }); });
  await dialog().locator('.btn.primary').click();
  await page.waitForTimeout(900);
  assert.equal(await page.evaluate(() => window.__quickSentinel), true, 'the old game remains open');
  await page.getByText(/记录已改变/).first().waitFor({ timeout: 4000 });
  await page.evaluate(() => { const { g, G } = window.__game; G.saveQuick(g); });
});

test('a quick record replaced while its overwrite confirmation is open is not silently overwritten', async () => {
  await page.evaluate(() => {
    const { g, G } = window.__game;
    g.freeSave = true; G.saveQuick(g); g.quickId = 'a-different-campaign';
  });
  await page.keyboard.press('F2');
  await dialog().waitFor({ timeout: 4000 });
  const replacement = await page.evaluate((k) => {
    const { g, G } = window.__game; G.saveQuick({ ...g, quickId: 'third-campaign', year: 202 });
    return localStorage.getItem(k);
  }, KEY);
  await accept();
  assert.ok(await page.evaluate(({ k, replacement }) => localStorage.getItem(k) === replacement, { k: KEY, replacement }), 'the other tab\'s record survives');
  await page.getByText(/存档已改变/).first().waitFor({ timeout: 4000 });
  await page.evaluate(() => { const { g, G } = window.__game; g.quickId = 'third-campaign'; G.saveQuick(g); });
});

test('the quick record is visible at the top of the record picker on a small window', async () => {
  await page.evaluate(() => { const { g, G } = window.__game; G.saveQuick(g); G.save(g, 1); });
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.click('.sysmenu-btn');
  await page.locator('.sysmenu-list button', { hasText: '读取记录' }).click();
  const quick = page.locator('.shade .slot').first();
  assert.match(await quick.innerText(), /快捷存档/);
  const onScreen = await quick.evaluate((el) => { const r = el.getBoundingClientRect(), box = el.closest('.modal').getBoundingClientRect(); return r.top >= box.top && r.bottom <= box.bottom; });
  assert.equal(onScreen, true);
  const cancelVisible = await page.locator('.shade .foot .btn').evaluate((el) => { const r = el.getBoundingClientRect(), box = el.closest('.modal').getBoundingClientRect(); return r.top >= box.top && r.bottom <= box.bottom && r.bottom <= innerHeight; });
  assert.equal(cancelVisible, true, 'the cancel button is fully visible without scrolling');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1280, height: 800 });
  await idle();
});

test('title and record editor can open the quick record without a numbered record', async () => {
  await page.evaluate(() => { for (let n = 1; n <= 8; n++) localStorage.removeItem(`haou-hd2d-save:${n}`); });
  await page.goto(game.url);
  await page.waitForFunction(() => window.__game?.debug);
  await skipIntro(page);
  assert.match(await page.locator('button', { hasText: '继续记录' }).innerText(), /快捷/);
  await page.goto(new URL('save-editor.html?mute', game.url).href);
  await page.waitForFunction(() => window.__editor);
  assert.match(await page.locator('#slots .slotc').first().innerText(), /快捷存档/);
  await page.locator('#slots .slotc', { hasText: '快捷' }).click();
  assert.equal(await page.evaluate(() => window.__editor.slot), 'quick');
  assert.equal(await page.evaluate(() => window.__editor.g.year), 201);
  const ruler = await page.evaluate(() => { const g = window.__editor.g; return g.factions[g.player].ruler; });
  const war = page.getByLabel('武力数值');
  await war.fill('1'); await war.blur();
  await page.click('#write');
  await page.locator('.modal button', { hasText: '写回' }).click();
  // 前面的旧式直接写入没有更新协调记录，编辑器必须先提示冲突。
  const conflict = page.locator('.modal', { hasText: '记录冲突' });
  await conflict.waitFor();
  await conflict.getByRole('button', { name: '继续覆盖' }).click();
  await page.waitForFunction(({ k, ruler }) => JSON.parse(localStorage.getItem(k)).officers[ruler].war === 1, { k: KEY, ruler });
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter((k) => /^haou-hd2d-save:\d$/.test(k)).length), 0);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export')]);
  assert.match(download.suggestedFilename(), /快捷存档/);
  assert.deepEqual(page.errors, []);
});

test('saving on the last book records zero books and hands the turn to the AI', async () => {
  const p = await game.open();
  try {
    await newCampaign(p, '曹操');
    await p.waitForFunction(() => !document.querySelector('.banner, .panel.msg, .shade, #fade.on'), null, { timeout: 30000 });
    await p.evaluate(() => { window.__game.g.books = 1; });
    await p.keyboard.press('F2');
    await p.locator('.shade .modal', { hasText: '本月行动结束' }).waitFor({ timeout: 4000 });
    await p.locator('.shade .btn.primary').click();
    await p.waitForFunction(() => window.__game.g.books === 0 && document.body.classList.contains('handoff'), null, { timeout: 10000 });
    assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('haou-hd2d-save:quick')).books), 0);
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); }
});

test('the editor shows the ruler and date on all nine records at desktop width', async () => {
  const p = await game.open();
  try {
    await p.setViewportSize({ width: 1440, height: 900 });
    await p.evaluate(() => {
      const { G } = window.__game, g = G.newGame(4, 1, 3);
      G.saveQuick(g);
      for (let n = 1; n <= 8; n++) G.save({ ...g, year: 189 + n }, n);
    });
    await p.goto(new URL('save-editor.html?mute', game.url).href);
    await p.waitForFunction(() => window.__editor);
    const clipped = await p.locator('#slots .slotc:not(:disabled) .when').evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth).map((el) => el.textContent));
    assert.deepEqual(clipped, [], 'the added quick record must not hide dates or rulers on the ordinary slots');
  } finally { await p.context().close(); }
});

test('F8 works on the title after the opening plays through naturally', async () => {
  const p = await game.open();
  try {
    await p.evaluate(() => { const { G } = window.__game; G.saveQuick(G.newGame(4, 1, 3)); window.__titleAt = 100; });
    await p.waitForFunction(() => document.querySelector('.tt.menu-on:not(.done):not(.instant)'), null, { timeout: 10000 });
    await p.keyboard.press('F8'); await p.locator('.shade .modal', { hasText: '快捷存档' }).waitFor({ timeout: 4000 });
    await Promise.all([p.waitForEvent('load', { timeout: 30000 }), p.locator('.shade .btn.primary').click()]);
    await p.waitForFunction(() => document.body.dataset.screen === 'strategy' && window.__game?.g, null, { timeout: 60000 });
  } finally { await p.context().close(); }
});

test('the record confirmed before the fade is loaded even if another tab replaces the slot', async () => {
  const p = await game.open();
  try {
    await newCampaign(p, '曹操');
    await p.waitForFunction(() => !document.querySelector('.banner, .panel.msg, .shade, #fade.on'), null, { timeout: 30000 });
    await p.evaluate(() => {
      const { g, G } = window.__game; g.year = 199; G.saveQuick(g);
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (this === sessionStorage && k === 'haou-hd2d-load') setTimeout(() => { const { g, G } = window.__game; G.saveQuick({ ...g, year: 200 }); }, 50);
        return set.call(this, k, v);
      };
    });
    await p.keyboard.press('F8');
    await p.locator('.shade .modal').waitFor();
    await Promise.all([p.waitForEvent('load', { timeout: 30000 }), p.locator('.shade .btn.primary').click()]);
    await p.waitForFunction(() => document.body.dataset.screen === 'strategy' && window.__game?.g, null, { timeout: 60000 });
    assert.equal(await p.evaluate(() => window.__game.g.year), 199);
    assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('haou-hd2d-save:quick')).year), 200);
  } finally { await p.context().close(); }
});

test('a damaged quick record with a same-campaign backup requires overwrite confirmation', async () => {
  const p = await game.open();
  try {
    await newCampaign(p, '曹操');
    await p.waitForFunction(() => !document.querySelector('.banner, .panel.msg, .shade, #fade.on'), null, { timeout: 30000 });
    await p.evaluate(() => { const { g, G } = window.__game; g.freeSave = true; G.saveQuick(g); G.saveQuick(g); localStorage.setItem('haou-hd2d-save:quick', '{'); });
    await p.keyboard.press('F2');
    await p.locator('.shade .modal', { hasText: '覆盖' }).waitFor({ timeout: 4000 });
    await p.locator('.shade .btn', { hasText: '取消' }).click();
    assert.equal(await p.evaluate(() => localStorage.getItem('haou-hd2d-save:quick')), '{');
  } finally { await p.context().close(); }
});

test('the title picker does not load a different quick record from the one displayed', async () => {
  const p = await game.open();
  try {
    await p.evaluate(() => { const { G } = window.__game, g = G.newGame(4, 1, 3); g.year = 190; G.save(g, 1); G.saveQuick(g); });
    await p.reload(); await p.waitForFunction(() => window.__game?.debug); await skipIntro(p);
    await p.getByRole('button', { name: '读取记录', exact: true }).click();
    const shown = p.locator('.shade .slot', { hasText: '快捷存档' });
    await shown.waitFor(); assert.match(await shown.innerText(), /190年/);
    await p.evaluate(() => { const { G } = window.__game, q = G.loadQuick(); q.year = 200; q.quickId = 'different'; G.saveQuick(q); });
    await shown.click();
    await p.getByText(/记录已改变/).first().waitFor({ timeout: 4000 });
    assert.equal(await p.evaluate(() => document.body.dataset.screen), 'title');
  } finally { await p.context().close(); }
});

test('the editor refuses to overwrite a quick record replaced after it was opened', async () => {
  const p = await game.open();
  try {
    await p.evaluate(() => { const { G } = window.__game; G.saveQuick(G.newGame(4, 1, 3)); });
    await p.goto(new URL('save-editor.html?mute', game.url).href); await p.waitForFunction(() => window.__editor?.g);
    const war = p.getByLabel('武力数值'); await war.fill('1'); await war.blur();
    const replacement = await p.evaluate(async () => { const G = await import('./src/core/game.js'); const q = { ...window.__editor.g, quickId: 'other', year: 202 }; G.saveQuick(q); return localStorage.getItem('haou-hd2d-save:quick'); });
    await p.click('#write'); await p.locator('.modal button', { hasText: '写回' }).click();
    await p.getByText(/快捷存档已改变/).first().waitFor({ timeout: 4000 });
    assert.ok(await p.evaluate((raw) => localStorage.getItem('haou-hd2d-save:quick') === raw, replacement));
    assert.equal(await p.evaluate(() => window.__editor.changes().length > 0), true);
  } finally { await p.context().close(); }
});

test('two tabs racing to save the empty quick slot cannot silently overwrite each other', async () => {
  const p = await game.open(), q = await p.context().newPage();
  try {
    await q.goto(game.url); await q.waitForFunction(() => window.__game?.debug);
    const save = (page, year) => page.evaluate(async (year) => {
      const { G } = window.__game, g = G.newGame(4, 1, year); g.year = year;
      return G.saveQuickChecked(g, null);
    }, year);
    const results = await Promise.all([save(p, 190), save(q, 191)]);
    assert.deepEqual(results.sort(), ['changed', 'saved']);
    assert.ok([190, 191].includes(await p.evaluate(() => JSON.parse(localStorage.getItem('haou-hd2d-save:quick')).year)));
  } finally { await p.context().close(); }
});

test('changing the free-record setting while a quick save waits does not change its book cost', async () => {
  const p = await game.open(), q = await p.context().newPage();
  try {
    await newCampaign(p, '曹操');
    await p.waitForFunction(() => !document.querySelector('.banner, .panel.msg, .shade, #fade.on'), null, { timeout: 30000 });
    await q.goto(game.url); await q.waitForFunction(() => window.__game?.debug);
    await q.evaluate(() => { window.__holdingQuick = navigator.locks.request('haou-hd2d-save:quick', () => new Promise((resolve) => { window.__releaseQuick = resolve; })); });
    await q.waitForFunction(() => typeof window.__releaseQuick === 'function');
    const before = await p.evaluate(() => window.__game.g.books);
    await p.keyboard.press('F2'); await p.locator('.shade .modal').waitFor(); await p.locator('.shade .btn.primary').click();
    await p.waitForFunction(async () => (await navigator.locks.query()).pending.some((x) => x.name === 'haou-hd2d-save:quick'));
    await p.evaluate(() => { window.__game.g.freeSave = true; });
    await q.evaluate(() => window.__releaseQuick());
    await p.waitForFunction(() => !!localStorage.getItem('haou-hd2d-save:quick'));
    await p.waitForFunction((n) => window.__game.g.books === n, before - 1, { timeout: 4000 });
    assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('haou-hd2d-save:quick')).books), before - 1);
    assert.equal(await p.evaluate(() => window.__game.g.freeSave), true);
  } finally { await p.context().close(); }
});

test('when the browser cannot coordinate tabs, quick save leaves progress and records alone', async () => {
  const p = await game.open();
  try {
    await newCampaign(p, '曹操');
    await p.waitForFunction(() => !document.querySelector('.banner, .panel.msg, .shade, #fade.on'), null, { timeout: 30000 });
    const before = await p.evaluate(() => { Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined }); window.__game.g.freeSave = true; return window.__game.g.books; });
    await p.keyboard.press('F2');
    await p.getByText(/暂不能快捷存档/).first().waitFor({ timeout: 4000 });
    assert.equal(await p.evaluate(() => localStorage.getItem('haou-hd2d-save:quick')), null);
    assert.equal(await p.evaluate(() => window.__game.g.books), before);
  } finally { await p.context().close(); }
});

for (const action of ['edit', 'discard']) {
  test(`editor ${action} while a quick write waits cancels the stale write`, async () => {
    const p = await game.open(), q = await p.context().newPage();
    try {
      await p.evaluate(() => { const { G } = window.__game; G.saveQuick(G.newGame(4, 1, 3)); });
      await p.goto(new URL('save-editor.html?mute', game.url).href); await p.waitForFunction(() => window.__editor?.g);
      const before = await p.evaluate(() => localStorage.getItem('haou-hd2d-save:quick'));
      await q.goto(new URL('data/game-data.json?mute', game.url).href);
      await q.evaluate(() => { window.__holdingQuick = navigator.locks.request('haou-hd2d-save:quick', () => new Promise((resolve) => { window.__releaseQuick = resolve; })); });
      await q.waitForFunction(() => typeof window.__releaseQuick === 'function');
      const war = p.getByLabel('武力数值'); await war.fill('1'); await war.blur();
      await p.click('#write'); await p.locator('.modal button', { hasText: '写回' }).click();
      await p.waitForFunction(async () => (await navigator.locks.query()).pending.some((x) => x.name === 'haou-hd2d-save:quick'));
      if (action === 'edit') { await war.fill('2'); await war.blur(); }
      else { await p.click('#revert'); await p.locator('.modal').getByRole('button', { name: '放弃', exact: true }).click(); }
      await q.evaluate(() => window.__releaseQuick());
      await p.getByText(/编辑内容已变化/).first().waitFor({ timeout: 4000 });
      assert.ok(await p.evaluate((raw) => localStorage.getItem('haou-hd2d-save:quick') === raw, before), 'the discarded or superseded edit was not written');
      if (action === 'edit') {
        assert.equal(await war.inputValue(), '2');
        await p.click('#write'); await p.locator('.modal button', { hasText: '写回' }).click();
        await p.waitForFunction(() => { const r = JSON.parse(localStorage.getItem('haou-hd2d-save:quick')); return r.officers[r.factions[r.player].ruler].war === 2; });
      } else assert.equal(await p.evaluate(() => window.__editor.changes().length), 0);
    } finally { await p.context().close(); }
  });
}

test('a numbered record replaced during reload is not treated as the current save slot', async () => {
  const p = await game.open();
  try {
    await newCampaign(p, '曹操');
    await p.waitForFunction(() => document.querySelector('.citypanel') && !document.querySelector('.banner, .panel.msg, .shade, #fade.on'), null, { timeout: 30000 });
    await p.evaluate(() => {
      const { g, G } = window.__game; g.freeSave = true; g.year = 199; G.save(g, 1);
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (this === sessionStorage && k === 'haou-hd2d-load') setTimeout(() => { const { g, G } = window.__game; G.save({ ...g, year: 200 }, 1); }, 50);
        return set.call(this, k, v);
      };
    });
    await p.click('.sysmenu-btn'); await p.locator('.sysmenu-list button', { hasText: '读取记录' }).click();
    await p.locator('.shade .slot', { hasText: '记录一' }).click();
    await Promise.all([p.waitForEvent('load', { timeout: 30000 }), p.locator('.shade .btn.primary').click()]);
    await p.waitForFunction(() => { const g = window.__game?.g; return document.body.dataset.screen === 'strategy' && g && g.current === g.player && document.querySelector('.citypanel') && !document.querySelector('.banner, .panel.msg, .shade, #fade.on, .vig'); }, null, { timeout: 20000 })
      .catch(async (error) => { throw new Error(`${error.message}\n${JSON.stringify(await p.evaluate(() => { const g = window.__game?.g; return { screen: document.body.dataset.screen, year: g?.year, current: g?.current, player: g?.player, books: g?.books, over: g?.over, panels: [...document.querySelectorAll('.citypanel, .banner, .panel.msg, .shade, #fade.on, .vig')].map((el) => `${el.className}:${el.textContent.slice(0, 120)}`), pending: !!sessionStorage.getItem('haou-hd2d-load') }; }))}\nerrors: ${JSON.stringify(p.errors)}`); });
    assert.equal(await p.evaluate(() => window.__game.g.year), 199);
    assert.equal(await p.evaluate(() => window.__game.g.slot), null);
    await p.click('.sysmenu-btn'); await p.locator('.sysmenu-list button', { hasText: '记录进度' }).click();
    await p.locator('.shade .slot', { hasText: '记录一' }).click();
    await p.locator('.shade .modal', { hasText: '覆盖记录' }).waitFor({ timeout: 4000 });
    assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('haou-hd2d-save:1')).year), 200);
  } finally { await p.context().close(); }
});

test('a confirmed quick load survives another reload while waiting for the suspension lock', async () => {
  const p = await game.open(), q = await p.context().newPage();
  try {
    await newCampaign(p, '曹操');
    await p.waitForFunction(() => !document.querySelector('.banner, .panel.msg, .shade, #fade.on'), null, { timeout: 30000 });
    await p.evaluate(() => {
      const { g, G } = window.__game; g.year = 199; G.saveQuick(g); window.__beforeQuickReload = true;
      localStorage.setItem('haou-hd2d-suspend', JSON.stringify({ version: 1, g, war: { city: g.factions[g.player].city }, field: { units: [], day: 1 }, side: 'att', after: { kind: 'att' } }));
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (this === sessionStorage && k === 'haou-hd2d-load') setTimeout(() => { const { g, G } = window.__game; G.saveQuick({ ...g, year: 200 }); }, 50);
        return set.call(this, k, v);
      };
    });
    await q.goto(new URL('data/game-data.json?mute', game.url).href);
    await q.evaluate(() => { window.__heldSuspend = navigator.locks.request('haou-hd2d-suspend', () => new Promise((resolve) => { window.__releaseSuspend = resolve; })); });
    await q.waitForFunction(() => typeof window.__releaseSuspend === 'function');
    await p.keyboard.press('F8'); await p.locator('.shade .modal').waitFor();
    await Promise.all([p.waitForEvent('load', { timeout: 30000 }), p.locator('.shade .btn.primary').click()]);
    await p.waitForFunction(async () => window.__beforeQuickReload === undefined && window.__game?.debug && (await navigator.locks.query()).pending.some((x) => x.name === 'haou-hd2d-suspend'), null, { timeout: 30000 });
    assert.ok(await p.evaluate(() => sessionStorage.getItem('haou-hd2d-load')), 'the confirmed record remains recoverable while waiting');
    await p.reload();
    await p.waitForFunction(async () => (await navigator.locks.query()).pending.some((x) => x.name === 'haou-hd2d-suspend'), null, { timeout: 30000 });
    await q.evaluate(() => window.__releaseSuspend());
    await p.waitForFunction(() => document.body.dataset.screen === 'strategy' && window.__game?.g?.year === 199 && !sessionStorage.getItem('haou-hd2d-load'), null, { timeout: 60000 });
    assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('haou-hd2d-save:quick')).year), 200);
    assert.equal(await p.evaluate(() => localStorage.getItem('haou-hd2d-suspend')), null);
  } finally { await p.context().close(); }
});

test('a failed load initialization returns to title and keeps the suspended battle', async () => {
  const p = await game.open();
  try {
    await newCampaign(p, '曹操');
    await p.waitForFunction(() => !document.querySelector('.banner, .panel.msg, .shade, #fade.on'), null, { timeout: 30000 });
    const held = await p.evaluate(() => {
      const { g, G } = window.__game; G.saveQuick(g);
      const raw = JSON.stringify({ version: 1, g, war: { city: g.factions[g.player].city }, field: { units: [], day: 1 }, side: 'att', after: { kind: 'att' } });
      localStorage.setItem('haou-hd2d-suspend', raw); return raw;
    });
    await p.context().addInitScript(() => {
      const append = Element.prototype.append;
      Element.prototype.append = function (...args) {
        if (document.body?.dataset.screen === 'strategy' && sessionStorage.getItem('haou-hd2d-load') && !sessionStorage.getItem('__quickTestFailed')) {
          sessionStorage.setItem('__quickTestFailed', '1'); throw new Error('test: strategy initialization failed');
        }
        return append.apply(this, args);
      };
    });
    await p.keyboard.press('F8'); await p.locator('.shade .modal').waitFor();
    await Promise.all([p.waitForEvent('load', { timeout: 30000 }), p.locator('.shade .btn.primary').click()]);
    await p.waitForFunction(() => document.body.dataset.screen === 'title' && sessionStorage.getItem('__quickTestFailed') && !sessionStorage.getItem('haou-hd2d-load'), null, { timeout: 12000 });
    assert.equal(await p.evaluate(() => localStorage.getItem('haou-hd2d-suspend')), held);
    await p.getByText(/读取失败.*中断战斗/).first().waitFor({ timeout: 4000 });
  } finally { await p.context().close(); }
});

test('without Web Locks, suspended-battle operations still wait for another tab', async () => {
  const p = await game.open(), q = await p.context().newPage();
  try {
    await q.goto(new URL('data/game-data.json?mute', game.url).href);
    await q.evaluate(() => new Promise((resolve, reject) => {
      const open = indexedDB.open('haou-hd2d-suspend-lock', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('lock');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        window.__lockDb = open.result;
        const tx = window.__lockDb.transaction('lock', 'readwrite'), store = tx.objectStore('lock');
        window.__releaseFallbackLock = false;
        const keep = () => { if (!window.__releaseFallbackLock) { const req = store.get('haou-hd2d-suspend'); req.onsuccess = keep; } };
        keep(); resolve();
      };
    }));
    await p.goto(new URL('data/game-data.json?mute', game.url).href);
    await p.evaluate(() => {
      Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
      window.__fallbackDone = false;
      import('../src/core/suspend.js').then(({ withSuspendLock }) => withSuspendLock(() => {
        localStorage.setItem('fallback-test', 'changed'); return 'saved';
      })).then((result) => { window.__fallbackDone = result; });
    });
    await p.waitForTimeout(300);
    assert.equal(await p.evaluate(() => window.__fallbackDone), false);
    assert.equal(await p.evaluate(() => localStorage.getItem('fallback-test')), null);
    await q.evaluate(() => { window.__releaseFallbackLock = true; });
    await p.waitForFunction(() => window.__fallbackDone === 'saved', null, { timeout: 4000 });
    assert.equal(await p.evaluate(() => localStorage.getItem('fallback-test')), 'changed');
  } finally { await p.context().close(); }
});
