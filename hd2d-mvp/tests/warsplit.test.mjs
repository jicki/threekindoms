// The war map's 3D view (src/warview.js) split into modules under src/war/, each made from the shared object wv
// (docs/战场3D拆分实施计划_2026-11-13.md). First a static check, no browser: every module is there and called from the entry,
// none shadows wv, none imports another, and the rules core imports none of them. Then the plan's browser cases.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { startGame, newCampaign, closeMessages, warRest, skipIntro } from './game.mjs';
const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
export const MODULES = ['board', 'units', 'overlay', 'camera', 'pick', 'interact', 'play', 'probe'];
const cap = (m) => m[0].toUpperCase() + m.slice(1);

test('the war view is split into its modules', () => {
  for (const m of MODULES) {
    assert.ok(existsSync(new URL(`../src/war/${m}.js`, import.meta.url)), `src/war/${m}.js`);
    assert.match(src(`war/${m}.js`), new RegExp(`export function make${cap(m)}\\(wv\\)`), m);
    assert.match(src('warview.js'), new RegExp(`make${cap(m)}\\(wv\\)`), `warview.js calls make${cap(m)}`);
    assert.doesNotMatch(src(`war/${m}.js`), /\bconst \{[^}]*\bwv\b[^}]*\} = |\b(const|let) wv\b/, `${m}: nothing shadows wv`);
  }
  assert.ok(src('warview.js').split('\n').length <= 300, 'warview.js is the entry only');
});
test('a war module imports no other war module, and the rules import none of them', () => {
  for (const m of MODULES) assert.doesNotMatch(src(`war/${m}.js`), /from '\.\/(board|units|overlay|camera|pick|interact|play|probe)\.js'/, m);
  for (const f of readdirSync(new URL('../src/core/', import.meta.url)).filter((f) => f.endsWith('.js'))) assert.doesNotMatch(src(`core/${f}`), /from '\.\.\/(war\/|warview)/, f);
});

// --- Browser cases: each one presses on a seam the split could break unseen (a reassigned name copied into a module). ---
let game;
const pages = new Map();
// A war on the player's turn, 3D or (query '&flat') the flat painted map, opened once for the cases below, as tests/war.test.mjs
// opens one: the player attacks the strongest neighbouring AI city with three generals.
const war3d = () => warOn('');
async function warOn(query) {
  if (pages.has(query)) return pages.get(query);
  game ??= await startGame(); const page = await game.open(query, { clock: true }); pages.set(query, page);
  await newCampaign(page);
  await page.evaluate(() => {
    const { g, G, debug } = window.__game, home = g.factions[g.player].city;
    const to = G.roads(home).map((c) => g.cities[c]).filter((c) => c.faction !== g.player && c.faction !== G.NONE && c.officers.length).sort((a, b) => b.officers.length - a.officers.length)[0];
    for (const id of g.cities[home].officers) g.officers[id].soldiers ||= 500;
    for (const id of to.officers) g.officers[id].soldiers ||= 500;
    const ids = g.cities[home].officers.slice(0, 3);
    const w = debug.setupWar(g, { from: home, to: to.id, ids, commander: ids[0], gold: 100, rice: 400 });
    debug.fieldWar(w, 'att');
  });
  await page.waitForFunction(() => window.__game.war?.finishDeploy && document.body.dataset.screen === 'war', null, { timeout: 30000 });
  const stop = closeMessages(page);
  try {
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.__game.war.finishDeploy());
    await page.waitForFunction(() => { const f = window.__game.war.field; return f.turn === f.human && !document.querySelector('.banner, .panel.msg'); }, null, { timeout: 30000 });
  } finally { stop(); }
  return page;
}
after(() => game?.close());

// tacticalOn and lastFigs are reassigned in units.js and read elsewhere (Task 3): a copy of tacticalOn would leave a general
// added under the overview without his roundel, and only 笼络 (计略 id 8) adds one after the start, rebuilding its target.
test('a general added under the overview has his roundel, and the last figures are read after a declutter', async () => {
  const p = await war3d();
  const count = () => p.evaluate(() => { const w = window.__game.war, pr = w.probe(); return { roundels: pr.roundels, tags: pr.tags, figures: pr.figures().length, alive: w.field.alive.length }; });
  await p.evaluate(() => window.__game.war.tactical(true)); await warRest(p, { jump: true });
  let c = await count();
  assert.equal(c.roundels, c.alive, 'every general on the field has a roundel'); assert.equal(c.tags, 0, 'no name tag under the overview');
  await p.evaluate(async () => {
    const P = await import('./src/pace.js'), F = await import('./src/core/field.js'); P.setPace(4);
    const w = window.__game.war, f = w.field, me = f.alive.find((u) => u.side === f.human), foe = f.alive.find((u) => u.side !== f.human);
    await w.playStrategy(me, foe, 8, { ok: true, hit: true, name: F.STRATS[8].name, lines: ['测试'], hits: [] });
    P.setPace(1);
  });
  c = await count();
  assert.equal(c.roundels, c.alive, 'the general 笼络 rebuilt has his roundel too'); assert.equal(c.tags, 0, 'and no name tag');
  await p.evaluate(() => window.__game.war.tactical(false)); await warRest(p, { jump: true });
  c = await count();
  assert.equal(c.roundels, 0, 'no roundel once the overview is down');
  assert.equal(c.figures, c.alive, 'the figures declutter last saw are every general on the field');
  assert.deepEqual(p.errors, []);
});

// The range is data (overlay.js cells) that the 3D cells and the flat map both draw from (Task 4): the flat map builds no range
// meshes, and its marks are his reach (less his own cell) and the enemies he may strike, read off the rules, not off meshes.
test('the flat map draws its range from data and builds no range meshes', async () => {
  const select = (p) => p.evaluate(() => {
    const w = window.__game.war, f = w.field, me = f.alive.find((u) => u.side === f.human && !u.commander) ?? f.alive.find((u) => u.side === f.human);
    f.pool[f.human] = 30; w.hoverCell(null); w.clickCell(me.x, me.y);
    const want = [...w.st.reach.dist.keys()].filter((k) => k !== `${me.x},${me.y}`).concat(f.adjacentEnemies(me).map((e) => `${e.x},${e.y}`));
    return { flat: !!w.flat, want: [...new Set(want)].sort(), got: [...new Set(w.flatState().marks.map((m) => `${m.x},${m.y}`))].sort(), marks: w.flatState().marks, meshes: w.probe().rangeMeshes };
  });
  const fp = await warOn('&flat'), f = await select(fp);
  assert.equal(f.flat, true, 'the flat painted map');
  assert.ok(f.want.length > 0, 'he has a reach');
  assert.deepEqual(f.got, f.want, 'the flat marks are his reach and the enemies beside him');
  assert.equal(f.meshes, 0, 'the flat map builds no range meshes');
  const p = await war3d(), d = await select(p);
  assert.equal(d.flat, false);
  assert.equal(d.meshes, d.marks.filter((m) => m.kind !== 'path').length, 'one range mesh per range cell in 3D');
  // A hovered route adds path cells to the marks, not range meshes.
  const r = await p.evaluate(() => {
    const w = window.__game.war, f = w.field, me = w.st.sel;
    const k = [...w.st.reach.dist.keys()].find((k) => { const [x, y] = k.split(',').map(Number); return !f.unitAt(x, y) && w.st.reach.dist.get(k) > 1; });
    const [x, y] = k.split(',').map(Number); w.hoverCell({ x, y });
    const out = { marks: w.flatState().marks, meshes: w.probe().rangeMeshes, me: me.id }; w.hoverCell(null); return out;
  });
  assert.ok(r.marks.some((m) => m.kind === 'path'), 'the route shows');
  assert.equal(r.meshes, d.meshes, 'the route is not counted among the range meshes');
  assert.deepEqual(fp.errors, []); assert.deepEqual(p.errors, []);
});

// terrainOn is reassigned by setTerrainView (the entry's api) and read by pick.js's fade and the units' tags (Task 5): a copy would
// leave the ground view's ghosts and plaques on, or never fade at all. And under the overview pick takes no figure: looking straight
// down, one unit above a cell projects onto that cell itself, so the points tried are those over his picture, from his cell up to
// the cell behind it on screen, and each must give what the ground alone gives there (every figure taken off the board for that).
test('the ground view goes on and comes off, and the overview picks no figure', async () => {
  const p = await war3d();
  const frames = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const state = () => p.evaluate(() => { const w = window.__game.war, pr = w.probe(), alive = new Set(w.field.alive.filter((u) => !u.gone).map((u) => u.id)); return { grounds: pr.grounds.length, a: pr.opacity.filter((o) => alive.has(o.id)).map((o) => o.a) }; });
  await p.evaluate(() => { const w = window.__game.war; for (let i = 0; i < 8 && w.cancel(); i++); w.hoverCell(null); });
  await p.evaluate(() => window.__game.war.setTerrainView(true)); await frames();
  let s = await state();
  assert.ok(s.grounds > 0, 'the ground view puts up its terrain plaques');
  assert.ok(s.a.length > 0 && s.a.every((a) => a < 1), `every general fades in the ground view: ${s.a}`);
  await p.evaluate(() => window.__game.war.setTerrainView(false)); await p.waitForTimeout(300);
  await p.waitForFunction(() => { const pr = window.__game.war.probe(); return pr.grounds.length === 0 && pr.opacity.every((o) => o.a === 1); }, null, { timeout: 10000 }).catch(() => {});
  s = await state();
  assert.equal(s.grounds, 0, 'the plaques come off with the ground view');
  assert.ok(s.a.every((a) => a === 1), `every general is whole again: ${s.a}`);

  await p.evaluate(() => window.__game.war.tactical(true)); await warRest(p, { jump: true });
  const r = await p.evaluate(() => {
    const w = window.__game.war, f = w.field, out = [], ndc = (px, py) => ({ x: px / innerWidth * 2 - 1, y: 1 - py / innerHeight * 2 });
    const pts = f.alive.filter((u) => !u.gone && w.spriteOf(u)?.parent).flatMap((u) => { const s = w.screenOf(u.x, u.y); return [0.1, 0.3, 0.5, 0.55, 0.6, 0.7, 0.9].flatMap((k) => [-0.15, 0, 0.15].map((dx) => ({ u, at: ndc(s.x + dx * s.cw / 2, s.y - s.ch * k) }))); });
    const seen = pts.map(({ at }) => w.hover(at));
    const off = f.alive.map((u) => w.spriteOf(u)).filter((g) => g?.parent).map((g) => [g, g.parent]); for (const [g, by] of off) by.remove(g);
    const bare = pts.map(({ at }) => w.hover(at));
    for (const [g, by] of off) by.add(g);
    pts.forEach(({ u }, i) => out.push({ id: u.id, own: `${u.x},${u.y}`, got: seen[i] && `${seen[i].x},${seen[i].y}`, through: seen[i]?.through?.id ?? null, ground: bare[i] && `${bare[i].x},${bare[i].y}` }));
    w.hoverCell(null); return out;
  });
  await p.evaluate(() => window.__game.war.tactical(false)); await warRest(p, { jump: true });
  assert.ok(r.some((o) => o.ground && o.ground !== o.own), 'some points tried lie over the ground behind a general');
  assert.deepEqual(r.filter((o) => o.got !== o.ground || o.through != null), [], 'under the overview the pointer reaches the ground, never a figure');
  assert.deepEqual(p.errors, []);
});

// The camera (Task 6) keeps one snapshot of the view for what puts it back: the overview (Tab) coming down turns, tilts and
// steps back to the view it covered; a 计略's target choice, framed on its targets, gives the view back once the choice is put away;
// and a close-up (focusPair, the 白兵's lead-in) gives back its distance and centre.
test('the overview, a 计略\'s framing and a close-up each give the view back', async () => {
  const p = await war3d();
  const pose = () => p.evaluate(() => { const v = window.__game.war.probe().view; return { yaw: v.yaw, zoom: v.zoom, dist: v.dist, target: v.target }; });
  const off = (a, b) => Math.max(Math.abs(a.yaw - b.yaw), Math.abs(a.dist - b.dist), ...a.target.map((x, i) => Math.abs(x - b.target[i])));
  const same = (a, b, what) => { assert.equal(b.zoom, a.zoom, `${what}: the step`); assert.ok(off(a, b) <= 0.01, `${what}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`); };
  await p.evaluate(() => { const w = window.__game.war; for (let i = 0; i < 8 && w.cancel(); i++); w.hoverCell(null); w.overview(); });
  await warRest(p, { jump: true });
  // At 中, a quarter turn round: Tab looks straight down from the board's own square angle, so it has a turn to give back.
  await p.evaluate(() => { const w = window.__game.war; w.zoom(-100); w.zoom(-100); w.rotate(1); });
  await warRest(p, { jump: true });
  let a = await pose();
  assert.equal(a.zoom, 'mid');
  await p.evaluate(() => window.__game.war.tactical(true)); await warRest(p, { jump: true });
  const top = await pose();
  assert.ok(top.zoom === 'whole' && off(a, top) > 0.5, 'the overview moved the camera');
  await p.evaluate(() => window.__game.war.tactical(false)); await warRest(p, { jump: true });
  same(a, await pose(), 'the overview down');

  // One of ours with a 计略 that has a legal target, picked at 近: the choice frames him and his targets at 中.
  const pick = await p.evaluate(() => {
    const w = window.__game.war, f = w.field; f.pool[f.human] = 30;
    const ours = f.alive.filter((u) => u.side === f.human).sort((x, y) => f.O(y.id).int - f.O(x.id).int);
    const can = (u, id) => f.alive.some((e) => f.legal(u, id, e) && f.canCast(u, id, e));
    let got = null;
    for (const u of ours) for (const s of f.strategies(u)) if (!got && s.id !== 11 && can(u, s.id)) got = { u, id: s.id };
    // None in reach at the start: a foe is set down two to four cells from our best mind, on a cell where his first 计略 takes him.
    const me = ours[0], foe = f.alive.find((u) => u.side !== f.human), id = f.strategies(me).find((s) => s.id !== 11)?.id;
    for (let d = 2; !got && id != null && d <= 4; d++) for (let dy = -d; !got && dy <= d; dy++) for (let dx = -d; !got && dx <= d; dx++) {
      const x = me.x + dx, y = me.y + dy, [hx, hy] = [foe.x, foe.y];
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== d || !f.inside(x, y) || f.unitAt(x, y)) continue;
      foe.x = x; foe.y = y;
      if (can(me, id)) { got = { u: me, id }; w.spriteOf(foe)?.position.set(x - 15.5, w.probe().top(x, y), y - 9); } else { foe.x = hx; foe.y = hy; }
    }
    if (!got) return null;
    w.clickCell(got.u.x, got.u.y); return { id: got.id, u: got.u.id };
  });
  assert.ok(pick, 'one of ours can cast a 计略 on someone');
  await p.evaluate(() => { const w = window.__game.war; w.zoom(-100); });
  await p.waitForTimeout(800); await warRest(p, { jump: true });
  a = await pose();
  assert.equal(a.zoom, 'near');
  await p.evaluate((id) => { const w = window.__game.war; w.openStrategies(); w.chooseStrategy(id); }, pick.id);
  await warRest(p, { jump: true });
  const framed = await pose();
  assert.ok(await p.evaluate(() => window.__game.war.st.cast != null), 'choosing its target');
  assert.ok(off(a, framed) > 0.5, `the choice framed his targets: ${JSON.stringify(a)} → ${JSON.stringify(framed)}`);
  await p.evaluate(() => { const w = window.__game.war; w.cancel(); w.cancel(); });
  await warRest(p, { jump: true });
  assert.equal(await p.evaluate(() => window.__game.war.st.cast ?? null), null);
  same(a, await pose(), 'the 计略 put away');

  // A close-up on him and a foe beside, then its way back.
  a = await pose();
  await p.evaluate(async () => { const w = window.__game.war, f = w.field, me = w.st.sel, foe = f.alive.find((u) => u.side !== f.human); window.__back = await w.focusPair(me, foe); });
  const close = await pose();
  assert.ok(off(a, close) > 0.5, 'the close-up moved the camera');
  await p.evaluate(() => { window.__back(); delete window.__back; }); await warRest(p, { jump: true });
  same(a, await pose(), 'the close-up over');

  await p.evaluate(() => { const w = window.__game.war; for (let i = 0; i < 8 && w.cancel(); i++); w.overview(); });
  await warRest(p, { jump: true });
  assert.deepEqual(p.errors, []);
});

// What the screen would show at some other pose (the step's fit, the ground in view, the least slide that brings a general into
// the clear) is worked out on a spare camera (Task 6): the real one, the pointer's and the picture's, is never posed for a sum. The
// lookAt count and the three sums sit in one evaluate, so no frame's own placeCamera falls between them.
test('working out a framing never moves the real camera', async () => {
  const p = await war3d();
  await p.evaluate(() => { const w = window.__game.war; for (let i = 0; i < 8 && w.cancel(); i++); w.hoverCell(null); w.overview(); });
  await warRest(p, { jump: true });
  await p.evaluate(() => { const w = window.__game.war; w.zoom(-100); w.zoom(-100); w.zoom(-100); });
  await warRest(p, { jump: true });
  const r = await p.evaluate(() => {
    const w = window.__game.war, c = w.camera, f = w.field;
    const t = f.alive.filter((u) => !u.gone).find((u) => { const s = w.screenOf(u.x, u.y); return s.x < 0 || s.x > innerWidth || s.y < 0 || s.y > innerHeight; });
    const goal = w.probe().view.target;
    let n = 0; const look = c.lookAt;
    c.lookAt = function (...a) { n++; return look.apply(this, a); };
    let fit, over;
    try { fit = w.probe().fitDist(); over = w.probe().view.over; if (t) w.keepInView(t); } finally { delete c.lookAt; }
    return { n, fit, over, t: t?.id ?? null, slid: w.probe().view.target.some((x, i) => Math.abs(x - goal[i]) > 1e-6), own: Object.hasOwn(c, 'lookAt') };
  });
  assert.ok(r.t != null, 'a general stands off the screen at 近');
  assert.ok(Number.isFinite(r.fit) && Number.isFinite(r.over), `the sums ran: fit ${r.fit}, over ${r.over}`);
  assert.ok(r.slid, 'keepInView slid the view toward him');
  assert.equal(r.n, 0, `the real camera was posed ${r.n} times for the sums`);
  assert.equal(r.own, false);
  await p.evaluate(() => window.__game.war.overview()); await warRest(p, { jump: true });
  assert.deepEqual(p.errors, []);
});

// The player's step (Task 7): st.stage, a read-only name for where the player is, read off the fields interact.js keeps. This
// case opens its own war, as war3d() does, but stays on the 布阵 to see that step first.
test('st.stage names the step the player is on', async () => {
  game ??= await startGame(); const p = await game.open('', { clock: true });
  try {
    await newCampaign(p);
    await p.evaluate(() => {
      const { g, G, debug } = window.__game, home = g.factions[g.player].city;
      const to = G.roads(home).map((c) => g.cities[c]).filter((c) => c.faction !== g.player && c.faction !== G.NONE && c.officers.length).sort((a, b) => b.officers.length - a.officers.length)[0];
      for (const id of g.cities[home].officers) g.officers[id].soldiers ||= 500;
      for (const id of to.officers) g.officers[id].soldiers ||= 500;
      const ids = g.cities[home].officers.slice(0, 3);
      const w = debug.setupWar(g, { from: home, to: to.id, ids, commander: ids[0], gold: 100, rice: 400 });
      debug.fieldWar(w, 'att');
    });
    await p.waitForFunction(() => window.__game.war?.st.deploying && document.body.dataset.screen === 'war', null, { timeout: 30000 });
    const stage = () => p.evaluate(() => window.__game.war.st.stage);
    assert.equal(await stage(), 'deploying');
    const stop = closeMessages(p);
    try {
      await p.evaluate(() => window.__game.war.finishDeploy());
      await p.waitForFunction(() => { const w = window.__game.war, f = w.field; return f.turn === f.human && !w.st.busy && !document.querySelector('.banner, .panel.msg'); }, null, { timeout: 30000 });
    } finally { stop(); }
    await p.evaluate(() => window.__game.war.overview());
    assert.equal(await stage(), 'idle');

    // One of ours with a 计略 that has a legal target (set up as the Task 6 case does), through its steps and back.
    const pick = await p.evaluate(() => {
      const w = window.__game.war, f = w.field; f.pool[f.human] = 30;
      const ours = f.alive.filter((u) => u.side === f.human).sort((x, y) => f.O(y.id).int - f.O(x.id).int);
      const can = (u, id) => f.alive.some((e) => f.legal(u, id, e) && f.canCast(u, id, e));
      let got = null;
      for (const u of ours) for (const s of f.strategies(u)) if (!got && s.id !== 11 && can(u, s.id)) got = { u, id: s.id };
      const me = ours[0], foe = f.alive.find((u) => u.side !== f.human), id = f.strategies(me).find((s) => s.id !== 11)?.id;
      for (let d = 2; !got && id != null && d <= 4; d++) for (let dy = -d; !got && dy <= d; dy++) for (let dx = -d; !got && dx <= d; dx++) {
        const x = me.x + dx, y = me.y + dy, [hx, hy] = [foe.x, foe.y];
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== d || !f.inside(x, y) || f.unitAt(x, y)) continue;
        foe.x = x; foe.y = y;
        if (can(me, id)) { got = { u: me, id }; w.spriteOf(foe)?.position.set(x - 15.5, w.probe().top(x, y), y - 9); } else { foe.x = hx; foe.y = hy; }
      }
      if (!got) return null;
      const t = f.alive.find((e) => f.legal(got.u, got.id, e) && f.canCast(got.u, got.id, e));
      return { u: got.u.id, id: got.id, at: [got.u.x, got.u.y], t: [t.x, t.y] };
    });
    assert.ok(pick, 'one of ours can cast a 计略 on someone');
    const steps = await p.evaluate(({ id, at, t }) => {
      const w = window.__game.war, out = [], see = () => out.push(w.st.stage);
      w.clickCell(...at); see();
      w.openStrategies(); see();
      w.chooseStrategy(id); see();
      w.clickCell(...t); see();
      for (let i = 0; i < 4; i++) { w.cancel(); see(); }
      return out;
    }, pick);
    assert.deepEqual(steps, ['cmds', 'strats', 'targets', 'confirm', 'targets', 'strats', 'cmds', 'idle']);

    // Two foes set down beside one of ours: 攻击 lists them, and one picked from the list is asked about.
    const strike = await p.evaluate(() => {
      const w = window.__game.war, f = w.field, me = f.alive.find((u) => u.side === f.human), foes = f.alive.filter((u) => u.side !== f.human);
      const free = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [me.x + dx, me.y + dy]).filter(([x, y]) => f.inside(x, y) && !f.unitAt(x, y));
      for (const [i, [x, y]] of free.slice(0, 2).entries()) { const e = foes.find((u) => !f.adjacentEnemies(me).includes(u)); e.x = x; e.y = y; w.spriteOf(e)?.position.set(x - 15.5, w.probe().top(x, y), y - 9); }
      f.pool[f.human] = 30;
      const out = [], see = () => out.push(w.st.stage), adj = f.adjacentEnemies(me);
      w.clickCell(me.x, me.y); see();
      w.openAttacks(); see();
      w.clickCell(adj[0].x, adj[0].y); see();
      for (let i = 0; i < 3; i++) { w.cancel(); see(); }
      // With none of ours selected, a click on a foe only looks at him.
      w.clickCell(adj[0].x, adj[0].y); see();
      w.cancel(); see();
      return { n: adj.length, out };
    });
    assert.equal(strike.n, 2, 'two foes beside him');
    assert.deepEqual(strike.out, ['cmds', 'attacks', 'strike', 'attacks', 'cmds', 'idle', 'peek', 'idle']);

    // Written straight into st, as tests do, the stage follows.
    const raw = await p.evaluate(() => {
      const w = window.__game.war, f = w.field, me = f.alive.find((u) => u.side === f.human), out = [];
      w.clickCell(me.x, me.y); out.push(w.st.stage);
      w.st.sel = null; out.push(w.st.stage);
      w.st.busy = true; out.push(w.st.stage); w.st.busy = false;
      out.push(w.st.stage);
      return out;
    });
    assert.deepEqual(raw, ['cmds', 'idle', 'busy', 'idle']);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

// dispose() frees what every module made (Task 8): each module hands back its own disposeXxx and the entry calls them in the old
// order. tests/gpu.test.mjs ('the same war fought again …') already asserts the third war's count equals the second's when dispose()
// is called by hand, so this case asserts only no growth from the second war to the third, each war ended the way a player ends
// it: everyone retreats, the result is closed, and the app's own end of war disposes the view on the way back to the strategy map.
// Each war first shows his range cells and the overview's roundels, so a module's dispose left out shows here. Neither count
// grows: drop() (units.js) frees a retreated figure as it takes him off the scene, where dispose()'s walk would no longer reach
// him, and disposeUnits() frees the geometry the roundels share (both leaked until 2026-11-13).
test('three wars leave no more geometries and textures than one', async (t) => {
  game ??= await startGame(); const p = await game.open('', { clock: true });
  try {
    await newCampaign(p);
    await p.waitForTimeout(1500);
    const before = await p.evaluate(() => { const { geometries, textures } = window.__game.debug.renderer.info.memory; return { geometries, textures }; });
    const seen = [];
    for (let i = 0; i < 3; i++) {
      await p.evaluate(() => {
        const { g, debug } = window.__game; // each round starts from the same campaign, so the war is the same (as tests/gpu.test.mjs)
        if (!window.__snap) window.__snap = structuredClone(g); else { for (const k of Object.keys(g)) delete g[k]; Object.assign(g, structuredClone(window.__snap)); }
        const cs = g.cities, k = 2, to = cs[k];
        const from = cs.findIndex((c, j) => j !== k && c.officers.length > 2 && c.faction !== to.faction && c.faction !== 0);
        if (!to.officers.length) { const donor = cs.find((c, j) => j !== k && j !== from && c.officers.length > 1 && c.faction !== cs[from].faction && c.faction !== 0); to.faction = donor.faction; to.officers = donor.officers.splice(0, 2); }
        for (const id of [...cs[from].officers, ...to.officers]) g.officers[id].soldiers ||= 500;
        const ids = cs[from].officers.slice(0, 3);
        debug.fieldWar(debug.setupWar(g, { from, to: k, ids, commander: ids[0], gold: 0, rice: Math.min(cs[from].rice, 600) }), 'att');
      });
      await p.waitForFunction(() => window.__game.war?.finishDeploy && document.body.dataset.screen === 'war', null, { timeout: 60000 });
      const stop = closeMessages(p);
      try {
        await p.waitForTimeout(2500); // the board has rendered: its sky, shadow map and pieces are uploaded
        await p.evaluate(() => window.__game.war.finishDeploy());
        await p.waitForFunction(() => { const f = window.__game.war.field; return f.turn === f.human && !window.__game.war.st.busy && !document.querySelector('.banner, .panel.msg'); }, null, { timeout: 30000 });
        await p.evaluate(() => { const w = window.__game.war, f = w.field, me = f.side(f.human)[0]; w.clickCell(me.x, me.y); w.tactical(true); });
        await warRest(p, { jump: true });
        await p.evaluate(() => window.__game.war.tactical(false)); await warRest(p, { jump: true });
        await p.evaluate(() => {
          const w = window.__game.war, f = w.field; for (let j = 0; j < 8 && w.cancel(); j++);
          const ours = f.side(f.human).filter((x) => !x.gone);
          window.__left = ours.map((u) => w.spriteOf(u));
          for (const u of [...ours.filter((x) => !x.commander), ...ours.filter((x) => x.commander)]) w.retreat(f.retreatTargets(u)[0], u);
        });
        const back = p.getByRole('button', { name: '返回大地图', exact: true });
        await back.waitFor({ timeout: 30000 });
        await p.waitForFunction(() => window.__left.every((g) => !g.parent), null, { timeout: 10000 });
        await back.click();
        await p.waitForFunction(() => !window.__game.war && document.body.dataset.screen === 'strategy', null, { timeout: 30000 });
        await p.waitForTimeout(1500);
      } finally { stop(); }
      seen.push({ ...await p.evaluate(() => { const { geometries, textures } = window.__game.debug.renderer.info.memory; return { geometries, textures }; }) });
    }
    t.diagnostic(`before the first war: ${JSON.stringify(before)}; after each war: ${JSON.stringify(seen)}`);
    assert.ok(seen[2].textures <= seen[1].textures, `textures after each war: ${JSON.stringify(seen)}`);
    assert.ok(seen[2].geometries <= seen[1].geometries, `geometries after each war: ${JSON.stringify(seen)}`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

// A war broken off (战场中断) is rebuilt from ctx.yaw (src/app.js suspendWar → fieldWar): the camera's turn is set before the
// first frame, so the resumed view's yawGoal must be the one the player left, not pickYaw's choice (Task 9, R05). Its own page:
// the title it goes back to would end the shared war the cases above use.
// Opens a war on the player's turn, lets `before` arrange it, breaks it off to the title and takes it up again.
async function brokenOffAndResumed(before, then) {
  game ??= await startGame(); const p = await game.open();
  const idle = () => p.waitForFunction(() => { const w = window.__game.war, f = w?.field; return f && f.turn === f.human && !w.st.busy && !w.st.deploying && !document.querySelector('.banner, .panel.msg, .shade, #fade.on'); }, null, { timeout: 60000 });
  try {
    await newCampaign(p);
    await p.evaluate(() => {
      const { g, G, debug } = window.__game, home = g.factions[g.player].city;
      const to = G.roads(home).map((c) => g.cities[c]).filter((c) => c.faction !== g.player && c.faction !== G.NONE && c.officers.length).sort((a, b) => b.officers.length - a.officers.length)[0];
      for (const id of [...g.cities[home].officers, ...to.officers]) g.officers[id].soldiers ||= 500;
      const ids = g.cities[home].officers.slice(0, 3);
      debug.fieldWar(debug.setupWar(g, { from: home, to: to.id, ids, commander: ids[0], gold: 100, rice: 400 }), 'att');
    });
    let stop = closeMessages(p);
    try {
      await p.waitForFunction(() => window.__game.war?.st.deploying && document.body.dataset.screen === 'war' && !document.querySelector('.banner, .panel.msg, #fade.on'), null, { timeout: 60000 });
      await p.locator('.deploybtn .btn', { hasText: '布阵完成' }).click();
      await idle();
    } finally { stop(); }
    const left = await before(p);
    await p.click('.sysmenu-btn'); await p.locator('.sysmenu-list button', { hasText: '中断战斗' }).click();
    await p.locator('.shade .btn', { hasText: '中断并回到标题' }).click();
    await p.waitForFunction(() => document.body.dataset.screen === 'title' && window.__game?.debug, null, { timeout: 60000 });
    await skipIntro(p);
    await p.locator('button', { hasText: '继续战斗' }).click();
    stop = closeMessages(p); try { await idle(); } finally { stop(); }
    await then(p, left);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
}
test('a war broken off and taken up again faces the way it was left', async () => {
  await brokenOffAndResumed(async (p) => {
      // A quarter turn, left to settle, so the view left is not the one pickYaw would choose for this board.
      const chosen = await p.evaluate(() => window.__game.war.probe().view.yawGoal);
      await p.evaluate(() => window.__game.war.rotate(1));
      await p.waitForFunction(() => { const v = window.__game.war.probe().view; return Math.abs(v.yaw - v.yawGoal) < 1e-4; }, null, { timeout: 5000 });
      const left = await p.evaluate(() => window.__game.war.probe().view.yawGoal);
      assert.ok(Math.abs(left - chosen) > 0.5, 'the turn moved the view off its first choice');
      return left;
  }, async (p, left) => {
      const v = await p.evaluate(() => { const w = window.__game.war; return { resumed: w.field.resumed, ...w.probe().view }; });
      assert.equal(v.resumed, true);
      assert.equal(v.yawGoal, left, 'probe().view.yawGoal is the one left');
      assert.ok(Math.abs(v.yaw - left) < 1e-9, 'and the camera stands there, with no turn to it');
  });
});
// The view's start-up loop tagged each general before the 奇门 note and ring it reads were made, so a war broken off with one
// trapped could not be built again (a const read before its line). Found reading the code during the split (2026-11-13).
test('a war broken off with a general in 奇门遁甲 is taken up again, his tag and ring as they were', async () => {
  await brokenOffAndResumed(async (p) => p.evaluate(() => {
    const w = window.__game.war, f = w.field, foe = f.units.find((u) => !u.gone && u.side !== f.human);
    foe.qimen = 4; w.refreshTags(); return foe.id;
  }), async (p, id) => {
    const u = await p.evaluate((id) => { const w = window.__game.war, u = w.field.units.find((x) => x.id === id); let ring = false; w.spriteOf(u).traverse((o) => { if (o.isMesh && o.visible && o.geometry.parameters?.width === 1.7) ring = true; }); return { qimen: u.qimen, ring, tag: document.querySelector('.tag .st.qimen')?.textContent ?? null }; }, id);
    assert.equal(u.qimen, 4);
    assert.ok(u.tag, `his tag carries the 奇门 note: ${JSON.stringify(u)}`);
    assert.equal(u.ring, true, `and the stone ring lies at his feet: ${JSON.stringify(u)}`);
  });
});
