import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { Tactical, GW, GH } from '../src/core/tactical.js';
import { fight } from '../src/core/warcore.js';
import { applyScenario, validateScenario } from '../src/core/scenario.js';
import { loadScenario } from '../src/core/scenario-store.js';
import { EXPANDED_MAP_ID, expandMap } from '../src/core/expanded-map.js';
import { FAMOUS_TROOPS, SPECIAL_TROOPS, officerMainTroop, officerSpecialty, officerSquadLimit, officerSquads, officerTroopLabel, officerTroopType } from '../src/core/troop-specialties.js';
import { legacyRoster } from './legacy-roster.mjs';

const base = JSON.parse(readFileSync(new URL('../data/game-data.json', import.meta.url)));
const scenario = await loadScenario('builtin-sovereigns', base);
const expanded = applyScenario(base, scenario);
const use = () => G.setData(expanded, 'builtin-sovereigns');
const id = (name) => expanded.officers.find((o) => o.name === name).id;

test('主辅编队覆盖十四类兵种、不同兵力和守城布阵，并保留总兵数与精锐上限', () => {
  const scenarioData = expandMap(structuredClone(expanded)), hero = id('韦康'), foe = id('伊籍');
  G.setData(scenarioData, EXPANDED_MAP_ID);
  try {
    const game = G.newGame(4, 1, 9);
    const defender = game.officers[hero];
    for (const [type, troop] of Object.entries(SPECIAL_TROOPS)) for (const level of [1, 3, 6]) {
      Object.assign(scenarioData.officers[hero], { troopType: type, troopLimit: 3 });
      for (const soldiers of [0, 99, 101, 300, 599, 700, 1000]) for (const terrain of [2, 5]) {
        Object.assign(defender, { soldiers, level, war: 75 });
        const battle = new Tactical(game, foe, hero, terrain, () => 0); battle.deploy();
        const units = battle.units.filter(u => u.side === 'd' && u.kind !== 'gen'), main = officerMainTroop(scenarioData, game, hero);
        const primary = units.filter(u => u.primary), label = `${type} Lv${level} ${soldiers} 地形${terrain}`;
        assert.equal(units.reduce((n, u) => n + u.hp, 0), soldiers, label);
        assert.equal(new Set(battle.units.map(u => `${u.x},${u.y}`)).size, battle.units.length, label);
        assert.ok(primary.every(u => u.kind === troop.kind), label);
        assert.ok(units.filter(u => !u.primary).every(u => u.kind !== main.basic.kind), label);
        if (main.current !== main.basic) assert.ok(primary.filter(u => u.special === main.current.sprite).length <= officerSquadLimit(scenarioData, game, hero), label);
        if (terrain === 5 && troop.kind === 'cav') assert.ok(primary.length <= Math.floor(units.length / 3), label);
        if (units.length === 10 && terrain === 2 && troop.kind !== 'cav') assert.equal(primary.length, troop.kind === 'inf' ? 6 : 7, label);
        if (units.length === 10 && terrain === 5 && troop.kind === 'inf') {
          const ordinary = main.current === SPECIAL_TROOPS.infantry;
          assert.equal(primary.length, ordinary ? 2 : 4, label);
          if (ordinary) assert.equal(units.filter(u => u.kind === 'arc').length, 8, label);
        }
        if (units.length === 6 && terrain === 5 && troop.kind === 'inf') assert.equal(units.filter(u => u.kind === 'arc').length, 5, label);
        if (units.length === 10 && terrain === 5 && troop.kind !== 'arc') assert.ok(units.some(u => u.kind === 'arc'), label);
        if (terrain === 2 && units.length === 10 && troop.kind === 'cav') assert.equal(primary.length, level === 1 ? 3 : 6, label);
      }
    }
  } finally { G.setData(base); }
});

test('主兵种从修订 4 启用，显式升级可保留兵力、等级及已有规则开关', () => {
  const scenarioData = expandMap(structuredClone(expanded)), hero = id('关羽'), regular = id('韦康');
  G.setData(scenarioData, EXPANDED_MAP_ID);
  try {
    const game = G.newGame(4, 1, 7);
    Object.assign(game.officers[hero], { level: 6, soldiers: 1000 });
    const rev4 = legacyRoster(structuredClone(game), 4), legacy = legacyRoster(structuredClone(game), 3);
    assert.deepEqual(G.upgrade(structuredClone(legacy)), legacy);
    assert.equal(officerMainTroop(scenarioData, legacy, hero), null);
    assert.equal(officerMainTroop(scenarioData, rev4, regular), null);
    assert.equal(officerMainTroop(scenarioData, rev4, hero).name, '枪兵');
    assert.deepEqual(officerSquads(scenarioData, rev4, regular, true), officerSquads(scenarioData, legacy, regular, true));
    assert.equal(officerSquads(scenarioData, legacy, hero, true).filter(u => u.special).length, 0);
    const squads = officerSquads(scenarioData, game, hero, true);
    assert.equal(squads.filter(u => u.primary).length, 4);
    assert.equal(squads.filter(u => u.special === SPECIAL_TROOPS.heavyspear.sprite).length, 3);
    assert.ok(G.upgradeCampaign(legacy));
    assert.deepEqual(legacy, game);
    delete legacy.eliteTroops;
    assert.equal(officerMainTroop(scenarioData, legacy, hero), null);
    assert.ok(officerSquads(scenarioData, legacy, hero, true).every(u => !u.primary));
  } finally { G.setData(base); }
});

test('君主列传为全体在籍人物配置兵种，修订 4 和 5 的旧编队显式升级后才改变', () => {
  const scenarioData = expandMap(structuredClone(expanded));
  G.setData(scenarioData, EXPANDED_MAP_ID);
  try {
    const game = G.newGame(4, 1, 8), regular = id('吕范'), spear = id('苏飞');
    const previous = legacyRoster(structuredClone(game), 4);
    assert.equal(officerTroopLabel(scenarioData, game, regular), '步兵');
    assert.equal(officerTroopType(scenarioData, game, regular), 'infantry');
    assert.equal(officerSpecialty(scenarioData, game, regular).name, '普通步兵');
    assert.equal(officerTroopLabel(scenarioData, game, spear), '枪兵');
    assert.equal(officerTroopType(scenarioData, game, spear), 'spear');
    assert.equal(officerTroopType(scenarioData, game, id('关羽')), 'heavyspear');
    assert.ok(game.officers.every(o => officerMainTroop(scenarioData, game, o.id)), '全部内置角色包括未登场人物');
    assert.equal(officerTroopLabel(scenarioData, G.upgrade(previous), regular), '混编');
    for (const state of [game, previous]) Object.assign(state.officers[regular], { soldiers: 1000, hp: 80, exp: 8192 });
    assert.ok(officerSquads(scenarioData, previous, regular, false).every(u => !u.primary));
    const squads = officerSquads(scenarioData, game, regular, false);
    assert.equal(squads.filter(u => u.primary && u.special === SPECIAL_TROOPS.infantry.sprite).length, 6);
    const rev5 = G.upgrade(legacyRoster(structuredClone(game), 5));
    assert.equal(officerSquads(scenarioData, rev5, regular, true).filter(u => u.primary).length, 4);
    assert.ok(G.upgradeCampaign(rev5));
    assert.equal(officerSquads(scenarioData, rev5, regular, true).filter(u => u.primary).length, 2);
    assert.deepEqual(rev5, game);
    assert.equal(officerMainTroop(scenarioData, { ...game, scenarioId: 'v-custom' }, regular), null);
    const war = { attacker: 4, defender: 2, att: { ids: [regular], rice: 9999 }, def: { ids: [spear], rice: 9999 } };
    assert.equal(fight(structuredClone(game), war).autoTroopBonus?.att ?? 0, 0, '普通步兵不计入特色队战力');
    assert.ok(G.upgradeCampaign(previous));
    assert.deepEqual(previous, game);
  } finally { G.setData(base); }
});

test('十四套兵队动作图和元数据完整匹配，动作事件引用有效帧', () => {
  assert.equal(Object.keys(SPECIAL_TROOPS).length, 14);
  assert.equal(new Set(Object.values(SPECIAL_TROOPS).map((troop) => troop.sprite)).size, 14);
  for (const troop of Object.values(SPECIAL_TROOPS)) {
    const root = `../assets/ai/sprites/troops/${troop.sprite}`;
    const png = readFileSync(new URL(`${root}.png`, import.meta.url));
    const meta = JSON.parse(readFileSync(new URL(`${root}.json`, import.meta.url)));
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(png[25], 6, `${troop.name}需要透明通道`);
    assert.equal(meta.frames.length, 16);
    assert.equal(png.readUInt32BE(16), meta.cell[0] * meta.frames.length);
    assert.equal(png.readUInt32BE(20), meta.cell[1]);
    for (const clip of Object.values(meta.clips)) for (const [frame, duration] of clip) {
      assert.ok(meta.frames.includes(frame)); assert.ok(duration > 0);
    }
    assert.ok(meta.clips.attack.some((frame) => frame[2] === 'hit'));
    if (troop.kind === 'arc' || troop === SPECIAL_TROOPS.horsebow) assert.ok(meta.clips.volley.some((frame) => frame[2] === 'loose'));
    const turnPng = readFileSync(new URL(`${root}-turn.png`, import.meta.url));
    const turn = JSON.parse(readFileSync(new URL(`${root}-turn.json`, import.meta.url)));
    assert.deepEqual([...turnPng.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(turnPng[25], 6, `${troop.name}转向动作需要透明通道`);
    assert.equal(turn.frames.length, 16);
    assert.equal(turnPng.readUInt32BE(16), turn.cell[0] * turn.frames.length);
    assert.equal(turnPng.readUInt32BE(20), turn.cell[1]);
    for (const direction of ['front', 'back']) {
      for (const key of ['idle', 'walk', 'charge', 'hurt', 'attack']) {
        assert.ok(turn.clips[`${direction}:${key}`].every(([frame, ms]) => turn.frames.includes(frame) && ms > 0));
      }
      assert.ok(turn.clips[`${direction}:attack`].some((frame) => frame[2] === 'hit'));
      if (troop.kind === 'arc' || troop === SPECIAL_TROOPS.horsebow) assert.ok(turn.clips[`${direction}:volley`].some((frame) => frame[2] === 'loose'));
    }
  }
});

test('名将兵队明确分配，普通人物、原版与旧存档保持默认', () => {
  use();
  try {
    const all = Object.values(FAMOUS_TROOPS).flat();
    assert.equal(new Set(all).size, all.length);
    assert.equal(scenario.specialTroops.length, all.length);
    assert.ok(all.every((name) => expanded.officers.some((o) => o.name === name)));
    const g = G.newGame(7, 1, 1);
    assert.equal(g.eliteTroops, true);
    assert.equal(officerSpecialty(expanded, g, id('公孙瓒')).name, '普通轻骑');
    assert.equal(officerSpecialty(expanded, g, id('高顺')).name, '普通盾兵');
    assert.equal(officerSpecialty(expanded, g, id('黄忠')).name, '弩兵');
    assert.equal(officerSpecialty(expanded, g, id('韦康')), null);
    const saved = G.upgrade(JSON.parse(JSON.stringify(g))); assert.equal(saved.eliteTroops, true);
    delete saved.eliteTroops; assert.ok(G.upgrade(saved)); assert.equal(officerSpecialty(expanded, saved, id('公孙瓒')), null);
    saved.eliteTroops = 'true'; assert.equal(G.upgrade(saved), null);
    G.setData(base); const original = G.newGame(4, 1, 1);
    assert.equal(original.eliteTroops, undefined); assert.equal(officerSpecialty(base, original, 38), null);
  } finally { G.setData(base); }
});

test('特色兵队设置经实际存档和读档保留，旧记录不会自动启用', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key),
  } });
  use();
  try {
    const g = G.newGame(7, 1, 12), hero = id('高顺'); g.officers[hero].level = 6;
    assert.ok(G.save(g, 1)); const restored = G.load(1);
    assert.equal(restored.eliteTroops, true); assert.equal(officerSpecialty(expanded, restored, hero).name, '重甲重盾兵');
    assert.equal(officerSquadLimit(expanded, restored, hero), 3);
    const old = structuredClone(g); delete old.eliteTroops;
    assert.ok(G.save(old, 2)); const legacy = G.load(2);
    assert.equal(legacy.eliteTroops, undefined); assert.equal(officerSpecialty(expanded, legacy, hero), null);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage;
    G.setData(base);
  }
});

test('版本配置允许更换特色兵队并严格拒绝重复或未知配置', () => {
  const custom = structuredClone(scenario), hero = id('高顺');
  custom.specialTroops.find((a) => a.officer === hero).type = 'crossbow';
  assert.equal(applyScenario(base, custom).officers[hero].troopType, 'crossbow');
  for (const invalid of [null, [{ officer: hero, type: 'other' }], [{ officer: hero, type: 'shield' }, { officer: hero, type: 'lightcav' }], [{ officer: 9999, type: 'shield' }]]) {
    const bad = structuredClone(custom); bad.specialTroops = invalid;
    assert.throws(() => validateScenario(bad, base));
  }
  for (const maxSquads of [0, 4, true, '2']) {
    const bad = structuredClone(custom); bad.specialTroops[0].maxSquads = maxSquads;
    assert.throws(() => validateScenario(bad, base));
  }
});

test('武将升级自动解锁兵种，个人上限与兵种上限同时生效', () => {
  use();
  try {
    const g = G.newGame(7, 1, 1), leader = id('曹操'), elite = id('高顺'), other = id('曹仁');
    for (const [level, type] of [[1, '普通轻骑'], [3, '重甲骑兵'], [5, '皇家骑兵']]) {
      g.officers[leader].level = level;
      assert.equal(officerSpecialty(expanded, g, leader).name, type);
      assert.equal(officerSquadLimit(expanded, g, leader), 1, '皇家骑兵的目标上限提前约束低级兵');
    }
    g.officers[elite].level = g.officers[other].level = 6;
    assert.equal(officerSquadLimit(expanded, g, elite), 3);
    assert.equal(officerSquadLimit(expanded, g, other), 2);
    g.officers[elite].level = 2; assert.equal(officerSquadLimit(expanded, g, elite), 1);
    g.officers[elite].level = 3; assert.equal(officerSquadLimit(expanded, g, elite), 2);
    g.officers[elite].level = 2; g.officers[elite].exp = G.data().rules.level_exp[1] - 1;
    assert.equal(officerSpecialty(expanded, g, elite).name, '普通盾兵');
    g.officers[elite].soldiers = 1000;
    const ongoing = new Tactical(g, elite, id('韦康'), 2, () => 0); ongoing.deploy();
    G.addExp(g, elite, 1);
    assert.equal(g.officers[elite].level, 3);
    assert.equal(officerSpecialty(expanded, g, elite).name, '重甲重盾兵');
    assert.ok(ongoing.units.some((unit) => unit.special === SPECIAL_TROOPS.lightshield.sprite), '进行中的兵队不被替换');
    const next = new Tactical(g, elite, id('韦康'), 2, () => 0); next.deploy();
    assert.ok(next.units.some((unit) => unit.special === SPECIAL_TROOPS.shield.sprite), '下一场白兵使用升级兵种');
    const setUp = (who) => {
      Object.assign(g.officers[who], { soldiers: 1000, level: 6, war: 75 });
      const battle = new Tactical(g, who, id('韦康'), 2, () => 0); battle.deploy();
      return battle.units.filter((u) => u.side === 'a' && u.special).length;
    };
    assert.equal(setUp(elite), 3); assert.equal(setUp(other), 2);
  } finally { G.setData(base); }
});

test('所有兵种都能按等级配置并在白兵中部署，皇家骑和骑射最多一队', () => {
  const clone = structuredClone(expanded), hero = id('韦康'), foe = id('伊籍');
  G.setData(clone, 'builtin-sovereigns');
  try {
    for (const [type, troop] of Object.entries(SPECIAL_TROOPS)) {
      clone.officers[hero].troopType = type; clone.officers[hero].troopLimit = 3;
      const g = G.newGame(4, 1, 1); Object.assign(g.officers[hero], { soldiers: 1000, level: 6, war: 75 });
      const battle = new Tactical(g, hero, foe, 2, () => 0); battle.deploy();
      const units = battle.units.filter((u) => u.side === 'a' && u.special);
      assert.ok(units.length > 0, type); assert.ok(units.every((u) => u.special === troop.sprite && u.kind === troop.kind), type);
      assert.ok(units.length <= troop.max, type);
      if (type === 'royalcav' || type === 'horsebow') assert.equal(units.length, 1);
    }
  } finally { G.setData(base); }
});

test('实际部署限制队数，保留兵数、行军命令、回合次数和守城规则', () => {
  use();
  try {
    for (const name of ['高顺', '黄忠', '公孙瓒']) for (const soldiers of [0, 1, 100, 300, 600, 1000]) {
      const g = G.newGame(4, 1, 1), who = id(name), foe = id('韦康');
      Object.assign(g.officers[who], { soldiers, level: 2, war: 85 });
      const battle = new Tactical(g, who, foe, 2, () => 0); battle.deploy();
      const units = battle.units.filter((u) => u.side === 'a' && u.kind !== 'gen');
      assert.equal(units.reduce((n, u) => n + u.hp, 0), soldiers);
      assert.ok(units.filter((u) => u.special).length <= Math.min(2, Math.ceil(units.length / 4)));
      if (soldiers >= 600 && (name !== '公孙瓒' || soldiers === 1000)) assert.ok(units.some((u) => u.special));
      if (name === '公孙瓒' && soldiers > 0 && soldiers <= 300) assert.ok(units.every((u) => u.kind === 'inf' && !u.special));
      if (name === '公孙瓒' && soldiers === 600) assert.ok(units.every((u) => !u.special), '低级且原编成没有骑兵时不强行转换');
      for (const unit of units) assert.equal(battle.queue.filter((u) => u === unit).length, unit.kind === 'cav' ? 2 : 1);
      const old = structuredClone(g); delete old.eliteTroops;
      const legacy = new Tactical(old, who, foe, 2, () => 0); legacy.deploy();
      assert.ok(legacy.units.every((u) => !u.special));
    }
    const g = G.newGame(4, 1, 1), battle = new Tactical(g, id('韦康'), id('高顺'), 5, () => 0);
    g.officers[id('高顺')].soldiers = 1000; battle.deploy();
    assert.ok(battle.units.filter((u) => u.side === 'd').every((u) => u.kind !== 'inf' && !u.special));
  } finally { G.setData(base); }
});

test('低级骑兵平衡适用于实际部署和电脑结算，并保留已有记录规则', () => {
  use();
  try {
    const g = G.newGame(7, 1, 3), hero = id('公孙瓒'), foe = id('高顺');
    Object.assign(g.officers[hero], { level: 1, war: 75, soldiers: 600, hp: 90, exp: 8192 });
    Object.assign(g.officers[foe], { level: 3, war: 75, soldiers: 1000, hp: 90, exp: 8192 });
    const deployed = (game) => {
      const battle = new Tactical(game, hero, foe, 2, G.rng(game)); battle.deploy();
      return battle.units.filter((u) => u.side === 'a' && u.kind !== 'gen');
    };
    assert.equal(g.balancedTroops, true);
    assert.ok(deployed(structuredClone(g)).every((u) => u.kind !== 'cav' && !u.special));
    const legacy = structuredClone(g); delete legacy.balancedTroops;
    assert.ok(deployed(legacy).some((u) => u.kind === 'cav' && u.special));
    assert.equal(G.upgrade(legacy).balancedTroops, undefined);
    const war = { attacker: 7, defender: 4, att: { ids: [hero], rice: 9999 }, def: { ids: [foe], rice: 9999 } };
    assert.deepEqual(fight(structuredClone(g), structuredClone(war)).autoTroopBonus, { att: 0, def: 1 });
    assert.deepEqual(fight(structuredClone(legacy), structuredClone(war)).autoTroopBonus, { att: 1, def: 1 });
    for (const level of [1, 2]) {
      const game = structuredClone(g); game.officers[hero].level = level; game.officers[hero].soldiers = 1000;
      assert.ok(deployed(game).some((u) => u.kind === 'cav' && u.special), '原编成已有骑兵时仍可使用特色队');
    }
    const advanced = structuredClone(g); advanced.officers[hero].level = 3;
    assert.ok(deployed(advanced).some((u) => u.kind === 'cav' && u.special));
  } finally { G.setData(base); }
});

test('低级轻骑边界兵力的攻守胜率不会出现异常跃升', () => {
  const data = structuredClone(expanded), hero = id('韦康'), foe = id('伊籍');
  data.officers[hero].troopType = 'lightcav'; data.officers[hero].troopLimit = 3;
  G.setData(data, 'builtin-sovereigns');
  try {
    for (const level of [1, 2]) for (const soldiers of [500, 501, 600, 1000]) for (const defending of [false, true]) {
      const wins = [];
      for (const enabled of [false, true]) {
        let count = 0;
        for (let seed = 1; seed <= 150; seed++) {
          const g = G.newGame(4, 1, seed); g.eliteTroops = enabled;
          for (const who of [hero, foe]) Object.assign(g.officers[who], { soldiers, hp: 90, war: 75, int: 50, loyalty: 100, level, exp: 0, weapon: 0, armor: 0, army: '平' });
          const battle = new Tactical(g, defending ? foe : hero, defending ? hero : foe, 2, G.rng(g)); battle.runAuto();
          if (battle.over?.side === (defending ? 'd' : 'a')) count++;
        }
        wins.push(count);
      }
      assert.ok(Math.abs(wins[1] - wins[0]) <= 24, `等级${level} 兵力${soldiers} 守方${defending}：${wins}`);
    }
  } finally { G.setData(base); }
});

test('特色伤害通过真实白兵计算生效，不影响攻击武将和零伤害', () => {
  use();
  try {
    const g = G.newGame(4, 1, 1), battle = new Tactical(g, id('高顺'), id('韦康'), 2, () => 0);
    battle.side.a.F = 100; battle.side.d.F = 100;
    const strike = (kind, special, targetKind, targetSpecial, ranged) => {
      const u = { side: 'a', kind, hp: 100, special }, t = { side: 'd', kind: targetKind, hp: 1000, special: targetSpecial };
      if (targetKind === 'gen') battle.side.d.hp = 1000;
      return battle.attack(u, t, ranged).dmg;
    };
    assert.equal(strike('inf', SPECIAL_TROOPS.shield.sprite, 'inf', null, false), 95);
    assert.equal(strike('inf', null, 'inf', SPECIAL_TROOPS.shield.sprite, false), 92);
    assert.equal(strike('arc', SPECIAL_TROOPS.crossbow.sprite, 'inf', null, true), 75);
    assert.equal(strike('arc', SPECIAL_TROOPS.crossbow.sprite, 'inf', null, false), 51);
    assert.equal(strike('cav', SPECIAL_TROOPS.lightcav.sprite, 'inf', null, false), 105);
    assert.equal(strike('arc', null, 'cav', SPECIAL_TROOPS.lightcav.sprite, true), 56);
    assert.equal(strike('inf', SPECIAL_TROOPS.heavyinfantry.sprite, 'inf', null, false), 102);
    assert.equal(strike('inf', SPECIAL_TROOPS.spear.sprite, 'cav', null, false), 81);
    assert.equal(strike('inf', SPECIAL_TROOPS.heavyspear.sprite, 'cav', null, false), 82);
    assert.equal(strike('inf', SPECIAL_TROOPS.hammer.sprite, 'inf', SPECIAL_TROOPS.shield.sprite, false), 99);
    assert.equal(strike('inf', SPECIAL_TROOPS.doublehammer.sprite, 'inf', SPECIAL_TROOPS.shield.sprite, false), 103);
    assert.equal(strike('inf', null, 'inf', SPECIAL_TROOPS.lightshield.sprite, false), 95);
    assert.equal(strike('cav', SPECIAL_TROOPS.heavycav.sprite, 'inf', null, false), 103);
    assert.equal(strike('cav', SPECIAL_TROOPS.royalcav.sprite, 'inf', null, false), 105);
    assert.equal(strike('inf', SPECIAL_TROOPS.shield.sprite, 'gen', null, false), strike('inf', null, 'gen', null, false));
    battle.side.a.F = 0;
    assert.equal(strike('inf', SPECIAL_TROOPS.shield.sprite, 'inf', null, false), 0);
  } finally { G.setData(base); }
});

test('骑射兵射程、阻挡和伤害与两次行动匹配，不继承强弩额外射程', () => {
  use();
  try {
    const g = G.newGame(7, 1, 1), battle = new Tactical(g, id('公孙瓒'), id('韦康'), 2, () => 0);
    battle.map = Array.from({ length: GH }, () => Array(GW).fill(0));
    const rider = { side: 'a', kind: 'cav', special: SPECIAL_TROOPS.horsebow.sprite, idx: 1, x: 5, y: 4, hp: 100 };
    const foe = { side: 'd', kind: 'inf', idx: 1, x: 8, y: 4, hp: 1000 };
    battle.units = [rider, foe]; battle.side.a.F = 100;
    assert.equal(battle.pickTarget(rider, 'advance')?.ranged, true);
    assert.equal(battle.attack(rider, foe, true).dmg, 42);
    foe.x = 9; battle.side.a.fx.xbow = 2;
    assert.equal(battle.pickTarget(rider, 'advance'), null);
    foe.x = 8; const ally = { side: 'a', kind: 'inf', idx: 2, x: 6, y: 4, hp: 100 }; battle.units.push(ally);
    assert.equal(battle.pickTarget(rider, 'advance'), null);
    battle.units = [rider, foe]; foe.x = 6;
    assert.equal(battle.pickTarget(rider, 'advance')?.ranged, false);
    assert.equal(battle.attack(rider, foe, false).dmg, 90);
    battle.buildQueue(); assert.equal(battle.queue.filter((u) => u === rider).length, 2);
  } finally { G.setData(base); }
});

test('电脑自动战斗有低比例兵队战力，空城和旧规则不增加战力', () => {
  use();
  try {
    const g = G.newGame(7, 1, 3), a = id('公孙瓒'), d = id('高顺');
    g.officers[a].soldiers = g.officers[d].soldiers = 1000; g.officers[a].hp = g.officers[d].hp = 90;
    g.officers[a].exp = g.officers[d].exp = 8192;
    const war = { attacker: 7, defender: 4, att: { ids: [a], rice: 9999 }, def: { ids: [d], rice: 9999 } };
    const out = fight(structuredClone(g), structuredClone(war));
    assert.deepEqual(out.autoTroopBonus, { att: 1, def: 1 });
    const old = structuredClone(g); delete old.eliteTroops;
    assert.equal(fight(old, structuredClone(war)).autoTroopBonus, undefined);
    const phantom = structuredClone(war); phantom.phantom = true;
    assert.equal(fight(structuredClone(g), phantom).autoTroopBonus, undefined);
    const small = structuredClone(g); small.officers[a].soldiers = 100; small.officers[d].soldiers = 0;
    assert.equal(fight(small, structuredClone(war)).autoTroopBonus, undefined, '未带出特色队时不计入抽象战力');
    const empty = structuredClone(war); empty.def.ids = [];
    assert.equal(fight(structuredClone(g), empty).autoTroopBonus, undefined);
  } finally { G.setData(base); }
});

test('三类特色兵队在相同战斗条件下不产生压倒性优势', () => {
  use();
  try {
    for (const name of ['高顺', '黄忠', '公孙瓒']) for (const soldiers of [100, 300, 700, 1000]) {
      const results = [];
      for (const enabled of [false, true]) {
        let wins = 0;
        for (let seed = 1; seed <= 200; seed++) {
          const g = G.newGame(4, 1, seed), hero = id(name), foe = id('韦康'); g.eliteTroops = enabled;
          for (const officer of [hero, foe]) Object.assign(g.officers[officer], { soldiers, hp: 90, war: 85, int: 50, loyalty: 100, level: 2, exp: 1000, weapon: 0, armor: 0, army: '平' });
          const battle = new Tactical(g, hero, foe, 2, G.rng(g)); battle.runAuto();
          if (battle.over?.side === 'd') wins++;
        }
        results.push(wins);
      }
      assert.ok(Math.abs(results[1] - results[0]) <= 30, `${name}兵力 ${soldiers} 时同条件下 200 场胜数变化过大：${results}`);
    }
  } finally { G.setData(base); }
});

test('三类特色兵队作为守方时，野战与守城强度仍受控制', () => {
  use();
  try {
    for (const terrain of [2, 5]) for (const name of ['高顺', '黄忠', '公孙瓒']) {
      const results = [];
      for (const enabled of [false, true]) {
        let wins = 0;
        for (let seed = 1; seed <= 200; seed++) {
          const g = G.newGame(4, 1, seed), hero = id(name), foe = id('韦康'); g.eliteTroops = enabled;
          for (const officer of [hero, foe]) Object.assign(g.officers[officer], { soldiers: 700, hp: 90, war: 85, int: 50, loyalty: 100, level: 2, exp: 1000, weapon: 0, armor: 0, army: '平' });
          const battle = new Tactical(g, foe, hero, terrain, G.rng(g)); battle.runAuto();
          if (battle.over?.side === 'a') wins++;
        }
        results.push(wins);
      }
      assert.ok(Math.abs(results[1] - results[0]) <= 30, `${name}地形 ${terrain} 守方胜数变化过大：${results}`);
    }
  } finally { G.setData(base); }
});

test('十四类兵队在不同兵力及攻守位置下均无压倒性优势', () => {
  const clone = structuredClone(expanded), hero = id('韦康'), foe = id('伊籍');
  G.setData(clone, 'builtin-sovereigns');
  try {
    clone.officers[hero].troopLimit = 3;
    for (const type of Object.keys(SPECIAL_TROOPS)) for (const soldiers of [100, 600, 1000]) for (const defending of [false, true]) {
      clone.officers[hero].troopType = type;
      const wins = [];
      for (const enabled of [false, true]) {
        let count = 0;
        for (let seed = 1; seed <= 120; seed++) {
          const g = G.newGame(4, 1, seed); g.eliteTroops = enabled;
          for (const who of [hero, foe]) Object.assign(g.officers[who], { soldiers, hp: 90, war: 75, int: 50, loyalty: 100, level: 6, exp: 0, weapon: 0, armor: 0, army: '平' });
          const battle = new Tactical(g, defending ? foe : hero, defending ? hero : foe, 2, G.rng(g)); battle.runAuto();
          if (battle.over?.side === (defending ? 'a' : 'd')) count++;
        }
        wins.push(count);
      }
      assert.ok(Math.abs(wins[1] - wins[0]) <= 24, `${type} 兵力${soldiers} 守方${defending}：${wins}`);
    }
  } finally { G.setData(base); }
});

test('十四类兵队用于守城时，胜率变化保持有限', () => {
  const clone = structuredClone(expanded), hero = id('韦康'), foe = id('伊籍');
  G.setData(clone, 'builtin-sovereigns');
  try {
    clone.officers[hero].troopLimit = 3;
    for (const type of Object.keys(SPECIAL_TROOPS)) {
      clone.officers[hero].troopType = type;
      const wins = [];
      for (const enabled of [false, true]) {
        let count = 0;
        for (let seed = 1; seed <= 120; seed++) {
          const g = G.newGame(4, 1, seed); g.eliteTroops = enabled;
          for (const who of [hero, foe]) Object.assign(g.officers[who], { soldiers: 1000, hp: 90, war: 75, int: 50, loyalty: 100, level: 6, exp: 0, weapon: 0, armor: 0, army: '平' });
          const battle = new Tactical(g, foe, hero, 5, G.rng(g)); battle.runAuto();
          if (battle.over?.side === 'a') count++;
        }
        wins.push(count);
      }
      assert.ok(Math.abs(wins[1] - wins[0]) <= 24, `${type} 守城胜数：${wins}`);
    }
  } finally { G.setData(base); }
});
