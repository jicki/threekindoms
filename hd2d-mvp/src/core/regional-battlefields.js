import { BATTLE_REGIONS } from './battlefield-regions.js';
import { fortressPlan } from './fortress-plans.js';

export const FIRST_REGIONAL_BATTLE_REVISION = 13;
export const FIRST_REGIONAL_LAYOUT_REVISION = 6;
export const EXPANDED_WARDS_BATTLE_REVISION = 14;
export const EXPANDED_WARDS_LAYOUT_REVISION = 7;
export const ALIGNED_APPROACH_BATTLE_REVISION = 15;
export const ALIGNED_APPROACH_LAYOUT_REVISION = 8;
export const CORNER_BATTLE_REVISION = 16;
export const CORNER_LAYOUT_REVISION = 9;
export const REGIONAL_BATTLE_REVISION = 17;
export const REGIONAL_LAYOUT_REVISION = 10;

const FOREST = 0, SAND = 1, PLAIN = 2, RIVER = 3, MOUNT = 4, CASTLE = 5;
const SIDES = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
const DIRS = Object.values(SIDES);
const SIDENAMES = { n: '北', e: '东', s: '南', w: '西' };
const CITY_SIZE = { capital: [52, 34], river: [48, 32], coast: [48, 32], island: [50, 34], field: [50, 32] };
// 各关分别配置谷底窄口、谷外展开速度和外关到中心的距离。
const PASS_SHAPE = { 33: [4, 9, 5], 34: [3, 8, 6], 35: [3, 6, 7], 36: [2, 6, 7], 37: [3, 5, 5] };
const MAJOR_WARDS = new Set([1, 4, 10, 11, 14, 15, 16, 18, 20, 21, 23, 25, 26, 30, 31, 32]);
const INNER_WARDS = new Set([1, 4, 10, 11, 14, 15, 18, 20, 21, 25, 26, 30, 31, 32]);
const CELL_KEY = ([x, y]) => x + ',' + y;
const CORNERS = [[-1, -1, '西北'], [1, -1, '东北'], [1, 1, '东南'], [-1, 1, '西南']];
const dist = ([x, y], [a, b]) => Math.abs(x - a) + Math.abs(y - b);
const add = ([x, y], [a, b], n = 1) => [x + a * n, y + b * n];
const point = ({ x, y }) => [x, y];
const clamp = (value, a, b) => Math.max(a, Math.min(b, value));
const rectOf = (cells) => [Math.min(...cells.map(p => p[0])), Math.max(...cells.map(p => p[0])),
  Math.min(...cells.map(p => p[1])), Math.max(...cells.map(p => p[1]))];

// 用连续折线连接已有的岸线、桥头与山路。水面、关墙和断崖不由搜索临时填平。
function trace(points) {
  const out = [points[0]];
  for (const [tx, ty] of points.slice(1)) {
    let [x, y] = out.at(-1);
    while (x !== tx || y !== ty) {
      const wx = Math.abs(tx - x), wy = Math.abs(ty - y);
      if (wx >= wy) x += Math.sign(tx - x);
      else y += Math.sign(ty - y);
      out.push([x, y]);
    }
  }
  return out;
}

function roadSearch(map, barriers, roads, excluded, start, area = null) {
  const width = map[0].length, total = width * map.length, previous = new Int32Array(total).fill(-1), best = new Float64Array(total).fill(Infinity);
  const root = start[1] * width + start[0], open = [{ i: root, d: 0 }];
  best[root] = 0;
  while (open.length) {
    open.sort((a, b) => a.d - b.d);
    const { i, d } = open.shift();
    if (best[i] !== d) continue;
    const here = [i % width, Math.floor(i / width)];
    for (const dir of DIRS) {
      const [x, y] = add(here, dir), tile = map[y]?.[x], k = CELL_KEY([x, y]);
      if (tile === undefined || barriers.has(k) || excluded.has(k) || (area && !area.has(k))) continue;
      const cost = roads.has(k) ? 1 : [2.3, 1.5, 1.15, Infinity, 3.3, 1.15][tile];
      const next = y * width + x, sum = d + cost;
      if (sum >= best[next]) continue;
      best[next] = sum; previous[next] = i; open.push({ i: next, d: sum });
    }
  }
  return {
    cost: ([x, y]) => map[y]?.[x] === undefined ? Infinity : best[y * width + x],
    path([x, y]) {
      const path = [];
      for (let i = y * width + x; i >= 0; i = previous[i]) {
        path.push([i % width, Math.floor(i / width)]);
        if (i === root) return path.reverse();
      }
      return [];
    },
  };
}

export function regionalBattlefield(id, requestedSide, villages, seaEntry = false, revision = REGIONAL_LAYOUT_REVISION) {
  const expanded = revision >= EXPANDED_WARDS_LAYOUT_REVISION;
  const outerCamps = revision >= CORNER_LAYOUT_REVISION;
  const grouped = revision >= REGIONAL_LAYOUT_REVISION;
  const alignedWestBridge = id === 2 && revision >= ALIGNED_APPROACH_LAYOUT_REVISION;
  const [label, type, axis, geography] = BATTLE_REGIONS[id];
  const [w, h] = CITY_SIZE[type] ?? [44, 30], side = requestedSide ?? axis;
  const [nx, ny] = SIDES[axis], normal = [nx, ny], tangent = [-ny, nx];
  const river = ['river', 'capital', 'field'].includes(type), coast = type === 'coast' || type === 'island';
  const cx = Math.floor(w / 2) + (type === 'island' ? 9 : type === 'field' ? 10 : type === 'pass' ? 0 : id % 5 - 2);
  const cy = Math.floor(h / 2) + (type === 'field' ? (outerCamps ? -1 : -6) : id % 3 - 1)
    - (expanded && (river || coast) ? 2 * ny : 0);
  const center = [cx, cy];
  const world = (u, v) => add(add(center, normal, u), tangent, v);
  const inBounds = ([x, y]) => x >= 1 && x < w - 1 && y >= 1 && y < h - 1;
  const uv = (x, y) => [(x - cx) * nx + (y - cy) * ny, -(x - cx) * ny + (y - cy) * nx];
  const cityPlan = fortressPlan(id), major = MAJOR_WARDS.has(id);
  const [legacyX, legacyY] = type === 'capital' ? (id === 12 ? [8, 6] : [7, 7])
    : [Math.min(6, cityPlan.outer[0] + 1), Math.min(5, cityPlan.outer[1])];
  // 街区沿平行于水岸的一轴扩大，保留临水城门与岸边的空间。
  const addWard = outerCamps && type !== 'capital' && type !== 'pass' ? (major || type === 'island' ? 1 : 2) : 0;
  const rx = legacyX + (expanded ? type === 'capital' || major ? 3 : 2 : 0) + (ny ? addWard : 0);
  const ry = legacyY + (expanded ? 2 : 0) + (nx ? addWard : 0);
  const wallRadius = nx ? rx : ry, edge = nx ? (nx > 0 ? w - 1 - cx : cx) : (ny > 0 ? h - 1 - cy : cy);
  const bank = expanded ? Math.max(12, wallRadius + 5) : 10;
  const band = v => {
    const u = bank + Math.round(Math.sin((v + id * 1.6) / 5) * 2 + Math.sin((v - id) / 9) * 1.5);
    // 天然河道与城壕之间至少留一排岸地，供桥头接岸和转向。
    return expanded ? clamp(u, wallRadius + (type === 'river' ? 5 : 3), edge - 5) : u;
  };
  const shoreBase = type === 'island' ? 12 : expanded ? Math.max(13, (nx ? rx : ry) + 5) : 11;
  const shore = v => shoreBase + Math.round(2.6 * Math.sin((v + id % 5) / 4.5)
    + 1.5 * Math.cos(v / 8)) - (type === 'island' ? Math.max(0, 3 - Math.abs(v)) : 0);
  const [pinch, opening, oldCut] = PASS_SHAPE[id] ?? [3, 7, 6];
  const outerCut = oldCut + (expanded ? 2 : 0);
  const valleyWidth = u => pinch + Math.floor(Math.min(2, Math.abs(u) / opening));
  const barriers = new Map(), roads = new Map(), sites = [];
  const map = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => {
    const [u, v] = uv(x, y), k = CELL_KEY([x, y]);
    const cover = Math.sin((x + id * 2.1) * 0.43) + Math.cos((y - id * 1.7) * 0.51)
      + 0.65 * Math.sin(x * 0.24 - y * 0.31 + id);
    if (type === 'pass' && Math.abs(v) > valleyWidth(u)) {
      barriers.set(k, '断崖'); return MOUNT;
    }
    const islandBack = type === 'island' && (u < -10 + Math.round(Math.cos(v / 4) * 2)
      || Math.abs(v) > 14 + Math.round(Math.sin(u / 4)));
    const tributary = id === 31 && u >= band(v) && Math.abs(v - (18 - Math.floor(u / 2))) < 2;
    const water = coast ? u >= shore(v) || islandBack
      : river && (tributary || Math.abs(u - band(v)) <= (type === 'field' ? Number(expanded) : type === 'capital' ? 1 : 2));
    if (water) { barriers.set(k, coast ? '深海' : '深水'); return RIVER; }
    if (coast && u >= shore(v) - 2) return SAND;
    if (type === 'pass') return cover > 1.3 && Math.abs(u) > 9 && Math.abs(v) >= 2 ? FOREST : PLAIN;
    const hill = type === 'ridge' ? cover > 0.55 && Math.abs(u) > 4
      : type === 'capital' ? u < -8 && cover > 0.30
      : type === 'island' ? (u > 2 && u < 8 && Math.abs(v) >= 3 && cover > 0.42) || cover > 1.5
      : type === 'field' ? cover > 0.95 && v > 1 : cover > 1.43;
    if (hill) return MOUNT;
    if (cover > 0.77) return FOREST;
    return type === 'steppe' && cover < -0.40 ? SAND : PLAIN;
  }));
  const hard = (p) => barriers.has(CELL_KEY(p));
  function setRoad(p, kind, face) {
    const [x, y] = p, key = CELL_KEY(p);
    const old = roads.get(key);
    if (!old || old.kind === 'road') roads.set(key, { x, y, kind, face, bridge: kind === 'bridge' });
    // 浅滩保留水域计算水计；木桥的承载面按平地通行，底图保留水纹。
    if (kind !== 'bridge' && kind !== 'ford') map[y][x] = PLAIN;
    barriers.delete(key);
  }

  if (river) {
    const vLimit = nx ? h : w;
    const face = nx ? 'e' : 's', span = type === 'field' ? 1 + Number(expanded) : type === 'capital' ? 2 : 3;
    const vMid = id === 30 ? -4 : 3 + id % 5;
    const places = [[alignedWestBridge ? 0 : vMid, 'bridge'], [vMid - Math.floor(vLimit * 0.32), 'ford']];
    for (const [v, kind] of places) for (const along of [v, v + 1]) {
      for (let across = band(along) - span; across <= band(along) + span; across++) {
        const p = world(across, along);
        if (inBounds(p)) {
          setRoad(p, kind, face);
          if (expanded && map[p[1]][p[0]] !== RIVER) map[p[1]][p[0]] = PLAIN;
        }
      }
      if (expanded) for (const end of [-1, 1]) {
        const p = world(band(along) + end * (span + 1), along);
        if (inBounds(p) && !hard(p)) setRoad(p, 'road', face);
      }
    }
  }

  const inner = 2, outer = 4, walls = [], gates = [], districts = new Set(), innerDistrict = new Set(), moat = [];
  const outline = new Set(), used = new Set(), plankWays = new Map();
  let camp = null;
  const paving = new Map();
  let keep = center;
  function beWall([x, y], ring, face, corner = false) {
    walls.push({ x, y, ring, face, corner });
    outline.add(CELL_KEY([x, y]));
    map[y][x] = PLAIN; barriers.delete(CELL_KEY([x, y]));
  }
  function beGate(p, ring, face) {
    const [x, y] = p, k = CELL_KEY(p);
    gates.push({ x, y, ring, face, open: false });
    outline.add(k); map[y][x] = PLAIN; barriers.delete(k);
    used.add(k);
  }

  if (type === 'pass') {
    // 两侧的来路各自有锁口。栈道迂回的是对应外关，内关仍封住通往主寨的谷底。
    for (const sign of [-1, 1]) {
      const face = sign === 1 ? axis : Object.keys(SIDES).find(k => SIDES[k][0] === -nx && SIDES[k][1] === -ny);
      for (const [along, ring] of [[sign * outerCut, outer], [sign * 2, inner]]) {
        beGate(world(along, 0), ring, face);
        const width = valleyWidth(along);
        for (let v = -width; v <= width; v++) if (v !== 0) beWall(world(along, v), ring, face, Math.abs(v) === width);
      }
      const v = sign * (valleyWidth(outerCut) + 1);
      const plank = trace([[sign * (outerCut + (expanded ? 3 : 6)), sign * 2], [sign * (outerCut + (expanded ? 2 : 3)), v],
        [sign * (outerCut - 1), v], [sign * (outerCut - 2), sign * 2]])
        .map(([a,b]) => world(a,b));
      const exit = trace([world(sign * (outerCut - 2), sign * 2), world(sign * (outerCut - 2), 0), world(sign * 2, 0)]);
      plankWays.set(face, { plank, exit });
      for (const [i, p] of plank.entries()) {
        const neighbour = plank[i + 1] ?? plank[i - 1];
        if (inBounds(p) && !outline.has(CELL_KEY(p))) setRoad(p, 'plank', neighbour[0] === p[0] ? 's' : 'e');
      }
    }
    for (let u = -outerCut; u <= outerCut; u++) for (let v = -valleyWidth(u); v <= valleyWidth(u); v++) {
      const p = world(u, v); districts.add(CELL_KEY(p));
      if (Math.abs(u) < 2) innerDistrict.add(CELL_KEY(p));
    }
  } else {
    function ward(at, rx, ry, ring, faces, notch) {
      const local = ([x, y]) => [at[0] + x, at[1] + y];
      const [lt, rt, rb, lb] = notch;
      // 分段退让的外墙保留街角、台地和门前空地；内墙可独立偏置。
      const corners = [[-rx + lt, -ry], [rx - rt, -ry], [rx - rt, -ry + rt], [rx, -ry + rt],
        [rx, ry - rb], [rx - rb, ry - rb], [rx - rb, ry], [-rx + lb, ry],
        [-rx + lb, ry - lb], [-rx, ry - lb], [-rx, -ry + lt], [-rx + lt, -ry + lt]].filter((p, i, a) => i === 0 || dist(p, a[i - 1]) > 0);
      const offsets = { n: id % 3 - 1, s: id % 4 - 1, e: id % 3 - 1, w: (id + 1) % 3 - 1 };
      const door = new Map(faces.map(face => {
        const [a, b] = SIDES[face], limit = (a ? ry : rx) - 1;
        const offset = clamp(offsets[face], -limit, limit);
        const p = local(a ? [rx * a, offset] : [offset, ry * b]);
        return [CELL_KEY(p), face];
      }));
      const contour = new Map();
      for (const [i, a] of corners.entries()) {
        const b = corners[(i + 1) % corners.length], [dx, dy] = [b[0] - a[0], b[1] - a[1]];
        if (!dx && !dy) continue;
        const edgeFace = dx > 0 ? 'n' : dx < 0 ? 's' : dy > 0 ? 'e' : 'w';
        for (const p of trace([a, b])) {
          const k = CELL_KEY(local(p)), prev = contour.get(k);
          contour.set(k, { p: local(p), face: edgeFace, corner: !!prev && prev.face !== edgeFace });
        }
      }
      const area = ring === outer ? districts : innerDistrict;
      for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) {
        if ((x < -rx + lt && y < -ry + lt) || (x > rx - rt && y < -ry + rt)
          || (x > rx - rb && y > ry - rb) || (x < -rx + lb && y > ry - lb)) continue;
        const p = local([x, y]), k = CELL_KEY(p);
        area.add(k); barriers.delete(k); map[p[1]][p[0]] = PLAIN;
        roads.delete(k);
      }
      for (const [k, mark] of contour) {
        if (door.has(k)) beGate(mark.p, ring, door.get(k));
        else beWall(mark.p, ring, mark.face, mark.corner);
      }
    }
    const notches = id === 12 ? [2, 1, 1, 2] : id === 8 ? [1, 1, 2, 1] : [1 + id % 2, id % 3 === 0 ? 0 : 1, 1, (id + 1) % 2];
    ward(center, rx, ry, outer, ['n', 'e', 's', 'w'], notches);
    // 都城留两段旱壕，沿河和滨海城镇在临水一侧留水壕。城门的引道在壕中留出桥面或过道。
    const waterside = ['river', 'coast', 'island'].includes(type);
    if (type === 'capital' || waterside) for (const face of type === 'capital' ? ['n', 's'] : [axis]) {
      const normal = SIDES[face], tangent = [-normal[1], normal[0]];
      const depth = normal[0] ? rx + 1 : ry + 1, half = (normal[0] ? ry : rx) - 1;
      const gate = gates.find(g => g.face === face && g.ring === outer);
      const gap = CELL_KEY(add(point(gate), normal));
      for (let offset = -half; offset <= half; offset++) {
        const p = add(add(center, normal, depth), tangent, offset), [x, y] = p, k = CELL_KEY(p);
        if (!waterside && map[y][x] === RIVER) continue;
        moat.push({ x, y, wet: waterside, face });
        map[y][x] = waterside ? RIVER : SAND;
        if (k === gap && waterside) setRoad(p, 'bridge', face);
        else if (waterside) { roads.delete(k); barriers.set(k, '水壕'); }
      }
    }
    if (type === 'capital' || (expanded ? INNER_WARDS.has(id) : [15, 21, 26, 30].includes(id))) {
      // 错开的内城与外墙之间至少留一格街巷，避免外门正对内墙封死。
      const innerX = (type === 'capital' ? 3 : 2) + Number(expanded), innerY = type === 'capital' && expanded ? 3 : 2;
      const shift = type === 'capital' ? 2 + Number(expanded) : 1 + Number(expanded);
      const clear = type === 'river' ? rx - innerX - 2 : ry - innerY - 2;
      keep = add(center, type === 'river' ? [1, 0] : [0, -1], expanded ? Math.min(shift, clear) : shift);
      const insideFaces = expanded ? ['s', 'e', 'w'] : ['s', 'e'];
      ward(keep, innerX, innerY, inner, insideFaces, [0, 0, 0, 0]);
    }
    if (type === 'field') {
      camp = { x: cx - (expanded ? rx + 3 : 10), y: cy + 5, kind: 'camp', label: '守军前阵' };
      if (outerCamps) {
        const preferred = [cx - rx - 6, Math.min(h - 5, cy + ry + 2)];
        const dry = q => inBounds(q) && !hard(q) && !districts.has(CELL_KEY(q)) && !roads.has(CELL_KEY(q))
          && map[q[1]][q[0]] !== MOUNT;
        const clearArea = p => [-1, 0, 1].every(dx => [-1, 0, 1].every(dy => dry(add(p, [dx, dy]))))
          && DIRS.every(dir => dry(add(p, dir, 2)));
        const candidates = map.flatMap((row, y) => row.flatMap((_, x) =>
          Math.max(Math.abs(x - cx) - rx, Math.abs(y - cy) - ry) >= 4 && clearArea([x, y]) ? [[x, y]] : []));
        [camp.x, camp.y] = candidates.sort((a, b) => dist(a, preferred) - dist(b, preferred))[0];
        camp.clearing = 1;
        for (let y = camp.y - 1; y <= camp.y + 1; y++) for (let x = camp.x - 1; x <= camp.x + 1; x++) map[y][x] = PLAIN;
      } else if (expanded) {
        // 营帐与临河的渡路留出间隔，营地周边的林木留在外围。
        const dry = [0, 1, 2, -1, -2].map(offset => [camp.x + offset, camp.y]).find(p => !hard(p));
        if (dry) camp.x = dry[0];
        for (const [dx, dy] of [[0, 0], ...DIRS]) {
          const p = add(point(camp), [dx, dy]);
          if (!hard(p)) map[p[1]][p[0]] = PLAIN;
        }
      }
      barriers.delete(CELL_KEY(point(camp))); map[camp.y][camp.x] = PLAIN;
      for (const gate of gates) gate.requiresCamp = true;
      sites.push(camp);
    }
  }

  const outerGates = gates.filter(g => g.ring === outer);
  // 门口留一处台阶。天然河岸仍由预置桥、浅滩连接，门外不挖环形护城河。
  for (const gate of outerGates) {
    const start = add(point(gate), SIDES[gate.face]);
    if (!hard(start)) continue;
    if (type === 'pass') continue;
    if (map[start[1]][start[0]] === RIVER && (coast || gate.face === axis)) {
      let p = start;
      while (inBounds(p) && map[p[1]][p[0]] === RIVER && dist(p, point(gate)) <= 4) {
        // 港门口的短栈桥可以站人，外海仍不开放陆军通行。
        if (coast && dist(p, point(gate)) > 1) break;
        setRoad(p, 'bridge', gate.face); p = add(p, SIDES[gate.face]);
      }
    }
  }

  // 主街至少两格宽，横巷和绕内墙的街道留给两军换防。
  const streets = new Set();
  if (expanded && type !== 'pass') for (const k of districts) {
    if (outline.has(k)) continue;
    const [x, y] = k.split(',').map(Number), dx = x - cx, dy = y - cy;
    const road = Math.abs(dx) <= 1 || dy === 0 || dy === 1 || dx % 4 === 0 || dy % 3 === 0;
    const approach = gates.some(g => {
      const [nx, ny] = SIDES[g.face], forward = (g.x - x) * nx + (g.y - y) * ny;
      return forward > 0 && forward <= 3 && Math.abs((g.y - y) * nx - (g.x - x) * ny) <= 1;
    });
    if (road || approach || dist([x, y], keep) <= 2) streets.add(k);
  }
  if (streets.size) {
    const blocked = new Set(walls.map(wall => CELL_KEY(point(wall))));
    const streetsToKeep = roadSearch(map, barriers, roads, blocked, keep, districts);
    for (const gate of gates) for (const p of streetsToKeep.path(point(gate))) {
      const k = CELL_KEY(p);
      if (!outline.has(k)) streets.add(k);
    }
  }
  // 城内建筑跟随据点固定，布阵随后避开房舍。
  if (type !== 'pass') for (const k of districts) {
    const [x, y] = k.split(',').map(Number), p = [x, y];
    const block = expanded ? !streets.has(k) && (x + 2 * y + id) % 4 !== 0
      : x % 3 === id % 3 && y % 3 === (id + 1) % 3;
    if (outline.has(k) || innerDistrict.has(k) || !block
      || dist(p, keep) <= 1 || gates.some(g => dist(p, point(g)) <= 2)) continue;
    barriers.set(k, '街区建筑'); sites.push({ x, y, kind: 'house' });
  }
  const tileFree = p => inBounds(p) && !hard(p) && !outline.has(CELL_KEY(p)) && (map[p[1]][p[0]] !== RIVER || roads.has(CELL_KEY(p)));
  const outside = p => tileFree(p) && !districts.has(CELL_KEY(p));
  function zone(name, seed, size, allowed) {
    const [sx, sy] = seed, [rx, ry] = size;
    const cells = [];
    for (let y = sy - ry; y <= sy + ry; y++) for (let x = sx - rx; x <= sx + rx; x++) if (allowed([x, y])) cells.push([x, y]);
    cells.sort((a, b) => dist(a, seed) - dist(b, seed));
    return cells.length ? { name, cells, rect: rectOf(cells), anchor: cells[0] } : null;
  }
  const approachSide = seaEntry || (type === 'pass' && !outerGates.some(g => g.face === side)) ? axis : side;
  const [ax, ay] = SIDES[approachSide];
  const exteriorGate = outerGates.find(g => g.face === approachSide);
  const toward = (p) => (p[0] - cx) * ax + (p[1] - cy) * ay;
  const blockedRoutes = new Set([...districts, ...outline]);
  const outsideGap = ([x, y]) => Math.max(Math.abs(x - cx) - rx, Math.abs(y - cy) - ry);
  const nearSite = (p, radius) => sites.some(s => s.kind !== 'house' && dist(p, point(s)) <= radius);

  const naval = type === 'island' || (type === 'coast' && seaEntry);
  if (coast || id === 30 || id === 31) {
    let harbor = coast ? world(shore(0) - 1, 0) : world(band(5) - 4, 5);
    // 襄阳的名义岸点可能落在城壕里，码头应贴在可通行的这一侧河岸。
    if (id === 30) {
      const preferred = harbor;
      harbor = map.flatMap((row, y) => row.flatMap((_, x) => {
        const p = [x, y], [u, v] = uv(x, y);
        return outside(p) && u < band(v) && !roads.has(CELL_KEY(p))
          && DIRS.some(dir => barriers.get(CELL_KEY(add(p, dir))) === '深水') ? [p] : [];
      })).sort((a, b) => dist(a, preferred) - dist(b, preferred))[0];
    }
    if (harbor && outside(harbor)) {
      const [x, y] = harbor;
      sites.push({ x, y, kind: 'harbor', label: coast ? '湾内码头' : '沿江码头' });
    }
  }
  let deploy;
  if (naval) {
    deploy = [zone('主登陆滩', world(shore(-10) - 3, -10), [2, 3], outside),
      zone('侧翼小湾', world(shore(10) - 2, 10), [2, 2], outside)].filter(Boolean);
  } else {
    const normal = [ax, ay];
    const at = point(exteriorGate);
    const distance = type === 'pass' ? 8 - 2 * Number(expanded)
      : type === 'field' ? 15 - 3 * Number(expanded) : 9 - 2 * Number(expanded);
    const bridgeApproach = alignedWestBridge && approachSide === 'w';
    // 并州西门正对两格宽木桥。攻军留在外岸，从桥头的旱地上集结。
    const start = bridgeApproach ? world(band(1) + 5, 1) : add(at, normal, distance);
    const staging = p => {
      if (!outside(p)) return false;
      if (!bridgeApproach) return true;
      const [u,v] = uv(...p);
      return u > band(v) + 2;
    };
    const pool = map.flatMap((row, y) => row.flatMap((_, x) => staging([x, y]) ? [[x, y]] : []))
      .sort((a, b) => dist(a, start) - dist(b, start) || toward(b) - toward(a));
    const bases = pool.slice(0, 55).map(p => zone(type === 'field' ? '城外集结地' : (SIDENAMES[approachSide] + '侧集结地'), p,
      ax ? [2, 3] : [3, 2], staging));
    const base = bases.find(z => z.cells.length >= 17);
    deploy = base ? [base] : bases.sort((a, b) => b.cells.length - a.cells.length).slice(0, 1);
    if (outerCamps && type !== 'pass') {
      const access = roadSearch(map, barriers, roads, blockedRoutes, deploy[0].anchor);
      const selected = new Set();
      const ordered = [...CORNERS].sort((a, b) => (b[0] - a[0]) * ax + (b[1] - a[1]) * ay
        || dist([cx + a[0] * rx, cy + a[1] * ry], start) - dist([cx + b[0] * rx, cy + b[1] * ry], start));
      const corners = [];
      for (const [dx, dy, name] of ordered) {
        // 角区取可通行岸地，布阵格之间留出缓冲，也避开城门、渡点和前营。
        const allowed = p => outside(p) && Number.isFinite(access.cost(p)) && outsideGap(p) >= 5
          && (p[0] - cx) * dx > 1 && (p[1] - cy) * dy > 1 && !selected.has(CELL_KEY(p))
          && !roads.has(CELL_KEY(p)) && !nearSite(p, 3)
          && (map[p[1]][p[0]] === PLAIN || map[p[1]][p[0]] === SAND || map[p[1]][p[0]] === FOREST);
        const target = [clamp(cx + dx * (rx + 6), 3, w - 4), clamp(cy + dy * (ry + 6), 3, h - 4)];
        if (bridgeApproach && dx < 0) target[1] = clamp(start[1] + dy * 3, 3, h - 4);
        const seeds = map.flatMap((row, y) => row.flatMap((_, x) => allowed([x, y]) ? [[x, y]] : []))
          .sort((a, b) => dist(a, target) - dist(b, target));
        const minimum = grouped ? 10 : 9;
        for (const seed of seeds) {
          const area = zone(name + '集结地', seed, [2, 2], allowed);
          if (area.cells.length < minimum) continue;
          const pending = new Set(area.cells.map(CELL_KEY)), connected = [seed];
          pending.delete(CELL_KEY(seed));
          for (const p of connected) for (const dir of DIRS) {
            const q = add(p, dir);
            if (pending.delete(CELL_KEY(q))) connected.push(q);
          }
          if (connected.length < minimum) continue;
          connected.forEach(p => selected.add(CELL_KEY(p)));
          corners.push({ ...area, cells: connected, rect: rectOf(connected), corner: name });
          break;
        }
      }
      if (corners.length >= 2) {
        // 同侧优先选实际引道较短的角区，避免隔河看似贴近城门却要绕到另一岸。
        const [first, second] = corners;
        const onApproachSide = ({ anchor: [x, y] }) => (x - cx) * ax + (y - cy) * ay > 0;
        if (grouped && onApproachSide(first) && onApproachSide(second)) {
          const routeCost = ({ anchor }) => {
            const search = roadSearch(map, barriers, roads, blockedRoutes, anchor);
            if (camp) return search.cost(point(camp));
            return Math.min(...outerGates.map(g => search.cost(add(point(g), SIDES[g.face]))));
          };
          if (routeCost(second) + 2 < routeCost(first)) [corners[0], corners[1]] = [second, first];
        }
        deploy = corners;
      }
    }
  }

  const starts = deploy.flatMap(z => z.cells);
  if (starts.length < 17) throw new Error('攻方布阵地格不足 ' + id + '/' + side);
  for (const z of deploy) {
    for (const p of z.cells) {
      // 保留真实的岸线和峭壁，只将可站的布阵区整理为道路或沙地。
      if (map[p[1]][p[0]] !== SAND && !roads.has(CELL_KEY(p))) map[p[1]][p[0]] = PLAIN;
      used.add(CELL_KEY(p));
    }
    if (naval) sites.push({ x: z.anchor[0], y: z.anchor[1], label: z.name, kind: 'landing' });
  }

  // 收束防守地盘按实际街区划分。布阵优先将总大将放在主堡，将其他部队放在近门和支援位置。
  const defenseCells = [...districts].map(k => k.split(',').map(Number)).filter(tileFree);
  const closeGate = point(exteriorGate);
  const front = defenseCells.filter(p => !innerDistrict.has(CELL_KEY(p)) && dist(p, closeGate) <= 5)
    .sort((a, b) => dist(a, closeGate) - dist(b, closeGate));
  const centerFirst = defenseCells.sort((a, b) => dist(a, keep) - dist(b, keep));
  const fieldLine = camp ? zone('城外守军营地', point(camp), [2, 2], p => outside(p) && !used.has(CELL_KEY(p)))?.cells ?? [] : [];
  let stationed = camp ? [point(camp), fieldLine[1], front[0], ...fieldLine.slice(2, 5), ...front.slice(1, 5), ...fieldLine.slice(5, 7)]
    : [keep, ...front.slice(0, 5)];
  if (expanded) {
    stationed = [keep];
    if (camp) stationed.push(point(camp));
    for (const gate of [exteriorGate, ...outerGates.filter(g => g !== exteriorGate)]) {
      const post = [...defenseCells].filter(p => stationed.every(q => dist(p, q) >= 3))
        .sort((a, b) => dist(a, point(gate)) - dist(b, point(gate)))[0];
      if (post) stationed.push(post);
    }
    if (camp) stationed.push(...fieldLine.filter(p => dist(p, point(camp)) >= 2).slice(0, 2));
    for (const p of centerFirst) if (stationed.every(q => dist(p, q) >= 3)) stationed.push(p);
  }
  const defender = [...stationed.filter(Boolean), ...centerFirst]
    .filter((p, i, all) => all.findIndex(other => dist(other, p) === 0) === i).slice(0, 16);
  defender.forEach(p => used.add(CELL_KEY(p)));
  const attacker = [];
  for (let i = 0; attacker.length < 17; i++) for (const z of deploy) if (z.cells[i] && attacker.length < 17) attacker.push(z.cells[i]);

  const routes = [], routeGateKeys = new Set();
  for (const z of deploy) {
    const search = roadSearch(map, barriers, roads, blockedRoutes, z.anchor);
    const options = outerGates.map(g => {
      const approach = add(point(g), SIDES[g.face]);
      return { g, approach, cost: search.cost(approach) };
    }).filter(o => Number.isFinite(o.cost)).sort((a, b) => (a.g.face === approachSide ? -3 : 0) + a.cost - b.cost - (b.g.face === approachSide ? -3 : 0));
    const max = deploy.length > 1 ? 1 : type === 'capital' ? 3 : type === 'pass' ? 1 : 2;
    if (camp && Number.isFinite(search.cost(point(camp)))) routes.push({ kind: 'main', cells: search.path(point(camp)), goal: camp });
    const gatesForZone = [...options.filter(o => !routeGateKeys.has(CELL_KEY(point(o.g)))),
      ...options.filter(o => routeGateKeys.has(CELL_KEY(point(o.g))))].slice(0, max);
    for (const { g, approach } of gatesForZone) {
      const cells = search.path(approach).concat([point(g)]);
      if (cells.length < 2) continue;
      routeGateKeys.add(CELL_KEY(point(g)));
      routes.push({ kind: routes.length ? 'flank' : 'main', cells, goal: { x: g.x, y: g.y, label: SIDENAMES[g.face] + '门' } });
    }
    const path = plankWays.get(approachSide);
    if (path && Number.isFinite(search.cost(path.plank[0]))) {
      const cells = [...search.path(path.plank[0]).slice(0,-1), ...path.plank, ...path.exit.slice(1)];
      const [x,y] = cells.at(-1);
      routes.push({ kind: 'flank', cells, goal: { x, y, label: '栈道至内关' } });
    }
  }
  if (!routes.length) throw new Error('无可用进军路线 ' + id + '/' + side);
  for (const { cells } of routes) for (const p of cells) if (!outline.has(CELL_KEY(p)) && !roads.has(CELL_KEY(p))) setRoad(p, 'road');

  // 两路都保留实际可达的连接。前哨的收益仍是原有两点，场面增大不额外给资源。
  const primary = routes[0].cells, midway = primary[Math.floor(primary.length * 0.52)];
  const freePost = p => outside(p) && map[p[1]][p[0]] !== RIVER && !used.has(CELL_KEY(p))
    && (!outerCamps || (map[p[1]][p[0]] !== MOUNT && !nearSite(p, 3)
      && (type === 'pass' || outsideGap(p) >= 3)));
  const beside = path => path.flatMap(p => DIRS.map(d => add(p, d))).find(p => freePost(p) && !roads.has(CELL_KEY(p)));
  const post = outerCamps
    ? beside([...primary].sort((a, b) => dist(a, midway) - dist(b, midway))) ?? beside(routes.slice(1).flatMap(r => r.cells))
      ?? routes.flatMap(r => r.cells).find(freePost)
    : beside([midway]) ?? primary.find(freePost) ?? deploy[0].anchor;
  if (!post) throw new Error('前哨周围无可用地格 ' + id + '/' + side);
  const [px, py] = post;
  used.add(CELL_KEY(post));
  if (outerCamps && map[py][px] === FOREST) map[py][px] = PLAIN;

  for (const gate of gates) {
    const [dx, dy] = SIDES[gate.face];
    for (let p = point(gate), i = 0; i <= 2; i++, p = add(p, [dx, dy], -1)) {
      const k = CELL_KEY(p);
      if (!i || tileFree(p)) paving.set(k, { x: p[0], y: p[1], face: gate.face });
      else break;
    }
  }

  const placedShops = [];
  const leadsTo = (route, gate) => gate.x === route.goal.x && gate.y === route.goal.y;
  const gateRoute = routes.find(r => leadsTo(r, exteriorGate))?.cells
    ?? routes.find(r => outerGates.some(g => leadsTo(r, g)))?.cells ?? primary;
  const sideRoute = routes.find(r => r.kind === 'flank' && r.cells !== gateRoute)?.cells ?? primary;
  const sample = (path, part) => path[Math.round((path.length - 1) * part)];
  const shopAnchors = {
    米店: sample(primary, 0.26), 武器店: sample(gateRoute, 0.85), 病院: sample(sideRoute, 0.48),
  };
  const shopTiles = [];
  const sectorOf = ([x, y]) => CORNERS.findIndex(([dx, dy]) => (x < cx ? -1 : 1) === dx && (y < cy ? -1 : 1) === dy);
  const shopSectors = new Set();
  if (expanded && villages.length) {
    const routesCells = routes.flatMap(r => r.cells);
    const access = roadSearch(map, barriers, roads, blockedRoutes, deploy[0].anchor);
    const landmarks = [post, ...sites.map(point), ...gates.map(point)];
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const p = [x,y], k = CELL_KEY(p), tile = map[y][x];
      if (!outside(p) || used.has(k) || roads.has(k) || tile === RIVER || tile === MOUNT || !Number.isFinite(access.cost(p))) continue;
      if (landmarks.some(site => dist(p,site) < (outerCamps ? 4 : 2)) || DIRS.some(dir => outline.has(CELL_KEY(add(p,dir))))) continue;
      const roadside = Math.min(...routesCells.map(cell => dist(cell,p)));
      shopTiles.push({ p, roadside });
    }
  }
  villages = villages.map((v, i) => {
    let p;
    if (expanded) {
      const seed = shopAnchors[v.kind] ?? sample(primary, 0.5);
      const score = ({ p, roadside }) => dist(p, seed) + roadside * 2.2;
      const choices = shopTiles.filter(({ p }) => placedShops.every(other => dist(p,other) >= 4));
      if (outerCamps) {
        const rank = e => {
          const sector = sectorOf(e.p), [dx, dy] = CORNERS[sector];
          const corner = [clamp(cx + dx * (rx + 4), 2, w - 3), clamp(cy + dy * (ry + 4), 2, h - 3)];
          return (shopSectors.has(sector) ? 1000 : 0) + dist(e.p, corner) * 2 + e.roadside * 2
            + dist(e.p, seed) * (i === 0 ? 0.75 : 0.35);
        };
        p = choices.sort((a, b) => rank(a) - rank(b))[0]?.p;
      } else p = choices.sort((a, b) => score(a) - score(b))[0]?.p;
    } else {
      const seed = add(deploy[0].anchor, tangent, i % 2 ? -5 : 5);
      p = (i === 0 ? [...primary].reverse() : primary).flatMap(p => DIRS.map(dir => add(p, dir)))
        .filter(p => outside(p) && !used.has(CELL_KEY(p)) && !roads.has(CELL_KEY(p)))
        .sort((a, b) => dist(a, seed) - dist(b, seed))[0];
    }
    if (!p) return null;
    if (outerCamps) shopSectors.add(sectorOf(p));
    placedShops.push(p);
    used.add(CELL_KEY(p)); map[p[1]][p[0]] = PLAIN;
    return { ...v, x: p[0], y: p[1] };
  }).filter(Boolean);

  map[keep[1]][keep[0]] = CASTLE;
  const [left, right, top, bottom] = rectOf([...districts].map(k => k.split(',').map(Number)));
  const extents = [Math.max(keep[0] - left, right - keep[0]), Math.max(keep[1] - top, bottom - keep[1])];
  const siege = { cx: keep[0], cy: keep[1], inner, outer, bounds: { inner: [2, 2], outer: extents, moat: extents.map(n => n + 1) },
    type, style: cityPlan.style, revision, direction: approachSide, districts, innerDistrict,
    walls, gates, paving: [...paving.values()], crossings: [], moatCells: moat, camp,
    ...(expanded && streets.size ? { streets } : {}) };
  const defenderZones = camp ? [
    { name: '外营驻地', cells: fieldLine, rect: rectOf(fieldLine), anchor: point(camp) },
    { name: '城内守备', cells: defenseCells, rect: rectOf(defenseCells), anchor: keep },
  ] : [{ name: '守军阵地', cells: defenseCells, rect: rectOf(defenseCells), anchor: defender[0] }];
  return { map, villages, siege,
    dep: { attacker, defender, attacker_rect: rectOf(starts), defender_rect: rectOf(defender),
      attackerZones: deploy, defenderZones, ...(grouped && deploy.length > 1 ? { grouped: true } : {}) },
    approaches: { routes, roads, barriers, post: { x: px, y: py }, sites, geography },
    entry: approachSide, label,
  };
}
