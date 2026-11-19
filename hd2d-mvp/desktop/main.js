// Electron shell for the playtest build: serves desktop/app/ (made by build-app.mjs) from app://game/.
// A fixed custom origin lets ES modules and fetch() work (file:// would not) and keeps localStorage saves
// in the user's profile across reinstalls. F11 toggles fullscreen, Alt+Enter too.
//   --smoke=<dir>  load, screenshot, log console errors and missing files to <dir>, then quit (for CI / checks)
const { app, BrowserWindow, Menu, crashReporter, dialog, ipcMain, net, protocol, screen, shell } = require('electron');
const { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { fitBounds } = require('./window-state.cjs');

const ROOT = path.join(__dirname, 'app');
const ORIGIN = 'app://game';
const smokeDir = (process.argv.find((a) => a.startsWith('--smoke=')) || '').slice(8) || null;
const devTools = !app.isPackaged || process.argv.includes('--devtools');
const BOOT_LIMIT = 90; // seconds to the title before the player is told; a slow disk with software GL takes long, not this long

// One process per profile, taken before anything below touches it. Two would share Local Storage/leveldb: the one that
// finds it locked has Chromium destroy the database, which succeeds if the holder exits within seconds, and every save
// is gone (a double double-click on Windows, 2026-11-06). Past the deletion window it runs on an empty in-memory store.
if (!app.requestSingleInstanceLock()) {
  if (smokeDir) console.error('another instance holds this profile; smoke did not run');
  app.exit(smokeDir ? 1 : 0);
  return; // app.exit does not stop this script
}
app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0]; // none yet while starting up: the window on its way is the answer
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

// The startup record: a player whose game does not start has only this file and the crash dumps to send (devblog #100,
// 2026-11-03: Win10, double-click, nothing). The previous run's is kept beside it. No file at all means the process never
// got as far as this line, which points away from the game (the system, a security tool, the unpacked files).
const logFile = (() => {
  for (const dir of [path.join(app.getPath('userData'), 'logs'), path.join(os.tmpdir(), 'Three Kingdoms HD-2D')]) {
    try {
      mkdirSync(dir, { recursive: true });
      const f = path.join(dir, 'startup.log');
      if (existsSync(f)) renameSync(f, path.join(dir, 'startup.prev.log'));
      writeFileSync(f, '');
      return f;
    } catch { /* a profile that cannot be written: the next place */ }
  }
  return null;
})();
let logLines = 0;
const log = (line) => {
  if (!logFile || logLines > 500) return; // a page that repeats an error must not fill the disk
  try { appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`); logLines++; } catch { /* nothing more can be done */ }
};
// Tells the player once what failed and where the record is (AGENTS.md: never a silent black window), and opens its folder.
let told = false;
function fail(what, detail = '') {
  log(`FAIL ${what}${detail ? `: ${detail}` : ''}`);
  if (smokeDir || told) return;
  told = true;
  dialog.showErrorBox('三国 HD-2D 未能正常运行', `${what}${detail ? `\n\n${detail}` : ''}\n\n${logFile ? `详细记录在：\n${logFile}\n反馈问题时请附上这个文件。` : '无法写入日志文件。'}`);
  if (logFile) shell.showItemInFolder(logFile);
}
process.on('uncaughtException', (err) => {
  fail('程序内部错误', err?.stack || String(err));
  if (!app.isReady() || !BrowserWindow.getAllWindows().length) app.exit(1); // no window to fall back on: a process left running shows nothing
});
process.on('unhandledRejection', (err) => log(`unhandled rejection: ${err?.stack || err}`));

let buildCommit = 'unknown';
try { buildCommit = JSON.parse(readFileSync(path.join(ROOT, 'build.json'), 'utf8')).commit; } catch { /* reported below by the missing files */ }
log(`start ${app.getVersion()} (${buildCommit}) electron ${process.versions.electron} chrome ${process.versions.chrome} ${process.platform} ${process.arch} ${os.release()} packaged=${app.isPackaged}`);
log(`exe ${process.execPath}`);
log(`cpu ${os.cpus()[0]?.model} x${os.cpus().length}, memory ${Math.round(os.totalmem() / 2 ** 20)} MB`);
try { crashReporter.start({ uploadToServer: false }); log(`crash dumps ${app.getPath('crashDumps')}`); } catch (err) { log(`crash reporter: ${err}`); } // kept on this machine, sent nowhere

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } }]);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('force_high_performance_gpu');
// After a GPU process crash Chromium may refuse WebGL to the page it blames, so the context never comes back and the
// game stays white (a Windows AMD player, 2026-11-08: two crashes two minutes apart, white after the second). The game
// is the only page here and recovers its context itself (src/app.js), so it is never blocked.
app.disableDomainBlockingFor3DAPIs();
if (smokeDir) app.commandLine.appendSwitch('mute-audio'); // checks run silent (AGENTS.md)

const EXPECTED_MISS = /^assets\/audio\/(original|remix)\/|^assets\/audio\/(sfx|bgm|cue)-[\w-]+\.mp3$/; // manifest fallbacks probed in order
const missing = [];
let bootError = null, bootErrorAt = 0; // the first thing that stops the game reaching its title
const noteBootError = (msg) => { if (!bootError) { bootError = msg; bootErrorAt = Date.now(); } };
function serve(request) {
  const url = new URL(request.url);
  if (url.host !== 'game') return new Response('not found', { status: 404 });
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep) || !existsSync(file)) {
    missing.push(rel);
    if (!EXPECTED_MISS.test(rel)) log(`missing file ${rel}`);
    if (rel.endsWith('.js')) noteBootError(`缺少游戏文件 ${rel}。请重新完整解压压缩包。`); // every module is a static import: the game cannot come up without it
    return new Response('not found', { status: 404 });
  }
  return net.fetch(pathToFileURL(file).toString());
}

// What the page does on the way to the title goes in the record, and a page that never gets there says so: a game
// that cannot start WebGL or load a module otherwise leaves a black window and no word.
function watchPage(win) {
  const wc = win.webContents, t0 = Date.now(), secs = () => (Date.now() - t0) / 1000;
  let up = false;
  win.once('ready-to-show', () => log(`window ready after ${secs()}s`));
  win.on('unresponsive', () => log('window unresponsive'));
  win.on('responsive', () => log('window responsive again'));
  wc.on('did-finish-load', () => log(`page loaded after ${secs()}s`));
  wc.on('did-fail-load', (_e, code, desc, url, isMain) => {
    log(`load failed ${code} ${desc} ${url}`);
    if (isMain) fail('游戏页面加载失败', `${desc} (${code})`);
  });
  wc.on('render-process-gone', (_e, d) => { if (d.reason !== 'clean-exit') fail('游戏页面进程意外退出', `${d.reason} (退出码 ${d.exitCode})`); });
  wc.on('console-message', (e) => {
    if (e.level !== 'error' && e.level !== 'warning') return;
    log(`page ${e.level}: ${e.message} (${e.sourceId}:${e.lineNumber})`);
    if (!up && /Uncaught|module script/i.test(e.message)) noteBootError(e.message);
  });
  const timer = setInterval(() => {
    if (win.isDestroyed()) return clearInterval(timer);
    wc.executeJavaScript('document.body?.dataset.screen || ""').then((screen) => {
      if (screen && !up) { up = true; clearInterval(timer); log(`game up after ${secs()}s (${screen}), features ${JSON.stringify(app.getGPUFeatureStatus())}`); }
    }, () => {});
    if (up) return;
    if (bootError && Date.now() >= bootErrorAt + 10000) { clearInterval(timer); fail('游戏未能启动', bootError); } // a moment's grace: the title may still come
    else if (secs() >= BOOT_LIMIT) { clearInterval(timer); fail(`${BOOT_LIMIT} 秒后游戏仍未进入标题画面`, '若画面随后正常出现，可以继续游玩。'); }
  }, 1000);
}

function createWindow() {
  const stateFile = path.join(app.getPath('userData'), 'window-state.json');
  let saved = null;
  try { saved = JSON.parse(readFileSync(stateFile, 'utf8')); } catch { /* 首次启动或状态文件损坏时使用默认位置 */ }
  const { maximize, fullscreen, ...bounds } = fitBounds(saved, screen.getAllDisplays());
  const win = new BrowserWindow({
    ...bounds, minWidth: 1024, minHeight: 600, backgroundColor: '#000000',
    title: '三国 HD-2D', autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs'), devTools, backgroundThrottling: false },
  });
  if (maximize) win.maximize();
  if (fullscreen) win.setFullScreen(true);
  let closing = false, asking = false;
  win.on('close', (event) => {
    if (closing || smokeDir) return;
    event.preventDefault(); if (asking) return; asking = true;
    (async () => {
      let active = true, war = false;
      try { const state = await win.webContents.executeJavaScript('({active: !!window.__game?.g, screen: document.body?.dataset.screen})'); active = !!state.active; war = state.screen === 'war'; }
      catch { /* 无法读取页面状态时保守确认，避免丢失进度 */ }
      if (active) {
        const choice = await dialog.showMessageBox(win, { type: 'question', buttons: ['取消', '退出游戏'], defaultId: 0, cancelId: 0,
          message: '退出游戏？', detail: war ? '未保存的战斗进度将丢失。可先取消并使用「系统 → 中断战斗」。' : '未保存的进度将丢失。可先取消并记录进度。' });
        if (choice.response !== 1) return;
      }
      try {
        const state = { ...win.getNormalBounds(), maximize: win.isMaximized(), fullscreen: win.isFullScreen() };
        writeFileSync(`${stateFile}.tmp`, JSON.stringify(state)); renameSync(`${stateFile}.tmp`, stateFile);
      } catch (err) { log(`window state: ${err.message}`); }
      closing = true; win.close();
    })().catch((err) => log(`close confirmation: ${err.message}`)).finally(() => { asking = false; });
  });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.alt && input.key === 'Enter')) { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (devTools && input.key === 'F12') { win.webContents.toggleDevTools(); e.preventDefault(); }
  });
  // Stay on the game origin; anything else opens in the user's browser.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(ORIGIN)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  // No back or forward in a game window: a mouse's side button, a swipe or Alt+← would otherwise leave an unsaved
  // game for the page before it (the save editor). The pages swallow the side buttons too (src/ui.js).
  win.webContents.on('did-navigate', () => win.webContents.navigationHistory?.clear());
  watchPage(win);
  win.loadURL(`${ORIGIN}/index.html`).catch(() => {}); // did-fail-load has already told it
  return win;
}

async function smoke(win) {
  const log = [];
  win.webContents.on('console-message', (e) => log.push(`[${e.level}] ${e.message}`));
  win.webContents.on('render-process-gone', (_e, d) => log.push(`[crash] ${d.reason}`));
  await new Promise((r) => win.webContents.once('did-finish-load', r));
  const shot = async (name, wait) => {
    await new Promise((r) => setTimeout(r, wait));
    writeFileSync(path.join(smokeDir, name), (await win.webContents.capturePage()).toPNG());
  };
  const js = (code) => win.webContents.executeJavaScript(code);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // Real mouse input at the centre of the first element matching selector (and text, if given).
  const click = async (selector, text = '') => {
    const r = await js(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((e) => e.textContent.includes(${JSON.stringify(text)}) && e.getClientRects().length)
      .sort((a, b) => a.textContent.length - b.textContent.length)[0]; // innermost match
      if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; })()`);
    if (!r) throw new Error(`no ${selector} ${text}`);
    for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
    await wait(700);
  };
  const probe = () => js(`({
    screen: document.body.dataset.screen,
    fonts: ['112px "Ma Shan Zheng"', '20px "Noto Serif SC"'].map((f) => document.fonts.check(f, '三国')),
    webgl: !!document.querySelector('#stage canvas'),
    sfx: Object.fromEntries(Object.entries(window.__game?.audio?.files || {}).filter(([k]) => k.startsWith('sfx-')).map(([k, v]) => [k, v.split('/').slice(-2).join('/')])),
    bgm: (() => { const a = window.__game?.audio, b = a?.bgm; return a?.bgmKey ? { src: a.url(a.bgmKey), state: a.bgmState(), at: a.bgmTime(), loop: b?.buf ? [b.buf.start, b.buf.end] : null } : null; })(),
  })`);
  const steps = {};
  const step = async (name, fn) => {
    try { await fn(); steps[name] = await probe(); } catch (err) { steps[name] = { error: String(err) }; }
    await shot(`${Object.keys(steps).length}-${name}.png`, 0);
  };
  await step('title', () => wait(10000));
  await step('strategy', async () => {
    // A click during the title animation only skips it, so retry until the ruler picker opens.
    for (let i = 0; i < 8 && !(await js('!!document.querySelector(".ruler")')); i++) await click('*', '新的征程').catch(() => wait(700));
    await click('.ruler', '曹操'); await click('.ruler', '曹操');
    for (let i = 0; i < 40 && (await js('document.body.dataset.screen')) !== 'strategy'; i++) await wait(250);
    await wait(2500);
    const { width, height } = win.getContentBounds();
    for (let i = 0; i < 4; i++) { for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, x: width / 2, y: height - 120, button: 'left', clickCount: 1 }); await wait(600); }
  });
  await step('tactical', async () => {
    await js('window.__run = window.__game.debug.quickTactical(38, 51, 2); 0');
    for (let i = 0; i < 40 && !(await js('!!document.querySelector(".tq-form")')); i++) await wait(250);
    await click('.tq-form'); await wait(400); await click('.tq-deploy'); await wait(5000); // picked, then deployed (D32 phase 2)
  });
  const miss = [...new Set(missing)];
  writeFileSync(path.join(smokeDir, 'report.json'), JSON.stringify({
    steps, missing: miss.filter((m) => !EXPECTED_MISS.test(m)), fallbackProbes: miss.filter((m) => EXPECTED_MISS.test(m)).length,
    console: log.filter((l) => !l.includes('Electron Security Warning')),
  }, null, 1));
  app.quit();
}

Menu.setApplicationMenu(null);
app.on('child-process-gone', (_e, d) => log(`child process gone: ${d.type} ${d.reason} (exit ${d.exitCode})`)); // the GPU process among them
app.whenReady().then(() => {
  log('app ready');
  if (!existsSync(path.join(ROOT, 'index.html'))) { fail('游戏文件不完整', '找不到游戏页面。请把压缩包完整解压后，再运行解压目录里的程序。'); return app.exit(1); }
  app.getGPUInfo('basic').then((info) => log(`gpu ${JSON.stringify(info.gpuDevice)} features ${JSON.stringify(app.getGPUFeatureStatus())}`), (err) => log(`gpu info: ${err}`));
  protocol.handle('app', serve);
  const validSender = (event) => {
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false;
    try { const url = new URL(event.senderFrame.url); return url.protocol === 'app:' && url.host === 'game' && url.pathname === '/index.html'; } catch { return false; }
  };
  ipcMain.handle('game:fullscreen', (event) => { if (!validSender(event)) return false; const w = BrowserWindow.fromWebContents(event.sender); if (!w) return false; w.setFullScreen(!w.isFullScreen()); return w.isFullScreen(); });
  ipcMain.handle('game:quit', (event) => { if (!validSender(event)) return false; BrowserWindow.fromWebContents(event.sender)?.close(); return true; });
  const win = createWindow();
  log('window created');
  if (smokeDir) { mkdirSync(smokeDir, { recursive: true }); smoke(win); }
});
app.on('window-all-closed', () => app.quit());
