// 君主列传的可选地图。编号只追加，不改变原有城市和已发布剧本的基础数据。
export const EXPANDED_MAP_ID = 'builtin-sovereigns-expanded-map';
export const EXPANDED_NODES = Object.freeze([
  { id: 30, name: '襄阳', kind: 'city', road: [13, 21], template: 13, fraction: 0.50,
    approach: 0.39, sandOffset: [-1.16, 0.24, 0.20], flatOffset: [-135, 22], geoOffset: [-1.32, -0.20] },
  { id: 31, name: '江州', kind: 'city', road: [26, 27], template: 27, fraction: 0.50 },
  { id: 32, name: '宛城', kind: 'city', road: [12, 13], template: 13, fraction: 0.50,
    sandOffset: [1.00, -0.025, 0.70], flatOffset: [124, 78], geoOffset: [1.11, -0.70] },
  { id: 33, name: '虎牢关', kind: 'pass', road: [11, 12], template: 12, fraction: 0.50 },
  { id: 34, name: '函谷关', kind: 'pass', road: [8, 12], template: 8, fraction: 0.50,
    sandOffset: [0, -0.135, -0.45], flatOffset: [0, -50], geoOffset: [0, 0.45] },
  { id: 35, name: '武关', kind: 'pass', road: [8, 13], template: 9, fraction: 0.50,
    sandOffset: [-0.42, -0.357, 0.75], flatOffset: [-52, 83], geoOffset: [-0.47, -0.75] },
  { id: 36, name: '剑阁', kind: 'pass', road: [25, 26], template: 25, fraction: 0.50 },
]);
// 望垣峡是史籍中的峡谷，位置取西平至蜀地道路的示意；夷洲与现今岛屿的对应存在争议。
export const FRONTIER_PASS = Object.freeze({ id: 37, name: '望垣峡', kind: 'pass', road: [9, 26], template: 9, fraction: 0.28 });
export const FRONTIER_ISLAND = Object.freeze({ id: 38, name: '夷洲', kind: 'city', road: [17], template: 17,
  lon: 120.89, lat: 23.8, sand: [8.45, 0.30, 7.7], flat: [2942, 2226] });
export const expandedNodes = (frontier = false) => frontier ? [...EXPANDED_NODES, FRONTIER_PASS, FRONTIER_ISLAND] : EXPANDED_NODES;
export const isXiangyangRoad = (a, b) => a === 30 ? b === 13 || b === 21 : b === 30 && (a === 13 || a === 21);
// 这两条原路在新地图经过新增城市；从两端出发都必须先到该城市。
export const CROSSING_ROADS = Object.freeze([
  { road: [13, 22], via: 30 }, // 新野—衡阳经过襄阳
  { road: [12, 21], via: 32 }, // 洛阳—荆州经过宛城
]);

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
    d.search_table[String(node.id)] ??= [];
  }
  for (const { road: [a, b], via } of CROSSING_ROADS) {
    const node = EXPANDED_NODES.find((n) => n.id === via), city = d.cities[via];
    if (!d.cities[a].roads.includes(b) || !d.cities[b].roads.includes(a)
      || !d.cities[a].roads.includes(via) || !city.roads.includes(a)) throw new Error(`扩展地图交叉道路无效：${city.name}`);
    d.cities[a].roads = d.cities[a].roads.filter((id) => id !== b);
    d.cities[b].roads = d.cities[b].roads.map((id) => id === a ? via : id);
    if (!city.roads.includes(b)) city.roads.push(b);
    d.deploy[b][via] = structuredClone(d.deploy[b][a]);
    d.deploy[via][b] = structuredClone(d.deploy[via][node.road[1]]);
    // 不删除旧布阵：旧记录可能正中断在这条调整前的道路上。
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
    d.search_table[String(n.id)] ??= [];
    d.rules.flood_cities.push(n.id);
  }
  for (const site of expandedNodes(d.frontierMap)) {
    if (site.kind !== 'city') continue;
    const city = d.cities[site.id], equipment = d.expandedShops?.[site.id] ?? [];
    for (const key of ['shop', 'field_shop', 'ai_shop']) {
      city[key] = [...city[key].filter((id) => id < (d.originalEquipmentCount ?? Infinity)), ...equipment];
    }
  }
  // 扩张后的命令书不继续增长，避免额外城市造成滚雪球。
  while (d.rules.books.length <= d.cities.filter((c) => c.kind !== 'pass').length) d.rules.books.push(d.rules.books.at(-1));
  d.rules.drought_cities.push(30, 32);
  d.rules.flood_cities.push(30, 31);
  return d;
}

const approachSteps = 12;
function roadSpur(point, site) {
  if (point.every((value, i) => value === site[i])) return [];
  const spur = [point];
  for (let i = 1; i < approachSteps; i++) spur.push(point.map((v, axis) => v + (site[axis] - v) * i / approachSteps));
  return [...spur, site];
}

export function splitMapRoads(roads, dimensions, addNode, frontier = false) {
  const sites = new Map();
  for (const node of frontier ? [...EXPANDED_NODES, FRONTIER_PASS] : EXPANDED_NODES) {
    const [a, b] = node.road;
    const index = roads.findIndex((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a));
    if (index < 0) throw new Error(`扩展地图缺少道路：${node.name}`);
    const road = roads[index], count = road.p.length / dimensions;
    const cut = Math.max(1, Math.min(count - 2, Math.round((count - 1) * node.fraction)));
    const point = road.p.slice(cut * dimensions, (cut + 1) * dimensions);
    const site = addNode(node, point) ?? point;
    sites.set(node.id, site);
    // 襄阳到新野从更靠近新野的位置接回原路，避免两段在同一条支路上折返。
    const approach = node.approach === undefined ? cut : Math.round((count - 1) * (road.a === a ? node.approach : 1 - node.approach));
    const [left, right] = road.a === a ? [approach, cut] : [cut, approach];
    const first = { ...road, b: node.id, p: road.p.slice(0, (left + 1) * dimensions) };
    const second = { ...road, a: node.id, p: road.p.slice(right * dimensions) };
    if (road.sea) { first.sea = road.sea.slice(0, left + 1); second.sea = road.sea.slice(right); }
    const spurAt = (index) => roadSpur(road.p.slice(index * dimensions, (index + 1) * dimensions), site);
    const firstSpur = spurAt(left), secondSpur = right === left ? firstSpur : spurAt(right);
    if (firstSpur.length) {
      first.spur = firstSpur.flat(); first.p.push(...firstSpur.slice(1).flat());
      if (first.sea) first.sea.push(...Array(approachSteps).fill(false));
      if (dimensions === 3) first.terrainAdjusted = true;
    }
    if (secondSpur.length) {
      if (right !== left) second.spur = secondSpur.flat();
      second.p.unshift(...secondSpur.slice(1).reverse().flat());
      if (second.sea) second.sea.unshift(...Array(approachSteps).fill(false));
      if (dimensions === 3) second.terrainAdjusted = true;
    }
    roads.splice(index, 1, first, second);
  }
  for (const { road: [a, b], via } of CROSSING_ROADS) {
    const index = roads.findIndex((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a));
    if (index < 0) throw new Error(`扩展地图缺少交叉道路：${a}—${b}`);
    const old = roads[index], reversed = old.a !== a, p = [], sea = old.sea ? [] : null;
    for (let i = 0, count = old.p.length / dimensions; i < count; i++) {
      const n = reversed ? count - 1 - i : i;
      p.push(...old.p.slice(n * dimensions, (n + 1) * dimensions));
      if (sea) sea.push(old.sea[n]);
    }
    const site = sites.get(via), count = p.length / dimensions, horizontal = dimensions === 3 ? 2 : 1;
    let cut = 1, best = Infinity;
    for (let i = 1; i < count - 1; i++) {
      const distance = (p[i * dimensions] - site[0]) ** 2 + (p[i * dimensions + horizontal] - site[horizontal]) ** 2;
      if (distance < best) { best = distance; cut = i; }
    }
    const point = p.slice(cut * dimensions, (cut + 1) * dimensions), steps = 12, spur = [], reverse = [];
    for (let i = 0; i <= steps; i++) for (let axis = 0; axis < dimensions; axis++) {
      spur.push(i === 0 ? point[axis] : i === steps ? site[axis] : point[axis] + (site[axis] - point[axis]) * i / steps);
    }
    for (let i = steps; i >= 0; i--) reverse.push(...spur.slice(i * dimensions, (i + 1) * dimensions));
    const next = { ...old, a: via, b, p: [...reverse, ...p.slice((cut + 1) * dimensions)], spur };
    if (sea) next.sea = [...Array(steps + 1).fill(false), ...sea.slice(cut + 1)];
    if (dimensions === 3) next.terrainAdjusted = true;
    roads.splice(index, 1, next);
  }
}

export function expandedSandMeta(meta, frontier = false) {
  const copy = { ...meta, cities: [...meta.cities], roads: [...meta.roads] };
  splitMapRoads(copy.roads, 3, (n, point) => {
    const [x, y, z] = point.map((value, i) => value + (n.sandOffset?.[i] ?? 0));
    const tier = n.kind === 'pass' ? 'pass' : n.id === 30 ? 'major' : 'county';
    const ms = tier === 'pass' ? 0.55 : tier === 'major' ? 0.7 * Math.min(1, (meta.size?.['city-county'] || 1) / (meta.size?.['city-major'] || 1)) : 0.7;
    copy.cities.push({ id: n.id, name: n.name, tier, x, y, z, mx: x, mz: z, ms, outpost: n.kind === 'pass' });
    return [x, y, z];
  }, frontier);
  if (frontier) {
    const n = FRONTIER_ISLAND, [x, y, z] = n.sand, home = copy.cities[n.road[0]], count = 96, p = [];
    for (let i = 0; i <= count; i++) { const t = i / count; p.push(home.x + (x - home.x) * t, 0.14, home.z + (z - home.z) * t); }
    copy.cities.push({ id: n.id, name: n.name, tier: 'county', x, y, z, mx: x, mz: z, ms: 0.7 });
    copy.roads.push({ a: home.id, b: n.id, p, generated: true });
  }
  // 清理新据点占地内的装饰树，以及遮住襄阳城体的山体，其他地图素材不变。
  const cleared = copy.cities.filter((c) => [30, 32, 34, 35].includes(c.id) || (frontier && c.id === 38));
  copy.pieces = { ...meta.pieces };
  for (const kind of ['tree-broad', 'tree-pine', 'grove', 'range-a', 'range-b']) if (meta.pieces?.[kind]) {
    const mountain = kind.startsWith('range-'), occupied = mountain ? cleared.filter((c) => c.id === 30) : cleared;
    const radius = mountain ? 0.65 : 0.55;
    const filtered = [], arr = meta.pieces[kind];
    for (let i = 0; i < arr.length; i += 6) if (occupied.every((c) => (arr[i] - c.x) ** 2 + (arr[i + 2] - c.z) ** 2 >= radius ** 2)) filtered.push(...arr.slice(i, i + 6));
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
