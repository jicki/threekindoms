import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { Field, PLAIN, RIVER } from '../src/core/field.js';
import { applyScenario } from '../src/core/scenario.js';
import { loadScenario } from '../src/core/scenario-store.js';
import { SOVEREIGN_SCENARIO_ID } from '../src/core/visuals.js';
import { EXPANDED_MAP_ID, expandMap } from '../src/core/expanded-map.js';
import { REGIONAL_BATTLE_REVISION } from '../src/core/regional-battlefields.js';
import { skirmishMap } from '../src/core/skirmish-maps.js';
import { waterColor, waterDepth } from '../src/war/surface.js';
import { blockedTerrain, gateNormal, siegeRing } from '../src/core/siege.js';
import { peekSuspend, suspend, suspendToken } from '../src/core/suspend.js';

const base = JSON.parse(readFileSync(new URL('../data/game-data.json', import.meta.url)));
const D = expandMap(applyScenario(base, await loadScenario(SOVEREIGN_SCENARIO_ID, base)));
G.setData(D, EXPANDED_MAP_ID);
const key = (x, y) => `${x},${y}`;
const keyOf = ({ x, y }) => key(x, y);
const step = ([a, b], [x, y]) => Math.abs(x - a) + Math.abs(y - b);
const war = (city, from, size = 10) => ({ city, from, attacker: 0, defender: 4, day: 1,
  att: { ids: Array.from({ length: size }, (_, i) => i + 40), gold: 100, rice: 9999 },
  def: { ids: Array.from({ length: size }, (_, i) => i + 50), gold: 100, rice: 9999 } });
const fresh = () => G.newGame(4, 1, 7);

test('水色连续过渡，外海呈深蓝，内陆河道呈灰绿', () => {
  const depth = waterDepth(6, 5, x => x > 0);
  assert.equal(depth(0, 2), 0);
  assert.equal(depth(0.5, 2), 0.5);
  assert.ok(depth(5, 2) > depth(1, 2));
  const [near, far] = [depth(1, 2), depth(5, 2)].map(d => waterColor(d, true));
  assert.ok(near[1] > far[1] && far[2] > far[1]);
  assert.ok(waterColor(1, false)[0] > near[0]);
});

test('39 处地图、146 条来路的布阵和官道均遵守实际通行，设施和关轴不会随来路旋转', () => {
  const g = fresh(), layouts = new Set();
  let entries = 0, beaches = 0;
  assert.equal(g.campaignRevision, REGIONAL_BATTLE_REVISION);
  for (const city of D.cities) {
    let layout;
    for (const from of city.roads) {
      const title = `${D.cities[from].name} → ${city.name}`, f = new Field(g, war(city.id, from), 'att');
      const { siege, approaches } = f, { routes, barriers } = approaches;
      const shape = JSON.stringify([f.castle(), siege.walls, siege.gates, siege.moatCells, approaches.sites.filter(s => s.kind === 'house')]);
      layout ??= shape;
      assert.equal(shape, layout, title);
      assert.equal(new Set(f.units.map(keyOf)).size, 20, title);
      for (const side of ['att', 'def']) {
        const zones = f.deploymentZones(side), cells = zones.flatMap(z => z.cells);
        const keys = new Set(cells.map(p => key(...p)));
        assert.equal(cells.length, keys.size, title);
        assert.ok(cells.every(([x, y]) => f.deployable(x, y)), title);
        assert.ok(f.side(side).every(u => keys.has(keyOf(u))), title);
      }
      const z = f.deploymentZones('att'), u = f.side('att')[0];
      if (z.length > 1) {
        beaches++;
        assert.equal(z.length, 2, title);
        assert.ok(step(z[0].anchor, z[1].anchor) >= 14, title);
        assert.ok(z.every(zone => f.side('att').some(o => zone.cells.some(p => key(...p) === keyOf(o)))), title);
      }
      const entrances = routes.filter(route => route.goal.kind !== 'camp');
      assert.ok(new Set(entrances.map(r => keyOf(r.goal))).size >= (siege.type === 'capital' ? 3 : 2), title);
      if (siege.camp) f.campSecured = true;
      for (const { cells, goal } of routes) {
        assert.ok(z.some(zone => step(cells[0], zone.anchor) === 0), title);
        assert.deepEqual(cells.at(-1), [goal.x, goal.y], title);
        assert.ok(cells.every((p, i) => f.deployable(...p) && (i === 0 || step(p, cells[i - 1]) === 1)), title);
        for (const [army, soldiers] of [['平', 700], ['山', 450], ['水', 900]]) {
          Object.assign(f.O(u.id), { army, soldiers });
          assert.ok(cells.every(p => Number.isFinite(f.cost(u, ...p))), title);
        }
      }
      for (const [k] of barriers) assert.equal(f.cost(u, ...k.split(',').map(Number)), Infinity, title);
      for (const v of f.units) if (v !== u) v.gone = true;
      const reach = f.reach(u, Infinity);
      assert.ok(z.every(zone => zone.cells.every(p => reach.dist.has(key(...p)))), title);
      assert.ok(reach.dist.has(key(...f.castle())), title);
      entries++;
    }
    const f = new Field(g, war(city.id, city.roads[0]), 'att');
    layouts.add(JSON.stringify(f.map));
  }
  assert.equal(layouts.size, 39);
  assert.equal(entries, 146);
  assert.equal(beaches, 2, '建安和夷洲的双向海路均可分两处登陆');
});

test('襄阳桥面和浅滩区分通行、天气和白兵地形，剑阁栈道绕开外关并通往内关', () => {
  const g = fresh(), river = new Field(g, war(30, 13, 1), 'att');
  const a = river.side('att')[0], d = river.side('def')[0];
  Object.assign(river.O(a.id), { army: '平', soldiers: 700 });
  const tiles = [...river.approaches.roads.values()];
  const harbor = river.approaches.sites.find(s => s.kind === 'harbor');
  assert.ok(harbor && river.deployable(harbor.x, harbor.y));
  assert.ok([[1,0], [-1,0], [0,1], [0,-1]].some(([dx,dy]) =>
    river.approaches.barriers.get(key(harbor.x + dx, harbor.y + dy)) === '深水'));
  const bridge = tiles.find(p => p.kind === 'bridge' && river.terr(p.x, p.y) === RIVER);
  const ford = tiles.find(p => p.kind === 'ford' && river.terr(p.x, p.y) === RIVER);
  const rates = () => [river.cost(a, bridge.x, bridge.y), river.cost(a, ford.x, ford.y)];
  river.weather = 'clear';
  const [bridgeClear, fordClear] = rates();
  river.weather = 'rain';
  const [bridgeRain, fordRain] = rates();
  assert.equal(bridgeRain, bridgeClear);
  assert.ok(fordRain > fordClear);
  assert.match(river.ground(bridge.x, bridge.y), /桥道/);
  assert.match(river.ground(ford.x, ford.y), /浅滩/);
  Object.assign(d, { x: bridge.x, y: bridge.y });
  const clash = river.attack(a, d).battle;
  assert.equal(clash.terrain, PLAIN);
  assert.equal(clash.sceneProfile.tacticalSite, 'bridge');
  assert.equal(clash.map[1][7], 3);
  Object.assign(a, ford);
  const threat = river.threat('att', a);
  assert.ok(threat.size > 0);
  assert.ok([...threat].every(k => !river.approaches.barriers.has(k)));

  const pass = new Field(g, war(36, 25, 1), 'att');
  const plank = pass.approaches.routes.find(r => r.goal.label === '栈道至内关');
  const gate = pass.siege.gates.find(g => keyOf(g) === keyOf(plank.goal));
  assert.equal(gate.ring, pass.siege.inner);
  assert.ok(plank.cells.some(p => pass.approaches.roads.get(key(...p))?.kind === 'plank'));
  assert.ok(!plank.cells.some(p => pass.siege.gates.some(g => g.ring === pass.siege.outer && key(...p) === keyOf(g))));
  const cliff = [...pass.approaches.barriers].find(([, type]) => type === '断崖')[0].split(',').map(Number);
  const [x,y] = cliff, left = { x: x - 1, y }, right = { x: x + 1, y };
  assert.ok(blockedTerrain(pass.approaches.barriers, left, right));
  assert.ok(blockedTerrain(pass.approaches.barriers, right, left));
});

test('六种局部白兵布置保留四套阵法位置和贯穿战线的地面通路', () => {
  for (const [tacticalSite, terrain] of [['bridge', 2], ['ford', 3], ['plank', 2], ['camp', 2], ['streets', 5], ['beach', 1]]) {
    const original = D.skirmish_maps[terrain], map = skirmishMap(original, terrain, { tacticalSite });
    const formations = D.formations.slice(0, terrain === 5 ? 6 : 4);
    for (const [i, layout] of formations.entries()) for (const [a, y, d] of layout) {
      if (i < 4) assert.equal(map[y][a], original[y][a], tacticalSite);
      const x = i >= 4 ? 15 - a : d;
      assert.equal(map[y][x], original[y][x], tacticalSite);
    }
    assert.ok(map.filter(row => row[7] === 0 && row[8] === 0).length >= 2, tacticalSite);
  }
});

test('宛城前阵阻挡破门，电脑先攻前阵，中断继续后保留解锁及已破城门', () => {
  const g = fresh(), w = war(32, 13, 3), f = new Field(g, w, 'def');
  const a = f.side('att')[0], [commander, soldier, reserve] = f.side('def'), camp = f.siege.camp;
  const gate = f.siege.gates.find(g => g.ring === f.siege.outer);
  const [dx, dy] = gateNormal(f.siege, gate);
  assert.deepEqual([commander.x, commander.y], [camp.x, camp.y]);
  assert.notDeepEqual([camp.x, camp.y], f.castle());
  assert.equal(f.cost(a, gate.x, gate.y), Infinity);
  assert.ok(Number.isFinite(f.cost(soldier, gate.x, gate.y)));
  assert.equal(f.over, null);
  Object.assign(commander, { x: gate.x - dx, y: gate.y - dy });
  Object.assign(a, { x: camp.x - 2, y: camp.y });
  Object.assign(f.O(a.id), { soldiers: 700 });
  for (const u of [...f.side('att').slice(1), soldier, reserve]) u.gone = true;
  f.pool.att = 8;
  assert.ok([...f.aiActions('att')].some(event => event.type === 'move' && event.path.some(p => key(...p) === keyOf(camp))));
  assert.equal(f.campSecured, true);
  assert.equal(f.over, null);
  const closed = f.cost(a, gate.x, gate.y);
  assert.ok(Number.isFinite(closed));
  f.move(a, gate.x, gate.y, closed);
  assert.equal(f.cost(a, gate.x, gate.y), closed - 2);
  assert.equal(siegeRing(f.siege, a), f.siege.outer);

  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), store = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: k => store.get(k) ?? null, setItem: (k, value) => store.set(k, String(value)), removeItem: k => store.delete(k),
  } });
  try {
    assert.equal(suspend(g, w, f, { side: 'def', start: {}, after: { kind: 'def' } }), true);
    const token = suspendToken(), rec = peekSuspend(token), restored = Field.restore(rec.g, rec.war, rec.field);
    assert.equal(restored.campSecured, true);
    assert.equal(restored.siege.gates.find(g => keyOf(g) === keyOf(gate)).open, true);
    assert.deepEqual(restored.units, f.units);
    assert.equal(suspendToken(), token);
    rec.field.campSecured = false;
    assert.equal(peekSuspend(JSON.stringify(rec)), null);
    rec.field.campSecured = true;
    const wall = restored.siege.walls[0];
    Object.assign(rec.field.units.find(v => !v.gone), { x: wall.x, y: wall.y });
    assert.equal(peekSuspend(JSON.stringify(rec)), null);
    assert.equal(suspendToken(), token);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});
