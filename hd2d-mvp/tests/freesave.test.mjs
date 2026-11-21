// 免费记录 (g.freeSave): an option, off by default, under which a record spends no 命令书.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, newCampaign, skipIntro, openCmds, cmdRow, cmd } from './game.mjs';

let game, page;
const errors = [];
before(async () => { game = await startGame({ scenario: 'original' }); page = await game.open(); page.on('pageerror', (e) => errors.push(e.message)); await newCampaign(page, '曹操'); });
after(() => game?.close());

const state = () => page.evaluate(() => ({ books: window.__game.g.books, free: window.__game.g.freeSave }));
const record = (n) => page.evaluate((n) => JSON.parse(localStorage.getItem(`haou-hd2d-save:${n}`)).books, n);
const toggle = async () => {
  await page.getByRole('button', { name: '☰ 系统', exact: true }).click();
  await page.locator('.sysmenu-list button', { hasText: '记录消耗' }).click();
  assert.ok(await page.locator('.sysmenu-list button', { hasText: '记录消耗' }).isVisible(), 'the menu stays open to show the new state');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
};
// 城 → 记录 from the dock, into the slot named, up to the end of the command.
const save = async (slot) => {
  await cmd(page, '城', '记录');
  await page.locator('.shade .slot', { hasText: `记录${slot}` }).click();
  await page.waitForFunction(() => !document.querySelector('.shade'));
};
// A 命令书 picture holds the screen until it ends or is skipped; the book is spent after it.
const settle = async (books) => {
  for (let i = 0; i < 60; i++) {
    const st = await page.evaluate(() => ({ vig: !!document.querySelector('.vig'), msg: !!document.querySelector('.panel.msg'), books: window.__game.g.books }));
    if (!st.vig && !st.msg && st.books === books) return page.waitForTimeout(600);
    if (st.vig || st.msg) await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
  assert.fail(`never settled on ${books}: ${JSON.stringify(await page.evaluate(() => ({ books: window.__game.g.books, cur: window.__game.g.current, player: window.__game.g.player, shade: !!document.querySelector('.shade'), vig: !!document.querySelector('.vig'), body: document.body.innerText.slice(0, 300) })))}`);
};

test('it is off by default and a record costs one 命令书', async () => {
  const { books, free } = await state();
  assert.ok(!free);
  await save('一'); await settle(books - 1);
  assert.equal((await state()).books, books - 1);
  assert.equal(await record(1), books - 1);
});

test('switched on, a record costs nothing and the dock says so', async () => {
  await toggle();
  const { books, free } = await state();
  assert.equal(free, true);
  await openCmds(page, '城');
  assert.ok(await page.locator('.dock .acts [data-act="记录"] .free').count());
  await save('二'); await page.waitForTimeout(800);
  assert.equal((await state()).books, books);
  assert.equal(await record(2), books);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('haou-hd2d-save:2')).freeSave), true);
});

test('on the last 命令书 a free record leaves the turn running', async () => {
  await page.evaluate(() => { window.__game.g.books = 1; });
  await save('三'); await page.waitForTimeout(1500);
  const st = await page.evaluate(() => ({ books: window.__game.g.books, mine: window.__game.g.current === window.__game.g.player, closed: document.body.classList.contains('handoff') }));
  assert.deepEqual(st, { books: 1, mine: true, closed: false });
  assert.equal(await record(3), 1);
  await page.evaluate(() => { window.__game.g.books = 3; });
});

test('switched off again it costs one, and a record from before the option reads as off', async () => {
  await toggle();
  const { books, free } = await state();
  assert.ok(!free);
  await openCmds(page, '城');
  assert.equal(await page.locator('.dock .acts [data-act="记录"] .free').count(), 0);
  await save('四'); await settle(books - 1);
  assert.equal(await record(4), books - 1);
  assert.ok(!(await page.evaluate(() => JSON.parse(localStorage.getItem('haou-hd2d-save:1')).freeSave)));
});

test('the opening offers it, off until chosen, and the new game starts with it', async () => {
  const p = await game.open();
  try {
    await skipIntro(p);
    await p.getByText('新的征程').click(); await p.waitForTimeout(800);
    const opt = p.locator('.setup-opts .opt', { hasText: '免费记录' });
    assert.equal(await opt.getAttribute('aria-pressed'), 'false');
    await opt.click();
    assert.equal(await opt.getAttribute('aria-pressed'), 'true');
    await p.locator('.level', { hasText: 'LEVEL 1' }).click();
    await p.locator('.ruler', { hasText: '曹操' }).click(); await p.locator('.ruler', { hasText: '曹操' }).click();
    await p.waitForFunction(() => document.body.dataset.screen === 'strategy');
    assert.equal(await p.evaluate(() => window.__game.g.freeSave), true);
  } finally { await p.close(); }
});

test('no page errors', () => assert.deepEqual(errors, []));
