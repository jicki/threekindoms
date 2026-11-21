import { advancedBattle } from './battle-rules.js';
import { siegeLayout } from './siege.js';
import { APPROACH_CAMPAIGN_REVISION, APPROACH_SIEGE_REVISION, extendBattleApproaches } from './battle-approaches.js';

// 君主列传新开局的战场配置。原版和没有 battlefields 标记的旧记录仍使用导出数据。
// battlefields=1 的布局需要保持稳定；后续调整应新增版本，不能改写已中断战斗的布局。
// 主题只描述画面；战斗数值仍由地形、兵种和原有规则决定。
const THEMES = [
  ['北境', '边城'], ['北境', '北地城池'], ['山地', '山麓城池'], ['海滨', '沿海城池'], ['平原', '河北平原'],
  ['边塞', '草原边城'], ['边塞', '西北城池'], ['山地', '陇右山地'], ['都城', '关中都城'], ['山地', '西陲山地'],
  ['水乡', '淮泗水乡'], ['平原', '中原平原'], ['都城', '中原都城'], ['平原', '南阳平原'], ['平原', '中原城池'],
  ['水乡', '江东水乡'], ['水乡', '淮南水乡'], ['海滨', '东南山海'], ['海滨', '岭南水乡'], ['山地', '岭南山地'],
  ['水乡', '江夏渡口'], ['水乡', '荆楚水乡'], ['山地', '湘南丘陵'], ['水乡', '湘江水乡'], ['山地', '湘南山地'],
  ['山地', '汉中山川'], ['山地', '蜀中盆地'], ['山地', '巴蜀江谷'], ['山地', '南中山地'], ['山地', '西南山地'],
  ['水乡', '襄阳渡口'], ['山地', '江州江谷'], ['平原', '宛城原野'], ['关隘', '虎牢关道'], ['关隘', '函谷关道'],
  ['关隘', '武关山道'], ['关隘', '剑阁蜀道'], ['峡谷', '望垣峡谷'], ['海滨', '夷洲海岸'],
];
export const battlefieldProfile = (g, id) => [1, 2].includes(g?.battlefields) && THEMES[id]
  ? { id, region: THEMES[id][0], label: THEMES[id][1], kind: id >= 33 && id <= 37 ? 'pass' : 'city' } : null;

// 相邻据点的进入方向在此显式指定；多条路线不因对象键顺序意外使用同一布阵。
const DIRECTIONS = {
  30: { 13: 'n', 21: 's', 22: 'e' }, 31: { 26: 'w', 27: 'e' },
  32: { 12: 'n', 13: 's', 21: 'e' }, 33: { 11: 'e', 12: 'w' },
  34: { 8: 'w', 12: 'e' }, 35: { 8: 'n', 13: 's' },
  36: { 25: 'n', 26: 's' }, 37: { 9: 'n', 26: 's' }, 38: { 17: 'w' },
};
// 每个据点显式定义地貌轮廓：椭圆为山或林，水域的轴、位置和宽度分别配置。
// 这些是游戏内示意布局，不声称还原真实地貌。
const LANDSCAPES = {
  30: { woods: [[5, 5, 4, 3], [25, 13, 5, 3]], river: ['h', 6, 1] },
  31: { woods: [[7, 9, 3, 3], [25, 5, 4, 3]], hills: [[5, 3, 7, 3], [25, 16, 7, 3]], river: ['h', 12, 1] },
  32: { woods: [[7, 4, 4, 3], [26, 14, 4, 3]], sands: [[9, 13, 5, 3]] },
  33: { woods: [[7, 13, 3, 3], [25, 5, 4, 3]], hills: [[11, 3, 9, 3], [21, 16, 9, 3]] },
  34: { woods: [[6, 4, 3, 2], [26, 14, 4, 3]], hills: [[15, 2, 13, 3], [15, 16, 12, 3]] },
  35: { woods: [[6, 6, 5, 3], [24, 12, 4, 3]], hills: [[3, 12, 4, 5], [27, 5, 4, 4]] },
  36: { woods: [[8, 15, 4, 3], [23, 3, 4, 2]], hills: [[4, 8, 5, 8], [27, 10, 5, 8]] },
  37: { woods: [[5, 12, 3, 3], [27, 6, 3, 3]], hills: [[7, 3, 7, 3], [25, 15, 7, 3], [3, 10, 3, 4]] },
  38: { woods: [[18, 4, 5, 3], [25, 13, 4, 4]], hills: [[26, 7, 4, 3]], river: ['v', 7, 2] },
};
const W = 32, H = 19, PLAIN = 2, FOREST = 0, SAND = 1, RIVER = 3, MOUNT = 4, CASTLE = 5;
const RECTS = { n: [10, 21, 0, 2], s: [10, 21, 16, 18], w: [0, 3, 6, 12], e: [28, 31, 6, 12] };
const rectCells = ([x0, x1, y0, y1], x, y) => {
  const out = []; for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) out.push([xx, yy]);
  return out.sort((a, b) => (Math.abs(a[0] - x) + Math.abs(a[1] - y)) - (Math.abs(b[0] - x) + Math.abs(b[1] - y)) || a[1] - b[1] || a[0] - b[0]);
};
const ENTRY = { n: [15, 1], s: [15, 17], w: [1, 9], e: [30, 9] };
export function battleEntryDirection(data, city, from) {
  const dir = DIRECTIONS[city]?.[from];
  if (dir) return dir;
  const dep = data.deploy[city]?.[from];
  if (!dep) return null;
  const [ax, ay] = dep.attacker[0], [dx, dy] = dep.defender[0], x = ax - dx, y = ay - dy;
  return Math.abs(x) > Math.abs(y) ? (x < 0 ? 'w' : 'e') : (y < 0 ? 'n' : 's');
}
function deployment(direction) {
  const rect = RECTS[direction], [x, y] = ENTRY[direction];
  return { attacker: rectCells(rect, x, y).slice(0, 17), attacker_rect: [...rect],
    defender: rectCells([11, 19, 5, 13], 15, 9).slice(0, 16), defender_rect: [11, 19, 5, 13] };
}

// 地形采用固定的城市专属轮廓，而非随机战场。河、山仍是原有地形，移动与计略规则不变。
function newMap(id, directions, villages) {
  const grid = Array.from({ length: H }, () => Array(W).fill(PLAIN));
  const shape = LANDSCAPES[id];
  const inside = (x, y, ellipses = []) => ellipses.some(([cx, cy, rx, ry]) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (inside(x, y, shape.hills)) grid[y][x] = MOUNT;
    else if (inside(x, y, shape.woods)) grid[y][x] = FOREST;
    else if (inside(x, y, shape.sands)) grid[y][x] = SAND;
    if (shape.river) {
      const [axis, line, width] = shape.river, along = axis === 'h' ? x : y, across = axis === 'h' ? y : x;
      if (Math.abs(across - line - (Math.floor((along + id) / 9) % 2)) < width) grid[y][x] = RIVER;
    }
  }
  // 城周围留出机动空间，保护布阵区，避免生成时把部队放进水面或山坡。
  for (let y = 5; y <= 13; y++) for (let x = 11; x <= 19; x++) if (Math.abs(x - 15) + Math.abs(y - 9) <= 3) grid[y][x] = PLAIN;
  for (const dir of directions) { const [x0, x1, y0, y1] = RECTS[dir]; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) grid[y][x] = PLAIN; }
  for (const v of villages) grid[v.y][v.x] = PLAIN;
  grid[9][15] = CASTLE;
  return grid;
}

// 第二版修复河道的斜向断点和避开布阵区造成的断流，不改变第一版中断战斗。
function connectRivers(grid, villages, directions) {
  const forbidden = (x, y) => (x === 15 && y === 9) || villages.some(v => v.x === x && v.y === y)
    || directions.some(d => { const [x0, x1, y0, y1] = RECTS[d]; return x >= x0 && x <= x1 && y >= y0 && y <= y1; });
  const neighbours = (x, y) => [[x-1,y],[x+1,y],[x,y-1],[x,y+1]].filter(([a,b]) => a >= 0 && a < W && b >= 0 && b < H);
  for (;;) {
    const river = []; for (let y=0;y<H;y++) for (let x=0;x<W;x++) if (grid[y][x] === RIVER) river.push([x,y]);
    if (!river.length) return;
    const key = (x,y) => `${x},${y}`, seen = new Set([key(...river[0])]), q = [river[0]];
    for (let i=0;i<q.length;i++) for (const [x,y] of neighbours(...q[i])) if (grid[y][x] === RIVER && !seen.has(key(x,y))) { seen.add(key(x,y)); q.push([x,y]); }
    if (river.every(([x,y]) => seen.has(key(x,y)))) return;
    const search = [...q], prev = new Map(search.map(([x,y]) => [key(x,y), null])); let end = null;
    for (let i=0; i<search.length && !end; i++) for (const [x,y] of neighbours(...search[i])) {
      const k = key(x,y); if (prev.has(k) || forbidden(x,y)) continue;
      prev.set(k, key(...search[i]));
      if (grid[y][x] === RIVER && !seen.has(k)) { end = k; break; }
      search.push([x,y]);
    }
    if (!end) return;
    for (let k=end; k; k=prev.get(k)) { const [x,y]=k.split(',').map(Number); grid[y][x] = RIVER; }
  }
}

// 返回独立数据，不改静态地图；旧中断存档没有标记，仍由调用者使用原数据。
export function battlefieldLayout(data, g, city, from) {
  const profile = battlefieldProfile(g, city), dirs = DIRECTIONS[city];
  if (!profile || !dirs) return null;
  const villages = structuredClone(data.villages[city] ?? []), direction = dirs[from];
  if (!direction) return null; // 历史路线或袭扰来源沿用兼容布阵
  const map = newMap(city, Object.values(dirs), villages);
  if (g.battlefields === 2) connectRivers(map, villages, Object.values(dirs));
  return { profile, map, dep: deployment(direction), villages, direction };
}

// 战场、中断校验和电脑自动结算共用同一个场地入口。
export function resolveBattlefield(data, g, city, from, revision) {
  const layout = battlefieldLayout(data, g, city, from), profile = battlefieldProfile(g, city);
  const entry = layout?.direction ?? (advancedBattle(g) ? battleEntryDirection(data, city, from) : null);
  const dep = layout?.dep ?? (data.deploy[city]?.[from] || Object.values(data.deploy[city] ?? {})[0]);
  const map = layout?.map ?? data.maps[city], villages = layout?.villages ?? data.villages[city] ?? [];
  if (g.battlefields !== 2 || !dep) return { map, dep, villages, profile, entry, siege: null };
  const current = g.campaignRevision >= APPROACH_CAMPAIGN_REVISION ? APPROACH_SIEGE_REVISION
    : g.campaignRevision >= 9 ? 4 : advancedBattle(g) ? 3 : 2;
  const selected = revision ?? current;
  if (![1, 2, 3, 4, APPROACH_SIEGE_REVISION].includes(selected) || selected > current) throw new Error('当前战役不支持该城防布局');
  const fortress = siegeLayout(map, dep, villages, layout?.direction, city === 30 || city === 31, Math.min(selected, 4), profile);
  const battle = selected === APPROACH_SIEGE_REVISION ? extendBattleApproaches(fortress, profile) : fortress;
  return { ...battle, profile, entry };
}
