// Strategy roads: receives the scene, board, city positions and ground height; owns the paths and road meshes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SEA_Y } from './worldmap.js';
import { isXiangyangRoad } from './core/expanded-map.js';

// Quiet road ink follows the bake at roughly three CSS pixels wide; fresh water keeps its own surface.
const ROAD_HALF_PX = 1.4, ROAD_CORE = 0.45, ROAD_ALPHA = 0.55, ROAD_SEA_ALPHA = 0.18, ROAD_END_ALPHA = 0.7, ROAD_LIFT = 0.012;
const ROAD_WATER_CELL = 0.5, ROAD_WATER_MARGIN = 0.09, ROAD_BRIDGE_RADIUS = 0.12, ROAD_SIMPLIFY_XZ = 0.00025, ROAD_SIMPLIFY_Y = 0.003, ROAD_MAX_STEP = 0.2;
const ROAD_EDGE = '#b39569', ROAD_LAND = '#d8bd8f', ROAD_SEA = '#b6d4d6', ROAD_NEAR_OPACITY = 0.45, ROAD_ZOOM = [10, 45.6]; // warm earth; BasicMaterial does not receive owner tint
const ROAD_FAR_ZOOM = [24, 45.6], ROAD_FAR_ALPHA = 0.4, ROAD_FAR_HALF_PX = 1;

export function createStrategyRoads({ scene, data, sand, world, cityPos, groundY }) {
  // Roads: packed-earth ribbons draped on the land, bowing round any city that sits on the straight line;
  // a crossing by sea (辽东–青州 over the 渤海) is a dashed sea lane. The selected city's roads light up (select()).
  const paths = new Map();
  const pathOf = (a, b) => {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (!paths.has(key) && sand && world.roadPath(Math.min(a, b), Math.max(a, b))) paths.set(key, world.roadPath(Math.min(a, b), Math.max(a, b)));
    if (!paths.has(key)) {
      const [i, j] = a < b ? [a, b] : [b, a], p = cityPos[i], q = cityPos[j];
      const dx = q.x - p.x, dz = q.z - p.z, len = Math.hypot(dx, dz), nx = -dz / len, nz = dx / len;
      // A quadratic curve's offset at t is 2t(1−t)·bow: bow away from the city that needs it most.
      let bow = 0;
      cityPos.forEach((c, k) => {
        if (k === i || k === j) return;
        const t = ((c.x - p.x) * dx + (c.z - p.z) * dz) / (len * len), s = (c.x - p.x) * nx + (c.z - p.z) * nz;
        if (t < 0.08 || t > 0.92 || Math.abs(s) > 0.6) return;
        const need = (0.62 - Math.abs(s)) / (2 * t * (1 - t));
        if (need > Math.abs(bow)) bow = need * (s > 0 ? -1 : 1);
      });
      bow = Math.max(-len * 0.45, Math.min(len * 0.45, bow));
      const cx = (p.x + q.x) / 2 + nx * bow, cz = (p.z + q.z) / 2 + nz * bow, n = Math.ceil(len / 0.05), pts = [];
      for (let k = 0; k <= n; k++) {
        const t = k / n, x = (1 - t) ** 2 * p.x + 2 * t * (1 - t) * cx + t * t * q.x, z = (1 - t) ** 2 * p.z + 2 * t * (1 - t) * cz + t * t * q.z;
        pts.push(new THREE.Vector3(x, groundY(x, z), z));
      }
      paths.set(key, pts);
    }
    const pts = paths.get(key);
    return a < b ? pts : [...pts].reverse();
  };
  const roadMat = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const dirt = new THREE.Color('#8e7650'), lane = new THREE.Color('#efe4c8');
  // A ribbon of half-width w along a road, lifted by `lift`, its colour and alpha per point: (atSea, run, end) → [Color, alpha].
  const ribbon = (pts, w, lift, paint) => {
    const pos = [], col = [], idx = [];
    let run = 0;
    pts.forEach((p, k) => {
      const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)], dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
      const ox = -dz / L * w, oz = dx / L * w;
      if (k) run += p.distanceTo(pts[k - 1]);
      const ground = world.heightAt(p.x, p.z), atSea = ground < SEA_Y + 0.01, end = Math.min(run, 99) < 0.35 || k > pts.length - 8;
      const y = Math.max(p.y, atSea ? SEA_Y : ground) + lift; // baked paths can run under the surface
      const [cc, alpha] = paint(atSea, run, end);
      pos.push(p.x + ox, y, p.z + oz, p.x - ox, y, p.z - oz); col.push(cc.r, cc.g, cc.b, alpha, cc.r, cc.g, cc.b, alpha);
      if (k) { const v = k * 2; idx.push(v - 2, v, v - 1, v - 1, v, v + 1); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4)); g.setIndex(idx); g.computeVertexNormals();
    return g;
  };
  const dash = (run) => Math.floor(run / 0.12) % 2 === 0;
  if (!sand) for (const c of data.cities) for (const n of c.roads) if (c.id < n) { // the sand table's roads are in its bake
    const g = ribbon(pathOf(c.id, n), 0.03, 0.02, (atSea, run, end) => [atSea ? lane : dirt, atSea ? (dash(run) ? 0.75 : 0) : end ? 0.4 : 0.8]);
    const road = new THREE.Mesh(g, roadMat); road.receiveShadow = true; road.renderOrder = 2; scene.add(road);
  }
  // Four vertices across each ribbon feather the edge; one mesh and an offset attribute keep its width adjustable.
  const baseRoadMat = sand ? new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }) : null;
  const roadWidth = { value: 0 };
  let baseRoad = null, roadDist = NaN, roadHeight = NaN, roadFov = NaN;
  if (sand) {
    const edge = new THREE.Color(ROAD_EDGE), land = new THREE.Color(ROAD_LAND), sea = new THREE.Color(ROAD_SEA), pieces = [];
    const widths = [1, ROAD_CORE, -ROAD_CORE, -1], waterCells = new Map(), bridges = sand.meta.pieces.bridge ?? [];
    // The heightfield alone cannot identify a lake or river. Index their existing triangles once, with a margin
    // wider than half a road sample, so no solid segment bridges the water between samples.
    for (const w of sand.meta.water) for (let i = 0; i < w.i.length; i += 3) {
      const a = w.i[i] * 3, b = w.i[i + 1] * 3, c = w.i[i + 2] * 3;
      const tri = [w.v[a], w.v[a + 2], w.v[b], w.v[b + 2], w.v[c], w.v[c + 2]];
      if (Math.abs((tri[2] - tri[0]) * (tri[5] - tri[1]) - (tri[3] - tri[1]) * (tri[4] - tri[0])) < 1e-8) continue;
      const x0 = Math.floor((Math.min(tri[0], tri[2], tri[4]) - ROAD_WATER_MARGIN) / ROAD_WATER_CELL), x1 = Math.floor((Math.max(tri[0], tri[2], tri[4]) + ROAD_WATER_MARGIN) / ROAD_WATER_CELL);
      const z0 = Math.floor((Math.min(tri[1], tri[3], tri[5]) - ROAD_WATER_MARGIN) / ROAD_WATER_CELL), z1 = Math.floor((Math.max(tri[1], tri[3], tri[5]) + ROAD_WATER_MARGIN) / ROAD_WATER_CELL);
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) { const key = `${x},${z}`; if (!waterCells.has(key)) waterCells.set(key, []); waterCells.get(key).push(tri); }
    }
    const waterAt = (x, z) => {
      const tris = waterCells.get(`${Math.floor(x / ROAD_WATER_CELL)},${Math.floor(z / ROAD_WATER_CELL)}`);
      if (!tris) return false;
      for (const t of tris) {
        let neg = false, pos = false;
        for (let j = 0; j < 6; j += 2) {
          const k = (j + 2) % 6, dx = t[k] - t[j], dz = t[k + 1] - t[j + 1], cross = dx * (z - t[j + 1]) - dz * (x - t[j]);
          neg ||= cross < 0; pos ||= cross > 0;
          const q = Math.min(1, Math.max(0, ((x - t[j]) * dx + (z - t[j + 1]) * dz) / (dx * dx + dz * dz || 1)));
          if ((x - t[j] - q * dx) ** 2 + (z - t[j + 1] - q * dz) ** 2 <= ROAD_WATER_MARGIN ** 2) return true;
        }
        if (!(neg && pos)) return true;
      }
      return false;
    };
    // Remove only points within a sub-pixel lateral tolerance and the local ground relief.
    const thin = (pts) => {
      const kept = [pts[0]]; let start = 0;
      for (let i = 2; i < pts.length; i++) {
        const a = pts[start], b = pts[i], dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz;
        let fits = b.alpha === a.alpha && len2 <= ROAD_MAX_STEP * ROAD_MAX_STEP;
        for (let j = start + 1; fits && j < i; j++) {
          const q = pts[j], t = len2 ? Math.min(1, Math.max(0, ((q.x - a.x) * dx + (q.z - a.z) * dz) / len2)) : 0;
          fits = q.alpha === a.alpha && (q.x - a.x - t * dx) ** 2 + (q.z - a.z - t * dz) ** 2 <= ROAD_SIMPLIFY_XZ ** 2 && Math.abs(q.y - a.y - t * (b.y - a.y)) <= ROAD_SIMPLIFY_Y;
        }
        if (!fits) { kept.push(pts[i - 1]); start = i - 1; }
      }
      if (pts.length > 1) kept.push(pts[pts.length - 1]);
      return kept;
    };
    baseRoadMat.onBeforeCompile = (sh) => {
      sh.uniforms.uRoadWidth = roadWidth;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 roadOffset; uniform float uRoadWidth;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.xz += roadOffset * uRoadWidth;');
    };
    baseRoadMat.customProgramCacheKey = () => 'sandRoadInk';
    for (const c of data.cities) for (const n of c.roads) if (c.id < n) {
      const course = world.roadPath(c.id, n); if (!course?.length) continue; // never invent a second course beside the bake
      const throughXiangyang = isXiangyangRoad(c.id, n);
      let run = 0;
      const pts = thin(course.map((p, k) => {
        if (k) run += p.distanceTo(course[k - 1]);
        const atSea = world.heightAt(p.x, p.z) < SEA_Y + 0.01, wet = waterAt(p.x, p.z);
        // 襄阳的新接线经过河岸，保留跨河路面，避免旧桥遮罩截断道路。
        let bridge = wet && !atSea && throughXiangyang;
        if (wet && !atSea && !bridge) for (let i = 0; i < bridges.length; i += 6) if ((p.x - bridges[i]) ** 2 + (p.z - bridges[i + 2]) ** 2 <= ROAD_BRIDGE_RADIUS ** 2) { bridge = true; break; }
        const alpha = wet && !bridge ? 0 : atSea ? (dash(run) ? ROAD_SEA_ALPHA : 0) : ROAD_ALPHA * (run < 0.35 || k > course.length - 8 ? ROAD_END_ALPHA : 1);
        return { x: p.x, y: (bridge ? Math.max(world.surfaceAt(p.x, p.z), p.y) : world.surfaceAt(p.x, p.z)) + ROAD_LIFT, z: p.z, atSea, alpha };
      }));
      const pos = [], offset = [], col = [], idx = [];
      pts.forEach((p, k) => {
        const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)], dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
        for (let j = 0; j < widths.length; j++) {
          const core = j === 1 || j === 2, color = core ? (p.atSea ? sea : land) : edge;
          pos.push(p.x, p.atSea ? Math.max(p.y, SEA_Y + ROAD_LIFT) : p.y, p.z); offset.push(-dz / L * widths[j], dx / L * widths[j]);
          col.push(color.r, color.g, color.b, core ? p.alpha : 0);
          if (k && j < widths.length - 1) { const v = k * widths.length + j; idx.push(v - widths.length, v, v - widths.length + 1, v - widths.length + 1, v, v + 1); }
        }
      });
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('roadOffset', new THREE.Float32BufferAttribute(offset, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4)); g.setIndex(idx); pieces.push(g);
    }
    const merged = mergeGeometries(pieces); merged.computeBoundingSphere(); merged.boundingSphere.radius += 0.5; // offsets also remain visible at the screen edge
    baseRoad = new THREE.Mesh(merged, baseRoadMat); baseRoad.renderOrder = 2; scene.add(baseRoad);
    for (const g of pieces) g.dispose();
  }
  // 道路 overview (playtest of 2026-10-30, T15): every road at once, a bright lacquer-gold line on a dark edge so it
  // reads over sand, snow and water alike; sea lanes dashed. Built on first use; roads(on) shows it.
  let overview = null;
  const buildOverview = () => {
    const grp = new THREE.Group(), mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, fog: false });
    const edge = new THREE.Color('#2a1606'), gold = new THREE.Color('#ffd878'), sea = new THREE.Color('#e8f4ff');
    for (const c of data.cities) for (const n of c.roads) if (c.id < n) {
      const pts = pathOf(c.id, n);
      const under = new THREE.Mesh(ribbon(pts, 0.075, 0.035, (atSea, run) => [edge, atSea ? (dash(run) ? 0.5 : 0) : 0.55]), mat);
      const line = new THREE.Mesh(ribbon(pts, 0.036, 0.04, (atSea, run) => [atSea ? sea : gold, atSea ? (dash(run) ? 0.95 : 0) : 0.95]), mat);
      under.renderOrder = 3; line.renderOrder = 4; grp.add(under, line);
    }
    scene.add(grp); return grp;
  };
  let roadsOn = false;
  return {
    pathOf,
    roads(on) { roadsOn = on; if (on) overview ??= buildOverview(); if (overview) overview.visible = on; },
    get roadsOn() { return roadsOn; },
    hideBase() { if (baseRoad) baseRoad.visible = false; },
    update(view, camera) {
      if (baseRoadMat && (roadDist !== view.dist || roadHeight !== innerHeight || roadFov !== camera.fov)) {
        roadDist = view.dist; roadHeight = innerHeight; roadFov = camera.fov;
        const far = THREE.MathUtils.smoothstep(roadDist, ROAD_FAR_ZOOM[0], ROAD_FAR_ZOOM[1]);
        roadWidth.value = THREE.MathUtils.lerp(ROAD_HALF_PX, ROAD_FAR_HALF_PX, far) * 2 * Math.tan(THREE.MathUtils.degToRad(roadFov / 2)) * roadDist / Math.max(1, roadHeight);
        baseRoadMat.opacity = THREE.MathUtils.lerp(ROAD_NEAR_OPACITY, 1, THREE.MathUtils.smoothstep(roadDist, ROAD_ZOOM[0], ROAD_ZOOM[1])) * THREE.MathUtils.lerp(1, ROAD_FAR_ALPHA / ROAD_ALPHA, far);
      }
    },
  };
}
