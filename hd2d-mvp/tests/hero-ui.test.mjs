import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startGame, newCampaign, skipIntro, closeMessages, castGo } from './game.mjs';

const token = `test-token-${'h'.repeat(40)}`;
const previous = { token: process.env.GAME_ADMIN_TOKEN, directory: process.env.GAME_VERSION_DIR };
let game, directory;
before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'threekindoms-heroes-test-'));
  process.env.GAME_ADMIN_TOKEN = token; process.env.GAME_VERSION_DIR = directory;
  game = await startGame();
});
after(async () => {
  await game?.close();
  if (previous.token === undefined) delete process.env.GAME_ADMIN_TOKEN; else process.env.GAME_ADMIN_TOKEN = previous.token;
  if (previous.directory === undefined) delete process.env.GAME_VERSION_DIR; else process.env.GAME_VERSION_DIR = previous.directory;
  if (directory) rmSync(directory, { recursive: true, force: true });
});

test('扩展版本可在编辑器配置专属技能并发布供玩家使用', async () => {
  const admin = await game.open();
  try {
    await admin.goto(new URL('admin.html?mute', game.url).href); await admin.waitForFunction(() => window.__admin);
    await admin.locator('#published').selectOption('builtin-heroes');
    await admin.getByRole('button', { name: '载入为新草稿' }).click();
    await admin.getByText('已载入新草稿').waitFor();
    await admin.getByLabel('版本名称').fill('群英技能验证');
    const content = admin.locator('#content');
    await content.getByLabel('搜索武将').fill('陈宫');
    await content.getByRole('button', { name: /No\.242\s+陈宫/ }).click();
    assert.equal(await content.getByRole('checkbox', { name: '公台奇谋' }).isChecked(), true);
    assert.equal(await content.getByLabel('登场后优先搜索').isChecked(), true);
    await content.getByLabel('登场后优先搜索').uncheck();
    await content.getByRole('button', { name: '应用修改' }).click();
    assert.equal(await content.getByLabel('登场后优先搜索').isChecked(), false);
    await content.getByLabel('登场后优先搜索').check();
    await content.getByLabel('专属单挑技').selectOption('longdan');
    await content.getByRole('button', { name: '应用修改' }).click();
    await admin.getByText('人物修改已应用到草稿').waitFor();
    await content.getByLabel('搜索武将').fill('吕布');
    await content.getByRole('button', { name: /No\.218\s+吕布/ }).click();
    assert.equal(await content.getByLabel('专属单挑技').inputValue(), 'fangtian');
    await content.getByLabel('专属单挑技').selectOption('');
    await content.getByRole('button', { name: '应用修改' }).click();
    await content.getByLabel('专属单挑技').selectOption('fangtian');
    await content.getByRole('button', { name: '应用修改' }).click();
    await admin.getByRole('tab', { name: '新技能' }).click();
    await content.getByRole('button', { name: '公台奇谋', exact: true }).click();
    await content.getByLabel('每场使用次数').fill('1');
    await content.getByRole('button', { name: '应用修改' }).click();
    await admin.getByText('技能修改已应用到草稿').waitFor();
    await admin.getByLabel('管理员令牌').fill(token); await admin.getByRole('button', { name: '发布新版本' }).click();
    await admin.getByText(/已发布“群英技能验证”/).waitFor();
    const id = await admin.evaluate(() => window.__admin.lastPublished);
    const player = await game.open('', { setup: (context) => context.addInitScript((version) => sessionStorage.setItem('haou-hd2d-scenario', version), id) });
    try {
      const result = await player.evaluate(() => {
        const data = window.__game.G.data();
        return { name: data.officers[242].name, priority: data.officers[242].searchPriority, skill: data.officers[242].duelSkill, strategies: data.officers[242].skills, lubu: data.officers[218].duelSkill,
          uses: data.customSkills.find((skill) => skill.id === 18).maxUses };
      });
      assert.deepEqual(result, { name: '陈宫', priority: true, skill: 'longdan', strategies: [18], lubu: 'fangtian', uses: 1 });
      assert.deepEqual(player.errors, []);
    } finally { await player.context().close(); }
    assert.deepEqual(admin.errors, []);
  } finally { await admin.context().close(); }
});

test('人物志按年份显示优先寻访和实际可寻访状态', async () => {
  const page = await game.open('&flat', { setup: (context) => context.addInitScript(() => {
    sessionStorage.setItem('haou-hd2d-scenario', 'builtin-heroes');
    localStorage.setItem('hd2d-talent', 'all');
  }) });
  try {
    await newCampaign(page);
    await page.evaluate(() => { window.__game.g.year = 191; });
    await page.keyboard.press('r');
    const row = page.locator('tr[data-id="242"]');
    assert.match(await row.innerText(), /兖州搜索\s*优先/);
    assert.match(await row.innerText(), /192年起优先/);
    await page.evaluate(() => { window.__game.g.year = 192; });
    await page.getByLabel('查找武将').fill('陈宫');
    assert.match(await row.innerText(), /可寻访/);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('修改登场方式时编辑器隐藏并清除不适用的搜索优先设置', async () => {
  const admin = await game.open();
  try {
    await admin.goto(new URL('admin.html?mute', game.url).href); await admin.waitForFunction(() => window.__admin);
    await admin.locator('#published').selectOption('builtin-heroes');
    await admin.getByRole('button', { name: '载入为新草稿' }).click();
    const content = admin.locator('#content');
    await content.getByLabel('搜索武将').fill('陈宫');
    await content.getByRole('button', { name: /No\.242\s+陈宫/ }).click();
    await content.getByLabel('登场方式').selectOption('automatic_faction');
    assert.equal(await content.getByLabel('登场后优先搜索').isVisible(), false);
    await content.getByRole('button', { name: '应用修改' }).click();
    assert.equal(await admin.evaluate(() => Object.hasOwn(window.__admin.draft.officers.find((o) => o.id === 242), 'searchPriority')), false);
    await content.getByLabel('登场方式').selectOption('search_city');
    await content.getByLabel('登场城市').selectOption('11');
    await content.getByLabel('登场后优先搜索').check();
    await content.getByRole('button', { name: '应用修改' }).click();
    assert.equal(await admin.evaluate(() => window.__admin.draft.officers.find((o) => o.id === 242).searchPriority), true);
    assert.deepEqual(admin.errors, []);
  } finally { await admin.context().close(); }
});

test('玩家可从标题页选择群英新篇', async () => {
  const page = await game.open();
  try {
    await skipIntro(page); await page.locator('.sysmenu-btn').click();
    await page.locator('.sysmenu-list button', { hasText: '游戏版本' }).click();
    const dialog = page.getByRole('dialog', { name: '选择游戏版本' });
    await dialog.waitFor();
    assert.equal(await dialog.getByRole('button', { name: /群英新篇/ }).count(), 1);
    assert.equal(await dialog.getByRole('button', { name: /巾帼群英/ }).count(), 0);
    await page.getByRole('button', { name: /群英新篇/ }).click();
    await page.waitForFunction(() => window.__game?.G.currentScenario() === 'builtin-heroes', null, { timeout: 30000 });
    assert.equal(await page.evaluate(() => window.__game.G.data().officers[242].name), '陈宫');
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('旧版动态武将和各类记录可通过兼容入口继续，合并版存档独立', async () => {
  const page = await game.open('&flat', { setup: (context) => context.addInitScript(() => {
    if (!sessionStorage.getItem('haou-hd2d-scenario')) sessionStorage.setItem('haou-hd2d-scenario', 'builtin-female');
  }) });
  try {
    const old = await page.evaluate(async () => {
      const { G } = window.__game, g = G.newGame(4, 1, 9), { suspend } = await import('./src/core/suspend.js');
      const { Field } = await import('./src/core/field.js');
      g.year = 200; g.officers.push({ ...g.officers[0], id: 240, debut: 200 }); g.clones = [240]; G.registerClones(g);
      g.officers[222].soldiers = g.officers[22].soldiers = 500;
      const war = { city: 8, from: 12, attacker: 4, defender: 0,
        att: { ids: [222], gold: 100, rice: 500 }, def: { ids: [22], gold: 100, rice: 500 } };
      const field = new Field(g, war, 'att');
      const ok = [G.save(g, 1), G.saveQuick(g), G.saveAuto(g),
        suspend(g, war, field, { side: 'att', start: { 222: 500, 22: 500 }, after: { kind: 'att' } })];
      const keys = ['haou-hd2d-save:scenario:builtin-female:1', 'haou-hd2d-save:scenario:builtin-female:quick',
        'haou-hd2d-save:scenario:builtin-female:auto', 'haou-hd2d-suspend:scenario:builtin-female'];
      return { ok, records: keys.map((key) => [key, localStorage.getItem(key)]) };
    });
    assert.deepEqual(old.ok, [true, true, true, true]);
    await skipIntro(page);
    await page.getByRole('button', { name: '进入群英新篇' }).click();
    await page.waitForFunction(() => window.__game?.G.currentScenario() === 'builtin-heroes', null, { timeout: 30000 });
    const merged = await page.evaluate(() => {
      const { G } = window.__game, g = G.newGame(4, 1, 10); g.year = 210;
      return { name: G.data().officers[240].name, saved: G.save(g, 1), year: G.load(1).year };
    });
    assert.deepEqual(merged, { name: '蔡琰', saved: true, year: 210 });
    await page.locator('.sysmenu-btn').click(); await page.locator('.sysmenu-list button', { hasText: '游戏版本' }).click();
    const dialog = page.getByRole('dialog', { name: '选择游戏版本' });
    await dialog.getByText(/旧存档仍按原有规则继续/).waitFor();
    await dialog.getByRole('button', { name: /巾帼群英（旧存档兼容）/ }).click();
    await page.waitForFunction(() => window.__game?.G.currentScenario() === 'builtin-female', null, { timeout: 30000 });
    const restored = await page.evaluate(async (records) => {
      const { G } = window.__game, { peekSuspend } = await import('./src/core/suspend.js');
      const normal = G.load(1), quick = G.loadQuick(), auto = G.loadAuto(), held = peekSuspend();
      return { years: [normal?.year, quick?.year, auto?.year, held?.g.year], clone: G.data().officers[240]?.clone,
        cloneId: normal?.clones?.[0], records: records.map(([key]) => [key, localStorage.getItem(key)]),
        mergedYear: JSON.parse(localStorage.getItem('haou-hd2d-save:scenario:builtin-heroes:1')).year };
    }, old.records);
    assert.deepEqual(restored.years, [200, 200, 200, 200]); assert.equal(restored.clone, true); assert.equal(restored.cloneId, 240);
    assert.deepEqual(restored.records, old.records); assert.equal(restored.mergedYear, 210);
    await page.getByRole('button', { name: '继续战斗' }).waitFor();
    assert.equal(await page.getByRole('button', { name: '新的征程' }).count(), 0);
    await page.getByRole('button', { name: '继续战斗' }).click();
    await page.waitForFunction(() => window.__game?.war?.field?.resumed && document.body.dataset.screen === 'war', null, { timeout: 30000 });
    const resumed = await page.evaluate(() => ({ year: window.__game.g.year, clone: window.__game.G.data().officers[240].clone,
      units: window.__game.war.field.units.map((u) => u.id), held: localStorage.getItem('haou-hd2d-suspend:scenario:builtin-female'),
      mergedYear: JSON.parse(localStorage.getItem('haou-hd2d-save:scenario:builtin-heroes:1')).year }));
    assert.deepEqual(resumed, { year: 200, clone: true, units: [22, 222], held: null, mergedYear: 210 });
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('新增人物素材可解码，单挑技在页面显示、使用后禁用', async () => {
  const page = await game.open('', { setup: (context) => context.addInitScript(() => sessionStorage.setItem('haou-hd2d-scenario', 'builtin-heroes')) });
  try {
    const images = await page.evaluate(async () => {
      const result = [];
      for (const key of ['cai', 'wang', 'chen', 'gao']) for (const name of ['portrait.webp', 'calm.webp', 'joy.webp', 'angry.webp', 'grief.webp', 'motion.png']) {
        const response = await fetch(`assets/characters/${key}/${name}`); if (!response.ok) throw Error(`${key}/${name}: ${response.status}`);
        const bmp = await createImageBitmap(await response.blob()); result.push([key, name, bmp.width, bmp.height]); bmp.close();
      }
      return result;
    });
    assert.equal(images.length, 24);
    for (const [, name, width, height] of images) assert.deepEqual([width, height], name === 'motion.png' ? [512, 512] : name === 'portrait.webp' ? [768, 1152] : [384, 512]);
    await page.evaluate(() => { window.__game.debug.quickTactical(38, 22, 2); });
    await page.waitForSelector('.tq-form', { timeout: 60000 });
    await page.locator('.tq-form').first().click(); await page.locator('.tq-deploy:not(.arming)').click();
    await page.waitForSelector('.tq-start button', { timeout: 30000 });
    await page.evaluate(() => {
      const battle = window.__tq; battle.startDuel('a');
      battle.duel.side.a.hp = battle.duel.side.d.hp = 100;
      battle.duel.side.a.F = 10; battle.duel.side.a.eq.atk = 0; battle.duel.aiCommand = () => 'feint';
    });
    await page.locator('.tq-start button:not(.arming)').click();
    const move = page.locator('.tq-duel-acts .dcmd', { hasText: '青龙斩' });
    await move.waitFor({ timeout: 30000 }); assert.equal(await move.isEnabled(), true);
    assert.match(await move.textContent(), /命中.*120%伤/);
    await page.keyboard.press('8'); await page.waitForSelector('.shade .ocard-pair');
    assert.match(await page.locator('.shade .ocard-pair').textContent(), /单挑技：青龙斩/);
    await page.keyboard.press('Escape'); await page.waitForSelector('.shade', { state: 'detached' });
    await move.click();
    await page.waitForFunction(() => window.__tq.duel?.specialUsed.a === true, null, { timeout: 30000 });
    await move.waitFor({ timeout: 30000 }); assert.equal(await move.isDisabled(), true);
    assert.match(await move.textContent(), /已用过/);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('吕布可在单挑页面使用方天破阵且每场只有一次', async () => {
  const page = await game.open('', { setup: (context) => context.addInitScript(() => sessionStorage.setItem('haou-hd2d-scenario', 'builtin-heroes')) });
  try {
    await page.evaluate(() => { window.__game.debug.quickTactical(218, 38, 2); });
    await page.waitForSelector('.tq-form', { timeout: 60000 });
    await page.locator('.tq-form').first().click(); await page.locator('.tq-deploy:not(.arming)').click();
    await page.waitForSelector('.tq-start button', { timeout: 30000 });
    await page.evaluate(() => {
      const battle = window.__tq; battle.startDuel('a');
      battle.duel.side.a.hp = battle.duel.side.d.hp = 100;
      battle.duel.side.a.F = 10; battle.duel.side.a.eq.atk = 0; battle.duel.aiCommand = () => 'feint';
    });
    await page.locator('.tq-start button:not(.arming)').click();
    const skill = page.locator('.tq-duel-acts .tq-special', { hasText: '方天破阵' });
    await skill.waitFor({ timeout: 30000 }); assert.equal(await skill.isEnabled(), true);
    assert.match(await skill.textContent(), /120%伤/);
    await skill.click();
    await page.waitForFunction(() => window.__tq.duel?.specialUsed.a === true, null, { timeout: 30000 });
    await skill.waitFor({ timeout: 30000 }); assert.equal(await skill.isDisabled(), true);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('手机横屏中专属单挑技可见且可以点击', async () => {
  const page = await game.open('&phone', { setup: (context) => context.addInitScript(() => sessionStorage.setItem('haou-hd2d-scenario', 'builtin-heroes')) });
  try {
    await page.setViewportSize({ width: 812, height: 375 });
    await page.evaluate(() => { window.__game.debug.quickTactical(38, 22, 2); });
    await page.waitForSelector('.tq-form', { timeout: 60000 });
    await page.locator('.tq-form').first().click(); await page.locator('.tq-deploy:not(.arming)').click();
    await page.waitForSelector('.tq-start button', { timeout: 30000 });
    await page.evaluate(() => { const b = window.__tq; b.startDuel('a'); b.duel.aiCommand = () => 'feint'; });
    await page.locator('.tq-start button:not(.arming)').click();
    const move = page.locator('.tq-duel-acts .tq-special'); await move.waitFor({ timeout: 30000 });
    const box = await move.boundingBox();
    assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 812 && box.y + box.height <= 375);
    assert.ok(box.width >= 70, `技能按钮过窄：${box.width}`);
    await move.click(); await page.waitForFunction(() => window.__tq.duel?.specialUsed.a === true, null, { timeout: 30000 });
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('添加新角色模板时自动加入对应的受限计略和单挑技', async () => {
  const admin = await game.open();
  try {
    await admin.goto(new URL('admin.html?mute', game.url).href); await admin.waitForFunction(() => window.__admin);
    const content = admin.locator('#content');
    await content.getByLabel('角色模板').selectOption('wang');
    await content.getByRole('button', { name: '添加角色模板' }).click();
    await content.getByRole('heading', { name: /王异/ }).waitFor();
    assert.equal(await content.getByLabel('专属单挑技').inputValue(), 'shoucheng');
    assert.equal(await content.getByRole('checkbox', { name: '坚城奇策' }).isChecked(), true);
    const draft = await admin.evaluate(() => window.__admin.draft);
    assert.deepEqual(draft.officers[0].skills, [16]); assert.equal(draft.skills[0].maxUses, 2);
    assert.equal(draft.weapons.find((e) => e.name === '落日弓').atk, 14);
    const armor = draft.armors.find((e) => e.name === '凤羽宝衣');
    assert.deepEqual([armor.dfn, armor.weight, armor.price, armor.requirements.virtue], [11, 5, 480, 85]);
    assert.deepEqual(admin.errors, []);
  } finally { await admin.context().close(); }
});

test('战场页面可施展专属计略，并显示次数用尽的原因', async () => {
  const page = await game.open('&flat', { setup: (context) => context.addInitScript(() => sessionStorage.setItem('haou-hd2d-scenario', 'builtin-heroes')) });
  try {
    await newCampaign(page);
    await page.evaluate(() => {
      const { g, debug } = window.__game, home = g.factions[g.player].city;
      const foe = g.cities.find((c) => c.faction !== g.player && g.factions[c.faction] && c.officers.length);
      g.officers[242].soldiers = 500; g.officers[foe.officers[0]].soldiers = 500;
      debug.fieldWar({ city: 8, from: home, attacker: g.player, defender: foe.faction, day: 1,
        att: { ids: [242], gold: 1000, rice: 400 }, def: { ids: [foe.officers[0]], gold: 0, rice: 400 } }, 'att');
    });
    await page.waitForFunction(() => window.__game.war?.finishDeploy && document.body.dataset.screen === 'war', null, { timeout: 30000 });
    const stop = closeMessages(page);
    try {
      await page.locator('.deploybtn .btn', { hasText: '布阵完成' }).click({ timeout: 30000 });
      await page.waitForFunction(() => { const f = window.__game.war.field; return f.turn === f.human && !document.querySelector('.banner, .panel.msg'); }, null, { timeout: 30000 });
      const target = await page.evaluate(async () => {
        const { war } = window.__game, f = war.field, me = f.alive.find((u) => u.id === 242), enemy = f.alive.find((u) => u.side !== f.human);
        const cell = [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [0, 2]].map(([dx, dy]) => [me.x + dx, me.y + dy]).find(([x, y]) => f.inside(x, y) && !f.unitAt(x, y));
        [enemy.x, enemy.y] = cell; f.O(enemy.id).soldiers = 500; f.O(enemy.id).hp = 80; f.pool.att = 99; f.r = () => 0;
        (await import('./src/pace.js')).setPace(4); war.clickCell(me.x, me.y); return enemy.id;
      });
      await page.locator('.unitpanel:not(.compare) .acts button', { hasText: '计略' }).click();
      const skill = page.locator('.actpanel [data-sid="18"]');
      assert.match(await skill.getAttribute('title'), /每场最多2次/);
      await skill.click(); await page.locator(`.actpanel [data-target="${target}"]`).click(); await castGo(page);
      await page.waitForFunction(() => window.__game.war.field.units.find((u) => u.id === 242)?.skillUses?.[18] === 1, null, { timeout: 30000 });
      await page.waitForFunction(() => !window.__game.war.st.busy, null, { timeout: 30000 });
      await page.evaluate(() => {
        const { war } = window.__game, f = war.field, me = f.units.find((u) => u.id === 242), enemy = f.units.find((u) => u.side !== me.side);
        f.pool.att = 99; f.cast(me, 18, enemy); war.clickCell(me.x, me.y);
      });
      await page.locator('.unitpanel:not(.compare) .acts button', { hasText: '计略' }).click();
      assert.equal(await skill.isDisabled(), true); assert.match(await skill.textContent(), /本场使用次数已用完/);
    } finally { stop(); }
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});
