// Shared setup for the browser tests: a private dev server on a free port and muted headless Chrome
// (tools/headless.mjs), one per test file. Tests drive the game through window.__game, as the capture tools do.
//   node --test --test-concurrency=1 'hd2d-mvp/tests/*.test.mjs'   (all)     node --test hd2d-mvp/tests/pace.test.mjs   (one file)
// Needs python3, Playwright (global @playwright/mcp works) and hd2d-mvp/desktop/node_modules (see tools/serve.py).
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { launchChrome } from '../tools/headless.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const freePort = () => new Promise((resolve, reject) => {
  const s = createServer().once('error', reject).listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

// Starts the server and the browser; returns { url, open(), close() }. open() gives a page on the title screen
// with the game booted and muted (?mute); `query` adds parameters, e.g. '&flat' for the flat war map (3D is the default), and `save` (a
// record from saveCampaign) is put in the page's save slot 1 before the game boots, for resumeCampaign; `setup(context)` runs before
// that boot too (stored settings, network routes, listeners).
export async function startGame({ width = 1280, height = 800 } = {}) {
  const port = await freePort(), url = `http://localhost:${port}/hd2d-mvp/?mute`;
  // 浏览器测试使用临时服务，不应读取或覆盖调用者的持久管理员配置。
  const server = spawn('python3', ['hd2d-mvp/tools/serve.py', String(port)], {
    cwd: ROOT, stdio: 'ignore', env: { ...process.env, GAME_ADMIN_TOKEN_FILE: '' },
  });
  for (let i = 0; ; i++) {
    try { if ((await fetch(url)).ok) break; } catch {}
    if (i > 100) { server.kill(); throw new Error(`dev server did not start on ${port}`); }
    await new Promise((r) => setTimeout(r, 100));
  }
  let browser;
  try { browser = await launchChrome(url); } catch (e) { server.kill(); throw e; }
  const contexts = [];
  // A killed test run (Ctrl-C, SIGTERM from a timeout) must not leave serve.py and Chrome running.
  const onKill = (sig) => { server.kill(); browser.close().catch(() => {}).finally(() => process.exit(sig === 'SIGINT' ? 130 : 143)); };
  const onTerm = () => onKill('SIGTERM'), onInt = () => onKill('SIGINT');
  process.once('SIGTERM', onTerm); process.once('SIGINT', onInt);
  return {
    url,
    async open(query = '', { save, setup, clock = false } = {}) {
      const ctx = await browser.newContext({ viewport: { width, height } }); contexts.push(ctx);
      if (clock) await ctx.addInitScript(fastClock);
      await setup?.(ctx);
      if (save) await ctx.addInitScript((s) => localStorage.setItem('haou-hd2d-save:1', s), save);
      const page = await ctx.newPage(), errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.errors = errors;
      await page.goto(url + query); await page.waitForFunction(() => window.__game?.debug, null, { timeout: 60000 });
      return page;
    },
    async close() { process.off('SIGTERM', onTerm); process.off('SIGINT', onInt); await browser.close().catch(() => {}); server.kill(); },
  };
}

// A page's clock that a test can run faster (open(…, { clock: true }), then timeScale(page, k)): performance.now,
// Date.now, rAF times and timer delays all go k× real time, so every wait the game measures itself (tweens, beats, the
// 白兵 rounds) is k× shorter, in step with one another. CSS transitions keep real time. Only for stretches a test plays
// through without timing them: a test that measures how long something takes, or presses a pad button for a set time,
// does it at 1×. The main loop's dt is capped (app.js), so its own easing runs a little behind the timers at high k.
function fastClock() {
  const pn = performance.now.bind(performance), dn = Date.now, st = setTimeout, si = setInterval, raf = requestAnimationFrame;
  let k = 1, realAt = pn(), virtAt = realAt, dateAt = dn();
  const now = () => virtAt + (pn() - realAt) * k;
  performance.now = now;
  Date.now = () => Math.round(dateAt + (now() - virtAt));
  window.setTimeout = (f, ms = 0, ...a) => st(f, ms / k, ...a);
  window.setInterval = (f, ms = 0, ...a) => si(f, ms / k, ...a);
  window.requestAnimationFrame = (cb) => raf(() => cb(now()));
  window.__timeScale = (n) => { const v = now(); dateAt = Date.now(); realAt = pn(); virtAt = v; k = n; };
  window.__advance = (ms) => { virtAt += ms; dateAt += ms; }; // moves the clock on at once (warRest's jump)
}
export const timeScale = (page, k) => page.evaluate((k) => window.__timeScale(k), k);

// Until the war map's camera has come to rest (warview viewState().still), two frames on so a move asked for this frame has begun:
// a fixed wait was longer than the ease, or on a loaded machine too short. With `jump` (a page opened with { clock: true }) the
// view's own update runs on in 50 ms steps, the clock moved on with each, with no frame drawn between (the step the frame loop caps
// dt at, app.js), until it rests; then two frames are drawn. For a test that looks at where the camera ends, not at the ease.
export async function warRest(page, { jump = false } = {}) {
  const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await frames();
  if (jump) {
    const ok = await page.evaluate(() => { const w = window.__game.war; for (let i = 0; i < 600; i++) { if (w.viewState().still) return true; window.__advance(50); w.update(0.05); } return w.viewState().still; });
    if (!ok) throw new Error('the war camera did not come to rest in 30 s of its own time');
    await frames();
  }
  await page.waitForFunction(() => window.__game.war.viewState().still, null, { timeout: 20000 });
}

// Starts a new campaign as `ruler` on LEVEL 1, as a player would, and waits for the player's first turn: the
// factions before the player's take their turns first, and a test must not run alongside them. Their 「战略中」
// plaques are clicked away as they come, as a player may (a click or Enter ends one, src/app.js io.aiTurn), so
// the wait is the AI's own work, not 1.5 s a faction at 原版.
export async function newCampaign(page, ruler = '刘备') {
  await skipIntro(page);
  await page.getByText('新的征程').click();
  await page.locator('.level', { hasText: 'LEVEL 1' }).click();
  await page.locator('.ruler', { hasText: ruler }).click(); await page.locator('.ruler', { hasText: ruler }).click();
  await page.waitForFunction(() => document.body.dataset.screen === 'strategy');
  const stop = closeMessages(page, { aiTurns: true });
  try { await page.waitForFunction(() => { const g = window.__game.g; return g.current === g.player && !document.querySelector('.aiturn, .panel.msg'); }, null, { timeout: 90000 }); } finally { stop(); }
}

// Skips the title's opening with a key, as a player may (src/titlescreen.js): otherwise every click on its menu
// waits ~7.5 s for the menu to stop moving. The first key can only release the held music, so it presses until done.
export async function skipIntro(page) {
  for (let i = 0; i < 50; i++) {
    if (await page.evaluate(() => !!document.querySelector('.tt.done, .tt.instant'))) return;
    await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  }
  throw new Error('the title opening did not end');
}

// The campaign on this page as a save record, to start later pages on the same turn without replaying it.
export const saveCampaign = (page) => page.evaluate(() => { const { g, G } = window.__game; G.save(g, 1); return localStorage.getItem('haou-hd2d-save:1'); });

// Continues the saved record (open(…, { save })) as a player would, through 继续记录, and waits for the player's turn.
export async function resumeCampaign(page) {
  await skipIntro(page);
  await page.getByText('继续记录').click();
  await page.waitForFunction(() => { const g = window.__game.g; return document.body.dataset.screen === 'strategy' && g?.current === g.player && !document.querySelector('.aiturn, .panel.msg'); }, null, { timeout: 30000 });
}

// Clicks through story messages as they appear (not confirms or menus), until stop() is called; with `aiTurns`,
// the AI factions' 「战略中」 / AI-war plaques too.
export function closeMessages(page, { aiTurns = false } = {}) {
  // unref: a stop() missed on a failure must not keep node running after the browser has closed.
  const t = setInterval(() => page.evaluate((ai) => { document.querySelector('.panel.msg')?.click(); if (ai) document.querySelector('.aiturn.in:not(.aside)')?.click(); }, aiTurns).catch(() => {}), 250).unref();
  return () => clearInterval(t);
}

// Within ±tol (a fraction) of want.
export const near = (got, want, tol = 0.3) => Math.abs(got - want) <= want * tol;

// The action panel (src/app.js actPanel, D32). His commands stand in his card; a 计略 is chosen, its target picked and the cast
// confirmed in the panel. 施展 takes a new input only after the confirmation has been up a moment (src/commitguard.js GUARD).
export const CARD_ACTS = '.unitpanel:not(.compare) .acts button';
export async function castGo(page) {
  const go = page.locator('.actpanel .ap-go:not([disabled])');
  await go.waitFor({ timeout: 15000 });
  await page.waitForTimeout(360);
  await go.click();
}

// The strategy command menu (src/app.js commandDock): a group (城 / 军 / 仓 / 町 / 外交) opens its list above the dock.
// openCmds opens `tab` unless it is open already; cmdRow is a row of the open list; cmd opens the group and clicks the row.
export async function openCmds(page, tab) {
  if (await page.evaluate(() => document.querySelector('.dock .tabs .btn.on')?.textContent ?? null) !== tab) await page.locator('.dock .tabs .btn', { hasText: tab }).click();
  await page.waitForSelector('.dock .acts:not([hidden])');
}
export const cmdRow = (page, act) => page.locator('.dock .acts .cmd', { has: page.locator('b', { hasText: new RegExp(`^${act}$`) }) });
export async function cmd(page, tab, act) { await openCmds(page, tab); await cmdRow(page, act).click(); }
