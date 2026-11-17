// Strategy map pace: each AI faction's turn stays on screen as long as the original's 90 frames, and the
// 游戏速度 menu item cycles and is remembered. Plus a static guard that the rules never read the pace.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { startGame, newCampaign, closeMessages, near, cmd } from './game.mjs';

let game, page;
before(async () => { game = await startGame({ scenario: 'original' }); page = await game.open(); await newCampaign(page); });
after(() => game?.close());

test('the rules core never imports presentation code', () => {
  const dir = new URL('../src/core/', import.meta.url);
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    assert.doesNotMatch(src, /from '\.\.\/(pace|ui|app|vignette|warview|war\/\w+|tacticalhud|tacticalview|strategyview)\.js'/, f);
  }
});

test('territory starts off, stays unpainted on refresh, and the button toggles it', async () => {
  const button = page.locator('.terrbtn');
  assert.equal(await button.getAttribute('title'), '势力范围：按归属给地面着色');
  assert.equal(await button.getAttribute('aria-pressed'), 'false');
  const before = await page.evaluate(() => {
    const { g, strategy: s } = window.__game, ground = s.scene.children.find((o) => o.geometry?.attributes?.territory);
    const attr = ground.geometry.attributes.territory, version = attr.version, old = g.cities[1].faction;
    g.cities[1].faction = (old + 1) % 7; s.refresh(g); g.cities[1].faction = old; s.refresh(g);
    return { on: s.territoryOn, version, after: attr.version };
  });
  assert.deepEqual(before, { on: false, version: 0, after: 0 }, 'off does not build or upload the ownership grid');
  const pixels = await page.evaluate(() => {
    const { g, G, strategy: s, debug } = window.__game, scene = s.scene, ground = scene.children.find((o) => o.geometry?.attributes?.territory);
    const visible = scene.children.map((o) => o.visible), bg = scene.background, r = debug.renderer, target = r.getRenderTarget(), gl = r.getContext();
    // Render only the ground in one synchronous turn: animation, flags and weather cannot change the comparison.
    const take = () => { s.update(0); scene.children.forEach((o) => { o.visible = o === ground; }); r.render(scene, s.camera); const a = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4); gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, a); return a; };
    try {
      scene.children.forEach((o) => { o.visible = o === ground; }); scene.background = null; r.setRenderTarget(null);
      const off = take(); s.territory(true); const on = take();
      s.refresh({ ...g, cities: g.cities.map((c) => ({ ...c, faction: G.NONE })) }); const natural = take();
      s.refresh(g); s.territory(false); const offAgain = take();
      let changed = 0, mismatch = 0, naturalMismatch = 0;
      for (let i = 0; i < off.length; i += 4) {
        if (off[i] !== on[i] || off[i + 1] !== on[i + 1] || off[i + 2] !== on[i + 2]) changed++;
        if (off[i] !== offAgain[i] || off[i + 1] !== offAgain[i + 1] || off[i + 2] !== offAgain[i + 2]) mismatch++;
        if (off[i] !== natural[i] || off[i + 1] !== natural[i + 1] || off[i + 2] !== natural[i + 2]) naturalMismatch++;
      }
      return { changed, mismatch, naturalMismatch, on: s.territoryOn };
    } finally { r.setRenderTarget(target); scene.children.forEach((o, i) => { o.visible = visible[i]; }); scene.background = bg; s.territory(false); s.refresh(g); }
  });
  assert.ok(pixels.changed > 100, 'the enabled ownership fill and borders affect the ground');
  assert.equal(pixels.naturalMismatch, 0, 'default owned ground matches an untinted board without borders');
  assert.equal(pixels.mismatch, 0, 'off restores every ground pixel, including ownership borders');
  assert.equal(pixels.on, false);
  await button.click();
  assert.equal(await button.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => window.__game.strategy.territoryOn), true);
  await button.click();
  assert.equal(await button.getAttribute('aria-pressed'), 'false');
  const deferred = await page.evaluate(() => {
    const { g, strategy: s } = window.__game, attr = s.scene.children.find((o) => o.geometry?.attributes?.territory).geometry.attributes.territory;
    const old = g.cities[1].faction, before = attr.version;
    try {
      g.cities[1].faction = (old + 1) % 7; s.refresh(g); const off = attr.version;
      s.territory(true); return { before, off, on: attr.version };
    } finally { g.cities[1].faction = old; s.refresh(g); s.territory(false); }
  });
  assert.equal(deferred.off, deferred.before, 'changes while off do not rebuild the field');
  assert.ok(deferred.on > deferred.off, 'enabling applies ownership changes made while off');
});

test('territory updates only for owner changes and borders only different owners', async () => {
  const result = await page.evaluate(() => {
    const { g, G, strategy: s } = window.__game, ground = s.scene.children.find((o) => o.geometry?.attributes?.territory);
    if (!ground) return { found: false };
    const tint = ground.geometry.attributes.territory, border = ground.geometry.attributes.territoryBorder, distance = ground.geometry.attributes.territoryDistance, pos = ground.geometry.attributes.position;
    if (!distance) return { found: false };
    const old = g.cities.map((c) => c.faction), player = g.player, rival = (player + 1) % 7;
    s.territory(true);
    try {
      for (const c of g.cities) c.faction = player;
      s.refresh(g); const version = tint.version; s.refresh(g);
      const bits = [border.getX(0), border.getY(0), border.getZ(0)];
      let seaTinted = 0, landUntinted = 0, sameBorders = 0;
      for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) < 0.1399 && tint.getW(i) > 0) seaTinted++;
        if (pos.getY(i) > 0.1401 && tint.getW(i) < 1) landUntinted++;
        if (Math.sign(border.getX(i)) !== Math.sign(bits[0]) || Math.sign(border.getY(i)) !== Math.sign(bits[1]) || Math.sign(border.getZ(i)) !== Math.sign(bits[2])) sameBorders++;
      }
      const cached = tint.version === version, noInternalGlow = Array.from({ length: distance.count }, (_, i) => distance.getX(i)).every((d) => d > 4);
      g.player = rival; s.refresh(g); const playerChanged = tint.version > version; g.player = player; s.refresh(g);
      g.cities[1].faction = rival; s.refresh(g);
      let rivalBorders = 0, playerBorders = 0, nearBorder = 0;
      for (let i = 0; i < border.count; i++) {
        if (Math.sign(border.getX(i)) !== Math.sign(bits[0]) || Math.sign(border.getY(i)) !== Math.sign(bits[1]) || Math.sign(border.getZ(i)) !== Math.sign(bits[2])) rivalBorders++;
        if (border.getW(i) > .99) playerBorders++;
        if (distance.getX(i) < .2) nearBorder++;
      }
      g.cities[1].faction = G.NONE; s.refresh(g);
      let unownedLand = 0, unownedEdge = 0, neutralBorders = 0;
      for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) > 0.1401 && tint.getW(i) === 0) { unownedLand++; if (distance.getX(i) < .2) unownedEdge++; }
        if (border.getX(i) > 0 && border.getY(i) > 0 && border.getZ(i) > 0) neutralBorders++;
      }
      return { found: true, cached, noInternalGlow, playerChanged, seaTinted, landUntinted, sameBorders, rivalBorders, playerBorders, nearBorder, unownedLand, unownedEdge, neutralBorders };
    } finally { g.player = player; g.cities.forEach((c, i) => { c.faction = old[i]; }); s.refresh(g); s.territory(false); }
  });
  assert.equal(result.found, true, 'the sand board has territory attributes');
  assert.equal(result.cached, true, 'unchanged owners do not upload the vertex attributes again');
  assert.equal(result.noInternalGlow, true, 'one owner cannot produce a border glow');
  assert.equal(result.playerChanged, true, 'a new player updates the highlighted border');
  assert.deepEqual([result.seaTinted, result.landUntinted, result.sameBorders], [0, 0, 0]);
  assert.ok(result.rivalBorders && result.playerBorders && result.nearBorder, 'different owners meet at a player border');
  assert.ok(result.unownedLand && result.unownedEdge && result.neutralBorders, 'unowned land stays untinted up to its frontier');
});

test('selection, hover and candidate marks keep a dim depth-occluded copy', async () => {
  const result = await page.evaluate(() => {
    const s = window.__game.strategy, count = () => { const found = []; s.scene.traverse((o) => { if (o.userData?.strategyGhost) found.push(o); }); return found; };
    s.select(11); s.highlight(11); s.pickMode([11, 12], 11); s.update(.05);
    const ghosts = count(), active = ghosts.filter((o) => o.visible && o.parent?.visible !== false);
    const ok = active.every((o) => o.material.depthFunc === 6 && !o.material.depthWrite && o.material.transparent);
    const beads = active.filter((o) => o.isInstancedMesh && o.count > 0).length;
    s.select(null); s.highlight(null); s.pickMode(null);
    const beadLeft = count().some((o) => o.isInstancedMesh);
    const { g } = window.__game; s.select(g.factions[g.player].city);
    return { ok, beads, active: active.length, beadLeft };
  });
  assert.ok(result.ok && result.active >= 5, 'each visible ring has an occluded copy');
  assert.equal(result.beads, 1, 'one instanced draw covers the selected road beads');
  assert.equal(result.beadLeft, false, 'clearing selection removes the bead copy');
});

test('tree LODs drop only isolated instances and keep the shared near footprint', async () => {
  const r = await page.evaluate(async () => {
    const { TREE_ISOLATED_RADIUS, TREE_ISOLATED_MAX_NEIGHBORS } = await import(new URL('src/sandtable.js', location.href).href);
    const meta = await (await fetch('assets/ai/sandtable/board/board.json')).json(), points = [];
    for (const kind of ['tree-broad', 'tree-pine', 'grove']) { const a = meta.pieces[kind] ?? []; for (let i = 0; i < a.length; i += 6) points.push([a[i], a[i + 2]]); }
    const bins = new Map(), cell = (x, z) => `${x},${z}`;
    for (const p of points) { const key = cell(Math.floor(p[0] / TREE_ISOLATED_RADIUS), Math.floor(p[1] / TREE_ISOLATED_RADIUS)); if (!bins.has(key)) bins.set(key, []); bins.get(key).push(p); }
    const density = (x, z) => { let n = 0; const bx = Math.floor(x / TREE_ISOLATED_RADIUS), bz = Math.floor(z / TREE_ISOLATED_RADIUS);
      for (let i = bx - 1; i <= bx + 1; i++) for (let j = bz - 1; j <= bz + 1; j++) for (const p of bins.get(cell(i, j)) ?? []) {
        const d = (p[0] - x) ** 2 + (p[1] - z) ** 2; if (d > 1e-8 && d <= TREE_ISOLATED_RADIUS ** 2 && ++n > TREE_ISOLATED_MAX_NEIGHBORS) return n;
      } return n;
    };
    const meshes = window.__game.strategy.scene.children.filter((o) => o.isInstancedMesh && o.userData?.sandKind && o.userData?.sandLod);
    const trees = meshes.filter((o) => ['tree-broad', 'tree-pine', 'grove'].includes(o.userData.sandKind));
    let pairs = 0, bad = 0, reduced = 0, droppedInStands = 0, shrunken = 0;
    for (const far of trees.filter((o) => o.userData.sandLod === 'far')) {
      const near = trees.find((o) => o.userData.sandLod === 'near' && o.instanceMatrix === far.instanceMatrix);
      if (!near || far.count > near.count || far.instanceColor !== near.instanceColor) bad++;
      else {
        pairs++; if (far.count < near.count) reduced++;
        for (let i = far.count; i < near.count; i++) { const a = near.instanceMatrix.array; if (near.userData.sandKind === 'grove' || density(a[i * 16 + 12], a[i * 16 + 14]) > TREE_ISOLATED_MAX_NEIGHBORS) droppedInStands++; }
        near.geometry.computeBoundingBox(); far.geometry.computeBoundingBox(); const a = near.geometry.boundingBox, b = far.geometry.boundingBox;
        if (b.max.x - b.min.x + 1e-6 < a.max.x - a.min.x || b.max.z - b.min.z + 1e-6 < a.max.z - a.min.z) shrunken++;
      }
    }
    return { pairs, bad, reduced, isolated: points.filter(([x, z]) => density(x, z) <= TREE_ISOLATED_MAX_NEIGHBORS).length, droppedInStands, shrunken };
  });
  assert.ok(r.pairs > 0, 'the tree LODs exist');
  assert.equal(r.reduced > 0, r.isolated > 0, 'only isolated trees are removed; a board with no isolated trees needs no reduction');
  assert.equal(r.bad, 0, 'both LODs share the same sorted transforms and colours');
  assert.deepEqual([r.droppedInStands, r.shrunken], [0, 0], 'stands stay covered and far crowns do not shrink');
});

test('the 游戏速度 item cycles 原版 → 快速 → 最快 and is stored', async () => {
  await page.click('.sysmenu-btn');
  const item = page.locator('.sysmenu-list >> text=/游戏速度/'), seen = [];
  for (let i = 0; i < 4; i++) { seen.push((await item.textContent()).trim()); if (i < 3) await item.click(); }
  assert.deepEqual(seen, ['游戏速度 原版', '游戏速度 快速', '游戏速度 最快', '游戏速度 原版']);
  assert.equal(await page.evaluate(() => localStorage.getItem('hd2d-pace')), '1');
  await page.click('.sysmenu-btn');
});

// The 武器屋 asks for whom with each one's weapon and armour in the list (feedback R08, 2026-11-02).
test('the 武器屋 list shows each officer\'s weapon and armour', async () => {
  const want = await page.evaluate(() => {
    const { g, G } = window.__game, home = g.factions[g.player].city;
    G.data().cities[home].facilities.weapons = true; window.__game.strategy.refresh(g);
    const id = g.cities[home].officers[0], o = g.officers[id], eq = G.data().equipment;
    return { city: G.cityName(home), name: G.name(id), weapon: eq[o.weapon]?.name ?? '—', armor: eq[24 + o.armor]?.name ?? '—' };
  });
  await page.evaluate((n) => [...document.querySelectorAll('.ctag')].find((e) => e.textContent.includes(n)).click(), want.city);
  await cmd(page, '町', '武器屋');
  await page.waitForSelector('.modal .otable');
  const t = await page.evaluate((nm) => {
    const heads = [...document.querySelectorAll('.modal .otable th')].map((e) => e.textContent);
    const row = [...document.querySelectorAll('.modal .otable tbody tr')].find((r) => r.querySelector('td.nm').textContent.includes(nm));
    return { heads, cells: [...row.querySelectorAll('td')].map((e) => e.textContent) };
  }, want.name);
  assert.ok(t.heads.includes('武器') && t.heads.includes('防具'), `columns ${t.heads}`);
  assert.ok(t.cells.some((c) => c.startsWith(want.weapon)), `${want.name}'s ${want.weapon} in his row ${t.cells}`);
  assert.ok(t.cells.some((c) => c.startsWith(want.armor)), `${want.name}'s ${want.armor} in his row ${t.cells}`);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.shade', { state: 'detached' });
});

// The help tells the keys it used to leave out (feedback R11, 2026-11-02): on its 操作 page (src/controls.js), 键鼠, across
// the scene tabs, each key cap beside what it does.
test('the 说明 tells the menu number keys, T, Alt, Esc and the 资料', async () => {
  await page.click('.sysmenu-btn'); await page.locator('.sysmenu-list button', { hasText: '说明' }).click();
  assert.equal(await page.locator('.ctl-kind .on').textContent(), '键鼠', 'the keys first, with no pad in use');
  const rows = [];
  for (const tab of ['通用', '战略', '战场', '白兵·单挑']) {
    await page.locator('.ctl-tabs button', { hasText: tab }).click();
    rows.push(...await page.$$eval('.ctl-key, .ctl-call', (els) => els.map((e) => e.textContent)));
  }
  for (const [k, what] of [['1–5', '命令分组'], ['T', '看地形'], ['Alt', '精确'], ['Esc', '取消'], ['8', '资料']]) {
    assert.ok(rows.some((r) => r.startsWith(k) && r.includes(what)), `${k}: ${what}`);
  }
  assert.ok(rows.some((r) => r.startsWith('右键') && r.includes('放开武将')), 'the right button steps back on the war map');
  assert.ok(await page.locator('.ctl-fig img').evaluate((img) => img.complete && img.naturalWidth > 0), 'the mouse picture loads');
  await page.locator('.ctl-kind button', { hasText: '手柄' }).click();
  assert.equal(await page.locator('.ctl-on').count() > 4, true, 'the pad picture has its buttons marked');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.shade', { state: 'detached' });
});

for (const speed of [1, 4]) {
  test(`an AI faction's turn holds 「××军　战略中」 1.5 s ÷ ${speed} at ${speed}×`, async () => {
    const stop = closeMessages(page);
    let r;
    try {
      r = await page.evaluate(async (speed) => {
        const P = await import('./src/pace.js'); P.setPace(speed);
        const g = window.__game.g, f = g.factions.findIndex((x, i) => i !== g.player && x && !x.dead && g.cities.some((c) => c.faction === i));
        let seen = false; const watch = setInterval(() => { seen ||= !!document.querySelector('.aiturn b')?.textContent.includes('战略中'); }, 20);
        // events the turn shows (an AI war, a disaster) play on top of the 90 frames, so their time is taken off
        const io = window.__game.io, ev = io.event; let shown = 0;
        io.event = async function (...a) { const t = performance.now(); try { return await ev.apply(this, a); } finally { shown += performance.now() - t; } };
        const t = performance.now(); try { await io.aiTurn(f); } finally { io.event = ev; }
        const ms = performance.now() - t - shown;
        clearInterval(watch); P.setPace(1);
        return { ms, seen };
      }, speed);
    } finally { stop(); }
    assert.ok(r.seen, 'the plaque was shown');
    assert.ok(near(r.ms, 1500 / speed, 0.3), `turn took ${Math.round(r.ms)} ms`);
    await page.waitForFunction(() => !document.querySelector('.aiturn'), null, { timeout: 2000 });
  });
}

// A screen point over a city: the map's own pick, scanned over the canvas.
const cityPoint = () => page.evaluate(() => {
  const s = window.__game.strategy;
  for (let y = 0.3; y < 0.8; y += 0.02) for (let x = 0.25; x < 0.75; x += 0.02) {
    const c = s.hover({ x: x * 2 - 1, y: 1 - y * 2 }); if (c) { s.hover({ x: 9, y: 9 }); return { x: x * innerWidth, y: y * innerHeight }; }
  }
  return null;
});
const tipShown = () => page.evaluate(() => !document.querySelector('#tip').hidden);

// The city tip sits above the dialog layer, so a dialog that opens while it shows takes it away, however it is
// opened, and the map does not bring it back under the dialog (feedback T03, 2026-10-30).
for (const how of ['the R key', 'the 人物志 button']) {
  test(`opening 人物志 by ${how} over a city's tip hides the tip`, async () => {
    const at = await cityPoint();
    assert.ok(at, 'a city on screen');
    await page.mouse.move(at.x, at.y); await page.mouse.move(at.x + 1, at.y);
    await page.waitForFunction(() => !document.querySelector('#tip').hidden);
    if (how === 'the R key') await page.keyboard.press('r'); else await page.evaluate(() => document.querySelector('.wikibtn').click());
    await page.waitForSelector('.shade .wiki');
    assert.equal(await tipShown(), false, 'tip hidden with the dialog open');
    await page.evaluate(({ x, y }) => document.querySelector('canvas').dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true })), at);
    await page.waitForTimeout(100);
    assert.equal(await tipShown(), false, 'a move over the map under the dialog does not bring it back');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.shade'));
    await page.mouse.move(at.x, at.y); await page.mouse.move(at.x + 1, at.y);
    await page.waitForFunction(() => !document.querySelector('#tip').hidden);
    await page.mouse.move(5, 5);
  });
}

// A tag stepped up out of a neighbour's way holds still under the pointer (2026-11-01: 徐州, 青州 and their
// neighbours traded the hover dozens of times a second, each pointed-at tag jumping back down to its own city).
test('pointing at a stepped-up city tag lights it and nothing moves', async () => {
  let tag = null;
  await page.setViewportSize({ width: 960, height: 600 }); // cities are small enough now that tags only crowd on a small window
  for (const [zoom, focus] of [[1530, 15], [1530, 14], [1130, 15], [1130, 10], [670, 15], [670, 14], [330, 15], [330, 10]]) { // pulled back past the default (24), to where tags crowd
    await page.mouse.move(5, 5);
    await page.evaluate(([z, f]) => { const s = window.__game.strategy; s.resetView(); s.focusCity(f); s.zoom(z); }, [zoom, focus]);
    await page.waitForTimeout(2200);
    tag = await page.evaluate(() => {
      const hud = [...document.querySelectorAll('.panel, .hud, .rightcol, .dock')].map((el) => el.getBoundingClientRect());
      for (const el of document.querySelectorAll('.ctag')) {
        const r = el.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
        if (Math.abs(parseFloat(el.style.getPropertyValue('--dy')) || 0) < 4 || x < 20 || y < 80 || x > innerWidth - 20 || y > innerHeight - 20) continue;
        if (!el.contains(document.elementFromPoint(x, y)) || hud.some((h) => x > h.left && x < h.right && y > h.top && y < h.bottom)) continue;
        return { name: el.firstChild.textContent, x, y };
      }
      return null;
    });
    if (tag) break;
  }
  assert.ok(tag, 'a stepped-up tag on screen');
  await page.mouse.move(tag.x, tag.y, { steps: 4 });
  const seen = await page.evaluate(() => new Promise((done) => {
    const seq = [], t0 = performance.now();
    const f = () => { const cur = document.querySelector('.ctag.hov')?.firstChild.textContent ?? null; if (seq.at(-1) !== cur) seq.push(cur); if (performance.now() - t0 < 1200) requestAnimationFrame(f); else done(seq); };
    requestAnimationFrame(f);
  }));
  assert.deepEqual(seen, [tag.name]);
  await page.mouse.move(5, 5);
  await page.evaluate(() => window.__game.strategy.resetView());
  await page.setViewportSize({ width: 1280, height: 800 });
});

// ☰ 系统 → 读取记录 loads a record in the middle of a campaign (feedback T05, 2026-10-30): the page starts over
// (?mute kept) and opens that record on the strategy map. Run before the war test, which leaves the page in a war.
test('读取记录 from the system menu opens a record mid-campaign', async () => {
  const home = await page.evaluate(() => {
    const { g, G } = window.__game, c = g.cities[g.factions[g.player].city];
    const gold = c.gold; c.gold = 4321; G.save(g, 7); c.gold = gold;
    return c.id;
  });
  await page.click('.sysmenu-btn');
  await page.locator('.sysmenu-list button', { hasText: '读取记录' }).click();
  await page.locator('.shade .slot', { hasText: '记录七' }).click();
  await Promise.all([page.waitForEvent('load', { timeout: 30000 }), page.locator('.shade .btn.primary', { hasText: '确定' }).click()]);
  await page.waitForFunction(() => window.__game?.g && document.body.dataset.screen === 'strategy', null, { timeout: 60000 });
  const r = await page.evaluate((home) => ({ gold: window.__game.g.cities[home].gold, slot: window.__game.g.slot, url: location.search }), home);
  assert.equal(r.gold, 4321, 'the record\'s state, not the game that was running');
  assert.equal(r.slot, null, 'a loaded snapshot must confirm before overwriting an occupied record slot');
  assert.match(r.url, /mute/);
  await page.evaluate(() => localStorage.removeItem('haou-hd2d-save:7'));
  const stop = closeMessages(page);
  try { await page.waitForFunction(() => { const g = window.__game.g; return g.current === g.player && !document.querySelector('.aiturn, .panel.msg'); }, null, { timeout: 90000 }); } finally { stop(); }
});

// The bug from the 2026-10-29 playtest: one faction's plaque was still fading out (200 ms) when the next one
// attacked the player at once, and the war screen took away the fading plaque instead of the attacker's, which
// then stayed over the 白兵 orders. Run last: it leaves the page on the war screen.
test('when an AI faction attacks the player right after another\'s turn, no 战略中 stays over the war', async () => {
  const stop = closeMessages(page);
  let left;
  try {
    left = await page.evaluate(async () => {
      const { g, G, io, debug } = window.__game, P = g.player, home = g.factions[P].city;
      const ais = g.factions.map((x, i) => i).filter((i) => i !== P && g.factions[i] && !g.factions[i].dead && g.cities.some((c) => c.faction === i));
      const by = G.roads(home).map((c) => g.cities[c]).find((c) => ais.includes(c.faction) && c.officers.length);
      const fB = by ? by.faction : ais[0], fA = ais.find((i) => i !== fB);
      const from = by ? by.id : g.cities.find((c) => c.faction === fB).id;
      for (const id of g.cities[from].officers) g.officers[id].soldiers ||= 500;
      for (const id of g.cities[home].officers) g.officers[id].soldiers ||= 500;
      await io.aiTurn(fA);
      // the next faction's turn opens and it marches on the player straight away, as core/ai.js attackBranch does
      io.aiTurn(fB);
      await new Promise((r) => requestAnimationFrame(r));
      const w = debug.setupWar(g, { from, to: home, ids: g.cities[from].officers.slice(0, 2), commander: g.cities[from].officers[0], gold: 100, rice: 400 });
      io.war(w);
      await new Promise((r) => setTimeout(r, 400));
      return [...document.querySelectorAll('.aiturn')].map((p) => p.textContent);
    });
  } finally { stop(); }
  assert.deepEqual(left, [], `plaques left: ${left.join(', ')}`);
});

// An AI war keeps the original's 7.09 s in its three beats (出阵, 战斗中, 胜利): the standards march, clash and one
// falls, and in the last beat the city flashes under 攻陷 / 守住 (playtest of 2026-10-31, F11). A 旱灾 / 洪水 shows the struck land, someone else's within the
// original's 4.76 s (F09).
test('an AI war ends with its city flashing the outcome, 7.09 s in all', async () => {
  const r = await page.evaluate(async () => {
    const { g, io } = window.__game, fs = g.factions.filter((f) => f.ruler != null && f.id !== g.player);
    const city = g.cities.find((c) => c.faction === fs[1].id).id, from = window.__game.G.data().cities[city].roads[0], t0 = performance.now(), seen = new Set(), words = [];
    const { scene } = window.__game.strategy, objs = scene.children.length;
    let most = 0;
    const watch = setInterval(() => {
      const n = document.querySelector('.ctag.news'); if (n) seen.add(n.dataset.news);
      const w = document.querySelector('.aiwar')?.textContent; if (w && w !== words.at(-1)) words.push(w);
      most = Math.max(most, scene.children.length - objs);
    }, 30);
    await io.event({ type: 'autobattle', war: { attacker: fs[0].id, defender: fs[1].id, city, from, att: { ids: [fs[0].ruler] } }, res: { attWins: false } });
    clearInterval(watch);
    await new Promise((r) => setTimeout(r, 1200)); // the last dust settles, the rings fade
    return { total: performance.now() - t0 - 1200, seen: [...seen], words, most, left: scene.children.length - objs, att: window.__game.G.factionName(window.__game.g, fs[0].id), def: window.__game.G.factionName(window.__game.g, fs[1].id), plaques: document.querySelectorAll('.aiwar').length };
  });
  assert.ok(near(r.total, 7090, 0.1), `took ${Math.round(r.total)} ms`);
  assert.equal(r.seen.length, 1); assert.match(r.seen[0], /守住$/, 'the defender held it');
  // The original's three captions in turn: 出阵 and 战斗中 for the attacker, 胜利 for the winner.
  assert.deepEqual(r.words, [`${r.att}军出阵`, `${r.att}军战斗中`, `${r.def}军胜利`]);
  assert.ok(r.most >= 2, 'the two standards stood on the board'); assert.equal(r.left, 0, 'and were cleared after'); assert.equal(r.plaques, 0);
});
// A war stepped by hand on the 3D map, all in one evaluate, so the frame loop cannot get a tick in between.
const steppedWar = (script) => page.evaluate((script) => {
  const { g, G, strategy } = window.__game, fs = g.factions.filter((f) => f.ruler != null && f.id !== g.player), to = g.cities.find((c) => c.faction === fs[1].id).id;
  const w = strategy.aiWar({ from: G.data().cities[to].roads[0], to, att: fs[0].id, def: fs[1].id, attName: 'a', defName: 'b' });
  try { return new Function('w', script)(w); } finally { w.dispose(); }
}, script);

test('an AI war\'s clash strikes from its first moment, the march\'s clock long gone', async () => {
  const r = await steppedWar(`
    w.march(2360); for (let t = 0; t < 2.36; t += 0.1) w.tick(0.1);
    const settled = w.debug(); w.clash(2360); const before = settled.dust; w.tick(0.03); const first = w.debug();
    const rings = [first.rings]; for (let t = 0; t < 1; t += 0.1) { w.tick(0.1); rings.push(w.debug().rings); }
    return { dust: first.dust, before, rings };`);
  assert.ok(r.dust >= r.before + 4, `the first blow's dust and sparks at once: ${r.before} then ${r.dust}`);
  assert.ok(r.rings[0] >= 1, 'with its ring');
  assert.ok(r.rings.at(-1) >= 1, 'and more through the clash');
});

test('a winning attacker rides in from where his last lunge left him, with no step or snap', async () => {
  const r = await steppedWar(`
    w.march(100); w.clash(1000); w.tick(0.1); // the top of his first lunge
    const lunged = w.debug(); w.end(true, 2360); w.tick(0.016);
    return { lunged, next: w.debug() };`);
  const step = Math.hypot(r.next.a.x - r.lunged.a.x, r.next.a.z - r.lunged.a.z);
  assert.ok(step < 0.06, `a frame's step on the board, his ride forward at most (back to his mark is 0.3): ${step}`);
  assert.notEqual(r.lunged.a.lean, 0, 'he was leaning into the blow');
  assert.ok(Math.abs(r.next.a.lean - r.lunged.a.lean) < 0.02, `and straightens by degrees: ${r.lunged.a.lean} then ${r.next.a.lean}`);
});

// The board as baked (tools/blender_sandtable.py): the sea shows nowhere but the sea, and no river stops short of it.
test('no ground sinks under the sea plane away from the sea, and 交州\'s river reaches the sea', () => {
  const dir = new URL('../assets/ai/sandtable/board/', import.meta.url), meta = JSON.parse(readFileSync(new URL('board.json', dir))), bin = readFileSync(new URL('height.bin', dir));
  const [W, H] = meta.grid, h = new Uint16Array(bin.buffer, bin.byteOffset, W * H), at = (k, j) => meta.h[0] + h[j * W + k] / 65535 * (meta.h[1] - meta.h[0]);
  const seen = new Uint8Array(W * H), pockets = [];
  for (let i = 0; i < W * H; i++) if (!seen[i] && at(i % W, Math.floor(i / W)) < meta.sea) {
    let n = 0; const st = [i]; seen[i] = 1;
    while (st.length) {
      const q = st.pop(), k = q % W, j = Math.floor(q / W); n++;
      for (let b = Math.max(0, j - 1); b <= Math.min(H - 1, j + 1); b++) for (let a = Math.max(0, k - 1); a <= Math.min(W - 1, k + 1); a++) { const o = b * W + a; if (!seen[o] && at(a, b) < meta.sea) { seen[o] = 1; st.push(o); } }
    }
    pockets.push(n);
  }
  assert.equal(pockets.length, 1, `only the sea: ${pockets}`);
  const rivers = meta.water.filter((w) => w.kind === 'river');
  for (const w of rivers) { assert.equal(w.f.length, w.v.length / 6, 'an alpha for each pair'); }
  const ends = rivers.map((w) => [(w.v.at(-6) + w.v.at(-3)) / 2, w.v.at(-5), (w.v.at(-4) + w.v.at(-1)) / 2]);
  const south = ends.reduce((a, b) => (b[2] > a[2] ? b : a)), [k, j] = [Math.round((south[0] - meta.box[0]) / meta.step[0]), Math.round((south[2] - meta.box[2]) / meta.step[1])];
  assert.ok(at(k, j) < meta.sea, `the southernmost river ends in the sea: ${south}, ground ${at(k, j)}`);
});

for (const kind of ['drought', 'flood']) test(`someone else's ${kind} shows its picture over the struck cities, 4.76 s`, async () => {
  const r = await page.evaluate(async (kind) => {
    const { g, io } = window.__game, list = g.cities.filter((c) => c.faction !== g.player).slice(0, 2).map((c) => [c.id, 0]), t0 = performance.now();
    let scene = null, flashed = 0;
    const watch = setInterval(() => { scene ??= document.querySelector('.vig')?.dataset.scene; flashed = Math.max(flashed, document.querySelectorAll('.ctag.news').length); }, 30);
    await io.event({ type: 'disaster', kind, list });
    clearInterval(watch);
    return { total: performance.now() - t0, scene, flashed };
  }, kind);
  assert.equal(r.scene, kind); assert.equal(r.flashed, 2, 'both struck cities flash');
  assert.ok(near(r.total, 4760, 0.1), `took ${Math.round(r.total)} ms`);
});

test('the procedural board restores its cavity shading when territory is turned off', async () => {
  const p = await game.open('&board=proc', { setup: (ctx) => ctx.addInitScript(() => localStorage.setItem('hd2d-quality', 'high')) });
  try {
    const result = await p.evaluate(() => {
      const { strategy: s, G } = window.__game, ground = s.scene.children.find((o) => o.material?.customProgramCacheKey?.() === 'strategyGround');
      const color = ground.geometry.attributes.color, initial = color.array.slice(), version = color.version;
      s.refresh(G.newGame(4, 1, 7)); const offVersion = color.version;
      s.territory(true); const changed = color.array.some((v, i) => v !== initial[i]);
      s.territory(false); return { version, offVersion, changed, restored: color.array.every((v, i) => v === initial[i]), on: s.territoryOn };
    });
    assert.equal(result.version, result.offVersion, 'off does not recolour the procedural ground');
    assert.ok(result.changed && result.restored && !result.on);
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); }
});

test('no page errors', () => assert.deepEqual(page.errors, []));
