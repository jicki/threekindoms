// 君主列传的可选地图。编号只追加，不改变原有城市和已发布剧本的基础数据。
export const EXPANDED_MAP_ID = 'builtin-sovereigns-expanded-map';
export const EXPANDED_NODES = Object.freeze([
  { id: 30, name: '襄阳', kind: 'city', road: [13, 21], template: 13, fraction: 0.50,
    sandOffset: [-0.50, 0.02, 0], flatOffset: [-60, 0], geoOffset: [-0.56, 0] },
  { id: 31, name: '江州', kind: 'city', road: [26, 27], template: 27, fraction: 0.50 },
  { id: 32, name: '宛城', kind: 'city', road: [12, 13], template: 13, fraction: 0.50,
    sandOffset: [0.55, -0.01, 0.70], flatOffset: [68, 78], geoOffset: [0.61, -0.70] },
  { id: 33, name: '虎牢关', kind: 'pass', road: [11, 12], template: 12, fraction: 0.50 },
  { id: 34, name: '函谷关', kind: 'pass', road: [8, 12], template: 8, fraction: 0.50 },
  { id: 35, name: '武关', kind: 'pass', road: [8, 13], template: 9, fraction: 0.50 },
  { id: 36, name: '剑阁', kind: 'pass', road: [25, 26], template: 25, fraction: 0.50 },
]);
// 望垣峡是史籍中的峡谷，位置取西平至蜀地道路的示意；夷洲与现今岛屿的对应存在争议。
export const FRONTIER_PASS = Object.freeze({ id: 37, name: '望垣峡', kind: 'pass', road: [9, 26], template: 9, fraction: 0.28 });
export const FRONTIER_ISLAND = Object.freeze({ id: 38, name: '夷洲', kind: 'city', road: [17], template: 17,
  lon: 120.89, lat: 23.8, sand: [8.45, 0.30, 7.7], flat: [2942, 2226] });
export const expandedNodes = (frontier = false) => frontier ? [...EXPANDED_NODES, FRONTIER_PASS, FRONTIER_ISLAND] : EXPANDED_NODES;

// 新开局一次性补给：不修改静态剧本和已保存的城市状态。
const OPENING_SUPPLIES = [
  { city: 8, faction: 0, gold: 100, rice: 200, reserve: 100, minGov: 30 },
  { city: 12, faction: 0, gold: 150, rice: 260, reserve: 100, minGov: 30 },
  { city: 13, faction: 8, gold: 150, rice: 300, reserve: 150, minGov: 50 },
];

export function applyExpandedOpening(g) {
  for (const { city, faction, gold, rice, reserve, minGov } of OPENING_SUPPLIES) {
    const c = g.cities[city];
    if (!c || c.faction !== faction) continue;
    c.gold = Math.min(9999, c.gold + gold); c.rice = Math.min(9999, c.rice + rice);
    c.reserve = Math.min(10000, c.reserve + reserve); c.gov = Math.max(c.gov, minGov);
  }
}

// 在现有版本数据应用后调用；基础数据与旧版的签名不变。
export function expandMap(data) {
  const d = structuredClone(data), none = d.factions.length;
  if (d.cities.length !== 30) throw new Error('扩展地图需要原始三十城基础数据');
  d.expandedMap = true;
  for (const node of d.frontierMap ? [...EXPANDED_NODES, FRONTIER_PASS] : EXPANDED_NODES) {
    const [a, b] = node.road, originalA = d.cities[a], originalB = d.cities[b];
    if (!originalA.roads.includes(b) || !originalB.roads.includes(a)) throw new Error(`扩展地图道路无效：${node.name}`);
    originalA.roads = originalA.roads.map((n) => n === b ? node.id : n);
    originalB.roads = originalB.roads.map((n) => n === a ? node.id : n);
    const template = d.cities[node.template];
    const city = { ...structuredClone(template), id: node.id, name: node.name, faction: none, officers: [], roads: [a, b],
      gold: 120, rice: 200, pop: 150, land: 20, industry: 20, disaster: 35, gov: 55, reserve: 100, treasure: 0 };
    if (node.kind === 'pass') Object.assign(city, {
      kind: 'pass', gold: 0, rice: 0, pop: 0, land: 0, industry: 0, disaster: 99, gov: 100, reserve: 0,
      facilities: { weapons: false, school: false, market: false, hospital: false }, rice_rate: [0, 0], shop: [], field_shop: [], ai_shop: [],
    });
    d.cities.push(city);
    // 保留每个方向原有的出阵位置；关隘复用区域相近的地形，分别体现中原、关中和蜀道。
    d.deploy[a][node.id] = d.deploy[a][b];
    d.deploy[b][node.id] = d.deploy[b][a];
    // 旧记录可能正中断在西平与成都之间的战场，保留该路线的旧布阵供恢复。
    if (node.id !== FRONTIER_PASS.id) { delete d.deploy[a][b]; delete d.deploy[b][a]; }
    const deployments = Object.values(d.deploy[node.template]);
    d.maps[node.id] = structuredClone(d.maps[node.template]);
    d.deploy[node.id] = { [a]: structuredClone(deployments[0]), [b]: structuredClone(deployments[1] ?? deployments[0]) };
    d.villages[node.id] = node.kind === 'pass' ? [] : structuredClone(d.villages[node.template] ?? []);
    d.search_table[String(node.id)] = [];
  }
  if (d.frontierMap) {
    const n = FRONTIER_ISLAND, home = d.cities[n.road[0]], template = d.cities[n.template];
    home.roads.push(n.id);
    d.cities.push({ ...structuredClone(template), id: n.id, name: n.name, faction: none, officers: [], roads: [...n.road],
      gold: 100, rice: 180, pop: 120, land: 15, industry: 15, disaster: 35, gov: 55, reserve: 80, treasure: 0 });
    d.deploy[home.id][n.id] = structuredClone(d.deploy[home.id][18]);
    d.deploy[n.id] = { [home.id]: structuredClone(Object.values(d.deploy[n.template])[0]) };
    d.maps[n.id] = structuredClone(d.maps[n.template]);
    d.villages[n.id] = structuredClone(d.villages[n.template] ?? []);
    d.search_table[String(n.id)] = [];
    d.rules.flood_cities.push(n.id);
  }
  // 扩张后的命令书不继续增长，避免额外城市造成滚雪球。
  while (d.rules.books.length <= d.cities.filter((c) => c.kind !== 'pass').length) d.rules.books.push(d.rules.books.at(-1));
  d.rules.drought_cities.push(30, 32);
  d.rules.flood_cities.push(30, 31);
  return d;
}

// 将预烘焙道路在同一个采样点拆分；偏离道路的据点通过短支路连接原线路。
export function splitMapRoads(roads, dimensions, addNode, frontier = false) {
  for (const node of frontier ? [...EXPANDED_NODES, FRONTIER_PASS] : EXPANDED_NODES) {
    const [a, b] = node.road;
    const index = roads.findIndex((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a));
    if (index < 0) throw new Error(`扩展地图缺少道路：${node.name}`);
    const road = roads[index], count = road.p.length / dimensions;
    const cut = Math.max(1, Math.min(count - 2, Math.round((count - 1) * node.fraction)));
    const point = road.p.slice(cut * dimensions, (cut + 1) * dimensions);
    const site = addNode(node, point) ?? point;
    const first = { ...road, b: node.id, p: road.p.slice(0, (cut + 1) * dimensions) };
    const second = { ...road, a: node.id, p: road.p.slice(cut * dimensions) };
    if (road.sea) { first.sea = road.sea.slice(0, cut + 1); second.sea = road.sea.slice(cut); }
    if (site.some((value, i) => value !== point[i])) {
      const steps = 12, spur = [];
      for (let i = 0; i <= steps; i++) for (let axis = 0; axis < dimensions; axis++) {
        spur.push(i === 0 ? point[axis] : i === steps ? site[axis] : point[axis] + (site[axis] - point[axis]) * i / steps);
      }
      const reverse = [];
      for (let i = steps; i >= 0; i--) reverse.push(...spur.slice(i * dimensions, (i + 1) * dimensions));
      first.p.push(...spur.slice(dimensions)); second.p = [...reverse, ...second.p.slice(dimensions)];
      if (road.sea) { first.sea.push(...Array(steps).fill(false)); second.sea = [...Array(steps).fill(false), ...second.sea]; }
      first.spur = spur;
    }
    roads.splice(index, 1, first, second);
  }
}

export function expandedSandMeta(meta, frontier = false) {
  const copy = { ...meta, cities: [...meta.cities], roads: [...meta.roads] };
  splitMapRoads(copy.roads, 3, (n, point) => {
    const [x, y, z] = point.map((value, i) => value + (n.sandOffset?.[i] ?? 0));
    copy.cities.push({ id: n.id, name: n.name, tier: n.kind === 'pass' ? 'pass' : 'county',
      x, y, z, mx: x, mz: z, ms: n.kind === 'pass' ? 0.55 : 0.7, outpost: n.kind === 'pass' });
    return [x, y, z];
  }, frontier);
  if (frontier) {
    const n = FRONTIER_ISLAND, [x, y, z] = n.sand, home = copy.cities[n.road[0]], count = 96, p = [];
    for (let i = 0; i <= count; i++) { const t = i / count; p.push(home.x + (x - home.x) * t, 0.14, home.z + (z - home.z) * t); }
    copy.cities.push({ id: n.id, name: n.name, tier: 'county', x, y, z, mx: x, mz: z, ms: 0.7 });
    copy.roads.push({ a: home.id, b: n.id, p, generated: true });
  }
  // 清理移动后的新城及岛城占地内的装饰树，其他地图素材不变。
  const cleared = copy.cities.filter((c) => c.id === 30 || c.id === 32 || (frontier && c.id === 38));
  copy.pieces = { ...meta.pieces };
  for (const kind of ['tree-broad', 'tree-pine', 'grove']) if (meta.pieces?.[kind]) {
    const filtered = [], arr = meta.pieces[kind];
    for (let i = 0; i < arr.length; i += 6) if (cleared.every((c) => (arr[i] - c.x) ** 2 + (arr[i + 2] - c.z) ** 2 > 0.45 ** 2)) filtered.push(...arr.slice(i, i + 6));
    copy.pieces[kind] = filtered;
  }
  return copy;
}

export function expandedFlatBoard(board, frontier = false) {
  const copy = { ...board, cities: [...board.cities], roads: [...board.roads] };
  splitMapRoads(copy.roads, 2, (n, point) => {
    const [x, y] = point.map((value, i) => value + (n.flatOffset?.[i] ?? 0));
    const pass = n.kind === 'pass', rx = pass ? 38 : 48, ry = pass ? 28 : 38;
    copy.cities.push({ id: n.id, cx: x, cy: y, flag: [x + rx * 0.55, y - ry], tag: [x, y - ry], rx, ry, outpost: pass, added: true });
    return [x, y];
  }, frontier);
  if (frontier) {
    const n = FRONTIER_ISLAND, [x, y] = n.flat, home = copy.cities[n.road[0]], count = 96, p = [], sea = [];
    for (let i = 0; i <= count; i++) {
      const t = i / count; p.push(home.cx + (x - home.cx) * t, home.cy + (y - home.cy) * t);
      sea.push(t >= 0.48 && t <= 0.87);
    }
    copy.cities.push({ id: n.id, cx: x, cy: y, flag: [x + 26, y - 38], tag: [x, y - 38], rx: 48, ry: 38, added: true });
    copy.roads.push({ a: home.id, b: n.id, p, sea, generated: true });
  }
  return copy;
}
