// The strategy command menu (方案: docs/战略命令栏弹出菜单方案_2026-11-14.md): the dock is one row of groups, and a
// group opens its commands in a list above it, each row saying what the command does or why it cannot be done here.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, newCampaign, closeMessages, openCmds, cmd } from './game.mjs';

let game, page, names;
before(async () => {
  game = await startGame({ width: 1440, height: 900 }); page = await game.open(); await newCampaign(page, '刘备');
  await page.waitForSelector('.dock');
  // A second city of ours next door, to change cities with.
  names = await page.evaluate(() => {
    const { g, G } = window.__game, home = g.factions[g.player].city;
    const other = G.roads(home).find((c) => g.cities[c].faction === G.NONE) ?? G.roads(home)[0];
    g.cities[other].faction = g.player; if (!g.cities[other].officers.length) { const id = g.cities[home].officers[1]; g.cities[home].officers = g.cities[home].officers.filter((x) => x !== id); g.cities[other].officers.push(id); }
    window.__game.strategy.refresh(g);
    return [G.cityName(home), G.cityName(other)];
  });
});
after(() => game?.close());

const pick = (n) => page.evaluate((n) => [...document.querySelectorAll('.ctag')].find((e) => e.textContent.includes(n)).click(), n);
const tabOn = () => page.evaluate(() => document.querySelector('.dock .tabs .btn.on')?.textContent ?? null);
const shown = () => page.evaluate(() => { const a = document.querySelector('.dock .acts'); return !!a && !a.hidden; });
const rows = () => page.evaluate(() => [...document.querySelectorAll('.dock .acts .cmd')].map((r) => ({ name: r.querySelector('b').textContent, note: r.querySelector('small').textContent, off: r.disabled, free: !!r.querySelector('.free') })));
const tabBtn = (t) => page.locator('.dock .tabs .btn', { hasText: t });
const redraw = () => page.evaluate(() => window.__game.debug.hud());

test('a city opens with the list closed; a group opens, swaps and closes it', async () => {
  assert.equal(await shown(), false); assert.equal(await tabOn(), null);
  assert.equal(await page.locator('.dock .hint').count(), 0, 'the hint line is gone');
  await tabBtn('町').click(); assert.equal(await tabOn(), '町'); assert.equal(await shown(), true);
  await tabBtn('军').click(); assert.equal(await tabOn(), '军', 'another group takes its place');
  await tabBtn('军').click(); assert.equal(await shown(), false, 'the same group again closes it');
});

test('each row says what it does, or why it cannot be done', async () => {
  await openCmds(page, '町');
  assert.deepEqual((await rows()).map((r) => [r.name, r.note, r.off]), [
    ['买米', '在米市用金买米', false], ['卖米', '在米市卖米换金', false], ['卖宝', '没有宝物', true],
    ['病院', '没有负伤的武将', true], ['书馆', '此城没有学问所', true], ['铁铺', '为武将购买武器与防具', false]]);
  await openCmds(page, '军');
  assert.deepEqual((await rows()).filter((r) => r.free).map((r) => r.name), ['分兵', '任命']);
  await tabBtn('军').click();
});

test('no row\'s note is cut short, in any group', async () => {
  for (const t of ['城', '军', '仓', '町']) {
    await openCmds(page, t);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.dock .acts .cmd small')].filter((s) => s.scrollWidth > s.clientWidth).map((s) => s.textContent)), [], t);
  }
  await tabBtn('町').click();
});

test('Esc and a press outside close it; the dialog of a command does not', async () => {
  await openCmds(page, '城'); await page.keyboard.press('Escape'); assert.equal(await shown(), false, 'Esc');
  await openCmds(page, '城'); await page.locator('.topbar .date').click(); assert.equal(await shown(), false, 'a press elsewhere'); // (a press on the bare map puts the city itself away)
  await cmd(page, '城', '开发'); await page.waitForSelector('.modal');
  await page.locator('.modal').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.modal'));
  assert.equal(await tabOn(), '城'); assert.equal(await shown(), true, 'still open after the command was put off');
});

test('the same city keeps the group through a redraw; another city closes it', async () => {
  await openCmds(page, '町'); await redraw();
  assert.equal(await tabOn(), '町'); assert.equal(await shown(), true);
  await pick(names[1]); assert.equal(await shown(), false); assert.equal(await tabOn(), null);
  await pick(names[0]); assert.equal(await shown(), false);
});

test('books 0: every row but 分兵 and 任命 is off, with the reason', async () => {
  await page.evaluate(() => { window.__game.g.books = 0; }); await redraw();
  await openCmds(page, '城'); assert.ok((await rows()).every((r) => r.off && r.note === '命令书已用完'), JSON.stringify(await rows()));
  await openCmds(page, '军'); assert.deepEqual((await rows()).filter((r) => !r.off).map((r) => r.name), ['分兵', '任命']);
  await page.evaluate(() => { window.__game.g.books = 3; }); await redraw();
});

// Where the keys are: a command's row, 'tab:町' for a group's button, else null.
const focus = () => page.evaluate(() => { const a = document.activeElement; return a?.closest('.dock .acts') ? a.querySelector('b').textContent : a?.closest('.dock .tabs') ? `tab:${a.textContent}` : null; });

test('keys: 1–5 toggle a group, arrows walk the rows, Esc hands the focus back to the group', async () => {
  await page.keyboard.press('4'); assert.equal(await tabOn(), '町'); assert.equal(await focus(), '买米');
  await page.keyboard.press('ArrowDown'); assert.equal(await focus(), '卖米');
  await page.keyboard.press('ArrowDown'); assert.equal(await focus(), '铁铺', 'the three that cannot be done are passed over');
  await page.keyboard.press('ArrowDown'); assert.equal(await focus(), '买米', 'round to the first');
  await page.keyboard.press('ArrowUp'); assert.equal(await focus(), '铁铺');
  await page.keyboard.press('Escape'); assert.equal(await shown(), false); assert.equal(await focus(), 'tab:町');
  await page.keyboard.press('4'); await page.keyboard.press('4'); assert.equal(await shown(), false, 'the same key closes it');
});

test('the focus comes back to the command after its dialog', async () => {
  await page.keyboard.press('1'); assert.equal(await focus(), '开发');
  await page.keyboard.press('Enter'); await page.waitForSelector('.modal');
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.modal'));
  assert.equal(await focus(), '开发'); assert.equal(await tabOn(), '城');
  await redraw(); assert.equal(await focus(), '开发', 'and stays on it when the HUD is drawn again');
  await page.keyboard.press('Escape');
});

test('a click on a group does not move the focus into its list', async () => {
  await tabBtn('城').click(); assert.equal(await focus(), 'tab:城'); // (else the first row's still would come up unasked)
  await tabBtn('城').click();
});

test('opened by the mouse, ↑ or ↓ on the group goes into its list', async () => {
  await tabBtn('町').click(); await page.keyboard.press('ArrowUp'); assert.equal(await focus(), '铁铺', '↑ to the row nearest the button');
  await page.keyboard.press('Escape'); await tabBtn('町').click();
  await page.keyboard.press('ArrowDown'); assert.equal(await focus(), '买米');
  await page.keyboard.press('Escape');
});

// A map pick and the 系统 menu are not dialogs with a shade: the group keys must not work under them either (review, 2026-11-14).
test('1–5 do nothing while a command picks a city on the map, or under the 系统 menu', async () => {
  await cmd(page, '城', '移动'); await page.waitForSelector('.mappick');
  await page.keyboard.press('2');
  assert.equal(await tabOn(), '军', 'the list stays as it was'); assert.equal(await focus(), null, 'and the keys stay with the picker');
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.mappick'));
  assert.equal(await shown(), true); assert.equal(await tabOn(), '军');
  await page.getByRole('button', { name: '☰ 系统', exact: true }).click(); // (a press elsewhere: the list closes)
  await page.keyboard.press('1'); assert.equal(await shown(), false, 'no group opens under the 系统 menu');
  await page.getByRole('button', { name: '☰ 系统', exact: true }).click();
});

// A command whose result is told in a window draws the HUD again under that window: the focus goes back to the row once
// the window is gone (review, 2026-11-14).
test('the HUD drawn again under a window: the focus is back on the command when the window goes', async () => {
  await page.keyboard.press('1'); await page.keyboard.press('ArrowDown'); assert.equal(await focus(), '防灾');
  await page.evaluate(() => { const d = document.createElement('div'); d.id = 'fake-window'; document.querySelector('#ui-top').append(d); window.__game.debug.hud(); });
  await page.waitForTimeout(50); assert.equal(await focus(), null, 'not under the window');
  await page.evaluate(() => document.querySelector('#fake-window').remove());
  await page.waitForFunction(() => document.activeElement?.closest('.dock .acts'));
  assert.equal(await focus(), '防灾');
  await page.keyboard.press('Escape');
});

// Last: the other factions play a month.
test('new month: the list is closed when the turn comes back', async () => {
  await openCmds(page, '城');
  const month = await page.evaluate(() => window.__game.g.month);
  // Ended without a pointer (as Y held on a pad): a press on the button would close the list by itself.
  await page.evaluate(() => document.querySelector('.endturn .btn').click());
  await page.locator('.shade .btn.primary', { hasText: '确定' }).waitFor();
  await page.evaluate(() => [...document.querySelectorAll('.shade .btn.primary')].find((b) => b.textContent.includes('确定')).click());
  const stop = closeMessages(page, { aiTurns: true });
  try { await page.waitForFunction((m) => { const g = window.__game.g; return g.month !== m && g.current === g.player && !document.querySelector('.aiturn, .panel.msg') && document.querySelector('.dock'); }, month, { timeout: 90000 }); } finally { stop(); }
  assert.equal(await shown(), false); assert.equal(await tabOn(), null);
});
