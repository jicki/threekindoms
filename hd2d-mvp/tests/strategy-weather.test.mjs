import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { applyScenario } from '../src/core/scenario.js';
import { loadScenario } from '../src/core/scenario-store.js';
import { EXPANDED_MAP_ID, expandMap } from '../src/core/expanded-map.js';
import { SOVEREIGN_SCENARIO_ID } from '../src/core/visuals.js';
import { CASTLE, Field, FOREST, PLAIN, RIVER } from '../src/core/field.js';

const base = JSON.parse(readFileSync(new URL('../data/game-data.json', import.meta.url)));
const expanded = expandMap(applyScenario(base, await loadScenario(SOVEREIGN_SCENARIO_ID, base)));
const month = { clear: 3, rain: 4, snow: 11 };
const chief = expanded.officers.find(o => o?.name === '诸葛亮').id;

function encounter(id, weather, { caster = 40, revision, keepSiege = false } = {}) {
  G.setData(expanded, EXPANDED_MAP_ID);
  const g = G.newGame(4, 1, 9);
  if (revision) g.campaignRevision = revision;
  g.month = month[weather]; g.enhancedRulerPassives = false;
  for (const officer of [caster, 41, 42, 43]) Object.assign(g.officers[officer], {
    hp: 90, soldiers: 900, level: officer === caster ? 8 : 4,
    war: 72, int: officer === caster ? 96 : 77, virtue: 70, loyalty: 45,
  });
  const war = {
    city: 34, from: 8, attacker: 4, defender: 0,
    att: { ids: [caster, 41], gold: 500, rice: 900 },
    def: { ids: [42, 43], gold: 500, rice: 900 },
  };
  const f = new Field(g, war, 'att'), [u, helper] = f.side('att'), [target, neighbour] = f.side('def');
  // 单项公式验证使用相同的无遮挡地格，城门限制有独立的回归测试。
  if (!keepSiege) f.siege = null;
  f.pool.att = 100; f.r = () => 0;
  Object.assign(u, { x: 3, y: 3 }); Object.assign(helper, { x: 4, y: 4 });
  Object.assign(target, { x: 4, y: 3 }); Object.assign(neighbour, { x: 4, y: 2 });
  f.map[3][3] = id === 9 || id === 13 ? CASTLE : id === 11 ? FOREST : PLAIN;
  f.map[2][4] = f.map[3][4] = [4, 10, 12].includes(id) ? RIVER : id === 6 ? CASTLE : FOREST;
  assert.equal(f.weather, weather);
  return { f, u, target, neighbour };
}

// Each case exercises the same path used by the UI, including the extraordinary recruitment roll.
const changes = [
  [0,-10,-6], [1,6,-4], [2,5,6], [3,4,-4], [4,8,-8], [5,-10,-6], [6,-10,-6],
  [7,-10,-6], [8,-4,4], [9,4,-4], [10,8,-8], [12,8,-8], [13,-6,-4], [14,-10,-6],
  [16,-6,-8], [17,4,6],
];
for (const [id, rain, snow] of changes) {
  test(`计策 ${id} 的雨雪命中、实际施放和观天免疫使用同一规则`, () => {
    for (const caster of [40, chief]) {
      const thresholds = {};
      for (const weather of ['clear', 'rain', 'snow']) {
        const { f, u, target } = encounter(id, weather, { caster });
        assert.ok(f.strategies(u).some(s => s.id === id), `计策 ${id} 必须可习得`);
        assert.ok(f.canCast(u, id, target));
        thresholds[weather] = id === 8 ? f.lureChance(u, target) : f.hitChance(u, target, id);
        assert.ok(f.cast(u, id, target).hit);
        if (weather !== 'clear') assert.match(f.strategyWeather(u, id), caster === chief ? /观天免疫/ : /命中阈值/);
      }
      assert.equal(thresholds.rain, thresholds.clear + (caster === chief ? 0 : rain));
      assert.equal(thresholds.snow, thresholds.clear + (caster === chief ? 0 : snow));
    }
  });
}

function impact(id, weather, options) {
  const { f, u, target } = encounter(id, weather, options);
  if (id === 11) {
    assert.ok(f.cast(u, id, null).hit);
    assert.equal(f.O(u.id).soldiers, 800);
    return f.ambushCheck(target).damage;
  }
  const result = f.cast(u, id, target);
  assert.ok(result.hit);
  return -(id === 5 ? result.hits[0].rice : result.hits[0].soldiers);
}

test('受天气影响的火水伤害、火箭烧粮和十面埋伏按倍率结算', () => {
  for (const [id, rain, snow] of [[0,85,90], [4,115,90], [5,85,90], [11,110,108], [12,115,90], [14,85,90]]) {
    const clear = impact(id, 'clear');
    assert.ok(clear > 0);
    assert.equal(impact(id, 'rain'), Math.floor(clear * rain / 100));
    assert.equal(impact(id, 'snow'), Math.floor(clear * snow / 100));
    assert.equal(impact(id, 'rain', { caster: chief }), impact(id, 'clear', { caster: chief }));
  }
});

test('十面埋伏不能跨过未突破城门，破门后同一路径可触发', () => {
  const { f, u, target } = encounter(11, 'rain', { keepSiege: true });
  const { cx, cy, outer } = f.siege, gate = f.siege.gates.find(g => g.x === cx - outer && g.y === cy);
  Object.assign(u, { x: gate.x - 1, y: gate.y }); f.map[u.y][u.x] = FOREST;
  Object.assign(target, { x: gate.x, y: gate.y }); f.map[target.y][target.x] = FOREST;
  assert.ok(f.cast(u, 11, null).hit);
  assert.equal(f.ambushCheck(target), null);
  assert.ok(f.ambush.att);
  gate.open = true;
  assert.ok(f.ambushCheck(target).damage > 0);
});

test('电脑在雨中优先使用有合法目标的强势水计，晴天保留原有优先级', () => {
  for (const [weather, expected] of [['rain',4], ['clear',7]]) {
    const { f, u, target, neighbour } = encounter(7, weather);
    Object.assign(neighbour, { x: 5, y: 3 });
    const riverTarget = { ...target, id: 50, commander: false, x: 3, y: 2 };
    f.units.push(riverTarget); f.map[2][3] = RIVER; f.O(50).soldiers = 700;
    const act = f.aiStrategy(u, false);
    assert.equal(act.id, expected);
    assert.equal(act.t, weather === 'rain' ? riverTarget : target);
  }
});

test('修订 2 的既有记录和中断按原天气恢复，升级后才生效', () => {
  const { f, u, target } = encounter(1, 'rain', { revision: 2, keepSiege: true });
  assert.equal(f.strategyWeather(u, 1), '');
  const before = structuredClone(f.g), prior = Field.restore(G.upgrade(structuredClone(f.g)), f.war, f.snapshot());
  assert.equal(prior.hitChance(prior.side('att')[0], prior.side('def')[0], 1), f.hitChance(u, target, 1));
  const g = structuredClone(before);
  assert.ok(G.upgradeCampaign(g));
  assert.deepEqual(g, { ...before, campaignRevision: 8 });
  assert.equal(impact(5, 'rain', { revision: 2 }), impact(5, 'clear', { revision: 2 }));
});
