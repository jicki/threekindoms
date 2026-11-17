// 君主列传的可选地图。编号只追加，不改变原有城市和已发布剧本的基础数据。
export const EXPANDED_MAP_ID = 'builtin-sovereigns-expanded-map';
export const EXPANDED_NODES = Object.freeze([
  { id: 30, name: '襄阳', kind: 'city', road: [13, 21], template: 13, fraction: 0.50 },
  { id: 31, name: '江州', kind: 'city', road: [26, 27], template: 27, fraction: 0.50 },
  { id: 32, name: '宛城', kind: 'city', road: [12, 13], template: 13, fraction: 0.50 },
  { id: 33, name: '虎牢关', kind: 'pass', road: [11, 12], template: 12, fraction: 0.50 },
  { id: 34, name: '函谷关', kind: 'pass', road: [8, 12], template: 8, fraction: 0.50 },
  { id: 35, name: '武关', kind: 'pass', road: [8, 13], template: 9, fraction: 0.50 },
  { id: 36, name: '剑阁', kind: 'pass', road: [25, 26], template: 25, fraction: 0.50 },
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
  for (const node of EXPANDED_NODES) {
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
    d.deploy[a][node.id] = d.deploy[a][b]; delete d.deploy[a][b];
    d.deploy[b][node.id] = d.deploy[b][a]; delete d.deploy[b][a];
    const deployments = Object.values(d.deploy[node.template]);
    d.maps[node.id] = structuredClone(d.maps[node.template]);
    d.deploy[node.id] = { [a]: structuredClone(deployments[0]), [b]: structuredClone(deployments[1] ?? deployments[0]) };
    d.villages[node.id] = node.kind === 'pass' ? [] : structuredClone(d.villages[node.template] ?? []);
    d.search_table[String(node.id)] = [];
  }
  // 扩张后的命令书不继续增长，避免额外城市造成滚雪球。
  while (d.rules.books.length <= 33) d.rules.books.push(d.rules.books.at(-1));
  d.rules.drought_cities.push(30, 32);
  d.rules.flood_cities.push(30, 31);
  return d;
}

// 将预烘焙道路在同一个采样点拆分，确保新据点、可通行道路与画面重合。
export function splitMapRoads(roads, dimensions, addNode) {
  for (const node of EXPANDED_NODES) {
    const [a, b] = node.road;
    const index = roads.findIndex((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a));
    if (index < 0) throw new Error(`扩展地图缺少道路：${node.name}`);
    const road = roads[index], count = road.p.length / dimensions;
    const cut = Math.max(1, Math.min(count - 2, Math.round((count - 1) * node.fraction)));
    const point = road.p.slice(cut * dimensions, (cut + 1) * dimensions);
    addNode(node, point);
    const first = { ...road, b: node.id, p: road.p.slice(0, (cut + 1) * dimensions) };
    const second = { ...road, a: node.id, p: road.p.slice(cut * dimensions) };
    if (road.sea) { first.sea = road.sea.slice(0, cut + 1); second.sea = road.sea.slice(cut); }
    roads.splice(index, 1, first, second);
  }
}

export function expandedSandMeta(meta) {
  const copy = { ...meta, cities: [...meta.cities], roads: [...meta.roads] };
  splitMapRoads(copy.roads, 3, (n, [x, y, z]) => copy.cities.push({
    id: n.id, name: n.name, tier: n.kind === 'pass' ? 'pass' : 'county',
    x, y, z, mx: x, mz: z, ms: n.kind === 'pass' ? 0.55 : 0.7, outpost: n.kind === 'pass',
  }));
  return copy;
}

export function expandedFlatBoard(board) {
  const copy = { ...board, cities: [...board.cities], roads: [...board.roads] };
  splitMapRoads(copy.roads, 2, (n, [x, y]) => {
    const pass = n.kind === 'pass', rx = pass ? 38 : 48, ry = pass ? 28 : 38;
    copy.cities.push({ id: n.id, cx: x, cy: y, flag: [x + rx * 0.55, y - ry], tag: [x, y - ry], rx, ry, outpost: pass, added: true });
  });
  return copy;
}
