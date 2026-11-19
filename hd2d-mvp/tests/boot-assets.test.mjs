import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startGame } from './game.mjs';
import { launchChrome } from '../tools/headless.mjs';

let game;
before(async () => { game = await startGame({ scenario: 'original' }); });
after(() => game?.close());

test('素材清单读取失败、标题图检查卡住时仍可进入标题', { timeout: 25000 }, async () => {
  let release, stalled, page;
  const held = new Promise((resolve) => { release = resolve; });
  try {
    page = await game.open('', { setup: async (ctx) => {
      await ctx.route('**/assets/manifest.json', (route) => route.abort());
      await ctx.route('**/assets/ai/title.webp', async (route) => {
        if (route.request().method() !== 'HEAD') return route.continue();
        stalled = true;
        await held;
        await route.abort().catch(() => {});
      });
    } });
    await page.locator('.tt').waitFor();
    assert.equal(stalled, true);
    assert.deepEqual(page.errors, []);
  } finally { release(); await page?.context().close(); }
});

test('关楼模型请求卡住时使用原有的备用建筑，仍可进入 3D 游戏', { timeout: 25000 }, async () => {
  let release, requested = false, page;
  const held = new Promise((resolve) => { release = resolve; });
  try {
    page = await game.open('', { setup: async (ctx) => {
      await ctx.addInitScript(() => {
        const fetchResource = window.fetch;
        window.fetch = (url, options) => {
          if (String(url).endsWith('/models/pass.glb')) options?.signal?.addEventListener('abort', () => { window.__passRequestAborted = true; });
          return fetchResource(url, options);
        };
      });
      await ctx.route('**/assets/ai/sandtable/board/models/pass.glb', async (route) => {
        requested = true;
        await held;
        await route.abort().catch(() => {});
      });
    } });
    assert.equal(requested, true);
    assert.equal(await page.evaluate(() => window.__passRequestAborted), true);
    assert.equal(await page.evaluate(() => window.__game.strategy.kind), '3d');
    assert.deepEqual(page.errors, []);
  } finally { release(); await page?.context().close(); }
});

test('必要数据失败会指出请求，重新加载后保留所选版本', { timeout: 25000 }, async () => {
  const browser = await launchChrome(game.url);
  try {
    const ctx = await browser.newContext(), page = await ctx.newPage();
    const id = 'builtin-sovereigns-expanded-map';
    await ctx.addInitScript((scenario) => {
      if (!sessionStorage.getItem('haou-hd2d-scenario')) sessionStorage.setItem('haou-hd2d-scenario', scenario);
    }, id);
    await ctx.route('**/data/game-data.json', (route) => route.fulfill({ status: 503 }), { times: 1 });
    await page.goto(game.url);
    const failure = page.getByRole('alert').filter({ hasText: '游戏版本无法读取' });
    await failure.waitFor();
    assert.match(await failure.textContent(), /data\/game-data\.json.+HTTP 503/);
    await failure.getByRole('button', { name: '重新加载' }).click();
    await page.waitForFunction((scenario) => window.__game?.G.currentScenario() === scenario, id);
    await page.locator('.tt').waitFor();
  } finally { await browser.close(); }
});
