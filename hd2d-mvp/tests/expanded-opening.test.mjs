import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { aiTurn } from '../src/core/ai.js';
import { Field } from '../src/core/field.js';
import { setupWar } from '../src/core/warcore.js';
import { suspend, takeSuspend } from '../src/core/suspend.js';
import { applyScenario, ORIGINAL_SCENARIO } from '../src/core/scenario.js';
import { loadScenario } from '../src/core/scenario-store.js';
import { SOVEREIGN_SCENARIO_ID } from '../src/core/visuals.js';
import { EXPANDED_MAP_ID, expandMap } from '../src/core/expanded-map.js';

const base = JSON.parse(readFileSync(new URL('../data/game-data.json', import.meta.url)));
const standard = applyScenario(base, await loadScenario(SOVEREIGN_SCENARIO_ID, base));
const useExpanded = () => G.setData(expandMap(standard), EXPANDED_MAP_ID);
const cityValues = (c) => ({ gold: c.gold, rice: c.rice, reserve: c.reserve, gov: c.gov });

test('扩展地图新开局为两方提供相同的有限补给，不取决于玩家和难度', () => {
  const data = useExpanded();
  const expected = {
    8: { gold: 600, rice: 900, reserve: 200, gov: 30 },
    12: { gold: 600, rice: 900, reserve: 200, gov: 30 },
    13: { gold: 600, rice: 750, reserve: 250, gov: 50 },
  };
  const rngState = { seed: 37 }, expectedOrder = G.rng(rngState)(5);
  for (const player of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) for (const level of [0, 1, 2]) {
    const g = G.newGame(player, level, 37);
    assert.equal(g.expandedOpeningGuard, true);
    assert.equal(g.order, expectedOrder); assert.equal(g.seed, rngState.seed, '开局补给不能额外消耗随机数');
    for (const [id, values] of Object.entries(expected)) assert.deepEqual(cityValues(g.cities[id]), values);
    for (const c of g.cities) if (!Object.hasOwn(expected, c.id)) assert.deepEqual(cityValues(c), cityValues(data.cities[c.id]));
  }
  // 开局补给不修改静态数据，也不影响其他版本。
  assert.deepEqual(cityValues(data.cities[8]), { gold: 500, rice: 700, reserve: 100, gov: 20 });
  assert.deepEqual(cityValues(data.cities[12]), { gold: 450, rice: 640, reserve: 100, gov: 20 });
  assert.deepEqual(cityValues(data.cities[13]), { gold: 450, rice: 450, reserve: 100, gov: 45 });
  G.setData(structuredClone(standard), SOVEREIGN_SCENARIO_ID);
  const legacy = G.newGame(8, 1, 37);
  assert.equal(legacy.expandedOpeningGuard, undefined);
  assert.deepEqual(cityValues(legacy.cities[13]), cityValues(standard.cities[13]));
  G.setData(structuredClone(base), ORIGINAL_SCENARIO);
  assert.equal(G.newGame(4, 1, 37).expandedOpeningGuard, undefined);
});

test('新旧扩展记录在关隘战斗中断后保留各自的保护状态和资源', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), records = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (k) => records.get(k) ?? null, setItem: (k, v) => records.set(k, String(v)), removeItem: (k) => records.delete(k),
  } });
  try {
    for (const enabled of [false, true]) {
      useExpanded(); const g = G.newGame(4, 1, 5);
      if (!enabled) { delete g.expandedOpeningGuard; g.cities[13].gold = 321; }
      const src = g.cities[12], defender = g.cities[2], id = defender.officers.find((o) => o !== g.factions[4].ruler);
      defender.officers = defender.officers.filter((o) => o !== id);
      Object.assign(g.cities[34], { faction: 4, officers: [id], gold: 0, rice: 100 });
      const attacker = src.officers.find((o) => o !== g.factions[0].ruler);
      const war = setupWar(g, { from: 12, to: 34, ids: [attacker], commander: attacker, gold: 0, rice: 100 });
      const field = new Field(g, war, 'def');
      assert.ok(suspend(g, war, field, { side: 'def', start: {}, after: { kind: 'def', faction: 0, pts: 1 } }));
      const restored = takeSuspend();
      assert.equal(restored.g.expandedOpeningGuard, enabled ? true : undefined);
      assert.equal(restored.g.cities[13].gold, enabled ? 600 : 321);
      assert.deepEqual(Field.restore(restored.g, restored.war, restored.field).units, field.units);
    }
  } finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage; }
});

test('旧扩展地图记录不自动补资源或启用保护，新记录的标记可保存并校验', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), records = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (k) => records.get(k) ?? null, setItem: (k, v) => records.set(k, String(v)), removeItem: (k) => records.delete(k),
  } });
  try {
    useExpanded();
    const old = G.newGame(8, 1, 5);
    delete old.expandedOpeningGuard;
    Object.assign(old.cities[8], { gold: 41, rice: 42, reserve: 43, gov: 21 });
    Object.assign(old.cities[13], { gold: 51, rice: 52, reserve: 53, gov: 46 });
    old.year = 190;
    assert.ok(G.save(old, 1)); assert.ok(G.saveQuick(old)); assert.ok(G.saveAuto(old));
    for (const loaded of [G.load(1), G.loadQuick(), G.loadAuto()]) {
      assert.ok(loaded);
      assert.equal(loaded.expandedOpeningGuard, undefined);
      assert.deepEqual(cityValues(loaded.cities[8]), { gold: 41, rice: 42, reserve: 43, gov: 21 });
      assert.deepEqual(cityValues(loaded.cities[13]), { gold: 51, rice: 52, reserve: 53, gov: 46 });
    }
    const fresh = G.newGame(8, 1, 6);
    assert.ok(G.save(fresh, 2)); assert.ok(G.saveQuick(fresh)); assert.ok(G.saveAuto(fresh));
    for (const loaded of [G.load(2), G.loadQuick(), G.loadAuto()]) assert.equal(loaded.expandedOpeningGuard, true);
    const corrupt = structuredClone(fresh); corrupt.expandedOpeningGuard = 'true';
    assert.equal(G.upgrade(corrupt), null);
  } finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage; }
});

function fixture(seed, { year = 190, guard = true, own = [20, 22, 23, 24], gate = [21], target = 12 } = {}) {
  const d = useExpanded(), g = G.newGame(4, 1, seed);
  for (const row of d.rules.ai_dispatch) row.weights = [16, 0, 0];
  for (const c of g.cities) Object.assign(c, { faction: G.NONE, officers: [], gold: 0, rice: 0, reserve: 0 });
  Object.assign(g.cities[8], { faction: 4, officers: [...own], gold: 5000, rice: 5000, reserve: 1000 });
  if (gate.length) Object.assign(g.cities[34], { faction: 4, officers: [...gate], gold: 1000, rice: 1000 });
  if (target != null) Object.assign(g.cities[target], { faction: 0, officers: [100], gold: 100, rice: 300 });
  Object.assign(g.factions[4], { ruler: 20, city: 8, ai: true });
  Object.assign(g.factions[0], { ruler: 100, city: target ?? 5, ai: false });
  for (const id of [...own, ...gate, 100]) Object.assign(g.officers[id], { status: G.SERVING, soldiers: 1000, loyalty: id === 20 || id === 100 ? 100 : 90 });
  if (guard) g.expandedOpeningGuard = true; else delete g.expandedOpeningGuard;
  g.year = year; g.seed = seed;
  return g;
}

async function takeTurn(g) {
  let war = null;
  await aiTurn(g, 4, { event: async () => {}, war: async (w) => { war = w; }, afterWar: async () => {} });
  return war;
}

test('旧记录中单将关隘面对空守敌方据点时保持原有电脑回合结果', async () => {
  const d = useExpanded(), g = G.newGame(4, 2, 5);
  for (const row of d.rules.ai_dispatch) row.weights = [16, 0, 0];
  for (const c of g.cities) Object.assign(c, { faction: G.NONE, officers: [], gold: 0, rice: 0, reserve: 0, gov: d.cities[c.id].gov });
  Object.assign(g.cities[8], { faction: 4, officers: [20], gold: 1000, rice: 1000 });
  Object.assign(g.cities[34], { faction: 4, officers: [21], gold: 1000, rice: 1000 });
  Object.assign(g.cities[12], { faction: 0, officers: [], gold: 100, rice: 100 });
  Object.assign(g.factions[4], { ruler: 20, city: 8, ai: true });
  Object.assign(g.factions[0], { ruler: 100, city: 12, ai: false });
  Object.assign(g.officers[20], { status: G.SERVING, soldiers: 1000, loyalty: 100 });
  Object.assign(g.officers[21], { status: G.SERVING, soldiers: 1000, loyalty: 90 });
  delete g.expandedOpeningGuard; g.warlike = true; g.year = 190; g.seed = 0;
  assert.ok(G.upgrade(g), '这种旧记录可被读取');
  assert.equal(await takeTurn(g), null);
  // 与修改前相同种子的完整电脑回合结果对照，包含后续内政，而非仅检查是否出兵。
  assert.deepEqual(cityValues(g.cities[8]), { gold: 462, rice: 949, reserve: 0, gov: 26 });
  assert.equal(g.seed, 440012079);
});

test('电脑为关隘调兵时保护最后一城，旧记录不启用新限制', async () => {
  let contrasted = false;
  for (let seed = 0; seed < 80; seed++) {
    const old = fixture(seed, { guard: false }); await takeTurn(old);
    const fresh = fixture(seed); await takeTurn(fresh);
    assert.ok(fresh.cities[8].officers.length >= 3, `种子 ${seed} 不应抽空君主城`);
    if (old.cities[8].officers.length < 3 && fresh.cities[8].officers.length >= 3) contrasted = true;
  }
  assert.ok(contrasted, '至少一个相同种子应表现出新旧调兵差异');
});

test('电脑从君主城向无主据点扩张时也保留守军', async () => {
  const run = async (seed, guard) => {
    const g = fixture(seed, { own: [20, 22, 23], gate: [], target: null, guard });
    Object.assign(g.cities[2], { faction: 4, officers: [24, 25, 26, 27, 28], gold: 5000, rice: 5000 });
    for (const id of g.cities[2].officers) Object.assign(g.officers[id], { status: G.SERVING, soldiers: 1000, loyalty: 90 });
    await takeTurn(g); return g;
  };
  let contrasted = false;
  for (let seed = 0; seed < 80; seed++) {
    const old = await run(seed, false), fresh = await run(seed, true);
    assert.ok(fresh.cities[8].officers.length >= 3, `种子 ${seed} 扩张时不能抽空君主城`);
    if (old.cities[8].officers.length < 3) contrasted = true;
  }
  assert.ok(contrasted, '至少一个相同种子应减少无主据点的出兵人数');
});

test('开局保护期间电脑不会把君主城整体撤到关隘', async () => {
  const run = async (seed, guard, year = 190) => {
    const g = fixture(seed, { own: [20], gate: [21], target: null, guard, year });
    Object.assign(g.cities[15], { faction: 4, officers: [22], gold: 100, rice: 100 });
    Object.assign(g.officers[22], { status: G.SERVING, soldiers: 500, loyalty: 90 });
    await takeTurn(g); return g;
  };
  let contrasted = false;
  for (let seed = 0; seed < 80; seed++) {
    const old = await run(seed, false), fresh = await run(seed, true);
    assert.equal(fresh.cities[8].faction, 4, `种子 ${seed} 不应主动放弃君主城`);
    if (old.cities[8].faction === G.NONE) contrasted = true;
    const expired = await run(seed, true, 194), legacy = await run(seed, false, 194);
    assert.deepEqual(expired.cities, legacy.cities);
    assert.equal(expired.seed, legacy.seed);
  }
  assert.ok(contrasted, '至少一个相同种子应保留原本被放弃的君主城');
});

test('电脑从君主城出征时留守适量武将，五年后恢复原有决策', async () => {
  let contrasted = false;
  const opts = { own: [20, 22, 23, 24, 25], gate: [], target: 5 };
  for (let seed = 0; seed < 80; seed++) {
    const old = fixture(seed, { ...opts, guard: false }); const oldWar = await takeTurn(old);
    const fresh = fixture(seed, opts); const newWar = await takeTurn(fresh);
    assert.ok(fresh.cities[8].officers.length >= 3);
    if (oldWar && newWar && old.cities[8].officers.length < 3) contrasted = true;
    const expired = fixture(seed, { ...opts, year: 194 }); const expiredWar = await takeTurn(expired);
    const legacy = fixture(seed, { ...opts, year: 194, guard: false }); const legacyWar = await takeTurn(legacy);
    assert.deepEqual(expired.cities[8].officers, legacy.cities[8].officers);
    assert.deepEqual(expiredWar?.att.ids, legacyWar?.att.ids);
    assert.equal(expired.seed, legacy.seed);
  }
  assert.ok(contrasted, '至少一个相同种子应减少君主城出征人数');
});

test('君主驻守关隘时，电脑仍保护最后一座城市', async () => {
  let contrasted = false, fought = false;
  for (let seed = 0; seed < 80; seed++) {
    const opts = { own: [22, 23, 24, 25], gate: [20], target: 5 };
    const old = fixture(seed, { ...opts, guard: false }); old.factions[4].city = 34; const oldWar = await takeTurn(old);
    const fresh = fixture(seed, opts); fresh.factions[4].city = 34; const freshWar = await takeTurn(fresh);
    assert.ok(fresh.cities[8].officers.length >= 3, `种子 ${seed} 应保护最后一城`);
    if (freshWar) fought = true;
    if (oldWar && freshWar && old.cities[8].officers.length < 3) contrasted = true;
  }
  assert.ok(fought, '仍可在留守后发起进攻');
  assert.ok(contrasted, '至少一个相同种子应减少最后一城的出征人数');
});

test('开启电脑好战时开局仍保留守军且可以进攻', async () => {
  let fought = false;
  for (let seed = 0; seed < 80; seed++) {
    const g = fixture(seed, { own: [20, 22, 23, 24, 25], gate: [], target: 5 });
    g.warlike = true;
    if (await takeTurn(g)) fought = true;
    assert.ok(g.cities[8].officers.length >= 3, `种子 ${seed} 应为君主城留守`);
  }
  assert.ok(fought, '电脑好战仍应能够发起进攻');
});

test('两名或三名武将的单城势力仍可派一人占领空关', async () => {
  for (const own of [[20, 22], [20, 22, 23]]) {
    let occupied = false;
    for (let seed = 0; seed < 80 && !occupied; seed++) {
      const g = fixture(seed, { own, gate: [], target: null });
      await takeTurn(g);
      if (g.cities[34].faction === 4 || g.cities[35].faction === 4) {
        assert.equal(g.cities[8].officers.length, own.length - 1);
        occupied = true;
      }
    }
    assert.ok(occupied, `${own.length} 名武将时不能被开局保护阻止扩张`);
  }
});
