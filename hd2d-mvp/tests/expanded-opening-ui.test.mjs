import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, skipIntro, closeMessages } from './game.mjs';

let game;
before(async () => { game = await startGame({ width: 812, height: 375 }); });
after(async () => { await game?.close(); });

const expanded = (ctx) => ctx.addInitScript(() => {
  sessionStorage.setItem('haou-hd2d-scenario', 'builtin-sovereigns-expanded-map');
});

test('玩家从扩展地图实际开局后获得袁术补给与保护标记', async () => {
  const page = await game.open('&flat&phone', { setup: expanded });
  try {
    await skipIntro(page); await page.getByText('新的征程').click();
    await page.locator('.level', { hasText: 'LEVEL 2' }).click();
    const ruler = page.locator('.ruler', { hasText: '袁术' }); await ruler.click(); await ruler.click();
    await page.waitForFunction(() => document.body.dataset.screen === 'strategy');
    const stop = closeMessages(page, { aiTurns: true });
    try {
      await page.waitForFunction(() => window.__game.g?.current === window.__game.g.player && !document.querySelector('.aiturn, .panel.msg'), null, { timeout: 90000 });
    } finally { stop(); }
    const state = await page.evaluate(() => {
      const { g } = window.__game, c = g.cities[13];
      return { player: g.player, guard: g.expandedOpeningGuard, owner: c.faction, gold: c.gold, rice: c.rice, reserve: c.reserve, gov: c.gov };
    });
    assert.equal(state.player, 8); assert.equal(state.owner, 8); assert.equal(state.guard, true);
    assert.ok(state.gold >= 600 && state.rice >= 750 && state.reserve >= 250 && state.gov >= 50);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('标题继续旧扩展存档时不补发资源或启用开局保护', async () => {
  const page = await game.open('&flat&phone', { setup: expanded });
  try {
    await page.evaluate(() => {
      const { G } = window.__game, g = G.newGame(8, 1, 12);
      delete g.expandedOpeningGuard;
      Object.assign(g.cities[13], { gold: 301, rice: 302, reserve: 103, gov: 44 });
      g.current = g.player; g.turnIdx = G.data().rules.turn_orders[g.order].indexOf(g.player); g.books = G.books(g, g.player);
      g.rulerPassiveTurn = `${g.year}:${g.month}:${g.player}`;
      G.save(g, 1); sessionStorage.setItem('hd2d-title-seen', '1');
    });
    await page.reload(); await skipIntro(page); await page.getByText('继续记录').click();
    await page.waitForFunction(() => document.body.dataset.screen === 'strategy' && window.__game.g?.current === window.__game.g.player);
    const state = await page.evaluate(() => {
      const { g } = window.__game, c = g.cities[13];
      return { guard: g.expandedOpeningGuard, gold: c.gold, rice: c.rice, reserve: c.reserve, gov: c.gov };
    });
    assert.deepEqual(state, { guard: undefined, gold: 301, rice: 302, reserve: 103, gov: 44 });
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});
