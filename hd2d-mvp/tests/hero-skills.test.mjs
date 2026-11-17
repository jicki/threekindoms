import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { applyScenario, newDraft, validateScenario } from '../src/core/scenario.js';
import { addPresetAbilities, hasLegacyRecords, loadScenario } from '../src/core/scenario-store.js';
import { FEMALE_SCENARIO_ID, HERO_SCENARIO_ID, visualUrl } from '../src/core/visuals.js';
import { Field, PLAIN } from '../src/core/field.js';
import { Tactical } from '../src/core/tactical.js';
import { Duel } from '../src/core/skirmish.js';

const base = JSON.parse(readFileSync(new URL('../data/game-data.json', import.meta.url)));
const expanded = await loadScenario(HERO_SCENARIO_ID, base);
const data = () => applyScenario(base, expanded);

test('旧存档、备份和中断战斗均保留兼容入口，存储不可用时不隐藏入口', () => {
  const oldLocal = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const oldSession = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const values = new Map(), session = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    get length() { return values.size; }, key: (i) => [...values.keys()][i] ?? null,
  } });
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: (key) => session.get(key) ?? null } });
  try {
    assert.equal(hasLegacyRecords(), false);
    values.set('haou-hd2d-save:scenario:builtin-heroes:1', 'new');
    values.set('haou-hd2d-save:scenario:builtin-female-other:1', 'other');
    assert.equal(hasLegacyRecords(), false);
    for (const key of ['haou-hd2d-save:scenario:builtin-female:1', 'haou-hd2d-save:scenario:builtin-female:1:bak',
      'haou-hd2d-save:scenario:builtin-female:quick', 'haou-hd2d-save:scenario:builtin-female:auto',
      'haou-hd2d-suspend:scenario:builtin-female']) {
      values.set(key, 'old'); assert.equal(hasLegacyRecords(), true, key); values.delete(key);
    }
    session.set('haou-hd2d-load:scenario:builtin-female', 'pending'); assert.equal(hasLegacyRecords(), true); session.clear();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('storage denied'); } });
    assert.equal(hasLegacyRecords(), true);
  } finally {
    if (oldLocal) Object.defineProperty(globalThis, 'localStorage', oldLocal); else delete globalThis.localStorage;
    if (oldSession) Object.defineProperty(globalThis, 'sessionStorage', oldSession); else delete globalThis.sessionStorage;
  }
});

test('扩展版本新增四名有出处的角色，原版和巾帼版保持独立', async () => {
  const old = await loadScenario(FEMALE_SCENARIO_ID, base), d = data();
  assert.equal(old.officers.length, 3); assert.equal(old.skills.length, 0);
  assert.deepEqual(d.officers.slice(240).map((o) => [o.name, o.year, o.city, o.birthYear, o.birthCity]), [
    ['蔡琰', 207, 8, null, null], ['王异', 213, 6, null, null], ['陈宫', 192, 11, null, null], ['高顺', 192, 12, null, null],
  ]);
  for (const id of [240, 241, 242, 243]) {
    const o = d.officers[id]; assert.equal(o.appear, 'search_city');
    assert.ok(d.search_table[String(o.city)].includes(id));
    for (const ref of [o.visual.portrait, o.visual.motion, ...Object.values(o.visual.faces)]) assert.ok(visualUrl(ref));
  }
  assert.equal(d.equipment[d.officers[241].weapon].cat, '弓');
  assert.equal(d.equipment[d.officers[243].weapon].cat, '枪');
  assert.equal(base.officers.length, 237);
});

test('扩展角色按年份及所在城市加入搜索，旧版记录隔离', () => {
  G.setData(data(), HERO_SCENARIO_ID);
  try {
    const g = G.newGame(4, 1, 1);
    for (const [id, city, year] of [[240, 8, 207], [241, 6, 213], [242, 11, 192], [243, 12, 192]]) {
      const queue = G.searchQueue(city);
      for (const other of queue) if (other !== id) g.officers[other].status = G.SERVING;
      g.year = year - 1; assert.deepEqual(G.queueHead(g, queue), { id, ready: false });
      g.year = year; assert.deepEqual(G.queueHead(g, queue), { id, ready: true });
    }
    assert.equal(G.scenarioKey('save'), 'save:scenario:builtin-heroes');
    assert.equal(G.upgrade({ ...g, scenarioId: FEMALE_SCENARIO_ID }), null);
  } finally { G.setData(base); }
});

test('旧巾帼存档中的动态武将与扩展角色不会共用同一版本的数据', async () => {
  const old = await loadScenario(FEMALE_SCENARIO_ID, base), legacy = applyScenario(base, old);
  G.setData(legacy, FEMALE_SCENARIO_ID);
  try {
    const g = G.newGame(4, 1, 1), clone = { ...g.officers[0], id: 240, debut: 200 };
    g.officers.push(clone); g.clones = [240]; G.registerClones(g);
    assert.equal(G.data().officers[240].clone, true);
    G.setData(data(), HERO_SCENARIO_ID);
    assert.equal(G.data().officers[240].name, '蔡琰');
    assert.equal(G.upgrade(g), null);
    G.setData(legacy, FEMALE_SCENARIO_ID); assert.equal(G.upgrade(g).officers[240].id, 240);
    assert.equal(G.data().officers[240].clone, true);
  } finally { G.setData(base); }
});

test('专属单挑技只供配置者使用，每场一次且不改变普通攻击的随机结算', () => {
  G.setData(data(), HERO_SCENARIO_ID);
  try {
    const g = G.newGame(4, 1, 1), make = () => {
      const t = new Tactical(g, 38, 22, 2, () => 0, { human: 'a' });
      t.side.a.F = 60; t.side.a.eq.atk = 12; t.side.d.eq.def = 2; t.side.d.hp = 99;
      return new Duel(t.side, (n) => n === 256 ? 13 : 0, g, 'a');
    };
    const ordinary = make(), special = make();
    assert.equal(special.special('a').name, '青龙斩');
    assert.equal(special.canSpecial('a'), true); assert.equal(special.canSpecial('d'), false);
    assert.equal(special.threshold('a', 'special'), special.hitChance('a') - 5);
    const normalHit = ordinary.act('a', 'attack'), move = special.act('a', 'special');
    assert.equal(move.hit, true); assert.equal(move.dmg, Math.floor(normalHit.dmg * 1.2));
    assert.equal(move.name, '青龙斩'); assert.equal(special.canSpecial('a'), false);
    const n = special.n; assert.throws(() => special.act('a', 'special'), /not allowed/); assert.equal(special.n, n);
    assert.throws(() => special.act('d', 'special'), /not allowed/);
    const ai = make(); assert.equal(ai.aiCommand('a'), 'special'); ai.act('a', 'special'); assert.notEqual(ai.aiCommand('a'), 'special');
    const cursed = make(); cursed.curse.a = 1;
    assert.equal(cursed.threshold('a', 'special'), Math.max(0, cursed.hitChance('a') - 25));
  } finally { G.setData(base); }
});

test('专属技造成致命伤时仍遵守不战死规则', () => {
  G.setData(data(), HERO_SCENARIO_ID);
  try {
    const g = G.newGame(4, 1, 1); g.noWarDeath = true;
    const t = new Tactical(g, 38, 22, 2, (n) => n === 256 ? 13 : 0, { human: 'a' });
    t.units = [{ side: 'a', kind: 'gen', id: 38, hp: 97 }, { side: 'd', kind: 'gen', id: 22, hp: 1 }];
    t.side.a.F = 60; t.side.a.eq.atk = 12; t.side.d.eq.def = 0; t.side.d.hp = 1;
    t.startDuel('a'); const move = t.duel.act('a', 'special'); assert.ok(move.dmg > 0);
    assert.equal(t.resolveDuel().res.captured, 22);
  } finally { G.setData(base); }
});

test('高攻击力与骂倒叠加时专属单挑技不会发生伤害溢出', () => {
  G.setData(data(), HERO_SCENARIO_ID);
  try {
    const g = G.newGame(4, 1, 1);
    const t = new Tactical(g, 153, 22, 2, () => 0, { human: 'a' });
    t.side.a.F = 78; t.side.a.eq.atk = 99; t.side.d.eq.def = 0; t.side.d.hp = 99;
    const duel = new Duel(t.side, (n) => n === 256 ? 13 : 0, g, 'a');
    duel.curse.a = 1;
    const move = duel.act('a', 'special');
    assert.equal(move.hit, true); assert.equal(move.dmg, 127); assert.equal(t.side.d.hp, 0);
  } finally { G.setData(base); }
});

function fieldFor(g) {
  const war = { city: 8, from: 12, attacker: 4, defender: 2,
    att: { ids: [242], gold: 100, rice: 500 }, def: { ids: [38], gold: 100, rice: 500 } };
  const f = new Field(g, war, 'att'); f.map = Array.from({ length: 19 }, () => Array(32).fill(PLAIN));
  const me = f.units.find((u) => u.id === 242), foe = f.units.find((u) => u.id === 38);
  Object.assign(me, { x: 10, y: 10 }); Object.assign(foe, { x: 12, y: 10 });
  g.officers[242].soldiers = 500; g.officers[38].soldiers = 500; g.officers[38].hp = 90;
  f.turn = 'att'; f.pool.att = 99; f.r = () => 0;
  return { f, me, foe, war };
}

test('专属计略限制每场次数，命中和失败均计数，中断恢复后仍保持', () => {
  G.setData(data(), HERO_SCENARIO_ID);
  try {
    const g = G.newGame(4, 1, 1), { f, me, foe, war } = fieldFor(g), id = 18;
    assert.ok(f.strategies(me).some((s) => s.name === '公台奇谋'));
    assert.equal(f.canCast(foe, id, me), false, '未分配者不能施展');
    f.pool.att = 0; assert.equal(f.cast(me, id, foe).ok, false); assert.equal(me.skillUses, undefined);
    f.pool.att = 99; f.r = () => 255; assert.equal(f.cast(me, id, foe).hit, false);
    assert.equal(me.skillUses[id], 1); f.r = () => 0;
    assert.equal(f.cast(me, id, foe).hit, true); assert.equal(g.officers[38].soldiers, 420);
    assert.equal(me.skillUses[id], 2); assert.equal(f.canCast(me, id, foe), false);
    assert.match(f.whyNot(me, id), /次数已用完/);
    const before = f.pool.att; assert.equal(f.cast(me, id, foe).ok, false); assert.equal(f.pool.att, before);
    const restored = Field.restore(g, war, f.snapshot()), restoredMe = restored.units.find((u) => u.id === 242);
    assert.equal(restoredMe.skillUses[id], 2); assert.equal(restored.canCast(restoredMe, id, restored.units.find((u) => u.id === 38)), false);
  } finally { G.setData(base); }
});

test('电脑可使用专属计略，也遵守次数限制', () => {
  G.setData(data(), HERO_SCENARIO_ID);
  try {
    const g = G.newGame(4, 1, 1), { f, me } = fieldFor(g); f.human = 'def';
    assert.equal(f.aiDecide(me).id, 18); assert.equal(f.aiDecide(me).id, 18);
    assert.equal(me.skillUses[18], 2); assert.notEqual(f.aiDecide(me)?.id, 18);
  } finally { G.setData(base); }
});

test('未知单挑技及非法使用次数被版本校验拒绝', () => {
  const invalid = structuredClone(expanded); invalid.officers[0].duelSkill = '__proto__';
  assert.throws(() => validateScenario(invalid, base), /单挑技/);
  for (const value of [0, 4, true, null, 1.5]) {
    const bad = structuredClone(expanded); bad.skills[0].maxUses = value;
    assert.throws(() => validateScenario(bad, base), /次数/);
  }
});

test('角色模板复用同名计略并保留管理员已有的调整', () => {
  const draft = newDraft(base), first = { skills: [] }, second = { skills: [] };
  addPresetAbilities(draft, { key: 'wang' }, first);
  assert.deepEqual(first, { skills: [16], duelSkill: 'shoucheng' });
  draft.skills[0].cost = 11; draft.skills[0].maxUses = 1;
  addPresetAbilities(draft, { key: 'wang' }, second);
  assert.deepEqual(second, first); assert.equal(draft.skills.length, 1);
  assert.equal(draft.skills[0].cost, 11); assert.equal(draft.skills[0].maxUses, 1);
});
