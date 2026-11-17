// 战略地图 diorama in the war map's HD-2D style: the landscape (src/worldmap.js) with the 30 ROM cities on their
// real Eastern Han seats (src/china.js, checked by tools/check_geo.mjs) and the 64 roads, coloured from the live
// game state.
import * as THREE from 'three';
// Keep shared texture modules in their original evaluation order.
import './fx.js';
import { U } from './seasons.js';
import './weather.js';
import { buildWorld, SEA_Y } from './worldmap.js';
import { buildSandtable, TERRITORY_PALETTE } from './sandtable.js';
import { placeCities, siteOfCity } from './china.js';
import { expandedNodes, expandedSandMeta } from './core/expanded-map.js';
import { NONE, FACTION_COLORS, cityName, factionName } from './core/game.js';
import { createStrategyRoads } from './strategyroads.js';
import { createStrategyCities } from './strategycities.js';
import { createStrategySky } from './strategysky.js';
import { createStrategyMarks } from './strategymarks.js';
import { createStrategyWar } from './strategywar.js';
export { COMPOUND, surnameOf, paintBanner } from './strategywar.js';

// A world-depth band keeps the playable neighbourhood sharp at any zoom; low tilt retains a soft far rim.
const DOF_BAND = [6.5, 0.16], DOF_RAMP = [9, 0.08], DOF_STRENGTH = [0.95, 0.9], DOF_FAR = [1, 0.4], DOF_NEAR = [0.7, -0.2];
export const colorOf = (f) => (f === NONE ? '#c8c0b0' : FACTION_COLORS[f]);
const SITES = placeCities();

export function createStrategy(ctx) {
  const { data } = ctx;
  const sand = data.expandedMap && ctx.sand ? { ...ctx.sand, meta: expandedSandMeta(ctx.sand.meta, data.frontierMap) } : ctx.sand;
  const sites = data.expandedMap ? [...SITES, ...expandedNodes(data.frontierMap).map((n) => siteOfCity(n.id))] : SITES;
  const scene = new THREE.Scene();
  // Sky, camera, lights, world, roads, cities and clouds must enter the scene in the same order as before the split.
  const atmosphere = createStrategySky({ scene, sand, onSeason: (m, instant) => ctx.onSeason?.(m, instant) });
  const { ambience } = atmosphere;
  // A narrow lens from further back: stronger near-large/far-small than the old 30° view at the same framing.
  const camera = new THREE.PerspectiveCamera(23, 1, 0.5, 220);
  scene.add(camera);
  atmosphere.addLights();

  const world = sand ? buildSandtable(scene, sand) : buildWorld(scene, sites);
  const citySetup = createStrategyCities({ scene, data, sand, world, sites, onCity: (id) => ctx.onCity(id), onHover: hoverCity, colorOf });
  const { cityPos } = citySetup;
  const groundY = (x, z) => Math.max(SEA_Y, world.heightAt(x, z));

  const roadLayer = createStrategyRoads({ scene, data, sand, world, cityPos, groundY });
  const { pathOf } = roadLayer;
  let scenicOn = false, territoryOn = false, territoryGame = null;
  const cities = citySetup.build();
  const { marks, pickables, cityReach } = cities;
  atmosphere.addClouds(camera);

  // Rebuild territory only when an owner or the player changes, not on routine HUD/season refreshes.
  const ownerColors = new Map();
  const ownerColor = (f) => { if (!ownerColors.has(f)) ownerColors.set(f, new THREE.Color(sand ? TERRITORY_PALETTE[f] : colorOf(f))); return ownerColors.get(f); };
  const tintOwners = new Int16Array(data.cities.length).fill(-1);
  let tintPlayer = -1;
  function tint(g) {
    let changed = tintPlayer !== g.player;
    for (const c of g.cities) if (tintOwners[c.id] !== c.faction) changed = true;
    if (!changed) return;
    world.tint((cid) => { const f = g.cities[cid].faction; return f === NONE ? null : ownerColor(f); }, (cid) => g.cities[cid].faction, g.player);
    tintPlayer = g.player; for (const c of g.cities) tintOwners[c.id] = c.faction;
  }
  // Recolour from the game state: owner colour, officer count, ruler crown. A war passes its own count (Field.headcount).
  function refresh(g, officerCount = (c) => c.officers.length) {
    setSeason(g.month);
    territoryGame = g;
    if (territoryOn) { tint(g); world.setTerritory?.(true); }
    for (const c of g.cities) {
      const m = marks[c.id], col = colorOf(c.faction);
      m.flag.material.color.set(col); m.flag.material.emissive.set(col); m.el.style.setProperty('--c', col);
      m.glaze = c.faction === NONE ? null : new THREE.Color(col); // unowned cities keep plain grey tile
      m.el.classList.toggle('mine', c.faction === g.player);
      m.el.classList.toggle('pass', data.cities[c.id].kind === 'pass');
      const n = officerCount(c);
      m.el.innerHTML = `${cityName(c.id)}<small>${factionName(g, c.faction)}${n ? `·${n}将` : ''}</small>`;
      m.ruled = g.factions.some((f) => f.ruler != null && f.city === c.id && c.officers.includes(f.ruler));
      m.crown.visible = m.ruled && !scenicOn;
    }
    cities.invalidate();
  }
  const visualMarks = createStrategyMarks({ scene, data, sand, world, cityPos, cityReach, pathOf, groundY });
  let candidates = null;

  // The tilt follows the zoom: pulled back the board reads like a map (≈60°), pushed in it leans toward
  // the horizon (≈34°) like an HD-2D diorama. Dragging adds a bias on top instead of fixing the angle.
  const ZOOM = [10, 80], DEFAULT_DIST = 24; // 24: the nearest view that keeps every road neighbour of the selected city on screen
  const OPENING_TARGET = new THREE.Vector3(1.2, 0, 1);
  // bakeView's lens: long, so the board's tall west and north lean less over the frame and the map's scale changes less across it. Far past where the tilt stops at ≈60°.
  const BAKE_FOV = 10, BAKE_DIST = 144, BAKE_WOODS_FLOOR = [[0.36, 0.62, 0.2], [0.32, 0.62, 0.19], [0.62, 0.44, 0.14], [0.44, 0.4, 0.2]], BAKE_CROWNS = 1.3;
  let baked = false;
  const dofLens = { strength: 0, bandWorld: 0, rampWorld: 0, far: 0, near: 0 }; // reused by the frame loop
  const view = { yaw: 0.12, bias: 0, dist: 45, target: OPENING_TARGET.clone() };
  // Input moves `goal`; update() eases the view toward it so drags, wheel steps and keys glide.
  const goal = { yaw: view.yaw, bias: view.bias, dist: view.dist, target: view.target.clone() };
  const pitchOf = (v = view) => {
    const t = Math.min(1, Math.max(0, (v.dist - 14) / (55 - 14)));
    return Math.min(1.35, Math.max(0.45, 0.6 + 0.45 * t + v.bias));
  };
  const lowness = () => Math.min(1, Math.max(0, (1.0 - pitchOf()) / 0.4)); // 0 near top-down … 1 at the lowest tilt
  let selected = null;
  const tmpV = new THREE.Vector3();
  const ray = new THREE.Raycaster();
  // The city the pointer is on, over its model or over its tag: the ring on the ground and the tag light together,
  // so it is plain which city a click takes (T14).
  let hovered = null;
  function hoverCity(cid) {
    if (hovered === cid) return;
    if (hovered != null) marks[hovered].el.classList.remove('hov');
    hovered = cid; visualMarks.hover(cid);
    if (cid != null) marks[cid].el.classList.add('hov');
  }
  // During a map pick a candidate wins over a nearer city whose pick box overlaps it on screen.
  const pick = (ndc) => {
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(pickables, false).map((h) => h.object.userData.city);
    return (candidates && hits.find((c) => candidates.has(c.id))) || hits[0];
  };
  let time = 0;
  // Ease into a month's look (2.5 s), or jump to it.
  function setSeason(m, instant = false) { atmosphere.setSeason(m, instant, world); }
  setSeason(2, true); // the title screen opens on 季春

  const territoryAttention = () => world.setTerritoryFocus?.(!!candidates || war.active);
  const war = createStrategyWar({ scene, sand, cityPos, pathOf, groundY, colorOf, frame, focusCity: (cid) => focusCity(cid),
    clashFocus: (mid) => { goal.target.set(mid.x, mid.y * 0.5 + 0.4, mid.z + 0.5); goal.dist = 16; },
    attention: territoryAttention, addPulse: visualMarks.addPulse, pulseCount: visualMarks.pulseCount });
  // Ease the view so all these cities are on screen, looking at their middle.
  function frame(cids) {
    const ps = cids.map((c) => cityPos[c]), cx = ps.reduce((a, p) => a + p.x, 0) / ps.length, cz = ps.reduce((a, p) => a + p.z, 0) / ps.length;
    const spread = Math.max(...ps.map((p) => Math.hypot(p.x - cx, p.z - cz)));
    goal.target.set(cx, 0.2, cz + 0.6); goal.dist = Math.min(ZOOM[1], Math.max(20, spread * 4.2 + 12));
  }
  const focusCity = (cid) => goal.target.set(cityPos[cid].x, cityPos[cid].y * 0.5, cityPos[cid].z + 1);
  // How far a drag, the keys or a nudge may take the point looked at: a little past the outermost cities, never off over the empty table.
  const reach = cityPos.reduce((b, p) => [Math.min(b[0], p.x - 2), Math.max(b[1], p.x + 2), Math.min(b[2], p.z - 1), Math.max(b[3], p.z + 3)], [Infinity, -Infinity, Infinity, -Infinity]);
  const onBoard = (t) => { t.x = Math.min(reach[1], Math.max(reach[0], t.x)); t.z = Math.min(reach[3], Math.max(reach[2], t.z)); };
  // The camera as it will be once the view has eased to `goal`, for placing things where they will be rather than where they are mid-glide.
  const restCam = new THREE.PerspectiveCamera(), restV = new THREE.Vector3(), restRay = new THREE.Raycaster();
  const atRest = () => {
    const { yaw, dist, target } = goal, pitch = pitchOf(goal);
    Object.assign(restCam, { fov: camera.fov, aspect: camera.aspect, near: camera.near, far: camera.far }); restCam.updateProjectionMatrix();
    restCam.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, target.z + Math.cos(yaw) * Math.cos(pitch) * dist);
    restCam.lookAt(target); restCam.updateMatrixWorld();
    return restCam;
  };
  return {
    aiWar: war.aiWar,
    scene, camera,
    refresh, setSeason,
    get month() { return atmosphere.month; },
    select(cid) {
      visualMarks.clearSelection(cid); selected = cid; visualMarks.select(cid);
    },
    // A ring that spreads from a city once, to mark where a command just took effect.
    pulse(cid, color) {
      visualMarks.pulse(cid, color, time);
    },
    // A city's news (an AI war's outcome): three rings in the given colour and a badge over its tag for ms.
    announce(cid, text, color, ms) {
      for (const d of [0, 0.45, 0.9]) { this.pulse(cid, color); visualMarks.lastPulse().userData.t0 = time + d; }
      const el = marks[cid].el; clearTimeout(el.newsT);
      el.dataset.news = text; el.style.setProperty('--news', color); el.classList.add('news');
      el.newsT = setTimeout(() => el.classList.remove('news'), ms);
    },
    // Point at a city from outside the map (e.g. while a city list is hovered) without changing the selection.
    highlight(cid) {
      visualMarks.hover(cid);
      marks.forEach((m, i) => m.el.classList.toggle('hl', i === cid));
    },
    focusCity,
    // The player's own turn and distance, to give back after the AI turns (whose frame() zooms): pose() keeps it,
    // returnTo(cid, pose) eases over that city at it. A pose from the other map (a switch meanwhile) only pans.
    pose: () => ({ kind: '3d', yaw: goal.yaw, bias: goal.bias, dist: goal.dist }),
    returnTo(cid, p) {
      if (p?.kind === '3d') { goal.yaw = p.yaw; goal.bias = p.bias; goal.dist = p.dist; }
      if (cityPos[cid]) focusCity(cid);
    },
    // Candidates for a map pick (null ends it): they glow and keep their tags solid, the others dim.
    // from: the city the order starts at (or the battlefield), which stays lit.
    pickMode(cids, from = null) {
      candidates = cids ? new Set(cids) : null;
      visualMarks.clearCandidates();
      marks.forEach((m, i) => { m.el.classList.toggle('cand', !!candidates?.has(i)); m.el.classList.toggle('dim', !!candidates && !candidates.has(i) && i !== from); });
      visualMarks.addCandidates(candidates);
      territoryAttention();
    },
    // Ease the view so all these cities are on screen, looking at their middle.
    frame,
    // 镜头复位: the default turn and distance, over the selected city, else `fallback` (the caller's choice), else the map's opening
    // view. An event far away or a pan had left the view elsewhere (feedback G02, 2026-11-04: playing in 云南, looking at 辽东).
    // { instant }: already there, for a map going up under a fade.
    resetView(fallback, { instant = false } = {}) {
      goal.yaw = 0.12; goal.bias = 0; goal.dist = DEFAULT_DIST;
      const c = selected ?? fallback;
      if (cityPos[c]) focusCity(c); else goal.target.copy(OPENING_TARGET);
      if (instant) { view.yaw = goal.yaw; view.bias = goal.bias; view.dist = goal.dist; view.target.copy(goal.target); }
    },
    update(dt) {
      const ez = 1 - Math.exp(-dt * 8), ep = 1 - Math.exp(-dt * 5);
      view.yaw += (goal.yaw - view.yaw) * ez; view.bias += (goal.bias - view.bias) * ez;
      view.dist += (goal.dist - view.dist) * ez; view.target.lerp(goal.target, ep);
      time += dt; world.update(time, camera, view.dist, ctx.renderer?.getPixelRatio()); atmosphere.advance(time);
      roadLayer.update(view, camera);
      atmosphere.update(dt, time, view, world);
      visualMarks.updateRings(time);
      atmosphere.updateTable(dt, world);
      war.update(dt, time);
      visualMarks.updatePulses(time);
      cities.updateFlags(time);
      visualMarks.updateFlow(time);
      const { yaw, dist, target } = view, pitch = pitchOf();
      camera.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, target.z + Math.cos(yaw) * Math.cos(pitch) * dist);
      camera.lookAt(target); visualMarks.updateHover(time);
      atmosphere.updateView(time, dist, lowness(), camera);
      cities.updateTags(dt, camera, dist, selected, hovered, candidates, roadLayer.roadsOn, DEFAULT_DIST, tmpV);
    },
    // What is in focus: the selected city, else the point the camera looks at.
    focusPoint() { return selected != null ? cityPos[selected] : view.target; },
    debugView: () => ({ yaw: view.yaw, bias: view.bias, dist: view.dist, target: view.target.toArray() }), // tests
    // Depth of field grows as the camera leans toward the horizon; the far half blurs more than the near,
    // and the near half stays readable enough to pick cities in the foreground.
    dof() {
      const k = lowness(); dofLens.strength = DOF_STRENGTH[0] + DOF_STRENGTH[1] * k;
      dofLens.bandWorld = DOF_BAND[0] + DOF_BAND[1] * view.dist; dofLens.rampWorld = DOF_RAMP[0] + DOF_RAMP[1] * view.dist;
      dofLens.far = DOF_FAR[0] + DOF_FAR[1] * k; dofLens.near = DOF_NEAR[0] + DOF_NEAR[1] * k; return dofLens;
    },
    hover(ndc) { const c = pick(ndc); hoverCity(c ? c.id : null); return c; },
    // The gamepad's cursor (app.js): a city lit by id, and where it stands on screen (CSS px; off: behind the eye).
    hoverId(cid) { hoverCity(cid); return cid == null ? null : data.cities[cid]; },
    screenOfCity(id) { camera.updateMatrixWorld(); const v = tmpV.copy(cityPos[id]).project(camera); return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, off: v.z > 1 }; },
    // 道路 overview on or off (T15); with it every tag stays solid and full.
    roads(on) { roadLayer.roads(on); },
    get roadsOn() { return roadLayer.roadsOn; },
    territory(on) {
      on = !!on; if (territoryOn === on) return; territoryOn = on;
      if (on && territoryGame) tint(territoryGame);
      if (!on && world.clearTint) { world.clearTint(); tintPlayer = -1; } // the procedural board has vertex colours instead of the sand shader
      world.setTerritory?.(on && !!territoryGame);
    },
    get territoryOn() { return territoryOn; },
    // 欣赏模式: the ruler's crown sits under the city tag, so with the tags away it goes too.
    scenic(on) { scenicOn = on; for (const m of marks) m.crown.visible = !!m.ruled && !on; },
    click(ndc) { const c = pick(ndc); ctx.onCity(c ? c.id : null); },
    orbit(dx, dy) { goal.yaw -= dx * 0.006; goal.bias = Math.min(0.4, Math.max(-0.3, goal.bias + dy * 0.004)); },
    zoom(d) { goal.dist = Math.min(ZOOM[1], Math.max(ZOOM[0], goal.dist * (1 + d * 0.001))); },
    pan(dx, dz) { const c = Math.cos(goal.yaw), sn = Math.sin(goal.yaw); goal.target.x += dx * c + dz * sn; goal.target.z += dz * c - dx * sn; onBoard(goal.target); },
    // A left drag (app.js, D52 猫污染@devblog): the ground under the pointer goes with it, at once (the view and its goal move together;
    // a glide toward a city that was under way carries on from there). dy is foreshortened by the tilt, as the war map's slide.
    slide(dx, dy) {
      const k = 2 * view.dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / innerHeight;
      const was = goal.target.clone(); this.pan(-dx * k, -dy * k / Math.sin(pitchOf()));
      view.target.add(was.sub(goal.target).negate());
    },
    // Where a city will stand on screen once the view settles (CSS px), and the least change of the point looked at that moves it
    // (sx, sy) px from there, at the same turn, tilt and distance (app.js keeps a city the mouse picked clear of the HUD, D53).
    tagOf: (id) => marks[id]?.el,
    screenAtRest(id) { const v = restV.copy(cityPos[id]).project(atRest()); return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, off: v.z > 1 }; },
    nudge(id, sx, sy) {
      const p = this.screenAtRest(id), cam = atRest(), c = cityPos[id];
      restRay.setFromCamera({ x: (p.x + sx) / innerWidth * 2 - 1, y: 1 - (p.y + sy) / innerHeight * 2 }, cam);
      const { origin: o, direction: d } = restRay.ray; if (Math.abs(d.y) < 1e-4) return;
      // Where the ray through the new spot meets the city's height: the view moves by the city's distance from there.
      const t = (c.y - o.y) / d.y; goal.target.x += c.x - (o.x + d.x * t); goal.target.z += c.z - (o.z + d.z * t); onBoard(goal.target);
    },
    rotate(dir) { goal.yaw += dir * Math.PI / 8; },
    // For tools/bake_strategy_flat.mjs only, on a page it then throws away, with the frame loop stopped (one update() would undo this):
    // the bare board in a month's settled light from the fixed view, and where everything lands in a picture of size [w, h] of that view.
    // Weather, drifting cloud shade and wet ground are off and the clock fixed, so the four pictures differ by season alone and cross-fade cleanly.
    bakeView({ month, size: [W, H] }) {
      this.select(null); this.highlight(null); hoverCity(null); this.pickMode(null); this.roads(false); this.territory(false);
      world.disableDetail(); roadLayer.hideBase(); // the flat pictures retain full sea crests and their baked roads
      setSeason(month, true); // territory is live ink, never part of the seasonal pictures
      const [X0, X1, Z0, Z1] = sand.meta.box, centre = new THREE.Vector3((X0 + X1) / 2, 0, (Z0 + Z1) / 2 + 1.5); // the frame's near side reaches further down the view
      for (const v of [view, goal]) { v.yaw = 0; v.bias = 0; v.dist = BAKE_DIST; v.target.copy(centre); }
      camera.aspect = W / H; camera.fov = BAKE_FOV; camera.updateProjectionMatrix();
      time = 0; this.update(0);
      for (const o of ambience) o.visible = false;
      for (const m of marks) m.flag.visible = m.crown.visible = m.lab.visible = false;
      scene.background = null; world.table.visible = false;
      scene.fog.near = 1e4; scene.fog.far = 2e4; // a map has no far side: the north as clear as the south
      U.uCloud.value = U.uWet.value = 0; atmosphere.applyLight(world, 0, false);
      // The woods from afar are crowns over a floor baked near black: as a map they read as black speckle, so the floor gets a fill in the season's colour and the crowns a lift.
      world.uWoodsFloor.value.setRGB(...BAKE_WOODS_FLOOR[Math.floor(month / 3)]);
      if (!baked) { // once; a piece's near and far meshes share their colours
        baked = true; const crowns = new Set();
        scene.traverse((o) => { if (o.instanceColor) crowns.add(o.instanceColor); });
        for (const c of crowns) { c.array.forEach((v, i, a) => { a[i] = v * BAKE_CROWNS; }); c.needsUpdate = true; }
      }
      world.nearLods();
      // Everything on the board stays over the board: the massifs and a river end the 3D view lets run over the frame stop at its inner edge.
      const inside = [new THREE.Plane(new THREE.Vector3(1, 0, 0), -X0), new THREE.Plane(new THREE.Vector3(-1, 0, 0), X1), new THREE.Plane(new THREE.Vector3(0, 0, 1), -Z0), new THREE.Plane(new THREE.Vector3(0, 0, -1), Z1)];
      scene.traverseVisible((o) => { if (o.isMesh && o.geometry.type !== 'BoxGeometry') for (const m of [o.material].flat()) if (!m.clippingPlanes) { m.clippingPlanes = inside; m.needsUpdate = true; } });
      scene.updateMatrixWorld(); camera.updateMatrixWorld();
      const project = (x, y, z) => { const v = tmpV.set(x, y, z).project(camera); return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H]; };
      const top = new THREE.Vector3();
      const cities = data.cities.map((c, i) => {
        const p = cityPos[i], r = cityReach[i], [cx, cy] = project(p.x, p.y, p.z);
        const at = (o, up = 0) => { o.getWorldPosition(top); return project(top.x, top.y + up, top.z); };
        return { id: c.id, cx, cy, flag: at(marks[i].flag, 0.07), tag: at(marks[i].lab), // the flag hangs 0.07 under its pole's top
          rx: (project(p.x + r, p.y, p.z)[0] - project(p.x - r, p.y, p.z)[0]) / 2, ry: (project(p.x, p.y, p.z + r)[1] - project(p.x, p.y, p.z - r)[1]) / 2 };
      });
      const roads = [];
      for (const c of data.cities) for (const n of c.roads) if (c.id < n) {
        const pts = pathOf(c.id, n), sea = pts.map((q) => world.heightAt(q.x, q.z) < world.sea + 0.01);
        roads.push({ a: c.id, b: n, sea, p: pts.flatMap((q, i) => project(q.x, Math.max(q.y, sea[i] ? world.sea : world.heightAt(q.x, q.z)), q.z)) });
      }
      // The ground under a picture pixel, walking the view ray down onto the relief; null outside the board.
      const groundAt = (px, py) => {
        ray.setFromCamera({ x: px / W * 2 - 1, y: 1 - py / H * 2 }, camera);
        const { origin: o, direction: d } = ray.ray; let x = 0, z = 0, y = world.sea;
        for (let k = 0; k < 4; k++) {
          const t = (y - o.y) / d.y; x = o.x + d.x * t; z = o.z + d.z * t;
          if (x < X0 || x > X1 || z < Z0 || z > Z1) return null;
          y = Math.max(world.sea, world.heightAt(x, z));
        }
        return { x, z };
      };
      // Owners' tint at a picture pixel: as the 3D board's, which tints the land and leaves the sea alone.
      const tintAt = (px, py) => {
        const q = groundAt(px, py); if (!q) return { near: -1, k: 0, land: 0 };
        const { near, k } = world.tintAt(q.x, q.z);
        const land = world.heightAt(q.x, q.z) >= world.sea;
        return { near: world.cities[near].id, k: land ? k : 0, land: land ? 1 : 0 };
      };
      return { project, cities, roads, tintAt };
    },
  };
}
