import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { Field } from '../src/core/field.js';
import { resolveBattlefield } from '../src/core/battlefields.js';
import { POST_MOBILITY, APPROACH_CAMPAIGN_REVISION } from '../src/core/battle-approaches.js';
import { siegeExtent } from '../src/core/siege.js';
import { applyScenario } from '../src/core/scenario.js';
import { loadScenario } from '../src/core/scenario-store.js';
import { SOVEREIGN_SCENARIO_ID } from '../src/core/visuals.js';
import { EXPANDED_MAP_ID, expandMap } from '../src/core/expanded-map.js';
import { suspend, takeSuspend } from '../src/core/suspend.js';

const base = JSON.parse(readFileSync(new URL('../data/game-data.json', import.meta.url)));
const expanded = expandMap(applyScenario(base, await loadScenario(SOVEREIGN_SCENARIO_ID, base)));
const key = (x, y) => `${x},${y}`;
const distance = ([ax, ay], [bx, by]) => Math.abs(ax - bx) + Math.abs(ay - by);
function game() {
  G.setData(expanded, EXPANDED_MAP_ID);
  return G.newGame(4, 1, 7);
}
function war(city = 34, from = 8) {
  return { city, from, attacker: 0, defender: 4, day: 1,
    att: { ids: Array.from({ length: 10 }, (_, i) => i), gold: 100, rice: 9999 },
    def: { ids: Array.from({ length: 10 }, (_, i) => i + 10), gold: 100, rice: 9999 } };
}

test('39 处据点的 146 条来路扩大战场，双路线连续抵达正确的外城入口', () => {
  const g = game();
  const fields = new Set();
  let entries = 0, bridges = 0;
  for (const city of expanded.cities) for (const from of city.roads) {
    const f = new Field(g, war(city.id, from), 'att');
    const { siege, approaches, dep } = f, { post, routes, roads } = approaches;
    const title = `${city.name} ← ${expanded.cities[from].name}`, [mx, my] = siegeExtent(siege, 'moat');
    assert.deepEqual([f.width, f.height, siege.revision], [40, 27, 5], title);
    assert.equal(new Set(f.units.map(u => key(u.x, u.y))).size, 20, title);
    assert.ok(f.units.every(u => f.inside(u.x, u.y) && f.deployable(u.x, u.y)), title);
    assert.ok(f.inside(post.x, post.y) && f.terr(post.x, post.y) === 2, title);
    assert.ok(Math.abs(post.x - siege.cx) > mx || Math.abs(post.y - siege.cy) > my, title);
    assert.ok(!f.villages.some(v => v.x === post.x && v.y === post.y), title);
    const [main, flank] = routes;
    const subject = f.side('att')[0];
    for (const { cells } of routes) {
      assert.deepEqual(cells[0], dep.attacker[0], title);
      assert.ok(siege.crossings.some(c => key(c.x, c.y) === key(...cells.at(-1))), title);
      assert.ok(cells.every(([x, y], i) => f.inside(x, y) && roads.has(key(x, y)) && f.deployable(x, y)
        && f.terr(x, y) === 2 && (i === 0 || distance(cells[i - 1], [x, y]) === 1)), title);
      for (const army of ['平', '山', '水']) {
        Object.assign(f.O(subject.id), { soldiers: 700, army });
        assert.ok(cells.every(([x, y]) => Number.isFinite(f.cost(subject, x, y))), title);
      }
    }
    assert.ok(flank.cells.some(p => !main.cells.some(q => distance(p, q) === 0)), title);
    assert.equal(distance(main.cells.at(-1), flank.cells.at(-1)) === 0, city.kind === 'pass', title);
    assert.ok(siege.gates.every(gate => !roads.has(key(gate.x, gate.y))), title);
    fields.add(city.id); entries++;
    bridges += [...roads.values()].filter(r => r.bridge).length;
  }
  assert.equal(fields.size, 39);
  assert.equal(entries, 146);
  assert.ok(bridges > 0, '沿河道路至少有一处桥道');
});

test('道路节省机动力，前哨由实际驻军决定，失守后取消增益', () => {
  const f = new Field(game(), war(), 'att');
  const unit = f.side('att')[0], enemy = f.side('def')[0];
  const { post, roads } = f.approaches, [x, y] = f.approaches.routes[0].cells[1];
  Object.assign(f.O(unit.id), { army: '平', soldiers: 700 });
  const road = roads.get(key(x, y)), roadCost = f.cost(unit, x, y);
  roads.delete(key(x, y));
  assert.equal(roadCost, f.cost(unit, x, y) - 1);
  roads.set(key(x, y), road);
  const initial = f.mobilityBonus('att');
  Object.assign(unit, post);
  f.pool.att = 0; f.endTurn();
  assert.equal(f.pool.att, 0, '同一日不能立即恢复');
  assert.equal(f.postHolder(), unit);
  const nextPool = f.poolWhenNext('att');
  f.endTurn();
  assert.equal(f.pool.att, nextPool);
  assert.equal(f.mobilityBonus('att'), initial + POST_MOBILITY);
  f.O(unit.id).soldiers = 0;
  assert.equal(f.postHolder(), null);
  unit.gone = true;
  Object.assign(enemy, post);
  f.O(enemy.id).soldiers = 700;
  assert.equal(f.postHolder(), enemy);
  assert.equal(f.mobilityBonus('att'), initial);
});

test('升级旧战役只改变之后的战斗，修订 5 中断持久化前哨占位、城门与边缘坐标', () => {
  const g = game(), w = war();
  g.campaignRevision = 11;
  const before = new Field(g, w, 'att'), snapshot = before.snapshot();
  assert.deepEqual([before.width, before.height, before.siege.revision], [32, 19, 4]);
  assert.ok(G.upgradeCampaign(g));
  assert.equal(g.campaignRevision, APPROACH_CAMPAIGN_REVISION);
  assert.deepEqual(Field.restore(g, w, snapshot).map, before.map);
  const f = new Field(g, w, 'att');
  Object.assign(f.side('att')[0], f.approaches.post);
  Object.assign(f.O(f.side('att')[0].id), { soldiers: 700 });
  Object.assign(f.side('att')[1], { x: 38, y: 25 });
  f.siege.gates[0].open = true;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), store = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key),
  } });
  try {
    assert.equal(suspend(g, w, f, { side: 'att', start: {}, after: { kind: 'att' } }), true);
    const rec = takeSuspend(), resumed = Field.restore(rec.g, rec.war, rec.field);
    assert.deepEqual(resumed.approaches, f.approaches);
    assert.deepEqual(resumed.map, f.map);
    assert.deepEqual(resumed.units, f.units);
    assert.equal(resumed.postHolder()?.id, f.postHolder().id);
    assert.ok(resumed.siege.gates[0].open);
    resumed.side('att')[1].x = 40;
    assert.equal(suspend(g, w, resumed, { side: 'att', start: {}, after: { kind: 'att' } }), false);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
  G.setData(base);
  const original = resolveBattlefield(base, G.newGame(4, 1, 7), 12, base.cities[12].roads[0]);
  assert.equal(original.map, base.maps[12]);
  assert.equal(original.approaches, undefined);
});
