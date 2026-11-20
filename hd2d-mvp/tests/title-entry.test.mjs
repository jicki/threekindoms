import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, skipIntro } from './game.mjs';

let game;
before(async () => { game = await startGame({ scenario: 'original' }); });
after(() => game?.close());

async function seed(page, { auto = false, quick = false, held = false } = {}) {
  const records = await page.evaluate(async ({ auto, quick, held }) => {
    const { G } = window.__game;
    const g = G.newGame(4, 1, 7);
    g.current = g.player;
    g.turnIdx = G.data().rules.turn_orders[g.order].indexOf(g.player);
    g.books = G.books(g, g.player);
    if (!(quick ? G.saveQuick(g) : G.save(g, 1))) throw new Error('记录夹具写入失败');
    if (auto) {
      await new Promise(resolve => setTimeout(resolve, 30));
      if (!G.saveAuto({ ...g, year: 192 })) throw new Error('自动续玩夹具写入失败');
    }
    if (held) {
      const { Field } = await import('./src/core/field.js'), { suspend } = await import('./src/core/suspend.js');
      const from = g.factions[g.player].city, to = G.roads(from).find(id => g.cities[id].faction !== G.NONE);
      const warGame = structuredClone(g);
      const w = window.__game.debug.setupWar(warGame, {
        from, to, ids: [g.cities[from].officers[0]], commander: g.cities[from].officers[0], gold: 100, rice: 500,
      });
      const f = new Field(warGame, w, 'att');
      if (!suspend(warGame, w, f, { side: 'att', after: { kind: 'att', faction: g.player, pts: 0 }, start: {} })) throw new Error('中断夹具写入失败');
    }
    sessionStorage.setItem('hd2d-title-seen', '1');
    return [localStorage.getItem('haou-hd2d-save:1'), localStorage.getItem('haou-hd2d-suspend')];
  }, { auto, quick, held });
  await page.reload({ waitUntil: 'commit' });
  await page.waitForFunction(() => window.__game?.debug, null, { timeout: 60000 });
  await skipIntro(page);
  return records;
}

test('快速双击继续记录只开始一个回合', { timeout: 90000 }, async () => {
  const page = await game.open('&flat');
  try {
    await seed(page);
    await page.evaluate(() => {
      window.__turnBanners = [];
      new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) {
          if (node.nodeType === 1 && node.classList.contains('banner') && node.textContent.includes('的回合')) window.__turnBanners.push(node.textContent);
        }
      }).observe(document.body, { childList: true, subtree: true });
    });
    await page.getByRole('button', { name: /^继续记录/ }).dblclick({ delay: 35 });
    await page.waitForFunction(() => window.__turnBanners.length);
    await page.waitForFunction(() => !document.querySelector('.banner, #fade.on'));
    assert.equal(await page.evaluate(() => window.__turnBanners.length), 1);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('标题读档初始化失败可重试，原档和已确认放弃的中断仍完整', { timeout: 90000 }, async () => {
  const page = await game.open('&flat');
  try {
    const records = await seed(page, { held: true });
    assert.ok(records.every(Boolean));
    await page.getByRole('button', { name: /继续战斗/ }).waitFor();
    await page.evaluate(() => {
      const strategy = window.__game.strategy, refresh = strategy.refresh;
      strategy.refresh = (...args) => {
        if (document.body.dataset.screen === 'strategy') { strategy.refresh = refresh; throw new Error('测试：地图初始化失败'); }
        return refresh(...args);
      };
    });
    const resume = page.getByRole('button', { name: /^继续记录/ });
    const confirm = async () => page.getByRole('dialog', { name: '放弃中断的战斗' }).getByRole('button', { name: '确定' }).click();
    await resume.click(); await confirm();
    await page.getByText(/读取失败.*可重试.*中断战斗仍保留/).waitFor();
    assert.equal(await page.locator('#fade.on').count(), 0);
    assert.deepEqual(await page.evaluate(() => [localStorage.getItem('haou-hd2d-save:1'), localStorage.getItem('haou-hd2d-suspend')]), records);
    await resume.click(); await confirm();
    await page.waitForFunction(() => document.body.dataset.screen === 'strategy' && !document.querySelector('#fade.on'));
    assert.equal(await page.evaluate(() => localStorage.getItem('haou-hd2d-suspend')), null);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

for (const quick of [false, true]) test(`手机可单独从标题选择${quick ? '快捷档' : '普通档'}，即使有更新的自动续玩`, { timeout: 90000 }, async () => {
  const page = await game.open('&phone&flat');
  try {
    await page.setViewportSize({ width: 844, height: 390 });
    await seed(page, { auto: true, quick });
    assert.ok(await page.getByRole('button', { name: /^继续上次/ }).isVisible());
    await page.getByRole('button', { name: '读取记录', exact: true }).click();
    await page.getByRole('dialog', { name: '读取记录' }).getByRole('button', { name: quick ? /^快捷存档/ : /^记录一/ }).click();
    await page.waitForFunction(() => document.body.dataset.screen === 'strategy' && !document.querySelector('#fade.on'));
    assert.equal(await page.evaluate(() => window.__game.g.year), 189);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('从根地址进入时保留声音偏好，显式静音仅用于当前页面', { timeout: 90000 }, async () => {
  const page = await game.open('&flat');
  try {
    const root = new URL('/', game.url).href;
    await page.evaluate(() => localStorage.setItem('hd2d-muted', 'false'));
    const navigate = async (path) => {
      await page.goto(path, { waitUntil: 'commit' });
      await page.waitForFunction(() => window.__game?.audio, null, { timeout: 60000 });
      return page.evaluate(() => [location.search, window.__game.audio.muted, localStorage.getItem('hd2d-muted')]);
    };
    assert.deepEqual(await navigate(root + '?flat'), ['?flat', false, 'false']);
    assert.deepEqual(await navigate(root + '?flat&mute'), ['?flat&mute', true, 'false']);
    assert.deepEqual(await navigate(root), ['', false, 'false']);
  } finally { await page.context().close(); }
});
