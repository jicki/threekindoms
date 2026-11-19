// 命令演出 on the strategy map as the original plays it (bank 28 $D5BD, bank 29 $BE36 / bank 30 $C934, bank 29 $A048):
// the 命令书 counter blinks for 128 frames and drops at frame 64; then the picture plays 255 frames, its text typed
// one character every 4 frames; then it waits for A or B (bank 27 $ACB8). At 快速 / 最快 the beats divide and
// the picture closes by itself.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, near } from './game.mjs';

let game, page;
before(async () => {
  game = await startGame(); page = await game.open();
  // 本套测量命令书与演出的节拍。先把素材读入，避免网络和解码时间计入命令书闪烁。
  assert.equal(await page.evaluate(async () => {
    const { sceneFrame } = await import('./src/vignette.js');
    return sceneFrame('land', 0, document.createElement('canvas'));
  }), true);
});
after(() => game?.close());

const CAPTION = '关羽开发了土地　土地价值增加了十五';

// Starts a 开发 演出 at `speed` and records, every 20 ms, whether the picture is up, its caption and whether
// the "press a key" mark shows; onBook's time is kept too. Ends `lastMs` after the start, or when it closes.
async function play(speed, lastMs) {
  return page.evaluate(async ({ speed, lastMs, CAPTION }) => {
    const P = await import('./src/pace.js'), V = await import('./src/vignette.js'); P.setPace(speed);
    const tl = [], t0 = performance.now(); let book = null, closed = null;
    const rec = setInterval(() => tl.push({ t: performance.now() - t0, vig: !!document.querySelector('.vig'), cap: document.querySelector('.vig .vig-cap')?.textContent ?? null, more: !!document.querySelector('.vig .vig-more') }), 20);
    V.playVignette({ scene: 'land', caption: CAPTION, onBook: () => (book = performance.now() - t0) }).then(() => (closed = performance.now() - t0));
    while (closed == null && performance.now() - t0 < lastMs) await new Promise((r) => setTimeout(r, 20));
    clearInterval(rec); P.setPace(1);
    return { tl, book, closed };
  }, { speed, lastMs, CAPTION });
}
const first = (tl, p) => tl.find(p)?.t ?? null;

test('at 原版 the book blinks 2.13 s, drops halfway, then the picture plays 4.24 s and waits for a key', async () => {
  const { tl, book, closed } = await play(1, 8500);
  assert.ok(near(book, 1065, 0.15), `book dropped at ${Math.round(book)} ms`);
  const open = first(tl, (s) => s.vig);
  assert.ok(near(open, 2130, 0.1), `picture opened at ${Math.round(open)} ms`);
  // typed one character per 4 frames: 17 characters ≈ 1.13 s
  const typed = first(tl, (s) => s.cap === CAPTION) - first(tl, (s) => s.cap);
  assert.ok(near(typed, (CAPTION.length - 1) * 66.6, 0.2), `typed in ${Math.round(typed)} ms`);
  const prompt = first(tl, (s) => s.more);
  assert.ok(prompt != null && near(prompt - open, 4240, 0.08), `key mark after ${Math.round(prompt - open)} ms of picture`);
  assert.equal(closed, null, 'the picture stays until the player presses a key');
  assert.ok(tl.at(-1).vig);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('.vig'), null, { timeout: 2000 });
});

test('at 原版 a key during the picture shows the whole text and the key mark, and a second key closes it', async () => {
  await page.evaluate(async (CAPTION) => {
    const V = await import('./src/vignette.js'); window.__done = false;
    V.playVignette({ scene: 'land', caption: CAPTION, onBook: () => {} }).then(() => (window.__done = true));
  }, CAPTION);
  await page.waitForSelector('.vig', { timeout: 4000 });
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.vig .vig-more', { timeout: 1000 });
  assert.equal(await page.locator('.vig .vig-cap').textContent(), CAPTION);
  assert.equal(await page.evaluate(() => window.__done), false, 'the first key does not close it');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__done, null, { timeout: 2000 });
});

test('while the show runs or waits, clicks and other keys do not reach the map or the menus underneath', async () => {
  await page.evaluate(async (CAPTION) => {
    const V = await import('./src/vignette.js'), U = await import('./src/ui.js');
    window.__done = false; window.__under = 0; window.__keys = 0;
    document.body.append(U.h('button', { id: 'under', style: 'position:fixed;left:0;top:0;width:80px;height:80px;z-index:1', onclick: () => window.__under++ }, '城'));
    addEventListener('keydown', (e) => { if (e.key === '1') window.__keys++; });
    V.playVignette({ scene: 'land', caption: CAPTION, onBook: () => {} }).then(() => (window.__done = true));
  }, CAPTION);
  await page.waitForTimeout(300);
  await page.mouse.click(40, 40); // while the book blinks: jumps to the end of the show
  await page.waitForSelector('.vig .vig-more', { timeout: 1500 });
  await page.keyboard.press('1');
  await page.mouse.click(40, 40);
  await page.waitForFunction(() => window.__done, null, { timeout: 2000 });
  assert.deepEqual(await page.evaluate(() => [window.__under, window.__keys, document.getElementById('under').remove()].slice(0, 2)), [0, 0], 'a click outside the picture closes it without pressing what is under it');
});

test('at 最快 the beats are a quarter as long and the picture closes by itself', async () => {
  const { tl, book, closed } = await play(4, 4000);
  assert.ok(near(book, 1065 / 4, 0.3), `book dropped at ${Math.round(book)} ms`);
  const open = first(tl, (s) => s.vig);
  assert.ok(near(open, 2130 / 4, 0.2), `picture opened at ${Math.round(open)} ms`);
  assert.ok(closed != null && near(closed, (2130 + 4240) / 4, 0.2), `closed at ${closed && Math.round(closed)} ms`);
});

// The command's phrase starts on the picture's first frame, not before the book's blink (playtest of 2026-10-31,
// F07), and nothing else sounds as the picture opens or closes (F06: the select blip at both ends).
test('the phrase starts with the picture, and no select blip opens or closes it', async () => {
  const r = await page.evaluate(async () => {
    const V = await import('./src/vignette.js'), t0 = performance.now(), sounds = [];
    const audio = { sfx: (k) => sounds.push(k), cue: (k) => sounds.push(k) };
    let shown = null, opened = null;
    const watch = setInterval(() => { if (opened == null && document.querySelector('.vig')) opened = performance.now() - t0; }, 5);
    const done = V.playVignette({ scene: 'land', caption: '开发', audio, onBook: () => {}, onShow: () => (shown = performance.now() - t0) });
    while (shown == null) await new Promise((r) => setTimeout(r, 20));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await done; clearInterval(watch);
    return { shown, opened, sounds };
  });
  assert.ok(near(r.shown, 2130, 0.1), `phrase at ${Math.round(r.shown)} ms, after the book's 2.13 s`);
  assert.ok(Math.abs(r.shown - r.opened) < 40, `with the picture (opened at ${Math.round(r.opened)} ms)`);
  assert.deepEqual(r.sounds, [], 'the picture makes no sound of its own');
});

test('no page errors', () => assert.deepEqual(page.errors, []));
