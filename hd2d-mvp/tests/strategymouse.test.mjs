// The 战略地图 under the mouse (猫污染@devblog, D52/D53 of 2026-11-13): on the 3D map a left drag slides the board with the pointer
// and a right drag turns it; a drag that begins on a city tag moves the map as from the ground beside it and selects nothing, a
// press that stays put selects; a city the mouse picks comes out from under the HUD by the least slide, at the same turn and
// distance, and one already in the clear leaves the view where it was. The flat map's tags and picks behave the same.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, newCampaign } from './game.mjs';

let game;
before(async () => { game = await startGame({ width: 1440, height: 900 }); });
after(() => game?.close());

const openMap = async (query) => {
  const page = await game.open(query);
  await page.evaluate(async () => { (await import('./src/pace.js')).setPace(4); (await import('./src/vignette.js')).setVignettes(false); });
  await newCampaign(page, '曹操');
  await page.waitForTimeout(1200);
  return page;
};
const view = (page) => page.evaluate(() => { const s = window.__game.strategy; return s.flat ? s.viewState() : s.debugView(); });
const panelName = (page) => page.evaluate(() => document.querySelector('.citypanel header h2')?.textContent ?? null);
const drag = async (page, x, y, dx, dy, button = 'left') => {
  await page.mouse.move(x, y); await page.mouse.down({ button });
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + dx * i / 8, y + dy * i / 8);
  await page.mouse.up({ button }); await page.waitForTimeout(1400);
};
// A spot of bare map in the middle of the window, and a city tag there that the pointer can reach.
const bareSpot = (page) => page.evaluate(() => {
  const cv = window.__game.debug.renderer.domElement;
  for (let y = 300; y < innerHeight - 220; y += 20) for (let x = 450; x < innerWidth - 400; x += 20) if (document.elementFromPoint(x, y) === cv) return { x, y };
  return null;
});
const tagAt = (page, name) => page.evaluate((name) => {
  const s = window.__game.strategy, { g, G } = window.__game;
  return [...document.querySelectorAll(s.flat ? '.flatstrategy .ctag' : '.labels .ctag')].map((el) => {
    const b = el.getBoundingClientRect(), x = (b.left + b.right) / 2, y = (b.top + b.bottom) / 2, hit = document.elementFromPoint(x, y);
    const c = g.cities.find((c) => el.textContent.startsWith(G.cityName(c.id)));
    return { id: c?.id, name: c && G.cityName(c.id), x, y, ok: b.width > 0 && (hit === el || el.contains(hit)) };
  }).find((p) => p.ok && p.id != null && (name ? p.name === name : p.x > 500 && p.x < innerWidth - 400 && p.y > 300 && p.y < innerHeight - 250)) ?? null;
}, name);
const nearestCity = (page, at) => page.evaluate((at) => {
  const s = window.__game.strategy; let best = null;
  for (const c of window.__game.g.cities) { const p = s.screenOfCity(c.id), d = Math.hypot(p.x - at.x, p.y - at.y); if (!p.off && (!best || d < best.d)) best = { id: c.id, d }; }
  return best.id;
}, at);
const screenOf = (page, id) => page.evaluate((id) => window.__game.strategy.screenOfCity(id), id);
const cameraAtRest = (page, id) => page.waitForFunction((id) => {
  const s = window.__game.strategy, current = s.screenOfCity(id), target = s.screenAtRest(id);
  return Math.hypot(current.x - target.x, current.y - target.y) < 0.4;
}, id);
// Whether a city's tag lies over any HUD panel.
const tagCovered = (page, id) => page.evaluate((id) => {
  const t = window.__game.strategy.tagOf(id).getBoundingClientRect();
  return [...document.querySelectorAll('#ui .panel, #ui .endturn, .sysmenu-btn')].map((e) => e.getBoundingClientRect())
    .some((r) => r.width && t.right > r.left && t.left < r.right && t.bottom > r.top && t.top < r.bottom);
}, id);

// Puts a city's spot at (x, y) on screen with nothing selected, as a pan of the player's would.
const placeCity = async (page, id, x, y) => {
  const bare = await bareSpot(page); await page.mouse.click(bare.x, bare.y); await page.waitForTimeout(300);
  await page.evaluate(({ id, x, y }) => { const s = window.__game.strategy, p = s.screenAtRest(id); s.nudge(id, x - p.x, y - p.y); }, { id, x, y });
  await cameraAtRest(page, id);
};

async function picks(page, kind) {
  // Under the city panel's corner: the pick slides it out by the least, nothing else changes.
  const home = await page.evaluate(() => window.__game.g.factions[window.__game.g.player].city);
  const foe = await page.evaluate((home) => window.__game.G.roads(home)[0], home);
  await placeCity(page, foe, 180, 200);
  const t = await page.evaluate((id) => { const b = window.__game.strategy.tagOf(id).getBoundingClientRect(); return { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 }; }, foe);
  assert.ok(t.x < 330 && t.y < 280, `${kind}: placed where the panel will go: ${JSON.stringify(t)}`);
  const a = await view(page);
  const label = await page.evaluateHandle((id) => window.__game.strategy.tagOf(id), foe);
  try { await label.asElement().click(); } finally { await label.dispose(); }
  await page.waitForFunction(() => !!document.querySelector('.citypanel'));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await cameraAtRest(page, foe);
  const b = await view(page);
  assert.equal(await panelName(page), await page.evaluate((id) => window.__game.G.cityName(id), foe), `${kind}: the tag picked its city`);
  assert.equal(await tagCovered(page, foe), false, `${kind}: the picked city's tag is clear of the HUD`);
  const p = await screenOf(page, foe);
  assert.ok(p.y > 300 || p.x > 352, `${kind}: it was under the panel and slid out: ${JSON.stringify(p)}`);
  assert.ok(p.x > 20 && p.x < 760 && p.y > 20 && p.y < 760, `${kind}: it came out nearby, not to the middle: ${JSON.stringify(p)}`);
  if (kind === '3d') assert.deepEqual([b.yaw, b.dist, b.bias].map((v) => v.toFixed(3)), [a.yaw, a.dist, a.bias].map((v) => v.toFixed(3)), '3d: same turn, tilt and distance');
  else assert.equal(b.k, a.k, 'flat: same zoom');

  // A city in the clear: the view stays.
  // 先将据点移到明确可点击的空白处。简洁城签会改变避让幅度，视口中央未必恰好有另一座城。
  await placeCity(page, foe, 720, 300);
  const mid = await tagAt(page, await page.evaluate((id) => window.__game.G.cityName(id), foe));
  assert.ok(mid, `${kind}: the city in the clear is reachable`);
  const c = await view(page);
  await page.mouse.click(mid.x, mid.y);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await cameraAtRest(page, foe);
  assert.equal(await panelName(page), mid.name);
  const round = (v) => JSON.stringify(v, (k, x) => (typeof x === 'number' ? Math.round(x * 100) / 100 : x));
  assert.equal(round(await view(page)), round(c), `${kind}: a city in the clear leaves the view where it is`);
}

async function tagDrag(page, kind) {
  const tag = await tagAt(page), was = await panelName(page), a = await view(page);
  const p0 = await screenOf(page, tag.id);
  await drag(page, tag.x, tag.y, -150, -70);
  const p1 = await screenOf(page, tag.id);
  assert.equal(await panelName(page), was, `${kind}: a drag from a tag selects nothing`);
  assert.notDeepEqual(JSON.stringify(await view(page)), JSON.stringify(a), `${kind}: a drag from a tag moves the map`);
  assert.ok(p1.x - p0.x < -100 && p1.y - p0.y < -40, `${kind}: the tag went with the pointer: ${JSON.stringify([p0, p1])}`);
  const t = await tagAt(page, tag.name);
  await page.mouse.click(t.x, t.y); await page.waitForTimeout(600);
  assert.equal(await panelName(page), tag.name, `${kind}: a press that stays put selects`);
}

test('3D: the left drag slides the board with the pointer, the right drag turns it; tags drag the map; picks come clear of the HUD', async () => {
  const page = await openMap('');
  assert.equal(await page.evaluate(() => window.__game.strategy.kind), '3d');
  // The ground under the pointer goes with it, near and far, turned or not (the first 6 px tell a drag from a click).
  for (const [turn, zoom] of [[0, 0], [150, -99999], [-150, 99999]]) {
    if (turn) { await page.evaluate(([t, z]) => { const s = window.__game.strategy; s.orbit(t, 0); s.zoom(z); }, [turn, zoom]); await page.waitForTimeout(1800); }
    const at = await bareSpot(page), c = await nearestCity(page, at), a = await view(page), p0 = await screenOf(page, c);
    await drag(page, at.x, at.y, 180, 80);
    const b = await view(page), p1 = await screenOf(page, c);
    assert.equal(b.yaw.toFixed(3), a.yaw.toFixed(3), 'a left drag does not turn'); assert.equal(b.bias.toFixed(3), a.bias.toFixed(3), 'nor tilt');
    const dx = p1.x - p0.x, dy = p1.y - p0.y;
    assert.ok(dx > 120 && dx < 260 && dy > 45 && dy < 130, `the city moved with the pointer (${turn}, ${zoom}): ${dx}, ${dy}`);
  }
  await page.evaluate(() => window.__game.strategy.resetView(window.__game.g.factions[window.__game.g.player].city, { instant: true }));
  await page.waitForTimeout(600);
  const at = await bareSpot(page), a = await view(page);
  await drag(page, at.x, at.y, 130, 60, 'right');
  const b = await view(page);
  assert.ok(Math.abs(b.yaw - a.yaw) > 0.4 && b.bias > a.bias, `a right drag turns and tilts: ${JSON.stringify([a, b])}`);
  assert.deepEqual(b.target.map((v) => v.toFixed(2)), a.target.map((v) => v.toFixed(2)), 'about the point looked at');
  await tagDrag(page, '3d');
  await page.evaluate(() => window.__game.strategy.resetView(window.__game.g.factions[window.__game.g.player].city, { instant: true }));
  await picks(page, '3d');
  assert.deepEqual(page.errors ?? [], []);
  await page.context().close();
});

test('flat: tags drag the map, a press selects; picks come clear of the HUD', async () => {
  const page = await openMap('&flat');
  assert.equal(await page.evaluate(() => window.__game.strategy.kind), 'flat');
  await page.mouse.move(720, 450); for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -400);
  await page.waitForTimeout(1600);
  await tagDrag(page, 'flat');
  await picks(page, 'flat');
  assert.deepEqual(page.errors ?? [], []);
  await page.context().close();
});
