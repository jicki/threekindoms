// The action panel and its confirmation (docs/战场操作与白兵入口优化方案_2026-11-10_D32.md; feedback D32, kevin@devblog,
// 仔仔周@devblog). A 计略 is chosen, its target picked and the cast confirmed at one place at the left edge; the cast takes a new
// input of its own (src/commitguard.js): never the second click of a double or triple click (whatever the system's double-click
// time), never a held key or a key's auto-repeat, never a press from before the confirmation that is let go after it; and a
// new click, a new Enter or a new press of the pad's confirm casts once, spending once. Browsing spends nothing and draws no
// random number. The 3D camera keeps the targets right of the panel and moves only when it must or is asked to.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, newCampaign, closeMessages, warRest, CARD_ACTS } from './game.mjs';

let game;
before(async () => { game = await startGame({ width: 1280, height: 720 }); });
after(() => game?.close());

const STD = ['a', 'b', 'x', 'y', 'lb', 'rb', 'lt', 'rt', 'view', 'start', 'l3', 'r3', 'up', 'down', 'left', 'right', 'home'];
const fakePad = (ctx) => ctx.addInitScript(() => {
  const pad = { id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', index: 0, mapping: 'standard', connected: true, timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
  Object.defineProperty(navigator, 'getGamepads', { value: () => [pad, null, null, null] });
  window.__fakePad = { pad, set(i, on) { pad.buttons[i] = { pressed: on, touched: on, value: on ? 1 : 0 }; pad.timestamp = performance.now(); } };
});
const padBtn = (page, k, on) => page.evaluate(([i, on]) => window.__fakePad.set(i, on), [STD.indexOf(k), on]);

// A war on the player's turn, his best mind selected with 30 mobility and three enemies in 火计's reach on plain ground; every
// call to the field's random numbers is counted (window.__rolls), and the cast itself is stubbed to count casts (window.__casts).
async function setup(query = '', opts = {}) {
  const page = await game.open(query, opts);
  await page.evaluate(async () => { (await import('./src/pace.js')).setPace(4); (await import('./src/vignette.js')).setVignettes(false); });
  await newCampaign(page);
  await page.evaluate(() => {
    const { g, G, debug } = window.__game, home = g.factions[g.player].city;
    const to = G.roads(home).map((c) => g.cities[c]).filter((c) => c.faction !== g.player && c.faction !== G.NONE && c.officers.length).sort((a, b) => b.officers.length - a.officers.length)[0];
    for (const id of [...g.cities[home].officers, ...to.officers]) g.officers[id].soldiers ||= 500;
    const ids = g.cities[home].officers.slice(0, 3);
    debug.fieldWar(debug.setupWar(g, { from: home, to: to.id, ids, commander: ids[0], gold: 100, rice: 400 }), 'att');
  });
  await page.waitForFunction(() => window.__game.war?.finishDeploy && document.body.dataset.screen === 'war', null, { timeout: 30000 });
  const stop = closeMessages(page);
  try {
    await page.waitForTimeout(2000);
    await page.evaluate(() => window.__game.war.finishDeploy());
    await page.waitForFunction(() => { const f = window.__game.war.field; return f.turn === f.human && !document.querySelector('.banner, .panel.msg'); }, null, { timeout: 30000 });
  } finally { stop(); }
  const ok = await page.evaluate(async () => {
    const F = await import('./src/core/field.js'), w = window.__game.war, f = w.field;
    const me = f.alive.filter((u) => u.side === f.human).sort((a, b) => f.O(b.id).int - f.O(a.id).int)[0], foes = f.alive.filter((u) => u.side !== f.human);
    const free = (x, y) => f.inside(x, y) && !f.unitAt(x, y) && f.terr(x, y) === F.PLAIN;
    let spot = null;
    for (let y = 2; y < F.H - 2 && !spot; y++) for (let x = 4; x < F.W - 6 && !spot; x++) {
      const c = [[x, y], [x + 3, y], [x + 3, y + 1], [x + 4, y - 1]];
      if (c.every(([cx, cy]) => free(cx, cy))) spot = c;
    }
    if (!spot) return false;
    [me.x, me.y] = spot[0]; foes.slice(0, 3).forEach((e, i) => { [e.x, e.y] = spot[i + 1]; });
    const top = w.probe().top;
    for (const u of f.alive) w.spriteOf(u)?.position.set(u.x - F.W / 2 + 0.5, top(u.x, u.y), u.y - F.H / 2 + 0.5);
    const r = f.r; window.__rolls = 0; f.r = (...a) => { window.__rolls++; return r(...a); };
    const cast = f.cast.bind(f); window.__casts = 0; f.cast = (...a) => { window.__casts++; return cast(...a); };
    f.pool[f.human] = 30; w.clickCell(me.x, me.y);
    window.__k = { me, foes: foes.slice(0, 3) };
    return f.legal(me, 0, foes[0]) && f.legal(me, 0, foes[1]);
  });
  assert.ok(ok, '火计 targets near the player\'s general');
  await page.waitForTimeout(800);
  return page;
}
const state = (page) => page.evaluate(() => { const w = window.__game.war, f = w.field; return { casts: window.__casts, pool: f.pool[f.human], busy: w.st.busy, confirm: !!w.st.confirm, cast: w.st.cast, menu: w.st.menu, rolls: window.__rolls }; });
const cellOf = (page, i) => page.evaluate((i) => { const w = window.__game.war, e = window.__k.foes[i], c = w.screenOf(e.x, e.y); return { x: Math.round(c.x), y: Math.round(c.y - (w.flat ? 0 : c.ch * 0.15)), id: e.id }; }, i);
const toTargets = async (page) => { await page.evaluate(() => window.__game.war.chooseStrategy(0)); await page.locator('.actpanel.targets [data-target]').first().waitFor(); await page.waitForTimeout(500); };
const settle = (page) => page.waitForFunction(() => { const w = window.__game.war; return !w.st.busy && !document.querySelector('.vig, .panel.msg, .banner'); }, null, { timeout: 30000 });
// Back to his commands with 30 mobility, ready for the next case.
const reset = (page) => page.evaluate(() => { const w = window.__game.war, f = w.field, { me } = window.__k; for (let i = 0; i < 4; i++) w.cancel(); f.pool[f.human] = 30; if (w.st.sel !== me) w.clickCell(me.x, me.y); });

test('C01: a double or triple click on a target, on the map or in the list, only asks; a new single click casts once (flat)', async () => {
  const page = await setup('&flat');
  await toTargets(page);
  const s0 = await state(page);
  // A double click on the map cell: the first click asks, the second does not cast.
  const c = await cellOf(page, 0);
  const clicks = async (n, gap = 0) => { await page.mouse.move(c.x, c.y); for (let i = 1; i <= n; i++) { if (i > 1 && gap) await page.waitForTimeout(gap); await page.mouse.down({ clickCount: i }); await page.mouse.up({ clickCount: i }); } };
  await clicks(2);
  await page.waitForTimeout(500);
  let s = await state(page);
  assert.deepEqual([s.casts, s.pool, s.confirm], [0, 30, true], `a double click on the map only asks: ${JSON.stringify(s)}`);
  // A triple click from the targets: neither the second nor the third click casts.
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await clicks(3); await page.waitForTimeout(400);
  s = await state(page); assert.deepEqual([s.casts, s.confirm], [0, true], 'the clicks after the first of a triple click do not cast');
  // The system's double-click time can be well over the guard: the second click of a double click 450 ms after the first still does not cast.
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await clicks(2, 450); await page.waitForTimeout(400);
  s = await state(page); assert.deepEqual([s.casts, s.confirm], [0, true], 'a slow double click (450 ms) does not cast either');
  // The same in the list.
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  const row = page.locator(`.actpanel [data-target="${c.id}"]`);
  await row.dblclick(); await page.waitForTimeout(400);
  s = await state(page); assert.deepEqual([s.casts, s.confirm], [0, true], 'a double click on the row only asks');
  // A new single click on the target casts, once.
  await page.mouse.click(c.x, c.y);
  await settle(page);
  s = await state(page);
  assert.equal(s.casts, 1, 'a new click cast'); assert.equal(s.pool, 30 - 6, 'and spent once');
  assert.equal(s0.rolls, 0, 'nothing drawn before');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('C02: Enter held through the target and the confirmation casts nothing; let go and pressed again, it casts once', async () => {
  const page = await setup('&flat');
  await page.locator(CARD_ACTS, { hasText: '计略' }).click();
  await page.locator('.actpanel.strats [data-sid="0"]').focus();
  // Held: the first keydown picks 火计; the auto-repeats walk on to the first target and into the confirmation at most.
  await page.keyboard.down('Enter');
  for (let i = 0; i < 12; i++) { await page.waitForTimeout(60); await page.keyboard.down('Enter'); } // auto-repeat (repeat: true)
  await page.waitForTimeout(400);
  let s = await state(page);
  assert.equal(s.casts, 0, `a held Enter casts nothing: ${JSON.stringify(s)}`);
  assert.equal(s.cast, 0, 'it picked 火计 and stays on its targets');
  assert.equal(s.confirm, false, 'its repeats do not pick a target either');
  await page.keyboard.up('Enter');
  // A new Enter on the focused target asks; the next new Enter casts, once.
  await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  s = await state(page); assert.deepEqual([s.casts, s.confirm], [0, true], 'a new Enter asks');
  await page.keyboard.down('Enter'); await page.waitForTimeout(80); await page.keyboard.down('Enter'); await page.keyboard.down('Enter'); await page.keyboard.up('Enter');
  await settle(page);
  s = await state(page); assert.deepEqual([s.casts, s.pool], [1, 24], 'the next new Enter cast once, its repeats nothing more');
  // Space on the focused 施展, let go and pressed again, casts too.
  await reset(page); await toTargets(page);
  await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  await page.locator('.actpanel .ap-go').focus(); await page.keyboard.press(' ');
  await settle(page);
  s = await state(page); assert.deepEqual([s.casts, s.pool], [2, 24], 'Space on 施展 cast once');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('C02: the pad\'s confirm held through the steps casts nothing; pressed again it casts once', async () => {
  const page = await setup('&flat', { setup: fakePad });
  // The pad picked up first (a step of the map cursor), as a player holding it would have.
  await padBtn(page, 'down', true); await page.waitForTimeout(80); await padBtn(page, 'down', false); await page.waitForTimeout(300);
  await toTargets(page);
  assert.ok(await page.evaluate(() => document.activeElement?.matches('.actpanel [data-target]')), 'the focus is on a target');
  await padBtn(page, 'a', true); await page.waitForTimeout(900); // held past the long press
  let s = await state(page);
  assert.deepEqual([s.casts, s.confirm], [0, true], `held, A asked and cast nothing: ${JSON.stringify(s)}`);
  await padBtn(page, 'a', false); await page.waitForTimeout(200);
  await padBtn(page, 'a', true); await page.waitForTimeout(80); await padBtn(page, 'a', false);
  await settle(page);
  s = await state(page); assert.deepEqual([s.casts, s.pool], [1, 24], 'pressed again, A cast once');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('the pad in the panel: B goes back a step each press, right leaves the list for the map, LB / RB keep the step', async () => {
  const page = await setup('&flat', { setup: fakePad });
  const tap = async (k, wait = 250) => { await padBtn(page, k, true); await page.waitForTimeout(80); await padBtn(page, k, false); await page.waitForTimeout(wait); };
  const at = () => page.evaluate(() => { const st = window.__game.war.st, a = document.activeElement; return { stage: st.confirm ? 'confirm' : st.cast != null ? 'targets' : st.menu ? 'strats' : 'cmds', sel: st.sel?.id ?? null, zone: window.__game.pad.state.zone, focus: a?.closest('.actpanel') ? (a.dataset.target ?? a.dataset.sid ?? 'panel') : null, cell: window.__game.pad.state.cur.cell }; });
  await tap('down');
  await toTargets(page);
  let s = await at(); assert.equal(s.stage, 'targets'); assert.ok(s.focus != null, 'the focus is on a target');
  // LB / RB: the step is his; another of ours is not taken in the middle of it.
  const me = s.sel; await tap('rb'); await tap('lb');
  s = await at(); assert.deepEqual([s.stage, s.sel], ['targets', me], 'LB / RB change nothing while a target is chosen');
  // Right out of the list: the map's cursor, on the target the list was on; A there picks him, and the focus is back in the panel.
  const id = Number(s.focus); await tap('right');
  s = await at(); assert.equal(s.zone, 'map');
  assert.deepEqual(s.cell, await page.evaluate((id) => { const u = window.__game.war.field.alive.find((x) => x.id === id); return { x: u.x, y: u.y }; }, id));
  await tap('a', 500);
  s = await at(); assert.equal(s.stage, 'confirm'); assert.equal(Number(s.focus), id, 'picked on the map, the focus is on his row');
  // B: one step back each press, nothing in between (it used to take the focus to the map first).
  await tap('b', 450); s = await at(); assert.equal(s.stage, 'targets', 'B: the confirmation back to the targets');
  await tap('b', 450); s = await at(); assert.equal(s.stage, 'strats', 'B: the targets back to the 计略');
  await tap('b', 450); s = await at(); assert.deepEqual([s.stage, s.sel, s.zone], ['cmds', me, 'map'], 'B: the list back to his commands, on the map');
  s = await state(page); assert.equal(s.casts, 0);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('C03: a press from before the confirmation, let go after it, does not cast; a drag picks nothing (flat)', async () => {
  const page = await setup('&flat');
  await toTargets(page);
  const c = await cellOf(page, 0);
  await page.mouse.move(c.x, c.y); await page.mouse.down();
  await page.evaluate(() => { const w = window.__game.war, e = window.__k.foes[0]; w.clickCell(e.x, e.y); }); // the confirmation comes up under the held button
  await page.waitForTimeout(450);
  await page.mouse.up(); await page.waitForTimeout(300);
  let s = await state(page);
  assert.deepEqual([s.casts, s.confirm], [0, true], `the release did not cast: ${JSON.stringify(s)}`);
  // A drag from the second target that ends on it picks nothing.
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  const d = await cellOf(page, 1);
  await page.mouse.move(d.x, d.y); await page.mouse.down(); await page.mouse.move(d.x + 40, d.y + 10, { steps: 4 }); await page.mouse.move(d.x, d.y, { steps: 4 }); await page.mouse.up();
  await page.waitForTimeout(300);
  s = await state(page); assert.deepEqual([s.casts, s.confirm], [0, false], 'a drag is not a pick');
  // Enter pressed on a target asks; the window loses the focus and gets it back with the key still held: its repeats do not cast.
  await page.locator(`.actpanel [data-target="${d.id}"]`).focus();
  await page.keyboard.down('Enter'); await page.waitForTimeout(400);
  assert.equal((await state(page)).confirm, true, 'Enter asked');
  await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });
  await page.waitForTimeout(400);
  for (let i = 0; i < 4; i++) { await page.keyboard.down('Enter'); await page.waitForTimeout(60); } // the held key, repeating after the window came back
  await page.waitForTimeout(300);
  s = await state(page); assert.equal(s.casts, 0, 'a key held across a blur does not cast');
  await page.keyboard.up('Enter');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('C04: 施展 clicked over and over, with Enter between, casts once and spends once', async () => {
  const page = await setup('&flat');
  await toTargets(page);
  await page.locator('.actpanel [data-target]').first().click();
  await page.waitForTimeout(400);
  const go = await page.locator('.actpanel .ap-go').boundingBox();
  for (let i = 0; i < 6; i++) { await page.mouse.click(go.x + go.width / 2, go.y + go.height / 2); await page.keyboard.press('Enter'); }
  await settle(page);
  const s = await state(page);
  assert.deepEqual([s.casts, s.pool], [1, 24], `one cast, one spend: ${JSON.stringify(s)}`);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('S10 / U05 / U06: browsing spends and draws nothing; a target gone before the cast is refused, not swapped; each step goes back to its own', async () => {
  const page = await setup('&flat');
  const before = await page.evaluate(() => { const f = window.__game.war.field; return JSON.stringify(f.alive.map((u) => [u.id, f.O(u.id).soldiers, f.O(u.id).hp, u.x, u.y])); });
  await page.locator(CARD_ACTS, { hasText: '计略' }).click();
  await page.waitForSelector('.actpanel.strats');
  for (const b of await page.locator('.actpanel.strats .btn').all()) await b.hover();
  await page.locator('.actpanel.strats [data-sid="0"]').click();
  await page.locator('.actpanel.targets [data-target]').first().waitFor();
  for (const r of await page.locator('.actpanel [data-target]').all()) { await r.hover(); await r.focus(); }
  const ids = await page.locator('.actpanel [data-target]').evaluateAll((l) => l.map((b) => b.dataset.target));
  await page.locator(`.actpanel [data-target="${ids[1]}"]`).click(); await page.waitForTimeout(150);
  await page.locator(`.actpanel [data-target="${ids[0]}"]`).click(); await page.waitForTimeout(150); // another target: asked about instead
  assert.equal(await page.evaluate(() => window.__game.war.st.confirm?.t.id), Number(ids[0]), 'the question follows the target picked last');
  // Back one step at a time: to the same target, to 火计 in the list, to his commands.
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  assert.deepEqual(await page.evaluate(() => ({ cast: window.__game.war.st.cast, confirm: !!window.__game.war.st.confirm, focus: document.activeElement?.dataset?.target })), { cast: 0, confirm: false, focus: ids[0] });
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  assert.deepEqual(await page.evaluate(() => ({ menu: window.__game.war.st.menu, focus: document.activeElement?.dataset?.sid })), { menu: true, focus: '0' });
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  assert.ok(await page.locator(CARD_ACTS, { hasText: '计略' }).count(), 'his commands are back');
  let s = await state(page);
  assert.deepEqual([s.casts, s.pool, s.rolls], [0, 30, 0], `browsing spent and drew nothing: ${JSON.stringify(s)}`);
  assert.equal(await page.evaluate(() => { const f = window.__game.war.field; return JSON.stringify(f.alive.map((u) => [u.id, f.O(u.id).soldiers, f.O(u.id).hp, u.x, u.y])); }), before, 'no soldier, 体力 or place changed');
  // A target that walks out of reach before the cast: refused with its reason, nothing spent, no one else struck.
  await toTargets(page);
  await page.locator(`.actpanel [data-target="${ids[0]}"]`).click(); await page.waitForTimeout(400);
  await page.evaluate((id) => { const f = window.__game.war.field, e = f.alive.find((u) => u.id === Number(id)); e.x = 0; e.y = 0; while (f.unitAt(e.x, e.y) !== e && f.unitAt(e.x, e.y)) e.x++; }, ids[0]);
  await page.locator('.actpanel .ap-go').click(); await page.waitForTimeout(400);
  s = await state(page);
  assert.deepEqual([s.casts, s.pool, s.confirm], [0, 30, false], `refused: ${JSON.stringify(s)}`);
  assert.match(await page.locator('.logbox').textContent(), /无法施展火计/, 'the log says why');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('U01 / U02 / U07: the panel keeps one place through the steps and the camera, its buttons whole at every size (3D)', async () => {
  const page = await setup('');
  const box = () => page.evaluate(() => { const p = document.querySelector('.actpanel'), r = p.getBoundingClientRect(), b = [...p.querySelectorAll('.ap-btns .btn')].map((e) => e.getBoundingClientRect());
    return { btns: b.map((x) => [x.left, x.right, x.top, x.bottom].map(Math.round)), l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), whole: b.every((x) => x.left >= r.left && x.right <= r.right + 0.5 && x.top >= r.top && x.bottom <= r.bottom + 0.5 && x.bottom <= innerHeight), go: (() => { const g = p.querySelector('.ap-go')?.getBoundingClientRect(); return g ? [Math.round(g.left), Math.round(g.top)] : null; })() }; });
  await toTargets(page);
  const t0 = await box();
  assert.ok(t0.whole, `the buttons are whole ${JSON.stringify(t0)}`);
  for (const act of [() => window.__game.war.rotate(1), () => window.__game.war.zoom(-100), () => window.__game.war.pan(3, 1), () => window.__game.war.zoom(200)]) {
    await page.evaluate(act); await page.waitForTimeout(900);
    const b = await box(); assert.deepEqual([b.l, b.t, b.r, b.b, b.go], [t0.l, t0.t, t0.r, t0.b, t0.go], 'the camera does not move the panel');
  }
  await page.locator('.actpanel [data-target]').first().click(); await page.waitForTimeout(200);
  assert.equal(await page.locator('.actpanel').evaluate(el => getComputedStyle(el).animationName), 'none', '确认步骤沿用面板位置');
  const c0 = await box();
  assert.deepEqual([c0.l, c0.t, c0.r, c0.b, c0.go], [t0.l, t0.t, t0.r, t0.b, t0.go], '施展 stands where it stood, greyed, before the target was picked');
  for (const size of [{ width: 1024, height: 600 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(size); await page.waitForTimeout(600);
    const b = await box();
    assert.ok(b.whole && b.l === 12 && b.r <= size.width && b.b <= size.height, `${size.width}×${size.height}: ${JSON.stringify(b)}`);
    const list = await page.evaluate(() => {
      const el = document.querySelector('.actpanel .ap-body'), body = el.getBoundingClientRect();
      const rows = [...el.querySelectorAll('[data-target]')].map((e) => e.getBoundingClientRect());
      return { visible: rows.filter((r) => r.top >= body.top - 1 && r.bottom <= body.bottom + 1).length, height: body.height, scroll: el.scrollTop, rowHeights: rows.map((r) => r.height) };
    });
    assert.ok(list.visible >= 2, `${size.width}×${size.height}: at least two targets show without scrolling (${JSON.stringify(list)})`);
  }
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('camera: a pointer sweeping the list does not move it; a row walked to with the keys brings its target in; 定位目标 centres it (3D)', async () => {
  const page = await setup('');
  await toTargets(page);
  await page.waitForTimeout(1200);
  const pose = () => page.evaluate(() => { const v = window.__game.war.probe().view; return { t: v.target.map((x) => +x.toFixed(2)), dist: +v.dist.toFixed(2) }; });
  const clear = (i) => page.evaluate((i) => { const w = window.__game.war, e = window.__k.foes[i], c = w.screenOf(e.x, e.y), l = document.querySelector('.actpanel').getBoundingClientRect().right; return c.x - c.cw / 2 > l && c.x < innerWidth - 10 && c.y > 60 && c.y < innerHeight - 10; }, i);
  const frameAway = async () => {
    await page.evaluate(async () => {
      const { W, H } = await import('./src/core/field.js');
      const t = window.__k.foes[0];
      window.__game.war.frame(t.x < W / 2 ? W - 1 : 0, t.y < H / 2 ? H - 1 : 0);
    });
    await warRest(page);
    assert.ok(!(await clear(0)), 'the first target is off the screen');
  };
  for (let i = 0; i < 3; i++) assert.ok(await clear(i), `target ${i} is in the clear right of the panel`);
  // The mouse sweeps the rows: the camera stays.
  const p0 = await pose();
  await page.mouse.move(5, 300);
  for (const r of await page.locator('.actpanel [data-target]').all()) await r.hover();
  await page.waitForTimeout(800);
  assert.deepEqual(await pose(), p0, 'the camera did not follow the pointer down the list');
  // Slide the targets off the screen; walking to one with the keys brings it back into the clear.
  await frameAway();
  await page.evaluate(() => { document.body.dataset.input = 'key'; document.querySelector('.actpanel [data-target]').blur(); });
  const id0 = await page.evaluate(() => window.__k.foes[0].id);
  await page.locator(`.actpanel [data-target="${id0}"]`).focus(); await warRest(page);
  assert.ok(await clear(0), 'walked to with the keys, he is in the clear again');
  // 定位目标 (L) centres him at 中.
  await frameAway();
  await page.keyboard.press('l'); await warRest(page);
  const mid = await page.evaluate((id) => { const w = window.__game.war, e = w.field.alive.find((u) => u.id === id), c = w.screenOf(e.x, e.y), l = document.querySelector('.actpanel').getBoundingClientRect().right; return { dx: Math.abs(c.x - (l + innerWidth) / 2), zoom: w.viewState().zoom }; }, id0);
  assert.ok(mid.dx < 90 && ['mid', 'near'].includes(mid.zoom), `定位目标 centred him: ${JSON.stringify(mid)}`);
  // Leaving the choice gives the view back.
  for (let i = 0; i < 3; i++) await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('U03: a long target list at the smallest window walks row by row, each in view, the buttons where they were (3D)', async () => {
  const page = await setup('');
  // Every enemy (up to 10) moved into 火计's reach on plain ground.
  const n = await page.evaluate(async () => {
    const F = await import('./src/core/field.js'), w = window.__game.war, f = w.field, { me } = window.__k;
    const foes = f.alive.filter((u) => u.side !== f.human).slice(0, 10), top = w.probe().top;
    const cells = [];
    for (let r = 1; r <= 5 && cells.length < foes.length; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = me.x + dx, y = me.y + dy;
      if (Math.max(Math.abs(dx), Math.abs(dy)) === r && (dx + dy) % 2 === 0 && f.inside(x, y) && !f.unitAt(x, y) && f.terr(x, y) === F.PLAIN) cells.push([x, y]);
    }
    foes.forEach((e, i) => { if (cells[i]) [e.x, e.y] = cells[i]; });
    for (const u of f.alive) w.spriteOf(u)?.position.set(u.x - F.W / 2 + 0.5, top(u.x, u.y), u.y - F.H / 2 + 0.5);
    w.cancel(); w.clickCell(me.x, me.y);
    return foes.filter((e) => f.legal(me, 0, e)).length;
  });
  assert.ok(n >= 3, `${n} targets`);
  await page.setViewportSize({ width: 1024, height: 600 }); await page.waitForTimeout(600);
  await toTargets(page);
  const rows = await page.locator('.actpanel [data-target]').count();
  assert.equal(rows, n, 'every target in reach is listed');
  const btns = () => page.evaluate(() => [...document.querySelectorAll('.actpanel .ap-btns .btn')].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; }));
  const b0 = await btns();
  await page.locator('.actpanel [data-target]').first().focus();
  for (let i = 0; i < rows; i++) {
    const seen = await page.evaluate(() => { const a = document.activeElement, r = a.getBoundingClientRect(), body = a.closest('.ap-body').getBoundingClientRect(); return a.matches('[data-target]') && r.top >= body.top - 1 && r.bottom <= body.bottom + 1; });
    assert.ok(seen, `row ${i + 1} of ${rows} is in view`);
    assert.deepEqual(await btns(), b0, 'the buttons stay put');
    await page.keyboard.press('ArrowDown'); await page.waitForTimeout(80);
  }
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('U04: targets packed together are told apart by the list; a hovered one lights its row in view; the camera holds still (3D)', async () => {
  const page = await setup('');
  // The three foes on cells side by side, the camera turned so they stand in a row behind one another.
  await page.evaluate(async () => {
    const F = await import('./src/core/field.js'), w = window.__game.war, f = w.field, { me, foes } = window.__k, top = w.probe().top;
    const free = (x, y) => f.inside(x, y) && (!f.unitAt(x, y) || foes.includes(f.unitAt(x, y))) && f.terr(x, y) === F.PLAIN;
    const row = [[me.x + 3, me.y], [me.x + 3, me.y + 1], [me.x + 3, me.y + 2], [me.x + 3, me.y - 1]].filter(([x, y]) => free(x, y)).slice(0, 3);
    foes.forEach((e, i) => { if (row[i]) [e.x, e.y] = row[i]; });
    for (const u of f.alive) w.spriteOf(u)?.position.set(u.x - F.W / 2 + 0.5, top(u.x, u.y), u.y - F.H / 2 + 0.5);
    w.cancel(); w.clickCell(me.x, me.y);
  });
  await toTargets(page);
  await page.waitForTimeout(1200);
  const ids = await page.evaluate(() => window.__k.foes.filter((e) => window.__game.war.field.legal(window.__k.me, 0, e)).map((e) => e.id));
  assert.ok(ids.length >= 2, `packed targets in reach: ${ids}`);
  const pose = () => page.evaluate(() => { const v = window.__game.war.probe().view; return JSON.stringify([v.target.map((x) => +x.toFixed(2)), +v.dist.toFixed(2)]); });
  const p0 = await pose();
  // The pointer (or the pad's cursor) on each one's cell lights his row, and only his, in view.
  for (const id of ids) {
    const lit = await page.evaluate((id) => { const w = window.__game.war, e = w.field.alive.find((u) => u.id === id); w.hoverCell({ x: e.x, y: e.y });
      const hot = [...document.querySelectorAll('.actpanel [data-target].hot')], body = document.querySelector('.actpanel .ap-body').getBoundingClientRect(), r = hot[0]?.getBoundingClientRect();
      return { hot: hot.map((b) => Number(b.dataset.target)), seen: !!r && r.top >= body.top - 1 && r.bottom <= body.bottom + 1 }; }, id);
    assert.deepEqual(lit, { hot: [id], seen: true }, `hovering ${id}`);
    await page.waitForTimeout(150);
  }
  await page.evaluate(() => window.__game.war.hoverCell(null));
  await page.waitForTimeout(800);
  assert.equal(await pose(), p0, 'hovering the packed targets did not move the camera');
  // The one in the middle, picked from the list, is the one asked about and the one struck.
  const mid = ids[1];
  await page.locator(`.actpanel [data-target="${mid}"]`).click(); await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.__game.war.st.confirm?.t.id), mid, 'the question names him');
  const who = await page.locator(`.actpanel [data-target="${mid}"] span`).first().textContent();
  assert.ok((await page.locator('.actpanel .ap-who').textContent()).includes(who.trim()), `the summary names ${who} too`);
  await page.evaluate(() => { const f = window.__game.war.field, c = f.cast; window.__struck = null; f.cast = function (u, id, t, ...a) { window.__struck = t?.id ?? null; return c.call(this, u, id, t, ...a); }; });
  await page.locator('.actpanel .ap-go').click();
  await settle(page);
  assert.equal(await page.evaluate(() => window.__struck), mid, 'the cast went at him, not at a neighbour');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});
