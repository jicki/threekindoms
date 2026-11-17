// The 战略地图 at low picture quality (src/strategyflat.js): a pre-rendered seasonal board on a canvas with pan, zoom,
// hit-testing and the DOM city tags. Most tests open it with &flat, which pins it; the last ones go through the 画质 setting and the runtime switch.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startGame, newCampaign, closeMessages, skipIntro, saveCampaign, timeScale } from './game.mjs';

const board = JSON.parse(readFileSync(new URL('../assets/ai/sandtable/flat/board.json', import.meta.url)));
const territoryCells = () => {
  const t = board.tint.territory, packed = Buffer.from(t.city, 'base64'); if (t.encoding !== 'rle8') return packed;
  const out = Buffer.alloc(t.w * t.h); let at = 0;
  for (let i = 0; i < packed.length; i += 2) { out.fill(packed[i], at, at + packed[i + 1]); at += packed[i + 1]; }
  assert.equal(at, out.length); return out;
};
const { x0, y0, x1, y1 } = board.bounds;
const fit = (w, h) => Math.min(w / (x1 - x0), h / (y1 - y0));

let game, page;
before(async () => { game = await startGame({ width: 1440, height: 900, scenario: 'original' }); page = await game.open('&flat', { clock: true }); await newCampaign(page, '董卓'); }, { timeout: 180000 });
after(() => game?.close());

const view = () => page.evaluate(() => window.__game.strategy.viewState());
// The view has stopped easing.
const settled = async () => {
  let a = await view(), still = 0;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(80);
    const b = await view();
    // Twice running: one long frame under the first read looks like a stop.
    still = Math.abs(a.k - b.k) < 1e-4 && Math.abs(a.x - b.x) < 0.2 && Math.abs(a.y - b.y) < 0.2 ? still + 1 : 0;
    if (still === 2) return b;
    a = b;
  }
  throw new Error('the view never settled');
};
const same = (a, b, what) => assert.ok(Math.abs(a.k - b.k) < 1e-3 && Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1, `${what}: ${JSON.stringify([a, b])}`);
const zoomAllOut = async () => { await page.evaluate(() => window.__game.strategy.zoom(99999)); return settled(); };
const zoomAllIn = async () => { await page.evaluate(() => window.__game.strategy.zoom(-99999)); return settled(); };
// Some spot of the bare map, away from the tags and the HUD.
const bareSpot = () => page.evaluate(() => {
  const cv = window.__game.debug.renderer.domElement;
  for (let y = 200; y < innerHeight - 100; y += 37) for (let x = 200; x < innerWidth - 200; x += 41) if (document.elementFromPoint(x, y) === cv) return { x, y };
  return null;
});
// Every city, clicked where it stands on screen as a player would, with the view brought to it first.
// 30 eases waited out one after another and nothing timed: the page's clock runs 4× meanwhile (tests/game.mjs fastClock).
async function clickEveryCity() {
  await timeScale(page, 4);
  try { await everyCity(); } finally { await timeScale(page, 1); }
}
async function everyCity() {
  await page.evaluate(() => window.__game.strategy.select(null));
  await zoomAllIn();
  for (const c of board.cities) {
    await page.evaluate((id) => window.__game.strategy.focusCity(id), c.id);
    await settled();
    const p = await page.evaluate((id) => window.__game.strategy.screenOfCity(id), c.id);
    const name = await page.evaluate((id) => window.__game.G.cityName(id), c.id);
    assert.ok(p.x > 0 && p.y > 0 && p.x < page.viewportSize().width && p.y < page.viewportSize().height, `${name} on screen`);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(40);
    assert.equal(await page.locator('.citypanel header h2').textContent(), name, `a click at ${name}`);
  }
}

test('the flat map is on its own canvas, without the flat war HUD or the sand table', async () => {
  const r = await page.evaluate(() => ({
    canvas: !!document.querySelector('.flatstrategy canvas'), flat: !!window.__game.strategy.flat, flat2d: document.body.classList.contains('flat2d'),
    tags: document.querySelectorAll('.flatstrategy .labels .ctag').length, shown: getComputedStyle(document.querySelector('.flatstrategy')).display,
    sand: performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /sandtable\/board\//.test(n)),
  }));
  assert.deepEqual(r, { canvas: true, flat: true, flat2d: false, tags: 30, shown: 'block', sand: [] });
});

test('it opens on the whole board, centred', async () => {
  const v = await zoomAllOut();
  assert.ok(Math.abs(v.k - fit(1440, 900)) < 1e-3, `k ${v.k}`);
  assert.ok(Math.abs(v.x + (x0 + x1) / 2 * v.k - 720) < 1 && Math.abs(v.y + (y0 + y1) / 2 * v.k - 450) < 1, JSON.stringify(v));
});

test('every city takes a click where it stands, and shows its own name', async () => { await clickEveryCity(); });

test('at the whole board the pointer finds each city, and a tag is a handle on its city', async () => {
  await zoomAllOut();
  const hits = await page.evaluate((n) => {
    const s = window.__game.strategy, out = [];
    for (let id = 0; id < n; id++) { const p = s.screenOfCity(id); out.push([id, s.hover({ x: p.x / innerWidth * 2 - 1, y: 1 - p.y / innerHeight * 2 })?.id]); }
    s.hover({ x: 2, y: 2 });
    return out;
  }, board.cities.length);
  for (const [id, got] of hits) assert.equal(got, id);
  const name = await page.evaluate(() => window.__game.G.cityName(11));
  const tag = page.locator('.flatstrategy .ctag', { hasText: name });
  await page.evaluate(() => { const s = window.__game.strategy; s.highlight(11); });
  await page.waitForTimeout(200);
  await tag.hover({ force: true });
  assert.ok(await tag.evaluate((e) => e.classList.contains('hov')), 'pointing lights the tag');
  await tag.click({ force: true });
  assert.equal(await page.locator('.citypanel header h2').textContent(), name);
  await page.evaluate(() => window.__game.strategy.highlight(null));
});

test('tags sit on their cities and do not cover one another', async () => {
  await page.evaluate(() => window.__game.strategy.select(null));
  await zoomAllOut(); await page.waitForTimeout(800);
  const r = await page.evaluate((cs) => {
    const { k, x, y } = window.__game.strategy.viewState();
    return [...document.querySelectorAll('.flatstrategy .ctag')].map((el, i) => {
      const b = el.getBoundingClientRect(), dy = parseFloat(el.style.getPropertyValue('--dy')) || 0;
      return { i, left: b.left, right: b.right, top: b.top, bottom: b.bottom, cx: (b.left + b.right) / 2, foot: b.bottom - dy, x: cs[i].tag[0] * k + x, y: cs[i].tag[1] * k + y };
    });
  }, board.cities.toSorted((a, b) => a.id - b.id));
  for (const t of r) assert.ok(Math.abs(t.cx - t.x) < 2 && Math.abs(t.foot - t.y) < 5, `tag ${t.i} not standing on its anchor: ${JSON.stringify(t)}`);
  for (const a of r) for (const b of r) if (a.i < b.i) assert.ok(a.right <= b.left || b.right <= a.left || a.bottom <= b.top + 1 || b.bottom <= a.top + 1, `tags ${a.i} and ${b.i} overlap`);
});

test('the wheel zooms from the whole board to about twice that', async () => {
  const base = await zoomAllOut(), at = await bareSpot();
  await page.mouse.move(at.x, at.y);
  await page.mouse.wheel(0, -300);
  const inn = await settled();
  assert.ok(inn.k > base.k * 1.05, `zoomed in: ${inn.k}`);
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -500);
  const most = await settled();
  assert.ok(most.k <= base.k * 2.02 && most.k > base.k * 1.9, `at most about 2×: ${most.k / base.k}`);
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 500);
  const least = await settled();
  assert.ok(Math.abs(least.k - base.k) < 1e-3, `back to the whole board: ${least.k}`);
});

test('the wheel keeps the spot under the pointer', async () => {
  await zoomAllOut();
  const p = { x: 500, y: 450 }, before = await view(), spot = [(p.x - before.x) / before.k, (p.y - before.y) / before.k];
  await page.evaluate(({ x, y }) => window.__game.strategy.zoom(-1000, { x: x / innerWidth * 2 - 1, y: 1 - y / innerHeight * 2 }), p);
  const v = await settled();
  assert.ok(v.k > before.k * 1.5);
  assert.ok(Math.hypot(spot[0] * v.k + v.x - p.x, spot[1] * v.k + v.y - p.y) < 3, 'the spot stayed');
});

// The view may run past the board's edge only far enough to bring a city out from under the floating HUD.
const keepsBoard = (v, w, h) => {
  assert.ok(x0 * v.k + v.x <= 360.5 && x1 * v.k + v.x >= w - 360.5, `x: ${JSON.stringify(v)}`);
  assert.ok(y0 * v.k + v.y <= 150.5 && y1 * v.k + v.y >= h - 150.5, `y: ${JSON.stringify(v)}`);
};

test('dragging slides the map and never takes the board out of view; the right button does nothing', async () => {
  const start = await zoomAllIn(); keepsBoard(start, 1440, 900);
  const at = await bareSpot();
  const drag = async (dx, dy, button = 'left') => {
    await page.mouse.move(at.x, at.y); await page.mouse.down({ button });
    for (let i = 1; i <= 6; i++) await page.mouse.move(at.x + dx * i / 6, at.y + dy * i / 6);
    await page.mouse.up({ button });
    return settled();
  };
  // A drag follows the pointer. The first 6 px only tell a drag from a click.
  await page.evaluate(() => { const s = window.__game.strategy; s.resetView(); s.zoom(-99999); });
  const mid = await settled();
  const moved = await drag(-180, -120);
  assert.ok(Math.abs(moved.x - mid.x + 180) < 16 && Math.abs(moved.y - mid.y + 120) < 16, `follows: ${JSON.stringify([mid, moved])}`);
  for (const [dx, dy] of [[900, 0], [900, 0], [-900, 0], [-900, 0], [-900, 0], [0, 700], [0, 700], [0, -700], [0, -700], [0, -700]]) keepsBoard(await drag(dx, dy), 1440, 900);
  const before = await settled();
  const after = await drag(200, 100, 'right');
  assert.deepEqual([after.k, Math.round(after.x), Math.round(after.y)], [before.k, Math.round(before.x), Math.round(before.y)], 'the right button');
  await page.keyboard.press('q');
  assert.equal((await settled()).k, before.k);
});

test('WASD pans within the board', async () => {
  await zoomAllIn();
  await page.evaluate(() => window.__game.strategy.resetView()); await settled(); await zoomAllIn();
  const a = await settled();
  await page.keyboard.down('d'); await page.waitForTimeout(400); await page.keyboard.up('d');
  const b = await settled();
  assert.ok(b.x < a.x - 10, 'moved east');
  keepsBoard(b, 1440, 900);
});

test('frame, focusCity and resetView ease to their target, and stay put when the whole map fits', async () => {
  const whole = await zoomAllOut();
  await page.evaluate(() => window.__game.strategy.focusCity(0));
  same(await settled(), whole, 'focusCity at the whole board');
  await page.evaluate(() => window.__game.strategy.frame([0, 29]));
  same(await settled(), whole, 'frame at the whole board');
  await zoomAllIn();
  await page.evaluate(() => window.__game.strategy.focusCity(15));
  await settled();
  const p = await page.evaluate(() => window.__game.strategy.screenOfCity(15));
  assert.ok(Math.hypot(p.x - 720, p.y - 450) < 150 || p.x < 720 || p.y < 450, `focusCity: ${JSON.stringify(p)}`);
  // Two cities a long way apart both come on screen, the zoom giving way if it must.
  await zoomAllIn();
  await page.evaluate(() => window.__game.strategy.frame([0, 29]));
  await settled();
  for (const id of [0, 29]) {
    const q = await page.evaluate((i) => window.__game.strategy.screenOfCity(i), id);
    assert.ok(q.x > 0 && q.x < 1440 && q.y > 0 && q.y < 900, `frame: ${id} ${JSON.stringify(q)}`);
  }
  await zoomAllIn();
  await page.evaluate(() => window.__game.strategy.resetView());
  const home = await settled();
  assert.ok(Math.abs(home.k - whole.k) < 1e-3 && Math.abs(home.x - whole.x) < 0.5, 'resetView goes back to the whole board');
});

test('tag classes are the selection feedback', async () => {
  const cls = () => page.evaluate(() => [...document.querySelectorAll('.flatstrategy .ctag')].map((e) => e.className));
  await page.evaluate(() => { const s = window.__game.strategy; s.pickMode([3, 4], 5); s.highlight(7); });
  const c = await cls();
  assert.match(c[3], /cand/); assert.match(c[4], /cand/); assert.doesNotMatch(c[5], /dim/); assert.match(c[6], /dim/); assert.match(c[7], /hl/);
  await page.evaluate(() => { const s = window.__game.strategy; s.pickMode(null); s.highlight(null); s.announce(9, '胜利', '#f00', 300); });
  const d = await cls();
  assert.ok(d.every((x, i) => !/cand|dim|hl/.test(x) && /news/.test(x) === (i === 9)), 'cleared, and the news on its city');
  await page.waitForTimeout(400);
  const mine = await page.evaluate(() => { const { g } = window.__game; return g.cities.map((c) => c.faction === g.player); });
  (await cls()).forEach((x, i) => assert.equal(/mine/.test(x), mine[i], `city ${i}`));
  const text = await page.evaluate(() => { const s = window.__game.strategy, { g, G } = window.__game; s.refresh(g, () => 7); const el = document.querySelectorAll('.flatstrategy .ctag')[0]; const out = el.textContent; s.refresh(g); return [out, G.cityName(0)]; });
  assert.ok(text[0].startsWith(text[1]) && text[0].endsWith('·7将'), text[0]);
});

test('later layers have their methods already, none of them throwing', async () => {
  const r = await page.evaluate(() => {
    const s = window.__game.strategy;
    s.pulse(1, '#fff'); s.roads(true); const on = s.roadsOn; s.roads(false);
    const w = s.aiWar({ from: 1, to: 2, att: 0, def: 1, attName: 'a', defName: 'b' });
    w.march(100); w.tick(0.1); w.clash(100); w.end(true, 100); w.dispose();
    s.orbit(5, 5); s.rotate(1); s.update(0.016);
    return { on, off: s.roadsOn, dof: s.dof(), focus: !!s.focusPoint(), scene: s.scene.children.length, camera: s.camera.isPerspectiveCamera };
  });
  assert.deepEqual(r, { on: true, off: false, dof: undefined, focus: true, scene: 0, camera: true });
});

test('other screens hide the map and its tags; the flat war keeps its own HUD class', async () => {
  const look = () => page.evaluate(() => ({ map: getComputedStyle(document.querySelector('.flatstrategy')).display, flat2d: document.body.classList.contains('flat2d') }));
  assert.deepEqual(await look(), { map: 'block', flat2d: false });
  await page.evaluate(() => window.__game.debug.show('tview'));
  assert.deepEqual(await look(), { map: 'none', flat2d: false });
  await page.evaluate(() => window.__game.debug.show('strategy'));
  assert.deepEqual(await look(), { map: 'block', flat2d: false });
});

// A sample of the canvas: enough to tell two seasons' pictures apart.
const sample = () => page.evaluate(() => {
  const cv = document.querySelector('.flatstrategy canvas'), g = cv.getContext('2d'), out = [], [L, R] = [0.25, 0.75].map((f) => Math.round(cv.width * f)); // over the board, not the table
  for (let i = 1; i < 12; i++) { const d = g.getImageData(L + Math.round((R - L) * i / 12), Math.round(cv.height * (i % 5 + 1) / 6), 1, 1).data; out.push(d[0], d[1], d[2]); }
  return out;
});
const diff = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0);
const season = () => page.evaluate(() => window.__game.strategy.currentSeason);
const debugPics = () => page.evaluate(() => window.__game.strategy.flatDebug());

test('the season follows floor(month / 3), driving the UI and the 3D scenes\' colours', async () => {
  await zoomAllOut();
  await page.evaluate(() => window.__game.strategy.setSeason(2, true));
  assert.equal(await season(), 'spring');
  await page.evaluate(() => window.__game.strategy.setSeason(3));
  assert.equal(await season(), 'summer');
  assert.equal(await page.evaluate(() => window.__game.strategy.month), 3);
  assert.equal(await page.evaluate(() => document.body.dataset.season), 's1');
  await page.waitForTimeout(3000);
  assert.deepEqual((await debugPics()).layers, ['summer']);
});

test('a picture still on its way leaves the old one showing, then fades in', async () => {
  await page.evaluate(() => window.__game.strategy.setSeason(3, true));
  await page.waitForTimeout(300);
  let release; const held = new Promise((r) => { release = r; });
  await page.route('**/sandtable/flat/winter.webp', async (route) => { await held; await route.continue(); });
  await settled();
  await sample(); await page.waitForTimeout(100); // the first read moves the canvas off the GPU, which resamples a little differently
  const before = await sample();
  await page.evaluate(() => window.__game.strategy.setSeason(10));
  assert.equal(await season(), 'winter');
  await page.waitForTimeout(1200);
  assert.ok(diff(before, await sample()) < 12, 'the old picture stays while the new one loads');
  assert.deepEqual((await debugPics()).layers, ['summer']);
  release();
  await page.waitForFunction(() => window.__game.strategy.flatDebug().layers.at(-1) === 'winter', null, { timeout: 15000 });
  await page.waitForTimeout(3000);
  assert.ok(diff(before, await sample()) > 60, 'the new picture came');
  assert.deepEqual((await debugPics()).layers, ['winter']);
  await page.unroute('**/sandtable/flat/winter.webp');
});

test('only the showing picture and the next season\'s stay in memory', async () => {
  await page.evaluate(() => window.__game.strategy.setSeason(10, true));
  await page.waitForFunction(() => window.__game.strategy.flatDebug().held.length === 2 && window.__game.strategy.flatDebug().held.includes('spring'), null, { timeout: 15000 });
  assert.deepEqual((await debugPics()).held.toSorted(), ['spring', 'winter']);
  await page.evaluate(() => window.__game.strategy.setSeason(1, true));
  await page.waitForFunction(() => { const h = window.__game.strategy.flatDebug().held; return h.includes('spring') && h.includes('summer') && h.length === 2; }, null, { timeout: 15000 });
});

test('a picture that will not load falls back to a neighbouring season, and if none, keeps what shows', async () => {
  await page.evaluate(() => window.__game.strategy.setSeason(1, true));
  await page.route('**/sandtable/flat/autumn.webp', (route) => route.abort());
  await page.evaluate(() => window.__game.strategy.setSeason(7, true));
  await page.waitForFunction(() => window.__game.strategy.flatDebug().layers.at(-1) !== 'spring', null, { timeout: 15000 });
  assert.equal(await season(), 'autumn');
  assert.ok(['summer', 'winter'].includes((await debugPics()).layers.at(-1)), 'a neighbour');
  await page.unroute('**/sandtable/flat/autumn.webp');
  await page.route('**/sandtable/flat/*.webp', (route) => route.abort());
  const shown = (await debugPics()).layers.at(-1), far = shown === 'summer' ? 11 : 4; // the opposite corner of the year from what shows, its neighbours not held
  await page.evaluate((m) => window.__game.strategy.setSeason(m, true), far);
  await page.waitForTimeout(800);
  assert.ok((await debugPics()).layers.length > 0, 'something still shows');
  assert.ok(diff(await sample(), new Array(33).fill(0)) > 300, 'not blank');
  await page.unroute('**/sandtable/flat/*.webp');
  await page.evaluate(() => window.__game.strategy.setSeason(2, true));
  await page.waitForFunction(() => window.__game.strategy.flatDebug().layers.at(-1) === 'spring', null, { timeout: 15000 });
});

test('a jump to a month whose picture is on its way lands without a fade', async () => {
  await page.evaluate(() => window.__game.strategy.setSeason(1, true));
  await page.waitForFunction(() => window.__game.strategy.flatDebug().layers.at(-1) === 'spring', null, { timeout: 15000 });
  await page.evaluate(() => { const s = window.__game.strategy; s.setSeason(7); s.setSeason(7, true); });
  await page.waitForFunction(() => window.__game.strategy.flatDebug().layers.at(-1) === 'autumn', null, { timeout: 15000 });
  assert.deepEqual((await debugPics()).layers, ['autumn']);
});

test('a season that keeps failing is not fetched again until the season changes, and the next change still fades', async () => {
  await page.evaluate(() => window.__game.strategy.setSeason(1, true));
  await page.waitForFunction(() => window.__game.strategy.flatDebug().layers.at(-1) === 'spring', null, { timeout: 15000 });
  let fetched = 0;
  await page.route('**/sandtable/flat/autumn.webp', (route) => { fetched++; route.abort(); });
  await page.evaluate(() => window.__game.strategy.setSeason(7, true));
  await page.waitForFunction(() => window.__game.strategy.flatDebug().layers.at(-1) !== 'spring', null, { timeout: 15000 });
  assert.equal(fetched, 1);
  await page.evaluate(() => { const s = window.__game.strategy, g = { ...window.__game.g, month: 7 }; for (let i = 0; i < 5; i++) s.refresh(g); s.setSeason(7, true); s.setSeason(8); s.setSeason(8, true); });
  await page.waitForTimeout(400);
  assert.equal(fetched, 1, 'refreshes and later months of the same season');
  await page.unroute('**/sandtable/flat/autumn.webp');
  // The jumps above found nothing on its way, so they leave nothing behind: a real change of season cross-fades.
  await page.evaluate(() => window.__game.strategy.setSeason(4)); // autumn's stand-in is winter: summer is a change whichever showed
  await page.waitForFunction(() => window.__game.strategy.flatDebug().layers.at(-1) === 'summer', null, { timeout: 15000 });
  assert.equal((await debugPics()).layers.length, 2, 'fading in over what showed');
  await page.evaluate(() => { const s = window.__game.strategy; s.setSeason(2, true); s.refresh(window.__game.g); });
});

// ---- The layers over the picture: owners' tint, roads, rings, flags (src/strategyflat.js draw()).
const dbg = () => page.evaluate(() => window.__game.strategy.flatDebug());
const toScreen = (v, px, py) => [px * v.k + v.x, py * v.k + v.y];
// The canvas under some screen points, [[r, g, b], …]; the DOM tags over it do not count.
const pixels = (pts) => page.evaluate((pts) => {
  const cv = document.querySelector('.flatstrategy canvas'), g = cv.getContext('2d');
  return pts.map(([x, y]) => [...g.getImageData(Math.round(x), Math.round(y), 1, 1).data].slice(0, 3));
}, pts);
const far = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
const bare = async () => {
  await page.evaluate(() => { const s = window.__game.strategy; s.debugSky(false); s.select(null); s.pickMode(null); s.highlight(null); s.hover({ x: 2, y: 2 }); s.roads(false); s.setSeason(1, true); }); // blossom would fall through the pixels read here
  await page.waitForFunction(() => window.__game.strategy.flatDebug().layers.join() === 'spring', null, { timeout: 15000 });
  const v = await zoomAllOut(); await pixels([[1, 1]]); await page.waitForTimeout(150); return v; // the first read moves the canvas off the GPU, which resamples a little differently
};
const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const colorOfIn = (f) => page.evaluate(async (f) => (await import(new URL('src/strategy.js', location.href).href)).colorOf(f), f);
const ownerIs = (id, f) => page.evaluate(({ id, f }) => { const { g, strategy } = window.__game; strategy.refresh({ ...g, cities: g.cities.map((c) => (c.id === id ? { ...c, faction: f } : c)) }); }, { id, f });
const refreshReal = () => page.evaluate(() => { const { g, strategy } = window.__game; strategy.refresh(g); });
const city = (id) => board.cities.find((c) => c.id === id);

test('territory defaults off, matches the untinted ground, and the button toggles it', async () => {
  await bare();
  const button = page.locator('.terrbtn');
  assert.equal(await button.getAttribute('title'), '势力范围：按归属给地面着色');
  assert.equal(await button.getAttribute('aria-pressed'), 'false');
  assert.deepEqual([(await dbg()).territoryOn, (await dbg()).tintDraws], [false, 0]);
  const old = await page.evaluate(() => window.__game.g.cities[12].faction);
  await ownerIs(12, (old + 1) % 7); await refreshReal();
  assert.equal((await dbg()).tintDraws, 0, 'owner changes while off do not build a grid');
  const pixels = await page.evaluate(() => {
    const { g, G, strategy: s } = window.__game, u = s.debugUnder();
    // Reading the source canvas can switch its rendering backend and change how the picture is resampled.
    // Copy to a readback canvas instead, so the never-on and restored views are rendered the same way.
    const snap = new OffscreenCanvas(u.width, u.height), sg = snap.getContext('2d', { alpha: false, willReadFrequently: true });
    const take = () => { s.update(0); sg.drawImage(u, 0, 0); return sg.getImageData(0, 0, u.width, u.height).data; };
    const compare = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++; return n; };
    const redrawOff = () => { s.roads(true); s.update(0); s.roads(false); return take(); };
    try {
      const neverOn = take();
      const noReadRedraw = redrawOff(); // a normal redraw, without ever enabling territory
      const off = noReadRedraw;
      s.territory(true); const on = take();
      s.refresh({ ...g, cities: g.cities.map((c) => ({ ...c, faction: G.NONE })) }); const natural = take();
      s.refresh(g); s.territory(false); const offAgain = take();
      return { untouched: compare(neverOn, noReadRedraw), changed: compare(off, on), natural: compare(off, natural),
        restored: compare(off, offAgain), neutralRestored: compare(natural, offAgain) };
    } finally { s.roads(false); s.territory(false); s.refresh(g); }
  });
  assert.ok(pixels.changed > 100, 'owned land and borders appear when enabled');
  assert.deepEqual([pixels.untouched, pixels.natural, pixels.restored, pixels.neutralRestored], [0, 0, 0, 0], `off matches the never-on and unowned ground with no border: ${JSON.stringify(pixels)}`);
  const draws = (await dbg()).tintDraws;
  await ownerIs(12, (old + 1) % 7);
  assert.equal((await dbg()).tintDraws, draws, 'later ownership changes also wait while off');
  await page.evaluate(() => window.__game.strategy.territory(true));
  assert.equal((await dbg()).tintDraws, draws + 1, 'enabling paints the latest owners');
  await page.evaluate(() => window.__game.strategy.territory(false)); await refreshReal();
  await button.click();
  assert.equal(await button.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => window.__game.strategy.territoryOn), true);
  await button.click();
  assert.equal(await button.getAttribute('aria-pressed'), 'false');
  assert.equal(await page.evaluate(() => window.__game.strategy.territoryOn), false);
});

test('each flag flies its owner\'s colour, and follows a change of owner', async () => {
  const v = await bare(), { g } = await page.evaluate(() => ({ g: { cities: window.__game.g.cities.map((c) => c.faction) } }));
  const d = await dbg();
  for (const [id, f] of g.cities.entries()) assert.equal(d.flagColors[id], await colorOfIn(f), `city ${id}`);
  const id = 12, was = g.cities[id], now = was === 2 ? 3 : 2, col = await colorOfIn(now);
  await ownerIs(id, now); await page.waitForTimeout(150);
  assert.equal((await dbg()).flagColors[id], col);
  // On the canvas too: a run of the new colour just east of the pole, over the land's own colours.
  const [fx, fy] = toScreen(v, city(id).flag[0], city(id).flag[1]), spots = [];
  for (let dx = 3; dx < 12; dx++) for (let dy = 1; dy < 9; dy++) spots.push([fx + dx, fy + dy]);
  assert.ok((await pixels(spots)).filter((p) => far(p, hex(col)) < 70).length >= 8, 'cloth in the owner\'s colour');
  await refreshReal();
});

test('the flags sway', async () => {
  const v = await bare(), c = city(12), [fx, fy] = toScreen(v, c.flag[0], c.flag[1]), spots = [];
  for (let dx = 8; dx < 16; dx++) for (let dy = -2; dy < 14; dy++) spots.push([fx + dx, fy + dy]);
  const a = await pixels(spots); let moved = 0;
  for (let i = 0; i < 6 && !moved; i++) { await page.waitForTimeout(170); moved = (await pixels(spots)).filter((p, j) => far(p, a[j]) > 12).length; }
  assert.ok(moved > 0, 'the cloth moved');
});

test('the owners\' tint is painted on refresh only, lies on the land, and leaves the sea alone', async () => {
  await page.evaluate(() => window.__game.strategy.territory(true));
  const v = await bare(), T = board.tint, id = 12, a = (await dbg()).tintDraws;
  const fine = territoryCells(), scale = T.territory.w / T.w;
  const fineAt = (i, j) => fine[(j * scale + Math.floor(scale / 2)) * T.territory.w + i * scale + Math.floor(scale / 2)];
  await page.waitForTimeout(400);
  assert.equal((await dbg()).tintDraws, a, 'frames do not repaint it');
  await refreshReal(); assert.equal((await dbg()).tintDraws, a, 'an unchanged refresh does not repaint it');
  // Far enough from the city that no ring, flag or road falls there, strong enough to tell.
  const c = city(id);
  let cell = null, sea = null;
  for (let j = 0; j < T.h; j++) for (let i = 0; i < T.w; i++) {
    const n = j * T.w + i, px = (i + 0.5) / T.w * board.size[0], py = (j + 0.5) / T.h * board.size[1];
    if (T.near[n] === id && fineAt(i, j) === id + 1 && T.k[n] > 0.08 && Math.hypot(px - c.cx, py - c.cy) > 110 && !cell) cell = [px, py];
    if (T.near[n] >= 0 && !T.land[n] && fineAt(i, j) === 0 && py > 1000 && !sea) sea = [px, py, T.near[n]];
  }
  assert.ok(cell && sea, 'land and sea sample cells are available');
  const spot = toScreen(v, cell[0], cell[1]), water = toScreen(v, sea[0], sea[1]);
  const was = await page.evaluate((id) => window.__game.g.cities[id].faction, id);
  await ownerIs(id, was === 2 ? 3 : 2); await page.waitForTimeout(150);
  assert.equal((await dbg()).tintDraws, a + 1, 'a change of owner repaints it');
  const [one, seaOne] = await pixels([spot, water]);
  await ownerIs(id, was === 3 ? 4 : 3); await page.waitForTimeout(150);
  const [two, seaTwo] = await pixels([spot, water]);
  assert.ok(far(one, two) >= 3, `the land takes the new owner: ${one} ${two}`);
  assert.ok(far(seaOne, seaTwo) <= 1, 'the sea does not');
  await refreshReal(); await page.evaluate(() => window.__game.strategy.territory(false));
});

test('a neutral city tints nothing', async () => {
  await page.evaluate(() => window.__game.strategy.territory(true));
  const v = await bare(), T = board.tint, id = 12, c = city(id);
  const fine = territoryCells(), scale = T.territory.w / T.w;
  const n = T.near.findIndex((near, i) => near === id && T.k[i] > 0.08 && fine[(Math.floor(i / T.w) * scale + Math.floor(scale / 2)) * T.territory.w + (i % T.w) * scale + Math.floor(scale / 2)] === id + 1 && Math.hypot((i % T.w + 0.5) / T.w * board.size[0] - c.cx, (Math.floor(i / T.w) + 0.5) / T.h * board.size[1] - c.cy) > 110);
  const spot = toScreen(v, (n % T.w + 0.5) / T.w * board.size[0], (Math.floor(n / T.w) + 0.5) / T.h * board.size[1]);
  const owned = (await pixels([spot]))[0];
  const NONE = await page.evaluate(async () => (await import(new URL('src/core/game.js', location.href).href)).NONE);
  await ownerIs(id, NONE); await page.waitForTimeout(150);
  const none = (await pixels([spot]))[0];
  const lum = (c) => c[0] * .3 + c[1] * .59 + c[2] * .11;
  assert.ok(far(owned, none) >= 2 && Math.abs(lum(owned) - lum(none)) < 18, `the hue and a small value shift retain the ground: ${owned} ${none}`);
  await refreshReal(); await page.evaluate(() => window.__game.strategy.territory(false));
});

test('land beyond the former city-radius falloff follows its owner', async () => {
  await page.evaluate(() => window.__game.strategy.territory(true));
  const v = await bare(), T = board.tint, id = 28, c = city(id), scale = T.territory.w / T.w, fine = territoryCells(), spots = [];
  for (let j = 1; j < T.h - 1 && spots.length < 20; j++) for (let i = 1; i < T.w - 1 && spots.length < 20; i++) {
    const n = j * T.w + i, q = (j * scale + Math.floor(scale / 2)) * T.territory.w + i * scale + Math.floor(scale / 2);
    const x = (i + 0.5) / T.w * board.size[0], y = (j + 0.5) / T.h * board.size[1];
    if (T.near[n] !== id || !T.land[n] || fine[q] !== id + 1 || Math.hypot(x - c.cx, y - c.cy) < 500) continue; // on the bake camera this is safely beyond 2.8 world units
    if ([q - scale, q + scale, q - scale * T.territory.w, q + scale * T.territory.w].some((p) => fine[p] !== id + 1)) continue;
    spots.push(toScreen(v, x, y));
  }
  assert.ok(spots.length, 'there are distant land cells beyond the old falloff');
  await ownerIs(id, 2); await page.waitForTimeout(150); const a = await pixels(spots);
  await ownerIs(id, 3); await page.waitForTimeout(150); const b = await pixels(spots);
  assert.ok(a.some((p, i) => far(p, b[i]) >= 4), 'distant land changes hue with its owner');
  await refreshReal(); await page.evaluate(() => window.__game.strategy.territory(false));
});

test('the roads overview lays a gold line on every road, the sea lanes dashed', async () => {
  const landMid = board.roads.filter((r) => !r.sea.some(Boolean)).map((r) => { const n = Math.floor(r.p.length / 4) * 2; return [r.p[n], r.p[n + 1]]; })
    .filter(([x, y]) => board.cities.every((c) => x < c.flag[0] - 15 || x > c.flag[0] + 70 || y < c.flag[1] - 15 || y > c.flag[1] + 60)); // a flag may fly over the middle of a road
  assert.ok(landMid.length > 40);
  let v = await bare();
  const spots = landMid.map(([x, y]) => toScreen(v, x, y)), radius = [-2, -1, 0, 1, 2];
  const neighbourhoods = spots.map(([x, y]) => radius.flatMap((a) => radius.map((b) => [x + a, y + b])));
  const samples = neighbourhoods.flat(), offSamples = await pixels(samples);
  await page.evaluate(() => window.__game.strategy.roads(true)); await page.waitForTimeout(150);
  assert.equal((await dbg()).roadsOn, true);
  const onSamples = await pixels(samples), gold = [255, 216, 120], off = [], core = [];
  // The line is under 3 px wide here: compare on and off at the same most-gold pixel near the road point.
  for (const [i, neighbourhood] of neighbourhoods.entries()) {
    const start = i * neighbourhood.length, group = onSamples.slice(start, start + neighbourhood.length);
    let best = 0; for (let j = 1; j < group.length; j++) if (far(group[j], gold) < far(group[best], gold)) best = j;
    const p = group[best], was = offSamples[start + best]; off.push(was); core.push(neighbourhood[best]);
    assert.ok(far(p, gold) < 60, `road ${i} gold: ${group}`);
    assert.ok(far(p, was) > 60 || far(was, gold) - far(p, gold) > 5,
      `road ${i} lit at ${core[i]}: ${was} → ${p}`); // a pale baked road may already be close to the gold overlay
  }
  await page.evaluate(() => window.__game.strategy.roads(false)); await page.waitForTimeout(150);
  (await pixels(core)).forEach((p, i) => assert.ok(far(p, off[i]) < 12, `road ${i} back off`));
  // The longest stretch at sea, seen up close: lit and clear by turns, in the lane's pale colour.
  let run = [];
  for (const r of board.roads) { let cur = []; r.sea.forEach((s, k) => { if (s) { cur.push([r.p[k * 2], r.p[k * 2 + 1]]); if (cur.length > run.length) run = cur; } else cur = []; }); }
  assert.ok(run.length > 12, 'a sea lane to look at');
  const mid = run[run.length >> 1], near = board.cities.toSorted((a, b) => Math.hypot(a.cx - mid[0], a.cy - mid[1]) - Math.hypot(b.cx - mid[0], b.cy - mid[1]))[0].id;
  await zoomAllIn(); await page.evaluate((id) => window.__game.strategy.focusCity(id), near); v = await settled();
  const line = run.flatMap(([x, y], i) => { if (i === run.length - 1) return []; const [nx, ny] = run[i + 1]; return [0, 0.25, 0.5, 0.75].map((f) => toScreen(v, x + (nx - x) * f, y + (ny - y) * f)); }).filter(([x, y]) => x > 0 && y > 0 && x < 1440 && y < 900);
  assert.ok(line.length > 20, 'the lane is on screen');
  await page.evaluate(() => window.__game.strategy.roads(false)); await page.waitForTimeout(150);
  const seaOff = await pixels(line);
  await page.evaluate(() => window.__game.strategy.roads(true)); await page.waitForTimeout(150);
  const seaOn = await pixels(line), lit = seaOn.map((p, i) => far(p, seaOff[i]) > 90);
  const flips = lit.filter((b, i) => i && b !== lit[i - 1]).length;
  assert.ok(flips >= 4, `dashed: ${lit.map((b) => (b ? '#' : '.')).join('')}`);
  seaOn.forEach((p, i) => { if (lit[i] && far(p, [232, 244, 255]) < 60) assert.ok(p[2] >= p[0], 'pale'); });
  assert.ok(seaOn.some((p) => far(p, [232, 244, 255]) < 60), 'the lane\'s colour');
  await page.evaluate(() => window.__game.strategy.roads(false));
});

test('a selected city\'s roads carry beads running outward from it, as many as the 3D map\'s rhythm gives', async () => {
  await bare();
  const id = 12, roads = board.roads.filter((r) => r.a === id || r.b === id);
  await page.evaluate((id) => window.__game.strategy.select(id), id);
  let d = await dbg();
  assert.equal(d.selected, id);
  assert.ok(d.flowCount > roads.length * 3, `flowCount ${d.flowCount}`);
  assert.equal(d.flow.length, d.flowCount);
  // Each road's beads leave the city: t grows with the distance from it.
  const c = city(id);
  for (const [i, b] of d.flow.entries()) {
    const away = Math.hypot(b.x - c.cx, b.y - c.cy);
    assert.ok(away > 40, `not on the town: ${away}`);
    const nx = d.flow[i + 1];
    if (nx && nx.t > b.t) assert.ok(Math.hypot(nx.x - b.x, nx.y - b.y) < 40, 'beads follow the road in order');
  }
  const firsts = d.flow.filter((b, i) => !i || d.flow[i - 1].t > b.t), lasts = d.flow.filter((b, i) => i === d.flow.length - 1 || d.flow[i + 1].t < b.t);
  assert.equal(firsts.length, roads.length, 'a run of beads per road');
  firsts.forEach((f, i) => assert.ok(Math.hypot(f.x - c.cx, f.y - c.cy) < Math.hypot(lasts[i].x - c.cx, lasts[i].y - c.cy), 'first bead nearest the city'));
  // They are on the canvas and they move: the same spots change frame to frame.
  const v = await view(), spots = d.flow.map((b) => toScreen(v, b.x, b.y)), a = await pixels(spots);
  let moved = 0;
  for (let i = 0; i < 6 && moved < 5; i++) { await page.waitForTimeout(90); moved = (await pixels(spots)).filter((p, j) => far(p, a[j]) > 40).length; }
  assert.ok(moved >= 5, `beads pulse: ${moved}`);
  await page.evaluate(() => window.__game.strategy.select(null));
  d = await dbg();
  assert.deepEqual([d.selected, d.flowCount], [null, 0]);
});

// A city's ring band: points round it at f × (rx, ry), avoiding the south-east where a road or the flag may fall.
const bandSpots = (v, c, f) => [150, 180, 210, 240, 270, 300, 330].map((deg) => toScreen(v, c.cx + Math.cos(deg * Math.PI / 180) * c.rx * f, c.cy + Math.sin(deg * Math.PI / 180) * c.ry * f));
const ringShows = async (v, c, f) => {
  const spots = bandSpots(v, c, f), off = await pixels(spots);
  return async () => { let best = 0; for (let i = 0; i < 8; i++) { await page.waitForTimeout(60); const on = await pixels(spots); best = Math.max(best, on.filter((p, j) => far(p, off[j]) > 30).length); } return best; };
};

test('the rings: hover, selected and candidate, each where the 3D map puts it', async () => {
  let v = await bare(); const id = 12, c = city(id), s = await view(), mid = { x: (c.cx * s.k + s.x) / 1440 * 2 - 1, y: 1 - (c.cy * s.k + s.y) / 900 * 2 };
  let show = await ringShows(v, c, 0.85), outside = await ringShows(v, c, 1.3);
  await page.evaluate((m) => window.__game.strategy.hover(m), mid);
  assert.equal((await dbg()).hover, id);
  assert.ok(await show() >= 4, 'hover ring at .76-.94');
  assert.equal(await outside(), 0, 'nothing beyond it');
  await page.evaluate(() => window.__game.strategy.hover({ x: 2, y: 2 }));
  assert.equal((await dbg()).hover, null);
  await page.waitForTimeout(100);
  // Pointing from a list lights the same ring.
  await page.evaluate((id) => window.__game.strategy.highlight(id), id);
  assert.ok(await show() >= 4, 'highlight');
  await page.evaluate(() => window.__game.strategy.highlight(null)); await page.waitForTimeout(100);
  show = await ringShows(v, c, 1.0);
  await page.evaluate((id) => window.__game.strategy.select(id), id);
  assert.ok(await show() >= 4, 'selected ring at .9-1.1');
  await page.evaluate(() => window.__game.strategy.select(null)); await page.waitForTimeout(100);
  show = await ringShows(v, c, 0.95);
  await page.evaluate((id) => window.__game.strategy.pickMode([id]), id);
  assert.deepEqual((await dbg()).candidates, [id]);
  assert.ok(await show() >= 4, 'candidate ring at .82-1.08');
  await page.evaluate(() => window.__game.strategy.pickMode(null));
  assert.deepEqual((await dbg()).candidates, []);
});

test('in a map pick the others dim, and a candidate wins over a nearer city on the same spot', async () => {
  await page.setViewportSize({ width: 640, height: 400 }); // a small window is where two cities' reaches overlap
  const v = await bare();
  const reach = (c) => { const top = Math.min(c.flag[1], c.tag[1]) * v.k + v.y, bot = (c.cy + c.ry) * v.k + v.y, rx = Math.max(c.rx * v.k, 12), h = Math.max((bot - top) / 2, 12); return { l: c.cx * v.k + v.x - rx, r: c.cx * v.k + v.x + rx, t: (top + bot) / 2 - h, b: (top + bot) / 2 + h, x: c.cx * v.k + v.x, y: c.cy * v.k + v.y }; };
  let pair = null;
  for (const a of board.cities) for (const b of board.cities) if (a.id !== b.id && !pair) {
    const A = reach(a), B = reach(b), x0 = Math.max(A.l, B.l), x1 = Math.min(A.r, B.r), y0 = Math.max(A.t, B.t), y1 = Math.min(A.b, B.b);
    if (x0 >= x1 || y0 >= y1) continue;
    // In the overlap, a point nearer b than a: without candidates b takes it.
    for (const p of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) if (Math.hypot(p[0] - B.x, p[1] - B.y) < Math.hypot(p[0] - A.x, p[1] - A.y) - 1) { pair = { cand: a.id, near: b.id, at: { x: (p[0] + (x0 + x1) / 2) / 2, y: (p[1] + (y0 + y1) / 2) / 2 } }; break; }
  }
  assert.ok(pair, 'two cities overlapping at the whole board');
  const hit = (at) => page.evaluate((at) => window.__game.strategy.hover({ x: at.x / innerWidth * 2 - 1, y: 1 - at.y / innerHeight * 2 })?.id, at);
  assert.equal(await hit(pair.at), pair.near, 'the nearer city, without a pick');
  await page.evaluate((c) => window.__game.strategy.pickMode([c]), pair.cand);
  assert.equal(await hit(pair.at), pair.cand, 'the candidate, in a pick');
  const dim = await page.evaluate((c) => [...document.querySelectorAll('.flatstrategy .ctag')].map((e, i) => [i, e.classList.contains('dim')]).filter(([i, d]) => (i === c ? d : !d)), pair.cand);
  assert.deepEqual(dim, [], 'all but the candidate dim');
  await page.evaluate(() => { const s = window.__game.strategy; s.pickMode(null); s.hover({ x: 2, y: 2 }); });
  await page.setViewportSize({ width: 1440, height: 900 });
});

test('pulse and announce spread rings from the city, then clear', async () => {
  const v = await bare(), c = city(12), spots = [[1.2, 0], [0, -1.2], [-1.2, 0], [0, 1.2], [1.6, 0], [0, -1.6], [-1.6, 0], [0, 1.6]].map(([a, b]) => toScreen(v, c.cx + a * 49.5, c.cy + b * 42));
  const off = await pixels(spots);
  await page.evaluate(() => window.__game.strategy.pulse(12, '#ff4040'));
  assert.equal((await dbg()).pulses, 1);
  let best = 0;
  for (let i = 0; i < 8; i++) { await page.waitForTimeout(60); best = Math.max(best, (await pixels(spots)).filter((p, j) => far(p, off[j]) > 20).length); }
  assert.ok(best >= 2, `a ring on the canvas: ${best}`);
  await page.waitForFunction(() => window.__game.strategy.flatDebug().pulses === 0, null, { timeout: 3000 });
  await page.evaluate(() => window.__game.strategy.announce(12, '胜利', '#40a0ff', 200));
  assert.equal((await dbg()).pulses, 3, 'three rings, staggered');
  await page.waitForFunction(() => window.__game.strategy.flatDebug().pulses === 0, null, { timeout: 4000 });
});

test('the ruler\'s city shows its crown', async () => {
  const v = await bare();
  const { crowned, ruled } = await page.evaluate(() => { const { g, strategy } = window.__game; return { crowned: strategy.flatDebug().crowned, ruled: g.cities.filter((c) => g.factions.some((f) => f.ruler != null && f.city === c.id && c.officers.includes(f.ruler))).map((c) => c.id) }; });
  assert.deepEqual(crowned, ruled);
  assert.ok(crowned.length > 0);
  const c = city(crowned[0]), [tx, ty] = toScreen(v, c.tag[0], c.tag[1]), spots = [];
  for (let dx = -3; dx <= 3; dx++) for (let dy = -2; dy <= 9; dy++) spots.push([tx + dx, ty + dy]);
  assert.ok((await pixels(spots)).filter((p) => far(p, [255, 230, 128]) < 80).length >= 6, 'gold at the crown');
});

test('at 1024×600 the board, the tags and the hits all follow the new size', async () => {
  await zoomAllIn();
  await page.evaluate(() => window.__game.strategy.focusCity(12)); await settled();
  const focusBefore = await view(), mid = [(720 - focusBefore.x) / focusBefore.k, (450 - focusBefore.y) / focusBefore.k];
  await page.setViewportSize({ width: 1024, height: 600 });
  const v = await settled();
  assert.ok(v.k <= fit(1024, 600) * 2.02 && v.k > fit(1024, 600) * 1.9, 'the same zoom step of the new fit');
  keepsBoard(v, 1024, 600);
  assert.ok(Math.hypot((512 - v.x) / v.k - mid[0], (300 - v.y) / v.k - mid[1]) < 500, 'about the same spot in the middle');
  const whole = await zoomAllOut();
  assert.ok(Math.abs(whole.k - fit(1024, 600)) < 1e-3);
  await clickEveryCity();
  const cv = await page.evaluate(() => { const c = document.querySelector('.flatstrategy canvas'); return [c.style.width, c.style.height]; });
  assert.deepEqual(cv, ['1024px', '600px']);
  await page.setViewportSize({ width: 1440, height: 900 });
});

// ---- The AI war's standards and the sky (the last layers of draw()).
// A war stepped by hand, all in one evaluate, so the frame loop cannot get a tick in between. `script` runs in the page: script(s, w, dbg).
const stepped = (script, arg) => page.evaluate(({ script, arg }) => {
  const s = window.__game.strategy, dbg = () => s.flatDebug().aiWar;
  return new Function('s', 'dbg', 'arg', script)(s, dbg, arg);
}, { script, arg });
const WAR = `const w = s.aiWar({ from: arg.from, to: arg.to, att: 2, def: 3, attName: '袁绍', defName: '曹操' });`;
const roadOf = (a, b) => { const r = board.roads.find((q) => (q.a === a && q.b === b) || (q.a === b && q.b === a)), p = []; for (let i = 0; i < r.p.length; i += 2) p.push([r.p[i], r.p[i + 1]]); return r.a === a ? p : p.reverse(); };
const offRoad = (pts, x, y) => Math.min(...pts.map(([a, b]) => Math.hypot(a - x, b - y)));

test('march: the attacker\'s standard rises at his city and goes down the road, the defender\'s not up yet', async () => {
  await bare();
  const r = await stepped(`${WAR}
    w.march(2000); const a = dbg(); w.tick(0.1); const risen = dbg(); const seen = [];
    for (let i = 0; i < 18; i++) { w.tick(0.1); seen.push(dbg().a); }
    const out = { stage: a.stage, start: a.a, alpha0: a.a.alpha, alpha: risen.a.alpha, seen, d: dbg().d, dust: dbg().dust, cloth: dbg().cloth };
    w.dispose(); return out;`, { from: 12, to: 8 });
  const pts = roadOf(12, 8);
  assert.equal(r.stage, 'march');
  assert.ok(Math.hypot(r.start.x - pts[0][0], r.start.y - pts[0][1]) < 2, `starts at his city: ${JSON.stringify(r.start)}`);
  assert.equal(r.alpha0, 0); assert.ok(r.alpha > 0.2 && r.alpha < 0.5, `rises: ${r.alpha}`); assert.equal(r.seen.at(-1).alpha, 1);
  assert.equal(r.d.shown, false, 'the defender stands up at the clash');
  for (const p of r.seen) assert.ok(offRoad(pts, p.x, p.y) < 40, `on the road: ${JSON.stringify(p)}`);
  const left = (p) => Math.hypot(p.x - pts.at(-1)[0], p.y - pts.at(-1)[1]);
  assert.ok(left(r.seen.at(-1)) < left(r.start) * 0.7, 'and well along it');
  assert.ok(left(r.seen.at(-1)) > 40, 'short of the walls');
  assert.ok(r.dust > 0 && r.dust < 20, `dust at its heels, restrained: ${r.dust}`);
  assert.ok(r.cloth >= 28, `the cloth reads at the whole board: ${r.cloth} px wide`);
});

test('clash: both standards up before the walls, far enough apart to read, lunging in turn', async () => {
  await bare();
  const r = await stepped(`${WAR}
    w.march(100); w.clash(2400); const leans = [], gaps = [];
    for (let i = 0; i < 24; i++) { w.tick(0.1); const d = dbg(); leans.push([d.a.lean, d.d.lean]); gaps.push(Math.hypot(d.a.x - d.d.x, d.a.y - d.d.y) * s.viewState().k); }
    const out = { stage: dbg().stage, d: dbg().d, leans, gaps, dust: dbg().dust, cloth: dbg().cloth, pulses: s.flatDebug().pulses };
    w.dispose(); return out;`, { from: 12, to: 8 });
  assert.equal(r.stage, 'clash'); assert.equal(r.d.shown, true); assert.equal(r.d.alpha, 1);
  assert.ok(r.leans.some(([a]) => a !== 0) && r.leans.some(([, d]) => d !== 0), 'each lunges');
  assert.ok(r.leans.every(([a, d]) => !(a && d)), 'in turn');
  assert.ok(Math.min(...r.gaps) >= r.cloth * 0.6, `the standards stay apart on screen: ${Math.min(...r.gaps)} for a cloth of ${r.cloth}`);
  assert.ok(r.dust > 0); assert.ok(r.pulses > 0, 'rings off the fight');
});

for (const wins of [true, false]) test(`end: the loser's standard falls away from the winner; ${wins ? 'a winning attacker rides in' : 'a held city keeps its standard'}`, async () => {
  await bare();
  const r = await stepped(`${WAR}
    w.march(100); w.clash(100); w.tick(0.3); const before = dbg();
    w.end(arg.wins, 2000); const trace = [];
    for (let i = 0; i < 20; i++) { w.tick(0.1); const d = dbg(); trace.push({ a: d.a, d: d.d }); }
    const out = { stage: dbg().stage, before, trace }; w.dispose(); return out;`, { from: 12, to: 8, wins });
  assert.equal(r.stage, 'end');
  const loser = wins ? 'd' : 'a', winner = wins ? 'a' : 'd', at = (t) => r.trace[Math.round(t * 10) - 1];
  const away = Math.sign(r.before[loser].x - r.before[winner].x) || 1;
  assert.ok(Math.abs(at(0.6)[loser].lean) > 1.4, `falls over: ${at(0.6)[loser].lean}`);
  assert.equal(Math.sign(at(0.3)[loser].lean), away, 'away from the winner');
  assert.equal(at(1.1)[loser].alpha, 0, 'and is gone');
  assert.equal(at(0.5)[winner].lean, 0); assert.equal(at(1.5)[winner].alpha, 1, 'the winner stands');
  assert.ok(at(2)[winner].alpha < 0.05, `until the end: ${at(2)[winner].alpha}`);
  const to = city(8), rode = Math.hypot(at(1)[winner].x - to.cx, at(1)[winner].y - to.cy);
  if (wins) assert.ok(rode < 3, `rides into the city: ${rode}`); else assert.ok(rode > 20, `holds before the walls: ${rode}`);
});

test('the clash\'s dust and rings start with the clash, however long the march ran, and go on through it', async () => {
  await bare();
  const r = await stepped(`${WAR}
    w.march(2360); for (let i = 0; i < 24; i++) w.tick(0.1);
    w.clash(2360); const seen = []; let p = s.flatDebug().pulses;
    for (let i = 0; i < 22; i++) { w.tick(0.1); const q = s.flatDebug().pulses; seen.push(q > p); p = q; }
    const end = () => { w.dispose(); return seen; }; return end();`, { from: 12, to: 8 });
  const beats = r.flatMap((on, i) => (on ? [i * 0.1] : []));
  assert.ok(beats[0] <= 0.1, `the first blow at once: ${beats}`);
  assert.ok(beats.length >= 5 && beats.at(-1) > 1.5, `and on through it: ${beats}`);
});

test('a winning attacker rides in from where his last lunge left him: no step back to his mark', async () => {
  await bare();
  const r = await stepped(`${WAR}
    w.march(100); w.clash(1000); w.tick(0.1); // the top of his first lunge
    const lunged = dbg().a; w.end(true, 2000); w.tick(0.016); const next = dbg().a; w.dispose(); return { lunged, next };`, { from: 12, to: 8 });
  const k = (await view()).k, step = Math.hypot(r.next.x - r.lunged.x, r.next.y - r.lunged.y) * k;
  assert.ok(step < 3, `a frame's step on screen: ${step}`);
});

test('dispose leaves nothing behind; a new war replaces the last', async () => {
  await bare();
  const r = await stepped(`${WAR}
    w.march(1000); for (let i = 0; i < 8; i++) w.tick(0.1); const during = dbg();
    const w2 = s.aiWar({ from: 8, to: 12, att: 3, def: 2, attName: '曹操', defName: '袁绍' }); const swapped = dbg();
    w.dispose(); const still = !!dbg(); // the old one's dispose must not end the new one
    w2.dispose(); w2.tick(0.1); w2.dispose();
    return { dust: during.dust, swapped: swapped.dust, still, after: dbg() ?? null, debug: s.flatDebug().dust };`, { from: 12, to: 8 });
  assert.ok(r.dust > 0); assert.equal(r.swapped, 0, 'the old dust went with it'); assert.equal(r.still, true);
  assert.equal(r.after, null); assert.equal(r.debug, 0);
});

test('the cloth bears the surname, a compound one in two characters', async () => {
  const r = await page.evaluate(async () => {
    const { COMPOUND } = await import(new URL('src/strategy.js', location.href).href), s = window.__game.strategy, drawn = {};
    const fill = CanvasRenderingContext2D.prototype.fillText;
    for (const name of ['曹操', ...COMPOUND.map((c) => `${c}某`)]) {
      const seen = [];
      CanvasRenderingContext2D.prototype.fillText = function (t, ...a) { seen.push(t); return fill.call(this, t, ...a); };
      const w = s.aiWar({ from: 12, to: 8, att: 2, def: 3, attName: name, defName: '刘备' });
      CanvasRenderingContext2D.prototype.fillText = fill;
      w.dispose(); drawn[name] = seen;
    }
    return { drawn, COMPOUND };
  });
  assert.deepEqual(r.COMPOUND, ['公孙', '诸葛', '司马', '夏侯', '皇甫', '太史']);
  assert.deepEqual(r.drawn['曹操'], ['曹', '刘']);
  for (const c of r.COMPOUND) assert.deepEqual(r.drawn[`${c}某`], [c[0], c[1], '刘'], c);
});

for (const [what, from] of [['from === to', 8], ['no road between them', 0], ['no from', null]]) test(`${what}: a straight approach from the south-west`, async () => {
  await bare();
  const r = await stepped(`${WAR} w.march(2000); const a = dbg(); for (let i = 0; i < 18; i++) w.tick(0.1); const b = dbg(); w.dispose(); return { a: a.a, b: b.a };`, { from, to: 8 });
  const c = city(8), [sx, sy] = [c.cx - 2.4 * 110, c.cy + 1.4 * 110 * 0.85];
  assert.ok(Math.hypot(r.a.x - sx, r.a.y - sy) < 2, `starts south-west of the city: ${JSON.stringify(r.a)}`);
  const u = ((r.b.x - sx) * (c.cx - sx) + (r.b.y - sy) * (c.cy - sy)) / ((c.cx - sx) ** 2 + (c.cy - sy) ** 2);
  assert.ok(u > 0 && u < 1, `comes toward it: ${u}`);
  assert.ok(Math.hypot(r.b.x - (sx + (c.cx - sx) * u), r.b.y - (sy + (c.cy - sy) * u)) < 2, 'in a straight line');
});

test('the camera: the march keeps the whole board, the clash closes in on the fight, and the player gets his view back', async () => {
  const v = await bare();
  await page.evaluate(() => { const s = window.__game.strategy; window.__w = s.aiWar({ from: 12, to: 8, att: 2, def: 3, attName: '袁绍', defName: '曹操' }); window.__w.march(800); });
  same(await settled(), v, 'the board fits: frame does not move it');
  await page.evaluate(() => window.__w.clash(800));
  const close = await settled();
  assert.ok(close.k > v.k * 1.9, `closer in: ${close.k} from ${v.k}`);
  const fight = await page.evaluate(() => { const d = window.__game.strategy.flatDebug().aiWar; return { x: (d.a.x + d.d.x) / 2, y: (d.a.y + d.d.y) / 2 }; }), [fx, fy] = toScreen(close, fight.x, fight.y);
  assert.ok(Math.abs(fx - 720) < 60 && Math.abs(fy - 450) < 80, `on the fight: ${fx}, ${fy}`);
  await page.evaluate(() => window.__w.dispose());
  same(await settled(), v, 'back to the whole board');
  await zoomAllOut();
});

// The player's moves in a show: start where given, run the show with a move at the given beat, end it, and see where the view lands.
const WAR_NOW = `window.__w = window.__game.strategy.aiWar({ from: 12, to: 8, att: 2, def: 3, attName: '袁绍', defName: '曹操' });`;
const goalOf = (v) => ({ k: v.k, cx: (720 - v.x) / v.k, cy: (450 - v.y) / v.k });
const nearGoal = (a, b, what) => assert.ok(Math.hypot(a.cx - b.cx, a.cy - b.cy) < 8, `${what}: ${JSON.stringify([a, b])}`);

test('a pan in the march is his: the clash still closes in, and he gets that place and his zoom back', async () => {
  await bare();
  await page.evaluate(() => { const s = window.__game.strategy; s.zoom(-99999); s.focusCity(8); });
  await settled();
  await page.evaluate((w) => { eval(w); window.__w.march(800); }, WAR_NOW);
  const before = await settled();
  await page.evaluate(() => window.__game.strategy.pan(-1.5, 0.8)); const panned = goalOf(await settled());
  assert.ok(Math.hypot(panned.cx - goalOf(before).cx, panned.cy - goalOf(before).cy) > 50, 'the pan moved it');
  await page.evaluate(() => window.__w.clash(800));
  const fight = goalOf(await settled());
  assert.ok(Math.hypot(fight.cx - panned.cx, fight.cy - panned.cy) > 30, `the clash goes to the fight: ${JSON.stringify([fight, panned])}`);
  await page.evaluate(() => window.__w.dispose());
  const back = await settled();
  assert.ok(Math.abs(back.k - before.k) < 1e-3, 'his zoom'); nearGoal(goalOf(back), panned, 'his place');
  await zoomAllOut();
});

test('a tap in the clash keeps its place, but a whole-board player still gets the whole board, and so does the next war', async () => {
  const v = await bare();
  await page.evaluate((w) => { eval(w); window.__w.march(800); window.__w.clash(800); }, WAR_NOW);
  await settled();
  await page.evaluate(() => window.__game.strategy.pan(0.6, 0)); const tapped = goalOf(await settled());
  await page.evaluate(() => window.__w.dispose());
  same(await settled(), v, 'the zoom comes back: at the whole board the place cannot show');
  await page.evaluate(() => window.__game.strategy.zoom(-99999)); // the wish was kept: zoomed in again, the view is where he tapped to
  nearGoal(goalOf(await settled()), tapped, 'his place is still the wish');
  await zoomAllOut();
  await page.evaluate((w) => { eval(w); window.__w.march(800); window.__w.clash(800); window.__w.dispose(); }, WAR_NOW);
  same(await settled(), v, 'and the next war starts from it and ends on it');
});

test('a zoom in the clash is his too, and its place comes back on its own', async () => {
  const v = await bare();
  // A city near the middle of the board: its place is not cut short by the edge at either zoom.
  const mid = board.cities.reduce((p, q) => (Math.hypot(q.cx - (x0 + x1) / 2, q.cy - (y0 + y1) / 2) < Math.hypot(p.cx - (x0 + x1) / 2, p.cy - (y0 + y1) / 2) ? q : p));
  await page.evaluate((id) => { const s = window.__game.strategy; s.zoom(-300); s.focusCity(id); }, mid.id);
  const start = await settled();
  await page.evaluate((w) => { eval(w); window.__w.march(800); window.__w.clash(800); }, WAR_NOW);
  await settled();
  await page.evaluate(() => window.__game.strategy.zoom(250)); const zoomed = await settled();
  assert.ok(zoomed.k < v.k * 2 - 0.01 && zoomed.k > start.k * 0.5, `zoomed by hand: ${zoomed.k}`);
  await page.evaluate(() => window.__w.dispose());
  const back = await settled();
  assert.ok(Math.abs(back.k - zoomed.k) < 1e-3, 'his zoom stays'); nearGoal(goalOf(back), goalOf(start), 'the place he had');
  await zoomAllOut();
});

test('the standard is painted over the flags and under the tags', async () => {
  const v = await bare(), c = city(13), [fx, fy] = toScreen(v, c.flag[0], c.flag[1]), probes = [[fx + 2, fy + 4], [fx + 5, fy + 4], [fx + 8, fy + 4]]; // into a city's own flag, the road south from it
  const flag = await pixels(probes);
  // Stepped until the cloth hangs over that flag, marching out of the flag's own city, then left up for the frame loop to draw.
  const at = await stepped(`const w = s.aiWar({ from: 13, to: 22, att: arg.att, def: 3, attName: '袁绍', defName: '曹操' }); window.__w = w; w.march(4000); w.tick(0.4);
    const v = s.viewState(); for (let i = 0; i < 400 && (dbg().a.y - arg.fy) * v.k < 52; i++) w.tick(0.01);
    window.__w.tick = () => {}; return dbg().a;`, { fy: c.flag[1], att: 2 });
  await page.waitForTimeout(120);
  assert.ok((at.y - c.flag[1]) * v.k >= 50, `under the flag: ${JSON.stringify(at)}`);
  const over = await pixels(probes);
  assert.ok(over.every((p, i) => far(p, flag[i]) > 40), `the cloth hides the flag: ${JSON.stringify([flag, over])}`);
  // The tag of the same city, with the standard at it, still takes the point: the tags are a layer above the canvas.
  const tag = await page.evaluate(() => { const e = document.querySelectorAll('.flatstrategy .ctag')[13], r = e.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2, hit = document.elementFromPoint(x, y); return { on: !!hit.closest('.ctag'), same: hit.closest('.ctag') === e, above: !!document.querySelector('.flatstrategy canvas + .labels') }; });
  assert.deepEqual(tag, { on: true, same: true, above: true });
  await page.evaluate(() => window.__w.dispose()); await settled();
  same(await zoomAllOut(), v, 'view restored');
});

test('the sky is the month\'s: rain in 五月, snow in 十二月, blossom in 二月, leaves in 十月, clear in 四月', async () => {
  const at = async (m) => { await page.evaluate((m) => window.__game.strategy.setSeason(m, true), m); return (await dbg()).weather; };
  const may = await at(4), apr = await at(3), dec = await at(11), feb = await at(1), oct = await at(9);
  assert.ok(may.rain > 0 && may.thunder > 0); assert.equal(apr.rain + apr.snowfall + apr.petals + apr.fall, 0); assert.ok(dec.snowfall > 0.9);
  assert.ok(feb.petals > 0.9); assert.ok(oct.fall > 0.9);
});

// New bright pixels (a flake) or pink ones (a petal) against the same view with the sky off, in a box of the canvas, over several frames: none of the flags there.
const fallen = async (box, frames = 10) => {
  const read = () => page.evaluate(([x, y, w, h]) => [...document.querySelector('.flatstrategy canvas').getContext('2d').getImageData(x, y, w, h).data], box);
  await page.evaluate(() => window.__game.strategy.debugSky(false)); await page.waitForTimeout(120);
  const off = await read();
  await page.evaluate(() => window.__game.strategy.debugSky(true));
  let n = 0;
  for (let f = 0; f < frames; f++) {
    await page.waitForTimeout(90);
    const on = await read();
    for (let i = 0; i < on.length; i += 4) if (on[i] > 190 && on[i + 1] > 150 && Math.abs(on[i] - off[i]) + Math.abs(on[i + 1] - off[i + 1]) + Math.abs(on[i + 2] - off[i + 2]) > 90) n++;
  }
  await page.evaluate(() => window.__game.strategy.debugSky(false));
  return n;
};
const bandOnScreen = async (kind) => { const v = await view(), [a, b] = (await dbg()).skyBands[kind]; return [a * v.k + v.y, b * v.k + v.y]; };
const season1 = async (m) => { await page.evaluate((m) => window.__game.strategy.setSeason(m, true), m); await page.waitForTimeout(150); };

test('at the whole board 十二月\'s snow stops at its line, over the table as well', async () => {
  await bare(); await season1(11);
  const [a, b] = await bandOnScreen('snowfall');
  assert.ok(a > 200 && b < 600 && b > a, `the band is in the window: ${a}, ${b}`);
  const margin = 130; // the table left of the board
  assert.ok(await fallen([0, 0, margin, Math.floor(a) - 4]) > 0, 'snow north of the line');
  assert.equal(await fallen([0, Math.ceil(b) + 2, margin, 900 - Math.ceil(b) - 2]), 0, 'none south of it');
  await bare();
});

test('at the whole board blossom falls south of the 黄河, as the 3D map\'s rule has it, and not north of it', async () => {
  await bare(); await season1(1);
  const [a, b] = await bandOnScreen('petals');
  assert.ok(b < a && b > 0, `the band is in the window: ${a}, ${b}`);
  const margin = 130;
  assert.ok(await fallen([0, Math.ceil(a) + 2, margin, 900 - Math.ceil(a) - 2]) > 0, 'blossom south of it');
  assert.equal(await fallen([0, 0, margin, Math.floor(b) - 2]), 0, 'none north of it');
  await bare();
});

test('zoomed in, the limit moves with the board: over the sea east of 青州 the snow still stops at its line, and the far south has none', async () => {
  await bare(); await season1(11);
  const whole = await bandOnScreen('snowfall');
  await page.evaluate(() => { const s = window.__game.strategy; s.zoom(-99999); s.focusCity(3); }); await settled();
  const [a, b] = await bandOnScreen('snowfall');
  assert.ok(Math.abs(a - whole[0]) > 100, `it moved with the view: ${whole} → ${a}, ${b}`);
  assert.ok(b < 880 && a > 100, `in the window: ${a}, ${b}`);
  const box = (y0, y1) => [1230, Math.ceil(y0), 180, Math.floor(y1 - y0)];
  assert.ok(await fallen(box(40, a - 4)) > 0, 'snow north of the line');
  assert.equal(await fallen(box(b + 2, 900)), 0, 'none south of it');
  const south = board.cities.reduce((p, q) => (q.cy > p.cy ? q : p));
  await page.evaluate((id) => window.__game.strategy.focusCity(id), south.id); await settled();
  assert.ok((await bandOnScreen('snowfall'))[1] < 0, 'the far south is below it altogether');
  await bare();
});

test('rain dims and streaks the picture; a clear month draws nothing over it', async () => {
  const mean = () => page.evaluate(() => {
    const cv = document.querySelector('.flatstrategy canvas'), d = cv.getContext('2d').getImageData(cv.width / 2 - 200, cv.height / 2 - 200, 400, 400).data; let n = 0;
    for (let i = 0; i < d.length; i += 4) n += d[i] + d[i + 1] + d[i + 2];
    return n / (d.length / 4) / 3;
  });
  await bare();
  await page.evaluate(() => { const s = window.__game.strategy; s.debugSky(true); s.setSeason(3, true); }); // 四月 and 六月 share a picture
  await page.waitForFunction(() => window.__game.strategy.flatDebug().layers.join() === 'summer', null, { timeout: 15000 }); await page.waitForTimeout(200);
  const clear = await mean(), again = await mean();
  assert.ok(Math.abs(clear - again) < 2, 'clear: the same frame after frame (the flags aside)');
  await page.evaluate(() => window.__game.strategy.setSeason(5, true)); await page.waitForTimeout(200);
  const rainy = await mean();
  assert.ok(rainy < clear * 0.75, `六月 is darker than 四月 over the same picture: ${rainy} against ${clear}`);
  await bare();
});

test('the fight\'s own city lets its tag fade for the clash, and has it back for the outcome', async () => {
  await bare();
  const o = (id) => page.evaluate((id) => document.querySelectorAll('.flatstrategy .ctag')[id].style.getPropertyValue('--o'), id);
  await page.evaluate(() => { window.__w = window.__game.strategy.aiWar({ from: 12, to: 8, att: 2, def: 3, attName: '袁绍', defName: '曹操' }); window.__w.march(800); });
  await page.waitForTimeout(100); assert.equal(await o(8), '1');
  await page.evaluate(() => window.__w.clash(800)); await page.waitForTimeout(100);
  assert.equal(await o(8), '0.3'); assert.equal(await o(12), '1');
  await page.evaluate(() => window.__w.end(true, 800)); await page.waitForTimeout(100); assert.equal(await o(8), '1');
  await page.evaluate(() => window.__w.clash(800)); await page.evaluate(() => window.__w.dispose()); await page.waitForTimeout(100); assert.equal(await o(8), '1', 'skipped: back at once');
  await zoomAllOut();
});

test('an AI war through the app: its three captions, 7.09 s, the outcome on the city, nothing left', async () => {
  await bare();
  const r = await page.evaluate(async () => {
    const { g, io, strategy } = window.__game, fs = g.factions.filter((f) => f.ruler != null && f.id !== g.player);
    const city = g.cities.find((c) => c.faction === fs[1].id).id, from = window.__game.G.data().cities[city].roads[0], t0 = performance.now(), words = [], stages = new Set(), seen = new Set();
    const watch = setInterval(() => {
      const w = document.querySelector('.aiwar')?.textContent; if (w && w !== words.at(-1)) words.push(w);
      const d = strategy.flatDebug().aiWar; if (d) stages.add(d.stage);
      const n = document.querySelector('.ctag.news'); if (n) seen.add(n.dataset.news);
    }, 30);
    await io.event({ type: 'autobattle', war: { attacker: fs[0].id, defender: fs[1].id, city, from, att: { ids: [fs[0].ruler] } }, res: { attWins: false } });
    clearInterval(watch);
    return { total: performance.now() - t0, words, stages: [...stages], seen: [...seen], left: strategy.flatDebug().aiWar ?? null, att: window.__game.G.factionName(g, fs[0].id), def: window.__game.G.factionName(g, fs[1].id) };
  });
  assert.ok(Math.abs(r.total - 7090) < 709, `took ${Math.round(r.total)} ms`);
  assert.deepEqual(r.words, [`${r.att}军出阵`, `${r.att}军战斗中`, `${r.def}军胜利`]);
  assert.deepEqual(r.stages, ['march', 'clash', 'end']); assert.equal(r.left, null);
  assert.equal(r.seen.length, 1); assert.match(r.seen[0], /守住$/);
  await zoomAllOut();
});

// The AI rarely marches this early (no war in 16 months, run on 2026-11-06), so this proves the round, not the show: 'an AI war through the app' above has the show.
test('a real AI month passes on the flat map and hands back to the player', async () => {
  await bare();
  const month = await page.evaluate(() => window.__game.g.month), stop = closeMessages(page);
  try {
    await page.getByRole('button', { name: '结束本月行动' }).click();
    await page.locator('.shade .btn.primary', { hasText: '确定' }).click();
    // Someone marching on the player ends this as well as the month's end does: that war is another file's.
    await page.waitForFunction((m) => { const g = window.__game.g; return document.body.dataset.screen !== 'strategy' || (g.month !== m && g.current === g.player && !document.querySelector('.aiturn, .panel.msg')); }, month, { timeout: 150000 });
  } finally { stop(); }
  assert.equal((await dbg()).aiWar, null);
});

const hd2dRow = (p) => p.locator('.sysmenu-list button', { hasText: 'HD-2D' });

test('H does nothing on the flat map and raises nothing; the 系统 row says it is not available', async () => {
  const on = () => page.evaluate(() => window.__game.debug.post.enabled), was = await on();
  await page.keyboard.press('h');
  assert.equal(await on(), was, 'H has nothing to switch here');
  await page.click('.sysmenu-btn');
  assert.ok(await hd2dRow(page).isDisabled(), 'the row is not available');
  assert.equal(await hd2dRow(page).textContent(), 'HD-2D 不可用');
  assert.match(await hd2dRow(page).getAttribute('title'), /画质「低」时战略地图是平面画面/);
  await page.click('.sysmenu-btn');
});

test('Q, E and a right drag leave the view where it is', async () => {
  await zoomAllIn();
  const a = await settled();
  for (const k of ['q', 'e', 'q', 'e']) await page.keyboard.press(k);
  const spot = await bareSpot();
  await page.mouse.move(spot.x, spot.y); await page.mouse.down({ button: 'right' }); await page.mouse.move(spot.x + 120, spot.y + 60, { steps: 4 }); await page.mouse.up({ button: 'right' });
  same(await settled(), a, 'the turn keys and the right button');
  await zoomAllOut();
});

test('V hides the HUD over the flat map and V or Esc brings it back, with the view and the selection as they were', async () => {
  const scenic = () => page.evaluate(() => ({ on: document.body.classList.contains('scenic'), exit: !!document.querySelector('.scenic-exit') }));
  const city = await page.evaluate(() => window.__game.g.factions[window.__game.g.player].city);
  await page.evaluate((c) => window.__game.strategy.focusCity(c), city);
  const p = await page.evaluate((c) => window.__game.strategy.screenOfCity(c), city);
  await page.mouse.click(p.x, p.y);
  const a = await settled(), name = await page.locator('.citypanel header h2').textContent();
  for (const leave of ['v', 'Escape']) {
    await page.keyboard.press('v');
    assert.deepEqual(await scenic(), { on: true, exit: true }, 'V goes in');
    await page.keyboard.press('h'); // among the keys the scenic view lets through: no error
    await page.keyboard.press(leave);
    assert.deepEqual(await scenic(), { on: false, exit: false }, `${leave} comes out`);
    same(await settled(), a, `${leave} leaves the view`);
    assert.equal((await page.evaluate(() => window.__game.strategy.flatDebug().selected)), city, `${leave} gives the selection back`);
    assert.equal(await page.locator('.citypanel header h2').textContent(), name);
  }
});

test('说明 and the 系统 rows tell the player the low setting\'s map is flat too', async () => {
  await page.click('.sysmenu-btn');
  assert.match(await page.locator('.sysmenu-list button', { hasText: /^画质 / }).getAttribute('title'), /低：.*战略地图是平面画面，不能旋转.*「☰ 系统 → 战场」/);
  assert.match(await page.locator('.sysmenu-list button', { hasText: /^战场 / }).getAttribute('title'), /随画质：画质「低」时平面.*平面：始终平面.*3D：始终/);
  assert.doesNotMatch(await page.locator('.sysmenu-list button', { hasText: '欣赏模式' }).getAttribute('title'), /旋转/, 'nothing here turns');
  await page.locator('.sysmenu-list button', { hasText: '说明' }).click();
  const text = await page.locator('.help').textContent();
  assert.ok(text.includes('画质「低」时战略地图是平面画面，不能旋转'), text);
  assert.ok(text.includes('战场是平面还是3D看「☰ 系统 → 战场」'), text);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.help'));
});

// The kept picture layer against what it ought to hold: the season's picture at the view, mean difference per channel over the board. The owners' tint is on it too, so this is small, not zero.
const underAgainst = (p, season) => p.evaluate(async (season) => {
  const s = window.__game.strategy, under = s.debugUnder(), { k, x, y } = s.viewState(), dpr = under.width / innerWidth, W = 160, H = 100;
  const img = await createImageBitmap(await (await fetch(`assets/ai/sandtable/flat/${season}.webp`)).blob());
  const ref = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true }), now = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true });
  ref.setTransform(W / under.width * dpr, 0, 0, H / under.height * dpr, 0, 0); ref.drawImage(img, x, y, img.width * k, img.height * k);
  now.drawImage(under, 0, 0, W, H);
  const a = ref.getImageData(0, 0, W, H).data, b = now.getImageData(0, 0, W, H).data;
  let sum = 0, n = 0;
  for (let i = 0; i < a.length; i += 4) if (a[i + 3] > 250) { sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); n += 3; }
  return n > 3000 ? sum / n : Infinity;
}, season);
const SEASON_OF = (m) => ['spring', 'summer', 'autumn', 'winter'][Math.floor(m / 3)];

test('a frame with only flags and rings moving does not paint the picture again; what lies in the picture does', async () => {
  const paints = () => page.evaluate(() => window.__game.strategy.flatDebug().underPaints);
  const tintAt = (id) => page.evaluate((id) => { // the kept layer round a town, past its own flag and tag, which are not on it
    const s = window.__game.strategy, u = s.debugUnder(), at = s.screenOfCity(id), dpr = u.width / innerWidth;
    const d = u.getContext('2d').getImageData(at.x * dpr - 40, at.y * dpr - 40, 80, 80).data; let sum = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += d[i + c];
    return sum.map((v) => v / (d.length / 4));
  }, id);
  await zoomAllOut();
  const month = await page.evaluate(() => { const { g, strategy: s } = window.__game; s.territory(true); s.debugSky(false); s.setSeason(g.month, true); s.select(g.factions[g.player].city); return g.month; }); // no weather: rain lying on the ground changes the picture by itself
  try {
    await page.waitForTimeout(3500); // the table's colour has landed
    const still = await paints();
    await page.waitForTimeout(600);
    assert.equal(await paints(), still, 'the flags sway and the ring beats over the kept picture');
    await page.evaluate(() => window.__game.strategy.roads(true)); await page.waitForTimeout(150);
    const roads = await paints();
    assert.ok(roads > still, 'the road overview');
    await page.evaluate(() => window.__game.strategy.roads(false)); await page.waitForTimeout(150);
    const off = await paints();
    assert.ok(off > roads, 'and off again');

    // A town changes hands: the kept picture wears the new owner's tint at once, and the old one again when it goes back.
    const { id, was } = await page.evaluate(() => { const { g } = window.__game, c = g.cities.find((x) => x.faction != null && x.faction !== g.player && g.factions[x.faction]); return { id: c.id, was: c.faction }; });
    const before = await tintAt(id);
    await page.evaluate(({ id }) => { const { g, strategy: s } = window.__game; g.cities[id].faction = g.player; s.refresh(g); }, { id }); await page.waitForTimeout(150);
    const taken = await paints(), after = await tintAt(id);
    assert.ok(taken > off, 'the owners\' tint');
    assert.ok(Math.max(...after.map((v, i) => Math.abs(v - before[i]))) > 2, `the town takes its new owner's colour: ${before} → ${after}`);
    await page.evaluate(({ id, was }) => { const { g, strategy: s } = window.__game; g.cities[id].faction = was; s.refresh(g); }, { id, was }); await page.waitForTimeout(150);
    const back = await tintAt(id);
    assert.ok(Math.max(...back.map((v, i) => Math.abs(v - before[i]))) < 1, `and the old one back: ${before} → ${back}`);

    // A change of season cross-fades through the kept layer and lands on the next picture.
    const cur = SEASON_OF(month), other = (month + 6) % 12, next = SEASON_OF(other);
    assert.ok(await underAgainst(page, cur) < await underAgainst(page, next) * 0.8, 'it holds this season\'s picture');
    const fading = await paints();
    await page.evaluate((m) => window.__game.strategy.setSeason(m), other);
    await page.waitForFunction((s) => { const { layers } = window.__game.strategy.flatDebug(); return layers.at(-1) === s && layers.length > 1; }, next, { timeout: 15000 });
    await page.waitForTimeout(500);
    const mid = await paints();
    assert.ok(mid > fading + 2, `each frame of the fade is painted: ${fading} → ${mid}`);
    await page.waitForFunction((s) => { const { layers } = window.__game.strategy.flatDebug(); return layers.length === 1 && layers[0] === s; }, next, { timeout: 15000 });
    await page.waitForTimeout(3000);
    const landed = [await underAgainst(page, next), await underAgainst(page, cur)];
    assert.ok(landed[0] < landed[1] * 0.8, `the next season's picture is what is kept now: ${landed}`);
    await page.evaluate((m) => window.__game.strategy.setSeason(m, true), month); await page.waitForTimeout(3000);

    // A resize: a new layer the size of the window, with the same picture in it at the new view.
    const sized = await paints(), good = await underAgainst(page, cur);
    await page.setViewportSize({ width: 1000, height: 640 }); await page.waitForTimeout(400);
    const small = await page.evaluate(() => { const u = window.__game.strategy.debugUnder(), dpr = devicePixelRatio || 1; return { w: u.width, h: u.height, want: [innerWidth * dpr, innerHeight * dpr] }; });
    assert.deepEqual([small.w, small.h], small.want);
    assert.ok(await paints() > sized, 'a resize');
    const fit = await underAgainst(page, cur);
    assert.ok(fit < good * 1.5 + 3, `the picture lies right at the new size: ${good} → ${fit}`);
    await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(400);

    const tint = await paints();
    await zoomAllIn();
    assert.ok(await paints() > tint, 'a zoom');
    await zoomAllOut();
  } finally {
    await page.evaluate(() => { const { g, strategy: s } = window.__game; s.territory(false); s.debugSky(true); s.setSeason(g.month, true); s.select(null); });
    await page.setViewportSize({ width: 1440, height: 900 });
  }
});

test('a flat war still wears its HUD class, and the map returns after it', async () => {
  await page.evaluate(() => {
    const { g, debug } = window.__game, home = g.factions[g.player].city;
    const foe = g.cities.find((x) => x.faction !== g.player && x.faction != null && g.factions[x.faction] && x.officers.length);
    const ids = g.cities[home].officers.slice(0, 2), def = [foe.officers[0]];
    for (const id of [...ids, ...def]) g.officers[id].soldiers ||= 500;
    debug.fieldWar({ city: foe.id, from: home, attacker: g.player, defender: foe.faction, day: 1, att: { ids, gold: 500, rice: 400 }, def: { ids: def, gold: 0, rice: 400 } }, 'att');
  });
  await page.waitForFunction(() => window.__game.war?.finishDeploy && document.body.dataset.screen === 'war', null, { timeout: 30000 });
  const r = await page.evaluate(() => ({ flat2d: document.body.classList.contains('flat2d'), war: getComputedStyle(document.querySelector('.flatwar')).display, map: getComputedStyle(document.querySelector('.flatstrategy')).display }));
  assert.deepEqual(r, { flat2d: true, war: 'block', map: 'none' });
});

test('no page errors', () => assert.deepEqual(page.errors, []));

// ---- The shell (src/strategyshell.js): which map the 画质 asks for, loaded when it is first asked for.
const SAND = /sandtable\/board\/(albedo\.webp|light\.webp|height\.bin|mask\.png|sea\.png|frame\.jpg|board\.json|models\/)/;
const FLAT_ART = /sandtable\/flat\//;
async function openAt(level, routes = {}) {
  const requests = [];
  const p = await game.open('', { setup: async (ctx) => {
    await ctx.addInitScript((l) => localStorage.setItem('hd2d-quality', l), level);
    ctx.on('request', (r) => requests.push(r.url()));
    for (const [glob, handler] of Object.entries(routes)) await ctx.route(glob, handler);
  } });
  p.requests = requests;
  return p;
}
const look = (p) => p.evaluate(() => {
  const s = window.__game.strategy, b = document.body.classList, layer = document.querySelector('.flatstrategy');
  return { kind: s.kind, has3d: s.has3d, flat: !!s.flat, slide: !!s.slide, layer: layer ? getComputedStyle(layer).display : 'none', flatmap: b.contains('flatmap'), flat2d: b.contains('flat2d'), roads: s.roadsOn, month: s.month, panel: document.querySelector('.citypanel header h2')?.textContent ?? null };
});
const setQuality = (p, l) => p.evaluate((l) => window.__game.debug.quality.set(l), l);
const toastText = (p) => p.evaluate(() => document.querySelector('body > .toast')?.textContent ?? '');
const kindIs = (p, kind) => p.waitForFunction((k) => window.__game.strategy.kind === k && !document.querySelector('#fade.on'), kind, { timeout: 60000 });
// The shared season uniforms: 白兵 and 单挑 read these, and so do the 3D map's materials.
const snowLine = (p) => p.evaluate(async () => (await import(new URL('src/seasons.js', location.href).href)).U.uSnowLat.value);

test('at the low setting the game boots on the flat map, without one sand table download', async () => {
  await page.context().close(); // one game window at a time
  const p = await openAt('low');
  const r = await look(p);
  assert.deepEqual([r.kind, r.has3d, r.flat, r.slide, r.flatmap, r.flat2d], ['flat', false, true, true, true, false]);
  assert.deepEqual(p.requests.filter((u) => SAND.test(u)), []);
  await p.context().close();
});

// A log of the view at every frame, to catch a jump between two of them.
const logView = (p) => p.evaluate(() => {
  const log = window.__viewLog = [];
  const step = () => { const s = window.__game.strategy; if (s.viewState) log.push(s.viewState()); window.__viewLogId = requestAnimationFrame(step); };
  step();
});
const biggestStep = (p) => p.evaluate(() => {
  cancelAnimationFrame(window.__viewLogId);
  let most = 0; const L = window.__viewLog, s = window.__game.strategy, W = innerWidth, H = innerHeight;
  // How far any corner of the window moved on the picture, between two frames.
  const moved = (a, b) => Math.max(...[[0, 0], [W, 0], [0, H], [W, H]].map(([cx, cy]) => Math.hypot((cx - a.x) / a.k - (cx - b.x) / b.k, (cy - a.y) / a.k - (cy - b.y) / b.k) * b.k));
  for (let i = 1; i < L.length; i++) most = Math.max(most, moved(L[i - 1], L[i]));
  // The whole way, first frame to last: the view eases (1 − e^(−8·dt) of what is left a frame: ~12% at 60 fps, at most 33% on
  // one long frame, as app.js clamps dt to 50 ms), so its first step is the largest and grows with how far the title's pan had
  // wandered and how long the setup screen's first frame took (it is under the opaque title picture then); a jump is all of it.
  return { most, total: L.length ? moved(L[0], L[L.length - 1]) : 0, frames: L.length };
});
const wholeBoard = (w, h) => { const k = fit(w, h); return { k, x: w / 2 - (x0 + x1) / 2 * k, y: h / 2 - (y0 + y1) / 2 * k }; };

test('the low title pans the board slowly, in reach of 选择君主, and the campaign opens on the whole board with no jump', async () => {
  const p = await openAt('low');
  try {
    await p.keyboard.press('Escape');
    const look0 = await p.evaluate(() => window.__game.strategy.viewState());
    await p.waitForTimeout(1500);
    const look1 = await p.evaluate(() => window.__game.strategy.viewState());
    await p.waitForTimeout(4000);
    const look2 = await p.evaluate(() => window.__game.strategy.viewState());
    assert.ok(look1.k > fit(1440, 900) * 1.05, `the title is closer than the whole board, or there is nothing to pan: ${JSON.stringify(look1)}`);
    const moved = Math.hypot(look2.x - look1.x, look2.y - look1.y) / 4;
    assert.ok(moved > 1 && moved < 40, `slowly: ${moved} px a second`);
    const r = await p.evaluate(() => ({ cand: window.__game.strategy.flatDebug().candidates.length, sel: window.__game.strategy.flatDebug().selected }));
    assert.deepEqual(r, { cand: 0, sel: null });
    await skipIntro(p);
    await p.getByText('新的征程').click();
    await p.locator('.level', { hasText: 'LEVEL 1' }).waitFor();
    await p.locator('.ruler', { hasText: '刘备' }).waitFor();
    await logView(p);
    await p.locator('.level', { hasText: 'LEVEL 1' }).click();
    await p.locator('.ruler', { hasText: '刘备' }).click(); await p.locator('.ruler', { hasText: '刘备' }).click();
    await p.waitForFunction(() => document.body.dataset.screen === 'strategy');
    const stop = closeMessages(p);
    try { await p.waitForFunction(() => { const g = window.__game.g; return g.current === g.player && !document.querySelector('.aiturn, .panel.msg'); }, null, { timeout: 90000 }); } finally { stop(); }
    await p.waitForTimeout(1500);
    const end = await p.evaluate(() => window.__game.strategy.viewState()), step = await biggestStep(p), want = wholeBoard(1440, 900);
    assert.ok(Math.abs(end.k - want.k) < 1e-3 && Math.abs(end.x - want.x) < 1 && Math.abs(end.y - want.y) < 1, `the whole board: ${JSON.stringify([end, want])}`);
    assert.ok(step.most < step.total * 0.4, `no jump: ${JSON.stringify(step)}`);
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); }
});

test('under the title, which covers the whole window, the pan draws nothing; the map is there the moment it is not covered', async () => {
  const p = await openAt('low');
  try {
    await skipIntro(p);
    const read = () => p.evaluate(() => ({ paints: window.__game.strategy.flatDebug().underPaints, view: window.__game.strategy.viewState() }));
    await p.waitForTimeout(800);
    const a = await read();
    await p.waitForTimeout(1500);
    const b = await read();
    assert.equal(b.paints, a.paints, 'nothing painted behind the title');
    assert.ok(Math.hypot(b.view.x - a.view.x, b.view.y - a.view.y) > 0.5, `and the pan still runs: ${JSON.stringify([a.view, b.view])}`);
    // Whenever the title goes, what replaces it covers that frame or the map has been drawn already: check every frame from then on.
    await p.evaluate(() => {
      const log = window.__uncover = [];
      const look = () => {
        if (!document.querySelector('.tt')) {
          const c = document.querySelector('.flatstrategy canvas'), d = c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data;
          log.push({ art: !!document.querySelector('.title-art'), veil: +getComputedStyle(document.querySelector('#fade')).opacity, paints: window.__game.strategy.flatDebug().underPaints, centre: [...d] });
        }
        if (log.length < 12) requestAnimationFrame(look);
      };
      requestAnimationFrame(look);
    });
    await p.getByText('新的征程').click();
    await p.waitForFunction(() => window.__uncover.length >= 12);
    const seen = await p.evaluate(() => window.__uncover);
    assert.ok(seen.every((f) => f.paints > a.paints || f.art || f.veil > 0.9), `drawn, or covered by the setup's art or the fade: ${JSON.stringify(seen)}`);
    assert.ok(seen.at(-1).paints > a.paints, `drawn soon after: ${JSON.stringify(seen)}`);
    assert.ok(seen.at(-1).centre[3] === 255 && seen.at(-1).centre.slice(0, 3).some((v) => v > 12), `a picture, not an empty canvas: ${seen.at(-1).centre}`);
    await p.locator('.level', { hasText: 'LEVEL 1' }).click();
    await p.locator('.ruler', { hasText: '刘备' }).click(); await p.locator('.ruler', { hasText: '刘备' }).click();
    await p.waitForFunction(() => document.body.dataset.screen === 'strategy');
    const c = await read();
    await p.waitForTimeout(600);
    assert.ok((await read()).paints > c.paints - 1 && c.paints > a.paints, 'and in the campaign');
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); }
});

test('straight from the panning title into a record: the map eases to the whole board, keeps the ruler\'s city as the wish, and the pan does not come back', async () => {
  const seed = await openAt('low');
  await newCampaign(seed, '刘备');
  const save = await saveCampaign(seed);
  await seed.context().close();
  const p = await game.open('', { save, setup: (ctx) => ctx.addInitScript(() => localStorage.setItem('hd2d-quality', 'low')) });
  try {
    await skipIntro(p);
    await p.waitForTimeout(1500); // well into the pan, and away from the middle
    assert.ok((await p.evaluate(() => window.__game.strategy.viewState())).k > fit(1440, 900) * 1.05, 'the pan is on');
    await logView(p);
    const under = await p.evaluate(() => window.__game.strategy.flatDebug().underPaints);
    await p.evaluate(() => { // the first frames without the title: under the fade, and drawn while it is still up
      const log = window.__uncover = [];
      const look = () => { if (!document.querySelector('.tt')) log.push({ veil: +getComputedStyle(document.querySelector('#fade')).opacity, paints: window.__game.strategy.flatDebug().underPaints }); if (log.length < 4) requestAnimationFrame(look); };
      requestAnimationFrame(look);
    });
    await p.getByText('继续记录').click();
    await p.waitForFunction(() => { const g = window.__game.g; return document.body.dataset.screen === 'strategy' && g?.current === g.player && !document.querySelector('.aiturn, .panel.msg'); }, null, { timeout: 30000 });
    await p.waitForTimeout(1500);
    const a = await p.evaluate(() => window.__game.strategy.viewState());
    await p.waitForTimeout(1500);
    const b = await p.evaluate(() => window.__game.strategy.viewState()), step = await biggestStep(p), want = wholeBoard(1440, 900);
    assert.ok(step.most < step.total * 0.4, `no jump: ${JSON.stringify(step)}`);
    const seen = await p.evaluate(() => window.__uncover);
    assert.ok(seen.every((f) => f.paints > under || f.veil > 0.9) && seen.at(-1).paints > under, `no uncovered frame without the map: ${JSON.stringify(seen)}`);
    for (const v of [a, b]) assert.ok(Math.abs(v.k - want.k) < 1e-3 && Math.abs(v.x - want.x) < 1 && Math.abs(v.y - want.y) < 1, `still: ${JSON.stringify([v, want])}`);
    // Zoomed in, the ruler's city is what the view goes to (begin's focusCity), not the title's last spot.
    const city = await p.evaluate(() => { const { g } = window.__game; return g.factions[g.player].city; });
    await p.evaluate(() => window.__game.strategy.zoom(-99999)); await p.waitForTimeout(1500);
    const at = await p.evaluate((c) => window.__game.strategy.screenOfCity(c), city);
    assert.ok(Math.abs(at.x - 720) < 380 && Math.abs(at.y - 450) < 170, `the ruler's city in view: ${JSON.stringify(at)}`);
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); }
});

test('the 系统 menu\'s HD-2D row follows a switch of map both ways, open or not', async () => {
  const p = await openAt('low');
  try {
    await newCampaign(p, '刘备');
    const row = hd2dRow(p), quality = p.locator('.sysmenu-list button', { hasText: /^画质 / }), post = () => p.evaluate(() => window.__game.debug.post.enabled);
    await p.click('.sysmenu-btn');
    assert.ok(await row.isDisabled(), 'flat at the start');
    await quality.click(); // 低 → 高, the 3D map still to load
    assert.match(await toastText(p), /正在准备3D画面，稍后切换；战场从下一场战争起生效/, 'true while the flat map stays up');
    assert.ok(await row.isDisabled(), 'still the flat map while the other loads');
    await kindIs(p, '3d');
    assert.ok(await row.isEnabled(), 'the open menu follows it to 3D');
    assert.equal(await row.getAttribute('title') ?? '', '');
    assert.equal(await row.textContent(), 'HD-2D 开');
    await row.click(); assert.equal(await row.textContent(), 'HD-2D 关'); assert.equal(await post(), false, 'it works again');
    await p.keyboard.press('h'); assert.equal(await post(), true, 'H too'); assert.equal(await row.textContent(), 'HD-2D 开', 'and the row says so');
    await quality.click(); await quality.click(); // 高 → 中 → 低
    assert.match(await toastText(p), /战略地图和战场改用平面画面，战场从下一场战争起生效/);
    await kindIs(p, 'flat');
    assert.ok(await row.isDisabled(), 'and back to flat');
    assert.equal(await row.textContent(), 'HD-2D 不可用');
    // A menu opened afresh agrees.
    await p.click('.sysmenu-btn'); await p.click('.sysmenu-btn');
    assert.ok(await row.isDisabled());
    await p.click('.sysmenu-btn');
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); }
});

// 系统 → 战场 (quality.js warView, 晚风和远方丶@bilibili 2026-11-13): 随画质 by default; 平面 or 3D hold the war map whatever the 画质.
test('the 战场 row cycles 随画质 → 平面 → 3D, is remembered, and the 画质 row then turns only the 战略地图', async () => {
  const p = await openAt('high');
  try {
    await newCampaign(p, '刘备');
    const row = p.locator('.sysmenu-list button', { hasText: /^战场 / }), quality = p.locator('.sysmenu-list button', { hasText: /^画质 / });
    await p.click('.sysmenu-btn');
    assert.equal(await row.textContent(), '战场 随画质（3D）');
    await row.click(); assert.equal(await row.textContent(), '战场 平面');
    assert.equal(await p.evaluate(() => localStorage.getItem('hd2d-war-view')), 'flat');
    await quality.click(); // 高 → 中: nothing flat changes
    assert.equal(await toastText(p), '', 'no notice when no map changes');
    await quality.click(); // 中 → 低: the 战略地图 goes flat, the war map stays what the row says
    assert.match(await toastText(p), /(战略地图改用平面画面|正在准备平面画面，稍后切换)；战场仍为平面（「战场」设为平面）/);
    await kindIs(p, 'flat');
    await row.click(); assert.equal(await row.textContent(), '战场 3D');
    await quality.click(); // 低 → 高
    assert.match(await toastText(p), /；战场仍为3D（「战场」设为3D）/);
    await row.click(); assert.equal(await row.textContent(), '战场 随画质（3D）', 'and round again');
    await quality.click(); await quality.click(); // 高 → 中 → 低
    assert.equal(await row.textContent(), '战场 随画质（平面）', 'the open menu follows the 画质');
    await row.click(); await p.click('.sysmenu-btn');
    await p.reload(); await p.waitForFunction(() => window.__game?.debug, null, { timeout: 60000 });
    await p.click('.sysmenu-btn');
    assert.equal(await row.textContent(), '战场 平面', 'remembered across a reload');
    await p.click('.sysmenu-btn');
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); }
});

test('the slow-map offer with the 战场 held says only the 战略地图 goes flat', async () => {
  const p = await game.open('', { setup: async (ctx) => {
    await ctx.addInitScript(() => {
      localStorage.setItem('hd2d-quality', 'medium'); localStorage.setItem('hd2d-war-view', '3d');
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      const raf = window.requestAnimationFrame.bind(window); let t = 0;
      window.requestAnimationFrame = (f) => raf(() => { t += 100; f(t); });
    });
  } });
  try {
    await newCampaign(p, '刘备');
    await p.waitForSelector('.qnotice', { timeout: 60000, state: 'attached' });
    const text = await p.locator('.qnotice p').textContent();
    assert.match(text, /改用「低」画质.*（战略地图将改用平面画面）/);
    assert.doesNotMatch(text, /战场/);
  } finally { await p.context().close(); }
});

test('the slow-map offer at 中 says both the map and the war go flat', async () => {
  const p = await game.open('', { setup: async (ctx) => {
    await ctx.addInitScript(() => {
      localStorage.setItem('hd2d-quality', 'medium');
      Object.defineProperty(navigator, 'webdriver', { get: () => false }); // the watch stands down for automation
      // A steady 10 frames a second, as the watch's clock sees it.
      const raf = window.requestAnimationFrame.bind(window); let t = 0;
      window.requestAnimationFrame = (f) => raf(() => { t += 100; f(t); });
    });
  } });
  try {
    await newCampaign(p, '刘备');
    await p.waitForSelector('.qnotice', { timeout: 60000, state: 'attached' });
    assert.match(await p.locator('.qnotice p').textContent(), /改用「低」画质.*战略地图和战场将改用平面画面，战场从下一场战争起生效/);
  } finally { await p.context().close(); }
});

test('at the high setting nothing of the flat map is fetched, and the shell has none of its hooks', async () => {
  const p = await openAt('high');
  const r = await look(p);
  // slide is the 3D map's too since the left button pans it (e7e485b0): it no longer tells the two maps apart.
  assert.deepEqual([r.kind, r.has3d, r.flat, r.slide, r.flatmap, r.layer], ['3d', true, false, true, false, 'none']);
  assert.deepEqual(p.requests.filter((u) => FLAT_ART.test(u)), []);
  assert.ok(p.requests.some((u) => SAND.test(u)));
  await p.context().close();
});

test('a 3D load that fails leaves the flat map up, with a notice, and a later try can still succeed', async () => {
  let fail = true;
  const p = await openAt('low', { '**/sandtable/board/board.json': (route) => (fail ? route.abort() : route.continue()) });
  await p.evaluate(() => { window.__toasts = 0; new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('toast')) window.__toasts++; }).observe(document.body, { childList: true }); });
  await setQuality(p, 'medium');
  await p.waitForFunction(() => /3D/.test(document.querySelector('body > .toast')?.textContent ?? ''), null, { timeout: 30000 });
  const r = await look(p);
  assert.deepEqual([r.kind, r.has3d, r.flat, r.layer, r.flatmap], ['flat', false, true, 'block', true]);
  // The map coming back again and again (from a war, say) does not try again, or say so again, until the setting changes.
  const boards = () => p.requests.filter((u) => /sandtable\/board\/board\.json/.test(u)).length, tried = boards();
  await p.evaluate(() => { for (let i = 0; i < 3; i++) window.__game.debug.show('strategy'); });
  await p.waitForTimeout(500);
  assert.equal(boards(), tried, 'no new fetch');
  assert.equal(await p.evaluate(() => window.__toasts), 1, 'one notice');
  fail = false;
  await setQuality(p, 'low'); await setQuality(p, 'high');
  await kindIs(p, '3d');
  assert.equal((await look(p)).layer, 'none');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('going back to low while the 3D map loads discards the load', async () => {
  let release; const held = new Promise((r) => { release = r; });
  const p = await openAt('low', { '**/sandtable/board/board.json': async (route) => { await held; await route.continue(); } });
  await setQuality(p, 'medium');
  await p.waitForTimeout(500);
  assert.deepEqual((({ kind, has3d, layer }) => [kind, has3d, layer])(await look(p)), ['flat', false, 'block'], 'still flat while it loads');
  await setQuality(p, 'low');
  release();
  await p.waitForFunction(() => window.__game.strategy.has3d, null, { timeout: 60000 });
  await p.waitForTimeout(1500);
  const r = await look(p);
  assert.deepEqual([r.kind, r.flat, r.layer, r.flatmap], ['flat', true, 'block', true]);
  assert.equal(await p.evaluate(() => document.querySelector('#fade').classList.contains('on')), false);
  await p.context().close();
});

test('with no flat board to load the game says so and boots on the 3D map', async () => {
  const p = await openAt('low', { '**/sandtable/flat/board.json': (route) => route.abort() });
  const r = await look(p);
  assert.deepEqual([r.kind, r.has3d, r.flat], ['3d', true, false]);
  assert.match(await toastText(p), /平面/);
  await p.context().close();
});

test('with no season picture at all it says so once and goes to the 3D map, and stays there', async () => {
  let fetched = 0;
  const p = await openAt('low', { '**/sandtable/flat/*.webp': (route) => { fetched++; route.abort(); } });
  assert.equal((await look(p)).kind, '3d');
  assert.match(await toastText(p), /平面/);
  const was = fetched;
  await p.evaluate(() => { const { strategy, G, debug } = window.__game; for (let i = 0; i < 3; i++) debug.show('strategy'); strategy.refresh(G.newGame(4, 1, 7)); });
  await p.waitForTimeout(400);
  assert.equal(fetched, was, 'no more tries');
  assert.equal((await look(p)).kind, '3d');
  await p.context().close();
});

test('with a picture showing, a season that will not load leaves it up: no notice, no 3D map, and another go at the next season', async () => {
  let fail = true, fetched = 0;
  const p = await openAt('low', { '**/sandtable/flat/{summer,autumn,winter}.webp': (route) => { fetched++; return fail ? route.abort() : route.continue(); } });
  await p.waitForTimeout(300); // the preload of the next season has failed too: autumn has no neighbour to fall back on
  await p.evaluate(() => window.__game.strategy.setSeason(7, true));
  await p.waitForTimeout(800);
  let r = await look(p);
  assert.deepEqual([r.kind, r.has3d, r.flat, r.layer], ['flat', false, true, 'block']);
  assert.deepEqual(await p.evaluate(() => window.__game.strategy.flatDebug().layers), ['spring'], 'the old picture');
  assert.equal(await toastText(p), '');
  assert.deepEqual(p.requests.filter((u) => SAND.test(u)), []);
  const was = fetched;
  await p.evaluate(() => { const { strategy, G } = window.__game, g = G.newGame(4, 1, 7); g.month = 7; for (let i = 0; i < 4; i++) strategy.refresh(g); strategy.setSeason(8); });
  await p.waitForTimeout(400);
  assert.equal(fetched, was, 'not again within the season');
  fail = false;
  await p.evaluate(() => window.__game.strategy.setSeason(10));
  await p.waitForFunction(() => window.__game.strategy.flatDebug().layers.at(-1) === 'winter', null, { timeout: 15000 });
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('mid-play low to medium: the flat map stays until the 3D map is in, and the switch keeps the play as it was', async () => {
  let release; const held = new Promise((r) => { release = r; });
  const p = await openAt('low', { '**/sandtable/board/albedo.webp': async (route) => { await held; await route.continue(); } });
  await newCampaign(p, '董卓');
  assert.equal(await p.locator('.terrbtn').getAttribute('aria-pressed'), 'false');
  await p.locator('.terrbtn').click();
  assert.equal(await p.evaluate(() => window.__game.strategy.territoryOn), true);
  const name = await p.evaluate(() => window.__game.G.cityName(11));
  await p.evaluate(() => { const { strategy } = window.__game; strategy.setSeason(10, true); strategy.roads(true); });
  await p.locator('.flatstrategy .ctag', { hasText: name }).click({ force: true });
  const snow = await snowLine(p), ui = await p.evaluate(() => document.body.dataset.season);
  await setQuality(p, 'medium');
  await p.waitForTimeout(800);
  let r = await look(p);
  assert.deepEqual([r.kind, r.has3d, r.layer, r.panel], ['flat', false, 'block', name], 'playing on while it loads');
  release();
  await p.waitForFunction(() => window.__game.strategy.has3d, null, { timeout: 60000 });
  assert.equal(await snowLine(p), snow, 'building the 3D map leaves the season uniforms on the month');
  await kindIs(p, '3d');
  assert.equal(await p.evaluate(() => window.__game.strategy.territoryOn), true, 'the enabled overlay crosses to 3D');
  assert.equal(await p.locator('.terrbtn').getAttribute('aria-pressed'), 'true');
  r = await look(p);
  assert.deepEqual([r.flat, r.slide, r.layer, r.flatmap, r.flat2d, r.roads, r.month, r.panel], [false, true, 'none', false, false, true, 10, name]);
  assert.ok(await p.evaluate(() => window.__game.strategy.scene.children.some((m) => m.userData?.t != null)), 'the 3D map has the selected city\'s roads running');
  assert.equal(await snowLine(p), snow); assert.equal(await p.evaluate(() => document.body.dataset.season), ui);

  // And back at once, with what the 3D map was given since.
  await p.evaluate(() => { const s = window.__game.strategy; s.roads(false); s.setSeason(4, true); });
  const snow4 = await snowLine(p);
  await setQuality(p, 'low');
  await kindIs(p, 'flat');
  assert.equal(await p.evaluate(() => window.__game.strategy.territoryOn), true, 'the enabled overlay crosses back to flat');
  r = await look(p);
  assert.deepEqual([r.flat, r.slide, r.has3d, r.layer, r.flatmap, r.flat2d, r.roads, r.month, r.panel], [true, true, true, 'block', true, false, false, 4, name]);
  assert.equal(await snowLine(p), snow4);
  assert.equal(await p.evaluate(() => window.__game.strategy.currentSeason), 'summer');
  await p.waitForFunction(() => window.__game.strategy.flatDebug().layers.at(-1) === 'summer', null, { timeout: 15000 });
  assert.equal(await p.evaluate((n) => [...document.querySelectorAll('.flatstrategy .ctag')].find((e) => e.textContent.startsWith(n)).classList.contains('far'), name), false, 'the selected city keeps its full tag');
  // The flat map's own layers took it all up: rings, beads, flags and tint at once, no refresh needed.
  let fd = await p.evaluate(() => window.__game.strategy.flatDebug());
  assert.deepEqual([fd.selected, fd.roadsOn, fd.candidates], [11, false, []]);
  assert.ok(fd.flowCount > 0 && fd.tintDraws > 0);
  assert.deepEqual(fd.flagColors, await p.evaluate(async () => { const { colorOf } = await import(new URL('src/strategy.js', location.href).href); return window.__game.g.cities.map((c) => colorOf(c.faction)); }));
  await p.locator('.terrbtn').click();
  assert.equal(await p.locator('.terrbtn').getAttribute('aria-pressed'), 'false');
  // Candidates cross over too.
  await p.evaluate(() => { window.__game.strategy.pickMode([3, 4], 5); window.__game.debug.quality.set('high'); });
  await kindIs(p, '3d');
  assert.equal(await p.evaluate(() => window.__game.strategy.territoryOn), false, 'off crosses to 3D too');
  await p.locator('.terrbtn').click();
  assert.equal(await p.evaluate(() => window.__game.strategy.territoryOn), true, 'the button also enables the 3D map');
  await p.waitForFunction(() => document.querySelectorAll('#stage .labels .ctag.cand').length === 2, null, { timeout: 5000 });
  await p.evaluate(() => { window.__game.strategy.roads(true); window.__game.debug.quality.set('low'); });
  await kindIs(p, 'flat');
  assert.equal(await p.evaluate(() => window.__game.strategy.territoryOn), true);
  fd = await p.evaluate(() => window.__game.strategy.flatDebug());
  assert.deepEqual([fd.roadsOn, fd.candidates], [true, [3, 4]], 'the overview and a pick in progress come across');
  await p.evaluate(() => { window.__game.strategy.pickMode(null); window.__game.strategy.roads(false); });
  await p.locator('.terrbtn').click();
  assert.equal(await p.evaluate(() => window.__game.strategy.territoryOn), false);
  assert.equal(await p.evaluate(() => document.querySelectorAll('.flatstrategy .ctag.cand').length), 0);

  // A command or a dialog open: the switch waits for it to finish.
  await p.waitForTimeout(600); // the fade back in holds commands too, and lets go when it ends
  await p.evaluate(() => { window.__game.debug.holdCommand(true); window.__game.debug.quality.set('high'); });
  await p.waitForTimeout(1000);
  r = await look(p);
  assert.deepEqual([r.kind, r.layer], ['flat', 'block'], 'held');
  await p.evaluate(() => window.__game.debug.holdCommand(false));
  await kindIs(p, '3d');
  assert.equal(await p.evaluate(() => document.querySelectorAll('.flatstrategy').length), 1, 'each map is built once');
  assert.equal(p.requests.filter((u) => /sandtable\/board\/board\.json/.test(u)).length, 1);
  await p.waitForTimeout(600);
  // A real dialog.
  await p.keyboard.press('r');
  await p.waitForSelector('.shade');
  await setQuality(p, 'low');
  await p.waitForTimeout(1000);
  assert.equal((await look(p)).kind, '3d', 'the 人物志 stays up over the map it opened on');
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => !document.querySelector('.shade'));
  await kindIs(p, 'flat');
  await p.waitForTimeout(600);
  // 欣赏模式: no dip to black under someone listening.
  await p.keyboard.press('v');
  await p.waitForFunction(() => document.body.classList.contains('scenic'));
  await setQuality(p, 'high');
  await p.waitForTimeout(1000);
  assert.equal((await look(p)).kind, 'flat', 'not in 欣赏模式');
  assert.equal(await p.evaluate(() => document.querySelector('#fade').classList.contains('on')), false);
  await p.keyboard.press('v');
  await kindIs(p, '3d');
  await p.waitForTimeout(600);
  // The map coming back with a map ready to go to: up at once, the screen being dark already. The flat map has let its pictures go under the 3D one, so that way the 3D map stays up until they are in.
  await p.evaluate(() => { const { debug, strategy } = window.__game; debug.show('tview'); debug.quality.set('low'); const before = strategy.kind; debug.show('strategy'); window.__cut = [before, strategy.kind]; });
  assert.deepEqual(await p.evaluate(() => window.__cut), ['3d', '3d']);
  await kindIs(p, 'flat');
  await p.waitForTimeout(600);
  await p.evaluate(() => { const { debug, strategy } = window.__game; debug.show('tview'); debug.quality.set('high'); const before = strategy.kind; debug.show('strategy'); window.__cut = [before, strategy.kind]; });
  assert.deepEqual(await p.evaluate(() => window.__cut), ['flat', '3d']);
  await p.waitForTimeout(600);
  await p.evaluate(() => window.__game.debug.quality.set('low'));
  await kindIs(p, 'flat');
  await p.waitForTimeout(600);
  assert.deepEqual(p.errors, []);
  // A switch that throws does not leave the screen black or the commands held.
  await p.evaluate(() => { const { post, quality } = window.__game.debug, real = post.setView; post.setView = () => { post.setView = real; throw new Error('test: setView'); }; quality.set('high'); });
  await kindIs(p, '3d');
  await p.waitForFunction(() => window.__game.qualityIdle(), null, { timeout: 5000 });
  for (let i = 0; i < 40 && !p.errors.length; i++) await p.waitForTimeout(50); // the page's error reaches node a moment after the page is idle
  assert.deepEqual(p.errors, ['test: setView']);
  assert.equal(await p.evaluate(() => document.querySelector('#fade').classList.contains('on')), false, 'the screen is not left black');
  await p.context().close();
});

test('a switch put off through the start of a player turn fires once he has control and nothing is on screen', async () => {
  const p = await openAt('high');
  await newCampaign(p, '董卓');
  await setQuality(p, 'low');
  await kindIs(p, 'flat');
  await p.waitForTimeout(600);
  // The player's turn comes next, on a new month with its tax: rotate() sets g.current, then the event plays, then playerTurn().
  await p.evaluate(async () => {
    const { g, G } = window.__game, D = await G.loadData(), fade = document.querySelector('#fade');
    g.turnIdx = D.rules.turn_orders[g.order].indexOf(g.player) - 1; g.monthDone = false; g.month = 3;
    const up = () => ({ vig: !!document.querySelector('.vig'), banner: !!document.querySelector('.banner'), msg: !!document.querySelector('.panel.msg'), shade: !!document.querySelector('.shade') });
    window.__turn = { vig: 0, banner: 0, at: null };
    const scan = () => { const u = up(); if (!window.__turn.at) { if (u.vig) window.__turn.vig++; if (u.banner) window.__turn.banner++; requestAnimationFrame(scan); } };
    requestAnimationFrame(scan);
    new MutationObserver(() => { if (fade.classList.contains('on') && !window.__turn.at) window.__turn.at = { ...up(), mine: g.current === g.player }; }).observe(fade, { attributes: true });
  });
  await p.getByRole('button', { name: '结束本月行动' }).click();
  await p.waitForSelector('.shade');
  await setQuality(p, 'high');
  await p.locator('.shade .btn.primary', { hasText: '确定' }).click();
  const stop = closeMessages(p);
  try { await kindIs(p, '3d'); } finally { stop(); }
  const t = await p.evaluate(() => window.__turn);
  assert.deepEqual(t.at, { vig: false, banner: false, msg: false, shade: false, mine: true });
  assert.ok(t.banner > 0, 'it waited through the turn banner');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('mid-play high to low builds the flat map at once, on the month in play, and keeps the 3D one', async () => {
  let release; const held = new Promise((r) => { release = r; });
  const p = await openAt('high', { '**/sandtable/flat/board.json': async (route) => { await held; await route.continue(); } });
  await newCampaign(p, '董卓');
  const name = await p.evaluate(() => window.__game.G.cityName(11));
  await p.evaluate(() => window.__game.strategy.setSeason(10, true));
  await p.locator('#stage .ctag', { hasText: name }).click({ force: true });
  const snow = await snowLine(p);
  await setQuality(p, 'low');
  await p.waitForTimeout(800);
  const up = await look(p);
  assert.deepEqual([up.kind, up.flatmap, up.layer, up.panel], ['3d', false, 'none', name], 'the 3D map stays up until the flat one is ready');
  assert.equal(await p.evaluate(() => document.querySelector('#fade').classList.contains('on')), false);
  release();
  await p.waitForFunction(() => document.body.classList.contains('flatmap') && getComputedStyle(document.querySelector('.flatstrategy')).display === 'block', null, { timeout: 30000 });
  await kindIs(p, 'flat');
  const r = await look(p);
  assert.deepEqual([r.flat, r.has3d, r.month, r.panel], [true, true, 10, name]);
  assert.equal(await snowLine(p), snow);
  assert.deepEqual(await p.evaluate(() => window.__game.strategy.flatDebug().layers), ['winter'], 'no other season\'s picture on the way');
  assert.equal(await p.evaluate(() => document.body.dataset.season), 's3');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('a change of 画质 in a war leaves the map as it is until the map comes back; a 退却 pick in between restores the war\'s HUD', async () => {
  const p = await openAt('low');
  await newCampaign(p, '曹操');
  await p.evaluate(() => {
    const { g, debug } = window.__game, c = g.cities[14], to = g.cities[12];
    for (const id of [...c.officers, ...to.officers]) g.officers[id].soldiers ||= 500;
    const ids = c.officers.slice(0, 4);
    debug.fieldWar(debug.setupWar(g, { from: 14, to: 12, ids, commander: ids[0], gold: 100, rice: 400 }), 'att');
  });
  await p.waitForFunction(() => window.__game.war?.finishDeploy && document.body.dataset.screen === 'war', null, { timeout: 30000 });
  const stop = closeMessages(p);
  try {
    await p.waitForTimeout(2500);
    await p.evaluate(() => window.__game.war.finishDeploy());
    await p.waitForFunction(() => { const f = window.__game.war.field; return f.turn === f.human && !document.querySelector('.banner, .panel.msg'); }, null, { timeout: 30000 });
  } finally { stop(); }
  await setQuality(p, 'medium');
  await p.waitForTimeout(600);
  let r = await look(p);
  assert.deepEqual([r.kind, r.has3d, r.flat2d, r.flatmap, r.layer], ['flat', false, true, false, 'none'], 'nothing changes in the war');
  assert.deepEqual(p.requests.filter((u) => SAND.test(u)), []);
  await p.evaluate(() => { const w = window.__game.war, f = w.field; w.cancel(); w.cancel(); const u = f.side(f.human).find((x) => !x.gone && !x.commander); w.clickCell(u.x, u.y); });
  await p.getByRole('button', { name: '退却', exact: true }).click();
  await p.waitForSelector('.mappick', { timeout: 15000 });
  await p.waitForTimeout(600);
  r = await look(p);
  assert.deepEqual([r.kind, r.has3d, r.flat2d, r.flatmap, r.layer], ['flat', false, false, true, 'block'], 'the 退却 map is not the map coming back');
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => !document.querySelector('.mappick') && !window.__game.war.st.busy && !document.querySelector('#fade.on'));
  r = await look(p);
  assert.deepEqual([r.flat2d, r.flatmap, r.layer], [true, false, 'none'], 'the war\'s HUD is back');
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('.flatwar')).display), 'block');
  // The war over, the map comes back: the flat one first, the 3D one when it is in.
  const stop2 = closeMessages(p);
  try {
    await p.evaluate(() => { const w = window.__game.war, f = w.field; f.end(f.human === 'att' ? 'def' : 'att', 'test'); w.endTurn(); });
    await p.getByRole('button', { name: '返回大地图' }).click({ timeout: 30000 });
    await p.waitForFunction(() => document.body.dataset.screen === 'strategy', null, { timeout: 30000 });
  } finally { stop2(); }
  r = await look(p);
  assert.deepEqual([r.kind, r.flat2d, r.flatmap, r.layer], ['flat', false, true, 'block']);
  await kindIs(p, '3d');
  assert.equal((await look(p)).layer, 'none');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

// ---- A map first up mid-game, a 3D build held off a battle, and the flat map's memory under the 3D map.
const view3d = (p) => p.evaluate(() => { const s = window.__game.strategy, v = s.debugView(), f = s.focusPoint(); return { ...v, focus: [f.x, f.y * 0.5, f.z + 1] }; });
// What the 3D map's view is at the moment the fade starts to lift off it.
const watchFade = (p) => p.evaluate(() => {
  const fade = document.querySelector('#fade'), s = window.__game.strategy;
  window.__lifted = null; let was = false;
  new MutationObserver(() => {
    const on = fade.classList.contains('on');
    if (was && !on && s.kind === '3d' && !window.__lifted) window.__lifted = s.debugView();
    was = on;
  }).observe(fade, { attributes: true });
});

test('a 3D map first up mid-game is already at the usual distance on the selected city when the fade lifts; a kept one keeps its view', async () => {
  const p = await openAt('low');
  try {
    await newCampaign(p, '董卓');
    const name = await p.evaluate(() => window.__game.G.cityName(11));
    await p.locator('.flatstrategy .ctag', { hasText: name }).click({ force: true });
    await watchFade(p);
    await setQuality(p, 'high');
    await kindIs(p, '3d');
    const lifted = await p.evaluate(() => window.__lifted), v = await view3d(p);
    assert.ok(Math.abs(lifted.dist - 24) < 1e-6, `at the fade's lift: ${lifted.dist}`);
    assert.ok(Math.abs(lifted.yaw - 0.12) < 1e-6, `at the fade's lift: ${lifted.yaw}`);
    assert.ok(Math.hypot(...lifted.target.map((a, i) => a - v.focus[i])) < 1e-6, `on the selected city at the lift: ${JSON.stringify([lifted.target, v.focus])}`);
    // His own view on the map: 高 → 低 → 高 hands it back.
    await p.waitForTimeout(600);
    await p.evaluate(() => { const s = window.__game.strategy; s.zoom(500); s.orbit(120, 0); });
    await p.waitForTimeout(1500);
    const mine = await view3d(p);
    assert.ok(Math.abs(mine.dist - 24) > 3, `he zoomed: ${mine.dist}`);
    await setQuality(p, 'low'); await kindIs(p, 'flat'); await p.waitForTimeout(600);
    await setQuality(p, 'high'); await kindIs(p, '3d');
    const back = await view3d(p);
    assert.ok(Math.abs(back.dist - mine.dist) < 0.01, `kept: ${back.dist} against ${mine.dist}`);
    assert.ok(Math.abs(back.yaw - mine.yaw) < 0.01, `kept: ${back.yaw} against ${mine.yaw}`);
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); }
});

test('a 3D map booted under the title but first played on after a switch to low opens as if first up, not at the title\'s distance', async () => {
  const p = await openAt('high');
  try {
    await setQuality(p, 'low');
    await kindIs(p, 'flat');
    await newCampaign(p, '董卓');
    await setQuality(p, 'high');
    await kindIs(p, '3d');
    assert.ok(Math.abs((await view3d(p)).dist - 24) < 1e-6, 'the usual distance');
  } finally { await p.context().close(); }
});

test('a 3D map asked for before a war is built after it: the download comes in during the war, the build waits for the map, the swap follows', async () => {
  let release; const held = new Promise((r) => { release = r; }), sand = [];
  const p = await openAt('low', { '**/sandtable/board/albedo.webp': async (route) => { await held; await route.continue(); } });
  p.on('requestfinished', (r) => { if (SAND.test(r.url())) sand.push(r.url()); });
  try {
    await newCampaign(p, '曹操');
    await setQuality(p, 'high');
    await p.evaluate(() => {
      const { g, debug, strategy } = window.__game, c = g.cities[14], to = g.cities[12];
      window.__build = { inWar: 0, up: null };
      const scan = () => {
        const screen = document.body.dataset.screen;
        if (strategy.has3d && screen === 'war') window.__build.inWar++;
        if (strategy.has3d && !window.__build.up) window.__build.up = { screen, kind: strategy.kind };
        requestAnimationFrame(scan);
      };
      requestAnimationFrame(scan);
      for (const id of [...c.officers, ...to.officers]) g.officers[id].soldiers ||= 500;
      const ids = c.officers.slice(0, 4);
      debug.fieldWar(debug.setupWar(g, { from: 14, to: 12, ids, commander: ids[0], gold: 100, rice: 400 }), 'att');
    });
    await p.waitForFunction(() => window.__game.war?.finishDeploy && document.body.dataset.screen === 'war', null, { timeout: 30000 });
    const stop = closeMessages(p);
    try {
      await p.waitForTimeout(2500);
      await p.evaluate(() => window.__game.war.finishDeploy());
      await p.waitForFunction(() => { const f = window.__game.war.field; return f.turn === f.human && !document.querySelector('.banner, .panel.msg'); }, null, { timeout: 30000 });
    } finally { stop(); }
    release();
    for (let i = 0; i < 100 && !sand.some((u) => /albedo/.test(u)); i++) await p.waitForTimeout(100);
    assert.ok(sand.some((u) => /albedo/.test(u)), 'the download came in during the war');
    await p.waitForTimeout(4000); // the models and textures after it, and long enough for a build
    assert.equal(await p.evaluate(() => window.__game.strategy.has3d), false, 'not built while the war is on screen');
    assert.equal((await look(p)).kind, 'flat');
    const stop2 = closeMessages(p);
    try {
      await p.evaluate(() => { const w = window.__game.war, f = w.field; f.end(f.human === 'att' ? 'def' : 'att', 'test'); w.endTurn(); });
      await p.getByRole('button', { name: '返回大地图' }).click({ timeout: 30000 });
      await p.waitForFunction(() => document.body.dataset.screen === 'strategy', null, { timeout: 30000 });
      await kindIs(p, '3d');
    } finally { stop2(); }
    const b = await p.evaluate(() => window.__build);
    assert.equal(b.inWar, 0, 'never built in the war');
    assert.deepEqual(b.up, { screen: 'strategy', kind: 'flat' }, 'built after the return, before the swap');
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); }
});

test('under the 3D map the flat map holds no canvases or pictures and does nothing on a resize; it comes back on the right season, whole', async () => {
  const p = await openAt('low');
  const flat = () => p.evaluate(() => { const d = window.__game.strategy.debugMap('flat').flatDebug(); return { sizes: d.sizes, held: d.held, layers: d.layers, underPaints: d.underPaints }; });
  try {
    await newCampaign(p, '董卓');
    const name = await p.evaluate(() => window.__game.G.cityName(11));
    await p.locator('.flatstrategy .ctag', { hasText: name }).click({ force: true });
    await p.evaluate(() => { const s = window.__game.strategy, { g } = window.__game; g.month = 7; s.refresh(g); s.setSeason(7, true); });
    await p.waitForFunction(() => window.__game.strategy.flatDebug().layers.at(-1) === 'autumn', null, { timeout: 15000 });
    await setQuality(p, 'high');
    await kindIs(p, '3d');
    const NONE = { cv: [0, 0], under: [0, 0], sky: [0, 0] };
    let f = await flat();
    assert.deepEqual([f.sizes, f.held, f.layers], [NONE, [], []], 'all let go');
    const paints = f.underPaints;
    await p.setViewportSize({ width: 1024, height: 600 });
    await p.waitForTimeout(400);
    f = await flat();
    assert.deepEqual([f.sizes, f.underPaints], [NONE, paints], 'a resize while hidden does nothing costly');
    // A new month while it is away; the 3D map stays up until the picture is in.
    await p.evaluate(() => { const s = window.__game.strategy, { g } = window.__game; g.month = 10; s.refresh(g); s.setSeason(10, true); });
    await p.evaluate(() => {
      const s = window.__game.strategy; window.__swap = null;
      const scan = () => { if (s.kind === 'flat') window.__swap = s.flatDebug().layers; else requestAnimationFrame(scan); };
      requestAnimationFrame(scan);
    });
    await setQuality(p, 'low');
    await kindIs(p, 'flat');
    assert.deepEqual(await p.evaluate(() => window.__swap), ['winter'], 'its picture was up before the swap');
    f = await flat();
    assert.deepEqual(f.sizes.cv, await p.evaluate(() => [innerWidth, innerHeight].map((v) => v * Math.min(2, devicePixelRatio))), 'the size of the window as it now is');
    assert.deepEqual(f.layers, ['winter']);
    await p.waitForTimeout(400);
    assert.equal(await p.evaluate(() => document.querySelector('.flatstrategy canvas').style.width), '1024px');
    assert.ok(await underAgainst(p, 'winter') < await underAgainst(p, 'summer') * 0.8, 'winter\'s picture is what is painted');
    const d = await p.evaluate(() => { const d = window.__game.strategy.flatDebug(); return { selected: d.selected, flow: d.flowCount, flags: d.flagColors, tags: document.querySelectorAll('.flatstrategy .ctag').length, shown: getComputedStyle(document.querySelector('.flatstrategy')).display }; });
    assert.deepEqual([d.selected, d.tags, d.shown], [11, 30, 'block']);
    assert.ok(d.flow > 0);
    assert.deepEqual(d.flags, await p.evaluate(async () => { const { colorOf } = await import(new URL('src/strategy.js', location.href).href); return window.__game.g.cities.map((c) => colorOf(c.faction)); }));
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); }
});

test('changing his mind while the flat map\'s pictures come back lets them go again: nothing left held under the 3D map', async () => {
  const p = await openAt('low');
  try {
    await newCampaign(p, '董卓');
    await setQuality(p, 'high');
    await kindIs(p, '3d');
    await p.waitForTimeout(600);
    let release; const hold = new Promise((r) => { release = r; });
    await p.context().route('**/sandtable/flat/*.webp', async (route) => { await hold; await route.continue(); });
    await setQuality(p, 'low');
    await p.waitForTimeout(300);
    assert.equal((await look(p)).kind, '3d', 'held up until its picture is in');
    await setQuality(p, 'high');
    release();
    await p.waitForTimeout(1500);
    const d = await p.evaluate(() => window.__game.strategy.debugMap('flat').flatDebug());
    assert.deepEqual([d.sizes.cv, d.sizes.under, d.held, d.layers], [[0, 0], [0, 0], [], []]);
    assert.equal((await look(p)).kind, '3d');
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); }
});

test('a flat map whose pictures will not come back leaves the 3D map up, with the notice, and no blank frame', async () => {
  const p = await openAt('low');
  try {
    await newCampaign(p, '董卓');
    await setQuality(p, 'high');
    await kindIs(p, '3d');
    await p.waitForTimeout(600);
    await p.context().route('**/sandtable/flat/*.webp', (route) => route.abort());
    await setQuality(p, 'low');
    await p.waitForFunction(() => /平面地图加载失败/.test(document.querySelector('body > .toast')?.textContent ?? ''), null, { timeout: 15000 });
    await p.waitForTimeout(600);
    assert.equal((await look(p)).kind, '3d');
    assert.equal(await p.evaluate(() => document.querySelector('#fade').classList.contains('on')), false);
    const d = await p.evaluate(() => window.__game.strategy.debugMap('flat').flatDebug());
    assert.deepEqual([d.sizes.cv, d.held], [[0, 0], []]);
  } finally { await p.context().close(); }
});
