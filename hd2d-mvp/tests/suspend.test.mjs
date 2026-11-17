// 战场中断 (src/core/suspend.js): a war broken off on the player's own turn goes back to the title and is taken up from
// 继续战斗 exactly where it stood (field, game and seed), once; a new game or a record gives it up only when the player says so.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, newCampaign, skipIntro, closeMessages } from './game.mjs';

let game, page;
before(async () => { game = await startGame({ scenario: 'original' }); page = await game.open(); await newCampaign(page, '曹操'); });
after(() => game?.close());

const KEY = 'haou-hd2d-suspend';
// The player's own idle turn on the war map (deploy finished where there is one).
const myTurn = () => page.waitForFunction(() => { const w = window.__game.war, f = w?.field; return f && f.turn === f.human && !w.st.busy && !w.st.deploying && !document.querySelector('.banner, .panel.msg, .shade, #fade.on'); }, null, { timeout: 60000 })
  .catch(async (e) => { throw new Error(`${e.message}\n${JSON.stringify(await page.evaluate(() => { const w = window.__game.war, f = w?.field; return { screen: document.body.dataset.screen, turn: f?.turn, human: f?.human, busy: w?.st.busy, deploying: w?.st.deploying, open: [...document.querySelectorAll('.banner, .panel.msg, .shade, #fade.on')].map((e) => e.className + ':' + e.textContent.slice(0, 60)) }; }))}`); });
const state = () => page.evaluate(() => { const { g, war } = window.__game; return { seed: g.seed, field: war.field.snapshot(), cities: g.cities.map((c) => c.officers.join()), chest: war.field.war }; });
async function startWar(side) {
  await page.evaluate((side) => {
    const { g, debug } = window.__game, me = g.player;
    const mine = g.cities.find((c) => c.faction === me && c.officers.length >= 3 && debug && window.__game.G.roads(c.id).some((n) => ![me, 255].includes(g.cities[n].faction) && g.cities[n].officers.length));
    const foe = g.cities[window.__game.G.roads(mine.id).find((n) => ![me, 255].includes(g.cities[n].faction) && g.cities[n].officers.length)];
    const [from, to] = side === 'att' ? [mine, foe] : [foe, mine];
    for (const id of [...from.officers, ...to.officers]) g.officers[id].soldiers ||= 500;
    const ids = from.officers.slice(0, Math.min(3, from.officers.length - (side === 'att' ? 1 : 0)) || 1);
    const w = debug.setupWar(g, { from: from.id, to: to.id, ids, commander: ids[0], gold: 100, rice: 600 });
    debug.fieldWar(w, side, side === 'def' ? { after: { kind: 'def', faction: w.attacker, pts: 30 } } : undefined);
  }, side);
  await page.waitForFunction(() => window.__game.war?.finishDeploy && document.body.dataset.screen === 'war', null, { timeout: 30000 });
  const stop = closeMessages(page);
  try {
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.__game.war.st.deploying && window.__game.war.finishDeploy());
    await myTurn();
  } finally { stop(); }
}
const menuItem = async (text) => { await page.click('.sysmenu-btn'); return page.locator('.sysmenu-list button', { hasText: text }); };
async function suspendHere() {
  await (await menuItem('中断战斗')).click();
  await page.locator('.shade .btn', { hasText: '中断并回到标题' }).click();
  await page.waitForFunction(() => document.body.dataset.screen === 'title' && window.__game?.debug, null, { timeout: 60000 });
}

test('broken off on the player\'s turn, the war resumes from 继续战斗 as it stood, once', async () => {
  await startWar('att');
  // a general marched this turn: his cell and the side's mobility have changed (a 白兵 on the enemy's turn would wait for the player)
  const moved = await page.evaluate(() => {
    const f = window.__game.war.field, u = f.side(f.human).find((x) => !x.commander) ?? f.side(f.human)[0], { dist } = f.reach(u);
    const [k, spent] = [...dist].find(([, d]) => d > 0); const [x, y] = k.split(',').map(Number);
    f.move(u, x, y, spent);
    f.ambush = { [f.human]: { u, x: u.x, y: u.y, days: 3 } }; // a 十面埋伏 laid: it names its general, kept by his place in the units
    return { id: u.id, x, y, pool: f.pool[f.human] };
  });
  await page.keyboard.press('e'); await page.waitForTimeout(700); // a quarter turn of the map: the resumed war faces the same way
  const yaw = await page.evaluate(() => window.__game.war.yaw);
  const before = await state();
  assert.deepEqual((({ x, y }) => ({ x, y }))(before.field.units.find((u) => u.id === moved.id)), { x: moved.x, y: moved.y });
  await suspendHere();
  assert.ok(await page.evaluate((k) => !!localStorage.getItem(k), KEY), 'stored apart from the record slots');
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter((k) => /^haou-hd2d-save:\d$/.test(k)).length), 0, 'no record slot was written');
  await skipIntro(page);
  const line = page.locator('button', { hasText: '继续战斗' });
  assert.match(await line.innerText(), /之战 · 第1日/);
  await line.click();
  const stop2 = closeMessages(page); try { await myTurn(); } finally { stop2(); }
  const now = await state();
  assert.equal(await page.evaluate(() => window.__game.war.field.resumed), true);
  assert.equal(await page.evaluate((id) => { const f = window.__game.war.field; return f.ambush[f.human].u === f.units.find((u) => u.id === id); }, moved.id), true, 'the ambush names the same general object');
  assert.deepEqual(now, before, 'field, game, chests and seed are those it stopped with');
  assert.equal(await page.evaluate(() => window.__game.war.yaw), yaw, 'the map faces as it was left');
  assert.equal(await page.evaluate((k) => localStorage.getItem(k), KEY), null, 'taken out as it resumed');
  assert.deepEqual(page.errors, []);
});

test('it can be broken off only on the player\'s idle turn', async () => {
  await page.evaluate(() => { window.__game.war.st.busy = true; });
  await (await menuItem('中断战斗')).click();
  await page.waitForSelector('.toast, .toasts', { timeout: 3000 }).catch(() => {});
  assert.ok(!(await page.locator('.shade .btn', { hasText: '中断并回到标题' }).count()), 'no confirmation while an action runs');
  assert.ok(await page.getByText('请先完成当前动作').count());
  await page.evaluate(() => { window.__game.war.st.busy = false; });
});

test('a new game or a record gives the suspended war up only when the player says so', async () => {
  await page.evaluate(() => { const { g, G } = window.__game; G.save(g, 1); });
  await suspendHere();
  await skipIntro(page);
  await page.locator('button', { hasText: '继续记录' }).click();
  await page.locator('.shade', { hasText: '放弃中断的战斗' }).waitFor();
  await page.locator('.shade .btn', { hasText: '取消' }).click();
  await page.locator('button', { hasText: '继续战斗' }).waitFor({ timeout: 15000 });
  assert.ok(await page.evaluate((k) => !!localStorage.getItem(k), KEY), 'kept on 取消');
  await page.locator('button', { hasText: '继续战斗' }).click();
  const stop = closeMessages(page); try { await myTurn(); } finally { stop(); }
});

test('a suspended defence settles and the attacking AI\'s turn goes on to the player\'s next turn', async () => {
  // leave the attack resumed above: it is won at once
  await page.evaluate(() => { const w = window.__game.war; w.field.end('def', 'castle'); w.endTurn(); });
  await page.locator('.btn', { hasText: '返回大地图' }).click({ timeout: 30000 });
  await page.waitForFunction(() => { const g = window.__game.g; return document.body.dataset.screen === 'strategy' && !document.querySelector('.shade'); }, null, { timeout: 30000 });
  await startWar('def');
  const before = await page.evaluate(() => ({ f: window.__game.war.field.war.attacker, cursor: [...window.__game.g.aiCursor], year: window.__game.g.year, month: window.__game.g.month }));
  await suspendHere();
  assert.deepEqual(await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).after, KEY), { kind: 'def', faction: before.f, pts: 30 });
  await skipIntro(page);
  await page.locator('button', { hasText: '继续战斗' }).click();
  const stop = closeMessages(page);
  try {
    await myTurn();
    await page.evaluate(() => { const w = window.__game.war; w.field.end('att', 'commander'); w.endTurn(); });
    await page.locator('.btn', { hasText: '返回大地图' }).click({ timeout: 30000 });
    // the strategy map shows before the AI turn goes on, so this waits for the month to turn as well
    await page.waitForFunction((m) => { const g = window.__game.g; return g.year * 12 + g.month > m && document.body.dataset.screen === 'strategy' && g.current === g.player && !document.querySelector('.aiturn, .panel.msg, .shade'); }, before.year * 12 + before.month, { timeout: 180000 });
  } finally { stop(); }
  const g = await page.evaluate(() => ({ year: window.__game.g.year, month: window.__game.g.month }));
  assert.ok(g.year * 12 + g.month > before.year * 12 + before.month, 'the month went on to the player\'s next turn');
  assert.deepEqual(page.errors, []);
});

// D39 (2026-11-10): the snapshot keeps the generals who have left the field (the settlement needs their fates), and the
// resumed war used to stand every one of them back on the map with his name tag.
test('generals who fell, were taken or withdrew before the break stay off the resumed map', async () => {
  await startWar('att');
  const left = await page.evaluate(() => {
    const { g, war } = window.__game, f = war.field, out = [];
    const fates = ['dead', 'captured', 'retreat'];
    for (const u of f.units.filter((u) => !u.commander)) {
      const fate = fates[out.length % 3];
      u.gone = true; u.fate = fate;
      if (fate === 'dead') { g.officers[u.id].hp = 0; g.officers[u.id].status = 3; }
      if (fate === 'captured') u.capturedBy = u.side === 'att' ? 'def' : 'att';
      if (fate === 'retreat') u.to = f.war.from;
      out.push({ id: u.id, fate });
    }
    return out;
  });
  assert.ok(left.length >= 2, 'the fixture has generals to remove');
  await suspendHere();
  await skipIntro(page);
  await page.locator('button', { hasText: '继续战斗' }).click();
  const stop = closeMessages(page); try { await myTurn(); } finally { stop(); }
  await page.waitForTimeout(600);
  const seen = await page.evaluate(() => {
    const { war } = window.__game, f = war.field, flat = war.flatState().units;
    return f.units.map((u) => ({ id: u.id, gone: !!u.gone, fate: u.fate ?? null, drawn: !!war.spriteOf(u)?.parent, flat: !!flat.find((v) => v.u === u)?.visible, alive: f.alive.includes(u) }));
  });
  for (const { id, fate } of left) {
    const s = seen.find((x) => x.id === id);
    assert.deepEqual({ gone: s.gone, fate: s.fate, alive: s.alive }, { gone: true, fate, alive: false }, `${id} keeps his fate for the settlement`);
    assert.equal(s.drawn, false, `${id} (${fate}) is not stood back on the 3D map`);
    assert.equal(s.flat, false, `${id} (${fate}) is not drawn on the flat map`);
  }
  for (const s of seen.filter((x) => !x.gone)) assert.equal(s.drawn && s.flat, true, `${s.id} is still on the map`);
  assert.deepEqual(page.errors, []);
});
