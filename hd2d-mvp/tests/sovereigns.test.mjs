import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { aiTurn } from '../src/core/ai.js';
import { Field, PLAIN } from '../src/core/field.js';
import { Tactical } from '../src/core/tactical.js';
import { Duel } from '../src/core/skirmish.js';
import { suspend, peekSuspend } from '../src/core/suspend.js';
import { applyScenario, validateScenario } from '../src/core/scenario.js';
import { loadScenario } from '../src/core/scenario-store.js';
import { applyRulerPassive, describeRulerPassive } from '../src/core/ruler-passives.js';
import { WARLORD_SCENARIO_ID, SOVEREIGN_SCENARIO_ID } from '../src/core/visuals.js';

const base = JSON.parse(readFileSync(new URL('../data/game-data.json', import.meta.url)));
const scenario = await loadScenario(SOVEREIGN_SCENARIO_ID, base);
const use = () => G.setData(applyScenario(base, scenario), SOVEREIGN_SCENARIO_ID);
const names = (ids) => ids.map((id) => G.name(id));

test('十位开局君主各有不同被动，属性变化及候选君主使用当前属性', () => {
  use();
  try {
    const g = G.newGame(7, 1, 1), passives = g.factions.map((f) => G.rulerPassive(g, f.id));
    assert.equal(new Set(passives.map((p) => p.name)).size, 10);
    assert.equal(passives[7].name, '白马备战'); assert.deepEqual(passives[7].effects, [{ kind: 'gold', value: 11 }, { kind: 'reserve', value: 9 }]);
    const ruler = g.factions[7].ruler; g.officers[ruler].war = 20;
    assert.deepEqual(G.rulerPassive(g, 7).effects, [{ kind: 'gold', value: 8 }, { kind: 'reserve', value: 6 }]);
    const heir = g.cities[0].officers.find((id) => G.name(id) === '田豫');
    g.factions[7].ruler = heir; g.officers[heir].int = 95; g.officers[heir].war = 30; g.officers[heir].virtue = 60;
    assert.equal(G.rulerPassive(g, 7).name, '田豫·智略兴业');
    assert.match(G.rulerPassive(g, 7).text, /金＋9/);
    g.officers[heir].status = G.DEAD; assert.equal(G.rulerPassive(g, 7), null);
    G.setData(base); const original = G.newGame(4, 1, 1);
    assert.equal(G.rulerPassive(original, 4), null, '原版无被动');
  } finally { G.setData(base); }
});

test('被动仅作用于君主本城，数值封顶且不降低秘技或高忠诚', () => {
  use();
  try {
    const g = G.newGame(7, 1, 1), c = g.cities[0], other = structuredClone(g.cities[13]);
    const passive = G.rulerPassive(g, 7); c.gold = 9996; c.reserve = 9998;
    assert.equal(applyRulerPassive(g, 7, passive), true);
    assert.equal(c.gold, 9999); assert.equal(c.reserve, 9999); assert.deepEqual(g.cities[13], other);
    c.faction = G.NONE; const previous = structuredClone(c);
    assert.equal(applyRulerPassive(g, 7, passive), false); assert.deepEqual(c, previous);
    c.faction = 7; c.land = 9999;
    assert.equal(applyRulerPassive(g, 7, describeRulerPassive({ name: '曹操', int: 99 })), true);
    assert.equal(c.land, 9999);
    for (const id of c.officers) g.officers[id].loyalty = 100;
    assert.equal(applyRulerPassive(g, 7, describeRulerPassive({ name: '刘备', virtue: 99 })), true);
    assert.ok(c.officers.every((id) => g.officers[id].loyalty === 100));
    for (const id of c.officers) g.officers[id].soldiers = 1000;
    const target = c.officers.at(-1); g.officers[target].soldiers = 998;
    applyRulerPassive(g, 7, describeRulerPassive({ name: '孙策', war: 99 }));
    assert.equal(g.officers[target].soldiers, 1000);
  } finally { G.setData(base); }
});

test('编辑器配置的候选君主开局后使用自身的被动', () => {
  try {
    const draft = structuredClone(scenario), tianyu = draft.officers.find((o) => o.name === '田豫').id;
    draft.rulers.push({ faction: 7, officer: tianyu });
    G.setData(applyScenario(base, draft), SOVEREIGN_SCENARIO_ID);
    const g = G.newGame(7, 1, 1, { ruler: tianyu });
    assert.equal(g.factions[7].ruler, tianyu); assert.equal(g.cities[0].officers[0], tianyu);
    assert.equal(G.rulerPassive(g, 7).name, '田豫·仁德抚众');
    const before = g.cities[0].rice;
    assert.equal(applyRulerPassive(g, 7, G.rulerPassive(g, 7)), true);
    assert.equal(g.cities[0].rice, before + 14);
  } finally { G.setData(base); }
});

test('每回合只触发一次，保存并恢复已开始的回合不会重复领取', async () => {
  use();
  try {
    let g = G.newGame(7, 1, 12); g.ageless = true;
    const initial = { gold: g.cities[0].gold, reserve: g.cities[0].reserve };
    const io = { event: async () => {}, aiTurn: async () => {}, playerTurn: async () => { g.over = { type: 'test' }; } };
    await G.run(g, io);
    assert.equal(g.cities[0].gold, initial.gold + 11); assert.equal(g.cities[0].reserve, initial.reserve + 9);
    const saved = JSON.parse(JSON.stringify(g)); saved.over = null;
    g = G.upgrade(saved); assert.ok(g);
    let visits = 0;
    io.playerTurn = async () => {
      visits++;
      assert.equal(g.cities[0].gold, initial.gold + (visits === 1 ? 11 : 22));
      assert.equal(g.cities[0].reserve, initial.reserve + (visits === 1 ? 9 : 18));
      if (visits === 1) g.endTurn = true; else g.over = { type: 'test' };
    };
    await G.run(g, io); assert.equal(visits, 2);
  } finally { G.setData(base); }
});

test('恢复初始化尚未完成的玩家回合时补发一次被动', async () => {
  use();
  try {
    const g = G.newGame(7, 1, 1), before = g.cities[0].gold;
    g.current = 7; g.books = 3; g.turnIdx = G.data().rules.turn_orders[g.order].indexOf(7);
    const io = { playerTurn: async () => { assert.equal(g.cities[0].gold, before + 11); g.over = { type: 'test' }; } };
    await G.run(g, io); assert.equal(g.rulerPassiveTurn, `189:0:7`);
    g.over = null; await G.run(g, io); assert.equal(g.cities[0].gold, before + 11);
  } finally { G.setData(base); }
});

test('电脑君主与玩家经过相同的被动触发，再执行真实电脑回合', async () => {
  use();
  try {
    const g = G.newGame(4, 1, 1); g.ageless = true; for (const f of g.factions) f.ai = true;
    const start = { gold: g.cities[0].gold, reserve: g.cities[0].reserve }; let checked = false;
    const io = { event: async () => {}, war: async () => {}, allianceOffer: async () => false,
      aiTurn: async (f) => {
        if (f !== 7) return;
        assert.equal(g.cities[0].gold, start.gold + 11); assert.equal(g.cities[0].reserve, start.reserve + 9);
        await aiTurn(g, f, io); checked = true; g.over = { type: 'test' };
      }, playerTurn: async () => assert.fail('全部势力应由电脑操作') };
    await G.run(g, io); assert.equal(checked, true);
  } finally { G.setData(base); }
});

test('旧版与新剧本按默认军备进行多种子电脑对战，城市和武将状态一致', async () => {
  try {
    let wars = 0;
    for (const version of [WARLORD_SCENARIO_ID, SOVEREIGN_SCENARIO_ID]) {
      G.setData(applyScenario(base, await loadScenario(version, base)), version);
      for (const seed of [1, 2, 3, 4, 5]) {
        const g = G.newGame(2, 1, seed); for (const fac of g.factions) fac.ai = true;
        let turns = 0;
        const io = { event: async (event) => { if (event.type === 'autobattle') wars++; },
          aiTurn: async (f) => {
            await aiTurn(g, f, io); turns++;
            const seen = new Set();
            for (const city of g.cities) {
              assert.ok(city.officers.length <= 10);
              if (!city.officers.length) assert.equal(city.faction, G.NONE);
              for (const id of city.officers) {
                assert.ok(!seen.has(id)); seen.add(id); assert.equal(g.officers[id].status, G.SERVING);
                assert.ok(g.officers[id].soldiers >= 0 && g.officers[id].soldiers <= 1000);
              }
            }
            if (g.year >= 192) g.over = { type: 'test' };
          }, afterWar: async () => G.checkFactions(g, io), war: async () => assert.fail('全部势力由电脑操作'),
          allianceOffer: async () => false, chooseHeir: async (f) => G.autoHeir(g, f), playerTurn: async () => assert.fail('全部势力由电脑操作') };
        await G.run(g, io); assert.ok(turns > 100, `${version} / ${seed} 提前结束`);
      }
    }
    assert.ok(wars > 0, '模拟必须覆盖真实电脑战斗');
  } finally { G.setData(base); }
});

test('旧十势力保留原版电脑补兵的低字节及扣费行为', async () => {
  try {
    for (const version of [WARLORD_SCENARIO_ID]) {
      const d = applyScenario(base, await loadScenario(version, base));
      // 固定进入调动和补兵分支；屏蔽其他消费以观察真实的补兵逻辑。
      for (const row of d.rules.ai_dispatch) row.weights = [0, 16, 0];
      d.rules.ai_domestic.faction_development_threshold_out_of_80.fill(0);
      d.cities[0].facilities = { weapons: false, school: false, market: false, hospital: false };
      d.cities[0].ai_shop = []; d.search_table['0'] = []; G.setData(d, version);
      for (const [gold, soldiers, remaining] of [[2, 1000, 2], [256, 0, 256], [257, 0, 257], [258, 1000, 38]]) {
        const g = G.newGame(4, 1, 1), city = g.cities[0], ruler = g.factions[7].ruler;
        city.gold = gold; city.reserve = 0;
        for (const id of city.officers) Object.assign(g.officers[id], { soldiers: 1000, loyalty: 100, int: 49 });
        g.officers[ruler].soldiers = 0;
        await aiTurn(g, 7, { event: async () => {}, war: async () => {}, allianceOffer: async () => false });
        assert.equal(g.officers[ruler].soldiers, soldiers, `${version}: 金 ${gold}`);
        assert.equal(city.gold, remaining, `${version}: 金 ${gold}`);
      }
    }
  } finally { G.setData(base); }
});

test('修正电脑补兵按实际资金和后备兵结算，允许有资源时部分补兵', async () => {
  try {
    const d = applyScenario(base, scenario);
    for (const row of d.rules.ai_dispatch) row.weights = [0, 16, 0];
    d.rules.ai_domestic.faction_development_threshold_out_of_80.fill(0);
    d.cities[0].facilities = { weapons: false, school: false, market: false, hospital: false };
    d.cities[0].ai_shop = []; d.search_table['0'] = []; G.setData(d, SOVEREIGN_SCENARIO_ID);
    for (const [gold, reserve, soldiers, leftGold, leftReserve, initial = 0] of [
      [2, 0, 0, 2, 0], [19, 0, 0, 19, 0], [20, 0, 100, 0, 0],
      [256, 0, 1000, 56, 0], [257, 0, 1000, 57, 0], [258, 0, 1000, 58, 0],
      [0, 350, 350, 0, 0], [20, 350, 450, 0, 0], [0, 1000, 1000, 0, 0],
      [20, 950, 1000, 0, 50], [20, 1000, 1000, 20, 0], [200, 0, 1000, 0, 0],
      [20, 0, 1000, 0, 90, 990], [20, 3, 1000, 0, 54, 951], [-20, 350, 350, -20, 0],
    ]) {
      const g = G.newGame(4, 1, 1), city = g.cities[0], ruler = g.factions[7].ruler;
      city.gold = gold; city.reserve = reserve;
      for (const id of city.officers) Object.assign(g.officers[id], { soldiers: 1000, loyalty: 100, int: 49 });
      g.officers[ruler].soldiers = initial;
      await aiTurn(g, 7, { event: async () => {}, war: async () => {}, allianceOffer: async () => false });
      assert.deepEqual([g.officers[ruler].soldiers, city.gold, city.reserve], [soldiers, leftGold, leftReserve], `金 ${gold}、后备 ${reserve}`);
      assert.equal(g.officers[ruler].soldiers - initial + city.reserve - reserve, (gold - city.gold) * 5, '兵员与花费守恒');
    }
  } finally { G.setData(base); }
});

test('出阵整备在后备兵恰好足够时不多征兵，旧规则仍维持原样', async () => {
  try {
    for (const [fixed, expected] of [[true, [1000, 0, 1000]], [false, [980, 100, 1000]]]) {
      const d = applyScenario(base, scenario); d.fixedAiRecruitment = fixed;
      for (const row of d.rules.ai_dispatch) row.weights = [16, 0, 0];
      d.rules.ai_domestic.faction_development_threshold_out_of_80.fill(0);
      d.cities[0].facilities = { weapons: false, school: false, market: false, hospital: false };
      d.cities[0].ai_shop = []; d.search_table['0'] = []; G.setData(d, SOVEREIGN_SCENARIO_ID);
      const g = G.newGame(1, 2, 1), city = g.cities[0], target = g.cities[1]; g.year = 190;
      Object.assign(city, { gold: 1000, rice: 1000, reserve: 500 });
      for (const id of city.officers) Object.assign(g.officers[id], { soldiers: 1000, loyalty: 80, int: 49 });
      g.officers[g.factions[7].ruler].loyalty = 100;
      const officer = city.officers[1]; g.officers[officer].soldiers = 500;
      for (const id of target.officers.slice(1)) Object.assign(g.officers[id], { status: G.RONIN, loc: target.id });
      target.officers = target.officers.slice(0, 1);
      let result;
      await aiTurn(g, 7, { event: async () => {}, war: async (war) => { result = [city.gold + war.att.gold, city.reserve, g.officers[officer].soldiers]; }, allianceOffer: async () => false });
      assert.deepEqual(result, expected, `fixedAiRecruitment=${fixed}`);
    }
  } finally { G.setData(base); }
});

test('新开局资源只初始化新游戏，旧存档和动态武将保持原有数据', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), records = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (k) => records.get(k) ?? null, setItem: (k, v) => records.set(k, String(v)), removeItem: (k) => records.delete(k),
  } });
  try {
    const oldScenario = structuredClone(scenario); delete oldScenario.fixedAiRecruitment;
    for (const f of oldScenario.factions) delete f.opening;
    G.setData(applyScenario(base, oldScenario), SOVEREIGN_SCENARIO_ID);
    const g = G.newGame(7, 1, 4); Object.assign(g.cities[0], { gold: 67, rice: 89, reserve: 321 });
    const id = g.officers.length; g.officers.push({ ...g.officers[0], id, debut: 200 }); g.clones = [id]; G.registerClones(g);
    assert.equal(G.save(g, 1), true); assert.equal(G.saveQuick(g), true);
    const war = { city: 12, from: 0, attacker: 7, defender: 0, att: { ids: [id], gold: 100, rice: 500 }, def: { ids: [38], gold: 100, rice: 500 } };
    assert.equal(suspend(g, war, new Field(g, war, 'att'), { side: 'att', start: { [id]: 500, 38: 500 }, after: { kind: 'att' } }), true);
    use();
    for (const saved of [G.load(1), G.loadQuick(), peekSuspend().g]) {
      assert.deepEqual([saved.cities[0].gold, saved.cities[0].rice, saved.cities[0].reserve], [67, 89, 321]);
      assert.deepEqual(saved.clones, [id]);
    }
    assert.equal(G.data().officers[id].clone, true);
    const fresh = G.newGame(7, 1, 4);
    assert.deepEqual([fresh.cities[0].gold, fresh.cities[0].rice, fresh.cities[0].reserve], [900, 900, 100]);
  } finally {
    G.setData(base);
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage;
  }
});

test('继位后切换到新君主被动，被俘或下野君主不能继续为原城触发', async () => {
  use();
  try {
    const g = G.newGame(4, 1, 1), f = 7, old = g.factions[f].ruler;
    const oldPassive = G.rulerPassive(g, f); G.kill(g, old);
    await G.checkFactions(g, { event: async () => {}, chooseHeir: async (house) => G.autoHeir(g, house) });
    assert.notEqual(g.factions[f].ruler, old); assert.notEqual(G.rulerPassive(g, f).name, oldPassive.name);
    const c = g.cities[g.factions[f].city], ruler = g.factions[f].ruler;
    assert.equal(c.officers[0], ruler); G.toRonin(g, ruler);
    const before = structuredClone(c); assert.equal(applyRulerPassive(g, f, oldPassive), false); assert.deepEqual(c, before);
  } finally { G.setData(base); }
});

test('八名新增人物具备正确开局、自动出仕、寻访与关系', () => {
  use();
  try {
    const g = G.newGame(7, 1, 3), d = G.data(), id = (n) => d.officers.find((o) => o.name === n).id;
    for (const [f, n] of [[7, '田豫'], [8, '乔蕤'], [9, '黄祖']]) assert.ok(names(g.cities[g.factions[f].city].officers).includes(n));
    const liuqi = id('刘琦'); assert.equal(g.officers[liuqi].status, G.UNAPPEARED); g.year = 190; assert.equal(G.autoJoin(g, 9), null);
    g.year = 191; assert.equal(G.autoJoin(g, 9).id, liuqi); assert.ok(g.cities[21].officers.includes(liuqi));
    assert.ok(d.relationships.some((r) => r.from === g.factions[9].ruler && r.to === liuqi && r.kind === '父子'));
    for (const [n, city, year] of [['荀攸', 8, 192], ['牵招', 4, 191], ['黄夫人', 21, 207], ['祝融夫人', 28, 225]]) {
      const officer = id(n); g.year = year - 1; const early = G.queueHead(g, G.searchOrder(g, city));
      if (early?.id === officer) assert.equal(early.ready, false);
      g.year = year; assert.equal(G.searchOrder(g, city)[0], officer); assert.equal(G.debutInfo(officer).city, city);
    }
    assert.equal(d.officers[id('荀攸')].birthYear, 157); assert.equal(d.officers[id('田豫')].birthCity, null);
    assert.ok(d.relationships.some((r) => r.from === 109 && r.to === id('黄夫人') && r.kind === '夫妻'));
    assert.ok(d.relationships.some((r) => r.from === 200 && r.to === id('祝融夫人') && r.kind === '夫妻'));
  } finally { G.setData(base); }
});

test('新增专属计略和单挑技在实际战斗中受次数与消耗限制', () => {
  use();
  try {
    for (const [n, skillName, faction] of [['田豫', '北疆守御', 7], ['黄祖', '江汉守备', 9], ['荀攸', '公达奇策', 7], ['牵招', '牵招镇边', 7], ['黄夫人', '黄氏巧思', 9]]) {
      const g = G.newGame(faction, 1, 5), caster = G.data().officers.find((o) => o.name === n), skill = G.data().customSkills.find((s) => s.name === skillName);
      const war = { city: 12, from: g.factions[faction].city, attacker: faction, defender: 0,
        att: { ids: [caster.id], gold: 100, rice: 500 }, def: { ids: [38], gold: 100, rice: 500 } };
      const field = new Field(g, war, 'att'); field.map = Array.from({ length: 19 }, () => Array(32).fill(PLAIN));
      const me = field.units.find((u) => u.id === caster.id), foe = field.units.find((u) => u.id === 38);
      Object.assign(me, { x: 10, y: 10 }); Object.assign(foe, { x: 12, y: 10 });
      g.officers[38].soldiers = 500; field.turn = 'att'; field.pool.att = 99; field.r = () => 0;
      assert.equal(field.cast(me, skill.id, foe).hit, true); assert.equal(field.pool.att, 99 - skill.cost);
      assert.equal(g.officers[38].soldiers, 500 - skill.soldiers);
      assert.equal(field.cast(me, skill.id, foe).hit, true); assert.equal(field.canCast(me, skill.id, foe), false);
      assert.equal(Field.restore(g, war, field.snapshot()).units.find((u) => u.id === caster.id).skillUses[skill.id], 2);
      delete me.skillUses; delete foe.stop; field.human = 'def'; field.pool.att = 99; g.officers[38].soldiers = 500;
      assert.equal(field.aiDecide(me).id, skill.id); assert.equal(field.aiDecide(me).id, skill.id);
      assert.equal(me.skillUses[skill.id], 2); assert.notEqual(field.aiDecide(me)?.id, skill.id);
    }
    for (const [n, skillName] of [['乔蕤', '淮军奋击'], ['祝融夫人', '祝融飞刀']]) {
      const g = G.newGame(8, 1, 3), id = G.data().officers.find((o) => o.name === n).id;
      const battle = new Tactical(g, id, 38, 2, () => 0, { human: 'a' }), duel = new Duel(battle.side, () => 0, g, 'a');
      assert.equal(duel.special('a').name, skillName); assert.equal(duel.aiCommand('a'), 'special');
      duel.act('a', 'special'); assert.equal(duel.canSpecial('a'), false);
    }
  } finally { G.setData(base); }
});

test('旧十方诸侯动态武将编号与新阵容普通、快捷和战场中断记录隔离', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), records = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (k) => records.get(k) ?? null, setItem: (k, v) => records.set(k, String(v)), removeItem: (k) => records.delete(k),
  } });
  try {
    G.setData(applyScenario(base, await loadScenario(WARLORD_SCENARIO_ID, base)), WARLORD_SCENARIO_ID);
    const old = G.newGame(7, 1, 8); old.year = 200;
    old.officers.push({ ...old.officers[0], id: 254, debut: 200 }); old.clones = [254]; G.registerClones(old);
    assert.equal(G.save(old, 1), true); assert.equal(G.saveQuick(old), true);
    const war = { city: 12, from: 0, attacker: 7, defender: 0, att: { ids: [254], gold: 100, rice: 500 }, def: { ids: [38], gold: 100, rice: 500 } };
    old.officers[254].soldiers = old.officers[38].soldiers = 500;
    assert.equal(suspend(old, war, new Field(old, war, 'att'), { side: 'att', start: { 254: 500, 38: 500 }, after: { kind: 'att' } }), true);
    use(); assert.equal(G.upgrade(old), null); assert.equal(peekSuspend(), null); assert.equal(G.name(254), '田豫');
    const fresh = G.newGame(7, 1, 9); assert.equal(G.save(fresh, 1), true); assert.equal(G.saveQuick(fresh), true);
    G.setData(applyScenario(base, await loadScenario(WARLORD_SCENARIO_ID, base)), WARLORD_SCENARIO_ID);
    assert.deepEqual(G.load(1).clones, [254]); assert.deepEqual(G.loadQuick().clones, [254]);
    assert.deepEqual(peekSuspend().g.clones, [254]); assert.equal(G.data().officers[254].clone, true); assert.equal(G.rulerPassive(G.newGame(7, 1, 1), 7), null);
  } finally {
    G.setData(base);
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage;
  }
});

test('君主被动字段仅接受布尔值，旧版本省略字段仍兼容', async () => {
  assert.equal(validateScenario(scenario, base), true);
  const old = structuredClone(await loadScenario(WARLORD_SCENARIO_ID, base)); assert.equal(validateScenario(old, base), true);
  for (const value of [null, 0, 1, 'true', [], {}]) {
    const bad = structuredClone(scenario); bad.rulerPassives = value; assert.throws(() => validateScenario(bad, base));
  }
});
