import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, newCampaign, cmd, closeMessages, skipIntro } from './game.mjs';

let game, page, ids;
before(async () => {
  game = await startGame({ scenario: 'original' }); page = await game.open('&flat');
  await newCampaign(page, '刘备');
  ids = await page.evaluate(async () => {
    const { g, G, debug } = window.__game, c = g.cities[g.factions[g.player].city];
    (await import('./src/vignette.js')).setVignettes(false);
    G.data().cities[c.id].facilities.hospital = true;
    g.books = 10; c.gold = 500;
    const ids = c.officers.slice(0, 2); for (const id of ids) g.officers[id].hp = 1;
    debug.hud(); return ids;
  });
});
after(() => game?.close());

test('病院可一并治疗两人，按实际次数扣金和命令书', async () => {
  const before = await page.evaluate(() => { const { g } = window.__game, c = g.cities[g.factions[g.player].city]; return { books: g.books, gold: c.gold }; });
  await cmd(page, '町', '病院'); await page.locator(`.shade tr[data-id="${ids[0]}"]`).click();
  await page.locator('.shade .btn', { hasText: '一并' }).click();
  await page.locator(`.shade tr[data-id="${ids[1]}"]`).click();
  await page.locator('.shade .btn', { hasText: '每人一次' }).click();
  await page.waitForFunction((n) => window.__game.g.books === n - 2, before.books);
  const after = await page.evaluate((ids) => { const { g } = window.__game, c = g.cities[g.factions[g.player].city]; return { gold: c.gold, hp: ids.map((id) => g.officers[id].hp) }; }, ids);
  assert.equal(after.gold, before.gold - 100); assert.ok(after.hp.every((hp) => hp > 1));
});

test('只有十金时赏金默认十金，可以确认并完成', async () => {
  await page.evaluate((id) => { const { g, debug } = window.__game; g.cities[g.factions[g.player].city].gold = 10; g.officers[id].loyalty = 30; debug.hud(); }, ids[0]);
  await cmd(page, '仓', '赏赐'); await page.locator(`.shade tr[data-id="${ids[0]}"]`).click();
  await page.locator('.shade .btn', { hasText: '赏金' }).click();
  assert.equal(await page.locator('.shade input.amount').inputValue(), '10');
  await page.locator('.shade .btn.primary').click();
  const stop = closeMessages(page);
  try {
    await page.locator('.shade .btn', { hasText: '每人一次' }).click();
    await page.waitForFunction(() => { const { g } = window.__game; return g.cities[g.factions[g.player].city].gold === 0; });
    await page.waitForFunction(() => !document.querySelector('.shade, .panel.msg'));
  } finally { stop(); }
});

test('地名切换立即更新地图并保留城市编号', async () => {
  await page.locator('.sysmenu-btn').click();
  await page.locator('.sysmenu-list button', { hasText: '地名 原版' }).click();
  assert.equal(await page.evaluate(() => window.__game.G.cityName(1)), '北平');
  await page.waitForFunction(() => [...document.querySelectorAll('.ctag')].some((x) => x.textContent.includes('北平')));
  assert.deepEqual(page.errors, []);
});

test('战场连续计略通过确认面板逐次执行并扣除机动力', { timeout: 120000 }, async () => {
  await page.evaluate(() => {
    const { g, G, debug } = window.__game, home = g.factions[g.player].city;
    const target = G.roads(home).map((id) => g.cities[id]).find((c) => c.faction !== g.player && c.faction !== G.NONE && c.officers.length);
    const deployed = g.cities[home].officers.slice(0, 2);
    for (const id of [...deployed, ...target.officers]) g.officers[id].soldiers = 800;
    debug.fieldWar(debug.setupWar(g, { from: home, to: target.id, ids: deployed, commander: deployed[0], gold: 0, rice: 400 }), 'att');
  });
  const stop = closeMessages(page);
  try {
    await page.waitForFunction(() => window.__game.war?.st?.deploying && document.body.dataset.screen === 'war', null, { timeout: 60000 });
    await page.evaluate(() => window.__game.war.finishDeploy());
    await page.waitForFunction(() => window.__game.war.myTurn && !window.__game.war.st.deploying);
    await page.evaluate(async () => {
      const w = window.__game.war, f = w.field, u = f.side('att')[0], t = f.side('def')[0];
      Object.assign(u, { x: 10, y: 10 }); Object.assign(t, { x: 11, y: 10 });
      Object.assign(f.O(u.id), { int: 95, war: 10, level: 5 }); Object.assign(f.O(t.id), { soldiers: 1000, hp: 90 });
      f.pool.att = 30; f.terr = () => 0; f.r = () => 0;
      await w.clickCell(u.x, u.y); w.chooseStrategy(3); await w.clickCell(t.x, t.y);
    });
    await page.locator('.actpanel button[aria-label="增加施放次数"]').click();
    assert.equal(await page.locator('.actpanel [aria-label="连续施放次数"] b').textContent(), '2');
    await page.keyboard.press('ArrowRight'); assert.equal(await page.locator('.actpanel [aria-label="连续施放次数"] b').textContent(), '3');
    await page.keyboard.press('ArrowLeft'); assert.equal(await page.locator('.actpanel [aria-label="连续施放次数"] b').textContent(), '2');
    await page.waitForTimeout(400);
    assert.ok(await page.locator('.actpanel .ap-go').count(), JSON.stringify(await page.evaluate(() => ({ text: document.body.innerText.slice(-1200), screen: document.body.dataset.screen, stage: window.__game.war?.st?.stage, errors: window.__game.war?.field?.over }))));
    await page.locator('.actpanel .ap-go').click();
    await page.waitForFunction(() => window.__game.war.field.pool.att === 18);
    assert.ok(await page.evaluate(() => window.__game.war.field.O(window.__game.war.field.side('def')[0].id).soldiers < 1000));
    assert.deepEqual(page.errors, []);
  } finally { stop(); }
});

test('手机白兵将令和战术默认收起，展开后六秒无操作自动收起', { timeout: 120000 }, async () => {
  const p = await game.open('&phone');
  try {
    await p.setViewportSize({ width: 812, height: 375 });
    await p.evaluate(() => { window.__game.G.data().officers[153].int = 99; window.__game.debug.quickTactical(153, 191, 2, { human: 'a' }); });
    await p.waitForSelector('.tq-form', { timeout: 60000 });
    await p.locator('.tq-form').first().click(); await p.locator('.tq-deploy:not(.arming)').click();
    await p.waitForSelector('.tq-start button', { timeout: 30000 });
    assert.equal(await p.locator('.tq-orders .tq-row').first().isVisible(), false);
    await p.locator('.tq-orders .tq-fold').click();
    assert.equal(await p.locator('.tq-orders .tq-row').first().isVisible(), true);
    await p.waitForFunction(() => document.querySelector('.tq-orders')?.classList.contains('folded'), null, { timeout: 10000 });
    await p.locator('.tq-tactics .tq-fold').click();
    assert.equal(await p.locator('.tq-tactics .tq-tac').first().isVisible(), true);
    await p.locator('.tq-tactics .tq-tac', { hasText: '爆炎' }).click();
    assert.equal(await p.evaluate(() => window.__game.tview.scene.getObjectByName('blast-preview').visible), true);
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); }
});

test('新开局规则和声音设置跨刷新保留，难度不记忆', { timeout: 120000 }, async () => {
  const p = await game.open();
  try {
    await p.evaluate(() => { window.__game.audio.setMuted(true); window.__game.G.setPlaceNames(true); });
    await skipIntro(p); await p.getByText('新的征程').click();
    assert.match(await p.locator('.ruler', { hasText: '刘备' }).locator('.towns').textContent(), /晋阳/);
    await p.getByRole('button', { name: /武将不战死/ }).click();
    await p.locator('.level', { hasText: 'LEVEL 3' }).click();
    await p.goto(game.url.replace('?mute', '')); await p.waitForFunction(() => window.__game?.debug);
    assert.equal(await p.evaluate(() => window.__game.audio.muted), true);
    await skipIntro(p); await p.getByText('新的征程').click();
    assert.equal(await p.getByRole('button', { name: /武将不战死/ }).getAttribute('aria-pressed'), 'true');
    assert.equal(await p.locator('.level', { hasText: 'LEVEL 2' }).getAttribute('aria-pressed'), 'true');
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); }
});
