import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { aiDomestic, aiTurn } from '../src/core/ai.js';
import { Field, PLAIN } from '../src/core/field.js';
import { Duel } from '../src/core/skirmish.js';
import { Tactical } from '../src/core/tactical.js';
import { suspend, peekSuspend } from '../src/core/suspend.js';
import { fight } from '../src/core/warcore.js';
import { applyScenario, validateScenario } from '../src/core/scenario.js';
import { loadScenario } from '../src/core/scenario-store.js';
import { HERO_SCENARIO_ID, ROSTER_SCENARIO_ID, WARLORD_SCENARIO_ID } from '../src/core/visuals.js';

const base = JSON.parse(readFileSync(new URL('../data/game-data.json', import.meta.url)));
const scenario = await loadScenario(WARLORD_SCENARIO_ID, base);
const expanded = () => applyScenario(base, scenario);
const use = () => G.setData(expanded(), WARLORD_SCENARIO_ID);

test('十势力开局、随军名册和无主编号保持一致，原版数据不变', () => {
  const before = JSON.stringify(base), d = use();
  try {
    assert.equal(G.NONE, 10); assert.equal(d.factions.length, 10);
    for (const [f, name, city, followers] of [[7, '公孙瓒', 0, ['严纲', '关靖', '田楷']],
      [8, '袁术', 13, ['纪灵', '阎象', '张勋']], [9, '刘表', 21, ['蒯越', '蒯良', '文聘', '蔡瑁']]]) {
      const g = G.newGame(f, 1, 42), ruler = g.factions[f].ruler, roster = g.cities[city].officers;
      assert.equal(G.name(ruler), name); assert.equal(g.cities[city].faction, f);
      assert.equal(roster[0], ruler); assert.equal(g.factions[f].city, city); assert.equal(g.officers[ruler].loyalty, 100);
      assert.deepEqual(roster.slice(1).map(G.name).sort(), followers.sort());
      assert.ok(roster.every((id) => g.officers[id].status === G.SERVING));
      assert.equal(g.factions[f].alliance.length, 10); assert.equal(g.aiCursor.length, 10);
      assert.equal(G.isRuler(g, ruler), true);
    }
    const g = G.newGame(9, 1, 42);
    assert.equal(g.cities[5].faction, G.NONE); assert.equal(G.factionName(g, G.NONE), '无主');
    const moved = g.cities[21].officers[1]; assert.equal(G.moveOfficers(g, 21, 22, [moved]).ok, true);
    assert.equal(g.cities[22].faction, 9);
    assert.equal(G.moveOfficers(g, 21, 13, [g.cities[21].officers[1]]).ok, false, '其他新势力不是无主城');
    assert.equal(JSON.stringify(base), before);
  } finally { G.setData(base); }
  assert.equal(G.NONE, 7);
});

test('仅添加一个或两个势力的版本也能正确区分无主城市', async () => {
  try {
    for (const count of [1, 2]) {
      const draft = structuredClone(await loadScenario(ROSTER_SCENARIO_ID, base));
      draft.factions = structuredClone(scenario.factions.slice(0, count));
      draft.officers.push(...scenario.officers.filter((o) => o.id >= 246 && o.id < 246 + count)
        .map((o) => ({ ...structuredClone(o), skills: [] })));
      assert.equal(validateScenario(draft, base), true);
      G.setData(applyScenario(base, draft));
      const g = G.newGame(7, 1, 42);
      assert.equal(G.NONE, 7 + count); assert.equal(g.factions.length, 7 + count);
      assert.equal(g.cities[0].faction, 7); assert.equal(g.cities[5].faction, G.NONE);
      assert.equal(g.cities[13].faction, count === 2 ? 8 : G.NONE);
      for (const order of G.data().rules.turn_orders) assert.equal(new Set(order).size, 7 + count);
    }
  } finally { G.setData(base); }
});

test('五种回合顺序均覆盖十个势力，完整轮转后才进入下月', async () => {
  const d = use();
  try {
    for (const [index, order] of d.rules.turn_orders.entries()) {
      assert.equal(order.length, 10); assert.deepEqual([...order].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      assert.deepEqual(order.filter((f) => f < 7), base.rules.turn_orders[index]);
      const g = G.newGame(order.at(-1), 1, 7); g.order = index; g.ageless = true;
      const turns = [], io = { event: async () => {}, aiTurn: async (f) => turns.push([g.month, f]),
        playerTurn: async (f) => { turns.push([g.month, f]); if (turns.length === 20) g.over = { type: 'test' }; else g.endTurn = true; } };
      await G.run(g, io);
      assert.deepEqual(turns.slice(0, 10), order.map((f) => [0, f]));
      assert.deepEqual(turns.slice(10), order.map((f) => [1, f]));
    }
  } finally { G.setData(base); }
});

test('新势力的电脑可内政、出回合并分配多将战场职责', async () => {
  use();
  try {
    for (const [f, city] of [[7, 0], [8, 13], [9, 21]]) {
      const g = G.newGame(4, 1, 17), before = g.cities[city].industry;
      aiDomestic(g, f, 5, () => 0);
      assert.ok(g.cities[city].industry > before, '新势力采用有效的内政参数');
      await aiTurn(g, f, { war: async () => {}, event: async () => {}, allianceOffer: async () => false });
      assert.ok(Number.isInteger(g.aiCursor[f]));
      const ids = g.cities[city].officers.slice(0, 2), foe = g.cities[12].officers.slice(0, 2);
      const war = { city: 12, from: city, attacker: f, defender: 0,
        att: { ids, gold: 100, rice: 500 }, def: { ids: foe, gold: 100, rice: 500 } };
      const field = new Field(g, war, 'att');
      assert.equal(field.side('att').length, 2); assert.equal(field.side('def').length, 2);
      assert.ok(field.side('att').every((u) => Number.isInteger(u.role)));
    }
  } finally { G.setData(base); }
});

test('多个随机种子的十势力电脑对局可持续轮转并保持城市与武将一致', async () => {
  use();
  try {
    for (const seed of [1, 37, 901]) {
      const g = G.newGame(0, 1, seed); g.year = 190; g.noWarDeath = true; g.ageless = true; g.warlike = true;
      for (const faction of g.factions) faction.ai = true;
      // 190 年开放出兵；补足新势力军备以覆盖短模拟中的真实电脑战斗。
      for (const f of [7, 8, 9]) {
        const city = g.cities[g.factions[f].city]; city.gold = city.rice = 3000;
        while (city.officers.length < 8) {
          const recruit = g.officers.find((o) => o.status === G.UNAPPEARED);
          recruit.status = G.SERVING; city.officers.push(recruit.id);
        }
        for (const id of city.officers) g.officers[id].soldiers = 1000;
      }
      let turns = 0, wars = 0;
      const io = {
        event: async (event) => { if (event.type === 'autobattle') wars++; },
        aiTurn: async (f) => {
          await aiTurn(g, f, io); turns++;
          const seen = new Set();
          for (const city of g.cities) {
            assert.ok(city.officers.length <= 10);
            if (!city.officers.length) assert.equal(city.faction, G.NONE);
            for (const id of city.officers) { assert.ok(!seen.has(id), `武将 ${id} 不应同时在两个城市`); seen.add(id); assert.equal(g.officers[id].status, G.SERVING); }
          }
          if (turns >= 60) g.over = { type: 'test' };
        },
        afterWar: async () => G.checkFactions(g, io),
        war: async () => { throw new Error('全部势力由电脑操作时不应进入玩家战场'); },
        allianceOffer: async () => false, chooseHeir: async (f) => G.autoHeir(g, f),
        playerTurn: async () => { throw new Error('全部势力由电脑操作时不应进入玩家回合'); },
      };
      await G.run(g, io);
      assert.ok(turns >= 20, `种子 ${seed} 提前结束于第 ${turns} 回合`);
      assert.ok(wars > 0, `种子 ${seed} 未覆盖电脑战斗`);
    }
  } finally { G.setData(base); }
});

test('新君主和部属可施展专属技，伤害、行动力及使用上限受控', () => {
  use();
  try {
    for (const [f, casterId, skillId] of [[7, 246, 24], [8, 247, 25], [9, 248, 26], [7, 249, 27], [8, 251, 28], [9, 18, 29]]) {
      const g = G.newGame(f, 1, 5), skill = G.data().customSkills.find((s) => s.id === skillId);
      const war = { city: 12, from: g.factions[f].city, attacker: f, defender: 0,
        att: { ids: [casterId], gold: 100, rice: 500 }, def: { ids: [38], gold: 100, rice: 500 } };
      const field = new Field(g, war, 'att'); field.map = Array.from({ length: 19 }, () => Array(32).fill(PLAIN));
      const me = field.units.find((u) => u.id === casterId), foe = field.units.find((u) => u.id === 38);
      Object.assign(me, { x: 10, y: 10 }); Object.assign(foe, { x: 12, y: 10 });
      g.officers[38].soldiers = 500; g.officers[38].hp = 90; field.turn = 'att'; field.pool.att = 99; field.r = () => 0;
      assert.equal(field.cast(me, skillId, foe).hit, true); assert.equal(field.pool.att, 99 - skill.cost);
      assert.equal(g.officers[38].soldiers, 500 - skill.soldiers); assert.equal(g.officers[38].hp, 90 - skill.hp);
      assert.equal(field.chest('def').rice, 500 - skill.rice);
      assert.equal(field.cast(me, skillId, foe).hit, true); assert.equal(field.canCast(me, skillId, foe), false);
      const restored = Field.restore(g, war, field.snapshot());
      assert.equal(restored.units.find((u) => u.id === casterId).skillUses[skillId], 2);
    }
    for (const [id, name] of [[246, '白马突击'], [59, '三尖奋击'], [192, '镇江拒敌']]) {
      const g = G.newGame(7, 1, 3), battle = new Tactical(g, id, 38, 2, () => 0, { human: 'a' });
      const duel = new Duel(battle.side, () => 0, g, 'a');
      assert.equal(duel.special('a').name, name); assert.equal(duel.aiCommand('a'), 'special');
      duel.act('a', 'special'); assert.equal(duel.canSpecial('a'), false);
    }
  } finally { G.setData(base); }
});

test('新君主在 NPC 战斗中遵守不战死并可在被俘后继位', async () => {
  use();
  try {
    for (const f of [7, 8, 9]) {
      const g = G.newGame(f, 1, 1); g.noWarDeath = true;
      const ruler = g.factions[f].ruler, others = g.officers.filter((o) => o.status === G.SERVING && !G.isRuler(g, o.id)).slice(0, 5).map((o) => o.id);
      for (const id of [ruler, ...others]) Object.assign(g.officers[id], { loyalty: 100, war: 80, int: 80, hp: 50, soldiers: 500 });
      Object.assign(g.officers[ruler], { war: 1, int: 1, hp: 17, maxHp: 20, loyalty: 10 });
      const war = { att: { ids: [ruler, ...others.slice(0, 4)], rice: 9999 }, def: { ids: [others[4]], rice: 9999 } };
      const outcome = fight(g, war); assert.ok(outcome.captured.byDef.includes(ruler));
      assert.equal(g.officers[ruler].hp, 20); assert.ok(!outcome.dead.includes(ruler));
      const home = g.cities[g.factions[f].city], captor = g.cities[12];
      home.officers = home.officers.filter((id) => id !== ruler); captor.officers.push(ruler);
      g.officers[ruler].status = G.SERVING;
      const events = [];
      await G.checkFactions(g, { event: async (event) => events.push(event), chooseHeir: async (_f, candidates) => candidates[0] });
      assert.notEqual(g.factions[f].ruler, ruler); assert.equal(g.officers[ruler].status, G.SERVING);
      assert.equal(events.find((e) => e.type === 'heir' && e.faction === f)?.captured, true);
    }
  } finally { G.setData(base); }
});

test('新剧本和旧版普通、快速及中断记录互不覆盖，同编号动态武将不被替换', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), records = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (k) => records.get(k) ?? null, setItem: (k, v) => records.set(k, String(v)), removeItem: (k) => records.delete(k),
  } });
  try {
    const roster = applyScenario(base, await loadScenario(ROSTER_SCENARIO_ID, base));
    G.setData(roster, ROSTER_SCENARIO_ID);
    const old = G.newGame(4, 1, 8); old.year = 200;
    old.officers.push({ ...old.officers[0], id: 246, debut: 200 }); old.clones = [246]; G.registerClones(old);
    assert.equal(G.save(old, 1), true); assert.equal(G.saveQuick(old), true);
    const war = { city: 8, from: 12, attacker: 4, defender: 0,
      att: { ids: [246], gold: 100, rice: 500 }, def: { ids: [38], gold: 100, rice: 500 } };
    old.officers[246].soldiers = old.officers[38].soldiers = 500;
    assert.equal(suspend(old, war, new Field(old, war, 'att'), { side: 'att', start: { 246: 500, 38: 500 }, after: { kind: 'att' } }), true);
    use(); assert.equal(G.NONE, 10); assert.equal(G.upgrade(old), null); assert.equal(peekSuspend(), null);
    const fresh = G.newGame(7, 1, 9); assert.equal(G.name(246), '公孙瓒');
    assert.equal(G.save(fresh, 1), true); assert.equal(G.saveQuick(fresh), true);
    assert.equal(G.load(1).factions.length, 10); assert.equal(G.loadQuick().cities[0].faction, 7);
    G.setData(applyScenario(base, await loadScenario(ROSTER_SCENARIO_ID, base)), ROSTER_SCENARIO_ID);
    assert.equal(G.NONE, 7); assert.deepEqual(G.load(1).clones, [246]); assert.deepEqual(G.loadQuick().clones, [246]);
    assert.equal(G.data().officers[246].clone, true); assert.deepEqual(peekSuspend().g.clones, [246]);
    G.setData(applyScenario(base, await loadScenario(HERO_SCENARIO_ID, base)), HERO_SCENARIO_ID);
    assert.equal(G.NONE, 7); assert.equal(G.newGame(4, 1, 9).factions.length, 7);
  } finally {
    G.setData(base);
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage;
  }
});

test('新势力结构拒绝无效编号、空城、君主和电脑策略', () => {
  assert.equal(validateScenario(scenario, base), true);
  const changes = [
    (s) => { s.factions[0].id = 8; },
    (s) => { s.factions[0].city = 1; },
    (s) => { s.factions[1].city = s.factions[0].city; },
    (s) => { s.factions[0].aiProfile = 9; },
    (s) => { s.factions[0].ruler = s.factions[1].ruler; },
    (s) => { s.officers.find((o) => o.id === 246).city = 5; },
    (s) => { s.officers.find((o) => o.id === 249).city = 5; },
    (s) => { s.factions = null; },
  ];
  for (const change of changes) { const bad = structuredClone(scenario); change(bad); assert.throws(() => validateScenario(bad, base)); }
});
