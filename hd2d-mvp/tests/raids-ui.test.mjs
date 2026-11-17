import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, newCampaign, skipIntro, closeMessages } from './game.mjs';

let game;
before(async () => { game = await startGame(); });
after(async () => { await game?.close(); });
const setup = (context) => context.addInitScript(() => sessionStorage.setItem('haou-hd2d-scenario', 'builtin-sovereigns-expanded-map'));

async function startRaid(page, { ruler = '公孙瓒', city = 0, kind = '海贼' } = {}) {
  await page.evaluate(async () => { (await import('./src/pace.js')).setPace(4); (await import('./src/vignette.js')).setVignettes(false); });
  await newCampaign(page, ruler);
  const before = await page.evaluate((cid) => {
    const { g, io } = window.__game, original = io.raid;
    g.year = 189; g.month = 11; g.ageless = true; g.cities[cid].gov = 99; delete g.raidHistory;
    io.aiTurn = async () => {}; // 只隔离其他势力行动，仍通过真实月轮转触发守城。
    io.raid = async (f) => { if (f === g.player) { g.seed = 7; await original(f); } };
    return { officers: [...g.cities[cid].officers], length: g.officers.length, faction: g.player };
  }, city);
  await page.locator('.endturn button').click();
  await page.locator('.shade .btn', { hasText: '确定' }).click();
  const timer = setInterval(() => page.evaluate((target) => {
    document.querySelector('.aiturn.in:not(.aside)')?.click();
    const m = document.querySelector('.panel.msg'); if (m && !m.textContent.includes(target)) m.click();
  }, `${kind}来袭`).catch(() => {}), 200).unref();
  try { await page.locator('.panel.msg', { hasText: `${kind}来袭` }).waitFor({ timeout: 60000 }); } finally { clearInterval(timer); }
  await page.evaluate(() => { const m = document.querySelector('.panel.msg'); if (m.querySelector('.more')?.hidden) m.click(); m.click(); });
  await page.waitForFunction(() => window.__game.war?.finishDeploy && document.body.dataset.screen === 'war', null, { timeout: 60000 });
  const stop = closeMessages(page);
  try {
    await page.waitForFunction(() => window.__game.war?.st.deploying === true, null, { timeout: 60000 });
    await page.evaluate(() => window.__game.war.finishDeploy());
    await page.waitForFunction(() => { const w = window.__game.war, f = w?.field; return f && f.turn === f.human && !w.st.busy && !w.st.deploying && !document.querySelector('.banner,.panel.msg,.shade,#fade.on'); }, null, { timeout: 90000 });
  } finally { stop(); }
  return before;
}

test('手机真实月轮转触发海贼守城，中断恢复后结算并清理临时敌军', { timeout: 180000 }, async () => {
  const page = await game.open('&flat&phone', { setup });
  try {
    await page.setViewportSize({ width: 812, height: 375 });
    const before = await startRaid(page);
    const state = await page.evaluate(() => {
      const { g, war, G } = window.__game, f = war.field;
      return { kind: f.war.raid.kind, foe: G.name(f.war.att.ids[0]), troops: f.troops('att'), defenders: [...f.war.raid.defenders], turn: f.turn, human: f.human, count: g.officers.length };
    });
    assert.equal(state.kind, 'pirate'); assert.equal(state.foe, '海贼头目'); assert.ok(state.troops > 0);
    assert.deepEqual(state.defenders, before.officers); assert.equal(state.turn, 'def'); assert.equal(state.human, 'def'); assert.ok(state.count > before.length);
    assert.match(await page.locator('.warbar').textContent(), /海贼/);
    const button = page.locator('.wardock .war-rosterbtn'); const box = await button.boundingBox();
    assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 812 && box.y + box.height <= 375);
    const auto = await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange'));
      return JSON.parse(localStorage.getItem('haou-hd2d-suspend:scenario:builtin-sovereigns-expanded-map'));
    });
    assert.equal(auto?.war.raid.kind, 'pirate'); assert.equal(auto.after.kind, 'raid');
    assert.equal(await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange'));
      return localStorage.getItem('haou-hd2d-suspend:scenario:builtin-sovereigns-expanded-map');
    }), null);
    await page.locator('.sysmenu-btn').click(); await page.getByRole('tab', { name: '记录' }).click();
    await page.locator('.sysmenu-list button', { hasText: '中断战斗' }).click();
    await page.locator('.shade .btn', { hasText: '中断并回到标题' }).click();
    await page.waitForFunction(() => document.body.dataset.screen === 'title' && window.__game?.debug, null, { timeout: 60000 });
    await skipIntro(page); await page.locator('button', { hasText: '继续战斗' }).click();
    const stop = closeMessages(page, { aiTurns: true });
    try {
      await page.waitForFunction(() => { const w = window.__game.war; return w?.field?.resumed && w.field.turn === 'def' && !w.st.busy && !document.querySelector('.banner,.panel.msg,.shade,#fade.on'); }, null, { timeout: 90000 });
      assert.equal(await page.evaluate(() => window.__game.G.name(window.__game.war.field.war.att.ids[0])), '海贼头目');
      await page.evaluate(() => { const w = window.__game.war; w.field.end('att', 'commander'); w.endTurn(); });
      await page.locator('.shade', { hasText: '胜' }).waitFor({ timeout: 60000 });
      assert.match(await page.locator('.shade').textContent(), /海贼/);
      await page.locator('.shade .btn', { hasText: '返回大地图' }).click();
      await page.waitForFunction(() => document.body.dataset.screen === 'strategy' && window.__game.g?.current === window.__game.g.player && !document.querySelector('.shade,.panel.msg,.banner'), null, { timeout: 90000 });
    } finally { stop(); }
    const after = await page.evaluate(() => { const { g } = window.__game; return { officers: g.cities[0].officers, length: g.officers.length, faction: g.cities[0].faction, raid: g.raidBattle ?? null, month: g.month, year: g.year }; });
    assert.deepEqual(after.officers, before.officers); assert.equal(after.length, before.length); assert.equal(after.faction, before.faction); assert.equal(after.raid, null);
    assert.deepEqual([after.year, after.month], [190, 0]); assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('3D 山贼守城中玩家君主阵亡后显示败北并进入游戏失败', { timeout: 180000 }, async () => {
  const page = await game.open('', { setup });
  try {
    await startRaid(page, { ruler: '袁术', city: 13, kind: '山贼' });
    assert.match(await page.locator('.warbar').textContent(), /山贼/);
    await page.evaluate(() => {
      const { g, war } = window.__game, field = war.field, enemy = field.side('att')[0], lord = field.side('def').find((u) => u.id === g.factions[g.player].ruler);
      field.applySkirmish(enemy, lord, { a: { soldiers: field.O(enemy.id).soldiers, hp: 70 }, d: { soldiers: 0, hp: 0, fate: 'dead' } });
      war.endTurn();
    });
    await page.locator('.shade', { hasText: '败' }).waitFor({ timeout: 60000 });
    assert.match(await page.locator('.shade').textContent(), /袁术.*阵亡/s);
    assert.equal(await page.evaluate(() => window.__game.g.over?.type), 'gameover');
    await page.locator('.shade .btn', { hasText: '返回大地图' }).click();
    await page.waitForFunction(() => !window.__game.g?.raidBattle, null, { timeout: 60000 });
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('手机内陆暴乱说明引来山贼，并能完成守城', { timeout: 180000 }, async () => {
  const page = await game.open('&flat&phone', { setup });
  try {
    await page.setViewportSize({ width: 812, height: 375 });
    await page.evaluate(async () => { (await import('./src/pace.js')).setPace(4); (await import('./src/vignette.js')).setVignettes(false); });
    await newCampaign(page, '袁术');
    const before = await page.evaluate(() => {
      const { g, G, io } = window.__game, city = g.cities[13];
      g.year = 190; g.month = 1; delete g.raidHistory; delete g.disasterHistory;
      for (const c of g.cities) c.gov = 99;
      Object.assign(city, { gov: 0, riot: 0, rice: 9999 });
      g.seed = 7; const riots = G.riots(g); g.seed = 35;
      void io.raid(g.player);
      return { riots, officers: [...city.officers], length: g.officers.length };
    });
    assert.deepEqual(before.riots, [[13, 1]]);
    await page.locator('.panel.msg', { hasText: '山贼来袭' }).waitFor({ timeout: 60000 });
    await page.waitForFunction(() => document.querySelector('.panel.msg')?.textContent.includes('暴乱引来山贼'), null, { timeout: 15000 });
    await page.evaluate(() => { const m = document.querySelector('.panel.msg'); if (m.querySelector('.more')?.hidden) m.click(); m.click(); });
    const stop = closeMessages(page);
    try {
      await page.waitForFunction(() => window.__game.war?.st.deploying === true, null, { timeout: 60000 });
      assert.equal(await page.evaluate(() => window.__game.war.field.war.raid.cause), 'riot');
      await page.evaluate(() => window.__game.war.finishDeploy());
      await page.waitForFunction(() => { const w = window.__game.war; return w?.field?.turn === 'def' && !w.st.busy && !w.st.deploying && !document.querySelector('.banner,.panel.msg,.shade,#fade.on'); }, null, { timeout: 90000 });
      await page.evaluate(() => { const w = window.__game.war; w.field.end('att', 'commander'); w.endTurn(); });
      await page.locator('.shade', { hasText: '胜' }).waitFor({ timeout: 60000 });
      await page.locator('.shade .btn', { hasText: '返回大地图' }).click();
      await page.waitForFunction(() => document.body.dataset.screen === 'strategy' && !window.__game.g?.raidBattle, null, { timeout: 60000 });
    } finally { stop(); }
    const after = await page.evaluate(() => ({ officers: window.__game.g.cities[13].officers, length: window.__game.g.officers.length }));
    assert.deepEqual(after.officers, before.officers); assert.equal(after.length, before.length); assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});
