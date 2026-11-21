// 深浅只用于配色。岸线和可通行区域仍由真实地形绘制和拾取。
export function waterDepth(w, h, wet) {
  const distances = Float32Array.from({ length: w * h }, (_, i) => wet(i % w, Math.floor(i / w)) ? 32 : 0);
  const relax = (x, y, dx, dy, cost) => {
    if (x + dx < 0 || x + dx >= w || y + dy < 0 || y + dy >= h) return;
    const i = y * w + x;
    distances[i] = Math.min(distances[i], distances[i + dy * w + dx] + cost);
  };
  for (const dir of [1, -1]) {
    const x0 = dir === 1 ? 0 : w - 1, y0 = dir === 1 ? 0 : h - 1;
    for (let y = y0; y >= 0 && y < h; y += dir) for (let x = x0; x >= 0 && x < w; x += dir) {
      relax(x, y, -dir, 0, 1); relax(x, y, 0, -dir, 1);
      relax(x, y, -1, -dir, Math.SQRT2); relax(x, y, 1, -dir, Math.SQRT2);
    }
  }
  return (x, y) => {
    x = Math.max(0, Math.min(w - 1, x)); y = Math.max(0, Math.min(h - 1, y));
    const left = Math.floor(x), top = Math.floor(y), right = Math.min(left + 1, w - 1), bottom = Math.min(top + 1, h - 1);
    const u = x - left, v = y - top;
    return (distances[top*w + left] * (1-u) + distances[top*w + right] * u) * (1-v)
      + (distances[bottom*w + left] * (1-u) + distances[bottom*w + right] * u) * v;
  };
}

const RIVER_TONES = [[151, 174, 147], [95, 140, 133], [53, 102, 116]];
const COAST_TONES = [[155, 193, 175], [78, 153, 147], [35, 82, 119]];
export function waterColor(depth, coast) {
  const palette = coast ? COAST_TONES : RIVER_TONES;
  const shelf = coast ? 1.25 : 0.96, limit = coast ? 4.2 : 2.65;
  const first = depth <= shelf;
  const t = Math.max(0, Math.min(1, first ? depth / shelf : (depth - shelf) / (limit - shelf)));
  const k = t * t * (3 - 2 * t), i = first ? 0 : 1;
  return palette[i].map((v, c) => Math.round(v + (palette[i + 1][c] - v) * k));
}

// 全国地图的海岸场景用青色浅海与深蓝外海，城壕和内陆河谷偏灰绿。
export const isCoastalBattle = field => ['island', 'coast'].includes(field.siege?.type);

export function townSurface(field, court) {
  const siege = field.siege;
  if (!siege || !field.approaches?.barriers || siege.type === 'pass') return () => false;
  const stones = new Set(siege.paving.map(({x, y}) => `${x},${y}`));
  return (x, y) => {
    if (court?.paving(x,y)) return true;
    const k = `${x},${y}`;
    return stones.has(k) || (siege.districts.has(k) && Math.abs(x - siege.cx) + Math.abs(y - siege.cy) <= 2);
  };
}
