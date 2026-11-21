import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { applyScenario } from '../src/core/scenario.js';
import { loadScenario } from '../src/core/scenario-store.js';
import { expandMap, EXPANDED_MAP_ID } from '../src/core/expanded-map.js';
import { SOVEREIGN_SCENARIO_ID } from '../src/core/visuals.js';
import { officerPassive } from '../src/core/battle-rules.js';
import { famousLabel } from '../src/core/famous-skills.js';
import { Field, FOREST, MOUNT } from '../src/core/field.js';
import { Duel } from '../src/core/skirmish.js';
import { Tactical } from '../src/core/tactical.js';
import { legacyRoster } from './legacy-roster.mjs';

const base = JSON.parse(readFileSync(new URL('../data/game-data.json', import.meta.url)));
const D = expandMap(applyScenario(base, await loadScenario(SOVEREIGN_SCENARIO_ID, base)));
const fresh = () => { G.setData(D, EXPANDED_MAP_ID); return G.newGame(4, 1, 31); };
const roll = n => n === 256 ? 13 : 0;

// 确保名将的差异来自实际规则参数，普通模板依赖静态属性而非战斗中的成长值。
test('名将名臣的效果彼此有别，普通文武分布多种模板', () => {
  const g = fresh();
  const signature = ({ name, text, ...effects }) => JSON.stringify(Object.entries(effects).sort(([a], [b]) => a.localeCompare(b)));
  const famous = D.officers.filter(o => famousLabel(D, g, o.id));
  const effects = famous.map(o => signature(officerPassive(D, g, o.id)));
  assert.ok(famous.length >= 40);
  assert.equal(new Set(effects).size, famous.length);
  const normal = D.officers.filter(o => !famousLabel(D, g, o.id) && officerPassive(D, g, o.id).name !== '观天');
  for (const group of [normal.filter(o => o.war > o.int + 10), normal.filter(o => o.int > o.war + 10)]) {
    assert.ok(new Set(group.map(o => officerPassive(D, g, o.id).name)).size >= 8);
  }
  const replaced = structuredClone(D);
  replaced.officers[38].passive = 'bowDrill';
  assert.equal(officerPassive(replaced, g, 38).name, '习射');
  delete replaced.officers[38].passive;
  replaced.officers[38].clone = true;
  assert.notEqual(officerPassive(replaced, g, 38).name, '武圣');
  assert.equal(officerPassive(D, { campaignRevision: 1 }, 38), null);
});

test('修订7旧档保留旧被动，手动升级保留个人和城市数据', () => {
  const g = legacyRoster(fresh(), 7);
  const loaded = G.upgrade(structuredClone(g));
  assert.equal(officerPassive(D, loaded, 38).name, '骁勇');
  assert.ok(G.upgradeCampaign(loaded));
  assert.equal(officerPassive(D, loaded, 38).name, '武圣');
  assert.equal(loaded.campaignRevision, 12);
  assert.deepEqual(legacyRoster(structuredClone(loaded), 7), g);
  G.setData(base);
  assert.equal(officerPassive(base, G.newGame(4, 1, 31), 38), null);
});

function duel(g, a, d) {
  const battle = new Tactical(g, a, d, 2, roll, { human: 'a' });
  return new Duel(battle.side, roll, g, 'a');
}

test('关羽首击判定、张飞舍身和庞德低体力按各自条件生效', () => {
  const g = fresh(), one = duel(g, 38, 111);
  const normal = one.hitChance('a');
  assert.equal(one.threshold('a', 'attack'), normal + 7);
  one.act('a', 'feint'); assert.equal(one.threshold('a', 'attack'), normal + 7);
  one.act('a', 'attack'); assert.equal(one.threshold('a', 'attack'), normal);
  const two = duel(g, 153, 198);
  assert.equal(two.threshold('a', 'desperate'), 38);
  assert.equal(two.threshold('d', 'desperate'), 30);
  two.side.d.hp = 30;
  assert.equal(two.threshold('d', 'desperate'), 35);
  assert.equal(two.threshold('d', 'attack'), two.hitChance('d') + 8);
});

test('吕布和典韦只修正各自指定的伤害，旧规则伤害不变', () => {
  const result = (officer, target, revision, cmd) => {
    const g = fresh(); g.campaignRevision = revision;
    return duel(g, officer, target).act('a', cmd).dmg;
  };
  const baseDamage = result(218, 111, 7, 'attack');
  assert.equal(result(218, 111, 8, 'attack'), baseDamage + Math.max(1, Math.floor(baseDamage * 0.08)));
  const againstDianWei = result(153, 165, 7, 'attack');
  assert.equal(result(153, 165, 8, 'attack'), againstDianWei - Math.floor(againstDianWei * 0.12));
  assert.equal(result(218, 165, 8, 'feint'), result(218, 165, 7, 'feint'));
});

test('白兵伤害仅影响对应兵类、攻击方式和回合，徐晃与司马师各自恢复', () => {
  const damage = (kind, ranged, round, active) => {
    const battle = new Tactical(fresh(), 75, 24, 2, roll, { human: 'a' });
    battle.round = round; battle.side.a.F = 96;
    if (!active) battle.side.a.passive = null;
    const a = { side: 'a', kind, hp: 100, x: 5, y: 3, idx: 1 }, d = { side: 'd', kind: 'inf', hp: 100, x: 6, y: 3, idx: 1 };
    battle.units = [a, d];
    return battle.attack(a, d, ranged).dmg;
  };
  assert.ok(damage('arc', true, 3, true) > damage('arc', true, 3, false));
  assert.equal(damage('arc', false, 1, true), damage('arc', false, 1, false));
  assert.equal(damage('inf', false, 1, true), damage('inf', false, 1, false));
  const g = fresh(), battle = new Tactical(g, 111, 87, 2, roll, { human: 'd' });
  battle.deploy(); battle.side.a.hp = battle.gen('a').hp = 40;
  const points = battle.side.d.tp;
  for (let i = 1; i <= 8; i++) { battle.round = i; battle.endRound(); assert.equal(battle.side.d.tp, points + Number(i >= 4)); }
  assert.equal(battle.side.a.hp, 48);
});

test('郭嘉只提高指定计策，贾诩按计策防御，张郃只降低森林移动消耗', () => {
  const g = fresh(); g.month = 7;
  const f = new Field(g, { city: 13, from: 32, attacker: 4, defender: 9,
    att: { ids: [24, 149], gold: 100, rice: 900 }, def: { ids: [22], gold: 100, rice: 900 } }, 'att');
  const [guo, zhang] = f.side('att'), [jia] = f.side('def');
  Object.assign(guo, { x: 5, y: 5 }); Object.assign(jia, { x: 6, y: 5 });
  for (const u of [guo, jia]) Object.assign(g.officers[u.id], { int: 75, level: 3 });
  const current = [0, 2, 3].map(id => f.hitChance(guo, jia, id));
  const cost = (type) => { f.terr = () => type; return f.cost(zhang, 5, 5); };
  g.officers[zhang.id].army = '平';
  const movement = [cost(FOREST), cost(MOUNT)];
  g.campaignRevision = 1;
  const original = [0, 2, 3].map(id => f.hitChance(guo, jia, id));
  assert.deepEqual(current.map((p, i) => p - original[i]), [0, -2, 8]);
  assert.deepEqual([cost(FOREST) - movement[0], cost(MOUNT) - movement[1]], [1, 0]);
});

test('荀彧的额外开发只加产业，并遵守上限', () => {
  const samples = (field, revision, nearLimit = false) => {
    const g = fresh(); g.campaignRevision = revision;
    g.cities[12].gold = 100;
    g.cities[12][field] = nearLimit ? 998 : 10;
    return G.develop(g, 12, 99, field, 20).gain;
  };
  assert.equal(samples('industry', 8) - samples('industry', 1), 3);
  assert.equal(samples('land', 8), samples('land', 1));
  assert.equal(samples('industry', 8, true), 1);
});
