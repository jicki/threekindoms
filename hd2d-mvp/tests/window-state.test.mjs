import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
const { fitBounds } = createRequire(import.meta.url)('../desktop/window-state.cjs');

test('恢复的窗口保持在现有显示器工作区，断开的屏幕回到主屏', () => {
  const displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }, { workArea: { x: 1920, y: 0, width: 1280, height: 800 } }];
  assert.deepEqual(fitBounds({ x: 2100, y: 50, width: 1200, height: 700, fullscreen: true }, displays), { x: 2000, y: 50, width: 1200, height: 700, maximize: false, fullscreen: true });
  assert.deepEqual(fitBounds({ x: 9000, y: 0, width: 1200, height: 700 }, displays.slice(0, 1)), { x: 360, y: 190, width: 1200, height: 700, maximize: false, fullscreen: false });
  const small = fitBounds(null, [{ workArea: { x: 0, y: 0, width: 800, height: 500 } }]);
  assert.equal(small.maximize, true); assert.equal(small.width, 800); assert.equal(small.height, 500);
  assert.equal(fitBounds({ x: NaN, y: 0, width: 1, height: 1 }, displays).width, 1600);
});

test('桌面关闭确认保护战斗进度，取消后保留窗口，IPC 拒绝其他页面', async () => {
  const stored = new Map(), handlers = new Map(), prompts = [];
  let win, response = 0;
  class FakeWindow extends EventEmitter {
    constructor(options) { super(); this.options = options; this.closed = false; this.full = false; win = this;
      this.webContents = new EventEmitter(); this.webContents.mainFrame = { url: 'app://game/index.html' };
      this.webContents.setWindowOpenHandler = () => {}; this.webContents.executeJavaScript = async () => ({ active: true, screen: 'war' });
    }
    loadURL() { return Promise.resolve(); } isDestroyed() { return false; } isFullScreen() { return this.full; }
    setFullScreen(v) { this.full = v; } isMaximized() { return false; } getNormalBounds() { return { x: 10, y: 20, width: 1200, height: 700 }; }
    close() { let prevented = false; this.emit('close', { preventDefault() { prevented = true; } }); if (!prevented) this.closed = true; }
    static fromWebContents(wc) { return wc === win?.webContents ? win : null; } static getAllWindows() { return win ? [win] : []; }
  }
  const app = new EventEmitter(); Object.assign(app, { isPackaged: true, requestSingleInstanceLock: () => true, getPath: () => '/test-profile', getVersion: () => 'test',
    commandLine: { appendSwitch() {} }, disableDomainBlockingFor3DAPIs() {}, whenReady: () => Promise.resolve(), getGPUInfo: async () => ({}), getGPUFeatureStatus: () => ({}) });
  const fakeFs = { existsSync: (p) => String(p).endsWith('/app/index.html') || stored.has(p), mkdirSync() {},
    readFileSync: (p) => { if (!stored.has(p)) throw new Error('missing'); return stored.get(p); }, writeFileSync: (p, v) => stored.set(p, v),
    renameSync: (a, b) => { stored.set(b, stored.get(a)); stored.delete(a); }, appendFileSync() {} };
  const electron = { app, BrowserWindow: FakeWindow, Menu: { setApplicationMenu() {} }, crashReporter: { start() {} },
    dialog: { showMessageBox: async (_w, opts) => { prompts.push(opts); return { response }; }, showErrorBox() {} },
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, protocol: { registerSchemesAsPrivileged() {}, handle() {} },
    screen: { getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1600, height: 900 } }] }, net: {}, shell: {} };
  const nodeRequire = createRequire(import.meta.url);
  const req = (name) => name === 'electron' ? electron : name === 'node:fs' ? fakeFs : name === './window-state.cjs' ? { fitBounds } : nodeRequire(name);
  const proc = { argv: ['electron'], versions: {}, platform: 'test', arch: 'test', execPath: 'electron', on() {} };
  const source = readFileSync(new URL('../desktop/main.js', import.meta.url), 'utf8');
  vm.runInNewContext(`(function () {\n${source}\n})()`, { require: req, process: proc, __dirname: '/test-desktop', console, URL, setInterval: () => 1, clearInterval() {} });
  await new Promise((resolve) => setImmediate(resolve));
  const sender = win.webContents, valid = { sender, senderFrame: sender.mainFrame };
  assert.equal(await handlers.get('game:fullscreen')({ sender, senderFrame: { url: 'https://example.com/' } }), false);
  assert.equal(await handlers.get('game:fullscreen')(valid), true);
  await handlers.get('game:quit')(valid); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(win.closed, false); assert.match(prompts[0].detail, /中断战斗/);
  response = 1; win.close(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(win.closed, true);
  assert.equal(JSON.parse(stored.get('/test-profile/window-state.json')).fullscreen, true);
});
