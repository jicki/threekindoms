import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeMessages, newCampaign, startGame } from './game.mjs';

let game;
before(async () => { game = await startGame({ scenario: 'original' }); });
after(() => game?.close());

async function enterField(page) {
  await newCampaign(page, '刘备');
  await page.evaluate(() => {
    const { g, debug } = window.__game;
    for (const id of [40, 43]) Object.assign(g.officers[id], { soldiers: 100, int: 60, level: 1 });
    const chest = id => ({ ids: [id], gold: 100, rice: 500 });
    debug.fieldWar({ city: 12, from: 8, attacker: 0, defender: 4, day: 1, att: chest(40), def: chest(43) }, 'att');
  });
  await page.getByRole('button', { name: '布阵完成' }).waitFor();
}

async function openField(page) {
  await enterField(page);
  const stop = closeMessages(page);
  try {
    await page.locator('.deploybtn .btn', { hasText: '布阵完成' }).click();
    await page.waitForFunction(() => window.__game.war?.myTurn && !document.querySelector('.banner,.shade,#fade.on'));
  } finally { stop(); }
  await page.evaluate(() => {
    const w = window.__game.war, f = w.field, [a] = f.side('att'), [d] = f.side('def');
    Object.assign(a, { x: 2, y: 3 }); Object.assign(d, { x: 3, y: 3 });
    f.map[3][2] = f.map[3][3] = 2; f.pool.att = 100;
    w.clickCell(a.x, a.y);
  });
}

for (const flat of [false, true]) {
  test(`原版${flat ? '平面使用历史手绘地图' : ' 3D 不下载历史手绘地图'}`, { timeout: 60000 }, async () => {
    const page = await game.open(flat ? '&flat' : '');
    const requests = [];
    page.on('request', req => {
      const path = new URL(req.url()).pathname;
      if (path.includes('/warground/maps/')) requests.push(path.split('/').at(-1));
    });
    try {
      await enterField(page);
      assert.equal(await page.evaluate(() => !!window.__game.war.flat), flat);
      if (flat) {
        assert.equal(requests[0], '12.json');
        assert.ok(requests.some(name => /^12-.*\.webp$/.test(name)));
      } else assert.deepEqual(requests, []);
      assert.deepEqual(page.errors, []);
    } finally { await page.context().close(); }
  });
}

test('首次白兵在冲锋时发起素材读取，仅加载实际出现的兵类，武将图片失败后进入布阵', { timeout: 60000 }, async () => {
  const png = [], closeups = [], ground = [];
  const page = await game.open('&flat', { setup: async ctx => {
    ctx.on('request', r => {
      if (/\/sprites\/troops\/.*\.png$/.test(r.url())) png.push(r.url());
      if (/\/sprites\/duel\/.*-(?:wheel|c)\.png$/.test(r.url())) closeups.push(r.url());
      if (r.url().endsWith('/tactical/wall-face.webp')) ground.push(r.url());
    });
    await ctx.route('**/sprites/duel/*.png', route => route.abort());
  } });
  try {
    assert.deepEqual(ground, [], '标题页不读取白兵地形');
    await openField(page);
    assert.equal(ground.length, 1, '进入战场后预取当地白兵地形');
    assert.equal(png.length, 0, '标题和行军未读取白兵兵队');
    const strike = await page.evaluate(() => {
      const w = window.__game.war; w.openAttacks(); return w.st.strike?.t.id;
    });
    assert.equal(strike, 43);
    await page.waitForTimeout(320); // 同一按键或快速点击不能确认攻击。
    await page.evaluate(() => { void window.__game.war.commitAttack().catch(e => { window.__cutInError = e.stack; }); });
    await page.waitForFunction(() => {
      if (window.__cutInError) throw new Error(window.__cutInError);
      return !!document.querySelector('.tq-formation');
    });
    assert.ok(png.some(url => /-soldier\.png$/.test(url)));
    assert.ok(png.length < 24, '不再无条件读取双方全部普通兵种帧表');
    assert.deepEqual(closeups, [], '打开白兵布阵前不下载单挑特写');
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('计策选中时预取对应图，图像卡住仍能结算', { timeout: 60000 }, async () => {
  let release, started;
  const held = new Promise(resolve => { release = resolve; });
  const request = new Promise(resolve => { started = resolve; });
  const page = await game.open('&flat', { setup: ctx => ctx.route('**/v2/st-fire/story.webp', async route => {
    started(); await held;
    await route.abort().catch(() => {});
  }) });
  try {
    await openField(page);
    await page.evaluate(() => { const w = window.__game.war; w.openStrategies(); w.chooseStrategy(0); });
    await request;
    assert.equal(await page.evaluate(() => window.__game.war.field.pool.att), 100);
    await page.evaluate(() => {
      const w = window.__game.war, f = w.field, [d] = f.side('def');
      f.r = () => 0;
      w.clickCell(d.x, d.y);
    });
    await page.waitForTimeout(320); // 选择目标后，由下一次输入确认施计。
    assert.equal(await page.evaluate(() => window.__game.war.commitCast()), true);
    await page.waitForFunction(() => window.__game.war.field.pool.att === 94, null, { timeout: 3000 });
    await page.waitForFunction(() => !!document.querySelector('.panel.msg'), null, { timeout: 4500 });
    assert.equal(await page.locator('.vig[data-scene="st-fire"]').count(), 0);
    assert.equal(await page.evaluate(() => window.__game.war.field.O(43).soldiers), 16);
    assert.deepEqual(page.errors, []);
  } finally { release(); await page.context().close(); }
});
