import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { Field } from '../src/core/field.js';
import { setupWar, resolveWar, retreatCity, retreatOptions } from '../src/core/warcore.js';
import { suspend, takeSuspend } from '../src/core/suspend.js';
import { loadScenario } from '../src/core/scenario-store.js';
import { applyScenario } from '../src/core/scenario.js';
import { EXPANDED_MAP_ID, expandMap, expandedSandMeta, expandedFlatBoard } from '../src/core/expanded-map.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const base = read('../data/game-data.json');
const scenario = await loadScenario('builtin-sovereigns', base);
const map = (frontier) => {
  const s = structuredClone(scenario); s.frontierMap = frontier;
  return expandMap(applyScenario(base, s));
};
const crossings = [[13, 22, 30], [12, 21, 32]];
const edge = (a, b) => [a, b].sort((x, y) => x - y).join('-');
const terrainHeight = (raw) => {
  const heights = readFileSync(new URL('../assets/ai/sandtable/board/height.bin', import.meta.url));
  const [x0, , z0] = raw.box, [width, height] = raw.grid, [dx, dz] = raw.step;
  const at = (x, z) => raw.h[0] + heights.readUInt16LE((Math.max(0, Math.min(height - 1, z)) * width
    + Math.max(0, Math.min(width - 1, x))) * 2) / 65535 * (raw.h[1] - raw.h[0]);
  return (x, z) => {
    const fx = (x - x0) / dx, fz = (z - z0) / dz, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    return (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v;
  };
};

for (const frontier of [false, true]) test(`${frontier ? '边疆' : '扩展'}地图的跨城路线经过新据点，双向道路与布阵完整`, () => {
  const d = map(frontier); G.setData(d, EXPANDED_MAP_ID);
  const g = G.newGame(4, 1, 7);
  try {
    for (const [a, b, via] of crossings) {
      assert.ok(!G.roads(a).includes(b) && !G.roads(b).includes(a), `${a} 与 ${b} 不应绕过 ${via}`);
      for (const city of [a, b]) {
        assert.ok(G.roads(city).includes(via) && G.roads(via).includes(city));
        assert.ok(d.deploy[city][via] && d.deploy[via][city], `${city} 与 ${via} 的战场须能双向布阵`);
      }
      assert.equal(G.moveOfficers(g, a, b, []).ok, false, '调兵不能绕过新城');
      assert.equal(G.transport(g, a, b, 1, 0, 0).ok, false, '运输不能绕过新城');
      assert.ok(d.deploy[a][b] && d.deploy[b][a], '保留旧版中断战斗使用的布阵');
      for (const [from, to] of [[a, b], [b, a]]) {
        const old = { city: to, from, attacker: 0, defender: 4,
          att: { ids: [40], gold: 0, rice: 100 }, def: { ids: [41], gold: 0, rice: 100 } };
        const field = new Field(g, old, 'att'), restored = Field.restore(g, old, field.snapshot());
        assert.deepEqual(restored.dep, base.deploy[to][from]);
        Object.assign(g.cities[from], { faction: G.NONE, officers: [] });
        assert.ok(retreatOptions(g, old, old.attacker).includes(from), '旧战场的进攻方应能撤回原出阵地');
        assert.ok(!retreatOptions(g, old, old.defender).includes(from), '守方不能获得跨城撤退路线');
        assert.equal(retreatCity(g, to, old.attacker, from), from, '旧战场自动结算也能撤回原出阵地');
      }
    }
    const seen = new Set(), queue = [0];
    for (let i = 0; i < queue.length; i++) {
      const city = queue[i]; if (seen.has(city)) continue; seen.add(city);
      for (const n of G.roads(city)) {
        assert.ok(G.roads(n).includes(city), `${city} → ${n} 缺少反向道路`);
        assert.ok(d.deploy[city][n] && d.deploy[n][city], `${city} 与 ${n} 缺少出阵位置`);
        if (!seen.has(n)) queue.push(n);
      }
      assert.equal(new Set(G.roads(city)).size, G.roads(city).length, `${city} 含重复道路`);
    }
    assert.equal(seen.size, d.cities.length, '所有据点应连通');
  } finally { G.setData(base); }
});

test('平面和三维显示道路与实际通行网络一致，新路线在据点连续', () => {
  const d = map(true), logical = new Set(d.cities.flatMap((c) => c.roads.map((n) => edge(c.id, n))));
  for (const [input, dims, build] of [
    [read('../assets/ai/sandtable/board/board.json'), 3, expandedSandMeta],
    [read('../assets/ai/sandtable/flat/board.json'), 2, expandedFlatBoard],
  ]) {
    const original = JSON.stringify(input), board = build(input, true), drawn = board.roads.map((r) => edge(r.a, r.b));
    assert.equal(new Set(drawn).size, drawn.length, '显示道路不能重复');
    assert.deepEqual(new Set(drawn), logical, '显示道路必须与可通行路线一致');
    for (const [a, b, via] of crossings) {
      assert.ok(!drawn.includes(edge(a, b)), '不得绘制跨越据点的直达路线');
      const link = board.roads.find((r) => edge(r.a, r.b) === edge(via, b));
      assert.ok(link?.p.length > dims * 2);
      const end = link.a === via ? link.p.slice(0, dims) : link.p.slice(-dims);
      const city = board.cities[via];
      assert.deepEqual(end, dims === 3 ? [city.x, city.y, city.z] : [city.cx, city.cy]);
      if (link.sea) assert.equal(link.sea.length, link.p.length / dims);
    }
    assert.equal(JSON.stringify(input), original, '不修改原版地图');
  }
  for (const [a, b] of crossings) assert.ok(base.cities[a].roads.includes(b), '原版仍保留原有直达路线');
});

test('襄阳与新野、荆州拉开距离，短支路依然连接原道路', () => {
  const raw = read('../assets/ai/sandtable/board/board.json'), sand = expandedSandMeta(raw, true);
  const flat = expandedFlatBoard(read('../assets/ai/sandtable/flat/board.json'), true);
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  for (const id of [13, 21]) {
    assert.ok(distance([sand.cities[30].x, sand.cities[30].z], [sand.cities[id].x, sand.cities[id].z]) > 1.4);
    assert.ok(distance([flat.cities[30].cx, flat.cities[30].cy], [flat.cities[id].cx, flat.cities[id].cy]) > 160);
  }
  assert.ok(sand.roads.some((road) => road.spur && (road.a === 30 || road.b === 30)));
  assert.ok(flat.roads.some((road) => road.spur && (road.a === 30 || road.b === 30)));
  for (const kind of ['range-a', 'range-b']) {
    const pieces = sand.pieces[kind] ?? [];
    for (let i = 0; i < pieces.length; i += 6) {
      assert.ok(distance([pieces[i], pieces[i + 2]], [sand.cities[30].x, sand.cities[30].z]) >= 0.65, '襄阳不能被山体遮住');
    }
  }
  const ground = terrainHeight(raw);
  const city = sand.cities[30], samples = [];
  for (const x of [-0.24, 0, 0.24]) for (const z of [-0.24, 0, 0.24]) samples.push(ground(city.x + x, city.z + z));
  assert.ok(city.y >= Math.max(...samples) - 0.02, '襄阳城体不能埋入周围地面');
  assert.ok(city.y <= ground(city.x, city.z) + 0.12, '襄阳城体不能明显悬空');
});

test('函谷关、武关和宛城与邻近据点错开，城体不被地形或树木遮挡', () => {
  const raw = read('../assets/ai/sandtable/board/board.json'), sand = expandedSandMeta(raw, true);
  const flat = expandedFlatBoard(read('../assets/ai/sandtable/flat/board.json'), true), ground = terrainHeight(raw);
  for (const [a, b] of [[32, 13], [32, 12], [34, 35], [34, 8], [34, 12], [35, 8], [35, 13], [35, 30]]) {
    const x = sand.cities[a], y = sand.cities[b], p = flat.cities[a], q = flat.cities[b];
    assert.ok(Math.hypot(x.x - y.x, x.z - y.z) > 1.15, `${a} 与 ${b} 的三维距离过近`);
    assert.ok(Math.hypot(p.cx - q.cx, p.cy - q.cy) > 145, `${a} 与 ${b} 的平面距离过近`);
  }
  for (const id of [32, 34, 35]) {
    const city = sand.cities[id], heights = [];
    for (const x of [-0.24, 0, 0.24]) for (const z of [-0.24, 0, 0.24]) heights.push(ground(city.x + x, city.z + z));
    assert.ok(city.y >= Math.max(...heights) - 0.02, `${city.name} 不能埋入地形`);
    assert.ok(city.y <= ground(city.x, city.z) + 0.12, `${city.name} 不能明显悬空`);
    for (const kind of ['tree-broad', 'tree-pine', 'grove']) {
      const pieces = sand.pieces[kind] ?? [];
      for (let i = 0; i < pieces.length; i += 6) assert.ok(Math.hypot(pieces[i] - city.x, pieces[i + 2] - city.z) >= 0.55, `${city.name} 被树木遮挡`);
    }
  }
});

test('地图上其他道路也不穿过第三座城市或关隘', () => {
  for (const [input, dims, build, radius] of [
    [read('../assets/ai/sandtable/board/board.json'), 3, expandedSandMeta, 0.38],
    [read('../assets/ai/sandtable/flat/board.json'), 2, expandedFlatBoard, 45],
  ]) {
    const board = build(input, true);
    const xy = (city) => dims === 3 ? [city.x, city.z] : [city.cx, city.cy];
    const point = (road, i) => dims === 3 ? [road.p[i * 3], road.p[i * 3 + 2]] : [road.p[i * 2], road.p[i * 2 + 1]];
    const segmentDistance = (p, a, b) => {
      const x = b[0] - a[0], y = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * x + (p[1] - a[1]) * y) / (x * x + y * y || 1)));
      return Math.hypot(p[0] - a[0] - t * x, p[1] - a[1] - t * y);
    };
    for (const road of board.roads) for (const city of board.cities) {
      if (city.id === road.a || city.id === road.b) continue;
      for (let i = 0; i + 1 < road.p.length / dims; i++) {
        assert.ok(segmentDistance(xy(city), point(road, i), point(road, i + 1)) >= radius,
          `${road.a}—${road.b} 与 ${city.id} 的位置冲突`);
      }
    }
  }
});

test('调整前已中断的跨城战斗可读取并在败北后撤回原出阵地', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), records = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => records.get(key) ?? null, setItem: (key, value) => records.set(key, String(value)), removeItem: (key) => records.delete(key),
  } });
  try {
    for (const [a, b, via] of crossings) for (const [from, to] of [[a, b], [b, a]]) {
      const updated = map(true), old = structuredClone(updated);
      old.cities[a].roads.push(b);
      old.cities[b].roads = old.cities[b].roads.map((id) => id === via ? a : id);
      old.cities[via].roads = old.cities[via].roads.filter((id) => id !== b);
      G.setData(old, EXPANDED_MAP_ID);
      const g = G.newGame(4, 1, 7);
      for (const city of g.cities) city.officers = city.officers.filter((id) => id !== 40 && id !== 41);
      Object.assign(g.cities[from], { faction: 4, officers: [40], gold: 100, rice: 300 });
      Object.assign(g.cities[to], { faction: 0, officers: [41], gold: 100, rice: 300 });
      for (const id of [40, 41]) Object.assign(g.officers[id], { status: G.SERVING, soldiers: 500 });
      const war = setupWar(g, { from, to, ids: [40], commander: 40, gold: 0, rice: 100 });
      const field = new Field(g, war, 'att');
      assert.ok(suspend(g, war, field, { side: 'att', start: {}, after: { kind: 'att', faction: 4, pts: 0 } }));
      G.setData(updated, EXPANDED_MAP_ID);
      const saved = takeSuspend(); assert.ok(saved, '新地图应读取旧中断记录');
      assert.deepEqual(Field.restore(saved.g, saved.war, saved.field).units, field.units);
      assert.ok(retreatOptions(saved.g, saved.war, 4).includes(from));
      resolveWar(saved.g, saved.war, { loser: 'att', survivors: { att: [40], def: [41] }, dead: [],
        captured: { byAtt: [], byDef: [] }, retreated: [], chests: { att: saved.war.att, def: saved.war.def } });
      assert.ok(saved.g.cities[from].officers.includes(40), '败军应能回到调整前的出阵地');
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage;
    G.setData(base);
  }
});
