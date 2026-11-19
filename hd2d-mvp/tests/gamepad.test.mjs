// The gamepad (src/pad.js, app.js "Gamepad"): a whole campaign start, the 战略地图 and the war map played on a pad alone.
// The page gets a fake standard pad (navigator.getGamepads) before it boots; padTap / padHold / padDir press its buttons for a
// few frames, as a player would.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, closeMessages, skipIntro, newCampaign, timeScale, tapFakePad } from './game.mjs';

let game;
before(async () => { game = await startGame({ width: 1280, height: 800 }); });
after(() => game?.close());

const STD = ['a', 'b', 'x', 'y', 'lb', 'rb', 'lt', 'rt', 'view', 'start', 'l3', 'r3', 'up', 'down', 'left', 'right', 'home'];
// A fake pad on the page: window.__fakePad.set(name, on), .axes[i] = v.
const fakePad = (id) => (ctx) => ctx.addInitScript((id) => {
  const pad = { id, index: 0, mapping: 'standard', connected: true, timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
  Object.defineProperty(navigator, 'getGamepads', { value: () => [pad, null, null, null] });
  window.__fakePad = { pad, set(i, on) { pad.buttons[i] = { pressed: on, touched: on, value: on ? 1 : 0 }; pad.timestamp = performance.now(); } };
}, id);
const XBOX = fakePad('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)');
const NINTENDO = fakePad('Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)');
const btn = (page, k, on) => page.evaluate(([i, on]) => window.__fakePad.set(i, on), [STD.indexOf(k), on]);
// A press of a few frames.
export const padTap = (page, k, { wait = 120 } = {}) => tapFakePad(page, STD.indexOf(k), wait);
export async function padHold(page, k, ms = 800) { await btn(page, k, true); await page.waitForTimeout(ms); await btn(page, k, false); await page.waitForTimeout(150); }
const state = (page) => page.evaluate(() => window.__game.pad.state);
const focused = (page) => page.evaluate(() => { const a = document.activeElement; return a && a !== document.body ? a.textContent.trim() : null; });
// Walks the focus (d-pad) until the focused control's text matches, at most n steps that way.
async function walkTo(page, dir, re, n = 12) {
  for (let i = 0; i < n; i++) { if (re.test((await focused(page)) ?? '')) return; await padTap(page, dir, { wait: 60 }); }
  assert.match((await focused(page)) ?? '', re);
}

test('a new campaign, the 战略地图 and a command, with the pad alone', async () => {
  const page = await game.open('', { setup: XBOX });
  // The title's opening skipped (the first press may only release the music the browser held back), then the pad takes over.
  await skipIntro(page);
  await page.waitForTimeout(1200);
  await padTap(page, 'down');
  const s0 = await state(page);
  assert.equal(s0.input, 'pad'); assert.equal(s0.family, 'xbox'); assert.equal(s0.confirm, 'south');
  // A on the menu's default (新的征程; the menu takes clicks once it has come to rest).
  for (let i = 0; i < 20 && (await page.evaluate(() => document.body.dataset.screen)) !== 'setup'; i++) { assert.match((await focused(page)) ?? '新的征程', /新的征程/); await padTap(page, 'a', { wait: 400 }); }
  assert.equal(await page.evaluate(() => document.body.dataset.screen), 'setup');
  // LEVEL 1, then the ruler (刘备), then 出征: all by the focus.
  await padTap(page, 'down');
  await walkTo(page, 'up', /LEVEL\s*\d/);
  await walkTo(page, 'left', /LEVEL\s*1/);
  await padTap(page, 'a');
  await walkTo(page, 'down', /武\d+智/); // the rulers' row, whichever ruler lies under the option he came down from
  await walkTo(page, 'left', /刘备/);
  await padTap(page, 'a'); await padTap(page, 'a', { wait: 600 }); // again on the chosen ruler starts, as a second click does
  await page.waitForFunction(() => document.body.dataset.screen === 'strategy');
  const stop = closeMessages(page);
  try { await page.waitForFunction(() => { const g = window.__game.g; return g.current === g.player && !document.querySelector('.aiturn, .panel.msg'); }, null, { timeout: 90000 }); } finally { stop(); }
  await page.waitForTimeout(300);

  // The cursor stands on the ruler's city; A selects it and a second A goes into its menu.
  let s = await state(page);
  const home = await page.evaluate(() => { const g = window.__game.g; return g.factions[g.player].city; });
  assert.equal(s.zone, 'map'); assert.equal(s.cur.cid, home);
  assert.equal(await page.evaluate(() => !document.querySelector('.padcursor').hidden), true, 'the ring shows');
  await padTap(page, 'b'); // the city the turn opened on put away
  assert.equal(await page.evaluate(() => !!document.querySelector('.citypanel')), false);
  await padTap(page, 'a');
  assert.ok(await page.evaluate(() => !!document.querySelector('.citypanel .dock, .dock')), 'the city menu opens');
  await padTap(page, 'a');
  assert.ok(await page.evaluate(() => document.querySelector('.dock .tabs')?.contains(document.activeElement)), 'the focus goes to the groups');
  await padTap(page, 'a');
  assert.ok(await page.evaluate(() => document.querySelector('.dock .acts')?.contains(document.activeElement)), 'A opens the group and goes into its commands');
  // Up and down go round the list's ends, as the keys do: from the first command ↑ is the last (城's 记录), not the roster above (D61);
  // the roster says how the pad gets to it (D62).
  const rowAt = () => page.evaluate(() => { const r = [...document.querySelectorAll('.dock .acts .cmd:not(:disabled)')]; return [r.indexOf(document.activeElement), r.length]; });
  assert.equal((await rowAt())[0], 0);
  await padTap(page, 'up');
  { const [i, n] = await rowAt(); assert.equal(i, n - 1, '↑ from the first command goes to the last'); }
  await padTap(page, 'down');
  assert.equal((await rowAt())[0], 0, '↓ from the last goes back to the first');
  assert.match(await page.evaluate(() => { const t = document.querySelector('.roster-tip'); return t && getComputedStyle(t).display !== 'none' ? t.textContent : ''; }), /选武将/);
  // RB turns to the next group, open, the focus in its list; B closes the list, a second B leaves for the map, a third puts the city away.
  const tab0 = await page.evaluate(() => document.querySelector('.dock .tabs .btn.on')?.textContent);
  await padTap(page, 'rb');
  assert.notEqual(await page.evaluate(() => document.querySelector('.dock .tabs .btn.on')?.textContent), tab0);
  assert.ok(await page.evaluate(() => document.querySelector('.dock .acts')?.contains(document.activeElement)), 'RB lands in the new list');
  await padTap(page, 'b');
  assert.equal(await page.evaluate(() => document.querySelector('.dock .acts').hidden), true, 'B closes the list');
  assert.ok(await page.evaluate(() => document.querySelector('.dock .tabs')?.contains(document.activeElement)), 'and the focus is back on its group');
  // LB with the list closed opens the group before it.
  await padTap(page, 'lb');
  assert.equal(await page.evaluate(() => document.querySelector('.dock .tabs .btn.on')?.textContent), tab0);
  // With the list open and no dock on the screen (another faction's turn: the month ended from the pad, or the last 命令书
  // spent), A on the city goes to its panel and throws nothing (review, 2026-11-14).
  await page.evaluate(() => { const { g, debug } = window.__game; g.current = (g.player + 1) % g.factions.length; debug.hud(); });
  assert.equal(await page.evaluate(() => !!document.querySelector('.dock')), false);
  // HUD 重绘使手柄从菜单回到地图；等原有 160 ms 防误触窗口结束，再模拟新的一次按键。
  await page.waitForFunction(() => window.__game.pad.state.zone === 'map');
  await page.waitForTimeout(200);
  await padTap(page, 'a');
  assert.deepEqual(page.errors, []);
  assert.ok(await page.evaluate(() => document.querySelector('.citypanel')?.contains(document.activeElement)), 'the focus goes into the city panel');
  await page.evaluate(() => { const { g, debug } = window.__game; g.current = g.player; debug.hud(); });
  assert.ok(await page.evaluate(() => document.querySelector('.dock .acts')?.contains(document.activeElement)), 'our turn again: the keys are back in the list');
  await padTap(page, 'b');
  await padTap(page, 'b');
  assert.equal((await state(page)).zone, 'map');
  await padTap(page, 'b');
  assert.equal(await page.evaluate(() => !!document.querySelector('.citypanel')), false);
  // The cursor walks to another city that way, and the tip names it.
  await padTap(page, 'right', { wait: 200 });
  s = await state(page);
  assert.notEqual(s.cur.cid, home);
  assert.equal(await page.evaluate(() => !document.querySelector('#tip').hidden), true);
  // X opens the 人物志 (its button's binding); B closes it.
  await padTap(page, 'x', { wait: 300 });
  assert.ok(await page.evaluate(() => !!document.querySelector('.wikitable')));
  await padTap(page, 'b', { wait: 300 });
  assert.equal(await page.evaluate(() => !!document.querySelector('.wikitable')), false);
  // Start opens the 系统 menu with its first row focused; Start again closes it.
  await padTap(page, 'start', { wait: 200 });
  assert.ok(await page.evaluate(() => document.querySelector('.sysmenu-list:not([hidden])')?.contains(document.activeElement)));
  await padTap(page, 'start', { wait: 200 });
  assert.equal(await page.evaluate(() => !!document.querySelector('.sysmenu-list:not([hidden])')), false);
  // 欣赏模式 (L3): the left stick slides the view and the triggers zoom it; B leaves.
  await padTap(page, 'l3', { wait: 300 });
  assert.equal((await state(page)).zone, 'scenic');
  // (Where two cities stand on screen and how far apart: the first moves with a slide, the second changes with the zoom.)
  const view = () => page.evaluate(() => { const s = window.__game.strategy, a = s.screenOfCity(0), b = s.screenOfCity(20); return { at: [Math.round(a.x), Math.round(a.y)], span: Math.round(Math.hypot(a.x - b.x, a.y - b.y)) }; });
  const v0 = await view();
  await btn(page, 'right', true); await page.waitForTimeout(500); await btn(page, 'right', false); await page.waitForTimeout(800);
  const v1 = await view(); assert.notDeepEqual(v1.at, v0.at, 'the stick slides the view');
  await btn(page, 'rt', true); await page.waitForTimeout(500); await btn(page, 'rt', false); await page.waitForTimeout(800);
  assert.notEqual((await view()).span, v1.span, 'a trigger zooms');
  await padTap(page, 'b', { wait: 300 });
  assert.equal((await state(page)).zone, 'map');
  // A short Y does nothing; a long one ends the month.
  const month = await page.evaluate(() => window.__game.g.month);
  await padTap(page, 'y', { wait: 300 });
  assert.equal(await page.evaluate(() => window.__game.g.current === window.__game.g.player), true, 'a tap does not end the month');
  await padHold(page, 'y', 900);
  // With 命令书 left the game asks first, its 确定 focused: A answers.
  assert.match(await focused(page), /确定/);
  await padTap(page, 'a', { wait: 300 });
  await page.waitForFunction((m) => { const g = window.__game.g; return g.current !== g.player || g.month !== m; }, month, { timeout: 10000 });
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

// A d-pad direction, both arms at once for a diagonal.
async function padDir(page, dx, dy) {
  const arms = [dx > 0 && 'right', dx < 0 && 'left', dy > 0 && 'down', dy < 0 && 'up'].filter(Boolean);
  for (const a of arms) await btn(page, a, true);
  await page.waitForTimeout(70);
  for (const a of arms) await btn(page, a, false);
  await page.waitForTimeout(90);
}
// Steps the war-map cursor onto a cell by the screen, as a player looking at the board would.
async function cursorTo(page, x, y) {
  for (let i = 0; i < 40; i++) {
    const d = await page.evaluate(([x, y]) => {
      const w = window.__game.war, c = window.__game.pad.state.cur.cell; if (c.x === x && c.y === y) return null;
      const gx = Math.sign(x - c.x), gy = Math.sign(y - c.y), ax = w.screenAxes(c.x, c.y);
      return Math.round(Math.atan2(gx * ax.x[1] + gy * ax.y[1], gx * ax.x[0] + gy * ax.y[0]) / (Math.PI / 4)) * Math.PI / 4;
    }, [x, y]);
    if (d == null) return;
    await padDir(page, Math.round(Math.cos(d)), Math.round(Math.sin(d))); // the nearest of the eight ways, as a stick gives
  }
  assert.fail(`the cursor did not reach ${x},${y}: ${JSON.stringify(await page.evaluate(() => ({ s: window.__game.pad.state, f: document.activeElement?.outerHTML.slice(0, 80) })))}`);
}
const cell = (page) => page.evaluate(() => window.__game.pad.state.cur.cell);

for (const view of ['flat', '3D']) test(`the war map on the pad (${view}): deploy, move, undo, commands, an attack and its 白兵`, async () => {
  const page = await game.open(view === 'flat' ? '&flat' : '', { setup: XBOX, clock: true });
  await newCampaign(page);
  await page.evaluate(() => {
    const { g, G, debug } = window.__game, home = g.factions[g.player].city;
    const to = G.roads(home).map((c) => g.cities[c]).filter((c) => c.faction !== g.player && c.faction !== G.NONE && c.officers.length).sort((a, b) => b.officers.length - a.officers.length)[0];
    for (const id of g.cities[home].officers) g.officers[id].soldiers ||= 500;
    for (const id of to.officers) g.officers[id].soldiers ||= 500;
    const ids = g.cities[home].officers.slice(0, 3);
    debug.fieldWar(debug.setupWar(g, { from: home, to: to.id, ids, commander: ids[0], gold: 100, rice: 400 }), 'att');
  });
  await page.waitForFunction(() => window.__game.war?.finishDeploy && document.body.dataset.screen === 'war' && !document.querySelector('#fade.on'), null, { timeout: 30000 });
  const stop = closeMessages(page);
  try {
    await page.waitForTimeout(2500);
    // 布阵完成 on a long Y.
    assert.equal(await page.evaluate(() => window.__game.war.st.deploying), true);
    await padTap(page, 'y', { wait: 200 });
    assert.equal(await page.evaluate(() => window.__game.war.st.deploying), true, 'a short Y does not end the deployment');
    await padHold(page, 'y', 900);
    await page.waitForFunction(() => { const w = window.__game.war, f = w.field; return !w.st.deploying && f.turn === f.human && !document.querySelector('.banner, .panel.msg'); }, null, { timeout: 30000 });
  } finally { stop(); }
  await page.waitForTimeout(300);
  // 未选中武将时，LB 从最后一名开始，RB 从第一名开始。
  const ids = await page.evaluate(() => { const f = window.__game.war.field; return f.side(f.human).map((u) => u.id); });
  assert.equal(await page.evaluate(() => window.__game.war.st.sel), null);
  await padTap(page, 'lb'); assert.equal(await page.evaluate(() => window.__game.war.st.sel?.id), ids.at(-1));
  await padTap(page, 'b'); assert.equal(await page.evaluate(() => window.__game.war.st.sel), null);
  await padTap(page, 'rb'); assert.equal(await page.evaluate(() => window.__game.war.st.sel?.id), ids[0]);
  await padTap(page, 'b'); assert.equal(await page.evaluate(() => window.__game.war.st.sel), null);
  // The cursor stands on a general of ours; A selects him.
  const c0 = await cell(page);
  const me = await page.evaluate(([x, y]) => { const f = window.__game.war.field, u = f.unitAt(x, y); return u && u.side === f.human ? u.id : null; }, [c0.x, c0.y]);
  assert.ok(me != null, 'the cursor starts on one of ours');
  await padTap(page, 'a');
  assert.equal(await page.evaluate(() => window.__game.war.st.sel?.id), me);
  // Up the screen, then A: he walks to the first cell there that he can reach.
  let to = null;
  for (let i = 0; i < 6 && !to; i++) {
    await padTap(page, 'up');
    const c = await cell(page);
    if (await page.evaluate(([x, y]) => !!window.__game.war.st.reach?.dist.has(x + ',' + y) && !window.__game.war.field.unitAt(x, y), [c.x, c.y])) to = c;
  }
  assert.ok(to, 'a reachable cell up the screen');
  const pool = await page.evaluate(() => window.__game.war.field.pool[window.__game.war.field.human]);
  await padTap(page, 'a');
  await page.waitForFunction(([x, y]) => { const s = window.__game.war.st; return !s.busy && s.sel?.x === x && s.sel?.y === y; }, [to.x, to.y], { timeout: 10000 });
  await page.waitForTimeout(400);
  // A on him again goes into his commands (when he has any: 计略, 退却…); B comes back to the map.
  if (await page.evaluate(() => !!document.querySelector('.unitpanel:not(.compare) .acts button:not(:disabled)'))) {
    await padTap(page, 'a');
    assert.ok(await page.evaluate(() => !!document.activeElement?.closest('.unitpanel:not(.compare) .acts')), `the focus is in his commands: ${JSON.stringify(await page.evaluate(() => ({ s: window.__game.pad.state, f: document.activeElement?.outerHTML.slice(0, 80), sel: window.__game.war.st.sel && [window.__game.war.st.sel.x, window.__game.war.st.sel.y], top: document.querySelector('#ui-top').innerHTML.slice(0, 120) })))}`);
    await padTap(page, 'b');
  }
  assert.equal((await state(page)).zone, 'map');
  // X: 撤销, and the cursor goes back with him.
  await padTap(page, 'x');
  // 坐标和机动力先恢复，动画结束后才解除操作锁。
  await page.waitForFunction(({ x, y, id }) => {
    const { st } = window.__game.war;
    return !st.busy && st.sel?.id === id && st.sel.x === x && st.sel.y === y;
  }, { ...c0, id: me }, { timeout: 10000 });
  assert.equal(await page.evaluate(() => window.__game.war.field.pool[window.__game.war.field.human]), pool, 'the move is undone');
  const back = await page.evaluate(() => { const s = window.__game.war.st.sel; return { x: s.x, y: s.y }; });
  assert.deepEqual(await cell(page), back);
  // RB: the next of ours.
  await padTap(page, 'rb', { wait: 300 });
  assert.equal(await page.evaluate(() => window.__game.war.st.sel?.id), ids[(ids.indexOf(me) + 1) % ids.length]);
  // A short Y pins the enemy's threat range and unpins it (the long one ends the day).
  await padTap(page, 'y', { wait: 250 });
  assert.equal(await page.evaluate(() => document.body.classList.contains('threat-view')), true, 'Y shows the threat range');
  await padTap(page, 'y', { wait: 250 });
  assert.equal(await page.evaluate(() => document.body.classList.contains('threat-view')), false);
  // The 3D map's minimap is put away and brought back from the 系统 menu (the pad has no button of its own for it).
  if (view === '3D') {
    const open = () => page.evaluate(() => window.__game.warNav.open), was = await open();
    await padTap(page, 'start', { wait: 300 });
    await walkTo(page, 'down', /小地图/);
    await padTap(page, 'a'); assert.equal(await open(), !was, 'the row toggles the minimap');
    assert.match(await focused(page), was ? /小地图 关/ : /小地图 开/);
    await padTap(page, 'a'); assert.equal(await open(), was);
    await padTap(page, 'start', { wait: 300 });
    assert.equal((await state(page)).zone, 'map');
  }
  // An attack: one of ours stood beside a foe, A on him, then on the foe (the prompt), then A again strikes.
  const pair = await page.evaluate(() => {
    const w = window.__game.war, f = w.field, u = w.st.sel;
    for (const e of f.alive.filter((x) => x.side !== f.human)) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = e.x + dx, y = e.y + dy;
      if (f.inside(x, y) && !f.unitAt(x, y)) { u.x = x; u.y = y; return { me: { x, y }, foe: { x: e.x, y: e.y } }; }
    }
    return null;
  });
  assert.ok(pair);
  await padTap(page, 'b'); // let him go (A on the general in hand would open his commands)
  assert.equal(await page.evaluate(() => window.__game.war.st.sel), null);
  await cursorTo(page, pair.me.x, pair.me.y); await padTap(page, 'a');
  await cursorTo(page, pair.foe.x, pair.foe.y); await padTap(page, 'a', { wait: 300 });
  assert.ok(await page.evaluate(() => !!document.querySelector('.actpanel.strike')), 'the 攻击 confirmation');
  await padTap(page, 'a');
  // The 白兵 on the pad: A picks the 阵形 (the last one is picked already), X deploys it, Start begins, RT twice to 4×, Y to hand it over; a 单挑 is handed over with
  // Y too, and the result closes on A.
  await page.waitForFunction(() => !!document.querySelector('.tq-form'), null, { timeout: 30000 });
  await page.waitForTimeout(800);
  await padTap(page, 'a', { wait: 300 });
  assert.equal(await page.evaluate(() => !!document.querySelector('.tq-formation')), true, 'A only picks: the picker stays');
  await padTap(page, 'x', { wait: 2500 });
  await page.waitForFunction(() => !!document.querySelector('.tq-start button:not(.arming)'), null, { timeout: 15000 });
  await padTap(page, 'start', { wait: 300 });
  assert.equal(await page.evaluate(() => !!document.querySelector('.tq-start')), false, 'Start begins the fight');
  await padTap(page, 'rt'); await padTap(page, 'rt');
  assert.equal(await page.evaluate(() => document.querySelector('.tq-speed .on')?.textContent), '4×');
  // View held: the exact numbers, as Alt.
  await btn(page, 'view', true); await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => document.body.classList.contains('alt-held')), true, 'View held shows the exact numbers');
  await btn(page, 'view', false); await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => document.body.classList.contains('alt-held')), false);
  // The pad lost in the middle of the fight (unplugged): the fight stops, the mouse and keys get their hints back; found again
  // with a button still down, that is not a press.
  await page.evaluate(() => { window.__fakePad.pad.connected = false; }); await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => document.querySelector('.tq [data-pad~="start"]')?.classList.contains('on')), true, 'the fight is paused');
  assert.equal(await page.evaluate(() => document.body.dataset.input), 'mouse');
  await btn(page, 'start', true); await page.evaluate(() => { window.__fakePad.pad.connected = true; }); await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => document.querySelector('.tq [data-pad~="start"]')?.classList.contains('on')), true, 'a button held as the pad comes back does nothing');
  await btn(page, 'start', false); await page.waitForTimeout(120);
  await padTap(page, 'start', { wait: 300 });
  assert.equal(await page.evaluate(() => document.querySelector('.tq [data-pad~="start"]')?.classList.contains('on')), false, 'Start goes on');
  await padTap(page, 'y');
  // The fight itself plays on its own and is not what this test looks at: its clock runs 8× (tests/game.mjs fastClock),
  // back to 1× for each press, so a tap stays a tap.
  const tap = async (k) => { await timeScale(page, 1); await padTap(page, k); await timeScale(page, 8); };
  await timeScale(page, 8);
  for (let i = 0; i < 400 && (await page.evaluate(() => !!window.__game.mode && (window.__game.war?.field && document.querySelector('.tq')))); i++) {
    const what = await page.evaluate(() => (document.querySelector('.tq-duel-acts') ? 'duel' : document.querySelector('.tq-ask:not(.tq-start), .tq-result, .tq-end') ? 'ask' : null));
    if (what === 'duel') await tap('y');
    else if (what === 'ask') await tap('a');
    else await page.waitForTimeout(250);
  }
  await page.waitForFunction(() => !document.querySelector('.tq') && document.body.dataset.screen === 'war', null, { timeout: 60000 });
  await timeScale(page, 1);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('a Nintendo pad confirms on the right button, and its glyphs say so', async () => {
  const page = await game.open('', { setup: NINTENDO });
  await btn(page, 'b', true); await page.waitForTimeout(80); await btn(page, 'b', false); await page.waitForTimeout(100);
  const s = await state(page);
  assert.equal(s.family, 'nintendo'); assert.equal(s.confirm, 'east');
  const g = await page.evaluate(() => [getComputedStyle(document.body).getPropertyValue('--g-a'), getComputedStyle(document.body).getPropertyValue('--g-b')]);
  assert.deepEqual(g.map((x) => x.trim()), ['"A"', '"B"']);
  await page.context().close();
});
