import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { applyScenario } from '../src/core/scenario.js';
import { loadScenario } from '../src/core/scenario-store.js';
import { SOVEREIGN_SCENARIO_ID } from '../src/core/visuals.js';
import { Field } from '../src/core/field.js';
import { suspend, peekSuspend } from '../src/core/suspend.js';

const base = JSON.parse(readFileSync(new URL('../data/game-data.json', import.meta.url)));

function fixture(kind, defense, enhanced, values = {}) {
  const data = structuredClone(base); data.rules[kind === 'drought' ? 'drought_cities' : 'flood_cities'] = [0];
  G.setData(data); const g = G.newGame(4, 1, 1), city = g.cities[0];
  Object.assign(city, { faction: 4, disaster: defense, gold: 1000, rice: 1000, land: 1000, industry: 1000, pop: 1000, officers: [222], ...values });
  g.officers[222].soldiers = 1000; g.seed = 7; // 首个城市的灾害抽签命中。
  if (enhanced) g.enhancedDisasters = true;
  return { g, city };
}

test('原版灾害保留原结算及事件标记', () => {
  try {
    for (const [defense, land, result] of [[0, 750, 0], [20, 900, 4], [80, 800, 8], [99, 1000, 0]]) {
      const { g, city } = fixture('drought', defense, false);
      const hit = G.disaster(g, 'drought');
      assert.equal(city.land, land); assert.deepEqual(hit, [[0, result]]);
      assert.equal(city.gold, 1000); assert.equal(city.rice, 1000);
      if (defense === 99) assert.ok(city.disaster < 99, '原版防灾值本身仍会下降');
    }
  } finally { G.setData(base); }
});

test('增强灾害保证金米及土地产业损失，并随防灾提升减轻', () => {
  try {
    for (const kind of ['drought', 'flood']) {
      let last = null;
      for (const defense of [0, 19, 20, 49, 50, 79, 80, 98, 99]) {
        const { g, city } = fixture(kind, defense, true), before = structuredClone(city), beforeTroops = g.officers[222].soldiers;
        const [hit] = G.disaster(g, kind), losses = hit[2];
        assert.equal(hit[0], 0);
        for (const key of ['gold', 'rice', 'land', 'industry']) {
          assert.ok(losses[key] > 0, `${kind} / ${defense}：${key} 应受损`);
          assert.equal(losses[key], before[key] - city[key]); assert.ok(city[key] >= 0);
          if (last) assert.ok(losses[key] <= last[key], `${kind} / ${defense}：提高防灾不能加重 ${key} 的损失`);
        }
        assert.equal(losses.pop, before.pop - city.pop);
        assert.equal(losses.soldiers, beforeTroops - g.officers[222].soldiers);
        assert.ok(city.pop >= 0 && g.officers[222].soldiers >= 0);
        last = losses;
      }
    }
  } finally { G.setData(base); }
});

test('增强灾害金米最低损失 50、土地产业最低损失 5，库存不足时不透支', () => {
  try {
    for (const kind of ['drought', 'flood']) {
      const { g, city } = fixture(kind, 99, true, { gold: 100, rice: 100, land: 100, industry: 100, pop: 0 });
      const [[, , loss]] = G.disaster(g, kind);
      assert.deepEqual([loss.gold, loss.rice, loss.land, loss.industry], [50, 50, 5, 5]);
      assert.deepEqual([city.gold, city.rice, city.land, city.industry], [50, 50, 95, 95]);
      const poor = fixture(kind, 99, true, { gold: 49, rice: 7, land: 4, industry: 2, pop: 0 });
      G.disaster(poor.g, kind);
      assert.deepEqual([poor.city.gold, poor.city.rice, poor.city.land, poor.city.industry], [0, 0, 0, 0]);
    }
  } finally { G.setData(base); }
});

test('不同灾种的损失有明确数值，玩家和电脑城市采用同一规则', () => {
  try {
    for (const [kind, expected] of [
      ['drought', { gold: 70, rice: 70, land: 320, industry: 70, pop: 250, soldiers: 250, disaster: 0 }],
      ['flood', { gold: 70, rice: 570, land: 70, industry: 320, pop: 250, soldiers: 0, disaster: 0 }],
    ]) {
      for (const owner of [4, 2]) {
        const { g, city } = fixture(kind, 0, true, { faction: owner });
        const [[, , losses]] = G.disaster(g, kind); assert.deepEqual(losses, expected);
        assert.deepEqual([city.gold, city.rice, city.land, city.industry, city.pop], [1000 - expected.gold, 1000 - expected.rice, 1000 - expected.land, 1000 - expected.industry, 750]);
      }
    }
  } finally { G.setData(base); }
});

test('灾害损失不超过已有资源，空城及零资源不会产生负数', () => {
  try {
    for (const kind of ['drought', 'flood']) {
      const { g, city } = fixture(kind, 99, true, { gold: 3, rice: 5, land: 1, industry: 1, pop: 0 });
      g.officers[222].soldiers = 0;
      const [[, , losses]] = G.disaster(g, kind);
      assert.deepEqual([city.gold, city.rice, city.land, city.industry], [0, 0, 0, 0]);
      assert.deepEqual([losses.gold, losses.rice, losses.land, losses.industry, losses.pop, losses.soldiers], [3, 5, 1, 1, 0, 0]);
      const empty = fixture(kind, 0, true, { faction: G.NONE });
      const previous = structuredClone(empty.city); assert.deepEqual(G.disaster(empty.g, kind), []); assert.deepEqual(empty.city, previous);
      const zero = fixture(kind, 0, true, { gold: 0, rice: 0, land: 0, industry: 0, pop: 0 });
      zero.g.officers[222].soldiers = 0;
      const [[, , noLoss]] = G.disaster(zero.g, kind); assert.ok(Object.values(noLoss).every((value) => value === 0));
    }
  } finally { G.setData(base); }
});

test('增强规则不额外抽取随机数，避免改变其他事件的随机顺序', () => {
  try {
    for (const kind of ['drought', 'flood']) for (const defense of [0, 20, 80, 99]) {
      const legacy = fixture(kind, defense, false); G.disaster(legacy.g, kind);
      const enhanced = fixture(kind, defense, true); G.disaster(enhanced.g, kind);
      assert.equal(enhanced.g.seed, legacy.g.seed, `${kind} / ${defense}`);
    }
  } finally { G.setData(base); }
});

test('相邻月份连续受灾时额外损失减半，保底和旧记录兼容', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), records = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (k) => records.get(k) ?? null, setItem: (k, v) => records.set(k, String(v)), removeItem: (k) => records.delete(k),
  } });
  try {
    for (const kind of ['drought', 'flood']) {
      const { g } = fixture(kind, 0, true);
      g.year = 190; g.month = 4; g.seed = 7;
      const [[, , first]] = G.disaster(g, kind);
      assert.ok(first.gold >= 50 && first.rice >= 50 && first.land >= 5 && first.industry >= 5);
      assert.equal(G.save(g, 1), true); assert.equal(G.saveQuick(g), true);
      const saved = G.load(1), quick = G.loadQuick(); assert.ok(saved && quick);
      assert.deepEqual(quick.disasterHistory, saved.disasterHistory);
      const unprotected = structuredClone(saved); delete unprotected.disasterHistory;
      for (const state of [saved, unprotected]) { state.month = 5; state.seed = 7; }
      const [[, , reduced]] = G.disaster(saved, kind), [[, , full]] = G.disaster(unprotected, kind);
      for (const key of ['gold', 'rice', 'land', 'industry']) assert.ok(reduced[key] >= (key === 'gold' || key === 'rice' ? 50 : 5));
      assert.ok(reduced.pop < full.pop);
      if (kind === 'flood') { assert.ok(reduced.rice < full.rice); assert.ok(reduced.industry < full.industry); }
      else { assert.ok(reduced.land < full.land); assert.ok(reduced.soldiers < full.soldiers); }
      // 间隔一个月后恢复正常额外损失；没有历史的旧记录也可以读取。
      const gap = structuredClone(g); gap.month = 6; gap.seed = 7;
      const old = structuredClone(gap); delete old.disasterHistory; assert.ok(G.upgrade(old));
      assert.deepEqual(G.disaster(gap, kind), G.disaster(old, kind));
    }
  } finally {
    G.setData(base); if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage;
  }
});

test('旧记录缺少增强标记时沿用旧灾害，新开局和新记录保存规则', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), records = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (k) => records.get(k) ?? null, setItem: (k, v) => records.set(k, String(v)), removeItem: (k) => records.delete(k),
  } });
  try {
    const scenario = await loadScenario(SOVEREIGN_SCENARIO_ID, base), old = structuredClone(scenario); delete old.enhancedDisasters;
    G.setData(applyScenario(base, old), SOVEREIGN_SCENARIO_ID);
    const g = G.newGame(7, 1, 4); assert.equal(g.enhancedDisasters, undefined); g.cities[0].gold = 67;
    assert.equal(G.save(g, 1), true); assert.equal(G.saveQuick(g), true);
    const war = { city: 12, from: 0, attacker: 7, defender: 0, att: { ids: [254], gold: 100, rice: 500 }, def: { ids: [38], gold: 100, rice: 500 } };
    assert.equal(suspend(g, war, new Field(g, war, 'att'), { side: 'att', start: { 254: 500, 38: 500 }, after: { kind: 'att' } }), true);
    G.setData(applyScenario(base, scenario), SOVEREIGN_SCENARIO_ID);
    for (const saved of [G.load(1), G.loadQuick(), peekSuspend().g]) { assert.equal(saved.enhancedDisasters, undefined); assert.equal(saved.cities[0].gold, 67); }
    const fresh = G.newGame(7, 1, 4); assert.equal(fresh.enhancedDisasters, true);
    assert.equal(G.save(fresh, 2), true); assert.equal(G.load(2).enhancedDisasters, true);
    assert.equal(G.saveQuick(fresh), true);
    assert.equal(suspend(fresh, war, new Field(fresh, war, 'att'), { side: 'att', start: { 254: 500, 38: 500 }, after: { kind: 'att' } }), true);
    G.setData(applyScenario(base, old), SOVEREIGN_SCENARIO_ID);
    for (const saved of [G.load(2), G.loadQuick(), peekSuspend().g]) assert.equal(saved.enhancedDisasters, true);
    assert.equal(G.newGame(7, 1, 4).enhancedDisasters, undefined, '修改剧本开关只作用于新的开局');
    G.setData(base); assert.equal(G.newGame(4, 1, 1).enhancedDisasters, undefined);
  } finally {
    G.setData(base);
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage;
  }
});

test('跨月灾害只触发一次，已开始回合恢复不会重复结算', async () => {
  try {
    const scenario = await loadScenario(SOVEREIGN_SCENARIO_ID, base), data = applyScenario(base, scenario);
    data.rules.flood_cities = [0]; G.setData(data, SOVEREIGN_SCENARIO_ID);
    const g = G.newGame(7, 1, 7); g.ageless = true;
    Object.assign(g, { year: 190, month: 3, turnIdx: g.factions.length - 1, monthDone: true, current: null, seed: 7 });
    let floods = 0, savedGold;
    const io = { event: async (e) => { if (e.type === 'disaster' && e.kind === 'flood') floods++; },
      aiTurn: async () => {}, playerTurn: async () => { savedGold = g.cities[0].gold; g.over = { type: 'test' }; } };
    await G.run(g, io); assert.equal(floods, 1); assert.equal(g.month, 4);
    const resumed = G.upgrade(JSON.parse(JSON.stringify(g))); resumed.over = null;
    await G.run(resumed, { ...io, playerTurn: async () => { resumed.over = { type: 'test' }; } });
    assert.equal(floods, 1); assert.equal(resumed.cities[0].gold, savedGold);
  } finally { G.setData(base); }
});
