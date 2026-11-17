// Quick loading from an idle war goes back to a strategic record; it must not silently drop a suspended battle.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, newCampaign, skipIntro, closeMessages } from './game.mjs';

let game;
before(async () => { game = await startGame({ scenario: 'original' }); });
after(() => game?.close());

async function startWar(p, side) {
  await p.evaluate((side) => {
    const { g, G, debug } = window.__game, me = g.player;
    const mine = g.cities.find((c) => c.faction === me && c.officers.length >= 3
      && G.roads(c.id).some((n) => ![me, 255].includes(g.cities[n].faction) && g.cities[n].officers.length));
    const foe = g.cities[G.roads(mine.id).find((n) => ![me, 255].includes(g.cities[n].faction) && g.cities[n].officers.length)];
    const [from, to] = side === 'att' ? [mine, foe] : [foe, mine];
    for (const id of [...from.officers, ...to.officers]) g.officers[id].soldiers ||= 500;
    const ids = from.officers.slice(0, Math.min(3, from.officers.length - (side === 'att' ? 1 : 0)) || 1);
    const w = debug.setupWar(g, { from: from.id, to: to.id, ids, commander: ids[0], gold: 100, rice: 600 });
    debug.fieldWar(w, side, side === 'def' ? { after: { kind: 'def', faction: w.attacker, pts: 30 } } : undefined);
  }, side);
  await p.waitForFunction(() => window.__game.war?.finishDeploy && document.body.dataset.screen === 'war', null, { timeout: 60000 });
  const stop = closeMessages(p);
  try {
    await p.waitForTimeout(2500);
    await p.evaluate(() => window.__game.war.st.deploying && window.__game.war.finishDeploy());
    await p.waitForFunction(() => {
      const w = window.__game.war, f = w?.field;
      return f && f.turn === f.human && !w.st.busy && !w.st.deploying && !document.querySelector('.banner, .panel.msg, .shade, #fade.on');
    }, null, { timeout: 60000 });
  } finally { stop(); }
}

for (const side of ['att', 'def']) {
  test(`quick save is blocked in an idle ${side} battle and F8 confirms returning to strategy`, async () => {
    const p = await game.open();
    try {
      await newCampaign(p, '曹操');
      await p.evaluate(() => { const { g, G } = window.__game; g.cities[g.factions[g.player].city].gold = 4321; G.saveQuick(g); });
      const old = await p.evaluate(() => localStorage.getItem('haou-hd2d-save:quick'));
      await startWar(p, side);
      await p.keyboard.press('F2');
      await p.getByText('战争中不能记录', { exact: false }).waitFor({ timeout: 4000 });
      assert.equal(await p.evaluate(() => localStorage.getItem('haou-hd2d-save:quick')), old);
      await p.keyboard.press('F8');
      await p.locator('.shade .modal', { hasText: '当前战斗' }).waitFor({ timeout: 4000 });
      await p.locator('.shade .btn', { hasText: '取消' }).click();
      assert.equal(await p.evaluate(() => document.body.dataset.screen), 'war');
      await p.keyboard.press('F8');
      await p.locator('.shade .modal', { hasText: '当前战斗' }).waitFor({ timeout: 4000 });
      await Promise.all([p.waitForEvent('load', { timeout: 30000 }), p.locator('.shade .btn.primary').click()]);
      await p.waitForFunction(() => document.body.dataset.screen === 'strategy' && window.__game?.g, null, { timeout: 60000 });
      assert.equal(await p.evaluate(() => { const g = window.__game.g; return g.cities[g.factions[g.player].city].gold; }), 4321);
      assert.deepEqual(p.errors, []);
    } finally { await p.context().close(); }
  });
}

test('existing suspended battles still work when Web Locks and IndexedDB are unavailable', async () => {
  const p = await game.open('', { setup: (ctx) => ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined });
  }) });
  try {
    await newCampaign(p, '曹操'); await startWar(p, 'att');
    await p.click('.sysmenu-btn'); await p.locator('.sysmenu-list button', { hasText: '中断战斗' }).click();
    await p.locator('.shade .btn', { hasText: '中断并回到标题' }).click();
    await p.waitForFunction(() => document.body.dataset.screen === 'title' && window.__game?.debug, null, { timeout: 60000 });
    assert.ok(await p.evaluate(() => localStorage.getItem('haou-hd2d-suspend')));
    await skipIntro(p); await p.getByRole('button', { name: '继续战斗', exact: false }).click();
    const stop = closeMessages(p);
    try { await p.waitForFunction(() => document.body.dataset.screen === 'war' && window.__game.war?.field?.resumed && !document.querySelector('.banner, .panel.msg, .shade, #fade.on'), null, { timeout: 60000 }); }
    finally { stop(); }
    assert.equal(await p.evaluate(() => localStorage.getItem('haou-hd2d-suspend')), null);
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); }
});

test('cancelled or failed quick loading from the title keeps the suspended battle', async () => {
  const p = await game.open();
  try {
    await newCampaign(p, '曹操');
    await p.evaluate(() => { const { g, G } = window.__game; G.saveQuick(g); });
    await startWar(p, 'att');
    await p.click('.sysmenu-btn');
    await p.locator('.sysmenu-list button', { hasText: '中断战斗' }).click();
    await p.locator('.shade .btn', { hasText: '中断并回到标题' }).click();
    await p.waitForFunction(() => document.body.dataset.screen === 'title' && window.__game?.debug, null, { timeout: 60000 });
    await skipIntro(p);
    const key = 'haou-hd2d-suspend';
    const saved = await p.evaluate((k) => localStorage.getItem(k), key);
    assert.ok(saved);
    await p.keyboard.press('F8');
    await p.locator('.shade .modal', { hasText: '中断的' }).waitFor({ timeout: 4000 });
    await p.locator('.shade .btn', { hasText: '取消' }).click();
    assert.equal(await p.evaluate((k) => localStorage.getItem(k), key), saved);
    // The title's ordinary 继续记录 path must also protect a different battle written while its dialog is open.
    await p.getByRole('button', { name: '继续记录', exact: false }).click();
    await p.locator('.shade .modal', { hasText: '中断的' }).waitFor({ timeout: 4000 });
    const newer = await p.evaluate((k) => { const s = JSON.parse(localStorage.getItem(k)); s.savedAt++; localStorage.setItem(k, JSON.stringify(s)); return localStorage.getItem(k); }, key);
    await p.locator('.shade .btn.primary').click();
    await p.getByText(/中断战斗已改变/).first().waitFor({ timeout: 4000 });
    assert.ok(await p.evaluate(({ k, newer }) => localStorage.getItem(k) === newer, { k: key, newer }));
    await p.evaluate(({ k, saved }) => localStorage.setItem(k, saved), { k: key, saved });
    await p.keyboard.press('F8');
    await p.locator('.shade .modal', { hasText: '中断的' }).waitFor({ timeout: 4000 });
    const changed = await p.evaluate((k) => { const s = JSON.parse(localStorage.getItem(k)); s.savedAt++; localStorage.setItem(k, JSON.stringify(s)); return localStorage.getItem(k); }, key);
    await p.locator('.shade .btn.primary').click();
    await p.getByText('中断战斗已改变，请重新读档').waitFor({ timeout: 4000 });
    assert.ok(await p.evaluate(({ k, changed }) => localStorage.getItem(k) === changed, { k: key, changed }), 'a newly changed suspension is not discarded');
    await p.evaluate(({ k, saved }) => localStorage.setItem(k, saved), { k: key, saved });
    await p.evaluate(() => {
      const real = Storage.prototype.setItem;
      window.__quickRestoreStorage = () => { Storage.prototype.setItem = real; };
      Storage.prototype.setItem = function (key, value) { if (key === 'haou-hd2d-load') throw new Error('storage disabled'); return real.call(this, key, value); };
    });
    await p.keyboard.press('F8');
    await p.locator('.shade .btn.primary').click();
    await p.getByText('无法读取记录').waitFor({ timeout: 4000 });
    assert.equal(await p.evaluate((k) => localStorage.getItem(k), key), saved);
    await p.evaluate(() => window.__quickRestoreStorage());
    // A new suspension arriving after the confirmed load begins must survive the fade and restart too.
    await p.evaluate(({ k, saved }) => {
      const set = Storage.prototype.setItem, replacement = JSON.parse(saved); replacement.savedAt += 3;
      Storage.prototype.setItem = function (key, value) {
        if (this === sessionStorage && key === 'haou-hd2d-load') setTimeout(() => localStorage.setItem(k, JSON.stringify(replacement)), 50);
        return set.call(this, key, value);
      };
    }, { k: key, saved });
    await p.keyboard.press('F8');
    await Promise.all([p.waitForEvent('load', { timeout: 30000 }), p.locator('.shade .btn.primary').click()]);
    await p.waitForFunction(() => document.body.dataset.screen === 'strategy' && window.__game?.g, null, { timeout: 60000 });
    assert.equal(await p.evaluate((k) => JSON.parse(localStorage.getItem(k))?.savedAt, key), JSON.parse(saved).savedAt + 3);
    await p.waitForFunction(() => { const g = window.__game.g; return g.current === g.player && document.querySelector('.citypanel') && !document.querySelector('.banner, .panel.msg, .shade, #fade.on'); }, null, { timeout: 60000 });
    await p.keyboard.press('F8');
    await p.locator('.shade .modal', { hasText: '中断的' }).waitFor({ timeout: 4000 });
    await Promise.all([p.waitForEvent('load', { timeout: 30000 }), p.locator('.shade .btn.primary').click()]);
    await p.waitForFunction(() => document.body.dataset.screen === 'strategy' && window.__game?.g && !sessionStorage.getItem('haou-hd2d-load'), null, { timeout: 60000 });
    assert.equal(await p.evaluate((k) => localStorage.getItem(k), key), null, 'the specifically confirmed suspension is discarded after the snapshot is read');
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); }
});
