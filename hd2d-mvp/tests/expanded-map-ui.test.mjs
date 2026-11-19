import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, skipIntro, closeMessages, cmd, tapFakePad } from './game.mjs';

let game;
before(async () => { game = await startGame({ width: 812, height: 375 }); });
after(async () => { await game?.close(); });

const setup = (ctx) => ctx.addInitScript(() => {
  if (!sessionStorage.getItem('haou-hd2d-scenario')) sessionStorage.setItem('haou-hd2d-scenario', 'builtin-sovereigns-expanded-map');
});
async function waitScenario(page, id, screen = 'title') {
  await page.waitForFunction(({ id, screen }) => window.__game?.G.currentScenario() === id && document.body.dataset.screen === screen,
    { id, screen }, { timeout: 60000 });
}

test('君主列传的新征程使用扩展地图，并保留当前版本已有记录', async () => {
  const page = await game.open('&flat&phone', { setup });
  try {
    await skipIntro(page);
    const oldRecord = await page.evaluate(() => {
      const g = window.__game.G.newGame(4, 1, 5); g.year = 195; window.__game.G.save(g, 1);
      return localStorage.getItem('haou-hd2d-save:scenario:builtin-sovereigns-expanded-map:1');
    });
    assert.equal(await page.locator('.map-choice').count(), 0);
    assert.equal(await page.getByText('本游戏免费发布').count(), 0);
    assert.equal(await page.getByText('制作 tianlin', { exact: false }).count(), 0);
    await page.getByText('新的征程').click();
    await waitScenario(page, 'builtin-sovereigns-expanded-map', 'setup');
    assert.equal(await page.evaluate(() => window.__game.G.data().cities.length), 39);
    assert.equal(await page.locator('.setup-map button').count(), 0);
    assert.ok(await page.locator('.ruler').count() >= 10);
    assert.equal(await page.evaluate(() => localStorage.getItem('haou-hd2d-save:scenario:builtin-sovereigns-expanded-map:1')), oldRecord);
    const restored = await game.open('&flat&phone', { save: oldRecord });
    try {
      await waitScenario(restored, 'builtin-sovereigns-expanded-map'); await skipIntro(restored);
      assert.equal(await restored.getByRole('button', { name: /继续记录/ }).count(), 1);
      assert.deepEqual(restored.errors, []);
    } finally { await restored.context().close(); }
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('手机读取旧的 37 据点记录时显示两个新据点且不重置原有资源', async () => {
  const page = await game.open('&flat&phone', { setup: (ctx) => ctx.addInitScript(() => {
    sessionStorage.setItem('haou-hd2d-scenario', 'builtin-sovereigns-expanded-map');
  }) });
  try {
    await page.evaluate(() => {
      const { G } = window.__game, g = G.newGame(4, 1, 12);
      g.cities.splice(37); delete g.frontierMap; delete g.battleRulerPassives; g.cities[13].gold = 123;
      g.turnIdx = G.data().rules.turn_orders[g.order].indexOf(g.player); g.current = g.player; g.books = G.books(g, g.player);
      if (!G.save(g, 1)) throw new Error('无法保存旧地图测试记录');
      sessionStorage.setItem('hd2d-title-seen', '1');
    });
    await page.reload(); await waitScenario(page, 'builtin-sovereigns-expanded-map'); await skipIntro(page);
    await page.getByText('继续记录').click();
    await page.waitForFunction(() => document.body.dataset.screen === 'strategy' && window.__game.g?.current === window.__game.g.player);
    assert.deepEqual(await page.evaluate(() => ({ count: window.__game.g.cities.length, gold: window.__game.g.cities[13].gold,
      owners: [37, 38].map((id) => window.__game.g.cities[id].faction), none: window.__game.G.NONE,
      battle: window.__game.g.battleRulerPassives ?? null })),
    { count: 39, gold: 123, owners: [10, 10], none: 10, battle: null });
    for (const label of ['望垣峡', '夷洲']) assert.equal(await page.locator('.ctag').filter({ hasText: label }).count(), 1);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('旧版会话转到新版，但旧存档数据不被覆盖', async () => {
  const page = await game.open('&flat&phone', { setup: (context) => context.addInitScript(() => {
    sessionStorage.setItem('haou-hd2d-scenario', 'builtin-warlords');
    localStorage.setItem('haou-hd2d-save:scenario:builtin-warlords:1', '{"example":"preserved"}');
  }) });
  try {
    await waitScenario(page, 'builtin-sovereigns-expanded-map'); await skipIntro(page);
    assert.equal(await page.evaluate(() => window.__game.G.data().cities.length), 39);
    assert.equal(await page.getByText('继续记录').count(), 0);
    assert.equal(await page.evaluate(() => localStorage.getItem('haou-hd2d-save:scenario:builtin-warlords:1')), '{"example":"preserved"}');
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('新会话默认君主列传，隐藏标准地图入口且可显式切换并保留原版', async () => {
  const page = await game.open('&flat&phone', { setup: (ctx) => ctx.addInitScript(() => {
    localStorage.setItem('haou-hd2d-save:scenario:builtin-sovereigns:1', '{"example":"standard-preserved"}');
  }) });
  try {
    await waitScenario(page, 'builtin-sovereigns-expanded-map'); await skipIntro(page);
    assert.equal(await page.getByRole('button', { name: '读取标准地图记录' }).count(), 0);
    await page.locator('.sysmenu-btn').click(); await page.getByRole('tab', { name: '其他' }).click();
    await page.locator('.sysmenu-list button', { hasText: '游戏版本' }).click();
    await page.getByRole('button', { name: /^原版/ }).click();
    await waitScenario(page, 'original'); await skipIntro(page);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('haou-hd2d-scenario')), 'original');
    await page.evaluate(() => { const { G } = window.__game; const g = G.newGame(4, 1, 5); g.year = 195; G.save(g, 1); });
    await page.reload(); await waitScenario(page, 'original'); await skipIntro(page);
    assert.equal(await page.getByRole('button', { name: /继续记录/ }).count(), 1);
    const original = await page.evaluate(() => localStorage.getItem('haou-hd2d-save:1'));
    await page.locator('.sysmenu-btn').click(); await page.getByRole('tab', { name: '其他' }).click();
    await page.locator('.sysmenu-list button', { hasText: '游戏版本' }).click();
    await page.getByRole('button', { name: /群英新篇·君主列传/ }).click();
    await waitScenario(page, 'builtin-sovereigns-expanded-map'); await skipIntro(page);
    assert.equal(await page.getByRole('button', { name: '读取标准地图记录' }).count(), 0);
    assert.equal(await page.evaluate(() => localStorage.getItem('haou-hd2d-save:1')), original);
    assert.equal(await page.evaluate(() => localStorage.getItem('haou-hd2d-save:scenario:builtin-sovereigns:1')), '{"example":"standard-preserved"}');
    await page.evaluate(() => sessionStorage.setItem('haou-hd2d-scenario', 'builtin-sovereigns'));
    await page.reload(); await waitScenario(page, 'builtin-sovereigns-expanded-map'); await skipIntro(page);
    assert.equal(await page.getByRole('button', { name: '读取标准地图记录' }).count(), 0);
    assert.equal(await page.evaluate(() => localStorage.getItem('haou-hd2d-save:1')), original);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('手机地图可点选关隘、切换简洁视图及势力图层', async () => {
  const page = await game.open('&flat&phone', { setup: async (ctx) => {
    await ctx.addInitScript(() => {
      if (!sessionStorage.getItem('haou-hd2d-scenario')) sessionStorage.setItem('haou-hd2d-scenario', 'builtin-sovereigns-expanded-map');
    });
  } });
  try {
    await page.evaluate(() => {
      const { G } = window.__game, g = G.newGame(4, 1, 12);
      g.turnIdx = G.data().rules.turn_orders[g.order].indexOf(g.player); g.current = g.player; g.books = G.books(g, g.player);
      G.save(g, 1); sessionStorage.setItem('hd2d-title-seen', '1');
    });
    await page.reload(); await waitScenario(page, 'builtin-sovereigns-expanded-map'); await skipIntro(page);
    await page.getByText('继续记录').click();
    await page.waitForFunction(() => document.body.dataset.screen === 'strategy' && window.__game.g?.current === window.__game.g.player);
    await page.evaluate(() => window.__game.strategy.focusCity(35));
    await page.waitForTimeout(1500);
    const tag = page.locator('.ctag').filter({ hasText: '武关' }), box = await tag.boundingBox();
    assert.ok(box, '关隘标签应位于可触控的地图上');
    const leader = await tag.evaluate((element) => {
      const style = getComputedStyle(element, '::after'); return [style.left, style.top, style.height];
    });
    assert.ok(leader.every((value) => Number.isFinite(parseFloat(value))), '标签指引线应能正常渲染');
    const touch = await page.context().newCDPSession(page);
    await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.locator('.citypanel header').filter({ hasText: '武关' }).waitFor();
    assert.match(await page.locator('.citypanel header').innerText(), /武关[\s\S]*关隘/);
    assert.match(await page.locator('.pass-note').innerText(), /不计城数/);
    assert.match(await page.locator('.pass-note').innerText(), /预备兵被动不生效/);
    for (const [id, label] of [[34, '函谷关'], [37, '望垣峡'], [38, '夷洲'], [30, '襄阳'], [32, '宛城']]) {
      await page.evaluate((city) => window.__game.strategy.focusCity(city), id);
      await page.waitForTimeout(1500);
      const point = await page.locator('.ctag').filter({ hasText: label }).boundingBox();
      assert.ok(point, `${label}应有触控标签`);
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x + point.width / 2, y: point.y + point.height / 2 }] });
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.locator('.citypanel header').filter({ hasText: label }).waitFor();
      if (id === 34 || id === 37) assert.match(await page.locator('.pass-note').innerText(), /不计城数/);
      else assert.equal(await page.locator('.pass-note').count(), 0);
    }
    await page.locator('.mapfocusbtn').click();
    assert.equal(await page.locator('.mapfocusbtn').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('.citypanel .stats').isVisible(), false);
    await page.locator('.mapfocusbtn').click();
    assert.equal(await page.locator('.citypanel .stats').isVisible(), true);
    await page.locator('.terrbtn').click();
    assert.equal(await page.locator('.terrbtn').getAttribute('aria-pressed'), 'true');
    await page.locator('.sysmenu-btn').click();
    await page.getByRole('tab', { name: '画面' }).click();
    await page.getByRole('menuitem', { name: '城池与关隘总览' }).click();
    await page.getByLabel('筛选据点').selectOption('neutral');
    assert.equal(await page.locator('.map-overview-list .btn').filter({ hasText: '并州' }).count(), 0);
    await page.locator('.map-overview-list .btn').filter({ hasText: '宛城' }).click();
    assert.match(await page.locator('.citypanel header').innerText(), /宛城/);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('扩展平面地图的新城会染色，关隘不生成城市势力范围', async () => {
  const page = await game.open('&flat&phone', { setup: (ctx) => ctx.addInitScript(() => {
    if (!sessionStorage.getItem('haou-hd2d-scenario')) sessionStorage.setItem('haou-hd2d-scenario', 'builtin-sovereigns-expanded-map');
  }) });
  try {
    await page.evaluate(() => {
      const { G } = window.__game, g = G.newGame(4, 1, 12);
      g.turnIdx = G.data().rules.turn_orders[g.order].indexOf(g.player); g.current = g.player; g.books = G.books(g, g.player);
      G.save(g, 1); sessionStorage.setItem('hd2d-title-seen', '1');
    });
    await page.reload(); await waitScenario(page, 'builtin-sovereigns-expanded-map'); await skipIntro(page);
    await page.getByText('继续记录').click();
    await page.waitForFunction(() => document.body.dataset.screen === 'strategy' && window.__game.g?.current === window.__game.g.player && window.__game.strategy.up);
    const changed = await page.evaluate(() => {
      const { g, G, strategy: s } = window.__game, neutral = g.cities.map((c) => ({ ...c, faction: G.NONE }));
      const u = s.debugUnder(), snap = new OffscreenCanvas(u.width, u.height), sg = snap.getContext('2d', { alpha: false, willReadFrequently: true });
      const take = () => { s.update(0); sg.drawImage(u, 0, 0); return sg.getImageData(0, 0, u.width, u.height).data; };
      const compare = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++; return n; };
      s.refresh({ ...g, cities: neutral }); s.territory(true);
      const before = take();
      s.refresh({ ...g, cities: neutral.map((c) => c.id === 30 ? { ...c, faction: g.player } : c) });
      const city = take();
      s.refresh({ ...g, cities: neutral.map((c) => c.id === 33 ? { ...c, faction: g.player } : c) });
      const gate = take();
      return { city: compare(before, city), gate: compare(before, gate) };
    });
    assert.ok(changed.city > 100, `新城应显示所属势力：${JSON.stringify(changed)}`);
    assert.equal(changed.gate, 0, '关隘不应染色附近土地');
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('外交目标列表包含敌方关隘的驻军', async () => {
  const page = await game.open('&flat&phone', { setup: (ctx) => ctx.addInitScript(() => {
    if (!sessionStorage.getItem('haou-hd2d-scenario')) sessionStorage.setItem('haou-hd2d-scenario', 'builtin-sovereigns-expanded-map');
  }) });
  try {
    const guard = await page.evaluate(() => {
      const { G } = window.__game, g = G.newGame(4, 1, 12);
      const source = g.cities.find((c) => c.faction !== G.NONE && c.faction !== g.player && c.officers.length > 1
        && c.officers.some((id) => id !== g.factions[c.faction].ruler));
      const id = source.officers.find((x) => x !== g.factions[source.faction].ruler);
      source.officers = source.officers.filter((x) => x !== id);
      Object.assign(g.cities[33], { faction: source.faction, officers: [id] });
      g.turnIdx = G.data().rules.turn_orders[g.order].indexOf(g.player); g.current = g.player; g.books = G.books(g, g.player);
      G.save(g, 1); sessionStorage.setItem('hd2d-title-seen', '1'); return id;
    });
    await page.reload(); await waitScenario(page, 'builtin-sovereigns-expanded-map'); await skipIntro(page);
    await page.getByText('继续记录').click();
    await page.waitForFunction(() => document.body.dataset.screen === 'strategy' && window.__game.g?.current === window.__game.g.player);
    await cmd(page, '外交', '离间');
    const group = page.locator('.otree details.tc').filter({ has: page.locator(`tr[data-id="${guard}"]`) });
    assert.match(await group.locator('summary').innerText(), /虎牢关/);
    if (!(await group.evaluate((el) => el.open))) await group.locator('summary').click();
    assert.equal(await group.locator(`tr[data-id="${guard}"]`).isVisible(), true);
    await group.locator(`tr[data-id="${guard}"]`).click();
    await page.getByText('派谁执行？').waitFor();
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('最后一城只有一名武将时，移动与出阵均提示不能撤空到关隘', async () => {
  const page = await game.open('&flat&phone', { setup: (ctx) => ctx.addInitScript(() => {
    if (!sessionStorage.getItem('haou-hd2d-scenario')) sessionStorage.setItem('haou-hd2d-scenario', 'builtin-sovereigns-expanded-map');
  }) });
  try {
    await page.evaluate(() => {
      const { G } = window.__game, g = G.newGame(8, 1, 12), city = g.cities[g.factions[g.player].city], ruler = g.factions[g.player].ruler;
      for (const id of city.officers.filter((x) => x !== ruler)) { g.officers[id].status = G.RONIN; g.officers[id].loc = city.id; }
      city.officers = [ruler];
      g.turnIdx = G.data().rules.turn_orders[g.order].indexOf(g.player); g.current = g.player; g.books = G.books(g, g.player);
      G.save(g, 1); sessionStorage.setItem('hd2d-title-seen', '1');
    });
    await page.reload(); await waitScenario(page, 'builtin-sovereigns-expanded-map'); await skipIntro(page);
    await page.getByText('继续记录').click();
    await page.waitForFunction(() => document.body.dataset.screen === 'strategy' && window.__game.g?.current === window.__game.g.player);
    for (const [group, action] of [['城', '移动'], ['军', '出阵']]) {
      await cmd(page, group, action);
      await page.locator('.mappick .chips .btn').filter({ hasText: '武关' }).click();
      await page.locator('.toast').filter({ hasText: '最后一座城市留守' }).last().waitFor();
      assert.equal(await page.locator('.mappick').count(), 0);
      assert.equal(await page.evaluate(() => window.__game.g.cities[13].officers.length), 1);
      assert.equal(await page.evaluate(() => window.__game.g.cities[35].faction), await page.evaluate(() => window.__game.G.NONE));
    }
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('出阵列表不跨越襄阳和宛城，占领襄阳后可继续进攻衡阳', async () => {
  for (const { player, source, allowed, forbidden } of [
    { player: 8, source: 13, allowed: '襄阳', forbidden: '衡阳' },
    { player: 8, source: 30, allowed: '衡阳', forbidden: null },
    { player: 0, source: 12, allowed: '宛城', forbidden: '荆州' },
  ]) {
    const page = await game.open('&flat&phone', { setup });
    try {
      await page.evaluate(({ player, source }) => {
        const { G } = window.__game, g = G.newGame(player, 1, 12);
        if (source === 30) {
          const origin = g.cities[13], target = g.cities[30];
          target.officers = [...origin.officers]; target.faction = player;
          origin.officers = []; origin.faction = G.NONE;
        }
        g.factions[player].city = source;
        g.turnIdx = G.data().rules.turn_orders[g.order].indexOf(player); g.current = player; g.books = G.books(g, player);
        G.save(g, 1); sessionStorage.setItem('hd2d-title-seen', '1');
      }, { player, source });
      await page.reload(); await waitScenario(page, 'builtin-sovereigns-expanded-map'); await skipIntro(page);
      await page.getByText('继续记录').click();
      await page.waitForFunction(() => document.body.dataset.screen === 'strategy' && window.__game.g?.current === window.__game.g.player);
      await cmd(page, '军', '出阵');
      const names = await page.locator('.mappick .chips .btn').allInnerTexts();
      assert.ok(names.some((name) => name.includes(allowed)), `${source} 应能进攻${allowed}：${names}`);
      if (forbidden) assert.ok(names.every((name) => !name.includes(forbidden)), `${source} 不应越城进攻${forbidden}：${names}`);
      assert.deepEqual(page.errors, []);
    } finally { await page.context().close(); }
  }
});

test('玩家诱纳敌方最后一城的守将后，立即结算关隘势力灭亡', async () => {
  const page = await game.open('&flat&phone', { setup: (ctx) => ctx.addInitScript(() => {
    if (!sessionStorage.getItem('haou-hd2d-scenario')) sessionStorage.setItem('haou-hd2d-scenario', 'builtin-sovereigns-expanded-map');
  }) });
  try {
    const { guard, actor } = await page.evaluate(() => {
      const { G } = window.__game, g = G.newGame(4, 1, 12), f = 8, city = g.cities[13], ruler = g.factions[f].ruler;
      const guard = city.officers.find((id) => id !== ruler);
      Object.assign(g.cities[35], { faction: f, officers: city.officers.filter((id) => id !== guard) });
      city.officers = [guard]; g.factions[f].city = 35; g.officers[guard].loyalty = 0;
      const actor = g.cities[g.factions[g.player].city].officers[0]; Object.assign(g.officers[actor], { int: 99, virtue: 99, level: 5 });
      g.turnIdx = G.data().rules.turn_orders[g.order].indexOf(g.player); g.current = g.player; g.books = G.books(g, g.player);
      G.save(g, 1); sessionStorage.setItem('hd2d-title-seen', '1'); return { guard, actor };
    });
    await page.reload(); await waitScenario(page, 'builtin-sovereigns-expanded-map'); await skipIntro(page);
    await page.getByText('继续记录').click();
    await page.waitForFunction(() => document.body.dataset.screen === 'strategy' && window.__game.g?.current === window.__game.g.player);
    await page.evaluate(() => { window.__game.g.seed = 7; });
    await cmd(page, '外交', '诱纳');
    await page.locator(`.shade tr[data-id="${guard}"]`).first().click({ force: true });
    await page.locator(`.shade tr[data-id="${actor}"]`).first().click({ force: true });
    await page.locator('.shade .btn.primary').last().click();
    const stopMessages = closeMessages(page);
    const skip = setInterval(() => page.keyboard.press('Escape').catch(() => {}), 250).unref();
    try {
      await page.waitForFunction(() => window.__game.g.factions[8].ruler == null, null, { timeout: 30000 });
      assert.equal(await page.evaluate(() => window.__game.g.cities[35].faction), await page.evaluate(() => window.__game.G.NONE));
      assert.equal(await page.evaluate((id) => window.__game.G.factionOf(window.__game.g, id), guard), 4);
    } finally { clearInterval(skip); stopMessages(); }
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('手柄在己方城市和关隘之间循环选择', async () => {
  const desktop = await startGame({ width: 1280, height: 800 });
  try {
    const page = await desktop.open('&flat', { setup: (ctx) => ctx.addInitScript(() => {
      if (!sessionStorage.getItem('haou-hd2d-scenario')) sessionStorage.setItem('haou-hd2d-scenario', 'builtin-sovereigns-expanded-map');
      const pad = { id: 'Xbox Wireless Controller', index: 0, mapping: 'standard', connected: true, timestamp: 0,
        axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
      Object.defineProperty(navigator, 'getGamepads', { value: () => [pad, null, null, null] });
      window.__fakePad = { set(i, on) { pad.buttons[i] = { pressed: on, touched: on, value: on ? 1 : 0 }; pad.timestamp = performance.now(); } };
    }) });
    await page.evaluate(() => {
      const { G } = window.__game, g = G.newGame(4, 1, 12), home = g.cities[g.factions[g.player].city];
      const id = home.officers.find((x) => x !== g.factions[g.player].ruler);
      home.officers = home.officers.filter((x) => x !== id); Object.assign(g.cities[35], { faction: g.player, officers: [id] });
      g.turnIdx = G.data().rules.turn_orders[g.order].indexOf(g.player); g.current = g.player; g.books = G.books(g, g.player);
      G.save(g, 1); sessionStorage.setItem('hd2d-title-seen', '1');
    });
    await page.reload(); await skipIntro(page); await page.getByText('继续记录').click();
    await page.waitForFunction(() => document.body.dataset.screen === 'strategy' && window.__game.g?.current === window.__game.g.player);
    await page.waitForTimeout(1200);
    await tapFakePad(page, 1, 350); // 关闭城市面板，再以 RB 循环到下一个己方据点。
    await tapFakePad(page, 5, 350);
    assert.equal(await page.evaluate(() => window.__game.pad.state.cur.cid), 35);
    assert.match(await page.locator('.citypanel header').innerText(), /武关/);
    assert.deepEqual(page.errors, []);
  } finally { await desktop.close(); }
});

test('桌面三维地图显示新增据点，并能打开道路和势力图层', async () => {
  const desktop = await startGame({ width: 1280, height: 800 });
  try {
    const page = await desktop.open('', { setup: (ctx) => ctx.addInitScript(() => {
      if (!sessionStorage.getItem('haou-hd2d-scenario')) sessionStorage.setItem('haou-hd2d-scenario', 'builtin-sovereigns-expanded-map');
    }) });
    await page.evaluate(() => {
      const { G } = window.__game, g = G.newGame(2, 1, 12);
      g.turnIdx = G.data().rules.turn_orders[g.order].indexOf(g.player); g.current = g.player; g.books = G.books(g, g.player);
      G.save(g, 1); sessionStorage.setItem('hd2d-title-seen', '1');
    });
    await page.reload(); await waitScenario(page, 'builtin-sovereigns-expanded-map'); await skipIntro(page);
    await page.getByText('继续记录').click();
    await page.waitForFunction(() => document.body.dataset.screen === 'strategy' && window.__game.g?.current === window.__game.g.player);
    assert.equal(await page.evaluate(() => window.__game.strategy.kind), '3d');
    assert.equal(await page.locator('.ctag').count(), 39);
    await page.locator('.roadsbtn').click(); await page.locator('.terrbtn').click();
    assert.equal(await page.locator('.roadsbtn').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('.terrbtn').getAttribute('aria-pressed'), 'true');
    await page.evaluate(() => window.__game.strategy.focusCity(30));
    await page.waitForTimeout(1000);
    const pt = await page.evaluate(() => window.__game.strategy.screenOfCity(30));
    assert.ok(Number.isFinite(pt.x) && Number.isFinite(pt.y));
    await page.evaluate(() => window.__game.strategy.returnTo(13, { kind: '3d', yaw: 0.12, bias: 0, dist: 20 }));
    await page.waitForTimeout(1500);
    const positions = await page.evaluate(() => {
      const s = window.__game.strategy, ids = [8, 12, 13, 21, 30, 32, 34, 35];
      return Object.fromEntries(ids.map((id) => [id, s.screenOfCity(id)]));
    });
    const gap = (a, b) => Math.hypot(positions[a].x - positions[b].x, positions[a].y - positions[b].y);
    assert.ok(gap(30, 13) > 70 && gap(30, 21) > 75, '襄阳与新野、荆州应有可见间距');
    assert.ok(gap(32, 12) > 85 && gap(32, 13) > 120, '宛城与洛阳、新野应有可见间距');
    assert.ok(gap(34, 35) > 90 && gap(35, 8) > 75 && gap(35, 30) > 65, '函谷关、武关与邻近据点应有可见间距');
    const labels = await page.evaluate(() => [12, 13, 21, 30, 32, 33, 34, 35].map((id) => {
      const rect = window.__game.strategy.tagOf(id).getBoundingClientRect();
      return { id, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    }));
    for (const [i, a] of labels.entries()) for (const b of labels.slice(i + 1)) {
      assert.ok(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1,
        `洛阳附近的标签 ${a.id} 和 ${b.id} 不应重叠`);
    }
    for (const label of ['襄阳', '宛城', '函谷关', '武关']) {
      await page.locator('.ctag').filter({ hasText: label }).click();
      await page.locator('.citypanel header').filter({ hasText: label }).waitFor();
      await page.waitForTimeout(250);
    }
    for (const [id, label] of [[37, '望垣峡'], [38, '夷洲']]) {
      await page.evaluate((city) => window.__game.strategy.returnTo(city, { kind: '3d', yaw: 0.12, bias: 0, dist: 24 }), id);
      await page.waitForTimeout(1500);
      await page.locator('.ctag').filter({ hasText: label }).click();
      await page.locator('.citypanel header').filter({ hasText: label }).waitFor();
      const pos = await page.evaluate((city) => window.__game.strategy.screenOfCity(city), id);
      assert.ok(Number.isFinite(pos.x) && Number.isFinite(pos.y));
      await page.waitForTimeout(250);
    }
    await page.evaluate(() => {
      const { g, debug } = window.__game, city = g.cities[12], guard = city.officers.find((id) => id !== g.factions[city.faction].ruler);
      city.officers = city.officers.filter((id) => id !== guard);
      Object.assign(g.cities[33], { faction: city.faction, officers: [guard], gold: 0, rice: 300 });
      const source = g.cities[11], ids = source.officers.filter((id) => id !== g.factions[g.player].ruler).slice(0, 2);
      source.gold = 500; source.rice = 500;
      for (const id of [...ids, guard]) g.officers[id].soldiers = 600;
      const war = debug.setupWar(g, { from: 11, to: 33, ids, commander: ids[0], gold: 100, rice: 300 });
      debug.fieldWar(war, 'att');
    });
    await page.waitForFunction(() => document.body.dataset.screen === 'war' && window.__game.war?.finishDeploy, null, { timeout: 30000 });
    const stop = closeMessages(page);
    try {
      await page.waitForTimeout(2500);
      await page.evaluate(() => { if (window.__game.war.st.deploying) window.__game.war.finishDeploy(); });
      await page.waitForFunction(() => { const w = window.__game.war; return w?.field.turn === w?.field.human && !w.st.busy && !w.st.deploying && !document.querySelector('.banner, .panel.msg, .shade, #fade.on'); }, null, { timeout: 30000 });
      assert.equal(await page.evaluate(() => window.__game.war.field.war.city), 33);
      await page.evaluate(() => { const w = window.__game.war; w.field.end('def', 'castle'); w.endTurn(); });
      await page.locator('.result').waitFor({ timeout: 30000 });
      assert.match(await page.locator('.result').innerText(), /虎牢关/);
      await page.locator('.btn', { hasText: '返回大地图' }).click();
      await page.waitForFunction(() => document.body.dataset.screen === 'strategy' && !document.querySelector('.shade'), null, { timeout: 30000 });
      assert.equal(await page.evaluate(() => window.__game.g.cities[33].faction), 2);
      assert.equal(await page.evaluate(() => window.__game.g.cities[12].faction), 0);
    } finally { stop(); }
    assert.deepEqual(page.errors, []);
    // 沙盘素材不可用时，扩展地图也能回退到程序地形和势力图层。
    const proc = await desktop.open('&board=proc', { setup: (ctx) => ctx.addInitScript(() => {
      if (!sessionStorage.getItem('haou-hd2d-scenario')) sessionStorage.setItem('haou-hd2d-scenario', 'builtin-sovereigns-expanded-map');
    }) });
    await proc.evaluate(() => { const { G, strategy } = window.__game; strategy.refresh(G.newGame(4, 1, 1)); strategy.territory(true); });
    assert.equal(await proc.evaluate(() => window.__game.strategy.kind), '3d');
    assert.equal(await proc.locator('.ctag').count(), 39);
    assert.deepEqual(proc.errors, []);
  } finally { await desktop.close(); }
});
