// The 白兵 field's painted look (A2, as the war map): the ground is baked once per battle onto one canvas from
// the war map's painted materials (assets/ai/warground, GPT image against the approved concept), laid where each
// board class lies with its edge broken by noise so terrains meet like paint; the month's grass and snow on top,
// a faint grid on the 16×10 board, and the shadows of woods and knolls painted in. The relief is one smooth
// heightfield: rock cells rise as rounded knolls whose steep flanks show the painted cliff band, water cells
// sink into pools under a painted water plane, the country climbs gently away behind the board and stays low
// in front of it (N09: nothing between the camera and the front row). Fortress walls (城战) are solid blocks
// faced with a painted crenellated wall (tools/gen_tactical_codex.sh); woods are painted crowns on quads.
import * as THREE from 'three';
import { siteOfCity } from './china.js';
import { plateKey } from './seasonenv.js';
import { vnoise } from './diorama.js';

const WG = 'assets/ai/warground/', TG = 'assets/ai/tactical/';
const cache = new Map();
const image = (url) => cache.get(url) ?? cache.set(url, new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; })).get(url);
const json = (url) => cache.get(url) ?? cache.set(url, fetch(url).then((r) => r.json())).get(url);

// The month's ground at the battle's latitude, from the same horizon plate the scene's ring shows.
function seasonOf(month, lat) {
  const k = plateKey(month, lat);
  if (k === 'winter') return { grass: 'grass-autumn', snow: true, trees: 'trees-winter' };
  if (k === 'autumn' || k === 'winter-south') return { grass: 'grass-autumn', trees: 'trees-autumn' };
  if (k === 'spring') return { grass: 'grass-spring', trees: 'trees-spring' };
  return { grass: 'grass', trees: 'trees' };
}
const MATS = ['dirt', 'sand', 'hilltop', 'forest-floor', 'paving', 'bank', 'water', 'cliff', 'snow', 'village'];
let loaded = null;
// Before the field is built (app.js awaits it): the materials for this battle's month and place.
export async function loadTacticalGround(month, city) {
  const key = `${month}|${city}`;
  if (loaded?.key === key) return loaded;
  const season = seasonOf(month, siteOfCity(city)?.lat ?? 33);
  const names = [...MATS, season.grass];
  const [imgs, atlas, sheet, sets] = await Promise.all([
    Promise.all(names.map((n) => image(`${WG}${n}.webp`))), image(`${WG}${season.trees}.webp`), json(`${WG}${season.trees}.json`),
    Promise.all(['wall-face', 'wall-top', 'banners'].map((n) => image(`${TG}${n}.webp`).catch(() => null))),
  ]);
  const bannerRects = sets[2] ? await json(`${TG}banners.json`).catch(() => null) : null;
  const img = Object.fromEntries(names.map((n, i) => [n, imgs[i]]));
  img.grass = img[season.grass];
  loaded = { key, season, img, atlas, sheet, wallFace: sets[0], wallTop: sets[1], banners: bannerRects && { img: sets[2], ...bannerRects } };
  return loaded;
}
export const tacticalGround = (month, city) => (loaded?.key === `${month}|${city}` ? loaded : null);

// How many cells one repeat of a swatch spans.
const SPAN = { grass: 5, snow: 5, dirt: 4.5, sand: 5, hilltop: 3, 'forest-floor': 4, paving: 2.6, bank: 2.5, water: 4 };
const PX = 56, M = 8; // canvas texels and mask texels a cell
export const WATER_Y = 0.25, KNOLL = 0.62, WALL_H = 0.95;
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

// Box blur in place, r texels, twice (≈ a gaussian).
function blur(F, w, h, r) {
  const T = new Float32Array(F.length);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, n = 0; for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < w) { s += F[y * w + xx]; n++; } } T[y * w + x] = s / n; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, n = 0; for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < h) { s += T[yy * w + x]; n++; } } F[y * w + x] = s / n; }
  }
  return F;
}

// The field for a board: map (GH rows of GW classes: 0 open, 1 wood, 2 rock, 3 deep water, 4 ford, 5 wall),
// terrain (0 woods … 5 castle), apron (cells of country round the board). Returns the masks and the height
// function every other piece stands on.
export function fieldOf({ map, terrain, GW, GH, apron, seed }) {
  const NX = GW + apron * 2, NZ = GH + apron * 2, w = NX * M, h = NZ * M;
  const cls = (x, y) => (x >= 0 && y >= 0 && x < GW && y < GH ? map[y][x] : -1);
  const layer = (f) => { const F = new Float32Array(w * h); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) F[j * w + i] = f(Math.floor(i / M) - apron, Math.floor(j / M) - apron); return F; };
  const n1 = (x, y) => vnoise(x * 1.4, y * 1.4, seed) * 0.6 + vnoise(x * 3.9, y * 3.9, seed + 5) * 0.4;
  const rock = blur(layer((x, y) => cls(x, y) === 2), w, h, 2);
  const deep = blur(layer((x, y) => cls(x, y) === 3), w, h, 2), ford = blur(layer((x, y) => cls(x, y) === 4), w, h, 2);
  const wood = blur(layer((x, y) => cls(x, y) === 1), w, h, 2);
  const at = (F, i, j) => F[Math.min(h - 1, Math.max(0, j)) * w + Math.min(w - 1, Math.max(0, i))];
  const H = new Float32Array((w + 1) * (h + 1)), knoll = new Float32Array(w * h), pool = new Float32Array(w * h);
  const H0 = 0.32;
  for (let j = 0; j <= h; j++) for (let i = 0; i <= w; i++) {
    const x = i / M - apron, y = j / M - apron, ii = Math.min(w - 1, i), jj = Math.min(h - 1, j), n = n1(x, y);
    // Rock cells: a rounded knoll, steep at its foot (the painted cliff band shows there), domed on top.
    const r = at(rock, ii, jj) + (n - 0.5) * 0.3, k = smooth(0.22, 0.42, r), crag = vnoise(x * 3.1, y * 3.1, seed + 17);
    // Water cells: a pool, its bank broken by the same noise.
    const wd = at(deep, ii, jj) + (n - 0.5) * 0.2, wf = at(ford, ii, jj) + (n - 0.5) * 0.2;
    const p = Math.max(smooth(0.3, 0.55, wd), smooth(0.3, 0.55, wf) * 0.62);
    // The country: level beside the board, rolling away behind and to the sides; low in front (N09).
    const cx = Math.max(0, Math.min(GW, x)), cy = Math.max(0, Math.min(GH, y)), dx = Math.abs(x - cx), back = Math.max(0, cy - y), front = Math.max(0, y - cy);
    const dd = Math.max(dx, back), roll = vnoise(x * 0.18, y * 0.18, seed + 9);
    const country = smooth(1.5, 9, dd) * (0.9 + roll * 1.6) - smooth(0.5, 4, front) * 0.06 + (vnoise(x * 0.5, y * 0.5, seed + 3) - 0.5) * 0.06 * smooth(1, 3, dd + front);
    // a knoll's top is broken into ledges and boulders rather than domed
    H[j * (w + 1) + i] = H0 + k * (KNOLL * (0.72 + n * 0.32) + (crag - 0.5) * 0.22 * smooth(0.5, 1, k)) - p * 0.26 + country;
    if (i < w && j < h) { knoll[j * w + i] = k; pool[j * w + i] = p; }
  }
  const height = (x, y) => { // board cell coordinates, continuous (cell centres at .5)
    const fx = (x + apron) * M, fy = (y + apron) * M, i = Math.max(0, Math.min(w - 1, Math.floor(fx))), j = Math.max(0, Math.min(h - 1, Math.floor(fy))), u = Math.min(1, Math.max(0, fx - i)), v = Math.min(1, Math.max(0, fy - j));
    const a = H[j * (w + 1) + i], b = H[j * (w + 1) + i + 1], c = H[(j + 1) * (w + 1) + i], d = H[(j + 1) * (w + 1) + i + 1];
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
  return { NX, NZ, w, h, apron, GW, GH, map, terrain, seed, cls, rock, wood, knoll, pool, height, n1 };
}

// A tiled pattern of a swatch, aligned to the canvas's cell grid.
function pattern(g, img, span, shift = 0) {
  const p = g.createPattern(img, 'repeat'), k = (span * PX) / img.width;
  p.setTransform(new DOMMatrix([k, 0, 0, k, (shift * 157) % (span * PX), (shift * 97) % (span * PX)]));
  return p;
}
// A material laid through a mask: alpha(i, j) per mask texel (0…1), drawn smooth at canvas size.
function lay(g, F, G, name, alpha, shift = 0) {
  const { w, h } = F, m = document.createElement('canvas'); m.width = w; m.height = h;
  const mg = m.getContext('2d'), id = mg.createImageData(w, h);
  let any = false;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const a = Math.max(0, Math.min(1, alpha(i, j))); id.data[(j * w + i) * 4 + 3] = a * 255; if (a > 0) any = true; }
  if (!any) return;
  mg.putImageData(id, 0, 0);
  const W = F.NX * PX, H = F.NZ * PX, c = document.createElement('canvas'); c.width = W; c.height = H;
  const cg = c.getContext('2d');
  cg.imageSmoothingEnabled = true; cg.drawImage(m, 0, 0, W, H);
  cg.globalCompositeOperation = 'source-in'; cg.fillStyle = pattern(cg, G.img[name], SPAN[name], shift); cg.fillRect(0, 0, W, H);
  g.drawImage(c, 0, 0);
}

// The ground canvas: every material where it lies, the woods' and knolls' shadows, the grid, the country dimmed
// with distance. trees: [{ x, y, size }] in board cells, for their painted shadows.
export function bakeGround(G, F, trees) {
  const { NX, NZ, w, h, apron, GW, GH, terrain, seed, cls, knoll, pool, wood, n1 } = F;
  const W = NX * PX, Hh = NZ * PX, canvas = document.createElement('canvas'); canvas.width = W; canvas.height = Hh;
  const g = canvas.getContext('2d');
  const xy = (i, j) => [i / M - apron, j / M - apron];
  const onBoard = (x, y) => x >= 0 && y >= 0 && x < GW && y < GH;
  const n2 = (x, y, s) => vnoise(x * 0.7, y * 0.7, seed + s);
  // base: the month's meadow (sand for the desert)
  g.fillStyle = pattern(g, G.img[terrain === 1 ? 'sand' : 'grass'], SPAN[terrain === 1 ? 'sand' : 'grass']); g.fillRect(0, 0, W, Hh);
  if (terrain === 1) lay(g, F, G, 'grass', (i, j) => { const [x, y] = xy(i, j), d = Math.max(-x, x - GW, -y, y - GH); return smooth(0.62, 0.72, n2(x, y, 21) - smooth(2, 9, d) * 0.25) ; });
  // trampled earth: patches over the country, a worn band where the lines meet on the board
  lay(g, F, G, 'dirt', (i, j) => {
    const [x, y] = xy(i, j), band = onBoard(x, y) ? smooth(4.5, 1.2, Math.abs(x - GW / 2)) * 0.35 : 0;
    return smooth(0.62, 0.74, n2(x, y, 7) * 0.8 + n1(x, y) * 0.3 + band) * (terrain === 1 ? 0.5 : 0.75);
  }, 1);
  // a fortress yard: flagstones across the board, broken into the meadow at its rim
  if (terrain === 5) lay(g, F, G, 'paving', (i, j) => { const [x, y] = xy(i, j), d = Math.max(-x, x - GW, -y, y - GH); return smooth(0.9, 0.2, d + (n1(x, y) - 0.5) * 0.9); }, 2);
  // woods: their floor under and round the crowns
  lay(g, F, G, 'forest-floor', (i, j) => smooth(0.25, 0.45, wood[j * w + i] + (n1(...xy(i, j)) - 0.5) * 0.2), 3);
  for (const t of trees) if (!onBoard(t.x, t.y)) { /* the country's groves: floor painted under each */ }
  // pools: a pebble bank round them (the water plane covers the middle)
  lay(g, F, G, 'bank', (i, j) => smooth(0.05, 0.3, pool[j * w + i]), 4);
  // knolls: the rocky top
  lay(g, F, G, 'hilltop', (i, j) => smooth(0.12, 0.45, knoll[j * w + i]), 5);
  // the country's far rises: rock where it climbs high
  lay(g, F, G, 'hilltop', (i, j) => { const [x, y] = xy(i, j); return smooth(1.05, 1.35, F.height(x, y)) * 0.85; }, 6);
  // winter: snow over everything but the trampled band, thinner on the board
  if (G.season.snow) lay(g, F, G, 'snow', (i, j) => {
    // on the board: a thin, broken cover, trodden away where the lines meet; drifts lie deeper beyond it
    const [x, y] = xy(i, j), on = onBoard(x, y), b = on ? 0.2 + smooth(5, 1, Math.abs(x - GW / 2)) * 0.3 : 0;
    const v = n2(x * 2.2, y * 2.2, 31) * 0.55 + n1(x * 1.7, y * 1.7) * 0.45 + 0.3 - b;
    return smooth(0.3, 0.7, v) * (on ? 0.75 : 1) * (1 - pool[j * w + i]);
  }, 7);
  // painted shadows: the woods' crowns throw theirs to the lower right (the sun is upper left), knolls darken at the foot
  g.save();
  for (const t of trees) {
    const cx = (t.x + apron + t.size * 0.35) * PX, cy = (t.y + apron + 0.05) * PX, r = t.size * 0.55 * PX;
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r); gr.addColorStop(0, 'rgba(18,22,10,0.42)'); gr.addColorStop(1, 'rgba(18,22,10,0)');
    g.fillStyle = gr; g.beginPath(); g.ellipse(cx, cy, r, r * 0.6, 0, 0, Math.PI * 2); g.fill();
  }
  g.restore();
  // occlusion at the foot of a knoll and the edge of a pool, and the country dimmed with distance
  {
    const m = document.createElement('canvas'); m.width = w; m.height = h;
    const mg = m.getContext('2d'), id = mg.createImageData(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const [x, y] = xy(i, j), k = knoll[j * w + i], p = pool[j * w + i];
      const foot = k > 0.02 && k < 0.5 ? (1 - Math.abs(k - 0.2) / 0.3) * 0.28 : 0, wet = p > 0.02 ? 0.12 + smooth(0.3, 0.9, p) * 0.45 : 0; // a pool's bed darkens toward its middle
      const d = Math.max(-x, x - GW, -y, y - GH), far = smooth(0.8, 7, d) * 0.62;
      id.data[(j * w + i) * 4 + 3] = Math.min(1, foot + wet + far) * 255;
    }
    mg.putImageData(id, 0, 0);
    g.save(); g.imageSmoothingEnabled = true; g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    const c = document.createElement('canvas'); c.width = W; c.height = Hh; const cg = c.getContext('2d');
    cg.drawImage(m, 0, 0, W, Hh); cg.globalCompositeOperation = 'source-in'; cg.fillStyle = '#1a140c'; cg.fillRect(0, 0, W, Hh);
    g.drawImage(c, 0, 0); g.restore();
  }
  // the grid: a faint line between the board's cells (not across walls or pools)
  g.save(); g.strokeStyle = 'rgba(28,22,12,0.2)'; g.lineWidth = 1.5; g.beginPath();
  for (let x = 0; x <= GW; x++) { g.moveTo((x + apron) * PX, apron * PX); g.lineTo((x + apron) * PX, (GH + apron) * PX); }
  for (let y = 0; y <= GH; y++) { g.moveTo(apron * PX, (y + apron) * PX); g.lineTo((GW + apron) * PX, (y + apron) * PX); }
  g.stroke();
  g.strokeStyle = 'rgba(255,240,200,0.07)'; g.beginPath();
  for (let x = 0; x <= GW; x++) { g.moveTo((x + apron) * PX + 1.5, apron * PX); g.lineTo((x + apron) * PX + 1.5, (GH + apron) * PX); }
  for (let y = 0; y <= GH; y++) { g.moveTo(apron * PX, (y + apron) * PX + 1.5); g.lineTo((GW + apron) * PX, (y + apron) * PX + 1.5); }
  g.stroke(); g.restore();
  void cls;
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return tex;
}

// The relief as one mesh: the baked ground on top, and on steep flanks the painted cliff band projected from
// the side (a top-down texture would smear down a slope).
const CLIFF = new WeakMap();
export function groundMesh(G, F, tex, wx0, wz0, SUB = 6) {
  const { NX, NZ } = F;
  const geo = new THREE.PlaneGeometry(NX, NZ, NX * SUB, NZ * SUB); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + NX / 2 - F.apron, y = pos.getZ(i) + NZ / 2 - F.apron;
    pos.setY(i, F.height(x, y));
  }
  geo.translate(wx0 + NX / 2, 0, wz0 + NZ / 2);
  geo.computeVertexNormals();
  // One cliff texture per painted image: the shader holds it outside the material, where release() (fx.js) does not
  // look, so a new one per battle stayed on the GPU for good.
  let cliff = CLIFF.get(G.img.cliff);
  if (!cliff) { cliff = new THREE.Texture(G.img.cliff); cliff.wrapS = cliff.wrapT = THREE.RepeatWrapping; cliff.colorSpace = THREE.SRGBColorSpace; cliff.anisotropy = 4; cliff.needsUpdate = true; CLIFF.set(G.img.cliff, cliff); }
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.97, metalness: 0 });
  mat.onBeforeCompile = (s) => {
    s.uniforms.uCliff = { value: cliff };
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uCliff; varying vec3 vWP; varying vec3 vWN;')
      .replace('#include <map_fragment>', `#include <map_fragment>
 { vec3 n = normalize(vWN); float steep = smoothstep(0.3, 0.52, 1.0 - n.y);
   float a = abs(n.x) > abs(n.z) ? vWP.z : vWP.x;
   vec4 c = texture2D(uCliff, vec2(a * 0.5, clamp((vWP.y - 0.28) * 1.25, 0.04, 0.97)));
   diffuseColor.rgb = mix(diffuseColor.rgb, c.rgb * 0.9, steep); }`);
  };
  mat.customProgramCacheKey = () => 'tactical-ground';
  const mesh = new THREE.Mesh(geo, mat); mesh.receiveShadow = true; mesh.castShadow = true; mesh.userData.noSeason = true; mesh.userData.part = 'ground';
  return mesh;
}

// The painted water over the pools (only where the ground dips under it).
export function waterMesh(G, F, wx0, wz0) {
  const m0 = document.createElement('canvas'); m0.width = F.w; m0.height = F.h;
  const mg = m0.getContext('2d'), id = mg.createImageData(F.w, F.h);
  for (let i = 0; i < F.w * F.h; i++) { const a = smooth(0.24, 0.62, F.pool[i]) * 255; id.data.set([a, a, a, 255], i * 4); }
  mg.putImageData(id, 0, 0);
  const alpha = new THREE.CanvasTexture(m0); alpha.flipY = true;
  const t = new THREE.Texture(G.img.water); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
  t.repeat.set(F.NX / SPAN.water, F.NZ / SPAN.water);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(F.NX, F.NZ), new THREE.MeshStandardMaterial({ map: t, alphaMap: alpha, transparent: true, opacity: 0.82, roughness: 0.3, metalness: 0, color: '#7f9a98', depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(wx0 + F.NX / 2, WATER_Y, wz0 + F.NZ / 2); m.receiveShadow = true; m.userData.noSeason = true; m.userData.water = true; m.userData.part = 'water';
  return m;
}

// Fortress walls: a solid block per wall cell, its open sides faced with the painted crenellated wall (the
// parapet's gaps cut out), the walk on top. wx / wz: cell → world centre.
export function wallMeshes(G, F, wx, wz, H0) {
  const { GW, GH, map } = F, isWall = (x, y) => x >= 0 && y >= 0 && x < GW && y < GH && map[y][x] === 5;
  const top = H0 + WALL_H * 0.8, face = [], walk = [];
  const quad = (arr, a, b, c, d, uv) => arr.push([a, b, c, d, uv]);
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    if (!isWall(x, y)) continue;
    const X = wx(x), Z = wz(y), x0 = X - 0.5, x1 = X + 0.5, z0 = Z - 0.5, z1 = Z + 0.5, y0 = H0 - 0.05, y1 = H0 + WALL_H;
    quad(walk, [x0, top, z1], [x1, top, z1], [x1, top, z0], [x0, top, z0], [x0, z0]);
    // faces wound outward; u runs along the wall in world units so neighbouring blocks continue the pattern
    if (!isWall(x, y + 1)) quad(face, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, x1]);
    if (!isWall(x, y - 1)) quad(face, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [-x1, -x0]);
    if (!isWall(x + 1, y)) quad(face, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [-z1, -z0]);
    if (!isWall(x - 1, y)) quad(face, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [z0, z1]);
  }
  const geom = (list, isFace) => {
    const p = [], u = [], idx = [];
    list.forEach(([a, b, c, d, uv], k) => {
      p.push(...a, ...b, ...c, ...d);
      if (isFace) { const [u0, u1] = uv, s = 0.55; u.push(u0 * s, 0, u1 * s, 0, u1 * s, 1, u0 * s, 1); } else u.push(a[0] / 2, a[2] / 2, b[0] / 2, b[2] / 2, c[0] / 2, c[2] / 2, d[0] / 2, d[2] / 2);
      idx.push(k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3);
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2)); g.setIndex(idx); g.computeVertexNormals();
    return g;
  };
  const tx = (img) => { const t = new THREE.Texture(img); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.needsUpdate = true; return t; };
  const out = new THREE.Group(); out.userData.part = 'walls';
  if (!face.length) return out;
  const fm = new THREE.Mesh(geom(face, true), new THREE.MeshStandardMaterial({ map: tx(G.wallFace), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95 }));
  fm.customDepthMaterial = new THREE.MeshDepthMaterial({ map: fm.material.map, alphaTest: 0.5, depthPacking: THREE.RGBADepthPacking });
  const wm = new THREE.Mesh(geom(walk, false), new THREE.MeshStandardMaterial({ map: tx(G.wallTop), roughness: 0.95 }));
  for (const m of [fm, wm]) { m.castShadow = m.receiveShadow = true; m.userData.noSeason = true; out.add(m); }
  return out;
}

// Woods: one quad per tree from the season's sheet, standing on its foot and reclined by half the camera's
// pitch toward the eye (as the men are), stretched back to the painted proportions. The crowns are painted lit
// and shaded already, so they take no shadow; their own are painted into the ground (bakeGround).
// trees: [{ x, z, h, size (crown width, world units), pine, shade }].
export function plantWoods(G, trees, pitch, seed = 1) {
  const { rects, w: AW, h: AH } = G.sheet;
  const broad = rects.filter((r) => r[4] === 'broad'), pines = rects.filter((r) => r[4] === 'pine');
  const ref = Math.max(...broad.map((r) => r[2]));
  const geo = new THREE.PlaneGeometry(1, 1); geo.translate(0, 0.5, 0);
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(Array(4).fill([0, 1, 0]).flat(), 3));
  const map = new THREE.Texture(G.atlas); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4; map.needsUpdate = true;
  const patch = (s) => {
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aRect;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = aRect.xy + uv * aRect.zw;\n#endif');
  };
  const mat = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, roughness: 1, metalness: 0 });
  mat.onBeforeCompile = patch; mat.customProgramCacheKey = () => 'tactical-woods';
  const list = [...trees].sort((a, b) => a.z - b.z);
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  im.count = list.length;
  const rect = new Float32Array(Math.max(1, list.length) * 4);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -pitch / 2), v = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
  let k = seed >>> 0;
  const rnd = () => ((k = (k * 1664525 + 1013904223) >>> 0) / 4294967296);
  list.forEach((t, i) => {
    const set = t.pine ? pines : broad, [rx, ry, rw, rh] = set[Math.floor(rnd() * set.length)];
    const wide = (t.size * rw) / ref;
    im.setMatrixAt(i, m4.compose(v.set(t.x, t.h - 0.04, t.z), q, s.set(wide, (wide * rh) / rw / Math.cos(pitch / 2), 1)));
    rect.set(rnd() < 0.5 ? [rx / AW, 1 - (ry + rh) / AH, rw / AW, rh / AH] : [(rx + rw) / AW, 1 - (ry + rh) / AH, -rw / AW, rh / AH], i * 4);
    im.setColorAt(i, c.setScalar(t.shade ?? 1));
  });
  geo.setAttribute('aRect', new THREE.InstancedBufferAttribute(rect, 4));
  im.castShadow = false; im.receiveShadow = false; im.userData.noSeason = true; im.userData.part = 'woods'; im.frustumCulled = false;
  return im;
}

// Where the woods stand: two or three broad crowns closing into one canopy on each wood cell; groves over the
// country beside and behind the board, thinning toward it and none in front of it (N09). In board cells.
export function woodsOf(F) {
  const { GW, GH, apron, seed, cls } = F, out = [];
  let k = (seed * 7919) >>> 0;
  const rnd = () => ((k = (k * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (cls(x, y) === 1) {
    const n = 2 + (rnd() < 0.5);
    for (let i = 0; i < n; i++) out.push({ x: x + 0.2 + rnd() * 0.6, y: y + 0.15 + rnd() * 0.7, size: 1.1 + rnd() * 0.35, pine: rnd() < 0.15 });
  }
  for (let y = -apron; y < GH + apron; y++) for (let x = -apron; x < GW + apron; x++) {
    if (x >= -1 && x <= GW && y >= -1 && y <= GH) continue; // a clear ring round the board
    if (y >= GH) continue; // nothing in front of the board
    const d = Math.max(-1 - x, x - GW, -1 - y), grove = vnoise(x * 0.22, y * 0.22, seed + 13) + Math.min(0.25, d * 0.05);
    if (grove < 0.56) continue;
    const n = 1 + (rnd() < 0.6) + (grove > 0.7);
    for (let i = 0; i < n; i++) out.push({ x: x + rnd(), y: y + rnd(), size: 1.0 + rnd() * 0.5, pine: rnd() < 0.2, far: d });
  }
  return out;
}

// A side's war banner planted at its retreat edge: a turned pole, and the painted cloth (plain, no character)
// hanging from its crossbar, swaying from the top down. look: 'attacker' | 'defender'.
export function bannerMesh(G, look, toward = 1) {
  const g = new THREE.Group(), POLE = 2.5;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, POLE, 8), new THREE.MeshStandardMaterial({ color: '#3a2a1c', roughness: 0.8 }));
  pole.position.y = POLE / 2; pole.castShadow = true; g.add(pole);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 8), new THREE.MeshStandardMaterial({ color: '#8a6a32', roughness: 0.4, metalness: 0.5 }));
  tip.position.y = POLE + 0.09; g.add(tip);
  const B = G.banners, [rx, ry, rw, rh] = B.rects[look], H = 1.45, W = (H * rw) / rh;
  const t = new THREE.Texture(B.img); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.needsUpdate = true;
  t.repeat.set(rw / B.w, rh / B.h); t.offset.set(rx / B.w, 1 - (ry + rh) / B.h);
  const geo = new THREE.PlaneGeometry(W, H, 6, 10); geo.translate(W / 2 - 0.02, -H / 2, 0);
  // toward the board's left: the cloth's texture mirrored rather than the quad, so its front still faces the camera
  if (toward < 0) { const p = geo.attributes.position, uv = geo.attributes.uv; for (let i = 0; i < p.count; i++) { p.setX(i, -p.getX(i)); uv.setX(i, 1 - uv.getX(i)); } geo.index.array.reverse(); }
  const u = { uTime: { value: 0 } };
  const mat = new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9, color: '#e8e0d8', emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 0.18 });
  const wave = (s) => {
    s.uniforms.uTime = u.uTime;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
 float k = clamp(-position.y / ${H.toFixed(2)}, 0.0, 1.0) * 0.6 + clamp(abs(position.x) / ${W.toFixed(2)}, 0.0, 1.0) * 0.4;
 transformed.z += sin(uTime * 2.1 + position.y * 3.0 + position.x * 2.0) * 0.07 * k;
 transformed.x += sin(uTime * 1.3 + position.y * 2.0) * 0.03 * k;`);
  };
  mat.onBeforeCompile = wave; mat.customProgramCacheKey = () => 'banner';
  const depth = new THREE.MeshDepthMaterial({ map: t, alphaTest: 0.5, depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = wave; depth.customProgramCacheKey = () => 'banner-depth';
  const cloth = new THREE.Mesh(geo, mat); cloth.customDepthMaterial = depth; cloth.position.set(0, POLE - 0.05, 0.04); cloth.rotation.x = -0.35; cloth.castShadow = true;
  g.add(cloth); g.userData.part = 'banner'; g.userData.look = look; g.userData.noSeason = true; g.traverse((o) => { o.userData.noSeason = true; });
  g.userData.tick = (time) => { u.uTime.value = time; };
  return g;
}
