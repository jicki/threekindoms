// Finding one's way round the 3D war map (第 2 期, docs/战场3D重构与操作优化方案_2026-11-13.md §6): the wheel pulls in on the cell
// under the pointer, the lens is widened over a reach being read, the minimap and the edge markers show the field and move only
// the camera, the enemy's turn leaves the camera where it is unless he acts outside the picture, and a double click centres.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, newCampaign, closeMessages, warRest } from './game.mjs';

let game;
after(async () => { await game?.close(); });
async function openWar(size) {
  game = await startGame(size); const p = await game.open();
  await p.evaluate(async () => { (await import('./src/quality.js')).warView.set('3d'); (await import('./src/pace.js')).setPace(4); try { localStorage.removeItem('hd2d-minimap'); } catch {} });
  await newCampaign(p);
  await p.evaluate(() => {
    const { g, G, debug } = window.__game, home = g.factions[g.player].city;
    const to = G.roads(home).map((c) => g.cities[c]).filter((c) => c.faction !== g.player && c.faction !== G.NONE && c.officers.length).sort((a, b) => b.officers.length - a.officers.length)[0];
    for (const id of [...g.cities[home].officers, ...to.officers]) g.officers[id].soldiers ||= 500;
    const ids = g.cities[home].officers.slice(0, 3);
    debug.fieldWar(debug.setupWar(g, { from: home, to: to.id, ids, commander: ids[0], gold: 100, rice: 400 }), 'att');
  });
  await p.waitForFunction(() => window.__game.war?.finishDeploy && document.body.dataset.screen === 'war', null, { timeout: 30000 });
  const stop = closeMessages(p);
  try {
    await p.waitForTimeout(2500);
    // While the army is placed the 布阵完成 box has the minimap's corner: the map is away and the box takes a click.
    if (await p.evaluate(() => window.__game.war.st.deploying)) { assert.equal(await p.locator('.warmini').isVisible(), false, 'no minimap over the 布阵完成 box'); await p.locator('.deploybtn .btn', { hasText: '布阵完成' }).click({ timeout: 5000 }); }
    await p.waitForFunction(() => { const w = window.__game.war, f = w?.field; return f && f.turn === f.human && !w.st.busy && !w.st.deploying && !document.querySelector('.banner, .panel.msg, .shade, #fade.on'); }, null, { timeout: 60000 });
  } finally { stop(); }
  return p;
}
const view = (p) => p.evaluate(() => { const v = window.__game.war.probe().view; return { zoom: v.zoom, target: v.target, dist: v.dist }; });

test('wheel, lens, minimap, double click and the enemy\'s turn on the 3D war map', async (t) => {
  const p = await openWar({ width: 1440, height: 900 });
  try {
    // C01: the cell under the pointer stays under it as the wheel pulls in (within half a cell on screen).
    await p.evaluate(() => window.__game.war.overview());
    await warRest(p);
    await p.evaluate(() => window.__game.war.zoom(-100));
    await warRest(p); // 远
    for (const step of ['mid', 'near']) {
      const before = await p.evaluate(() => {
        const w = window.__game.war, f = w.field, me = f.side(f.human)[0];
        const c = { x: me.x + (me.x < f.width / 2 ? 2 : -2), y: me.y + (me.y < f.height / 2 ? 1 : -1) };
        window.__c = c;
        const s = w.screenOf(c.x, c.y);
        w.zoom(-100, { x: s.x / innerWidth * 2 - 1, y: 1 - s.y / innerHeight * 2 });
        return { x: s.x, y: s.y };
      });
      await warRest(p);
      const after = await p.evaluate(() => { const w = window.__game.war, s = w.screenOf(window.__c.x, window.__c.y); return { x: s.x, y: s.y, half: Math.max(s.cw, s.ch) / 2, zoom: w.viewState().zoom }; });
      assert.equal(after.zoom, step);
      assert.ok(Math.hypot(after.x - before.x, after.y - before.y) <= after.half, `${step}: the pointed cell moved ${Math.hypot(after.x - before.x, after.y - before.y).toFixed(1)} px on screen (half a cell is ${after.half.toFixed(1)})`);
    }
    // C02: at 中 and 近 every cell of a selected general's reach is sharp; put away, the tilt-shift is back.
    for (const step of ['near', 'mid']) {
      if (step === 'mid') { await p.evaluate(() => window.__game.war.zoom(100)); await warRest(p); }
      const blur = async () => { await warRest(p); await p.waitForTimeout(700); return p.evaluate(() => { const w = window.__game.war, f = w.field, top = w.probe().top; return Math.max(...window.__reach.map(([x, y]) => w.blurAt(x - (f.width - 1) / 2, top(x, y), y - (f.height - 1) / 2))); }); };
      await p.evaluate(() => { const w = window.__game.war, f = w.field, me = f.side(f.human)[0]; w.hoverCell(null); f.pool[f.human] = 20; w.clickCell(me.x, me.y); window.__reach = [...w.st.reach.dist.keys()].map((k) => k.split(',').map(Number)); });
      const sharp = await blur();
      assert.ok(sharp <= 0.05, `${step}: the blurriest cell of his reach weighs ${sharp.toFixed(3)}`);
      await p.evaluate(() => window.__game.war.cancel());
      const soft = await blur();
      assert.ok(soft > 0.3, `${step}: with no one picked the same cells blur again (${soft.toFixed(3)})`);
    }
    // C03: the minimap's dots are the generals on the field; a press on it brings that cell to the middle; its frame follows the camera.
    const nav = await p.evaluate(() => { const f = window.__game.war.field, n = window.__game.warNav.probe(); return { ...n, width: f.width, height: f.height, alive: f.alive.map(({ id, x, y }) => ({ id, x, y })) }; });
    assert.equal(nav.open, true);
    assert.deepEqual(nav.dots.map(({ id, x, y }) => ({ id, x, y })), nav.alive);
    const q0 = nav.quad, cell = { x: Math.floor(nav.width / 2) - 2, y: Math.floor(nav.height / 2) };
    await p.mouse.click(nav.rect.x + (cell.x + 0.5) / nav.width * nav.rect.w, nav.rect.y + (cell.y + 0.5) / nav.height * nav.rect.h);
    await warRest(p);
    const v1 = await view(p);
    assert.ok(Math.abs(v1.target[0] - (cell.x - (nav.width - 1) / 2)) < 0.6
      && Math.abs(v1.target[2] - (cell.y - (nav.height - 1) / 2 + 1)) < 0.6, `the view's middle is on the pressed cell: ${JSON.stringify(v1.target)}`);
    assert.notDeepEqual((await p.evaluate(() => window.__game.warNav.probe())).quad, q0, 'the frame on the minimap moved with it');
    // A double click on a general's card centres him and keeps the step (not on the map: see src/app.js).
    const dbl = await p.evaluate(() => { const w = window.__game.war, f = w.field, me = f.side(f.human)[0]; w.clickCell(me.x, me.y); w.centreOn(me.x > f.width / 2 ? me.x - 6 : me.x + 6, me.y); return { x: me.x, y: me.y }; });
    await warRest(p); const z0 = (await view(p)).zoom;
    await p.locator('.unitpanel:not(.compare) img').first().dblclick(); await warRest(p);
    const v2 = await view(p);
    assert.equal(v2.zoom, z0, 'the step is kept');
    assert.ok(Math.abs(v2.target[0] - (dbl.x - (nav.width - 1) / 2)) < 0.6, `a double click on his card brought him to the middle: ${JSON.stringify(v2.target)} for ${JSON.stringify(dbl)}`);
    await p.evaluate(() => window.__game.war.cancel());
    // C04: on the enemy's turn what he does inside the picture leaves the camera still; outside it, the camera slides to it at
    // the step it has; and once the player has moved the camera that turn, it stays his.
    const stop = closeMessages(p);
    try {
      const cast = (off) => p.evaluate(async (off) => {
        const w = window.__game.war, f = w.field, foe = f.units.find((u) => !u.gone && u.side !== f.human), me = f.side(f.human)[0], t0 = w.probe().view.target, z0 = w.viewState().zoom;
        const turn = f.turn; f.turn = foe.side;
        try { const run = w.playStrategy(foe, me, 2, { ok: true, hit: true, name: '虚兵', lines: ['测试'], hits: [] }); const t1 = w.probe().view.target; await run; return { moved: Math.hypot(t1[0] - t0[0], t1[2] - t0[2]), zoom: [z0, w.viewState().zoom], me: [me.x, me.y] }; } finally { f.turn = turn; }
      }, off);
      await p.evaluate(() => { const w = window.__game.war, me = w.field.side(w.field.human)[0]; w.centreOn(me.x, me.y); }); await warRest(p);
      const inside = await cast();
      assert.ok(inside.moved < 0.01, `a 计略 on a general in the picture moved the camera by ${inside.moved.toFixed(2)}`);
      await p.evaluate(() => { const w = window.__game.war, f = w.field, me = f.side(f.human)[0]; w.centreOn(me.x > f.width / 2 ? me.x - 14 : me.x + 14, me.y); }); await warRest(p);
      // the pan above was the player's, on his own turn: the enemy's next turn starts with the camera free to follow
      const outside = await cast(); await warRest(p);
      assert.ok(outside.moved > 1, `one outside the picture brings the camera over (it moved ${outside.moved.toFixed(2)})`);
      assert.equal(outside.zoom[1], outside.zoom[0], 'at the step it had');
      assert.equal(await p.evaluate(() => { const w = window.__game.war, me = w.field.side(w.field.human)[0], s = w.screenOf(me.x, me.y); return s.x > 0 && s.x < innerWidth && s.y > 0 && s.y < innerHeight; }), true, 'and he is in the picture');
      const hands = await p.evaluate(async () => {
        const w = window.__game.war, f = w.field, foe = f.units.find((u) => !u.gone && u.side !== f.human), me = f.side(f.human)[0], turn = f.turn; f.turn = foe.side;
        try { w.centreOn(me.x > f.width / 2 ? me.x - 14 : me.x + 14, me.y); const t0 = w.probe().view.target; const run = w.playStrategy(foe, me, 2, { ok: true, hit: true, name: '虚兵', lines: ['测试'], hits: [] }); const t1 = w.probe().view.target; await run; return Math.hypot(t1[0] - t0[0], t1[2] - t0[2]); } finally { f.turn = turn; }
      });
      assert.ok(hands < 0.01, `after the player moved the camera on the enemy's turn it is left alone (moved ${hands.toFixed(2)})`);
    } finally { stop(); }
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); await game.close(); game = null; }
});

// C06: the minimap covers none of the HUD; in a short window it starts put away and, opened, still covers none of it.
for (const [w, h] of [[1440, 900], [1024, 600], [1920, 1080]]) test(`the minimap is clear of the HUD at ${w}×${h}`, async () => {
  const p = await openWar({ width: w, height: h });
  try {
    const read = () => p.evaluate(() => {
      const r = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; }, mini = r(document.querySelector('.warmini'));
      const hit = [...document.querySelectorAll('.warbar, .logbox, .unitpanel, .wardock, .turnpair, .warzoom, .actpanel, .sysbtns, .sysmenu-btn, .deploybtn')].filter((e) => e.offsetParent && e.getBoundingClientRect().width).map((e) => [e.className, r(e)])
        .filter(([, b]) => b.l < mini.r && b.r > mini.l && b.t < mini.b && b.b > mini.t).map(([c]) => c);
      return { open: window.__game.warNav.open, mini, hit, vw: innerWidth, vh: innerHeight };
    });
    await p.evaluate(() => { const w = window.__game.war, me = w.field.side(w.field.human)[0]; w.clickCell(me.x, me.y); }); await p.waitForTimeout(400);
    let s = await read();
    assert.equal(s.open, h >= 680, 'short windows start with it put away');
    if (!s.open) { assert.deepEqual(s.hit, [], 'put away, its tab covers nothing'); await p.evaluate(() => window.__game.warNav.toggleMini()); await p.waitForTimeout(100); s = await read(); }
    assert.deepEqual(s.hit, [], `the minimap covers ${s.hit.join(', ')}`);
    assert.ok(s.mini.l >= 0 && s.mini.t >= 0 && s.mini.r <= s.vw && s.mini.b <= s.vh, 'and lies inside the window');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); await game.close(); game = null; }
});
