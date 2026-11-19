import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { applyScenario, newDraft, validateScenario } from '../src/core/scenario.js';
import { loadScenario } from '../src/core/scenario-store.js';
import { EXPANDED_MAP_ID, expandMap } from '../src/core/expanded-map.js';
import { SOVEREIGN_SCENARIO_ID } from '../src/core/visuals.js';
import { Field } from '../src/core/field.js';
import { Tactical } from '../src/core/tactical.js';
import { Duel } from '../src/core/skirmish.js';
import { battleWeather, officerPassive } from '../src/core/battle-rules.js';
import { skirmishMap } from '../src/core/skirmish-maps.js';
import { counterBonus, SPECIAL_TROOPS } from '../src/core/troop-specialties.js';
import { defenseCandidates, joinDefense, resolveWar, setupWar, validDefenseSupport } from '../src/core/warcore.js';
import { peekSuspend, suspend } from '../src/core/suspend.js';

const base = JSON.parse(readFileSync(new URL('../data/game-data.json', import.meta.url)));
const expanded = expandMap(applyScenario(base, await loadScenario(SOVEREIGN_SCENARIO_ID, base)));
const byName = (name) => expanded.officers.find(o => o?.name === name).id;
const chest = (ids) => ({ ids, gold: 100, rice: 900 });
const strategic = (player = 4, seed = 7) => { G.setData(expanded, EXPANDED_MAP_ID); return G.newGame(player, 1, seed); };
const war = (ids, guards, city = 34, from = 8) => ({ city, from, attacker: 4, defender: 0, att: chest(ids), def: chest(guards) });

test('规则版本隔离旧专属技能，显式升级保留进度，为全部有效人物分配一个被动', () => {
  const g = strategic(), lu = byName('吕布'), zhuge = byName('诸葛亮');
  const old = structuredClone(g); old.campaignRevision = 1;
  old.year = 196; old.cities[12].gold = 789;
  const legacy = new Tactical(old, lu, 40, 2, () => 0);
  assert.ok(new Duel(legacy.side, () => 0, old).special('a'));
  assert.equal(officerPassive(expanded, old, zhuge), null);
  assert.equal(G.upgrade(structuredClone(old)).campaignRevision, 1);
  const before = structuredClone(old);
  assert.ok(G.upgradeCampaign(old)); assert.equal(old.campaignRevision, g.campaignRevision);
  assert.deepEqual(old.cities, before.cities); assert.deepEqual(old.officers, before.officers);
  for (const o of expanded.officers.filter(o => o && !o.clone)) assert.ok(officerPassive(expanded, g, o.id), o.name);
  const modern = new Tactical(old, lu, 40, 2, () => 0);
  const duel = new Duel(modern.side, () => 0, old), previous = new Duel(legacy.side, () => 0, before);
  assert.equal(duel.special('a'), null);
  assert.equal(duel.hitChance('a'), Math.min(95, previous.hitChance('a') + 8));
  assert.equal(officerPassive(expanded, old, zhuge).weatherproof, true);
  G.setData(base);
  assert.equal(battleWeather(G.newGame(4, 1, 7), 34), null);
});

test('同势力多段运输及太守委任保留资源与命令书边界', () => {
  const g = strategic();
  for (const id of [8, 34, 12, 13]) g.cities[id].faction = g.player;
  assert.deepEqual(G.transportRoutes(g, 8).get(12), [8, 34, 12]);
  const before = g.cities[8].gold;
  assert.ok(G.transport(g, 8, 12, 50, 0, 0).ok);
  assert.equal(g.cities[8].gold, before - 50);
  g.cities[34].faction = G.NONE;
  assert.equal(G.transport(g, 8, 12, 50, 0, 0).ok, false);
  assert.equal(g.cities[8].gold, before - 50);
  assert.equal(G.setGovernorOrder(g, 34, 'recruit'), false);
  g.current = g.player; g.books = 3;
  for (const id of [8, 12, 13]) {
    Object.assign(g.cities[id], { gold: 124, reserve: 0, officers: [g.factions[g.player].ruler] });
    assert.ok(G.setGovernorOrder(g, id, 'recruit', 100));
  }
  assert.equal(G.runGovernors(g).length, 2);
  assert.equal(g.books, 1);
  assert.ok(g.cities[8].gold >= 100);
  assert.deepEqual(G.runGovernors(g), []);
  g.month++; g.books = 3;
  assert.deepEqual(G.runGovernors(g).map(v => v.city), [13]);
});

test('战场天气改变机动力和火水计策，观天武将免受天气差异', () => {
  const g = strategic(), yong = byName('姜维'), zhuge = byName('诸葛亮');
  g.month = 4;
  const f = new Field(g, war([yong, zhuge], [40], 32, 12), 'att');
  const [a, sage] = f.side('att'), [d] = f.side('def');
  Object.assign(a, { x: 3, y: 2 }); Object.assign(sage, { x: 3, y: 3 }); Object.assign(d, { x: 4, y: 2 });
  Object.assign(f.O(d.id), { int: 20, level: 1 });
  Object.assign(f.O(a.id), { army: '平', int: 75, level: 3, exp: 0, soldiers: 1000 });
  f.map[2][4] = 0;
  assert.equal(f.weather, 'rain');
  const wetCost = f.cost(a, 4, 2), sageCost = f.cost(sage, 4, 2), wetFire = f.hitChance(a, d, 0), wetWater = f.hitChance(a, d, 4);
  const wetSage = f.hitChance(sage, d, 0);
  f.weather = 'clear';
  assert.equal(f.cost(a, 4, 2), wetCost - 1);
  assert.equal(f.cost(sage, 4, 2), sageCost);
  assert.equal(f.hitChance(a, d, 0), wetFire + 10);
  assert.equal(f.hitChance(a, d, 4), wetWater - 8);
  assert.equal(f.hitChance(sage, d, 0), wetSage);
  const damage = (weather, id, terrain) => {
    f.weather = weather; f.pool.att = 100; f.r = () => 0; f.map[2][4] = terrain;
    f.O(d.id).soldiers = 950;
    const result = f.cast(a, id, d);
    assert.equal(result.hit, true);
    return -result.hits[0].soldiers;
  };
  assert.ok(damage('rain', 0, 2) < damage('clear', 0, 2));
  assert.ok(damage('rain', 4, 3) > damage('clear', 4, 3));
  assert.equal(battleWeather({ ...g, month: 11 }, 34), 'snow');
});

test('夹攻需要第二支可接敌的友军，破阵消耗一次白兵减益并随中断恢复', () => {
  const g = strategic(), chief = byName('诸葛亮'), partner = byName('赵云');
  const f = new Field(g, war([chief, partner], [40]), 'att'), [u, help] = f.side('att'), [v] = f.side('def');
  Object.assign(u, { x: 2, y: 2 }); Object.assign(v, { x: 4, y: 2 }); Object.assign(help, { x: 4, y: 4 });
  f.O(help.id).soldiers = 500;
  f.O(v.id).soldiers = 800; f.pool.att = 100; f.r = () => 0;
  assert.equal(f.canCast(u, 16, v), false);
  help.y = 3;
  assert.ok(f.canCast(u, 16, v));
  assert.equal(f.cast(u, 16, v).hits[0].soldiers, -115);
  assert.equal(f.cast(u, 17, v).hits[0].soldiers, -50);
  assert.equal(f.canCast(u, 17, v), false);
  const next = Field.restore(g, f.war, f.snapshot()), foe = next.side('def')[0], attacker = next.side('att')[0];
  next.r = () => 0;
  assert.equal(attacker.skillUses[17], 1);
  assert.equal(foe.disruptedUntil, f.day + 1);
  const without = new Tactical(g, attacker.id, foe.id, next.terr(foe.x, foe.y), () => 0, { factions: { a: 4, d: 0 }, bonuses: { d: next.combatPassive('def') } });
  assert.equal(next.attack(attacker, foe).pending.side.d.F, Math.floor(without.side.d.F * 0.9));
  assert.equal(foe.disruptedUntil, undefined);
});

function alliedBattle() {
  const g = strategic(2);
  const holder = (id, faction, officers) => {
    for (const c of g.cities) c.officers = c.officers.filter(oid => !officers.includes(oid));
    Object.assign(g.cities[id], { faction, officers, gold: 500, rice: 900 });
    for (const oid of officers) Object.assign(g.officers[oid], { hp: 70, soldiers: 500, status: G.SERVING });
  };
  holder(30, 4, [40, 41]); holder(13, 0, [42]); holder(35, 2, [43, 44, 45]);
  g.factions[2].alliance[0] = g.factions[0].alliance[2] = 10;
  return { g, march: { from: 30, to: 13, ids: [40], commander: 40, gold: 100, rice: 150 } };
}

test('玩家援军可独立指挥，同盟目标不会被当作敌人，中断和败北后仍归原势力', () => {
  const { g, march } = alliedBattle();
  const w = setupWar(g, march), plan = defenseCandidates(g, 4, 0, 13)[0];
  assert.deepEqual(plan.ids, [44, 45]);
  assert.ok(joinDefense(g, w, plan));
  assert.deepEqual(g.cities[35].officers, [43]); assert.equal(g.cities[35].rice, 780);
  const f = new Field(g, w, 'def'), [host, ally] = f.side('def'), [enemy] = f.side('att');
  assert.equal(f.controls(host), false); assert.equal(f.controls(ally), true); assert.equal(f.controls(enemy), false);
  assert.equal(f.legal(ally, 0, host), false);
  assert.equal(validDefenseSupport(g, w, 'def'), true);
  assert.equal(validDefenseSupport(g, { ...w, support: { ...w.support, ids: [42] } }, 'def'), false);
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), store = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: k => store.get(k) ?? null, setItem: (k,v) => store.set(k,v) } });
  try {
    assert.ok(suspend(g, w, f, { side: 'def', start: 'def', after: { kind: 'def' } }));
    const item = peekSuspend(), next = Field.restore(item.g, item.war, item.field);
    assert.ok(next.controls(next.side('def')[1]));
    next.end('def', 'castle'); resolveWar(item.g, item.war, next.result());
    assert.equal(G.officerCity(item.g, 44).id, 35);
    assert.equal(G.officerCity(item.g, 45).faction, 2);
    assert.equal(item.g.cities[13].faction, 4);
  } finally { if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else delete globalThis.localStorage; }
  g.factions[2].alliance[4] = g.factions[4].alliance[2] = 10;
  assert.deepEqual(defenseCandidates(g, 4, 0, 13), []);
});

test('白兵编队预览匹配部署，枪骑盾弓有克制，电脑加成与雨雪受控', () => {
  const g = strategic(), ganyu = byName('关羽'), cao = byName('曹操');
  for (const id of [ganyu, cao]) Object.assign(g.officers[id], { soldiers: 1000, level: 5, war: 90, int: 80 });
  const fight = (weather) => new Tactical(g, ganyu, cao, 3, () => 0, { human: 'a', factions: { a: 4, d: 2 }, weather, sceneProfile: { region: '海滨', kind: 'city' } });
  const snow = fight('snow'); snow.deploy();
  for (const side of ['a', 'd']) {
    const troops = snow.units.filter(u => u.side === side);
    const preview = snow.formationKinds(side, snow.side[side].formation);
    const squares = expanded.formations[snow.side[side].formation];
    assert.equal(new Set(troops.map(u => `${u.x},${u.y}`)).size, troops.length);
    for (const u of troops.filter(u => u.kind !== 'gen')) {
      const i = squares.findIndex(([a,y,d]) => y === u.y && (side === 'a' ? a : d) === u.x);
      assert.equal(preview[i], u.kind);
    }
    for (const u of troops.filter(u => u.kind === 'cav')) assert.equal(snow.queue.filter(v => v === u).length, 1);
  }
  const rain = fight('rain'); rain.deploy();
  assert.ok(rain.side.d.F > rain.side.a.F);
  assert.equal(rain.side.d.tp - rain.side.a.tp, 2);
  assert.equal(rain.shotRange(rain.units.find(u => u.kind === 'arc')), 3);
  assert.equal(rain.map[2][7], 0); assert.equal(rain.map[4][7], 3);
  const u = (key) => ({ kind: SPECIAL_TROOPS[key].kind, special: SPECIAL_TROOPS[key].sprite });
  assert.equal(counterBonus(u('spear'), u('horsebow'), false), 10);
  assert.equal(counterBonus(u('lightcav'), u('bow'), false), 12);
  assert.equal(counterBonus(u('bow'), u('shield'), true), -12);

  const hills = expanded.skirmish_maps[4], city = expanded.skirmish_maps[5];
  const hillMap = skirmishMap(hills, 4, { kind: 'pass' }), cityMap = skirmishMap(city, 5, { kind: 'city' });
  for (const formation of expanded.formations.slice(0, 4)) for (const [a, y, d] of formation) {
    assert.equal(hillMap[y][a], hills[y][a]);
    assert.equal(hillMap[y][d], hills[y][d]);
  }
  for (const formation of expanded.formations.slice(4)) for (const [a, y] of formation) {
    assert.equal(cityMap[y][15 - a], city[y][15 - a]);
  }
});

test('编辑器扩展城市的出身、登场、售卖、开局年份和被动进入实际新局', () => {
  const s = { ...newDraft(base), id: `v-${'1'.repeat(32)}`, map: 'expanded', frontierMap: true, newBattleRules: true, startYear: 193 };
  const officer = base.officers.find(o => o.appear === 'search_city');
  s.officers.push({ ...Object.fromEntries(['id', 'name', 'hp', 'war', 'int', 'virtue', 'loyalty', 'level', 'exp', 'soldiers', 'weapon', 'armor', 'army', 'year', 'death', 'appear'].map(k => [k, officer[k]])),
    city: 30, faction: null, birthYear: null, birthCity: 38, portraitId: officer.id, skills: [], passive: 'range' });
  s.weapons.push({ id: base.equipment.length, name: '水乡双剑', cat: '剑', atk: 10, weight: 5, price: 100, icon: 0, shops: [13, 30, 38] });
  const d = expandMap(applyScenario(base, s));
  G.setData(d, s.id);
  const g = G.newGame(4, 1, 7);
  assert.equal(g.year, 193); assert.equal(g.campaignRevision, 2);
  assert.ok(G.upgrade(structuredClone(g)));
  assert.ok(G.searchOrder(g, 30).includes(officer.id)); assert.equal(G.debutInfo(officer.id).city, 30);
  assert.equal(officerPassive(d, g, officer.id).name, '深谋');
  for (const key of ['shop', 'field_shop', 'ai_shop']) {
    assert.ok(d.cities[30][key].includes(s.weapons[0].id));
    assert.ok(d.cities[38][key].includes(s.weapons[0].id));
    assert.equal(d.cities[32][key].includes(s.weapons[0].id), false);
  }
  assert.throws(() => validateScenario({ ...s, frontierMap: false }, base), /地图/);
  const bad = structuredClone(s); bad.officers[0].city = 34;
  assert.throws(() => validateScenario(bad, base), /登场城市/);
});
