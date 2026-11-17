import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

test('女性角色支持分开上传立绘、表情和动作，导出素材包可在另一服务器导入发布', async () => {
  const admin = await game.open(), otherDir = mkdtempSync(join(tmpdir(), 'threekindoms-asset-import-'));
  let other;
  try {
    await admin.goto(new URL('admin.html?mute', game.url).href); await admin.waitForFunction(() => window.__admin);
    const content = admin.locator('#content');
    await admin.getByLabel('版本名称').fill('女性角色素材测试');
    await content.getByLabel('女性角色模板').selectOption('sun');
    await content.getByRole('button', { name: '添加角色模板' }).click();
    await content.getByRole('heading', { name: /孙尚香/ }).waitFor();
    assert.equal(await content.getByAltText('立绘素材预览').isVisible(), true);
    await content.getByRole('button', { name: '使用已有图像' }).click();
    assert.equal(await content.getByAltText('立绘素材预览').isHidden(), true);
    const motion = content.getByLabel('动作素材', { exact: true });
    const oldMotion = motion.locator('option[value^="o-"]');
    if (await oldMotion.count()) {
      const ref = await oldMotion.first().getAttribute('value');
      await motion.selectOption(ref);
      const motionPreview = content.getByAltText('动作素材预览');
      assert.match(await motionPreview.getAttribute('src'), new RegExp(`assets/ai/sprites/march/${ref.slice(2)}\\.png$`));
      await motionPreview.evaluate((img) => img.decode());
    }
    await admin.getByLabel('管理员令牌').fill(token);
    const asset = (name) => readFileSync(new URL(`../assets/characters/sun/${name}`, import.meta.url));
    const opaque = await admin.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 4;
      canvas.getContext('2d').fillRect(0, 0, 4, 4); return canvas.toDataURL('image/png').split(',')[1];
    });
    await content.getByLabel('上传动作素材').setInputFiles({ name: 'opaque.png', mimeType: 'image/png', buffer: Buffer.from(opaque, 'base64') });
    await admin.getByText('动作图须包含透明背景和可见图像').waitFor();
    await content.getByLabel('上传立绘素材').setInputFiles({ name: 'portrait.webp', mimeType: 'image/webp', buffer: asset('portrait.webp') });
    await admin.getByText('立绘素材已上传，请应用人物修改').waitFor();
    await content.getByLabel('上传愤怒表情').setInputFiles({ name: 'angry.webp', mimeType: 'image/webp', buffer: asset('angry.webp') });
    await admin.getByText('愤怒表情已上传，请应用人物修改').waitFor();
    await content.getByAltText('愤怒表情预览').evaluate((img) => img.decode());
    await content.getByLabel('上传动作素材').setInputFiles({ name: 'motion.png', mimeType: 'image/png', buffer: asset('motion.png') });
    await admin.getByText('动作素材已上传，请应用人物修改').waitFor();
    await content.getByAltText('动作素材预览').evaluate((img) => img.decode());
    await content.getByRole('button', { name: '应用修改' }).click();
    const visual = await admin.evaluate(() => window.__admin.draft.officers.find((o) => o.name === '孙尚香').visual);
    for (const ref of [visual.portrait, visual.faces.angry, visual.motion]) assert.match(ref, /^a-[a-f0-9]{64}$/);
    const download = admin.waitForEvent('download');
    await admin.getByRole('button', { name: '导出草稿' }).click();
    const bundle = JSON.parse(readFileSync(await (await download).path(), 'utf8'));
    assert.equal(bundle.bundle, 'threekindoms-assets-v1'); assert.equal(Object.keys(bundle.assets).length, 3);
    await admin.getByRole('button', { name: '发布新版本' }).click();
    await admin.getByText(/已发布“女性角色素材测试”/).waitFor();
    const id = await admin.evaluate(() => window.__admin.lastPublished);
    const requested = [];
    const player = await game.open('', { setup: async (context) => {
      context.on('request', (request) => requested.push(new URL(request.url()).pathname));
      await context.addInitScript((version) => sessionStorage.setItem('haou-hd2d-scenario', version), id);
    } });
    try {
      const sources = await player.evaluate(async () => {
        const { face, figure } = await import('./src/ui.js'), panel = document.createElement('div');
        panel.append(figure(237), face(237, '', 'angry')); document.body.append(panel);
        await Promise.all([...panel.querySelectorAll('img')].map((img) => img.decode()));
        return [...panel.querySelectorAll('img')].map((img) => img.getAttribute('src'));
      });
      assert.deepEqual(sources, [`/api/assets/${visual.portrait}`, `/api/assets/${visual.faces.angry}`]);
      await player.evaluate(() => { window.__game.debug.quickTactical(237, 38, 2); });
      await player.waitForSelector('.tq-form', { timeout: 60000 });
      assert.ok(requested.includes(`/api/assets/${visual.motion}`), '白兵加载已发布的动作素材');
      assert.deepEqual(player.errors, []);
    } finally { await player.context().close(); }
    const savedDir = process.env.GAME_VERSION_DIR;
    process.env.GAME_VERSION_DIR = otherDir;
    try { other = await startGame(); } finally { process.env.GAME_VERSION_DIR = savedDir; }
    const importer = await other.open();
    try {
      await importer.goto(new URL('admin.html?mute', other.url).href); await importer.waitForFunction(() => window.__admin);
      await importer.getByLabel('管理员令牌').fill(token);
      await importer.locator('#file').setInputFiles({ name: 'version.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bundle)) });
      await importer.getByText('版本已导入，未修改时可恢复原编号').waitFor();
      await importer.getByRole('button', { name: '发布新版本' }).click();
      await importer.getByText(/已发布“女性角色素材测试”/).waitFor();
      assert.equal(await importer.evaluate(() => window.__admin.lastPublished), id);
      const published = await (await fetch(new URL(`/api/versions/${id}`, other.url))).json();
      assert.deepEqual(published.officers.find((o) => o.name === '孙尚香').visual, visual);
      for (const ref of [visual.portrait, visual.faces.angry, visual.motion]) assert.equal((await fetch(new URL(`/api/assets/${ref}`, other.url))).status, 200);
      assert.deepEqual(importer.errors, []);
    } finally { await importer.context().close(); }
    assert.deepEqual(admin.errors, []);
  } finally { await other?.close(); await admin.context().close(); rmSync(otherDir, { recursive: true, force: true }); }
});

test('版本列表与可选旧动作不可用时仍可载入内置版本', async () => {
  const admin = await game.open();
  try {
    await admin.route('**/api/versions', (route) => route.abort());
    await admin.route('**/assets/ai/sprites/march/index.json', (route) => route.abort());
    await admin.goto(new URL('admin.html?mute', game.url).href); await admin.waitForFunction(() => window.__admin);
    await admin.getByText('无法读取服务器版本列表；仍可编辑草稿，发布前请检查服务器。').waitFor();
    await admin.locator('#published').selectOption('builtin-female');
    await admin.getByRole('button', { name: '载入为新草稿' }).click();
    await admin.getByText('已载入新草稿').waitFor();
    const names = await admin.evaluate(() => window.__admin.draft.officers.map((officer) => officer.name));
    assert.deepEqual(names, ['孙尚香', '甄宓', '貂蝉']);
    assert.deepEqual(admin.errors, []);
  } finally { await admin.context().close(); }
});

test('已发布版本列表返回时保留用户选择的内置版本', async () => {
  const admin = await game.open();
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const id = `v-${'e'.repeat(32)}`;
  try {
    await admin.route('**/api/versions', async (route) => {
      await wait;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id, name: '延迟版本' }]) });
    });
    await admin.goto(new URL('admin.html?mute', game.url).href); await admin.waitForFunction(() => window.__admin);
    await admin.locator('#published').selectOption('builtin-female');
    release();
    await admin.waitForFunction((expected) => [...document.querySelector('#published').options].some((option) => option.value === expected), id);
    assert.equal(await admin.locator('#published').inputValue(), 'builtin-female');
    assert.deepEqual(admin.errors, []);
  } finally { release(); await admin.context().close(); }
});

test('编辑器可添加扇、弓与新防具，发布后可在游戏和记录编辑器使用', async () => {
  const admin = await game.open();
  try {
    await admin.goto(new URL('admin.html?mute', game.url).href); await admin.waitForFunction(() => window.__admin);
    const content = admin.locator('#content');
    await admin.getByLabel('版本名称').fill('巾帼装备测试');
    await content.getByLabel('女性角色模板').selectOption('sun');
    await content.getByRole('button', { name: '添加角色模板' }).click();
    await content.getByRole('heading', { name: /孙尚香/ }).waitFor();
    let draft = await admin.evaluate(() => window.__admin.draft);
    assert.equal(draft.weapons[0].cat, '弓'); assert.equal(draft.armors[0].name, '锦鳞轻甲');
    await admin.getByRole('tab', { name: '新武器' }).click();
    await content.getByRole('button', { name: '＋ 新建武器' }).click();
    await content.getByLabel('名称', { exact: true }).fill('凤羽扇');
    await content.getByLabel('类型', { exact: true }).selectOption('扇');
    await content.getByLabel('攻击', { exact: true }).fill('12');
    await content.getByLabel('品级', { exact: true }).selectOption('5');
    await content.getByLabel('最低武力').fill('85');
    await content.getByLabel('限定购买武将').selectOption(['237']);
    await content.getByLabel('沿用图标').selectOption('b-fan');
    await content.getByAltText('武器图标预览').evaluate((img) => img.decode());
    await content.getByRole('checkbox', { name: '长安' }).check();
    await content.getByRole('button', { name: '应用修改' }).click();
    await admin.getByText('武器修改已应用到草稿').waitFor();
    await content.getByRole('button', { name: '不限武将' }).click();
    await content.getByRole('button', { name: '应用修改' }).click();
    assert.deepEqual((await admin.evaluate(() => window.__admin.draft.weapons.find((item) => item.name === '凤羽扇'))).requirements, { war: 85 });
    await content.getByLabel('限定购买武将').selectOption(['237']);
    await content.getByRole('button', { name: '应用修改' }).click();
    await admin.getByRole('tab', { name: '新防具' }).click();
    await content.getByRole('button', { name: '＋ 新建防具' }).click();
    await content.getByLabel('名称', { exact: true }).fill('锦绣女甲');
    await content.getByLabel('防御', { exact: true }).fill('12');
    await content.getByLabel('品级', { exact: true }).selectOption('4');
    await content.getByLabel('最低人德').fill('75');
    await content.getByLabel('防具图标').selectOption('b-female-armor');
    await content.getByAltText('防具图标预览').evaluate((img) => img.decode());
    await content.getByRole('checkbox', { name: '长安' }).check();
    await content.getByRole('button', { name: '应用修改' }).click();
    await admin.getByText('防具修改已应用到草稿').waitFor();
    draft = await admin.evaluate(() => window.__admin.draft);
    const fan = draft.weapons.find((item) => item.name === '凤羽扇'), armor = draft.armors.find((item) => item.name === '锦绣女甲');
    assert.equal(armor.id, fan.id + 1);
    assert.deepEqual([fan.grade, fan.requirements, armor.grade, armor.requirements], [5, { war: 85, officers: [237] }, 4, { virtue: 75 }]);
    await admin.getByRole('tab', { name: '人物与登场' }).click();
    await content.getByLabel('武器', { exact: true }).selectOption(String(fan.id));
    await content.getByLabel('防具', { exact: true }).selectOption(String(armor.id - 24));
    await content.getByRole('button', { name: '应用修改' }).click();
    await admin.getByText('人物修改已应用到草稿').waitFor();
    await admin.getByLabel('管理员令牌').fill(token); await admin.getByRole('button', { name: '发布新版本' }).click();
    await admin.getByText(/已发布“巾帼装备测试”/).waitFor();
    const id = await admin.evaluate(() => window.__admin.lastPublished);
    const player = await game.open('', { setup: (context) => context.addInitScript((version) => sessionStorage.setItem('haou-hd2d-scenario', version), id) });
    try {
      const result = await player.evaluate(({ armorId, fanId }) => {
        const { G } = window.__game, data = G.data(), game = G.newGame(4, 1, 5), actor = game.officers[237];
        game.cities[8].gold = 2000; actor.armor = 0;
        const denied = G.buyEquip(game, 8, 0, fanId), afterDenied = game.cities[8].gold;
        const bought = G.buyEquip(game, 8, 237, armorId); actor.status = G.SERVING; actor.loc = game.factions[game.player].city;
        game.cities[actor.loc].officers.push(237);
        return { weapon: data.equipment[actor.weapon].name, armor: data.equipment[24 + actor.armor].name, bought: bought.ok,
          denied: denied.msg, afterDenied, saved: G.save(game, 1) };
      }, { armorId: armor.id, fanId: fan.id });
      assert.deepEqual(result, { weapon: '凤羽扇', armor: '锦绣女甲', bought: true, denied: '凤羽扇：仅限孙尚香购买', afterDenied: 2000, saved: true });
      await player.goto(new URL('save-editor.html?mute', game.url).href); await player.waitForFunction(() => window.__editor?.g);
      await player.getByLabel('搜索武将').fill('孙尚香'); await player.locator('.rows button[data-id="237"]').click();
      await player.getByRole('button', { name: '锦鳞轻甲' }).click();
      assert.equal(await player.evaluate(() => window.__editor.g.officers[237].armor), 9);
      await player.getByRole('button', { name: '锦绣女甲' }).click();
      assert.equal(await player.evaluate(() => window.__editor.g.officers[237].armor), armor.id - 24);
      await player.getByRole('button', { name: '朱雀弓' }).click();
      assert.equal(await player.evaluate(() => window.__editor.g.officers[237].weapon), 32);
      assert.deepEqual(player.errors, []);
    } finally { await player.context().close(); }
    assert.deepEqual(admin.errors, []);
  } finally { await admin.context().close(); }
});

test('巾帼版本的战场商店显示品级与条件，符合条件后可购买', async () => {
  const player = await game.open('&flat', { setup: (context) => context.addInitScript(() => sessionStorage.setItem('haou-hd2d-scenario', 'builtin-female')) });
  try {
    await newCampaign(player);
    await player.evaluate(() => {
      const { g, debug } = window.__game, home = g.factions[g.player].city;
      const foe = g.cities.find((c) => c.faction !== g.player && g.factions[c.faction] && c.officers.length);
      g.officers[237].soldiers = 500; g.officers[237].war = 84;
      g.officers[foe.officers[0]].soldiers ||= 500;
      debug.fieldWar({ city: 15, from: home, attacker: g.player, defender: foe.faction, day: 1,
        att: { ids: [237], gold: 1000, rice: 400 }, def: { ids: [foe.officers[0]], gold: 0, rice: 400 } }, 'att');
    });
    await player.waitForFunction(() => window.__game.war?.finishDeploy && document.body.dataset.screen === 'war', null, { timeout: 30000 });
    const stop = closeMessages(player);
    try {
      await player.locator('.deploybtn .btn', { hasText: '布阵完成' }).click({ timeout: 30000 });
      await player.waitForFunction(() => { const f = window.__game.war.field; return f.turn === f.human && !document.querySelector('.banner, .panel.msg'); }, null, { timeout: 30000 });
    } finally { stop(); }
    await player.evaluate(() => {
      const { war } = window.__game, field = war.field, shop = field.villages.find((v) => v.kind === '武器店');
      const me = field.alive.find((unit) => unit.id === 237), there = field.unitAt(shop.x, shop.y);
      if (there && there !== me) {
        const free = [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [0, 2]].map(([dx, dy]) => [shop.x + dx, shop.y + dy]).find(([x, y]) => field.inside(x, y) && !field.unitAt(x, y));
        [there.x, there.y] = free;
      }
      [me.x, me.y] = [shop.x, shop.y]; war.clickCell(me.x, me.y);
    });
    const openShop = () => player.locator('.unitacts button, .unitpanel:not(.compare) button', { hasText: '武器店' }).click({ timeout: 15000 });
    await openShop();
    const row = player.locator('.modal .shop-row', { hasText: '落日弓' });
    assert.match(await row.textContent(), /落日弓 · 5级/);
    assert.match(await row.textContent(), /需武力85/);
    assert.equal(await row.isDisabled(), true);
    await player.locator('.modal .foot button', { hasText: '取消' }).click();
    await player.evaluate(() => { window.__game.g.officers[237].war = 85; });
    await openShop();
    assert.equal(await row.isEnabled(), true);
    await row.click(); await player.locator('.shade .btn.primary', { hasText: '确定' }).click();
    const after = await player.evaluate(() => ({ name: window.__game.G.data().equipment[window.__game.g.officers[237].weapon].name,
      gold: window.__game.war.field.chest('att').gold }));
    assert.deepEqual(after, { name: '落日弓', gold: 600 });
    assert.deepEqual(player.errors, []);
  } finally { await player.context().close(); }
});

test('无防具字段的旧草稿可先添加防具再添加武器并发布', async () => {
  const admin = await game.open();
  try {
    await admin.goto(new URL('admin.html?mute', game.url).href); await admin.waitForFunction(() => window.__admin);
    assert.equal(await admin.evaluate(() => Object.hasOwn(window.__admin.draft, 'armors')), false);
    const content = admin.locator('#content');
    await admin.getByLabel('版本名称').fill('旧草稿装备兼容');
    await admin.getByRole('tab', { name: '新防具' }).click();
    await content.getByRole('button', { name: '＋ 新建防具' }).click();
    await content.getByLabel('名称', { exact: true }).fill('绣甲');
    await content.getByLabel('防具图标').selectOption('b-female-armor');
    await content.getByRole('button', { name: '应用修改' }).click();
    await admin.getByText('防具修改已应用到草稿').waitFor();
    await admin.getByRole('tab', { name: '新武器' }).click();
    await content.getByRole('button', { name: '＋ 新建武器' }).click();
    await content.getByLabel('名称', { exact: true }).fill('新弓');
    await content.getByLabel('类型', { exact: true }).selectOption('弓');
    await content.getByLabel('沿用图标').selectOption('b-bow');
    await content.getByRole('button', { name: '应用修改' }).click();
    await admin.getByText('武器修改已应用到草稿').waitFor();
    await admin.getByRole('tab', { name: '人物与登场' }).click();
    await content.getByLabel('武器', { exact: true }).selectOption('33');
    await content.getByLabel('防具', { exact: true }).selectOption('8');
    await content.getByRole('button', { name: '应用修改' }).click();
    await admin.getByText('人物修改已应用到草稿').waitFor();
    await admin.getByLabel('管理员令牌').fill(token); await admin.getByRole('button', { name: '发布新版本' }).click();
    await admin.getByText(/已发布“旧草稿装备兼容”/).waitFor();
    const draft = await admin.evaluate(() => window.__admin.draft);
    assert.equal(draft.armors[0].id, 32); assert.equal(draft.weapons[0].id, 33);
    assert.equal(draft.officers.find((o) => o.id === 0).armor, 8);
    assert.equal(draft.officers.find((o) => o.id === 0).weapon, 33);
    assert.deepEqual(admin.errors, []);
  } finally { await admin.context().close(); }
});

test('上传人物图像、管理关系并发布额外君主供玩家开局', async () => {
  const admin = await game.open();
  try {
    await admin.goto(new URL('admin.html?mute', game.url).href); await admin.waitForFunction(() => window.__admin);
    const content = admin.locator('#content');
    await admin.getByLabel('版本名称').fill('新君主测试');
    await admin.getByRole('button', { name: /新建武将/ }).click();
    await content.getByLabel('姓名').fill('自定义君主');
    await content.getByLabel('登场方式').selectOption('initial'); await content.getByLabel('登场城市').selectOption('2');
    const upload = content.getByLabel('上传人物图片');
    await upload.setInputFiles({ name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
    await admin.getByText('无法读取图片，请选择有效的图片文件').waitFor();
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');
    await upload.setInputFiles({ name: 'portrait.png', mimeType: 'image/png', buffer: png });
    await admin.getByText('图片已准备，请应用人物修改').waitFor();
    assert.match(await content.getByAltText('人物图像预览').getAttribute('src'), /^data:image\/(webp|png);base64,/);
    await content.getByRole('button', { name: '应用修改' }).click();
    await admin.getByText('人物修改已应用到草稿').waitFor();

    await admin.getByRole('tab', { name: '人物关系' }).click();
    await content.getByText('原版没有内置人物关系；可在此添加。').waitFor();
    await content.getByLabel('人物', { exact: true }).selectOption('237');
    await content.getByLabel('关系', { exact: true }).selectOption('结义');
    await content.getByLabel('相关人物').selectOption('222');
    await content.getByRole('button', { name: '添加关系' }).click();
    await content.getByText('自定义君主 · 结义 · 刘备').waitFor();
    await content.getByLabel('搜索人物关系').fill('刘备');
    assert.match(await content.getByText(/当前关系/).textContent(), /1 条/);
    await content.getByLabel('搜索人物关系').fill('不存在');
    await content.getByText('没有符合条件的关系。').waitFor();
    await content.getByLabel('搜索人物关系').fill('');
    await content.getByLabel('人物', { exact: true }).selectOption('222');
    await content.getByLabel('相关人物').selectOption('237');
    await content.getByLabel('关系', { exact: true }).selectOption('结义');
    await content.getByRole('button', { name: '添加关系' }).click();
    await admin.getByText('这两人已有相同关系').waitFor();
    await content.getByLabel('人物', { exact: true }).selectOption('237');
    await content.getByLabel('相关人物').selectOption('38');
    await content.getByLabel('关系', { exact: true }).selectOption('兄弟');
    await content.getByRole('button', { name: '添加关系' }).click();
    await content.getByText('自定义君主 · 兄弟 · 关羽').waitFor();
    await content.getByLabel('人物', { exact: true }).selectOption('237');
    await content.getByLabel('相关人物').selectOption('173');
    await content.getByLabel('关系', { exact: true }).selectOption('__custom__');
    await content.getByLabel('自定义关系名称').fill('盟友');
    await content.getByRole('button', { name: '添加关系' }).click();
    await content.getByText('自定义君主 · 盟友 · 董卓').waitFor();
    await content.getByLabel('筛选关系类型').selectOption('盟友');
    assert.equal(await content.locator('.relation').count(), 1);

    await admin.getByRole('tab', { name: '君主候选' }).click();
    await content.getByLabel('所属势力').selectOption('4'); await content.getByLabel('候选武将').selectOption('237');
    await content.getByRole('button', { name: '添加君主候选' }).click();
    await content.getByText('自定义君主 · 刘备势力 · 并州').waitFor();
    await admin.getByLabel('管理员令牌').fill(token); await admin.getByRole('button', { name: '发布新版本' }).click();
    await admin.getByText(/已发布“新君主测试”/).waitFor({ timeout: 10000 });
    const id = await admin.evaluate(() => window.__admin.lastPublished);
    const published = await (await admin.request.get(new URL(`/api/versions/${id}`, game.url).href)).json();
    assert.deepEqual(published.rulers, [{ faction: 4, officer: 237 }]);
    const custom = published.officers.find((o) => o.id === 237).portraitData;
    assert.match(custom, /^data:image\/(webp|png);base64,/);
    assert.deepEqual(published.relations.map((r) => r.kind), ['结义', '兄弟', '盟友']);
    await admin.getByRole('button', { name: '载入为新草稿' }).click(); await admin.getByText('已载入新草稿').waitFor();
    await admin.getByRole('tab', { name: '人物与登场' }).click();
    await content.getByLabel('搜索武将').fill('自定义君主'); await content.getByRole('button', { name: /No\.237/ }).click();
    assert.equal(await content.getByAltText('人物图像预览').getAttribute('src'), custom);
    await content.getByLabel('人物图像').selectOption('38');
    assert.match(await content.getByAltText('人物图像预览').getAttribute('src'), /\/portraits\/38\.webp$/);
    await content.getByRole('button', { name: '应用修改' }).click();
    await admin.getByText('人物修改已应用到草稿').waitFor();
    assert.equal(await admin.evaluate(() => window.__admin.draft.officers.find((o) => o.id === 237).portraitData), undefined);

    const player = await game.open();
    try {
      await player.evaluate(async () => { (await import('./src/pace.js')).setPace(4); (await import('./src/vignette.js')).setVignettes(false); });
      await skipIntro(player); await player.click('.sysmenu-btn');
      await player.locator('.sysmenu-list button', { hasText: '游戏版本' }).click();
      await player.locator('.shade .slot', { hasText: '新君主测试' }).click();
      await player.waitForFunction((expected) => window.__game?.debug && window.__game.G.currentScenario() === expected, id, { timeout: 60000 });
      await skipIntro(player); await player.getByText('新的征程').click(); await player.locator('.level', { hasText: 'LEVEL 1' }).click();
      assert.equal(await player.locator('.ruler').count(), 8);
      const candidate = player.locator('.ruler', { hasText: '自定义君主' });
      assert.equal(await candidate.locator('img').first().getAttribute('src'), custom);
      await candidate.click(); await candidate.click(); await player.waitForFunction(() => document.body.dataset.screen === 'strategy');
      const stop = closeMessages(player, { aiTurns: true });
      try { await player.waitForFunction(() => { const g = window.__game.g; return g.current === g.player && !document.querySelector('.aiturn, .panel.msg'); }, null, { timeout: 90000 }); }
      finally { stop(); }
      const actual = await player.evaluate(() => {
        const { g, G } = window.__game, f = g.factions[g.player];
        const saved = G.save(g, 1), restored = G.load(1);
        return { ruler: f.ruler, city: f.city, first: g.cities[f.city].officers[0], loyalty: g.officers[237].loyalty,
          former: g.cities[2].officers.includes(222), saved, restored: restored?.factions[restored.player].ruler };
      });
      assert.deepEqual(actual, { ruler: 237, city: 2, first: 237, loyalty: 100, former: true, saved: true, restored: 237 });
      await player.click('.wikibtn'); await player.getByLabel('查找武将').fill('自定义君主');
      await player.locator('.wikitable tr[data-id="237"]').click(); await player.getByText(/结义 刘备/).waitFor();
      await player.getByText(/盟友 董卓/).waitFor();
      assert.equal(await player.locator('.ocard > img[alt="自定义君主"]').getAttribute('src'), custom);
      assert.deepEqual(player.errors, []);
    } finally { await player.context().close(); }
    assert.deepEqual(admin.errors, []);
  } finally { await admin.context().close(); }
});

test('人物图片无法解码时回退到已有立绘和表情', async () => {
  const page = await game.open();
  try {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');
    const damaged = `data:image/png;base64,${png.subarray(0, 33).toString('base64')}`;
    await page.evaluate(async (data) => {
      const { G } = window.__game, copy = structuredClone(G.data()); copy.officers[0].portraitData = data; G.setData(copy);
      const { face, figure } = await import('./src/ui.js');
      const row = document.createElement('div'); row.id = 'portrait-fallback-check'; row.append(face(0), face(0, '', 'angry'), figure(0)); document.body.append(row);
    }, damaged);
    await page.waitForFunction(() => [...document.querySelectorAll('#portrait-fallback-check img')].every((img) => img.complete && img.naturalWidth > 0 && !img.src.startsWith('data:')));
    const sources = await page.locator('#portrait-fallback-check img').evaluateAll((images) => images.map((img) => img.getAttribute('src')));
    assert.match(sources[0], /\/portraits\/0\.webp$/); assert.match(sources[1], /\/faces\/0-angry\.webp$/);
    assert.match(sources[2], /\/(halfbody|portraits)\/0\.webp$/);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
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
    const beforeRestore = await (await admin.request.get(new URL('/api/versions', game.url).href)).json();
    assert.ok(beforeRestore.some((v) => v.id === id) && beforeRestore.some((v) => v.id === revision));
    const importer = await admin.context().newPage();
    try {
      await importer.goto(new URL('admin.html?mute', game.url).href); await importer.waitForFunction(() => window.__admin);
      await importer.locator('#file').setInputFiles({ name: 'version.json', mimeType: 'application/json', buffer: exported });
      await importer.getByText(/版本已导入/).waitFor();
      await importer.getByLabel('管理员令牌').fill(token); await importer.getByRole('button', { name: '发布新版本' }).click();
      await importer.getByText(/已发布“群雄修订”/).waitFor({ timeout: 10000 });
      assert.equal(await importer.evaluate(() => window.__admin.lastPublished), revision);
      const versions = await (await importer.request.get(new URL('/api/versions', game.url).href)).json();
      assert.equal(versions.length, beforeRestore.length, 'restoring the same version is idempotent');
      assert.equal(versions.filter((v) => v.id === revision).length, 1);
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
        assert.match(await player.locator('.actpanel [data-sid="16"]').getAttribute('title'), /条件：5格内敌军/);
        await player.locator('.actpanel [data-sid="16"]').click();
        await player.locator(`.actpanel [data-target="${target}"]`).waitFor();
        const choosing = await player.evaluate(() => ({ id: window.__game.war.st.sel?.id, stage: window.__game.war.st.stage }));
        await player.keyboard.press(']');
        assert.deepEqual(await player.evaluate(() => ({ id: window.__game.war.st.sel?.id, stage: window.__game.war.st.stage })), choosing);
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

test('damaged versions are reported while healthy versions remain publishable and playable', async () => {
  const damaged = join(directory, `v-${'f'.repeat(32)}.json`);
  writeFileSync(damaged, '{broken');
  let bootPage;
  const admin = await game.open('', { setup: (context) => context.on('page', (page) => { bootPage = page; }) }).catch(async (error) => {
    const details = await bootPage?.evaluate(() => ({ ready: document.readyState, screen: document.body?.dataset.screen,
      stage: document.querySelector('#stage')?.children.length, game: typeof window.__game })).catch(() => null);
    throw new Error(`游戏启动失败: ${JSON.stringify({ details, errors: bootPage?.errors })}`, { cause: error });
  });
  try {
    await admin.goto(new URL('admin.html?mute', game.url).href); await admin.waitForFunction(() => window.__admin);
    const warning = admin.locator('#version-warning');
    await warning.waitFor();
    assert.match(await warning.textContent(), /有 1 个已发布版本无法读取/);
    await admin.getByRole('tab', { name: '新技能' }).click();
    await admin.getByRole('button', { name: /新建技能/ }).click();
    await admin.getByText(/目标为 5 格内敌将/).waitFor();
    await admin.getByLabel('版本名称').fill('损坏隔离验证');
    await admin.getByLabel('管理员令牌').fill(token);
    await admin.getByRole('button', { name: '发布新版本' }).click();
    await admin.getByText(/已发布“损坏隔离验证”/).waitFor();
    assert.equal(await warning.isVisible(), true, '发布成功提示不会覆盖损坏版本警告');
    const id = await admin.evaluate(() => window.__admin.lastPublished), player = await game.open();
    try {
      await skipIntro(player); await player.click('.sysmenu-btn');
      await player.locator('.sysmenu-list button', { hasText: '游戏版本' }).click();
      await player.getByText('有 1 个已发布版本无法读取，请联系管理员。').waitFor();
      await player.locator('.shade .slot', { hasText: '损坏隔离验证' }).click();
      await player.waitForFunction((expected) => window.__game?.debug && window.__game.G.currentScenario() === expected, id, { timeout: 60000 });
      assert.deepEqual(player.errors, []);
    } finally { await player.context().close(); }
    rmSync(damaged);
    await admin.reload(); await admin.waitForFunction(() => window.__admin);
    await admin.waitForFunction((expected) => [...document.querySelector('#published').options].some((option) => option.value === expected), id);
    assert.equal(await admin.locator('#version-warning').isHidden(), true);
    assert.deepEqual(admin.errors, []);
  } finally { rmSync(damaged, { force: true }); await admin.context().close(); }
});
