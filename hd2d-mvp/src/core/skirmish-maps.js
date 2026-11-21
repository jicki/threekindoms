// 白兵阵位沿用原来的两侧，中线始终留出至少两条陆路。坐标顺序为行、列、地形。
const SITE_LAYOUTS = {
  bridge: [[1,7,3],[2,7,3],[7,8,3],[8,8,3]],
  ford: [[1,7,3],[1,8,3],[3,7,3],[6,8,3],[8,7,3],[8,8,3]],
  plank: [[1,8,2],[2,7,2],[3,7,2],[6,8,2],[7,8,2],[8,7,2]],
  camp: [[1,7,1],[2,8,1],[7,7,1],[8,8,1]],
  streets: [[0,7,5],[1,7,5],[3,8,5],[6,7,5],[7,8,5],[9,7,5]],
  beach: [[1,7,1],[2,7,1],[7,8,1],[8,8,1]],
};
export function skirmishMap(base, terrain, profile) {
  if (!profile) return base;
  const map = base.map(row => [...row]), local = SITE_LAYOUTS[profile.tacticalSite];
  if (local) {
    for (let y = 0; y < map.length; y++) for (const x of [7, 8]) map[y][x] = 0;
    for (const [y, x, tile] of local) map[y][x] = tile;
    return map;
  }
  if (terrain === 3) {
    const bridges = profile.region === '海滨' ? [2, 7] : [3, 6];
    for (let y = 0; y < map.length; y++) for (const x of [7, 8]) map[y][x] = bridges.includes(y) ? 0 : 3;
  } else if (terrain === 4 || profile.kind === 'pass' && terrain === 2) {
    for (let x = 6; x <= 9; x++) {
      map[2][x] = 0;
      map[3][x] = x % 2 === 0 ? 2 : 0;
    }
  } else if (terrain === 5 && profile.kind === 'city') {
    for (const y of [2, 7]) for (const x of [7, 8, 9]) map[y][x] = 0;
    for (const y of [3, 6]) map[y][8] = 5;
  }
  return map;
}
