import { gateNormal, siegeExtent } from './siege.js';

export const APPROACH_CAMPAIGN_REVISION = 12;
export const APPROACH_SIEGE_REVISION = 5;
export const POST_MOBILITY = 2;

const MARGIN = 4, FOREST = 0, SAND = 1, PLAIN = 2, RIVER = 3, MOUNT = 4;
const key = (x, y) => `${x},${y}`;
const offset = ([x, y], [dx, dy], n) => [x + dx * n, y + dy * n];
const cell = ({ x, y }) => [x, y];
const distance = ([ax, ay], [bx, by]) => Math.abs(ax - bx) + Math.abs(ay - by);
const SHIFT = [MARGIN, MARGIN];
const shift = point => offset(point, SHIFT, 1);
const translate = mark => ({ ...mark, x: mark.x + MARGIN, y: mark.y + MARGIN });
const rect = bounds => bounds.map(value => value + MARGIN);

// 把相邻拐点展开成同一套可点击、可寻路、可绘制的道路地格。
function road(waypoints) {
  const [start, ...ends] = waypoints, out = [start];
  let [x, y] = start;
  for (const [endX, endY] of ends) {
    while (x !== endX) { x += Math.sign(endX - x); out.push([x, y]); }
    while (y !== endY) { y += Math.sign(endY - y); out.push([x, y]); }
  }
  return out;
}

// 海岸与河道接续原地形。新增外围依据据点主题分出林带、山脊和旱地。
function extendTerrain(map, profile) {
  const h = map.length, w = map[0].length;
  const ridge = ['山地', '关隘', '峡谷'].includes(profile.region);
  const dry = ['边塞', '北境'].includes(profile.region);
  return Array.from({ length: h + 2 * MARGIN }, (_, row) => Array.from({ length: w + 2 * MARGIN }, (_, column) => {
    const x = column - MARGIN, y = row - MARGIN;
    const dx = Math.max(0, -x, x - w + 1), dy = Math.max(0, -y, y - h + 1);
    if (!dx && !dy) return map[y][x];
    const edge = map[Math.max(0, Math.min(y, h - 1))][Math.max(0, Math.min(x, w - 1))];
    if (edge !== PLAIN) return edge;
    const ridgeLine = Math.sin((column + profile.id * 3) * 0.29) + Math.cos((row - profile.id) * 0.43);
    if (ridgeLine > 0.35) return ridge && Math.max(dx, dy) >= 2 ? MOUNT : FOREST;
    return dry && ridgeLine < -0.45 ? SAND : PLAIN;
  }));
}

export function extendBattleApproaches({ map: original, dep, villages, siege: old }, profile) {
  const map = extendTerrain(original, profile);
  const siege = { ...old, revision: APPROACH_SIEGE_REVISION, cx: old.cx + MARGIN, cy: old.cy + MARGIN,
    walls: old.walls.map(translate), gates: old.gates.map(translate), crossings: old.crossings.map(translate), paving: old.paving.map(translate) };
  villages = villages.map(translate);
  const front = siege.crossings.find(mark => mark.face === siege.direction), normal = gateNormal(siege, front);
  const advance = p => offset(shift(p), normal, 2);
  const a0 = advance(dep.attacker[0]);
  const attackerRect = [...advance([dep.attacker_rect[0], dep.attacker_rect[2]]), ...advance([dep.attacker_rect[1], dep.attacker_rect[3]])];
  const [x0, y0, x1, y1] = attackerRect;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) map[y][x] = PLAIN;
  dep = { attacker: dep.attacker.map(advance), attacker_rect: [x0, x1, y0, y1], defender: dep.defender.map(shift),
    defender_rect: rect(dep.defender_rect) };

  const main = road([a0, cell(front)]);
  const [nx, ny] = normal, [mx, my] = siegeExtent(siege, 'moat');
  const sideGates = siege.crossings.filter(mark => {
    const [dx, dy] = gateNormal(siege, mark);
    return dx * nx + dy * ny === 0;
  });
  const options = sideGates.length ? sideGates.map(mark => [mark, gateNormal(siege, mark)])
    : [-1, 1].map(sign => [null, [ny * sign, nx * sign]]);
  if (profile.id % 2) options.reverse();
  const candidates = options.map(([side, sideNormal]) => {
    const edge = side ? (nx ? my : mx) + 3 : 4;
    const sideAxis = side ? offset([siege.cx, siege.cy], sideNormal, edge) : offset(cell(front), sideNormal, edge);
    const firstTurn = nx ? [a0[0], sideAxis[1]] : [sideAxis[0], a0[1]];
    const rejoin = offset(cell(side ?? front), side ? sideNormal : normal, side ? 3 : 2);
    const endTurn = side ? rejoin : offset(rejoin, sideNormal, edge);
    const cells = road([a0, firstTurn, endTurn, rejoin, cell(side ?? front)]);
    return { cells, water: cells.filter(([x, y]) => map[y][x] === RIVER).length };
  });
  // 水岸优先择陆侧进军，只在必要的渡口铺桥。
  candidates.sort((a, b) => a.water - b.water);
  const flank = candidates[0].cells;
  const routes = [{ kind: 'main', cells: main }, { kind: 'flank', cells: flank }];
  const roads = new Map();
  for (const [x, y] of [...main, ...flank]) {
    const k = key(x, y);
    if (!roads.has(k)) roads.set(k, { x, y, bridge: map[y][x] === RIVER });
    map[y][x] = PLAIN;
  }
  const sites = new Set(villages.map(v => key(v.x, v.y)));
  const midway = flank[Math.floor(flank.length / 2)];
  const offRoad = flank.flatMap(p => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(dir => offset(p, dir, 1)))
    .filter(([x, y]) => x > 0 && x < map[0].length - 1 && y > 0 && y < map.length - 1
      && (Math.abs(x - siege.cx) > mx || Math.abs(y - siege.cy) > my) && map[y][x] !== RIVER
      && !roads.has(key(x, y)) && !sites.has(key(x, y)) && !(x >= x0 && x <= x1 && y >= y0 && y <= y1));
  offRoad.sort((a, b) => distance(a, midway) - distance(b, midway));
  const [x, y] = offRoad[0] ?? midway;
  map[y][x] = PLAIN;
  return { map, dep, villages, siege, approaches: { routes, roads, post: { x, y } } };
}
