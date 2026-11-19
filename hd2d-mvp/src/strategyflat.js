// 战略地图 at the low picture quality: a pre-rendered board per season (tools/bake_strategy_flat.mjs) on a 2D canvas, the same
// api as createStrategy, no 3D frame and none of the sand table's downloads. The DOM city tags stay as they are on the 3D map.
// Input comes through the WebGL canvas underneath (app.js), as for the flat war map: this layer takes no pointer events, only its tags do.
import { PHONE } from './phone.js';
import * as THREE from 'three';
import { createSeasons, SEASON_TABLE, U } from './seasons.js';
import { colorOf, paintBanner, surnameOf } from './strategy.js';
import { TERRITORY_PALETTE, TERRITORY_FILL, TERRITORY_MID_BOOST, TERRITORY_BAND_WORLD, TERRITORY_BORDER_HALF_PX, TERRITORY_NEUTRAL_BORDER, TERRITORY_FOCUS_SCALE } from './sandtable.js';
import { createSky2d } from './skyfx2d.js';
import { layoutTags, measureTags } from './citytags.js';
import { NONE, cityName, factionName } from './core/game.js';
import { expandedFlatBoard } from './core/expanded-map.js';
import { readResource } from './resource.js';

const DIR = 'assets/ai/sandtable/flat';
const SEASONS = ['spring', 'summer', 'autumn', 'winter'], seasonOf = (m) => Math.floor(m / 3);
const FADE = 2.5; // seconds, with the UI's colours (ui.css .season-turning)
const Z_MAX = PHONE ? 4 : 2; // the zoom runs from the whole board (1) to this; a phone's screen is small, so it may go nearer
const PAN_UNIT = 110; // picture px per world unit of the 3D board: WASD moves at about the 3D map's pace
// The HUD floats over the map: zoomed in, the view may run this many screen px past the board's edge, so a city by the frame can come out from under
// the city panel (x) or the command dock (y). A narrow window's panel is the widest thing to clear.
const SLACK_X = 360, SLACK_Y = 150;
const FOCUS = new THREE.Vector3();
// The bake's view of the board: a world unit across (PAN_UNIT), foreshortened down the picture, and how far up the picture a world unit of height goes.
const DOWN = 0.85, UP = 0.5;
// As the 3D map's rings (RINGS, in cityReach, which is the board's rx and ry) and its 道路 overview's ribbons and dashes, in world units.
const RINGS = { hover: [0.76, 0.94], sel: [0.9, 1.1], cand: [0.82, 1.08] }, ROAD = 0.072 * PAN_UNIT, ROAD_EDGE = 0.15 * PAN_UNIT, DASH = 0.12 * PAN_UNIT;
const CLEAR = 0.62; // the roads end at the walls: in 3D the town stands in front of them, here they would lie across its roofs
// The cloth's world width (a little over the 3D plane's up close: this view never gets as near), the least it shows in screen px, and how far its pole goes down the picture.
// It hangs taller than the 3D plane looks from above, where a flat view would leave a sliver.
const FLAG_W = 0.3, FLAG_MIN = 14, POLE = 0.44 * PAN_UNIT * UP;
// An AI war's standard. WAR: the 3D map's scale for the sand table's towns. CLOTH: the cloth's width in the 3D model's units. On screen the cloth is at least CLOTH_MIN px, what keeps a
// surname legible at the whole board, and CLOTH_WORLD world units when that is more. PRESS: the model's heights are pressed by this, as seen from above the 3D one looks shorter than it stands.
const WAR = 0.7, CLOTH = 0.33, CLOTH_MIN = 30, CLOTH_WORLD = 0.6, PRESS = 0.75;
// The picture row of a latitude: the sand table's z against the board's cy (a fit over the cities, within a degree), with toZ's 31.5 - lat. Where snow and blossom may fall, by the 3D map's bands.
const ROW = (lat) => (44.15 - lat) / 0.00914;
const SKY_CELL = 48; // sky()'s flake scale, 1: as the war map's at this window. The 3D flakes hardly change on screen with the distance, so these do not take the zoom.
const TITLE_Z = 1.4, TITLE_TURN = 0.005; // the title's pan: closer than the whole board, or a picture that fits has nowhere to go; radians of its slow wander per unit of orbit (a round in about 70 s)
const FLAT_TERRITORY_ZOOM = [1, 2], FLAT_RIM_ALPHA = [0.16, 0.14], FLAT_RIM_WIDTH = [1, 0.45];
const FLAT_BORDER_ALPHA = 0.8, FLAT_BORDER_MINE = 1.15, FLAT_BORDER_GAIN = 1.5, FLAT_GLOW_PX = 16;
const FLAT_GLOW_WIDTH = [1, 0.72, 0.44], FLAT_GLOW_ALPHA = [0.035, 0.06, 0.1];
const FLAT_BORDER_COLORS = TERRITORY_PALETTE.map((c) => new THREE.Color(c).multiplyScalar(FLAT_BORDER_GAIN).getStyle());
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// The board's coordinates and the first picture are in before it returns, so the map never opens blank. ctx.month: the month to open on
// (the title's 季春 unless a switch brings it in mid-game); ctx.onPicturesFailed: no picture could be had, and there is none to keep showing.
export async function createStrategyFlat(ctx) {
  const { data, month: start = 2 } = ctx;
  let board = await readResource(`${DIR}/board.json`, (r) => r.json());
  if (data.expandedMap) board = expandedFlatBoard(board, data.frontierMap);
  const [W, H] = board.size, B = board.bounds, cities = [];
  for (const c of board.cities) cities[c.id] = c;

  const wrap = Object.assign(document.createElement('div'), { className: 'flatstrategy' }), cv = document.createElement('canvas');
  const layer = Object.assign(document.createElement('div'), { className: 'labels' }); // not the CSS2D renderer's: setMode empties that one
  wrap.append(cv, layer); document.body.append(wrap);
  const g = cv.getContext('2d', { alpha: false });

  // ---- The view: a zoom and the picture point at the middle of the window, so a resize keeps both. `goal` may ask for more than the
  // board allows (a city's focus at the whole board): held() is what the window can show of it, and the wish applies once zoomed in.
  let vw = 1, vh = 1, dpr = 1, kMin = 1, asleep = false; // asleep: under the other map, release() to ready()
  const view = { z: 1, cx: (B.x0 + B.x1) / 2, cy: (B.y0 + B.y1) / 2 }, goal = { ...view };
  // What overflows the window is all the play an axis has, so the slack opens up with the zoom instead of at a step, and a board that fits stays centred.
  const axis = (c, half, a, b, slack) => {
    const over = b - a - half * 2;
    if (over <= 0) return (a + b) / 2;
    const s = Math.min(slack, over);
    return clamp(c, a + half - s, b - half + s);
  };
  const held = (v) => {
    const k = kMin * v.z;
    return { cx: axis(v.cx, vw / 2 / k, B.x0, B.x1, SLACK_X / k), cy: axis(v.cy, vh / 2 / k, B.y0, B.y1, SLACK_Y / k) };
  };
  const viewState = () => { const k = kMin * view.z; return { k, x: vw / 2 - view.cx * k, y: vh / 2 - view.cy * k }; };
  const hold = () => Object.assign(view, held(view));
  // A phone opens on the board filling the screen's width rather than whole (the whole board leaves its tags too small to tap);
  // pinching out still reaches the whole board.
  let homed = false;
  const zHome = () => (PHONE ? clamp(Math.max(vw / (B.x1 - B.x0), vh / (B.y1 - B.y0)) / kMin, 1, Z_MAX) : 1);
  function layout() {
    if (asleep) return; // ready() lays it out for the window as it then is
    dpr = Math.min(2, devicePixelRatio || 1); vw = innerWidth; vh = innerHeight;
    cv.width = vw * dpr; cv.height = vh * dpr; cv.style.width = `${vw}px`; cv.style.height = `${vh}px`;
    kMin = Math.min(vw / (B.x1 - B.x0), vh / (B.y1 - B.y0));
    if (PHONE && !homed) { homed = true; view.z = goal.z = zHome(); }
    hold(); draw();
  }
  // From where the view can actually be, or a wish past the edge would swallow the next moves.
  const shift = (dx, dy) => { const c = held(goal); goal.cx = c.cx + dx; goal.cy = c.cy + dy; Object.assign(goal, held(goal)); };
  const focusCity = (cid) => { goal.cx = cities[cid].cx; goal.cy = cities[cid].cy; };
  function frame(cids) {
    const cs = cids.map((c) => cities[c]), xs = cs.flatMap((c) => [c.cx - c.rx, c.cx + c.rx]), ys = cs.flatMap((c) => [c.tag[1], c.cy + c.ry]);
    const [xa, xb, ya, yb] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], MARGIN = 80;
    goal.cx = (xa + xb) / 2; goal.cy = (ya + yb) / 2;
    goal.z = clamp(Math.min(goal.z, (vw - MARGIN * 2) / (xb - xa) / kMin, (vh - MARGIN * 2) / (yb - ya) / kMin), 1, Z_MAX); // only ever gives way
  }

  // ---- The title's slow pan, where the 3D map turns: app.js calls orbit each frame the title is up, and only then (a drag slides this map). A frame without
  // that call ends it: back to the whole board at the view's usual ease, a wish made meanwhile (begin's focusCity) left standing.
  let drift = null;
  function wander(dx) {
    drift ??= { phase: 0 }; drift.asked = true; drift.phase += Math.abs(dx) * TITLE_TURN;
    const k = kMin * TITLE_Z, reach = (a, b, win) => Math.max(0, (b - a - win / k) / 2);
    goal.z = TITLE_Z;
    goal.cx = drift.cx = (B.x0 + B.x1) / 2 + reach(B.x0, B.x1, vw) * Math.sin(drift.phase);
    goal.cy = drift.cy = (B.y0 + B.y1) / 2 + reach(B.y0, B.y1, vh) * Math.sin(drift.phase * 0.6);
  }
  function settleDrift() {
    if (!drift) return;
    if (drift.asked) { drift.asked = false; return; }
    if (goal.cx === drift.cx && goal.cy === drift.cy) { goal.cx = (B.x0 + B.x1) / 2; goal.cy = (B.y0 + B.y1) / 2; }
    goal.z = 1; drift = null;
  }

  // ---- The pictures: the one showing, those fading under it and the next season's stay decoded (about 44 MB each); the rest go.
  const pics = new Map(), loading = new Map();
  let want = seasonOf(start), trying = null, flying = null, snap = false, layers = []; // layers: bottom first; each { s, pic, t: 0…1 faded in }
  const load = (s) => {
    if (pics.has(s)) return Promise.resolve(pics.get(s));
    if (!loading.has(s)) {
      loading.set(s, readResource(`${DIR}/${SEASONS[s]}.webp`, (r) => r.blob()).then((b) => createImageBitmap(b))
        .then((p) => { if (asleep) { p.close(); throw new Error('released'); } pics.set(s, p); return p; }).finally(() => loading.delete(s)));
    }
    return loading.get(s);
  };
  const prune = () => {
    const keep = new Set([...layers.map((l) => l.s), want, (want + 1) % 4, trying]);
    for (const [s, p] of pics) if (!keep.has(s)) { p.close(); pics.delete(s); }
  };
  // Shows a season's picture when it is ready, the old one staying up until then; one that will not load gives way to a neighbour's.
  async function show(s, instant) {
    want = s; flying = s; snap = false;
    for (const c of [s, (s + 1) % 4, (s + 3) % 4]) {
      let pic = null;
      trying = c; // a neighbour in reach of being shown must not be released under it
      try { pic = await load(c); } catch { /* the next one, then */ }
      if (asleep) return; // released meanwhile: ready() shows the month afresh
      if (want !== s) { if (trying === c) trying = null; prune(); return; } // the month moved on meanwhile
      if (!pic) continue;
      if (c !== s) console.warn(`战略地图: the ${SEASONS[s]} picture did not load, showing ${SEASONS[c]}`);
      const jump = instant || snap; flying = null; snap = false;
      if (layers.at(-1)?.s !== c) { if (jump || !layers.length) layers = [{ s: c, pic, t: 1 }]; else layers.push({ s: c, pic, t: 0 }); }
      else if (jump) layers = [{ ...layers.at(-1), t: 1 }];
      trying = null; prune();
      load((s + 1) % 4).then(prune, () => {});
      return;
    }
    trying = null; flying = null; snap = false;
    console.warn(`战略地图: no picture for ${SEASONS[s]} or its neighbours, keeping what shows until the next season`);
    if (!layers.length) ctx.onPicturesFailed?.();
  }

  const tableTo = SEASON_TABLE.map((c) => new THREE.Color(c)), table = tableTo[want].clone();
  // What does not move from one frame to the next, kept: scaling the picture and stroking the roads are most of a frame at a high pixel ratio, and flags and rings keep every
  // frame from being skipped outright. Painted again only when something in it has changed.
  const under = document.createElement('canvas'), ug = under.getContext('2d', { alpha: false });
  let underKey = '', underPaints = 0, territoryFocus = false, territoryOn = false, territoryGame = null;
  function paintUnder(k, x, y) {
    const wet = skyOn && season.cur.rain > 0.05 ? +season.cur.rain.toFixed(3) : 0, hex = table.getHexString();
    let key = `${k} ${x} ${y} ${cv.width} ${cv.height} ${hex} ${territoryOn ? tintDraws : 0} ${wet} ${roadsOn}`;
    for (const l of layers) key += ` ${l.s}:${l.t}`;
    if (key === underKey) return;
    underKey = key; underPaints++;
    if (under.width !== cv.width || under.height !== cv.height) { under.width = cv.width; under.height = cv.height; }
    ug.setTransform(dpr, 0, 0, dpr, 0, 0); ug.imageSmoothingEnabled = true; ug.imageSmoothingQuality = 'high';
    ug.globalAlpha = 1; ug.fillStyle = `#${hex}`; ug.fillRect(0, 0, vw, vh);
    for (const { pic, t } of layers) { ug.globalAlpha = t * t * (3 - 2 * t); ug.drawImage(pic, x, y, W * k, H * k); }
    ug.globalAlpha = 1;
    if (territoryOn && tintDraws) {
      // Canvas colour blending keeps the picture's luminance and paint instead of covering it with a flat fill.
      const z = THREE.MathUtils.smoothstep(view.z, FLAT_TERRITORY_ZOOM[0], FLAT_TERRITORY_ZOOM[1]), attention = territoryFocus ? TERRITORY_FOCUS_SCALE : 1;
      const fill = (THREE.MathUtils.lerp(TERRITORY_FILL[1], TERRITORY_FILL[0], z) + TERRITORY_MID_BOOST * 4 * z * (1 - z)) * attention;
      // Smooth faction transitions while clipping the colour to owned land, so neither sea nor unowned land is tinted.
      ug.save(); ug.setTransform(dpr * k, 0, 0, dpr * k, dpr * x, dpr * y); ug.clip(ownedClip); ug.setTransform(dpr, 0, 0, dpr, 0, 0);
      ug.globalCompositeOperation = 'color'; ug.globalAlpha = fill;
      ug.imageSmoothingEnabled = true; ug.drawImage(tintCv, x, y, W * k, H * k); ug.restore();
      ug.globalCompositeOperation = 'source-over'; ug.globalAlpha = 1;
      // Each owner clips its own side of the seam. Wide translucent strokes make the wash fall off
      // inward; their world width grows at far zoom without repacking the colour grid every frame.
      ug.setTransform(dpr * k, 0, 0, dpr * k, dpr * x, dpr * y);
      ug.lineCap = ug.lineJoin = 'round';
      for (let f = 0; f < TERRITORY_PALETTE.length; f++) if (f !== NONE && clipUsed[f]) {
        ug.save(); ug.clip(landClip); ug.clip(ownerClips[f]);
        for (let neutral = 0; neutral < 2; neutral++) {
          const i = f * 2 + neutral; if (!borderUsed[i]) continue;
          const weight = (neutral ? TERRITORY_NEUTRAL_BORDER : 1) * attention;
          ug.globalCompositeOperation = 'color'; ug.strokeStyle = TERRITORY_PALETTE[f];
          for (let r = 0; r < FLAT_RIM_ALPHA.length; r++) {
            ug.lineWidth = 2 * PAN_UNIT * THREE.MathUtils.lerp(TERRITORY_BAND_WORLD[1], TERRITORY_BAND_WORLD[0], z) * FLAT_RIM_WIDTH[r];
            ug.globalAlpha = FLAT_RIM_ALPHA[r] * weight; ug.stroke(borderPaths[i]);
          }
        }
        for (let neutral = 0; neutral < 2; neutral++) {
          const i = f * 2 + neutral; if (!borderUsed[i]) continue;
          const weight = (neutral ? TERRITORY_NEUTRAL_BORDER : 1) * attention;
          ug.globalCompositeOperation = 'source-over'; ug.strokeStyle = FLAT_BORDER_COLORS[f];
          for (let q = 0; q < FLAT_GLOW_WIDTH.length; q++) { ug.lineWidth = FLAT_GLOW_PX * 2 * FLAT_GLOW_WIDTH[q] / k; ug.globalAlpha = FLAT_GLOW_ALPHA[q] * weight; ug.stroke(borderPaths[i]); }
          ug.lineWidth = TERRITORY_BORDER_HALF_PX * 2 / k; ug.globalAlpha = Math.min(1, FLAT_BORDER_ALPHA * (f === tintPlayer ? FLAT_BORDER_MINE : 1) * weight); ug.stroke(borderPaths[i]);
        }
        ug.restore();
      }
      if (clipUsed[NONE]) {
        ug.save(); ug.clip(landClip); ug.clip(ownerClips[NONE]); ug.globalCompositeOperation = 'source-over';
        for (let f = 0; f < TERRITORY_PALETTE.length; f++) if (borderUsed[f * 2 + 1]) {
          const weight = TERRITORY_NEUTRAL_BORDER * attention; ug.strokeStyle = FLAT_BORDER_COLORS[f];
          for (let q = 0; q < FLAT_GLOW_WIDTH.length; q++) { ug.lineWidth = FLAT_GLOW_PX * 2 * FLAT_GLOW_WIDTH[q] / k; ug.globalAlpha = FLAT_GLOW_ALPHA[q] * weight; ug.stroke(borderPaths[f * 2 + 1]); }
          ug.lineWidth = TERRITORY_BORDER_HALF_PX * 2 / k; ug.globalAlpha = FLAT_BORDER_ALPHA * weight; ug.stroke(borderPaths[f * 2 + 1]);
        }
        ug.restore();
      }
      ug.setTransform(dpr, 0, 0, dpr, 0, 0); ug.globalAlpha = 1; ug.globalCompositeOperation = 'source-over';
    }
    // The pictures are baked in clear months: rain's grey light goes over the ground, under what must stay legible, as the 3D map's 'rain' and 'storm' lights do.
    if (wet) { ug.globalCompositeOperation = 'multiply'; ug.fillStyle = `rgb(${255 - 76 * wet}, ${255 - 66 * wet}, ${255 - 56 * wet})`; ug.fillRect(0, 0, vw, vh); ug.globalCompositeOperation = 'source-over'; }
    if (roadsOn) { ug.setTransform(dpr * k, 0, 0, dpr * k, dpr * x, dpr * y); drawRoads(ug); }
  }
  function draw(dt = 0) {
    if (asleep || document.querySelector('.tt')) return; // the title screen is opaque over the whole window: its pan needs viewState, not a picture repainted every frame nobody can see. Gone, the next frame draws, before it is shown.
    const { k, x, y } = viewState();
    paintUnder(k, x, y);
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.drawImage(under, 0, 0);
    if (data.expandedMap) drawAddedSites(k, x, y);
    // Rings and lines in picture px, so they scale with the board; what must stay legible at the whole board is sized in screen px below.
    g.setTransform(dpr * k, 0, 0, dpr * k, dpr * x, dpr * y);
    drawRings();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawFlow(k, x, y);
    drawFlags(k, x, y);
    g.setTransform(dpr * k, 0, 0, dpr * k, dpr * x, dpr * y);
    drawPulses();
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.globalAlpha = 1;
    warShow?.draw(k, x, y);
    if (skyOn) drawSky(k, y, dt);
  }

  // 额外据点和连接原路的短支路随缩放绘制，手机全图时保留可见轮廓。
  function drawAddedSites(k, x, y) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const r of board.roads) if (r.spur) {
      g.save(); g.strokeStyle = '#d8bd8f'; g.globalAlpha = 0.9; g.lineWidth = Math.max(1, 4 * k);
      g.beginPath(); for (let i = 0; i < r.spur.length; i += 2) { const px = r.spur[i] * k + x, py = r.spur[i + 1] * k + y; if (!i) g.moveTo(px, py); else g.lineTo(px, py); }
      g.stroke(); g.restore();
    }
    // 原底图没有新增航线；随底图绘制细虚线，路线概览仍使用完整道路图层。
    for (const r of board.roads) if (r.generated) {
      g.save(); g.strokeStyle = '#c4e5e4'; g.globalAlpha = 0.7; g.lineWidth = Math.max(1, 3 * k); g.setLineDash([Math.max(3, 8 * k), Math.max(3, 7 * k)]);
      g.beginPath(); for (let i = 0; i < r.p.length; i += 2) { const px = r.p[i] * k + x, py = r.p[i + 1] * k + y; if (!i) g.moveTo(px, py); else g.lineTo(px, py); }
      g.stroke(); g.restore();
    }
    for (const c of board.cities) {
      if (!c.added) continue;
      const s = Math.max(k, 0.14), px = c.cx * k + x, py = c.cy * k + y;
      if (px < -30 || px > vw + 30 || py < -30 || py > vh + 30) continue;
      g.save(); g.translate(px, py); g.scale(s, s);
      g.fillStyle = 'rgba(30, 24, 13, .35)'; g.beginPath(); g.ellipse(0, 6, c.rx, c.ry * .62, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#d7cfb3'; g.strokeStyle = '#55462e'; g.lineWidth = 3;
      const w = c.outpost ? 56 : 62, h = c.outpost ? 24 : 36;
      g.fillRect(-w / 2, -h / 2, w, h); g.strokeRect(-w / 2, -h / 2, w, h);
      g.fillStyle = '#756b55'; g.beginPath(); g.moveTo(-w / 2 - 4, -h / 2); g.lineTo(0, -h / 2 - (c.outpost ? 13 : 21)); g.lineTo(w / 2 + 4, -h / 2); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#382b1d'; g.fillRect(-6, 0, 12, h / 2); g.restore();
    }
  }

  // ---- Owners' tint: a transparent colour grid over the existing seasonal pictures; land/sea is stored independently
  // of the old distance falloff, whose zero also covered land far from any city.
  const T = board.tint, TW = T.territory?.w ?? T.w, TH = T.territory?.h ?? T.h;
  let tintCells = null, tintCv, tintG, tintPx;
  function initTint() {
    if (tintCells) return;
    const cells = new Int16Array(TW * TH);
    if (T.territory) {
      const packed = atob(T.territory.city);
      if (T.territory.encoding === 'rle8') {
        let at = 0; if (packed.length % 2) throw new Error('flat territory runs are incomplete');
        for (let i = 0; i < packed.length; i += 2) {
          const value = packed.charCodeAt(i) - 1, length = packed.charCodeAt(i + 1);
          if (!length || at + length > cells.length) throw new Error('flat territory run has the wrong size');
          cells.fill(value, at, at + length); at += length;
        }
        if (at !== cells.length) throw new Error('flat territory grid has the wrong size');
      } else {
        if (packed.length !== cells.length) throw new Error('flat territory grid has the wrong size');
        for (let i = 0; i < cells.length; i++) cells[i] = packed.charCodeAt(i) - 1;
      } // zero is sea/outside; otherwise city id + 1
    } else for (let i = 0; i < cells.length; i++) cells[i] = (T.land ? T.land[i] : T.k[i] > 0) ? T.near[i] : -1; // older cached metadata stays safe at sea
    if (data.expandedMap) {
      const added = board.cities.filter((c) => c.added && !c.outpost);
      for (let i = 0; i < cells.length; i++) {
        if (cells[i] < 0) continue; // 保持原海岸线和水域蒙版
        const px = (i % TW + .5) * W / TW, py = (Math.floor(i / TW) + .5) * H / TH;
        const distance = (c) => (px - c.cx) ** 2 + ((py - c.cy) / DOWN) ** 2;
        let best = distance(cities[cells[i]]);
        for (const c of added) { const next = distance(c); if (next < best) { best = next; cells[i] = c.id; } }
      }
    }
    tintCv = Object.assign(document.createElement('canvas'), { width: TW, height: TH }); tintG = tintCv.getContext('2d'); tintPx = tintG.createImageData(TW, TH); tintCells = cells;
  }
  const tintOwners = new Int16Array(data.cities.length).fill(-1);
  let tintDraws = 0, tintPlayer = -1, borderPaths = null, borderUsed = [], ownerClips = null, landClip = null, ownedClip = null, clipUsed = [];
  function focusTerritory() {
    const on = !!candidates || !!warShow;
    if (on !== territoryFocus) { territoryFocus = on; if (territoryOn) underKey = ''; }
  }
  function paintTint(gs) {
    initTint();
    let changed = tintPlayer !== gs.player;
    for (const c of gs.cities) if (tintOwners[c.id] !== c.faction) changed = true;
    if (!changed) return;
    tintPlayer = gs.player; for (const c of gs.cities) tintOwners[c.id] = c.faction;
    const hues = gs.cities.map((c) => (c.faction === NONE ? null : new THREE.Color(TERRITORY_PALETTE[c.faction]).convertLinearToSRGB())), d = tintPx.data;
    for (let i = 0; i < tintCells.length; i++) {
      const hue = tintCells[i] < 0 ? null : hues[tintCells[i]], p = i * 4;
      d[p] = hue ? hue.r * 255 + 0.5 : 0; d[p + 1] = hue ? hue.g * 255 + 0.5 : 0; d[p + 2] = hue ? hue.b * 255 + 0.5 : 0; d[p + 3] = hue ? 255 : 0;
    }
    // Marching squares connects cell-edge midpoints, softening the coarse picture grid's otherwise square corners.
    borderPaths = TERRITORY_PALETTE.flatMap(() => [new Path2D(), new Path2D()]); borderUsed = borderPaths.map(() => false);
    ownerClips = Array.from({ length: NONE + 1 }, () => new Path2D()); landClip = new Path2D(); ownedClip = new Path2D(); clipUsed = ownerClips.map(() => false);
    const xs = new Float32Array(4), ys = new Float32Array(4), kinds = new Int8Array(4), gx = W / TW, gy = H / TH;
    // Horizontal runs keep the clipping paths small and ensure colour and glow cannot spill onto the sea.
    for (let j = 0; j < TH; j++) for (let i = 0; i < TW;) {
      const city = tintCells[j * TW + i], f = city < 0 ? -1 : tintOwners[city]; let end = i + 1;
      while (end < TW) { const c = tintCells[j * TW + end], next = c < 0 ? -1 : tintOwners[c]; if (next !== f) break; end++; }
      if (f >= 0) landClip.rect(i * gx, j * gy, (end - i) * gx, gy);
      if (f >= 0 && f < NONE) ownedClip.rect(i * gx, j * gy, (end - i) * gx, gy);
      i = end;
    }
    // Clip against the same midpoint contours as the strokes, not square cells: each side keeps its own colour at diagonal borders.
    const ownerAt = (i) => tintCells[i] < 0 ? -1 : tintOwners[tintCells[i]], fx = new Float32Array(4), fy = new Float32Array(4), owners = new Int8Array(4);
    for (let j = 0; j < TH - 1; j++) for (let i = 0; i < TW - 1;) {
      const a = j * TW + i, f = ownerAt(a), b = ownerAt(a + 1), c = ownerAt(a + TW), e = ownerAt(a + TW + 1);
      if (f === b && f === c && f === e) {
        let end = i + 1; while (end < TW - 1) { const n = j * TW + end; if (ownerAt(n) !== f || ownerAt(n + 1) !== f || ownerAt(n + TW) !== f || ownerAt(n + TW + 1) !== f) break; end++; }
        if (f >= 0) { ownerClips[f].rect((i + .5) * gx, (j + .5) * gy, (end - i) * gx, gy); clipUsed[f] = true; }
        i = end; continue;
      }
      owners.set([f, b, e, c]); fx.set([(i + .5) * gx, (i + 1.5) * gx, (i + 1.5) * gx, (i + .5) * gx]); fy.set([(j + .5) * gy, (j + .5) * gy, (j + 1.5) * gy, (j + 1.5) * gy]);
      for (let q = 0; q < 4; q++) {
        const faction = owners[q]; if (faction < 0 || owners.indexOf(faction) !== q) continue;
        const path = ownerClips[faction]; let started = false;
        const point = (x, y) => { if (!started) { path.moveTo(x, y); started = true; } else path.lineTo(x, y); };
        for (let n = 0; n < 4; n++) { const next = (n + 1) % 4, here = owners[n] === faction, there = owners[next] === faction;
          if (here) point(fx[n], fy[n]); if (here !== there) point((fx[n] + fx[next]) / 2, (fy[n] + fy[next]) / 2);
        }
        if (started) { path.closePath(); clipUsed[faction] = true; }
      }
      i++;
    }
    const cross = (a, b, x, y, n) => {
      if (tintCells[a] < 0 || tintCells[b] < 0) return n;
      const fa = tintOwners[tintCells[a]], fb = tintOwners[tintCells[b]];
      if (fa === fb || fa == null || fb == null || fa < 0 || fb < 0) return n;
      xs[n] = x; ys[n] = y; kinds[n] = Math.min(fa, fb) * (NONE + 1) + Math.max(fa, fb);
      return n + 1;
    };
    const segment = (kind, x0, y0, x1, y1) => {
      const a = Math.floor(kind / (NONE + 1)), b = kind % (NONE + 1), neutral = b === NONE ? 1 : 0;
      for (const f of [a, b]) if (f !== NONE) { const i = f * 2 + neutral, p = borderPaths[i]; borderUsed[i] = true; p.moveTo(x0, y0); p.lineTo(x1, y1); }
    };
    for (let j = 0; j < TH - 1; j++) for (let i = 0; i < TW - 1; i++) {
      const a = j * TW + i, b = a + 1, c = a + TW, e = c + 1, x = (i + 0.5) * gx, y = (j + 0.5) * gy;
      let n = 0; n = cross(a, b, x + gx / 2, y, n); n = cross(b, e, x + gx, y + gy / 2, n);
      n = cross(c, e, x + gx / 2, y + gy, n); n = cross(a, c, x, y + gy / 2, n);
      if (n === 2 && kinds[0] === kinds[1]) {
        segment(kinds[0], xs[0], ys[0], xs[1], ys[1]);
      } else if (n > 1) for (let q = 0; q < n; q++) {
        segment(kinds[q], xs[q], ys[q], x + gx / 2, y + gy / 2);
      }
    }
    tintG.putImageData(tintPx, 0, 0); tintDraws++;
  }

  // ---- 道路 overview: one path for all the land and one for the sea, made once; one path, so where two roads meet they do not darken twice.
  let roadPaths = null;
  const insideTown = (c, x, y) => Math.hypot((x - c.cx) / c.rx, (y - c.cy) / c.ry) < CLEAR;
  function makeRoadPaths() {
    const land = new Path2D(), sea = new Path2D();
    for (const r of board.roads) {
      const n = r.sea.length, A = cities[r.a], B = cities[r.b];
      let lastSea = null;
      for (let k = 0; k < n - 1; k++) {
        const [x, y, nx, ny] = [r.p[k * 2], r.p[k * 2 + 1], r.p[k * 2 + 2], r.p[k * 2 + 3]];
        if (insideTown(A, nx, ny) || insideTown(B, x, y)) { lastSea = null; continue; }
        const atSea = r.sea[k] && r.sea[k + 1], path = atSea ? sea : land;
        if (atSea !== lastSea) path.moveTo(x, y);
        path.lineTo(nx, ny); lastSea = atSea;
      }
    }
    roadPaths = { land, sea };
  }
  function drawRoads(g) {
    if (!roadPaths) makeRoadPaths();
    const { land, sea } = roadPaths;
    g.lineJoin = 'round'; g.lineCap = 'round'; g.setLineDash([]);
    g.strokeStyle = '#2a1606'; g.globalAlpha = 0.55; g.lineWidth = ROAD_EDGE; g.stroke(land);
    g.strokeStyle = '#ffd878'; g.globalAlpha = 0.95; g.lineWidth = ROAD; g.stroke(land);
    g.lineCap = 'butt'; g.setLineDash([DASH, DASH]);
    g.strokeStyle = '#2a1606'; g.globalAlpha = 0.5; g.lineWidth = ROAD_EDGE; g.stroke(sea);
    g.strokeStyle = '#e8f4ff'; g.globalAlpha = 0.95; g.lineWidth = ROAD; g.stroke(sea);
    g.setLineDash([]); g.globalAlpha = 1;
  }

  // ---- The selected city's roads: beads spaced as the 3D map's along each road from this city out, a wave running down them (sin(time * 6 - t * 3)). Worked out once per selection.
  let flow = [];
  function makeFlow(cid) {
    flow = [];
    if (cid == null) return;
    for (const r of board.roads) {
      if (r.a !== cid && r.b !== cid) continue;
      const n = r.p.length / 2, at = (k) => (r.a === cid ? k : n - 1 - k) * 2, other = cities[r.a === cid ? r.b : r.a], home = cities[cid];
      let run = 0, next = 0.3;
      for (let k = 1; k < n - 5; k++) {
        const [px, py, x, y] = [r.p[at(k - 1)], r.p[at(k - 1) + 1], r.p[at(k)], r.p[at(k) + 1]];
        run += Math.hypot(x - px, (y - py) / DOWN) / PAN_UNIT;
        if (run < next) continue;
        next += 0.18;
        if (!insideTown(home, x, y) && !insideTown(other, x, y)) flow.push({ x, y, t: run });
      }
    }
  }
  const BEADS = [[0.72, []], [0.82, []], [0.92, []], [1, []]]; // by the wave's height: a handful of fills a frame, not one per bead
  function drawFlow(k, x, y) {
    if (!flow.length) return;
    for (const b of BEADS) b[1].length = 0;
    const r = Math.max(1.5, 5.5 * k), lift = 0.08 * PAN_UNIT * UP * k;
    g.beginPath();
    for (const b of flow) {
      const wave = Math.max(0, Math.sin(time * 6 - b.t * 3)), px = b.x * k + x, py = b.y * k + y - wave * lift, R = r * (1 + 0.4 * wave);
      if (px < -9 || py < -9 || px > vw + 9 || py > vh + 9) continue;
      g.moveTo(px + R + 1, py); g.arc(px, py, R + 1, 0, Math.PI * 2); // a dark edge, or gold on snow and sand is lost
      BEADS[Math.min(3, Math.floor(wave * 4))][1].push(px, py, R);
    }
    g.fillStyle = '#2a1606'; g.globalAlpha = 0.38; g.fill();
    g.fillStyle = '#ffe080';
    for (const [alpha, list] of BEADS) {
      g.beginPath(); g.globalAlpha = alpha;
      for (let i = 0; i < list.length; i += 3) { g.moveTo(list[i] + list[i + 2], list[i + 1]); g.arc(list[i], list[i + 1], list[i + 2], 0, Math.PI * 2); }
      g.fill();
    }
    g.globalAlpha = 1;
  }

  // ---- The rings, at the 3D map's sizes and beat. The picture is brighter than a lit board, snow above all, where a glow alone goes unseen: each lies on a thin dark band.
  let ringAt = null; // what the pointer or a list points at: one ring, as the 3D map's, whichever last spoke
  const band = (c, [a, b], s) => { g.beginPath(); g.ellipse(c.cx, c.cy, c.rx * b * s, c.ry * b * s, 0, 0, Math.PI * 2); g.ellipse(c.cx, c.cy, c.rx * a * s, c.ry * a * s, 0, 0, Math.PI * 2); };
  function ring(c, kind, s, color, alpha, op) {
    const w = RINGS[kind];
    band(c, [w[0] - 0.04, w[1] + 0.04], s); g.fillStyle = '#1c0e04'; g.globalAlpha = 0.3 + alpha * 0.2; g.fill('evenodd');
    band(c, w, s); g.globalCompositeOperation = op; g.fillStyle = color; g.globalAlpha = alpha; g.fill('evenodd');
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  }
  function drawRings() {
    const s4 = Math.sin(time * 4), s5 = Math.sin(time * 5);
    if (ringAt != null) ring(cities[ringAt], 'hover', 1, '#ffe060', 0.6 + s4 * 0.3, 'source-over');
    if (selected != null) ring(cities[selected], 'sel', 1 + s4 * 0.05, '#fff4c0', 0.55 + s4 * 0.3, 'lighter');
    if (candidates) for (const id of candidates) ring(cities[id], 'cand', 1 + 0.08 * (0.5 + 0.5 * s5), '#ffd860', 0.55 + 0.35 * s5, 'lighter');
  }

  // ---- A ring that spreads from a city once (.9 s), as the 3D map's: the same world size wherever it is, so not the city's own.
  const pulses = [];
  const pulse = (cid, color, delay = 0) => { pulses.push({ c: cities[cid], color, t0: time + delay }); };
  function drawPulses() {
    if (!pulses.length) return;
    g.globalCompositeOperation = 'lighter';
    for (const { c, color, t0 } of pulses) {
      const u = (time - t0) / 0.9;
      if (u < 0 || u >= 1) continue;
      const s = (1 + u * 2.2) * PAN_UNIT;
      g.beginPath(); g.ellipse(c.cx, c.cy, 0.5 * s, 0.5 * s * DOWN, 0, 0, Math.PI * 2); g.ellipse(c.cx, c.cy, 0.4 * s, 0.4 * s * DOWN, 0, 0, Math.PI * 2);
      g.fillStyle = color; g.globalAlpha = 1 - u; g.fill('evenodd');
    }
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  }

  // ---- The flags and the rulers' crowns, in the owners' colours. The 3D map's cloth grows as the view pulls back and so does this, down to a size that still reads.
  // Same wave as the 3D cloth (sin(time * 3 + x * 14 + i), its amplitude growing to the fly), folds shaded by its slope.
  const flagColors = data.cities.map((c) => colorOf(c.faction));
  let crowned = [];
  const FOLDS = 6;
  function drawFlags(k, x, y) {
    const w = Math.max(FLAG_MIN, FLAG_W * PAN_UNIT * k), h = w * 0.6, sway = w * 0.1 * DOWN, pole = Math.max(1, 2.6 * k);
    for (const c of board.cities) {
      const px = c.flag[0] * k + x, top = c.flag[1] * k + y, py = top + 1.5; // the pole's tip shows over the cloth
      if (px < -w * 2 || py < -h * 2 || px > vw + w || py > vh + h * 2) continue;
      const lift = (i) => Math.sin(time * 3 + 0.26 * i / FOLDS * 14 + c.id) * sway * i / FOLDS;
      const cloth = () => {
        g.beginPath();
        for (let i = 0; i <= FOLDS; i++) g[i ? 'lineTo' : 'moveTo'](px + w * i / FOLDS, py + lift(i));
        for (let i = FOLDS; i >= 0; i--) g.lineTo(px + w * i / FOLDS, py + h + lift(i));
        g.closePath();
      };
      g.fillStyle = '#2a1a0e'; g.fillRect(px - pole / 2, top, pole, POLE * k); // the picture's own is a hair at the whole board
      cloth(); g.fillStyle = flagColors[c.id]; g.fill();
      for (let i = 0; i < FOLDS; i++) {
        const slope = lift(i + 1) - lift(i), shade = clamp(slope / (sway * 0.4 || 1), -1, 1) * 0.22;
        if (Math.abs(shade) < 0.02) continue;
        const [xa, xb] = [px + w * i / FOLDS, px + w * (i + 1) / FOLDS], [ya, yb] = [py + lift(i), py + lift(i + 1)];
        g.fillStyle = shade > 0 ? `rgba(0,0,0,${shade})` : `rgba(255,255,255,${-shade})`;
        g.beginPath(); g.moveTo(xa, ya); g.lineTo(xb, yb); g.lineTo(xb, yb + h); g.lineTo(xa, ya + h); g.closePath(); g.fill();
      }
      cloth(); g.strokeStyle = 'rgba(26,14,6,.8)'; g.lineWidth = 1; g.lineJoin = 'round'; g.stroke();
    }
    const R = Math.max(4, 0.09 * PAN_UNIT * k);
    for (const id of crowned) {
      const c = cities[id], px = c.tag[0] * k + x, py = (c.tag[1] + 0.13 * PAN_UNIT * UP) * k + y; // just under its tag, as in 3D
      g.beginPath(); g.moveTo(px, py - R * 1.25); g.lineTo(px + R, py); g.lineTo(px, py + R * 1.25); g.lineTo(px - R, py); g.closePath();
      g.fillStyle = '#ffe680'; g.fill(); g.strokeStyle = 'rgba(40,22,6,.85)'; g.lineWidth = 1; g.stroke();
    }
  }

  // ---- A war between two AI factions, in the 3D map's three beats and at its timing (createStrategy's aiWar, driven by app.js): the attacker's standard goes down the road from his
  // city, the two clash before the walls with the view closing in, the loser's falls and a winning attacker rides in. Each cloth is painted at its size on screen, and each standard
  // is put together on one scratch canvas and laid down whole, so a fade or a topple shows no seams. Nothing here is made per frame: the dust is a pool, the canvases stay.
  let warShow = null;
  const dust = Array.from({ length: 64 }, () => ({ life: 0, t: 0, x: 0, y: 0, size: 0, vy: 0, o: 0, spark: false }));
  let puffs = null, scratch = null, sg = null;
  const puffOf = (col) => {
    const c = Object.assign(document.createElement('canvas'), { width: 64, height: 64 }), p = c.getContext('2d'), grd = p.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, col); grd.addColorStop(0.45, `${col}99`); grd.addColorStop(1, `${col}00`);
    p.fillStyle = grd; p.fillRect(0, 0, 64, 64);
    return c;
  };
  const kick = (px, py, { n = 1, spread = 0.12, size = 0.32, life = 0.9, spark = false } = {}) => {
    puffs ??= { dust: puffOf('#d8c8a2'), spark: puffOf('#ffc070') };
    for (let i = 0, j = 0; i < n; i++) {
      while (j < dust.length && dust[j].t < dust[j].life) j++;
      if (j === dust.length) return;
      Object.assign(dust[j], { t: 0, life, size, spark, x: px + (Math.random() - 0.5) * spread * PAN_UNIT, y: py + (Math.random() - 0.5) * spread * PAN_UNIT * DOWN, vy: 0.12 + Math.random() * 0.1, o: spark ? 1 : 0.6 });
    }
  };
  const liveDust = () => dust.reduce((n, d) => n + (d.t < d.life), 0);
  function drawDust(k, x, y) {
    for (const d of dust) {
      if (d.t >= d.life) continue;
      const u = d.t / d.life, w = d.size * PAN_UNIT * k * (0.6 + u * 0.9);
      g.globalCompositeOperation = d.spark ? 'lighter' : 'source-over'; g.globalAlpha = d.o * (1 - u);
      g.drawImage(d.spark ? puffs.spark : puffs.dust, d.x * k + x - w / 2, d.y * k + y - w / 2, w, w);
    }
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  }
  const clothWidth = (k) => Math.round(Math.max(CLOTH_MIN, CLOTH_WORLD * PAN_UNIT * k));
  function standard(f, nm) {
    const col = colorOf(f), sur = surnameOf(nm), cv = document.createElement('canvas'), cg = cv.getContext('2d');
    const S = {
      col, x: 0, y: 0, alpha: 1, shown: true, lean: 0, lift: 0, fallDir: 1, sized: 0,
      cloth(w) { // at its size on screen, so the brush strokes are the screen's and not a shrunken picture's
        if (S.sized === w * dpr) return cv;
        S.sized = w * dpr; cv.width = Math.ceil(w * dpr); cv.height = Math.ceil(w * 4 / 3 * dpr);
        cg.setTransform(cv.width / 96, 0, 0, cv.height / 128, 0, 0); paintBanner(cg, col, sur);
        return cv;
      },
      dispose() { cv.width = cv.height = 0; },
    };
    S.cloth(clothWidth(viewState().k));
    document.fonts?.load('52px "Ma Shan Zheng"', sur).then(() => { S.sized = 0; }).catch(() => {}); // the brush face may still be loading
    return S;
  }
  const COLS = 8;
  function drawStandard(S, k, x, y, w) {
    const u = w / CLOTH, sc = dpr, ox = Math.ceil(0.2 * u * sc), oy = Math.ceil(0.98 * u * sc), sw = ox + Math.ceil(0.5 * u * sc), sh = oy + Math.ceil(0.04 * u * sc);
    if (!scratch) { scratch = document.createElement('canvas'); sg = scratch.getContext('2d'); }
    if (scratch.width < sw || scratch.height < sh) { scratch.width = Math.max(scratch.width, sw); scratch.height = Math.max(scratch.height, sh); }
    sg.setTransform(1, 0, 0, 1, 0, 0); sg.clearRect(0, 0, sw, sh);
    sg.setTransform(sc, 0, 0, sc, ox, oy); // the base's middle at the origin, up is negative, in CSS px
    const Y = (h) => -h * u * PRESS, X = (m) => m * u, wave = (m, i) => Math.sin(time * 6 + m * 18 + i) * 0.12 * m * u * DOWN;
    // Two pennants behind, then the block, its gold trim, the pole and its finial, then the cloth: as the 3D model, back to front.
    const line = Math.max(1.25, 0.028 * u);
    for (const [i, m, foot] of [[1, 0.1, 0.1], [2, 0.15, 0.13]]) {
      const top = Y(0.69) - foot * u * 0.2, tip = wave(0.26, i);
      sg.fillStyle = '#3a2818'; sg.fillRect(X(m) - line * 0.3, top, line * 0.6, -foot * u - top);
      sg.beginPath(); sg.moveTo(X(m), top); sg.lineTo(X(m), top + 0.16 * u * PRESS); sg.lineTo(X(m + 0.26), top + 0.08 * u * PRESS + tip); sg.closePath();
      sg.fillStyle = S.col; sg.fill(); sg.strokeStyle = 'rgba(26,14,6,.7)'; sg.lineWidth = 0.75; sg.stroke();
    }
    const bw = X(0.3), top = 0.09 * u, front = 0.06 * u, sill = -front - top;
    sg.fillStyle = S.col; sg.fillRect(-bw / 2, sill, bw, top); sg.fillStyle = 'rgba(255,255,255,.18)'; sg.fillRect(-bw / 2, sill, bw, top); // the top, catching the light
    sg.fillStyle = S.col; sg.fillRect(-bw / 2, -front, bw, front); sg.fillStyle = 'rgba(0,0,0,.28)'; sg.fillRect(-bw / 2, -front, bw, front);
    sg.fillStyle = '#d8b060'; sg.fillRect(-bw / 2 - 0.5, -front - 0.75, bw + 1, 1.5);
    sg.strokeStyle = 'rgba(26,14,6,.75)'; sg.lineWidth = 0.75; sg.strokeRect(-bw / 2, sill, bw, top + front);
    const poleX = X(-0.1), head = Y(1.08);
    sg.fillStyle = '#3a2818'; sg.fillRect(poleX - line / 2, head, line, -top * 0.5 - front - head);
    sg.fillStyle = '#e8c878'; sg.beginPath(); sg.moveTo(poleX, head - 0.08 * u); sg.lineTo(poleX + line * 1.3, head); sg.lineTo(poleX - line * 1.3, head); sg.closePath(); sg.fill();
    sg.strokeStyle = 'rgba(26,14,6,.7)'; sg.lineWidth = 0.5; sg.stroke();
    const cv = S.cloth(w), h = w * 4 / 3, x0 = X(-0.086), y0 = Y(1.06), cw = w / COLS, lift = (i) => wave(CLOTH * i / COLS, 0);
    for (let i = 0; i < COLS; i++) {
      const a = lift(i), slope = (lift(i + 1) - a) / cw, shade = clamp((lift(i + 1) - a) / (0.012 * u), -1, 1) * 0.16;
      sg.setTransform(sc, slope * sc, 0, sc, ox + (x0 + cw * i) * sc, oy + (y0 + a) * sc);
      sg.drawImage(cv, cv.width * i / COLS, 0, cv.width / COLS, cv.height, 0, 0, cw + (i < COLS - 1 ? 0.6 : 0), h); // a hair over the next, or the joins show
      if (Math.abs(shade) > 0.02) { sg.fillStyle = shade > 0 ? `rgba(0,0,0,${shade})` : `rgba(255,255,255,${-shade})`; sg.fillRect(0, 0, cw, h); }
    }
    sg.setTransform(sc, 0, 0, sc, ox, oy); sg.beginPath();
    for (let i = 0; i <= COLS; i++) sg[i ? 'lineTo' : 'moveTo'](x0 + cw * i, y0 + lift(i));
    for (let i = COLS; i >= 0; i--) sg.lineTo(x0 + cw * i, y0 + h + lift(i));
    sg.closePath(); sg.strokeStyle = 'rgba(26,14,6,.75)'; sg.lineWidth = 1; sg.lineJoin = 'round'; sg.stroke();
    // Its shadow stays on the ground; the rest is laid down whole, on the pixel grid while upright, and leans or falls about its base.
    const px = S.x * k + x, py = S.y * k + y;
    g.globalAlpha = 0.32 * S.alpha; g.fillStyle = '#000'; g.beginPath(); g.ellipse(px, py, 0.26 * u, 0.26 * u * 0.55, 0, 0, Math.PI * 2); g.fill();
    g.save(); g.globalAlpha = S.alpha;
    g.translate(Math.round(px * dpr) / dpr, Math.round((py - S.lift * u) * dpr) / dpr); if (S.lean) g.rotate(S.lean);
    g.drawImage(scratch, 0, 0, sw, sh, -ox / dpr, -oy / dpr, sw / dpr, sh / dpr);
    g.restore();
  }
  function aiWar({ from, to, att, def, attName, defName }) {
    warShow?.dispose();
    const end = cities[to];
    // The road from his city as the board draws it; without one, a straight approach from the south-west.
    const road = from != null && from !== to ? board.roads.find((r) => (r.a === from && r.b === to) || (r.a === to && r.b === from)) : null;
    let pts, sea = null;
    if (road) { pts = road.p; sea = road.sea; if (road.a !== from) { pts = []; for (let i = road.p.length - 2; i >= 0; i -= 2) pts.push(road.p[i], road.p[i + 1]); sea = [...road.sea].reverse(); } }
    else {
      const [sx, sy] = [end.cx - 2.4 * PAN_UNIT, end.cy + 1.4 * PAN_UNIT * DOWN]; pts = [];
      for (let i = 0; i <= 24; i++) pts.push(sx + (end.cx - sx) * i / 24, sy + (end.cy - sy) * i / 24);
    }
    const runs = [0]; for (let i = 1; i < pts.length / 2; i++) runs.push(runs[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], (pts[i * 2 + 1] - pts[i * 2 - 1]) / DOWN) / PAN_UNIT);
    const L = runs.at(-1);
    let atX = 0, atY = 0, atSea = false;
    const at = (d) => {
      d = clamp(d, 0, L);
      let i = 1; while (i < runs.length - 1 && runs[i] < d) i++;
      const u = (d - runs[i - 1]) / ((runs[i] - runs[i - 1]) || 1);
      atX = pts[i * 2 - 2] + (pts[i * 2] - pts[i * 2 - 2]) * u; atY = pts[i * 2 - 1] + (pts[i * 2 + 1] - pts[i * 2 - 1]) * u; atSea = !!sea && !!sea[i];
    };
    const A = standard(att, attName), D = standard(def, defName);
    const place = (S, d) => { at(d); S.x = atX; S.y = atY; S.d = d; };
    // The 3D map's stand-offs, the attacker's opened out so that the two cloths stand side by side at the close-up's zoom. Fixed, or he would jump as the view closes in.
    const kNear = kMin * Z_MAX, holdD = () => Math.max(0, L - 1.05 * WAR), stopA = () => Math.max(0, L - 1.05 * WAR - Math.max(1.05 * WAR, clothWidth(kNear) * 1.5 / (PAN_UNIT * kNear)));
    D.shown = false; A.alpha = 0; place(A, stopA()); const ax = A.x; place(A, 0); place(D, holdD());
    const side = Math.sign(D.x - ax) || 1; // which way the two face, held for the show: a road running north and south would flicker
    let stage = null, t = 0, len = 1, nextDust = 0, attWins = false, midX = 0, midY = 0, rideFrom = 0;
    // The view the show gives back: what the player had, kept up with any move of his since the show last moved it. Zoom and place are his separately.
    let home = null, mine = null;
    const ownMoves = () => {
      home ??= { ...goal }; mine ??= goal;
      if (goal.z !== mine.z) home.z = goal.z;
      if (goal.cx !== mine.cx || goal.cy !== mine.cy) { home.cx = goal.cx; home.cy = goal.cy; }
    };
    const show = warShow = {
      march(ms) {
        stage = 'march'; t = 0; len = ms / 1000; ownMoves();
        if (from != null && from !== to) frame([from, to]); else focusCity(to);
        mine = { ...goal };
      },
      clash(ms) {
        // nextDust: the march's clock would hold the first blow back to the clash's last moment.
        stage = 'clash'; t = 0; len = ms / 1000; nextDust = 0; ownMoves(); place(A, stopA()); A.alpha = 1; D.shown = true; D.alpha = 0;
        // Closer in, on the ground between the two standards with the walls behind, as the 3D map's; a player's own view comes back after (dispose).
        at((stopA() + L) / 2); goal.z = Z_MAX; goal.cx = atX; goal.cy = atY - 0.35 * clothWidth(kNear) / CLOTH / kNear;
        mine = { ...goal };
      },
      end(wins, ms) {
        stage = 'end'; t = 0; len = ms / 1000; attWins = wins; A.alpha = D.alpha = 1; D.shown = true; A.lean = D.lean = 0;
        (wins ? D : A).fallDir = wins ? side : -side; rideFrom = A.d; // from wherever his last lunge has him: back to his mark first would be a jump
      },
      tick(dt) {
        t += dt;
        for (const d of dust) if (d.t < d.life) { d.t += dt; d.y -= d.vy * dt * PAN_UNIT * UP; }
        if (stage === 'march') {
          // Rises at his city, then down the road at an even pace with a little stride, dust at its heels (none on a sea lane).
          A.alpha = Math.min(1, t / 0.3);
          const e = clamp((t - 0.2) / Math.max(0.1, len * 0.88 - 0.2), 0, 1), d = stopA() * (e * e * (3 - 2 * e) * 0.35 + e * 0.65);
          place(A, d); A.lift = Math.abs(Math.sin(t * 9)) * 0.03 * (e > 0 && e < 1);
          if (e > 0 && e < 1 && t >= nextDust) { if (!atSea) kick(A.x, A.y, { size: 0.7 * WAR, spread: 0.3 * WAR }); nextDust = t + 0.09; }
        } else if (stage === 'clash') {
          // The defender's standard stands up before his walls; the two lunge at each other in turn, dust and sparks flying between them, rings of both colours off the fight.
          D.alpha = Math.min(1, t / 0.25); A.lift = 0;
          const beat = (t * 2.6) % 1, a = Math.max(0, Math.sin(beat * Math.PI * 2)), b = Math.max(0, -Math.sin(beat * Math.PI * 2));
          place(A, stopA() + 0.3 * a); place(D, holdD() - 0.3 * b);
          A.lean = 0.12 * a * side; D.lean = -0.12 * b * side;
          midX = (A.x + D.x) / 2; midY = (A.y + D.y) / 2;
          if (t >= nextDust) {
            kick(midX, midY, { n: 4, spread: 0.7 * WAR, size: WAR, life: 0.8 }); kick(midX, midY, { n: 3, spread: 0.5 * WAR, size: 0.4 * WAR, life: 0.3, spark: true });
            nextDust = t + 0.36;
            pulses.push({ c: { cx: midX, cy: midY }, color: colorOf(Math.floor(t / 0.36) % 2 ? def : att), t0: time });
          }
        } else if (stage === 'end') {
          // The loser's standard topples away from the winner and fades; a winning attacker rides into the city.
          const loser = attWins ? D : A, winner = attWins ? A : D, f = Math.min(1, t / 0.55);
          loser.lean = loser.fallDir * (Math.PI / 2) * f * f; loser.alpha = 1 - clamp((t - 0.45) / 0.6, 0, 1);
          if (t < 0.1) kick(loser.x, loser.y, { n: 2, spread: 0.6 * WAR, size: 0.9 * WAR });
          winner.lean = 0;
          if (attWins) { const e = Math.min(1, t / 0.9); place(A, rideFrom + (L - rideFrom) * e * (2 - e)); }
          winner.lift = 0.05 * Math.max(0, Math.sin(Math.min(1, t / 0.5) * Math.PI));
          winner.alpha = t > len - 0.35 ? Math.max(0, (len - t) / 0.35) : 1;
        }
      },
      draw(k, x, y) {
        // On a road running up the picture one cloth would hide the other: the two step aside as the defender stands up, just far enough to show both surnames.
        const w = clothWidth(k), aside = D.shown ? Math.max(0, w * 1.15 - Math.abs(A.x - D.x) * k) / 2 * (stage === 'clash' ? Math.min(1, t / 0.25) : 1) * side : 0;
        for (const S of A.y <= D.y ? [A, D] : [D, A]) if (S.shown && S.alpha > 0) drawStandard(S, k, x + (S === A ? -aside : aside), y, w); // the south, nearer the eye, over the north
        drawDust(k, x, y);
      },
      dispose() {
        if (warShow !== show) return;
        warShow = null; focusTerritory();
        for (const d of dust) d.t = d.life = 0;
        A.dispose(); D.dispose();
        // The show closed in on its own account: the player gets his view back, with whatever he changed himself.
        if (home) { ownMoves(); Object.assign(goal, home); }
      },
      fightAt: () => (stage === 'clash' ? to : null),
      debug() { const of = (S) => ({ x: S.x, y: S.y, alpha: S.alpha, lean: S.lean, shown: S.shown }); return { stage, a: of(A), d: of(D), dust: liveDust(), cloth: clothWidth(viewState().k) }; },
    };
    focusTerritory(); return show;
  }

  // ---- The month's weather, on the 3D map's rule by place: snow north of the snow line and blossom south of the 黄河. The 3D map asks that of the middle of its view; this one can
  // show both ends of the country at once, so the two fall only over their own rows, fading across the same bands, on a layer of their own that a gradient masks. Rain and leaves fall everywhere.
  const sky = createSky2d(), bounded = createSky2d(); // bounded: its own, so the storm's flash is never drawn twice
  const skyMain = { rain: 0, fall: 0, thunder: 0 }, skySnow = { snowfall: 0 }, skyPetals = { petals: 0 };
  let skyOn = true, skyCv = null, skyG = null; // skyOn: tests that read the picture's pixels turn it off (debugSky)
  // Each kind's band in picture rows: full at `from`, nothing at `to`.
  const bandOf = (kind) => (kind === 'snowfall' ? [ROW(U.uSnowLat.value - 0.5), ROW(U.uSnowLat.value - 2.5)] : [ROW(37.5), ROW(40)]);
  function drawBounded(levels, kind, k, y, opts) {
    const [from, to] = bandOf(kind), a = from * k + y, b = to * k + y;
    const fadesSouth = to > from, gone = fadesSouth ? b <= 0 : b >= vh, whole = fadesSouth ? a >= vh : a <= 0; // the band off the window on one side or the other: nothing to mask
    if (gone) return;
    if (whole) { bounded.draw(g, levels, opts); return; }
    if (!skyCv) { skyCv = document.createElement('canvas'); skyG = skyCv.getContext('2d'); }
    if (skyCv.width !== cv.width || skyCv.height !== cv.height) { skyCv.width = cv.width; skyCv.height = cv.height; }
    skyG.setTransform(dpr, 0, 0, dpr, 0, 0); skyG.globalCompositeOperation = 'source-over'; skyG.clearRect(0, 0, vw, vh);
    bounded.draw(skyG, levels, opts);
    const mask = skyG.createLinearGradient(0, a, 0, b); mask.addColorStop(0, '#000'); mask.addColorStop(1, '#0000');
    skyG.globalCompositeOperation = 'destination-in'; skyG.fillStyle = mask; skyG.fillRect(0, 0, vw, vh);
    g.drawImage(skyCv, 0, 0, vw, vh);
  }
  function drawSky(k, y, dt) {
    const cur = season.cur, opts = { width: vw, height: vh, cell: SKY_CELL, time, dt };
    skyMain.rain = cur.rain; skyMain.fall = cur.fall; skyMain.thunder = cur.thunder;
    sky.draw(g, skyMain, opts);
    if (cur.snowfall > 0.001) { skySnow.snowfall = cur.snowfall; drawBounded(skySnow, 'snowfall', k, y, opts); }
    if (cur.petals > 0.001) { skyPetals.petals = cur.petals; drawBounded(skyPetals, 'petals', k, y, opts); }
  }

  // ---- The month drives the shared uniforms too: 白兵 and 单挑 read them whichever map is up.
  const season = createSeasons(start);
  let time = 0, showing = Promise.resolve();
  function setSeason(m, instant = false) {
    season.setMonth(m, instant ? 0 : FADE);
    if (asleep) { want = seasonOf(m); ctx.onSeason?.(m, instant); return; } // ready() shows it
    // A picture not up yet is on its way, or has failed: that gets another go at the next season, not on every refresh.
    const s = seasonOf(m);
    if (s !== want || (instant && layers.at(-1)?.s === s)) showing = show(s, instant);
    else if (instant && flying === s) snap = true; // on its way: it lands without a fade
    ctx.onSeason?.(m, instant);
  }

  // ---- The tags, as the 3D map's: a click selects the city, pointing lights it (T14).
  let selected = null, hovered = null, candidates = null, roadsOn = false, measured = false;
  function hoverCity(cid) {
    if (hovered === cid) return;
    if (hovered != null) marks[hovered].el.classList.remove('hov');
    hovered = ringAt = cid;
    if (cid != null) marks[cid].el.classList.add('hov');
  }
  const marks = data.cities.map((c) => {
    const el = document.createElement('div'); el.className = 'ctag'; el.style.setProperty('--c', colorOf(c.faction));
    const box = document.createElement('div'); box.className = 'cwrap'; box.append(el);
    Object.assign(box.style, { position: 'absolute', left: 0, top: 0, userSelect: 'none', zIndex: Math.round(cities[c.id].cy) }); // the south, nearer the eye, over the north
    el.addEventListener('click', (e) => { e.stopPropagation(); ctx.onCity(c.id); });
    el.addEventListener('pointerenter', () => hoverCity(c.id)); el.addEventListener('pointerleave', () => hoverCity(null));
    layer.append(box);
    return { el, box, dy: 0, w: 0, h: 0, far: null };
  });
  function refresh(gs, officerCount = (c) => c.officers.length) {
    setSeason(gs.month);
    territoryGame = gs; if (territoryOn) paintTint(gs);
    crowned = gs.cities.filter((c) => gs.factions.some((f) => f.ruler != null && f.city === c.id && c.officers.includes(f.ruler))).map((c) => c.id);
    for (const c of gs.cities) {
      const m = marks[c.id];
      m.el.classList.toggle('pass', data.cities[c.id].kind === 'pass');
      flagColors[c.id] = colorOf(c.faction);
      m.el.style.setProperty('--c', flagColors[c.id]);
      m.el.classList.toggle('mine', c.faction === gs.player);
      const n = officerCount(c);
      m.el.innerHTML = `${cityName(c.id)}<small>${factionName(gs, c.faction)}${n ? `·${n}将` : ''}</small>`;
    }
    measured = false;
  }
  // The tags thin to names at the whole board, as the 3D map's do pulled back, and grow with the zoom.
  const FULL_FORM_Z = 1.4, tagScale = () => clamp(0.82 + (view.z - 1) * 0.24, 0.72, 1.06);
  function placeTags(dt) {
    if (!measured) measured = measureTags(marks);
    const { k, x, y } = viewState(), s = tagScale(), entries = [];
    for (const [i, m] of marks.entries()) {
      const c = cities[i], keep = roadsOn || i === selected || m.el.classList.contains('mine') || m.el.classList.contains('hl') || !!candidates?.has(i);
      const px = Math.round(c.tag[0] * k + x), py = Math.round(c.tag[1] * k + y);
      m.box.style.transform = `translate(-50%, -100%) translate(${px}px, ${py}px)`; // it stands on its anchor: on this flat view, centred there, it would hide the town
      m.el.style.setProperty('--s', s.toFixed(3)); m.el.style.setProperty('--o', warShow?.fightAt() === i ? '0.3' : '1'); // the fight's own city's tag gives way to the standards rising behind it
      const far = view.z < FULL_FORM_Z && !keep;
      if (m.far !== far) { m.far = far; m.el.classList.toggle('far', far); measured = false; }
      const up = m.h * s / 2;
      entries.push({ m, s, d: -c.cy, keep, x: px, y0: py - up, foot: up }); // no depth here: the south first, its northern neighbours step up, as the 3D map's nearest first does
    }
    layoutTags(entries, { dt, spread: data.expandedMap, bounds: { left: 0, right: vw, top: 44, bottom: vh } });
  }

  // The city at a screen point: on its model or its ring, the nearest of those, and during a map pick a candidate first.
  const MIN_REACH = 12;
  const pick = (ndc) => {
    const { k, x, y } = viewState(), px = (ndc.x + 1) / 2 * vw, py = (1 - ndc.y) / 2 * vh;
    let best = null, bestD = Infinity;
    for (const c of board.cities) {
      const rx = Math.max(c.rx * k, MIN_REACH), top = Math.min(c.flag[1], c.tag[1]) * k + y, bot = (c.cy + c.ry) * k + y, h = Math.max((bot - top) / 2, MIN_REACH);
      const dx = (px - (c.cx * k + x)) / rx, dy = (py - (top + bot) / 2) / h;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) continue;
      const d = Math.hypot(px - (c.cx * k + x), py - (c.cy * k + y)) - (candidates?.has(c.id) ? 1e6 : 0);
      if (d < bestD) { best = c; bestD = d; }
    }
    return best && data.cities[best.id];
  };

  // Under the 3D map this holds nothing it can make again: at 2560×1440 at a pixel ratio of 2 the three canvases are about 59 MB each and each picture about 44 MB.
  // The board's data, the tint and the road paths stay; so does the view, which layout() holds to the window on the way back.
  function release() {
    if (asleep) return;
    asleep = true;
    cv.width = cv.height = under.width = under.height = 0;
    if (skyCv) skyCv.width = skyCv.height = 0;
    for (const p of pics.values()) p.close();
    pics.clear(); layers = []; trying = flying = null; snap = false; underKey = '';
  }
  // The month's picture is in and painted when this lands; the other map stays up until then. Pictures on their way when it was released are dropped as they land.
  function wake() {
    asleep = false; layout(); measured = false; table.copy(tableTo[want]);
    showing = show(want, true).then(() => { draw(); });
  }

  const api = {
    flat: true, // no 3D frame (app.js); the flat war's HUD is another matter (flatHud)
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), // post.setView and resize() read them
    refresh, setSeason,
    ready() { if (asleep) wake(); return showing; }, // the month's picture has landed, or could not
    release,
    get up() { return !asleep && layers.length > 0; }, // there is a picture to show this very frame
    get month() { return season.month; },
    get currentSeason() { return SEASONS[seasonOf(season.month)]; },
    aiWar,
    select(cid) { selected = cid; makeFlow(cid); },
    pulse(cid, color) { pulse(cid, color); },
    // A city's news (an AI war's outcome): three rings in the given colour and a badge over its tag for ms.
    announce(cid, text, color, ms) {
      for (const d of [0, 0.45, 0.9]) pulse(cid, color, d);
      const el = marks[cid].el; clearTimeout(el.newsT);
      el.dataset.news = text; el.style.setProperty('--news', color); el.classList.add('news');
      el.newsT = setTimeout(() => el.classList.remove('news'), ms);
    },
    highlight(cid) { ringAt = cid; marks.forEach((m, i) => m.el.classList.toggle('hl', i === cid)); },
    focusCity,
    // As the 3D map's (src/strategy.js): the player's own zoom, given back over a city after the AI turns.
    pose: () => ({ kind: 'flat', z: goal.z }),
    returnTo(cid, p) {
      if (p?.kind === 'flat') goal.z = p.z;
      if (cities[cid]) focusCity(cid);
    },
    pickMode(cids, from = null) {
      candidates = cids ? new Set(cids) : null;
      marks.forEach((m, i) => { m.el.classList.toggle('cand', !!candidates?.has(i)); m.el.classList.toggle('dim', !!candidates && !candidates.has(i) && i !== from); });
      focusTerritory();
    },
    frame,
    // 镜头复位: back to the whole board; the selected city, else `fallback`, stays the wish for the next zoom.
    resetView(fallback) {
      goal.z = zHome();
      const c = selected ?? fallback;
      if (cities[c]) focusCity(c); else { goal.cx = (B.x0 + B.x1) / 2; goal.cy = (B.y0 + B.y1) / 2; }
    },
    update(dt) {
      time += dt; season.update(dt, time); settleDrift();
      const ez = 1 - Math.exp(-dt * 8), ep = 1 - Math.exp(-dt * 5), to = held(goal);
      // Ease, then land: a picture creeping by a fraction of a pixel shimmers.
      const near = (v, t, e, tiny) => (Math.abs(t - v) < tiny ? t : v + (t - v) * e);
      view.z = near(view.z, goal.z, ez, 2e-4); view.cx = near(view.cx, to.cx, ep, 0.2); view.cy = near(view.cy, to.cy, ep, 0.2); hold();
      table.lerp(tableTo[seasonOf(season.month)], 1 - Math.exp(-dt * 1.6));
      for (const l of layers) l.t = Math.min(1, l.t + dt / FADE);
      if (layers.at(-1)?.t >= 1 && layers.length > 1) { layers = [layers.at(-1)]; prune(); } // the top has fully covered what was under it
      for (let i = pulses.length - 1; i >= 0; i--) if (time - pulses[i].t0 >= 0.9) pulses.splice(i, 1);
      warShow?.tick(dt);
      if (document.hidden) return;
      draw(Math.min(0.05, dt)); placeTags(dt);
    },
    hover(ndc) { const c = pick(ndc); hoverCity(c ? c.id : null); return c; },
    hoverId(cid) { hoverCity(cid); return cid == null ? null : data.cities[cid]; }, // the gamepad's cursor (app.js)
    click(ndc) { const c = pick(ndc); ctx.onCity(c ? c.id : null); },
    roads(on) { roadsOn = on; },
    get roadsOn() { return roadsOn; },
    territory(on) { on = !!on; if (territoryOn === on) return; territoryOn = on; if (on && territoryGame) paintTint(territoryGame); underKey = ''; },
    get territoryOn() { return territoryOn; },
    orbit: wander, rotate() {}, // no turning a picture: orbit is the title's pan
    // A left drag (app.js): the map follows the pointer at once.
    slide(dx, dy) { const k = kMin * view.z; view.cx -= dx / k; view.cy -= dy / k; shift(-dx / k, -dy / k); },
    // The wheel, about the spot under the pointer when it is given.
    zoom(d, at) {
      const z = clamp(goal.z * Math.exp(-d * 0.001), 1, Z_MAX);
      if (at) {
        const c = held(goal), ox = (at.x + 1) / 2 * vw - vw / 2, oy = (1 - at.y) / 2 * vh - vh / 2, k0 = kMin * goal.z, k1 = kMin * z;
        goal.cx = c.cx + ox / k0 - ox / k1; goal.cy = c.cy + oy / k0 - oy / k1;
      }
      goal.z = z;
    },
    pan(dx, dz) { shift(dx * PAN_UNIT, dz * PAN_UNIT); },
    focusPoint: () => FOCUS, // the frame loop stops before it asks (mode.flat)
    dof() {},
    // A city's centre on screen, in CSS px (tests and tools click the map as a player would).
    screenOfCity(id) { const { k, x, y } = viewState(); return { x: cities[id].cx * k + x, y: cities[id].cy * k + y }; },
    // As the 3D map's: where a city will be once the view settles, and the least slide that moves it (sx, sy) px from there (D53).
    tagOf: (id) => marks[id]?.el,
    screenAtRest(id) { const k = kMin * goal.z, c = held(goal); return { x: (cities[id].cx - c.cx) * k + vw / 2, y: (cities[id].cy - c.cy) * k + vh / 2 }; },
    nudge(id, sx, sy) { const k = kMin * goal.z; shift(-sx / k, -sy / k); },
    viewState,
    debugSky(on) { skyOn = on; },
    debugUnder: () => under,
    flatDebug: () => ({
      layers: layers.map((l) => SEASONS[l.s]), held: [...pics.keys()].map((s) => SEASONS[s]),
      sizes: { cv: [cv.width, cv.height], under: [under.width, under.height], sky: [skyCv?.width ?? 0, skyCv?.height ?? 0] },
      hover: hovered, selected, candidates: [...(candidates ?? [])], roadsOn, territoryOn, flowCount: flow.length, flow: flow.map((b) => ({ ...b })), flagColors: [...flagColors], crowned: [...crowned], tintDraws, underPaints, pulses: pulses.length,
      weather: Object.fromEntries(['rain', 'snowfall', 'petals', 'fall', 'thunder'].map((n) => [n, season.cur[n]])), skyBands: { snowfall: bandOf('snowfall'), petals: bandOf('petals') }, aiWar: warShow?.debug() ?? null, dust: liveDust(),
    }),
  };

  // A zoom about the pointer soon brings a tag under it: the wheel must not die there.
  wrap.addEventListener('wheel', (e) => { e.preventDefault(); api.zoom(e.deltaY, { x: e.clientX / vw * 2 - 1, y: 1 - e.clientY / vh * 2 }); }, { passive: false });
  layout(); addEventListener('resize', layout);
  await show(want, true); // what setSeason(start, true) would start, waited for
  setSeason(start, true);
  draw();
  return api;
}
