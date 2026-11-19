import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, newCampaign } from './game.mjs';
import { launchChrome } from '../tools/headless.mjs';

let game;
before(async () => { game = await startGame({ scenario: 'original' }); });
after(async () => { await game?.close(); });

test('普通档和快捷档任一落盘步骤失败时，保留主档、备份和当前战役', async () => {
  const p = await game.open('&flat');
  try {
    const outcomes = await p.evaluate(async () => {
      const { G } = window.__game, outcomes = [];
      for (const quick of [false, true]) {
        const key = quick ? 'haou-hd2d-save:quick' : 'haou-hd2d-save:1', backupKey = key + ':bak';
        const g = G.newGame(4, 1, 7);
        for (const year of [190, 191]) {
          g.year = year;
          if (!(quick ? G.saveQuick(g) : G.save(g, 1))) throw new Error('测试存档创建失败');
        }
        const raw = localStorage.getItem(key), backup = localStorage.getItem(backupKey);
        const write = () => quick ? G.saveQuickChecked(g, localStorage.getItem(key)) : G.saveChecked(g, 1, localStorage.getItem(key));
        const set = Storage.prototype.setItem;
        g.year = 192;
        const live = JSON.stringify(g);
        for (const failingKey of [backupKey, key]) {
          Storage.prototype.setItem = function (name, value) {
            if (name === failingKey) throw new DOMException('测试：存档空间不足', 'QuotaExceededError');
            return set.call(this, name, value);
          };
          try {
            outcomes.push([await write(), localStorage.getItem(key) === raw, localStorage.getItem(backupKey) === backup, JSON.stringify(g) === live]);
          } finally { Storage.prototype.setItem = set; }
        }
        outcomes.push([await write(), JSON.parse(localStorage.getItem(key)).year, localStorage.getItem(backupKey) === raw]);
      }
      return outcomes;
    });
    const expected = [['failed', true, true, true], ['failed', true, true, true], ['saved', 192, true]];
    assert.deepEqual(outcomes, [...expected, ...expected]);
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); }
});

test('导入较新版本记录时立即提示更新客户端，并保留既有记录', async () => {
  const p = await game.open('&flat');
  try {
    const { before, future } = await p.evaluate(() => {
      const { G } = window.__game, g = G.newGame(4, 1, 7);
      if (!G.save(g, 1)) throw new Error('测试存档创建失败');
      return { before: G.slotToken(1), future: JSON.stringify({ ...g, version: G.SAVE_VERSION + 1 }) };
    });
    await p.goto(new URL('save-editor.html', game.url).href);
    await p.waitForFunction(() => window.__editor?.g);
    await p.locator('#file').setInputFiles({ name: 'future.json', mimeType: 'application/json', buffer: Buffer.from(future) });
    await p.getByText('记录来自更新版本，请更新游戏后导入', { exact: false }).waitFor();
    assert.equal(await p.getByRole('dialog', { name: '导入到哪个记录槽' }).count(), 0);
    assert.equal(await p.evaluate(() => localStorage.getItem('haou-hd2d-save:1')), before);
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); }
});

test('还原此城 preserves the original special land and the legal maximum governance', async () => {
  const p = await game.open();
  try {
    await p.evaluate(() => {
      const { G } = window.__game, g = G.newGame(4, 0, 1);
      G.maxRulerCity(g); g.cities[g.factions[g.player].city].gov = 100;
      G.save(g, 1);
    });
    await p.goto(new URL('save-editor.html', game.url).href);
    await p.waitForFunction(() => window.__editor?.g);
    await p.locator('#tabs button', { hasText: '城市' }).click();
    await p.getByRole('button', { name: '还原此城' }).click();
    const result = await p.evaluate(() => {
      const e = window.__editor, c = e.g.cities[e.g.factions[e.g.player].city];
      return { land: c.land, gov: c.gov, changes: e.changes().length };
    });
    assert.deepEqual(result, { land: 9999, gov: 100, changes: 0 });
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); }
});

test('a failed save cannot suppress confirmation when another page fills that slot', async () => {
  const p = await game.open(), q = await p.context().newPage();
  try {
    await newCampaign(p, '曹操');
    await p.waitForFunction(() => document.querySelector('.citypanel') && !document.querySelector('.banner, .panel.msg, .shade, #fade.on, .vig'), null, { timeout: 30000 });
    await q.goto(game.url); await q.waitForFunction(() => window.__game?.debug);
    await p.evaluate(() => {
      const { G, g } = window.__game; g.freeSave = true; G.save(g, 1);
      const set = Storage.prototype.setItem; window.__recordTestSet = set;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'haou-hd2d-save:2') throw new DOMException('full', 'QuotaExceededError');
        return set.call(this, key, value);
      };
    });
    const openSave = async () => {
      await p.click('.sysmenu-btn'); await p.locator('.sysmenu-list button', { hasText: '记录进度' }).click();
      await p.locator('.shade .slot', { hasText: '记录二' }).waitFor();
    };
    await openSave(); await p.locator('.shade .slot', { hasText: '记录二' }).click();
    await p.getByText(/记录失败/).first().waitFor({ timeout: 5000 });
    assert.equal(await p.evaluate(() => window.__game.g.slot), 1);
    await p.evaluate(() => { Storage.prototype.setItem = window.__recordTestSet; });
    await q.evaluate(() => { const { G } = window.__game, g = G.newGame(2, 1, 7); g.year = 222; G.save(g, 2); });
    await p.waitForFunction(() => !document.querySelector('.banner, .panel.msg, .shade, #fade.on, .vig'));
    await openSave(); await p.locator('.shade .slot', { hasText: '记录二' }).click();
    await p.locator('.shade .modal', { hasText: '覆盖记录' }).waitFor({ timeout: 5000 });
    assert.equal(await q.evaluate(() => JSON.parse(localStorage.getItem('haou-hd2d-save:2')).year), 222);
    await p.keyboard.press('Escape'); await p.keyboard.press('Escape');
    await q.evaluate(() => { const { G } = window.__game, g = G.newGame(2, 1, 8); g.year = 223; G.save(g, 1); });
    await openSave(); await p.locator('.shade .slot', { hasText: '记录一' }).click();
    await p.locator('.shade .modal', { hasText: '覆盖记录' }).waitFor({ timeout: 5000 });
    assert.equal(await q.evaluate(() => JSON.parse(localStorage.getItem('haou-hd2d-save:1')).year), 223);
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); }
});

test('the save picker compares against the exact numbered record it displayed', async () => {
  const p = await game.open();
  try {
    await newCampaign(p, '曹操');
    await p.waitForFunction(() => document.querySelector('.citypanel') && !document.querySelector('.banner, .panel.msg, .shade, #fade.on, .vig'), null, { timeout: 30000 });
    await p.evaluate(() => {
      const { G, g } = window.__game, old = G.newGame(4, 1, 1); old.year = 190; G.save(old, 2); g.freeSave = true;
      const next = JSON.stringify({ ...old, year: 222 }), get = Storage.prototype.getItem;
      let reads = 0;
      Storage.prototype.getItem = function (key) {
        if (key === 'haou-hd2d-save:2' && ++reads === 2) this.setItem(key, next);
        return get.call(this, key);
      };
    });
    await p.click('.sysmenu-btn'); await p.locator('.sysmenu-list button', { hasText: '记录进度' }).click();
    const shown = p.locator('.shade .slot', { hasText: '记录二' });
    await shown.waitFor(); assert.match(await shown.innerText(), /190年/);
    await shown.click(); await p.getByText(/记录已改变/).first().waitFor({ timeout: 5000 });
    assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('haou-hd2d-save:2')).year), 222);
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); }
});

test('the import picker compares against the exact numbered record it displayed', async () => {
  const p = await game.open();
  try {
    await p.evaluate(() => { const { G } = window.__game, old = G.newGame(4, 1, 1); old.year = 190; G.save(old, 2); });
    await p.goto(new URL('save-editor.html', game.url).href); await p.waitForFunction(() => window.__editor);
    const imported = await p.evaluate(async () => {
      const G = await import('./src/core/game.js'), old = G.load(2), next = JSON.stringify({ ...old, year: 222 });
      const get = Storage.prototype.getItem; let reads = 0;
      Storage.prototype.getItem = function (key) {
        if (key === 'haou-hd2d-save:2' && ++reads === 2) this.setItem(key, next);
        return get.call(this, key);
      };
      return G.newGame(4, 1, 3);
    });
    await p.locator('#file').setInputFiles({ name: 'record.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
    const shown = p.locator('.modal .slotc', { hasText: '记录二' });
    await shown.waitFor(); assert.match(await shown.innerText(), /190年/);
    await shown.click(); await p.getByText(/记录已改变/).first().waitFor({ timeout: 5000 });
    assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('haou-hd2d-save:2')).year), 222);
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); }
});

test('an editor confirmation cannot overwrite a numbered record changed in another page', async () => {
  const p = await game.open(), q = await p.context().newPage();
  try {
    await p.evaluate(() => { const { G } = window.__game; G.save(G.newGame(4, 1, 1), 1); });
    await p.goto(new URL('save-editor.html', game.url).href); await p.waitForFunction(() => window.__editor?.g);
    await q.goto(game.url); await q.waitForFunction(() => window.__game?.debug);
    const war = p.getByLabel('武力数值'); await war.fill('1'); await war.blur();
    await p.click('#write'); await p.locator('.modal button', { hasText: '写回' }).waitFor();
    const replacement = await q.evaluate(() => { const { G } = window.__game, g = G.newGame(2, 1, 2); g.year = 222; G.save(g, 1); return localStorage.getItem('haou-hd2d-save:1'); });
    await p.locator('.modal button', { hasText: '写回' }).click();
    await p.getByText(/记录已改变/).first().waitFor({ timeout: 5000 });
    assert.equal(await q.evaluate(() => localStorage.getItem('haou-hd2d-save:1')), replacement);
    assert.ok(await p.evaluate(() => window.__editor.changes().length));
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); }
});

test('editing a numbered record while its write waits cancels the stale snapshot', async () => {
  const p = await game.open(), q = await p.context().newPage();
  try {
    await p.evaluate(() => { const { G } = window.__game; G.save(G.newGame(4, 1, 1), 1); });
    await p.goto(new URL('save-editor.html', game.url).href); await p.waitForFunction(() => window.__editor?.g);
    const before = await p.evaluate(() => localStorage.getItem('haou-hd2d-save:1'));
    await q.goto(new URL('data/game-data.json', game.url).href);
    await q.evaluate(() => { window.__holdRecord = navigator.locks.request('haou-hd2d-save:1', () => new Promise((resolve) => { window.__releaseRecord = resolve; })); });
    await q.waitForFunction(() => typeof window.__releaseRecord === 'function');
    const war = p.getByLabel('武力数值'); await war.fill('1'); await war.blur();
    await p.click('#write'); await p.locator('.modal button', { hasText: '写回' }).click();
    await p.waitForFunction(async () => (await navigator.locks.query()).pending.some((x) => x.name === 'haou-hd2d-save:1'));
    await war.fill('2'); await war.blur(); await q.evaluate(() => window.__releaseRecord());
    await p.getByText(/编辑内容已变化/).first().waitFor({ timeout: 5000 });
    assert.equal(await p.evaluate(() => localStorage.getItem('haou-hd2d-save:1')), before);
    await p.click('#write'); await p.locator('.modal button', { hasText: '写回' }).click();
    await p.waitForFunction(() => {
      const g = JSON.parse(localStorage.getItem('haou-hd2d-save:1'));
      return g.officers[g.factions[g.player].ruler].war === 2;
    });
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); }
});

test('quick saving cancels a stale snapshot if the running game changes while waiting', async () => {
  const p = await game.open(), q = await p.context().newPage();
  try {
    await newCampaign(p, '曹操');
    await p.waitForFunction(() => document.querySelector('.citypanel') && !document.querySelector('.banner, .panel.msg, .shade, #fade.on, .vig'), null, { timeout: 30000 });
    await p.evaluate(() => { window.__game.g.freeSave = true; });
    const books = await p.evaluate(() => window.__game.g.books);
    await q.goto(new URL('data/game-data.json', game.url).href);
    await q.evaluate(() => { window.__holdQuick = navigator.locks.request('haou-hd2d-save:quick', () => new Promise((resolve) => { window.__releaseQuick = resolve; })); });
    await q.waitForFunction(() => typeof window.__releaseQuick === 'function');
    await p.keyboard.press('F2');
    await p.waitForFunction(async () => (await navigator.locks.query()).pending.some((x) => x.name === 'haou-hd2d-save:quick'));
    await p.evaluate(() => { window.__game.g.year++; });
    await q.evaluate(() => window.__releaseQuick());
    await p.getByText(/本局状态已改变/).first().waitFor({ timeout: 5000 });
    assert.equal(await p.evaluate(() => localStorage.getItem('haou-hd2d-save:quick')), null);
    assert.equal(await p.evaluate(() => window.__game.g.books), books);
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); }
});

test('a newer numbered record is labelled and cannot be selected for import', async () => {
  const p = await game.open();
  try {
    const future = await p.evaluate(() => {
      const { G } = window.__game, g = G.newGame(4, 1, 1); G.save(g, 1); G.save(g, 1);
      const raw = JSON.stringify({ ...g, version: G.SAVE_VERSION + 1 }); localStorage.setItem('haou-hd2d-save:1', raw); return raw;
    });
    await p.goto(new URL('save-editor.html', game.url).href); await p.waitForFunction(() => window.__editor);
    assert.match(await p.locator('#slots .slotc', { hasText: '记录一' }).innerText(), /来自更新版本/);
    const record = await p.evaluate(async () => (await import('./src/core/game.js')).newGame(4, 1, 3));
    await p.locator('#file').setInputFiles({ name: 'record.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(record)) });
    assert.equal(await p.locator('.modal .slotc', { hasText: '记录一' }).isDisabled(), true);
    assert.equal(await p.evaluate(() => localStorage.getItem('haou-hd2d-save:1')), future);
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); }
});

test('ordinary and quick saves serialize across tabs when Web Locks is available', async () => {
  const p = await game.open(), q = await p.context().newPage();
  try {
    await q.goto(game.url); await q.waitForFunction(() => window.__game?.debug);
    const save = (page, quick, year) => page.evaluate(async ({ quick, year }) => {
      const { G } = window.__game, g = G.newGame(4, 1, year); g.year = year;
      return quick ? G.saveQuickChecked(g, null) : G.saveChecked(g, 1, null);
    }, { quick, year });
    for (const quick of [false, true]) {
      const key = quick ? 'haou-hd2d-save:quick' : 'haou-hd2d-save:1';
      for (let i = 0; i < 10; i++) {
        await p.evaluate(async (k) => {
          localStorage.removeItem(k);
          await new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase('haou-hd2d-record-lock');
            request.onsuccess = resolve; request.onerror = () => reject(request.error);
          });
        }, key);
        await q.waitForFunction((k) => localStorage.getItem(k) === null, key);
        const results = await Promise.all([save(p, quick, 190), save(q, quick, 191)]);
        assert.deepEqual([...results].sort(), ['changed', 'saved']);
        const winner = results[0] === 'saved' ? p : q, raw = await winner.evaluate((k) => localStorage.getItem(k), key);
        await Promise.all([p.waitForFunction(([k, value]) => localStorage.getItem(k) === value, [key, raw]), q.waitForFunction(([k, value]) => localStorage.getItem(k) === value, [key, raw])]);
      }
    }
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); }
});

test('ordinary and quick saves serialize across tabs on an insecure HTTP origin', async () => {
  const url = new URL(game.url); url.hostname = 'audit.test';
  const browser = await launchChrome(url.href, ['--no-proxy-server', '--host-resolver-rules=MAP audit.test 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1']);
  try {
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => sessionStorage.setItem('haou-hd2d-scenario', 'original'));
    const p = await ctx.newPage(), q = await ctx.newPage();
    const data = new URL('data/game-data.json', url).href;
    await Promise.all([p.goto(data), q.goto(data)]);
    const save = (page, quick, year) => page.evaluate(async ({ quick, year }) => {
      const G = await import('/hd2d-mvp/src/core/game.js');
      G.setData(await (await fetch('/hd2d-mvp/data/game-data.json')).json());
      const g = G.newGame(4, 1, year); g.year = year;
      return { secure: isSecureContext, hasLocks: !!navigator.locks,
        result: quick ? await G.saveQuickChecked(g, null) : await G.saveChecked(g, 1, null) };
    }, { quick, year });
    for (const quick of [false, true]) {
      const results = await Promise.all([save(p, quick, 190), save(q, quick, 191)]);
      assert.deepEqual(results.map((r) => r.result).sort(), ['changed', 'saved']);
      assert.ok(results.every((r) => !r.secure && !r.hasLocks));
      const key = quick ? 'haou-hd2d-save:quick' : 'haou-hd2d-save:1', winner = results[0].result === 'saved' ? p : q;
      const latest = await winner.evaluate((k) => localStorage.getItem(k), key);
      await p.waitForFunction(([k, raw]) => localStorage.getItem(k) === raw, [key, latest]);
      const reconciled = await p.evaluate(async ({ quick, key }) => {
        const G = await import('/hd2d-mvp/src/core/game.js'), old = G.newGame(4, 1, 192); old.year = 192;
        if (quick) G.saveQuick(old); else G.save(old, 1); // 模拟仍在运行的旧版本页面
        const token = localStorage.getItem(key), next = G.newGame(4, 1, 193); next.year = 193;
        let conflict;
        const write = (options) => quick ? G.saveQuickChecked(next, token, options) : G.saveChecked(next, 1, token, options);
        const first = await write({ onConflict: (raw) => { conflict = raw; } });
        const kept = localStorage.getItem(key) === token;
        const accepted = await write({ acceptedConflict: conflict });
        return { first, kept, accepted, year: JSON.parse(localStorage.getItem(key)).year };
      }, { quick, key });
      assert.deepEqual(reconciled, { first: 'changed', kept: true, accepted: 'saved', year: 193 });
      if (!quick) {
        const protectedFuture = await p.evaluate(async (key) => {
          const G = await import('/hd2d-mvp/src/core/game.js'), token = localStorage.getItem(key);
          const future = JSON.stringify({ ...JSON.parse(token), version: G.SAVE_VERSION + 1 });
          await new Promise((resolve, reject) => {
            const open = indexedDB.open('haou-hd2d-record-lock', 1);
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const db = open.result, tx = db.transaction('lock', 'readwrite');
              tx.objectStore('lock').put({ token: future }, key);
              tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error);
            };
          });
          const result = await G.saveChecked(G.newGame(4, 1, 194), 1, token, { acceptedConflict: future });
          return { result, kept: localStorage.getItem(key) === token };
        }, key);
        assert.deepEqual(protectedFuture, { result: 'newer', kept: true });
      }
    }
    const editor = await ctx.newPage();
    await editor.goto(new URL('save-editor.html', url).href); await editor.waitForFunction(() => window.__editor);
    await editor.evaluate(async () => {
      const G = await import('./src/core/game.js'), g = G.newGame(4, 1, 4);
      if (await G.saveChecked(g, 2, null) !== 'saved') throw new Error('准备记录失败');
      G.save({ ...g, year: 194 }, 2); // 模拟旧页面绕过新的协调记录
    });
    await editor.reload(); await editor.waitForFunction(() => window.__editor);
    await editor.locator('#slots .slotc', { hasText: '记录二' }).click();
    const war = editor.getByLabel('武力数值'); await war.fill('1'); await war.blur();
    const confirmWrite = async () => { await editor.click('#write'); await editor.locator('.modal button', { hasText: '写回' }).click(); };
    await confirmWrite(); await editor.locator('.modal', { hasText: '记录冲突' }).waitFor();
    const original = await editor.evaluate(() => localStorage.getItem('haou-hd2d-save:2'));
    await editor.locator('.modal button', { hasText: '取消' }).click();
    assert.equal(await editor.evaluate(() => localStorage.getItem('haou-hd2d-save:2')), original);
    await confirmWrite(); await editor.locator('.modal button', { hasText: '继续覆盖' }).click();
    await editor.waitForFunction(() => {
      const g = JSON.parse(localStorage.getItem('haou-hd2d-save:2'));
      return g.officers[g.factions[g.player].ruler].war === 1;
    });
    await editor.evaluate(async () => {
      const G = await import('./src/core/game.js'); G.save(G.newGame(4, 1, 5), 3);
      await new Promise((resolve, reject) => {
        const open = indexedDB.open('haou-hd2d-record-lock', 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result, tx = db.transaction('lock', 'readwrite');
          tx.objectStore('lock').put({ token: null }, 'haou-hd2d-save:3');
          tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error);
        };
      });
    });
    await editor.reload(); await editor.waitForFunction(() => window.__editor);
    await editor.locator('#slots .slotc', { hasText: '记录三' }).click();
    const nextWar = editor.getByLabel('武力数值'); await nextWar.fill('2'); await nextWar.blur();
    await confirmWrite(); await editor.locator('.modal', { hasText: '记录冲突' }).waitFor();
    await editor.locator('.modal button', { hasText: '继续覆盖' }).click();
    await editor.waitForFunction(() => {
      const g = JSON.parse(localStorage.getItem('haou-hd2d-save:3'));
      return g.officers[g.factions[g.player].ruler].war === 2;
    });
    const unavailable = await p.evaluate(async () => {
      Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined });
      const G = await import('/hd2d-mvp/src/core/game.js'), g = G.newGame(4, 1, 195), token = G.quickToken();
      const quick = await G.saveQuickChecked(g, token), normal = await G.saveChecked(g, 4, null);
      return { quick, normal, unchanged: G.quickToken() === token && G.slotToken(4) === null };
    });
    assert.deepEqual(unavailable, { quick: 'unavailable', normal: 'unavailable', unchanged: true });
    await ctx.close();
  } finally { await browser.close(); }
});
