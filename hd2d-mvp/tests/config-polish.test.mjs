import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, newCampaign, closeMessages } from './game.mjs';

let game;
before(async () => { game = await startGame({ scenario: 'builtin-sovereigns-expanded-map', width: 1100, height: 800, touch: true }); });
after(() => game?.close());

async function deploy(page, { city = 12 } = {}) {
  await newCampaign(page, '刘备');
  await page.evaluate(async city => {
    const { g, G, debug } = window.__game;
    (await import('./src/pace.js')).setPace(4);
    const source = G.roads(city).find(id => id !== city);
    const own = [24, 38, 42], enemy = [51, 99, 111];
    for (const c of g.cities) c.officers = c.officers.filter(id => !own.includes(id) && !enemy.includes(id));
    for (const [id, faction, officers] of [[source, g.player, own], [city, (g.player + 1) % g.factions.length, enemy]]) {
      Object.assign(g.cities[id], { faction, officers, gold: 600, rice: 900 });
      for (const who of officers) Object.assign(g.officers[who], { status: G.SERVING, hp: 80, soldiers: 900, level: 5, int: 95 });
    }
    const w = debug.setupWar(g, { from: source, to: city, ids: own, commander: own[0], gold: 100, rice: 300 });
    debug.fieldWar(w, 'att').catch(e => { window.__testWarError = String(e.stack ?? e); });
  }, city);
  const stop = closeMessages(page);
  try {
    await page.waitForFunction(() => {
      if (window.__testWarError) throw new Error(window.__testWarError);
      return window.__game.war?.st.deploying && document.body.dataset.screen === 'war' && !document.querySelector('.banner, .panel.msg, #fade.on');
    }, null, { timeout: 60000 });
  } finally { stop(); }
}

test('无法创建 WebGL 时显示原因，重新加载后可正常打开游戏', async () => {
  const page = await game.open();
  try {
    await page.context().addInitScript(() => {
      if (sessionStorage.getItem('test-webgl-blocked')) return;
      sessionStorage.setItem('test-webgl-blocked', '1');
      const native = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...options) {
        return kind.startsWith('webgl') ? null : native.call(this, kind, ...options);
      };
    });
    await page.reload({ waitUntil: 'commit' });
    await page.getByRole('heading', { name: '无法启动显卡绘图' }).waitFor();
    assert.match(await page.locator('.boot-error p').textContent(), /硬件加速.*显卡驱动/);
    await page.getByRole('button', { name: '重新加载', exact: true }).click();
    await page.waitForFunction(() => window.__game?.debug?.renderer);
  } finally { await page.context().close(); }
});

test('手机折叠城池面板完整显示武将数和正规军数', async () => {
  const page = await game.open('&phone&flat');
  try {
    await page.setViewportSize({ width: 812, height: 375 });
    await newCampaign(page, '刘备');
    const panel = page.locator('.citypanel');
    await panel.locator('[data-k="正规军"]').waitFor();
    assert.deepEqual(await panel.evaluate(el => {
      const r = el.getBoundingClientRect();
      return ['武将', '正规军'].map(k => {
        const stat = el.querySelector(`[data-k="${k}"] b`), s = stat.getBoundingClientRect();
        return !!stat.textContent && s.height > 0 && s.bottom <= Math.min(innerHeight, r.bottom) && s.top >= r.top;
      });
    }), [true, true]);
    assert.equal(await panel.locator('.roster').isVisible(), false);
    await panel.locator('header h2').tap();
    await panel.locator('.roster').waitFor();
  } finally { await page.context().close(); }
});

test('人物志为七名武将分别加载新版立绘', { timeout: 90000 }, async () => {
  const page = await game.open('&phone&flat', {
    setup: ctx => ctx.addInitScript(() => localStorage.setItem('hd2d-talent', 'all')),
  });
  try {
    await page.setViewportSize({ width: 844, height: 390 });
    await newCampaign(page, '刘备');
    await page.locator('.wikibtn').click();
    for (const [id, name] of [[24, '郭嘉'], [75, '黄忠'], [100, '淳于琼'], [153, '张飞'], [169, '邓艾'], [206, '杨修'], [234, '吕蒙']]) {
      const dialog = page.getByRole('dialog', { name: '人物志', exact: true });
      await dialog.getByRole('searchbox', { name: '查找武将' }).fill(name);
      await dialog.locator(`tr[data-id="${id}"]`).click();
      const card = page.getByRole('dialog', { name, exact: true }), art = card.locator('.ocard > img');
      const dims = await art.evaluate(async img => { await img.decode(); return [img.naturalWidth, img.naturalHeight]; });
      assert.match(await art.getAttribute('src'), new RegExp(`/portrait-refresh/${id}\\.webp$`));
      assert.deepEqual(dims, [768, 1152]);
      await card.getByRole('button', { name: '关闭', exact: true }).click();
    }
    await page.evaluate(() => {
      const canvas = Object.assign(document.createElement('canvas'), { width: 40, height: 60 });
      window.__game.G.data().officers[24].portraitData = canvas.toDataURL('image/png');
    });
    await page.getByRole('searchbox', { name: '查找武将' }).fill('郭嘉');
    await page.locator('.wiki tr[data-id="24"]').click();
    const custom = page.getByRole('dialog', { name: '郭嘉', exact: true }).locator('.ocard > img');
    assert.match(await custom.getAttribute('src'), /^data:image\/png/);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('两军在四个开场角度均面向对手，郭嘉和关羽使用各自的新行军帧', { timeout: 90000 }, async () => {
  const page = await game.open('', { setup: ctx => ctx.addInitScript(() => localStorage.setItem('hd2d-war-view', '3d')) });
  try {
    const loaded = new Set();
    page.on('response', r => { if (r.ok()) loaded.add(new URL(r.url()).pathname); });
    await deploy(page);
    const angles = await page.evaluate(async () => {
      const w = window.__game.war, snapshots = [];
      for (let i = 0; i < 4; i++) {
        const probe = w.probe(), byId = Object.fromEntries(probe.units.map(u => [u.id, u]));
        snapshots.push({ yaw: probe.view.yaw, units: [w.field.side('att')[0], w.field.side('def')[0]].map(u => ({ ...byId[u.id], x: u.x, y: u.y })) });
        w.rotate(1);
        await new Promise(resolve => setTimeout(resolve, 450));
      }
      return snapshots;
    });
    assert.equal(new Set(angles.map(a => a.yaw.toFixed(2))).size, 4);
    for (const { yaw, units } of angles) for (const [i, u] of units.entries()) {
      const other = units[1 - i], [x, , z] = u.heading;
      assert.ok(x * (other.x - u.x) + z * (other.y - u.y) > 0);
      const horizontal = x * Math.cos(yaw) - z * Math.sin(yaw);
      const depth = x * Math.sin(yaw) + z * Math.cos(yaw);
      const angle = Math.atan2(Math.abs(horizontal), depth);
      const row = angle < 0.6 ? 'front' : angle > 2.55 ? 'back' : 'side';
      assert.equal(u.frame, `${row}_stand`);
      if (Math.abs(horizontal) > 0.08) assert.equal(u.flip, Math.sign(horizontal));
    }
    for (const file of ['guojia-motion.png', 'guanyu-march.png']) assert.ok([...loaded].some(path => path.endsWith('/portrait-refresh/' + file)));
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('计略以鼠标设定次数后，回车施展当时的次数', { timeout: 90000 }, async () => {
  const page = await game.open('&flat');
  try {
    await deploy(page);
    await page.evaluate(() => window.__game.war.finishDeploy());
    await page.waitForFunction(() => window.__game.war.field.turn === 'att' && !window.__game.war.st.busy);
    const expected = await page.evaluate(async () => {
      const { PLAIN, STRATS } = await import('./src/core/field.js');
      const w = window.__game.war, f = w.field, [me] = f.side('att'), [enemy] = f.side('def');
      const sites = [...Array(f.height).keys()].flatMap(y => [...Array(f.width - 1).keys()].map(x => [x, y]));
      const site = sites.find(([x, y]) => f.terr(x, y) === PLAIN && f.terr(x + 1, y) === PLAIN && !f.unitAt(x, y) && !f.unitAt(x + 1, y));
      if (!site) throw new Error('找不到可供火计测试的平原');
      [me.x, me.y] = site;
      [enemy.x, enemy.y] = [me.x + 1, me.y];
      f.pool.att = 30;
      w.clickCell(me.x, me.y); w.chooseStrategy(0); w.clickCell(enemy.x, enemy.y);
      return { day: f.day, cost: STRATS[0].cost };
    });
    const inc = page.getByRole('button', { name: '增加施放次数' });
    await inc.click();
    await page.waitForFunction(() => window.__game.war.st.confirm?.count === 2);
    assert.equal(await inc.evaluate(el => document.activeElement === el), true);
    await page.keyboard.press('Enter');
    await page.waitForFunction(({ cost, day }) => {
      const { field, st } = window.__game.war;
      return field.pool.att === 30 - 2 * cost && field.day === day && !st.confirm;
    }, expected, { timeout: 10000 }).catch(async error => {
      const state = await page.evaluate(() => {
        const { field, st } = window.__game.war;
        return { pool: field.pool.att, day: field.day, count: st.confirm?.count, busy: st.busy, log: field.log.slice(-3) };
      });
      throw new Error(JSON.stringify({ expected, state, errors: page.errors }), { cause: error });
    });
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

for (const flat of [true, false]) {
  test(`安卓平板的${flat ? '平面地图双指缩放及拖动' : '3D 地图 1.5 倍缩放档位'}`, { timeout: 90000 }, async () => {
    const page = await game.open('', { setup: ctx => ctx.addInitScript(flat => {
      Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Linux; Android 14; Tablet) Chrome/132 Safari/537.36' });
      if (!flat) localStorage.setItem('hd2d-war-view', '3d');
    }, flat) });
    try {
      assert.equal(await page.evaluate(() => window.__game.debug.quality.level), 'low');
      await deploy(page);
      assert.equal(await page.evaluate(() => !!window.__game.war.flat), flat);
      const cdp = await page.context().newCDPSession(page);
      const touch = (type, ax, bx, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: ax, y, id: 1 }, { x: bx, y, id: 2 }] });
      const sample = () => page.evaluate(flat => flat ? window.__game.war.screenOf(20, 13) : window.__game.war.probe().view.zoom, flat);
      if (!flat) await page.evaluate(() => window.__game.war.overview());
      const start = await sample();
      await touch('touchStart', 465, 565, 310);
      await touch('touchMove', 450, 580, 310);
      if (!flat) assert.equal(await sample(), start);
      await touch('touchMove', 436, 596, 310);
      if (flat) await page.waitForFunction(cw => window.__game.war.screenOf(20, 13).cw >= cw * 1.59, start.cw);
      else await page.waitForFunction(() => window.__game.war.probe().view.zoom === 'far');
      const zoomed = await sample();
      if (flat) {
        assert.ok(zoomed.cw > start.cw * 1.1, JSON.stringify({ start, zoomed }));
        await touch('touchMove', 475, 635, 351);
        await page.waitForFunction(({ x,y,cw }) => {
          const now = window.__game.war.screenOf(20, 13);
          return Math.abs(now.cw - cw) < 0.05 && now.x - x > 25 && now.y - y > 25;
        }, zoomed);
      } else {
        assert.equal(zoomed, 'far');
        await touch('touchMove', 421, 611, 310);
        await touch('touchEnd');
        assert.equal(await sample(), 'far');
      }
      if (flat) await touch('touchEnd');
      assert.deepEqual(page.errors, []);
    } finally { await page.context().close(); }
  });
}
