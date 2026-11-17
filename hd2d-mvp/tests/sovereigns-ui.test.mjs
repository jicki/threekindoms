import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startGame, skipIntro, closeMessages } from './game.mjs';

const token = `test-token-${'s'.repeat(40)}`;
const previous = { token: process.env.GAME_ADMIN_TOKEN, directory: process.env.GAME_VERSION_DIR };
let game, directory;
before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'threekindoms-sovereigns-test-'));
  process.env.GAME_ADMIN_TOKEN = token; process.env.GAME_VERSION_DIR = directory;
  game = await startGame();
});
after(async () => {
  await game?.close();
  if (previous.token === undefined) delete process.env.GAME_ADMIN_TOKEN; else process.env.GAME_ADMIN_TOKEN = previous.token;
  if (previous.directory === undefined) delete process.env.GAME_VERSION_DIR; else process.env.GAME_VERSION_DIR = previous.directory;
  if (directory) rmSync(directory, { recursive: true, force: true });
});

async function chooseRuler(page, name) {
  await page.evaluate(async () => { (await import('./src/pace.js')).setPace(4); (await import('./src/vignette.js')).setVignettes(false); });
  await skipIntro(page); await page.getByText('新的征程').click();
  await page.locator('.level', { hasText: 'LEVEL 1' }).click();
  const card = page.locator('.ruler', { hasText: name }); await card.click();
  return card;
}
async function waitPlayer(page) {
  await page.waitForFunction(() => document.body.dataset.screen === 'strategy', null, { timeout: 60000 });
  const stop = closeMessages(page, { aiTurns: true });
  try { await page.waitForFunction(() => { const g = window.__game.g; return g?.current === g.player && !document.querySelector('.aiturn,.panel.msg'); }, null, { timeout: 90000 }); }
  finally { stop(); }
}

test('标题可选择君主列传，技能说明与人物资料显示实际生效的被动', { timeout: 180000 }, async () => {
  const page = await game.open('&flat');
  try {
    await skipIntro(page); await page.locator('.sysmenu-btn').click();
    await page.locator('.sysmenu-list button', { hasText: '游戏版本' }).click();
    await page.getByRole('dialog', { name: '选择游戏版本' }).getByRole('button', { name: /群英新篇·君主列传/ }).click();
    await page.waitForFunction(() => window.__game?.G.currentScenario() === 'builtin-sovereigns');
    const card = await chooseRuler(page, '公孙瓒');
    assert.equal(await page.locator('.ruler').count(), 10);
    assert.match(await page.locator('.setup-passive').textContent(), /白马备战.*金＋11.*后备兵＋9/);
    await card.click(); await waitPlayer(page);
    const start = await page.evaluate(() => {
      const { g, G } = window.__game;
      return { owner: g.cities[0].faction, gold: g.cities[0].gold, reserve: g.cities[0].reserve, passive: G.rulerPassive(g, 7).name };
    });
    assert.deepEqual(start, { owner: 7, gold: 911, reserve: 109, passive: '白马备战' });
    await page.keyboard.press('r'); await page.locator('tr[data-id="246"]').click();
    assert.match(await page.locator('.ocard-info').textContent(), /君主被动：白马备战.*金＋11.*后备兵＋9/);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('手机横屏选择君主时能查看被动并进入游戏', { timeout: 180000 }, async () => {
  const page = await game.open('&flat&phone', { setup: (context) => context.addInitScript(() => sessionStorage.setItem('haou-hd2d-scenario', 'builtin-sovereigns')) });
  try {
    await page.setViewportSize({ width: 812, height: 375 });
    const card = await chooseRuler(page, '袁术');
    assert.match(await page.locator('.setup-passive').textContent(), /淮南筹资.*金＋11.*米＋5/);
    await card.click(); await waitPlayer(page);
    assert.equal(await page.evaluate(() => window.__game.G.rulerPassive(window.__game.g, 8).name), '淮南筹资');
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('手机横屏真实洪灾显示资源损失，并保留原规则事件提示', { timeout: 180000 }, async () => {
  const page = await game.open('&flat&phone', { setup: (context) => context.addInitScript(() => sessionStorage.setItem('haou-hd2d-scenario', 'builtin-sovereigns')) });
  try {
    await page.setViewportSize({ width: 812, height: 375 });
    const card = await chooseRuler(page, '公孙瓒'); await card.click(); await waitPlayer(page);
    const fire = (enhanced, defense, zero = false) => page.evaluate(({ enhanced, defense, zero }) => {
      const { g, G, io } = window.__game, city = g.cities[0];
      Object.assign(city, { disaster: defense, gold: 1000, rice: 1000, land: 1000, industry: 1000, pop: 1000 });
      if (zero) { Object.assign(city, { gold: 0, rice: 0, land: 0, industry: 0, pop: 0 }); for (const id of city.officers) g.officers[id].soldiers = 0; }
      g.enhancedDisasters = enhanced; g.seed = 7;
      const list = G.disaster(g, 'flood'); window.__disasterEvent = io.event({ type: 'disaster', kind: 'flood', list });
      return { entry: list.find(([id]) => id === 0), gold: city.gold, rice: city.rice, land: city.land, industry: city.industry, disaster: city.disaster };
    }, { enhanced, defense, zero });
    const show = async () => {
      const panel = page.locator('.panel.msg'); await panel.waitFor({ timeout: 30000 });
      await page.evaluate(() => { const m = document.querySelector('.panel.msg'); if (m.querySelector('.more')?.hidden) m.click(); });
      return panel;
    };
    const damaged = await fire(true, 0);
    assert.deepEqual([damaged.gold, damaged.rice, damaged.land, damaged.industry], [930, 430, 930, 680]);
    assert.deepEqual([damaged.entry[2].gold, damaged.entry[2].rice, damaged.entry[2].land, damaged.entry[2].industry], [70, 570, 70, 320]);
    let panel = await show(); assert.match(await panel.textContent(), /辽东.*金−70.*米−570.*土地−70.*产业−320/s);
    await panel.evaluate(async (el) => { for (const animation of el.getAnimations()) await animation.finished; });
    const checkLayout = async (width, height) => {
      await page.setViewportSize({ width, height });
      const box = await panel.boundingBox(); assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height, `灾害信息须完整显示：${JSON.stringify(box)}`);
      const details = await panel.evaluate((el) => {
        const p = el.querySelector('p'), range = document.createRange(); range.selectNodeContents(p.lastChild);
        const lines = [...range.getClientRects()], last = lines.at(-1), more = el.querySelector('.more').getBoundingClientRect();
        return { last: { right: last.right, bottom: last.bottom }, more: { left: more.left, top: more.top } };
      });
      assert.ok(details.last.right <= details.more.left || details.last.bottom <= details.more.top, `损失文字与继续提示不能重叠：${JSON.stringify(details)}`);
    };
    await checkLayout(812, 375); await checkLayout(568, 320);
    await panel.click(); await page.evaluate(() => window.__disasterEvent);
    const legacy = await fire(false, 99); assert.equal(legacy.entry[1], 0);
    assert.deepEqual([legacy.gold, legacy.rice, legacy.land, legacy.industry], [1000, 1000, 1000, 1000]);
    assert.ok(legacy.disaster < 99);
    panel = await show(); assert.match(await panel.textContent(), /辽东遭受洪水/);
    await panel.click(); await page.evaluate(() => window.__disasterEvent);
    const empty = await fire(true, 0, true); assert.ok(Object.values(empty.entry[2]).every((value) => value === 0));
    panel = await show(); assert.match(await panel.textContent(), /辽东遭受洪水，没有造成损失/);
    assert.doesNotMatch(await panel.textContent(), /防灾完备/);
    await panel.click(); await page.evaluate(() => window.__disasterEvent);
    await page.evaluate(() => {
      const { g, G, io } = window.__game, ids = G.data().rules.flood_cities;
      for (const id of ids) g.cities[id].faction = g.player;
      const losses = { gold: 699, rice: 5700, land: 699, industry: 319, pop: 2500, soldiers: 0, disaster: 15 };
      window.__disasterEvent = io.event({ type: 'disaster', kind: 'flood', list: ids.map((id) => [id, 0, losses]) });
    });
    panel = await show(); await panel.evaluate(async (el) => { for (const animation of el.getAnimations()) await animation.finished; });
    assert.match(await panel.textContent(), /辽东.*涪陵.*合计/s); await checkLayout(568, 320);
    await panel.click(); await page.evaluate(() => window.__disasterEvent);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('编辑器可启用或关闭君主被动，发布后玩家按所选设置运行', { timeout: 180000 }, async () => {
  const admin = await game.open();
  try {
    await admin.goto(new URL('admin.html?mute', game.url).href); await admin.waitForFunction(() => window.__admin);
    await admin.locator('#published').selectOption('builtin-sovereigns');
    await admin.getByRole('button', { name: '载入为新草稿' }).click(); await admin.getByText('已载入新草稿').waitFor();
    await admin.getByLabel('版本名称').fill('君主被动发布验证');
    const content = admin.locator('#content');
    await content.getByLabel('搜索武将').fill('田豫'); await content.getByRole('button', { name: /No\.254\s+田豫/ }).click();
    assert.equal(await content.getByRole('checkbox', { name: '北疆守御' }).isChecked(), true);
    await content.getByLabel('搜索武将').fill('黄夫人'); await content.getByRole('button', { name: /No\.260\s+黄夫人/ }).click();
    assert.equal(await content.getByRole('checkbox', { name: '黄氏巧思' }).isChecked(), true);
    await content.getByAltText('立绘素材预览').evaluate((img) => img.decode());
    await content.getByLabel('搜索武将').fill('祝融夫人'); await content.getByRole('button', { name: /No\.261\s+祝融夫人/ }).click();
    assert.equal(await content.getByLabel('专属单挑技').inputValue(), 'zhurong');
    await content.getByAltText('立绘素材预览').evaluate((img) => img.decode());
    await content.getByAltText('动作素材预览').evaluate((img) => img.decode());
    await admin.getByRole('tab', { name: '新技能' }).click();
    await content.getByRole('button', { name: '北疆守御', exact: true }).click();
    assert.equal(await content.getByLabel('技能演出').inputValue(), 'tianyu');
    await content.getByLabel('技能演出').selectOption('qianzhao');
    await content.getByRole('button', { name: '应用修改' }).click();
    assert.equal(await admin.evaluate(() => window.__admin.draft.skills.find((s) => s.name === '北疆守御').visualEffect), 'qianzhao');
    await content.getByLabel('技能演出').selectOption('tianyu');
    await content.getByRole('button', { name: '应用修改' }).click();
    await admin.getByRole('tab', { name: '君主候选' }).click();
    const toggle = content.getByLabel('启用君主被动技能'); assert.equal(await toggle.isChecked(), true);
    await toggle.uncheck(); assert.equal(await admin.evaluate(() => window.__admin.draft.rulerPassives), undefined);
    await content.getByLabel('启用君主被动技能').check(); assert.equal(await admin.evaluate(() => window.__admin.draft.rulerPassives), true);
    assert.equal(await content.getByLabel('修正电脑补兵').isChecked(), true);
    await content.getByLabel('修正电脑补兵').uncheck(); assert.equal(await admin.evaluate(() => window.__admin.draft.fixedAiRecruitment), undefined);
    await content.getByLabel('修正电脑补兵').check(); assert.equal(await admin.evaluate(() => window.__admin.draft.fixedAiRecruitment), true);
    assert.equal(await content.getByLabel('增强灾害影响').isChecked(), true);
    await content.getByLabel('增强灾害影响').uncheck(); assert.equal(await admin.evaluate(() => window.__admin.draft.enhancedDisasters), undefined);
    await content.getByLabel('增强灾害影响').check(); assert.equal(await admin.evaluate(() => window.__admin.draft.enhancedDisasters), true);
    await content.getByLabel('公孙瓒开局金币').fill('800');
    await content.getByLabel('公孙瓒开局金币').locator('xpath=ancestor::form').getByRole('button', { name: '应用开局资源' }).click();
    assert.equal(await admin.evaluate(() => window.__admin.draft.factions[0].opening.gold), 800);
    await admin.getByLabel('管理员令牌').fill(token); await admin.getByRole('button', { name: '发布新版本' }).click();
    await admin.getByText(/已发布“君主被动发布验证”/).waitFor();
    const id = await admin.evaluate(() => window.__admin.lastPublished);
    const player = await game.open('&flat', { setup: (context) => context.addInitScript((version) => sessionStorage.setItem('haou-hd2d-scenario', version), id) });
    try {
      const result = await player.evaluate(() => {
        const { G } = window.__game, g = G.newGame(7, 1, 2);
        return [G.data().rulerPassives, G.data().officers[254].name, G.rulerPassive(g, 7).name, G.data().fixedAiRecruitment, g.cities[0].gold, g.enhancedDisasters];
      });
      assert.deepEqual(result, [true, '田豫', '白马备战', true, 800, true]); assert.deepEqual(player.errors, []);
    } finally { await player.context().close(); }
    assert.deepEqual(admin.errors, []);
  } finally { await admin.context().close(); }
});
