import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startGame, skipIntro, closeMessages } from './game.mjs';

const token = `test-token-${'w'.repeat(40)}`;
const previous = { token: process.env.GAME_ADMIN_TOKEN, directory: process.env.GAME_VERSION_DIR };
let game, directory;
before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'threekindoms-warlords-test-'));
  process.env.GAME_ADMIN_TOKEN = token; process.env.GAME_VERSION_DIR = directory;
  game = await startGame();
});
after(async () => {
  await game?.close();
  if (previous.token === undefined) delete process.env.GAME_ADMIN_TOKEN; else process.env.GAME_ADMIN_TOKEN = previous.token;
  if (previous.directory === undefined) delete process.env.GAME_VERSION_DIR; else process.env.GAME_VERSION_DIR = previous.directory;
  if (directory) rmSync(directory, { recursive: true, force: true });
});

async function begin(page, ruler) {
  await page.evaluate(async () => { (await import('./src/pace.js')).setPace(4); (await import('./src/vignette.js')).setVignettes(false); });
  await skipIntro(page); await page.getByText('新的征程').click();
  await page.locator('.level', { hasText: 'LEVEL 1' }).click();
  assert.equal(await page.locator('.ruler').count(), 10);
  for (const name of ['公孙瓒', '袁术', '刘表']) assert.equal(await page.locator('.ruler', { hasText: name }).count(), 1);
  const card = page.locator('.ruler', { hasText: ruler }); await card.click(); await card.click();
  await page.waitForFunction(() => document.body.dataset.screen === 'strategy', null, { timeout: 60000 });
  const stop = closeMessages(page, { aiTurns: true });
  try { await page.waitForFunction(() => { const g = window.__game.g; return g?.current === g.player && !document.querySelector('.aiturn,.panel.msg'); }, null, { timeout: 90000 }); }
  finally { stop(); }
}

test('标题可选择十势力剧本，3D 地图正确区分新势力与无主地区', { timeout: 180000 }, async () => {
  const page = await game.open();
  try {
    await skipIntro(page); await page.locator('.sysmenu-btn').click();
    await page.locator('.sysmenu-list button', { hasText: '游戏版本' }).click();
    await page.getByRole('dialog', { name: '选择游戏版本' }).getByRole('button', { name: /群英新篇·十方诸侯/ }).click();
    await page.waitForFunction(() => window.__game?.G.currentScenario() === 'builtin-warlords', null, { timeout: 30000 });
    await begin(page, '公孙瓒');
    const result = await page.evaluate(() => {
      const { g, G, strategy: s, debug } = window.__game;
      const ground = s.scene.children.find((o) => o.geometry?.attributes?.territory), attrs = ground.geometry.attributes;
      s.territory(true); s.refresh(g); s.update(0); debug.renderer.render(s.scene, s.camera);
      const seen = {}, neutral = G.NONE;
      for (let i = 0; i < attrs.territory.count; i++) {
        if (attrs.position.getY(i) < 0.1401 || attrs.territoryDistance.getX(i) < .5) continue;
        const id = (attrs.territoryBorder.getX(i) >= 0 ? 1 : 0) + (attrs.territoryBorder.getY(i) >= 0 ? 2 : 0)
          + (attrs.territoryBorder.getZ(i) >= 0 ? 4 : 0) + (attrs.territoryHigh.getX(i) >= 0 ? 8 : 0);
        seen[id] = (seen[id] ?? 0) + 1;
      }
      const gl = debug.renderer.getContext();
      return { player: g.player, ruler: G.name(g.factions[g.player].ruler), neutral, cities: [0, 13, 21].map((id) => g.cities[id].faction),
        unownedAtStart: G.newGame(g.player, 1, 42).cities[5].faction, seen, glError: gl.getError() };
    });
    assert.equal(result.player, 7); assert.equal(result.ruler, '公孙瓒'); assert.equal(result.neutral, 10);
    assert.deepEqual(result.cities, [7, 8, 9]); assert.equal(result.unownedAtStart, 10);
    for (const id of [7, 8, 9, 10]) assert.ok(result.seen[id], `3D 领土中缺少 ${id}: ${JSON.stringify(result.seen)}`);
    assert.equal(result.glError, 0);
    const pixels = await page.evaluate(() => {
      const { g, G, strategy: s, debug } = window.__game, scene = s.scene, renderer = debug.renderer, gl = renderer.getContext();
      const ground = scene.children.find((o) => o.geometry?.attributes?.territory);
      const visible = scene.children.map((o) => o.visible), background = scene.background, target = renderer.getRenderTarget();
      const take = () => {
        s.update(0); renderer.render(scene, s.camera);
        const data = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
        gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, data); return data;
      };
      const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++; return n; };
      try {
        scene.children.forEach((o) => { o.visible = o === ground; }); scene.background = null; renderer.setRenderTarget(null);
        s.territory(false); const off = take(); s.territory(true);
        const painted = [7, 8, 9, G.NONE].map((faction) => {
          s.refresh({ ...g, cities: g.cities.map((c) => ({ ...c, faction })) }); return take();
        });
        return { changed: painted.map((p) => diff(off, p)), colorsDiffer: [diff(painted[0], painted[1]), diff(painted[1], painted[2])] };
      } finally {
        renderer.setRenderTarget(target); scene.children.forEach((o, i) => { o.visible = visible[i]; }); scene.background = background;
        s.refresh(g); s.territory(false);
      }
    });
    assert.ok(pixels.changed.slice(0, 3).every((n) => n > 100), `3D 新势力领土未着色：${pixels.changed}`);
    assert.equal(pixels.changed[3], 0, '3D 无主领土应保持原始地形');
    assert.ok(pixels.colorsDiffer.every((n) => n > 100), '3D 新势力领土颜色应不同');
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('平面地图可显示刘表势力与十势力边界', { timeout: 180000 }, async () => {
  const page = await game.open('&flat', { setup: (context) => context.addInitScript(() => sessionStorage.setItem('haou-hd2d-scenario', 'builtin-warlords')) });
  try {
    await begin(page, '刘表');
    const result = await page.evaluate(() => {
      const { g, G, strategy: s } = window.__game;
      const under = s.debugUnder(), snap = new OffscreenCanvas(under.width, under.height);
      const ctx = snap.getContext('2d', { alpha: false, willReadFrequently: true });
      const take = () => { s.update(0); ctx.drawImage(under, 0, 0); return ctx.getImageData(0, 0, under.width, under.height).data; };
      const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++; return n; };
      s.territory(false); const off = take(); s.territory(true);
      const painted = [7, 8, 9, G.NONE].map((faction) => {
        s.refresh({ ...g, cities: g.cities.map((c) => ({ ...c, faction })) }); return take();
      });
      s.refresh(g); s.update(.05);
      return { flat: s.flat, player: g.player, neutral: G.NONE, owners: [0, 13, 21].map((id) => g.cities[id].faction), on: s.territoryOn,
        unownedAtStart: G.newGame(g.player, 1, 42).cities[5].faction, changed: painted.map((p) => diff(off, p)),
        colorsDiffer: [diff(painted[0], painted[1]), diff(painted[1], painted[2])] };
    });
    assert.deepEqual({ flat: result.flat, player: result.player, neutral: result.neutral, owners: result.owners, on: result.on, unownedAtStart: result.unownedAtStart },
      { flat: true, player: 9, neutral: 10, owners: [7, 8, 9], on: true, unownedAtStart: 10 });
    assert.ok(result.changed.slice(0, 3).every((n) => n > 100), `新势力领土未着色：${result.changed}`);
    assert.equal(result.changed[3], 0, '无主领土应保持原始地形');
    assert.ok(result.colorsDiffer.every((n) => n > 100), '三个新势力的领土颜色应不同');
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('手机横屏可选择袁术并进入自己的势力', { timeout: 180000 }, async () => {
  const page = await game.open('&flat&phone', { setup: (context) => context.addInitScript(() => sessionStorage.setItem('haou-hd2d-scenario', 'builtin-warlords')) });
  try {
    await page.setViewportSize({ width: 812, height: 375 }); await begin(page, '袁术');
    assert.deepEqual(await page.evaluate(() => {
      const { g, G } = window.__game; return [g.player, G.name(g.factions[g.player].ruler), g.cities[13].faction, G.NONE];
    }), [8, '袁术', 8, 10]);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('新势力对战时能进入战场并加载双方将领', { timeout: 180000 }, async () => {
  const page = await game.open('&flat&phone', { setup: (context) => context.addInitScript(() => sessionStorage.setItem('haou-hd2d-scenario', 'builtin-warlords')) });
  try {
    await page.setViewportSize({ width: 812, height: 375 }); await begin(page, '袁术');
    await page.evaluate(() => {
      const { g, debug } = window.__game, ids = g.cities[13].officers.slice(0, 2);
      const war = debug.setupWar(g, { from: 13, to: 21, ids, commander: ids[0], gold: 20, rice: 100 });
      debug.fieldWar(war, 'att');
    });
    await page.waitForFunction(() => window.__game.war?.st.deploying && !document.querySelector('#fade.on'), null, { timeout: 30000 });
    const result = await page.evaluate(() => {
      const { war, G } = window.__game;
      return { attacker: war.field.faction('att'), defender: war.field.faction('def'),
        attackers: war.field.side('att').map((u) => G.name(u.id)), defenders: war.field.side('def').map((u) => G.name(u.id)) };
    });
    assert.equal(result.attacker, 8); assert.equal(result.defender, 9);
    assert.ok(result.attackers.includes('袁术')); assert.ok(result.defenders.includes('刘表'));
    assert.ok(result.defenders.includes('文聘')); assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('编辑器可修改新势力人物、添加君主候选并发布给玩家', { timeout: 180000 }, async () => {
  const admin = await game.open();
  try {
    await admin.goto(new URL('admin.html?mute', game.url).href); await admin.waitForFunction(() => window.__admin);
    await admin.locator('#published').selectOption('builtin-warlords');
    await admin.getByRole('button', { name: '载入为新草稿' }).click(); await admin.getByText('已载入新草稿').waitFor();
    await admin.getByLabel('版本名称').fill('十势力发布验证');
    const content = admin.locator('#content');
    await content.getByLabel('搜索武将').fill('刘表'); await content.getByRole('button', { name: /No\.248\s+刘表/ }).click();
    assert.equal(await content.getByLabel('登场城市').inputValue(), '21');
    await content.getByLabel('智力').fill('83'); await content.getByRole('button', { name: '应用修改' }).click();
    await admin.getByText('人物修改已应用到草稿').waitFor();
    assert.equal(await admin.evaluate(() => window.__admin.draft.officers.find((o) => o.id === 248).faction), 9);
    await admin.getByRole('tab', { name: '君主候选' }).click();
    await content.getByLabel('所属势力').selectOption('9'); await content.getByLabel('候选武将').selectOption('192');
    await content.getByRole('button', { name: '添加君主候选' }).click();
    await admin.getByText('君主候选已添加到草稿').waitFor();
    await admin.getByLabel('管理员令牌').fill(token); await admin.getByRole('button', { name: '发布新版本' }).click();
    await admin.getByText(/已发布“十势力发布验证”/).waitFor();
    const id = await admin.evaluate(() => window.__admin.lastPublished);
    const player = await game.open('&flat', { setup: (context) => context.addInitScript((version) => sessionStorage.setItem('haou-hd2d-scenario', version), id) });
    try {
      const result = await player.evaluate(() => {
        const { G } = window.__game, d = G.data(), g = G.newGame(9, 1, 2, { ruler: 192 });
        return [G.NONE, d.factions.length, d.officers[248].int, g.factions[9].ruler, g.cities[21].officers[0]];
      });
      assert.deepEqual(result, [10, 10, 83, 192, 192]); assert.deepEqual(player.errors, []);
    } finally { await player.context().close(); }
    assert.deepEqual(admin.errors, []);
  } finally { await admin.context().close(); }
});
