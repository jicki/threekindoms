// 只修改双方部署线之间的地格，四套阵法均可沿用原有布阵位置。
export function skirmishMap(base, terrain, profile) {
  if (!profile) return base;
  const map = base.map(row => [...row]);
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
