import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startGame } from './game.mjs';

const token = `test-token-${'v'.repeat(40)}`, previous = { token: process.env.GAME_ADMIN_TOKEN, dir: process.env.GAME_VERSION_DIR };
let game, directory;
before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'threekindoms-campaign-editor-'));
  process.env.GAME_ADMIN_TOKEN = token; process.env.GAME_VERSION_DIR = directory;
  game = await startGame();
});
after(async () => {
  await game?.close();
  if (previous.token === undefined) delete process.env.GAME_ADMIN_TOKEN; else process.env.GAME_ADMIN_TOKEN = previous.token;
  if (previous.dir === undefined) delete process.env.GAME_VERSION_DIR; else process.env.GAME_VERSION_DIR = previous.dir;
  if (directory) rmSync(directory, { recursive: true, force: true });
});

test('编辑器的新版地图、条件技能和关系可发布，玩家加载后实际生效', { timeout: 180000 }, async () => {
  const admin = await game.open();
  try {
    await admin.goto(new URL('admin.html?mute', game.url).href); await admin.waitForFunction(() => window.__admin);
    await admin.locator('#published').selectOption('builtin-sovereigns');
    await admin.getByRole('button', { name: '载入为新草稿' }).click(); await admin.getByText('已载入新草稿').waitFor();
    await admin.getByLabel('版本名称').fill('扩展地图和技能验证');
    await admin.getByRole('tab', { name: '君主候选' }).click();
    const content = admin.locator('#content');
    assert.equal(await content.getByLabel('地图').inputValue(), 'expanded');
    assert.equal(await content.getByLabel('启用新版玩法').isChecked(), true);
    await admin.getByRole('tab', { name: '新技能' }).click();
    await content.getByRole('button', { name: '北疆守御' }).click();
    assert.equal(await content.getByLabel('新版条件效果').inputValue(), 'frontier');
    await content.getByLabel('新版条件效果').selectOption('fortress');
    await content.getByRole('button', { name: '应用修改' }).click();
    await admin.getByRole('tab', { name: '人物关系' }).click();
    assert.ok(await content.getByText(/刘备 · 结义 · 关羽（新版玩法）/).count());
    await admin.getByLabel('管理员令牌').fill(token); await admin.getByRole('button', { name: '发布新版本' }).click();
    await admin.getByText(/已发布“扩展地图和技能验证”/).waitFor();
    const id = await admin.evaluate(() => window.__admin.lastPublished);
    const player = await game.open('', { setup: (ctx) => ctx.addInitScript((value) => sessionStorage.setItem('haou-hd2d-scenario', value), id) });
    try {
      const loaded = await player.evaluate(() => {
        const { G } = window.__game, data = G.data(), g = G.newGame(7, 1, 10);
        return { cities: data.cities.length, passes: data.cities.filter((c) => c.kind === 'pass').length,
          campaign: g.campaignRules, effect: data.customSkills.find((s) => s.name === '北疆守御').effectProfile,
          relations: data.campaignRelationships.length, ruler: G.rulerPassive(g, 7).combat.unique };
      });
      assert.deepEqual(loaded, { cities: 37, passes: 4, campaign: true, effect: 'fortress', relations: 6, ruler: 'horsebow' });
      assert.deepEqual(player.errors, []);
    } finally { await player.context().close(); }
    assert.deepEqual(admin.errors, []);
  } finally { await admin.context().close(); }
});
