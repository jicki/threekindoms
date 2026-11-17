import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { Field } from '../src/core/field.js';
import { applyScenario } from '../src/core/scenario.js';
import { loadScenario } from '../src/core/scenario-store.js';
import { SOVEREIGN_SCENARIO_ID } from '../src/core/visuals.js';
import { chooseRaid, startRaid, resolveRaid, finishRaid, resolveAiRaid, COASTAL_CITIES, validRaidRecord } from '../src/core/raids.js';
import { suspend, peekSuspend, takeSuspend } from '../src/core/suspend.js';
import { aiTurn } from '../src/core/ai.js';
import { setupWar } from '../src/core/warcore.js';

const base = JSON.parse(readFileSync(new URL('../data/game-data.json', import.meta.url)));
const scenario = await loadScenario(SOVEREIGN_SCENARIO_ID, base);
function fixture(player = 7) {
  G.setData(applyScenario(base, scenario), SOVEREIGN_SCENARIO_ID);
  const g = G.newGame(player, 1, 1); g.year = 190; g.month = 0;
  return g;
}
function plan(g, city = 0, kind = 'pirate') {
  const c = g.cities[city];
  return { city, faction: c.faction, kind, troops: Math.min(2000, Math.max(100, Math.floor(G.troopsOf(g, c) * 0.4))) };
}

test('旧游戏不抽袭扰随机数，新开局规则随记录保留', () => {
  try {
    const g = fixture(); assert.equal(g.cityRaids, true); assert.equal(g.smartAiReinforcement, true);
    delete g.cityRaids; const seed = g.seed;
    assert.equal(chooseRaid(g, 7), null); assert.equal(g.seed, seed); assert.equal(g.raidHistory, undefined);
    const loaded = G.upgrade(JSON.parse(JSON.stringify(g))); assert.equal(loaded.cityRaids, undefined);
    G.setData(base); assert.equal(G.newGame(4, 1, 1).cityRaids, undefined);
  } finally { G.setData(base); }
});

test('旧普通及快捷存档不启用新规则，新存档保留开局时的设置', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), records = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k) => records.get(k) ?? null, setItem: (k, v) => records.set(k, String(v)), removeItem: (k) => records.delete(k) } });
  try {
    const old = structuredClone(scenario); delete old.cityRaids; delete old.smartAiReinforcement;
    G.setData(applyScenario(base, old), SOVEREIGN_SCENARIO_ID);
    const original = G.newGame(7, 1, 4); assert.equal(G.save(original, 1), true); assert.equal(G.saveQuick(original), true);
    G.setData(applyScenario(base, scenario), SOVEREIGN_SCENARIO_ID);
    for (const saved of [G.load(1), G.loadQuick()]) { assert.equal(saved.cityRaids, undefined); assert.equal(saved.smartAiReinforcement, undefined); }
    const fresh = G.newGame(7, 1, 4); assert.equal(G.save(fresh, 2), true); assert.equal(G.saveQuick(fresh), true);
    G.setData(applyScenario(base, old), SOVEREIGN_SCENARIO_ID);
    for (const saved of [G.load(2), G.loadQuick()]) { assert.equal(saved.cityRaids, true); assert.equal(saved.smartAiReinforcement, true); }
    assert.equal(G.newGame(7, 1, 4).cityRaids, undefined);
  } finally {
    G.setData(base); if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage;
  }
});

test('损坏的袭扰冷却记录被拒绝，旧存档不受新增字段影响', () => {
  try {
    const g = fixture(); g.seed = 7; assert.ok(chooseRaid(g, 7));
    for (const corrupt of [
      (s) => { s.raidHistory = []; }, (s) => { delete s.raidHistory.checked; },
      (s) => { s.raidHistory.cities[0] = '1900'; }, (s) => { s.raidHistory.factions[999] = 1; },
      (s) => { s.raidWars = { 7: -1 }; },
    ]) {
      const saved = structuredClone(g); corrupt(saved); assert.equal(G.upgrade(saved), null);
    }
    const old = structuredClone(g); delete old.cityRaids; old.raidHistory = [];
    assert.ok(G.upgrade(old));
  } finally { G.setData(base); }
});

test('首年不触发、无守军和粮食的城市不触发，并区分山贼与近海海贼', () => {
  try {
    const g = fixture(); g.year = 189; const seed = g.seed;
    assert.equal(chooseRaid(g, 7), null); assert.equal(g.seed, seed);
    g.year = 190; g.cities[0].rice = 0;
    assert.equal(chooseRaid(g, 7), null);
    assert.ok(COASTAL_CITIES.includes(0)); assert.ok(!COASTAL_CITIES.includes(13));
    for (const [f, cid, expected] of [[7, 0, 'pirate'], [8, 13, 'bandit']]) {
      let found = null;
      for (let seed = 1; seed < 1000 && !found; seed++) {
        const game = fixture(); game.seed = seed; found = chooseRaid(game, f);
        if (found) { assert.equal(found.city, cid); assert.equal(found.kind, expected); assert.ok(found.troops > 0 && found.troops <= G.troopsOf(game, game.cities[cid]) * 0.5); }
      }
      assert.ok(found, `应能生成 ${expected}`);
    }
  } finally { G.setData(base); }
});

test('玩家和电脑分别按 5% 与 1% 抽取，暴乱初期不会叠加袭扰', () => {
  try {
    const seedFor = (value) => {
      for (let seed = 1; seed < 10000; seed++) if (G.rng({ seed })(100) === value) return seed;
      assert.fail(`找不到抽签值 ${value}`);
    };
    for (const [f, draw, expected] of [[7, 4, true], [7, 5, false], [8, 0, true], [8, 1, false]]) {
      const g = fixture(); g.seed = seedFor(draw);
      assert.equal(!!chooseRaid(g, f), expected, `势力 ${f} 抽到 ${draw}`);
    }
    for (const [riot, expected] of [[6, false], [5, false], [4, true]]) {
      const g = fixture(); g.seed = seedFor(0); g.cities[0].riot = riot;
      assert.equal(!!chooseRaid(g, 7), expected, `暴乱冷却 ${riot}`);
    }
  } finally { G.setData(base); }
});

test('守城事件有限频率，同一势力至少间隔 18 个月', () => {
  try {
    let total = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const g = fixture(); g.seed = seed; let last = null;
      for (let n = 0; n < 360; n++) {
        g.year = 190 + Math.floor(n / 12); g.month = n % 12;
        const event = chooseRaid(g, 7);
        if (event) { if (last != null) assert.ok(n - last >= 18); last = n; total++; assert.equal(chooseRaid(g, 7), null); }
      }
    }
    assert.ok(total > 400 && total < 1100, `100 局 30 年共 ${total} 场`);
  } finally { G.setData(base); }
});

test('同月全图最多一场，城市易主后仍保留 18 个月冷却', () => {
  try {
    const g = fixture(); g.seed = 7;
    assert.equal(chooseRaid(g, 7)?.city, 0);
    const seed = g.seed; assert.equal(chooseRaid(g, 8), null); assert.equal(g.seed, seed);
    g.cities[0].faction = 8; g.cities[13].faction = G.NONE; g.cities[13].officers = []; g.factions[8].ai = false;
    g.year = 191; g.month = 5; g.seed = 7; assert.equal(chooseRaid(g, 8), null);
    g.month = 6; g.seed = 7; assert.equal(chooseRaid(g, 8)?.city, 0);
  } finally { G.setData(base); }
});

test('普通战争涉及的势力当月及下月不遭袭扰，原版不记录此状态', () => {
  try {
    for (const enabled of [false, true]) {
      const g = fixture(); if (!enabled) delete g.cityRaids;
      const c = g.cities[0], id = c.officers.at(-1);
      setupWar(g, { from: 0, to: 1, ids: [id], commander: id, gold: 0, rice: 0 });
      if (!enabled) { assert.equal(g.raidWars, undefined); continue; }
      g.seed = 7; assert.equal(chooseRaid(g, 7), null); assert.equal(g.seed, 7);
      g.month = 1; g.seed = 7; assert.equal(chooseRaid(g, 7), null); assert.equal(g.seed, 7);
      g.month = 2; g.seed = 7; assert.equal(chooseRaid(g, 7)?.city, 0);
    }
  } finally { G.setData(base); }
});

test('袭扰当月电脑不会再攻打该势力，次月恢复原决策', async () => {
  try {
    const d = applyScenario(base, scenario);
    for (const row of d.rules.ai_dispatch) row.weights = [16, 0, 0];
    d.rules.ai_domestic.faction_development_threshold_out_of_80.fill(0);
    d.cities[0].roads = [1]; d.cities[0].facilities = { weapons: false, school: false, market: false, hospital: false };
    d.cities[0].ai_shop = []; d.search_table['0'] = []; G.setData(d, SOVEREIGN_SCENARIO_ID);
    for (const protectedNow of [true, false]) {
      const g = G.newGame(1, 2, 1), source = g.cities[0], target = g.cities[1]; g.year = 190;
      g.raidHistory = { factions: { 1: g.year * 12 + g.month - (protectedNow ? 0 : 1) } };
      Object.assign(source, { gold: 1000, rice: 1000, reserve: 0 });
      for (const id of source.officers) Object.assign(g.officers[id], { soldiers: 1000, loyalty: 80, int: 49 });
      g.officers[g.factions[7].ruler].loyalty = 100;
      for (const id of target.officers.slice(1)) Object.assign(g.officers[id], { status: G.RONIN, loc: target.id });
      target.officers = target.officers.slice(0, 1);
      let fought = false;
      await aiTurn(g, 7, { event: async () => {}, war: async () => { fought = true; }, allianceOffer: async () => false });
      assert.equal(fought, !protectedNow);
    }
  } finally { G.setData(base); }
});

test('真实战场的临时敌军不能占据退路或收编，结算后完整清理', () => {
  try {
    const g = fixture(), city = g.cities[0], before = [...city.officers], length = g.officers.length, owner = city.faction;
    Object.assign(G.data().officers[0], { skills: [16], duelSkill: 'fangtian', visual: { portrait: 'b-tianyu-portrait' } });
    const war = startRaid(g, { ...plan(g), troops: 1400 }), field = new Field(g, war, 'def');
    assert.equal(war.att.ids.length, 2); assert.equal(G.name(war.att.ids[0]), '海贼头目');
    const enemy = field.side('att')[0], defender = field.side('def')[0];
    assert.deepEqual(G.data().officers[enemy.id].skills, []); assert.equal(G.data().officers[enemy.id].duelSkill, null);
    assert.equal(G.data().officers[enemy.id].visual, null); assert.ok(field.strategies(enemy).every((skill) => !skill.custom));
    assert.deepEqual(field.retreatTargets(enemy), []); assert.equal(field.legal(enemy, 8, defender), false); assert.equal(field.legal(defender, 8, enemy), false);
    assert.doesNotThrow(() => field.aiDecide(enemy));
    field.end('att', 'commander'); const result = field.result(); resolveRaid(g, war, result);
    assert.equal(city.faction, owner); assert.deepEqual(city.officers, before);
    finishRaid(g, war); assert.equal(g.officers.length, length); assert.equal(g.raidBattle, undefined); assert.equal(G.data().officers[length], undefined);
  } finally { G.setData(base); }
});

test('无效动态武将编号不会留下半场守城或修改城市', () => {
  try {
    const g = fixture(), before = structuredClone(g.cities[0]), count = g.officers.length;
    g.clones = [count]; assert.throws(() => startRaid(g, plan(g)), /无法准备守城战斗/);
    assert.equal(g.officers.length, count); assert.equal(g.raidBattle, undefined); assert.deepEqual(g.cities[0], before);
  } finally { G.setData(base); }
});

test('守城武将被击败后下野，玩家君主阵亡则失败；不战死时君主下野', async () => {
  try {
    for (const target of ['officer', 'ruler', 'protected']) {
      const g = fixture(); g.noWarDeath = target === 'protected';
      const city = g.cities[0], lord = g.factions[7].ruler, id = target === 'officer' ? city.officers.find((i) => i !== lord) : lord;
      const war = startRaid(g, plan(g)), field = new Field(g, war, 'def'), enemy = field.side('att')[0], unit = field.side('def').find((u) => u.id === id);
      const fate = target === 'protected' ? 'captured' : 'dead';
      field.applySkirmish(enemy, unit, { a: { soldiers: field.O(enemy.id).soldiers, hp: 70 }, d: { soldiers: 0, hp: 0, fate, spared: target === 'protected' } });
      if (!field.over) field.end('att', 'commander');
      if (target === 'ruler') g.noWarDeath = true;
      if (target === 'protected') g.noWarDeath = false;
      const result = field.result(); resolveRaid(g, war, result); finishRaid(g, war);
      if (target === 'ruler') { assert.equal(g.officers[id].status, G.DEAD); assert.equal(g.over.type, 'gameover'); }
      else {
        assert.equal(g.officers[id].status, G.RONIN); assert.ok(g.officers[id].hp > 0); assert.equal(g.officers[id].loc, 0);
        assert.ok(!city.officers.includes(id)); assert.equal(g.over, null);
        if (target === 'protected') {
          await G.checkFactions(g, { event: async () => {}, chooseHeir: async (_f, candidates) => candidates[0] });
          assert.notEqual(g.factions[7].ruler, lord); assert.equal(g.officers[lord].status, G.RONIN);
        }
      }
    }
  } finally { G.setData(base); }
});

test('守城白兵和计略会保护普通守将，战后下野而非阵亡', () => {
  try {
    for (const method of ['tactical', 'strategy']) {
      const g = fixture(), city = g.cities[0], id = city.officers.find((i) => i !== g.factions[7].ruler);
      const war = startRaid(g, plan(g)), field = new Field(g, war, 'def');
      const enemy = field.side('att')[0], defender = field.side('def').find((u) => u.id === id);
      if (method === 'tactical') {
        const fight = field.attack(enemy, defender), battle = fight.battle; battle.deploy(); battle.side.d.hp = 0;
        assert.equal(battle.fell('d'), 'captured'); fight.settle();
      } else {
        enemy.x = defender.x; enemy.y = defender.y + 1; field.O(id).hp = 1; field.r = () => 0;
        assert.equal(field.cast(enemy, 1, defender, true).hit, true);
      }
      assert.equal(defender.fate, 'captured'); assert.equal(g.officers[id].status, G.SERVING);
      if (!field.over) field.end('att', 'commander');
      resolveRaid(g, war, field.result()); finishRaid(g, war);
      assert.equal(g.officers[id].status, G.RONIN); assert.ok(g.officers[id].hp > 0);
    }
  } finally { G.setData(base); }
});

test('电脑遇袭始终保留城市和守将，受击败的非君主下野', () => {
  try {
    let ronin = 0, breaches = 0;
    for (let seed = 1; seed <= 500; seed++) {
      const g = fixture(2); g.seed = seed; const city = g.cities[0], owner = city.faction, initial = city.officers.length;
      const result = resolveAiRaid(g, { ...plan(g), troops: 100 });
      if (result.breached) breaches++;
      if (result.ronin != null) { ronin++; assert.equal(g.officers[result.ronin].status, G.RONIN); assert.ok(!city.officers.includes(result.ronin)); }
      assert.equal(city.faction, owner); assert.ok(city.officers.length >= 1 && city.officers.length <= initial);
      assert.ok(city.officers.every((id) => g.officers[id].status === G.SERVING && g.officers[id].soldiers >= 0));
    }
    assert.ok(ronin > 0 && breaches > 0);
    const single = fixture(2), only = single.factions[7].ruler; single.cities[0].officers = [only];
    for (let seed = 1; seed <= 50; seed++) {
      single.seed = seed; resolveAiRaid(single, { ...plan(single), troops: 20 });
      assert.equal(single.cities[0].faction, 7); assert.deepEqual(single.cities[0].officers, [only]);
    }
  } finally { G.setData(base); }
});

test('中断恢复临时敌军且不覆盖旧动态武将，战后不留临时记录', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), records = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k) => records.get(k) ?? null, setItem: (k, v) => records.set(k, String(v)), removeItem: (k) => records.delete(k) } });
  try {
    const g = fixture(), clone = g.officers.length;
    g.officers.push({ ...g.officers[0], id: clone, debut: 190 }); g.clones = [clone]; G.registerClones(g);
    const war = startRaid(g, plan(g)), field = new Field(g, war, 'def'), first = war.att.ids[0];
    const start = Object.fromEntries([...war.att.ids, ...war.def.ids].map((id) => [id, g.officers[id].soldiers]));
    assert.equal(suspend(g, war, field, { side: 'def', start, after: { kind: 'raid' } }), true);
    G.setData(applyScenario(base, scenario), SOVEREIGN_SCENARIO_ID);
    assert.ok(peekSuspend()); const rec = takeSuspend();
    assert.equal(G.name(first), '海贼头目'); assert.equal(G.data().officers[clone].clone, true);
    const resumed = Field.restore(rec.g, rec.war, rec.field); resumed.end('att', 'commander');
    resolveRaid(rec.g, rec.war, resumed.result()); finishRaid(rec.g, rec.war);
    assert.equal(rec.g.officers.length, clone + 1); assert.deepEqual(rec.g.clones, [clone]); assert.equal(G.name(clone), G.name(0));
    const bad = structuredClone(rec.g); bad.raidBattle = { kind: 'pirate', first: 0, count: 1 };
    assert.equal(validRaidRecord(bad, rec.war), false);
  } finally {
    G.setData(base); if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage;
  }
});

test('多种子电脑对局中真实触发守城，城市和武将状态持续一致', async () => {
  try {
    G.setData(applyScenario(base, scenario), SOVEREIGN_SCENARIO_ID); let events = 0, battles = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const g = G.newGame(7, 1, seed); g.player = -1; for (const fac of g.factions) fac.ai = true;
      const io = {
        event: async (e) => { if (e.type === 'autobattle') battles++; },
        raid: async (f) => {
          const incident = chooseRaid(g, f); if (!incident) return;
          events++; const city = g.cities[incident.city], owner = city.faction; resolveAiRaid(g, incident);
          assert.equal(city.faction, owner); assert.ok(city.officers.length);
        },
        aiTurn: async (f) => {
          await aiTurn(g, f, io); const seen = new Set();
          for (const city of g.cities) {
            for (const key of ['gold', 'rice', 'land', 'industry', 'pop', 'reserve']) assert.ok(city[key] >= 0);
            assert.equal(city.officers.length === 0, city.faction === G.NONE);
            for (const id of city.officers) { assert.ok(!seen.has(id)); seen.add(id); assert.equal(g.officers[id].status, G.SERVING); assert.ok(g.officers[id].soldiers >= 0 && g.officers[id].soldiers <= 1000); }
          }
          if (g.year >= 194) g.over = { type: 'test' };
        },
        afterWar: async () => G.checkFactions(g, io), war: async () => assert.fail('全部势力由电脑操作'),
        allianceOffer: async () => false, chooseHeir: async (f) => G.autoHeir(g, f), playerTurn: async () => assert.fail('没有玩家回合'),
      };
      await G.run(g, io); assert.ok(g.year >= 194, `种子 ${seed} 不能提前结束`);
    }
    assert.ok(events > 0, '必须覆盖真实守城触发'); assert.ok(battles > 0, '必须覆盖电脑战争');
  } finally { G.setData(base); }
});
