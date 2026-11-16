import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startGame, newCampaign, skipIntro, closeMessages, castGo } from './game.mjs';

const token = `test-token-${'x'.repeat(40)}`;
const previous = { token: process.env.GAME_ADMIN_TOKEN, directory: process.env.GAME_VERSION_DIR };
let game, directory;
before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'threekindoms-admin-test-'));
  process.env.GAME_ADMIN_TOKEN = token; process.env.GAME_VERSION_DIR = directory;
  game = await startGame();
});
after(async () => {
  await game?.close();
  if (previous.token === undefined) delete process.env.GAME_ADMIN_TOKEN; else process.env.GAME_ADMIN_TOKEN = previous.token;
  if (previous.directory === undefined) delete process.env.GAME_VERSION_DIR; else process.env.GAME_VERSION_DIR = previous.directory;
  if (directory) rmSync(directory, { recursive: true, force: true });
});

test('an administrator publishes a playable version for another browser context', async () => {
  const admin = await game.open();
  try {
    await admin.goto(new URL('admin.html?mute', game.url).href);
    await admin.waitForFunction(() => window.__admin);
    const content = admin.locator('#content');
    await admin.getByLabel('版本名称').fill('群雄新篇');

    await admin.getByRole('tab', { name: '新技能' }).click();
    await admin.getByRole('button', { name: /新建技能/ }).click();
    await content.getByLabel('名称', { exact: true }).fill('雷霆战法');
    await content.getByLabel('损兵').fill('80'); await content.getByLabel('体力伤害').fill('7');
    await content.getByLabel('限制移动天数').fill('2'); await content.getByLabel('粮草损失').fill('30');
    await content.getByRole('button', { name: '应用修改' }).click();
    await admin.getByText('技能修改已应用到草稿').waitFor();

    await admin.getByRole('tab', { name: '新武器' }).click();
    await admin.getByRole('button', { name: /新建武器/ }).click();
    await content.getByLabel('名称', { exact: true }).fill('玄铁新刀');
    await content.getByLabel('类型').selectOption('刀'); await content.getByLabel('攻击').fill('45');
    await content.getByRole('checkbox', { name: '并州' }).check();
    await content.getByRole('button', { name: '应用修改' }).click();
    await admin.getByText('武器修改已应用到草稿').waitFor();

    await admin.getByRole('tab', { name: '人物与登场' }).click();
    await admin.getByRole('button', { name: /新建武将/ }).click();
    await content.getByLabel('姓名').fill('自定义武将');
    await content.getByLabel('人物图像').selectOption('38');
    await content.getByLabel('出生年份').fill('170'); await content.getByLabel('出生地').selectOption('2'); await content.getByLabel('武力').fill('91');
    await content.getByLabel('登场方式').selectOption('initial'); await content.getByLabel('登场城市').selectOption('2');
    await content.getByLabel('武器', { exact: true }).selectOption('32');
    await content.getByRole('checkbox', { name: '雷霆战法' }).check();
    await content.getByRole('button', { name: '应用修改' }).click();
    await admin.getByText('人物修改已应用到草稿').waitFor();

    await admin.getByRole('tab', { name: '人物关系' }).click();
    await content.getByLabel('人物', { exact: true }).selectOption('237');
    await content.getByLabel('相关人物').selectOption('222'); await content.getByLabel('关系', { exact: true }).selectOption('朋友');
    await content.getByRole('button', { name: '添加关系' }).click();
    await admin.getByText('人物关系已添加到草稿').waitFor();

    let releasePost, startedPost;
    const held = new Promise((resolve) => { releasePost = resolve; });
    const started = new Promise((resolve) => { startedPost = resolve; });
    await admin.route('**/api/versions', async (route) => {
      if (route.request().method() === 'POST') { startedPost(); await held; }
      await route.continue();
    });
    await admin.getByLabel('管理员令牌').fill('wrong'); await admin.getByRole('button', { name: '发布新版本' }).click();
    let timer;
    try {
      await Promise.race([started, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('publish request did not start')), 5000); })]);
      assert.equal(await admin.getByLabel('版本名称').isDisabled(), true, 'publishing cannot discard concurrent edits');
    } finally { clearTimeout(timer); releasePost(); }
    await admin.getByText('管理员令牌无效').waitFor();
    await admin.unroute('**/api/versions');
    const retryId = await admin.evaluate(() => window.__admin.draft.id);
    await admin.getByLabel('管理员令牌').fill(token); await admin.getByRole('button', { name: '发布新版本' }).click();
    await admin.getByText(/已发布“群雄新篇”/).waitFor({ timeout: 10000 });
    const id = await admin.evaluate(() => window.__admin.lastPublished);
    assert.match(id, /^v-[a-f0-9]{32}$/);
    assert.equal(id, retryId, 'a failed request keeps the version id for a safe retry');
    assert.equal(await admin.getByLabel('管理员令牌').inputValue(), '');
    const response = await admin.request.get(new URL(`/api/versions/${id}`, game.url).href);
    assert.equal(response.status(), 200);
    const published = await response.json();
    assert.equal(published.officers.find((o) => o.id === 237).birthYear, 170);
    assert.equal(published.officers.find((o) => o.id === 237).birthCity, 2);
    assert.equal(published.officers.find((o) => o.id === 237).portraitId, 38);
    assert.equal(published.weapons[0].name, '玄铁新刀'); assert.equal(published.skills[0].name, '雷霆战法');

    await admin.getByRole('button', { name: '载入为新草稿' }).click();
    await admin.getByText('已载入新草稿').waitFor();
    await admin.getByRole('tab', { name: '人物与登场' }).click();
    await content.getByLabel('搜索武将').fill('自定义武将');
    await content.getByRole('button', { name: /No\.237/ }).click();
    await content.getByLabel('姓名').fill('自定义武将二');
    await content.getByRole('button', { name: '应用修改' }).click();
    await admin.getByLabel('版本名称').fill('群雄修订'); await admin.getByLabel('管理员令牌').fill(token);
    await admin.getByRole('button', { name: '发布新版本' }).click();
    await admin.getByText(/已发布“群雄修订”/).waitFor({ timeout: 10000 });
    const revision = await admin.evaluate(() => window.__admin.lastPublished);
    assert.notEqual(revision, id);
    const original = await (await admin.request.get(new URL(`/api/versions/${id}`, game.url).href)).json();
    assert.equal(original.officers.find((o) => o.id === 237).name, '自定义武将');
    const [download] = await Promise.all([admin.waitForEvent('download'), admin.getByRole('button', { name: '导出草稿' }).click()]);
    const exported = readFileSync(await download.path());
    assert.equal(JSON.parse(exported).id, revision);
    const importer = await admin.context().newPage();
    try {
      await importer.goto(new URL('admin.html?mute', game.url).href); await importer.waitForFunction(() => window.__admin);
      await importer.locator('#file').setInputFiles({ name: 'version.json', mimeType: 'application/json', buffer: exported });
      await importer.getByText(/版本已导入/).waitFor();
      await importer.getByLabel('管理员令牌').fill(token); await importer.getByRole('button', { name: '发布新版本' }).click();
      await importer.getByText(/已发布“群雄修订”/).waitFor({ timeout: 10000 });
      assert.equal(await importer.evaluate(() => window.__admin.lastPublished), revision);
      const versions = await (await importer.request.get(new URL('/api/versions', game.url).href)).json();
      assert.equal(versions.length, 2, 'restoring the same version is idempotent');
    } finally { await importer.close(); }

    const player = await game.open();
    try {
      await skipIntro(player); await player.click('.sysmenu-btn');
      await player.locator('.sysmenu-list button', { hasText: '游戏版本' }).click();
      await player.locator('.shade .slot', { hasText: '群雄新篇' }).click();
      await player.waitForFunction((expected) => window.__game?.debug && window.__game.G.currentScenario() === expected, id, { timeout: 60000 });
      await newCampaign(player, '刘备');
      await player.waitForFunction(() => document.querySelector('.citypanel') && !document.querySelector('.banner, .panel.msg, .shade, #fade.on, .vig'), null, { timeout: 30000 });
      const loaded = await player.evaluate(() => {
        const { G, g } = window.__game, officer = g.officers[237], d = G.data();
        return { name: d.officers[237].name, birth: d.officers[237].birthYear, birthCity: d.officers[237].birthCity, war: officer.war, weapon: officer.weapon,
          city: g.cities[2].officers.includes(237), skills: d.officers[237].skills, relation: d.relationships[0] };
      });
      assert.deepEqual(loaded, { name: '自定义武将', birth: 170, birthCity: 2, war: 91, weapon: 32, city: true, skills: [16],
        relation: { from: 237, to: 222, kind: '朋友' } });
      await player.click('.wikibtn'); await player.getByLabel('查找武将').fill('自定义武将');
      await player.locator('.wikitable tr[data-id="237"]').click();
      await player.getByText(/170年出生/).waitFor(); await player.getByText(/出生于并州/).waitFor(); await player.getByText(/朋友 刘备/).waitFor();
      assert.match(await player.locator('.ocard > img[alt="自定义武将"]').getAttribute('src'), /\/portraits\/38\.webp$/);
      await player.keyboard.press('Escape'); await player.keyboard.press('Escape');
      await player.waitForFunction(() => !document.querySelector('.shade, .panel.msg, .banner, #fade.on'));
      await player.evaluate(() => {
        const { g, G, debug } = window.__game, home = g.factions[g.player].city;
        const target = G.roads(home).map((id) => g.cities[id]).find((c) => c.faction !== g.player && c.faction !== G.NONE && c.officers.length);
        if (!target) throw new Error('没有可用于测试的邻接敌城');
        for (const id of [...g.cities[home].officers, ...target.officers]) g.officers[id].soldiers = 500;
        const commander = g.factions[g.player].ruler;
        debug.fieldWar(debug.setupWar(g, { from: home, to: target.id, ids: [commander, 237], commander, gold: 100, rice: 9000 }), 'att');
      });
      await player.waitForFunction(() => window.__game.war?.finishDeploy && document.body.dataset.screen === 'war', null, { timeout: 30000 });
      const stopMessages = closeMessages(player);
      try {
        await player.waitForTimeout(2500); await player.evaluate(() => window.__game.war.finishDeploy());
        await player.waitForFunction(() => { const f = window.__game.war.field; return f.turn === f.human && !document.querySelector('.banner, .panel.msg'); }, null, { timeout: 30000 });
        const target = await player.evaluate(async () => {
          const { war: w } = window.__game, f = w.field, me = f.alive.find((u) => u.id === 237), enemy = f.alive.find((u) => u.side !== f.human);
          let cell = null;
          for (let dy = -3; dy <= 3 && !cell; dy++) for (let dx = -3; dx <= 3 && !cell; dx++) {
            const x = me.x + dx, y = me.y + dy;
            if ((dx || dy) && f.inside(x, y) && !f.unitAt(x, y)) cell = [x, y];
          }
          if (!cell) throw new Error('没有可用的技能目标格');
          [enemy.x, enemy.y] = cell; f.O(enemy.id).soldiers = 500; f.O(enemy.id).hp = 80; f.war[enemy.side].rice = 500;
          f.r = () => 0; f.pool[f.human] = 99; (await import('./src/pace.js')).setPace(4); w.clickCell(me.x, me.y);
          return enemy.id;
        });
        await player.locator('.unitpanel:not(.compare) .acts button', { hasText: '计略' }).click();
        await player.locator('.actpanel [data-sid="16"]').click();
        await player.locator(`.actpanel [data-target="${target}"]`).click(); await castGo(player);
        await player.waitForFunction((id) => window.__game.war.field.O(id).soldiers === 420, target, { timeout: 30000 });
        await player.waitForFunction(() => !window.__game.war.st.busy, null, { timeout: 30000 });
        const result = await player.evaluate((id) => {
          const f = window.__game.war.field, e = f.alive.find((u) => u.id === id);
          return { hp: f.O(id).hp, stop: e.stop, rice: f.war[e.side].rice };
        }, target);
        assert.deepEqual(result, { hp: 73, stop: 2, rice: 470 });
      } finally { stopMessages(); }
      assert.deepEqual(player.errors, []);
    } finally { await player.context().close(); }
    assert.deepEqual(admin.errors, []);
  } finally { await admin.context().close(); }
});

test('a missing server version offers recovery without erasing original saves', async () => {
  const page = await game.open(), missing = `v-${'f'.repeat(32)}`;
  try {
    await page.evaluate((id) => {
      localStorage.setItem('haou-hd2d-save:1', '原版记录保留');
      sessionStorage.setItem('haou-hd2d-scenario', id);
    }, missing);
    await page.reload(); await page.getByText('游戏版本无法读取').waitFor();
    await page.getByRole('button', { name: '切换到原版' }).click();
    await page.waitForFunction(() => window.__game?.debug && window.__game.G.currentScenario() === 'original');
    assert.equal(await page.evaluate(() => localStorage.getItem('haou-hd2d-save:1')), '原版记录保留');
    await page.evaluate((id) => sessionStorage.setItem('haou-hd2d-scenario', id), missing);
    await page.goto(new URL('save-editor.html?mute', game.url).href);
    await page.getByText('游戏版本无法读取').waitFor();
    await page.getByRole('button', { name: '切换到原版' }).click();
    await page.waitForFunction(() => window.__editor);
    assert.equal(await page.evaluate(() => localStorage.getItem('haou-hd2d-save:1')), '原版记录保留');
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('version management can be opened from the title and returns to the game', async () => {
  const page = await game.open();
  try {
    await skipIntro(page); await page.click('.sysmenu-btn');
    await page.locator('.sysmenu-list button', { hasText: '版本管理' }).click();
    await page.waitForFunction(() => window.__admin && location.pathname.endsWith('/admin.html'));
    await page.getByRole('button', { name: '返回游戏' }).click();
    await page.waitForFunction(() => window.__game?.debug && document.body.dataset.screen === 'title');
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('moving the only starting officer makes that city neutral in the published game', async () => {
  const admin = await game.open();
  try {
    await admin.goto(new URL('admin.html?mute', game.url).href); await admin.waitForFunction(() => window.__admin);
    await admin.getByLabel('搜索武将').fill('158');
    await admin.getByRole('button', { name: /No\.158/ }).click();
    await admin.getByLabel('登场方式').selectOption('search_city');
    await admin.getByRole('button', { name: '应用修改' }).click();
    await admin.getByText('人物修改已应用到草稿').waitFor();
    await admin.getByLabel('版本名称').fill('空城验证'); await admin.getByLabel('管理员令牌').fill(token);
    await admin.getByRole('button', { name: '发布新版本' }).click();
    await admin.getByText(/已发布“空城验证”/).waitFor({ timeout: 10000 });
    const id = await admin.evaluate(() => window.__admin.lastPublished), player = await game.open();
    try {
      await player.evaluate((version) => sessionStorage.setItem('haou-hd2d-scenario', version), id);
      await player.reload();
      await player.waitForFunction((version) => window.__game?.debug && window.__game.G.currentScenario() === version, id);
      const city = await player.evaluate(() => window.__game.G.newGame(4, 1, 1).cities[17]);
      assert.equal(city.faction, 7); assert.deepEqual(city.officers, []);
      assert.deepEqual(player.errors, []);
    } finally { await player.context().close(); }
    assert.deepEqual(admin.errors, []);
  } finally { await admin.context().close(); }
});
