import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, newCampaign, cmd, closeMessages } from './game.mjs';

let game, page, home, executor;
before(async () => {
  game = await startGame({ scenario: 'original' }); page = await game.open('&flat'); await newCampaign(page, '刘备');
  [home, executor] = await page.evaluate(async () => {
    (await import('./src/vignette.js')).setVignettes(false);
    const { g } = window.__game, home = g.factions[g.player].city;
    return [home, g.cities[home].officers[0]];
  });
});
after(() => game?.close());

test('连续搜索逐次消耗命令书并合并结果', async () => {
  await page.evaluate(({ home }) => {
    const { g, G, debug } = window.__game; g.books = 5; g.cities[home].gold = 500;
    for (const key of Object.keys(G.data().search_outcomes)) G.data().search_outcomes[key] = Array(8).fill(8);
    debug.hud();
  }, { home });
  await cmd(page, '城', '搜索'); await page.locator(`.shade tr[data-id="${executor}"]`).click();
  await page.locator('.shade input.amount').fill('2'); await page.locator('.shade .btn.primary').click();
  const stop = closeMessages(page);
  try { await page.waitForFunction(() => window.__game.g.books === 3); await page.waitForFunction(() => !document.querySelector('.shade, .panel.msg')); }
  finally { stop(); }
  assert.deepEqual(page.errors, []);
});

test('连续搜索遇到求仕时提前停止并扣除已执行次数', async () => {
  await page.evaluate(({ home }) => {
    const { g, G, debug } = window.__game, data = G.data();
    g.books = 5; g.cities[home].gold = 500;
    const preferred = new Set(Object.values(data.rules.search_preference).flat());
    const officer = g.officers.find((o) => o.status === 1 && !preferred.has(o.id));
    officer.status = 0; officer.loc = home;
    let seed = 1, first, second;
    do { const r = G.rng({ seed }); first = r(8); second = r(8); if (first === second) seed++; } while (first === second);
    for (const key of Object.keys(data.search_outcomes)) { const row = Array(8).fill(8); row[second] = 6; data.search_outcomes[key] = row; }
    g.seed = seed; debug.hud();
  }, { home });
  await cmd(page, '城', '搜索'); await page.locator(`.shade tr[data-id="${executor}"]`).click();
  await page.locator('.shade input.amount').fill('4'); await page.locator('.shade .btn.primary').click();
  await page.waitForSelector('.panel.msg');
  assert.equal(await page.evaluate(() => window.__game.g.books), 3);
  const stop = closeMessages(page);
  try { await page.locator('.shade .btn', { hasText: '取消' }).click(); } finally { stop(); }
  await page.waitForFunction(() => !document.querySelector('.shade, .panel.msg'));
  assert.equal(await page.evaluate(() => window.__game.g.books), 3);
  assert.deepEqual(page.errors, []);
});

test('连续施舍受金米和命令书约束，每次独立扣费', async () => {
  await page.evaluate((id) => { const { g, debug } = window.__game; g.books = 5; Object.assign(g.cities[id], { gold: 200, rice: 0, gov: 10 }); debug.hud(); }, home);
  await cmd(page, '仓', '施舍'); await page.locator('.shade input.amount').first().fill('100');
  await page.locator('.shade .btn.primary').click();
  await page.locator('.shade input.amount').fill('2'); await page.locator('.shade .btn.primary').click();
  await page.waitForFunction(() => window.__game.g.books === 3);
  const result = await page.evaluate((id) => { const c = window.__game.g.cities[id]; return { gold: c.gold, rice: c.rice, gov: c.gov }; }, home);
  assert.equal(result.gold, 0); assert.equal(result.rice, 0); assert.ok(result.gov > 10); assert.deepEqual(page.errors, []);
});
