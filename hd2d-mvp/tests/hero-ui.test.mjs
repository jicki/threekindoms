import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startGame, newCampaign, skipIntro, closeMessages, castGo } from './game.mjs';

const token = `test-token-${'h'.repeat(40)}`;
// 实际测量文字和按钮的边界，避免仅靠 CSS 声明判断是否仍然溢出。
async function assertDuelSkillFits(page, move, width, height) {
  await page.setViewportSize({ width, height });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const r = await move.evaluate((button) => {
    const box = button.getBoundingClientRect();
    return { box: [box.left, box.top, box.right, box.bottom], parts: [...button.children].map((el) => {
      const rect = el.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(el);
      return { text: el.textContent, box: [rect.left, rect.top, rect.right, rect.bottom], scrollWidth: el.scrollWidth, width: el.clientWidth,
        lines: [...range.getClientRects()].map((line) => [line.left, line.top, line.right, line.bottom]) };
    }) };
  });
  assert.ok(r.box[0] >= -1 && r.box[1] >= -1 && r.box[2] <= width + 1 && r.box[3] <= height + 1, JSON.stringify(r));
  for (const part of r.parts) {
    assert.ok(part.box[0] >= r.box[0] - 1 && part.box[1] >= r.box[1] - 1 && part.box[2] <= r.box[2] + 1 && part.box[3] <= r.box[3] + 1, JSON.stringify(r));
    assert.ok(part.scrollWidth <= part.width + 1, JSON.stringify(r));
    for (const line of part.lines) assert.ok(line[0] >= r.box[0] - 1 && line[1] >= r.box[1] - 1 && line[2] <= r.box[2] + 1 && line[3] <= r.box[3] + 1, JSON.stringify(r));
  }
}
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
    await admin.locator('#published').selectOption('builtin-sovereigns');
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
    await content.getByLabel('搜索武将').fill('张辽');
    await content.getByRole('button', { name: /No\.156\s+张辽/ }).click();
    assert.equal(await content.getByLabel('专属单挑技').inputValue(), 'xiaoyao');
    await content.getByRole('button', { name: '应用修改' }).click();
    await content.getByLabel('搜索武将').fill('郭嘉');
    await content.getByRole('button', { name: /No\.24\s+郭嘉/ }).click();
    assert.equal(await content.getByRole('checkbox', { name: '奉孝奇策' }).isChecked(), true);
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
          zhangliao: data.officers[156].duelSkill, guojia: data.officers[24].skills,
          uses: data.customSkills.find((skill) => skill.id === 18).maxUses };
      });
      assert.deepEqual(result, { name: '陈宫', priority: true, skill: 'longdan', strategies: [18], lubu: 'fangtian', zhangliao: 'xiaoyao', guojia: [21], uses: 1 });
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
    await admin.locator('#published').selectOption('builtin-sovereigns');
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

test('标题默认只显示原版和君主列传，后者包含原扩展人物', async () => {
  const page = await game.open();
  try {
    await skipIntro(page); await page.locator('.sysmenu-btn').click();
    await page.locator('.sysmenu-list button', { hasText: '游戏版本' }).click();
    const dialog = page.getByRole('dialog', { name: '选择游戏版本' });
    await dialog.waitFor();
    const merged = dialog.getByRole('button', { name: /^群英新篇·君主列传\s*(当前版本|选择此版本)$/ });
    assert.equal(await merged.count(), 1);
    assert.equal(await dialog.getByRole('button', { name: /群英新篇·新阵容/ }).count(), 0);
    assert.equal(await dialog.getByRole('button', { name: /群英新篇·十方诸侯/ }).count(), 0);
    assert.equal(await dialog.getByRole('button', { name: /巾帼群英/ }).count(), 0);
    await merged.click();
    await page.waitForFunction(() => window.__game?.G.currentScenario() === 'builtin-sovereigns-expanded-map', null, { timeout: 30000 });
    assert.equal(await page.evaluate(() => window.__game.G.data().officers[242].name), '陈宫');
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('版本选择适配长名称，旧版入口隐藏且已发布版本仍可访问', { timeout: 90000 }, async () => {
  const longName = '群英'.repeat(20), id = `v-${'a'.repeat(32)}`;
  for (const [query, width, height] of [['', 900, 650], ['&phone', 568, 320]]) {
    const page = await game.open(query, { setup: async (context) => {
      await context.addInitScript(() => {
        localStorage.setItem('haou-hd2d-save:scenario:builtin-female:1:bak', '{}');
        localStorage.setItem('haou-hd2d-save:scenario:builtin-heroes:quick', '{}');
        localStorage.setItem('haou-hd2d-save:scenario:builtin-heroes-roster:1', '{}');
        localStorage.setItem('haou-hd2d-suspend:scenario:builtin-warlords', '{}');
      });
      await context.route('**/api/versions', (route) => route.fulfill({ json: [{ id, name: longName }] }));
    } });
    try {
      await page.setViewportSize({ width, height }); await skipIntro(page);
      await page.locator('.sysmenu-btn').click();
      if (query) await page.getByRole('tab', { name: '其他' }).click();
      await page.locator('.sysmenu-list button', { hasText: '游戏版本' }).click();
      const dialog = page.getByRole('dialog', { name: '选择游戏版本' }); await dialog.waitFor();
      const choices = dialog.locator('.scenario-choices .slot');
      assert.equal(await choices.count(), 3);
      assert.equal(await choices.filter({ hasText: '旧存档兼容' }).count(), 0);
      assert.equal(await choices.filter({ hasText: '群英新篇·君主列传' }).getAttribute('aria-current'), 'true');
      const custom = choices.filter({ hasText: longName }); await custom.scrollIntoViewIfNeeded();
      const geometry = await custom.evaluate((button) => {
        const b = button.getBoundingClientRect(), name = button.querySelector('b'), state = button.querySelector('span');
        const n = name.getBoundingClientRect(), s = state.getBoundingClientRect();
        return { b: [b.left, b.right], n: [n.left, n.right], s: [s.left, s.right], scroll: name.scrollWidth, width: name.clientWidth, text: name.textContent };
      });
      assert.equal(geometry.text, longName);
      assert.ok(geometry.b[0] >= 0 && geometry.b[1] <= width && geometry.n[0] >= geometry.b[0] && geometry.n[1] <= geometry.s[0] && geometry.s[1] <= geometry.b[1] && geometry.scroll <= geometry.width + 1, JSON.stringify(geometry));
      assert.deepEqual(page.errors, []);
    } finally { await page.context().close(); }
  }
});

test('新阵容人物包含在君主列传，编辑器可发布', async () => {
  const page = await game.open('', { setup: (context) => context.addInitScript(() => localStorage.setItem('haou-hd2d-save:scenario:builtin-heroes-roster:1', '{}')) });
  try {
    await skipIntro(page); await page.locator('.sysmenu-btn').click();
    await page.locator('.sysmenu-list button', { hasText: '游戏版本' }).click();
    await page.getByRole('dialog', { name: '选择游戏版本' }).getByRole('button', { name: /群英新篇·君主列传/ }).click();
    await page.waitForFunction(() => window.__game?.G.currentScenario() === 'builtin-sovereigns-expanded-map', null, { timeout: 30000 });
    assert.deepEqual(await page.evaluate(() => {
      const d = window.__game.G.data(); return [d.officers[244].name, d.officers[244].duelSkill, d.officers[245].name, d.officers[245].skills];
    }), ['陈到', 'baier', '辛宪英', [23]]);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
  const admin = await game.open();
  try {
    await admin.goto(new URL('admin.html?mute', game.url).href); await admin.waitForFunction(() => window.__admin);
    await admin.locator('#published').selectOption('builtin-sovereigns');
    await admin.getByRole('button', { name: '载入为新草稿' }).click(); await admin.getByText('已载入新草稿').waitFor();
    await admin.getByLabel('版本名称').fill('新阵容发布验证');
    const content = admin.locator('#content');
    await content.getByLabel('搜索武将').fill('陈到');
    await content.getByRole('button', { name: /No\.244\s+陈到/ }).click();
    assert.equal(await content.getByLabel('专属单挑技').inputValue(), 'baier');
    await content.getByLabel('搜索武将').fill('辛宪英');
    await content.getByRole('button', { name: /No\.245\s+辛宪英/ }).click();
    assert.equal(await content.getByRole('checkbox', { name: '宪英明鉴' }).isChecked(), true);
    await admin.getByLabel('管理员令牌').fill(token); await admin.getByRole('button', { name: '发布新版本' }).click();
    await admin.getByText(/已发布“新阵容发布验证”/).waitFor();
    const id = await admin.evaluate(() => window.__admin.lastPublished);
    const player = await game.open('', { setup: (context) => context.addInitScript((version) => sessionStorage.setItem('haou-hd2d-scenario', version), id) });
    try {
      assert.deepEqual(await player.evaluate(() => {
        const d = window.__game.G.data(); return [d.officers[244].name, d.officers[244].duelSkill, d.officers[245].name, d.officers[245].skills, d.relationships.filter((r) => [244, 245].includes(r.to)).length];
      }), ['陈到', 'baier', '辛宪英', [23], 2]);
      assert.deepEqual(player.errors, []);
    } finally { await player.context().close(); }
    assert.deepEqual(admin.errors, []);
  } finally { await admin.context().close(); }
});

test('手机横屏可选择包含新阵容的君主列传', async () => {
  const page = await game.open('&phone', { setup: (context) => context.addInitScript(() => localStorage.setItem('haou-hd2d-save:scenario:builtin-heroes-roster:quick', '{}')) });
  try {
    await page.setViewportSize({ width: 812, height: 375 });
    await skipIntro(page); await page.locator('.sysmenu-btn').click();
    await page.getByRole('tab', { name: '其他' }).click();
    await page.locator('.sysmenu-list button', { hasText: '游戏版本' }).click();
    const choice = page.getByRole('dialog', { name: '选择游戏版本' }).getByRole('button', { name: /群英新篇·君主列传/ });
    await choice.click();
    await page.waitForFunction(() => window.__game?.G.currentScenario() === 'builtin-sovereigns-expanded-map', null, { timeout: 30000 });
    assert.equal(await page.evaluate(() => window.__game.G.data().officers[244].name), '陈到');
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('旧版本会话转入君主列传，旧记录不再提供入口且保持原样', async () => {
  const keys = ['haou-hd2d-save:scenario:builtin-female:1', 'haou-hd2d-save:scenario:builtin-female:quick',
    'haou-hd2d-save:scenario:builtin-female:auto', 'haou-hd2d-suspend:scenario:builtin-female'];
  const page = await game.open('&flat', { setup: (context) => context.addInitScript((names) => {
    sessionStorage.setItem('haou-hd2d-scenario', 'builtin-female');
    names.forEach((key, i) => localStorage.setItem(key, JSON.stringify({ old: i })));
  }, keys) });
  try {
    await skipIntro(page);
    assert.equal(await page.evaluate(() => window.__game.G.currentScenario()), 'builtin-sovereigns-expanded-map');
    assert.equal(await page.getByText('继续记录').count(), 0);
    assert.equal(await page.getByText('继续战斗').count(), 0);
    await page.locator('.sysmenu-btn').click(); await page.locator('.sysmenu-list button', { hasText: '游戏版本' }).click();
    const dialog = page.getByRole('dialog', { name: '选择游戏版本' });
    assert.equal(await dialog.getByText('旧存档兼容', { exact: false }).count(), 0);
    assert.deepEqual(await page.evaluate((names) => names.map((key) => localStorage.getItem(key)), keys), keys.map((_, i) => JSON.stringify({ old: i })));
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
    await page.evaluate(() => { window.__tq.side.a.tacticRounds = 1; });
    await page.locator('.tq-speed .tq-btn', { hasText: '1×' }).click();
    assert.match(await page.locator('.tq-tac', { hasText: '强弩' }).getAttribute('title'), /4回合/);
    assert.match(await page.locator('.tq-tac', { hasText: '士气向上' }).getAttribute('title'), /5回合/);
    await page.evaluate(() => { window.__tq.side.a.tacticRounds = 0; });
    await page.evaluate(() => {
      const battle = window.__tq; battle.startDuel('a');
      battle.duel.side.a.hp = battle.duel.side.d.hp = 100;
      battle.duel.side.a.F = 10; battle.duel.side.a.eq.atk = 0; battle.duel.aiCommand = () => 'feint';
    });
    await page.locator('.tq-start button:not(.arming)').click();
    const move = page.locator('.tq-duel-acts .dcmd', { hasText: '青龙斩' });
    await move.waitFor({ timeout: 30000 }); assert.equal(await move.isEnabled(), true);
    assert.match(await move.textContent(), /命中.*120%伤/);
    await assertDuelSkillFits(page, move, 1280, 800);
    await assertDuelSkillFits(page, move, 900, 650);
    await page.setViewportSize({ width: 1280, height: 800 });
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
    await assertDuelSkillFits(page, move, 812, 375);
    await assertDuelSkillFits(page, move, 568, 320);
    await page.setViewportSize({ width: 812, height: 375 });
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
    await content.getByLabel('角色模板').selectOption('dao');
    await content.getByRole('button', { name: '添加角色模板' }).click();
    await content.getByRole('heading', { name: /陈到/ }).waitFor();
    assert.equal(await content.getByLabel('专属单挑技').inputValue(), 'baier');
    await content.getByLabel('角色模板').selectOption('xin');
    await content.getByRole('button', { name: '添加角色模板' }).click();
    await content.getByRole('heading', { name: /辛宪英/ }).waitFor();
    assert.equal(await content.getByRole('checkbox', { name: '宪英明鉴' }).isChecked(), true);
    const added = await admin.evaluate(() => window.__admin.draft.officers.slice(-2).map((o) => [o.name, o.visual.portrait, o.duelSkill ?? null, o.skills]));
    assert.deepEqual(added, [['陈到', 'b-gao-portrait', 'baier', []], ['辛宪英', 'b-cai-portrait', null, [17]]]);
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
