import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { applyScenario, newDraft, validateScenario } from '../src/core/scenario.js';
import { addPresetAbilities, hasLegacyRecords, loadScenario } from '../src/core/scenario-store.js';
import { FEMALE_SCENARIO_ID, HERO_SCENARIO_ID, ROSTER_SCENARIO_ID, ROSTER_PRESETS, visualUrl } from '../src/core/visuals.js';
import { Field, PLAIN } from '../src/core/field.js';
import { Tactical } from '../src/core/tactical.js';
import { Duel } from '../src/core/skirmish.js';
import { equip, housekeeping } from '../src/core/ai.js';
import { suspend, peekSuspend } from '../src/core/suspend.js';

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

test('新阵容包含陈到、辛宪英及其关系，原版和原合并版的武将编号保持不变', async () => {
  const roster = await loadScenario(ROSTER_SCENARIO_ID, base), extended = applyScenario(base, roster), hero = data();
  assert.equal(base.officers.length, 237); assert.equal(hero.officers.length, 244);
  assert.deepEqual(extended.officers.slice(0, 244), hero.officers);
  assert.deepEqual(extended.officers.slice(244).map((o) => [o.id, o.name, o.year, o.city, o.birthYear, o.birthCity]), [
    [244, '陈到', 196, 14, null, null], [245, '辛宪英', 207, 14, null, null],
  ]);
  assert.equal(extended.officers[244].duelSkill, 'baier');
  assert.deepEqual(extended.officers[245].skills, [23]);
  assert.deepEqual(extended.relationships, [{ from: 222, to: 244, kind: '君臣' }, { from: 118, to: 245, kind: '父女' }]);
  for (const id of [244, 245]) {
    const o = extended.officers[id]; assert.ok(extended.search_table[String(o.city)].includes(id));
    for (const ref of [o.visual.portrait, o.visual.motion, ...Object.values(o.visual.faces)]) assert.ok(visualUrl(ref));
  }
  G.setData(extended, ROSTER_SCENARIO_ID);
  try {
    const priority = G.newGame(4, 1, 1);
    priority.year = 195; assert.notEqual(G.searchOrder(priority, 14)[0], 244);
    priority.year = 196; assert.equal(G.searchOrder(priority, 14)[0], 244);
    priority.year = 207; priority.officers[244].status = G.SERVING; assert.equal(G.searchOrder(priority, 14)[0], 245);
    for (const [id, year] of [[244, 196], [245, 207]]) {
      const g = G.newGame(4, 1, 1), queue = G.searchQueue(14);
      for (const other of queue) if (other !== id) g.officers[other].status = G.SERVING;
      g.year = year - 1; assert.deepEqual(G.queueHead(g, queue), { id, ready: false });
      g.year = year; assert.deepEqual(G.queueHead(g, queue), { id, ready: true });
      g.sangu = true;
      for (let n = 0; n < 3 && g.officers[id].status === G.UNAPPEARED; n++) G.search(g, 14, 130);
      assert.equal(g.officers[id].status, G.SERVING); assert.ok(g.cities[14].officers.includes(id));
    }
    assert.equal(G.scenarioKey('save'), 'save:scenario:builtin-heroes-roster');
  } finally { G.setData(base); }
});

test('新阵容不覆盖合并版中同编号的动态武将及普通、快速存档', async () => {
  const roster = applyScenario(base, await loadScenario(ROSTER_SCENARIO_ID, base)), prior = data();
  const savedLocal = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), records = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => records.get(key) ?? null, setItem: (key, value) => records.set(key, String(value)), removeItem: (key) => records.delete(key),
  } });
  try {
    G.setData(prior, HERO_SCENARIO_ID);
    const old = G.newGame(4, 1, 1); old.year = 200;
    old.officers.push({ ...old.officers[0], id: 244, debut: 200 }); old.clones = [244]; G.registerClones(old);
    assert.equal(G.save(old, 1), true); assert.equal(G.saveQuick(old), true);
    const war = { city: 8, from: 12, attacker: 4, defender: 2,
      att: { ids: [244], gold: 100, rice: 500 }, def: { ids: [38], gold: 100, rice: 500 } };
    old.officers[244].soldiers = old.officers[38].soldiers = 500;
    const field = new Field(old, war, 'att');
    assert.equal(suspend(old, war, field, { side: 'att', start: { 244: 500, 38: 500 }, after: { kind: 'att' } }), true);
    G.setData(roster, ROSTER_SCENARIO_ID);
    assert.equal(G.upgrade(old), null); assert.equal(G.data().officers[244].name, '陈到');
    assert.equal(peekSuspend(), null);
    const fresh = G.newGame(4, 1, 2); assert.equal(G.save(fresh, 1), true); assert.equal(G.saveQuick(fresh), true);
    assert.equal(G.load(1).officers.length, 246); assert.equal(G.loadQuick().officers.length, 246);
    G.setData(data(), HERO_SCENARIO_ID);
    assert.deepEqual(G.load(1).clones, [244]); assert.deepEqual(G.loadQuick().clones, [244]);
    assert.equal(G.data().officers[244].clone, true);
    const held = peekSuspend(); assert.deepEqual(held.g.clones, [244]);
    assert.deepEqual(Field.restore(held.g, held.war, held.field).units.map((u) => u.id).sort((a, b) => a - b), [38, 244]);
  } finally {
    G.setData(base);
    if (savedLocal) Object.defineProperty(globalThis, 'localStorage', savedLocal); else delete globalThis.localStorage;
  }
});

test('新人物模板带有专属技能，保留可替换的内置素材', () => {
  const draft = newDraft(base);
  for (const [key, ability] of [['dao', 'baier'], ['xin', 16]]) {
    const officer = { skills: [] }, preset = ROSTER_PRESETS.find((p) => p.key === key);
    addPresetAbilities(draft, preset, officer);
    if (key === 'dao') assert.equal(officer.duelSkill, ability);
    else assert.deepEqual(officer.skills, [ability]);
  }
});

test('新角色的单挑技和计略可用且遵守每场次数限制', async () => {
  G.setData(applyScenario(base, await loadScenario(ROSTER_SCENARIO_ID, base)), ROSTER_SCENARIO_ID);
  try {
    const g = G.newGame(4, 1, 1), battle = new Tactical(g, 244, 38, 2, () => 0, { human: 'a' });
    battle.side.a.F = 60; battle.side.a.eq.atk = 12; battle.side.d.eq.def = 2; battle.side.d.hp = 99;
    const duel = new Duel(battle.side, (n) => n === 256 ? 13 : 0, g, 'a');
    assert.equal(duel.special('a').name, '白毦突击'); assert.equal(duel.aiCommand('a'), 'special');
    assert.equal(duel.act('a', 'special').hit, true); assert.equal(duel.canSpecial('a'), false);

    const war = { city: 8, from: 12, attacker: 4, defender: 2,
      att: { ids: [245], gold: 100, rice: 500 }, def: { ids: [38], gold: 100, rice: 500 } };
    const field = new Field(g, war, 'att'); field.map = Array.from({ length: 19 }, () => Array(32).fill(PLAIN));
    const me = field.units.find((u) => u.id === 245), foe = field.units.find((u) => u.id === 38);
    Object.assign(me, { x: 10, y: 10 }); Object.assign(foe, { x: 12, y: 10 });
    g.officers[38].soldiers = 500; field.turn = 'att'; field.pool.att = 99; field.r = () => 0;
    assert.equal(field.cast(me, 23, foe).hit, true);
    assert.equal(g.officers[38].soldiers, 450); assert.equal(foe.stop, 1); assert.equal(field.chest('def').rice, 470);
    assert.equal(field.cast(me, 23, foe).hit, true); assert.equal(field.canCast(me, 23, foe), false);
    const restored = Field.restore(g, war, field.snapshot());
    assert.equal(restored.units.find((u) => u.id === 245).skillUses[23], 2);
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

test('合并版旧存档、快速存档及中断战斗保留动态武将和装备编号', () => {
  const savedLocal = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), records = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => records.get(key) ?? null, setItem: (key, value) => records.set(key, String(value)), removeItem: (key) => records.delete(key),
  } });
  const previous = structuredClone(expanded);
  Object.assign(previous.weapons.find((e) => e.name === '落日弓'), { atk: 15 });
  Object.assign(previous.armors.find((e) => e.name === '凤羽宝衣'), { dfn: 12, weight: 4, price: 420, requirements: { virtue: 80 } });
  // 模拟加入新招式前的合并版，动态编号 244 当时仍可用于复制武将。
  previous.officers = previous.officers.filter((officer) => ![218, 156, 57, 75, 24, 86].includes(officer.id));
  previous.skills = previous.skills.slice(0, 5);
  for (const officer of previous.officers) delete officer.searchPriority;
  G.setData(applyScenario(base, previous), HERO_SCENARIO_ID);
  try {
    const g = G.newGame(4, 1, 1); g.year = 200;
    g.officers.push({ ...g.officers[0], id: 244, debut: 200 }); g.clones = [244]; G.registerClones(g);
    g.officers[237].weapon = 38; g.officers[237].armor = 22;
    const { f, war } = fieldFor(g);
    assert.equal(G.save(g, 1), true); assert.equal(G.saveQuick(g), true); assert.equal(G.saveAuto(g), true);
    assert.equal(suspend(g, war, f, { side: 'att', start: { 242: 500, 38: 500 }, after: { kind: 'att' } }), true);
    G.setData(data(), HERO_SCENARIO_ID);
    const normal = G.load(1), quick = G.loadQuick(), auto = G.loadAuto(), held = peekSuspend();
    for (const saved of [normal, quick, auto, held?.g]) {
      assert.ok(saved); assert.equal(saved.year, 200); assert.equal(saved.officers[237].weapon, 38);
      assert.equal(saved.officers[237].armor, 22); assert.deepEqual(saved.clones, [244]);
    }
    assert.equal(G.data().officers[244].clone, true);
    assert.equal(G.data().equipment[38].atk, 14); assert.equal(G.data().equipment[46].dfn, 11);
    assert.equal(G.data().officers[218].duelSkill, 'fangtian');
    assert.equal(G.data().officers[156].duelSkill, 'xiaoyao');
    const restored = Field.restore(held.g, held.war, held.field);
    assert.deepEqual(restored.units.map((unit) => unit.id).sort((a, b) => a - b), [38, 242]);
  } finally {
    G.setData(base);
    if (savedLocal) Object.defineProperty(globalThis, 'localStorage', savedLocal); else delete globalThis.localStorage;
  }
});

test('新增名将专属单挑技只影响合并版，玩家与电脑每场各可使用一次', async () => {
  const current = data(), legacy = applyScenario(base, await loadScenario(FEMALE_SCENARIO_ID, base));
  const generals = [[156, 'xiaoyao', '逍遥突击', 5, 115], [57, 'huchi', '虎痴猛击', -10, 125], [75, 'laojiang', '老将劲击', 5, 110]];
  for (const [id, key] of generals) {
    assert.equal(base.officers[id].duelSkill, undefined);
    assert.equal(legacy.officers[id].duelSkill, undefined);
    assert.equal(current.officers[id].duelSkill, key);
  }
  G.setData(current, HERO_SCENARIO_ID);
  try {
    for (const [id, , name, hit, damage] of generals) {
      const g = G.newGame(4, 1, 1), make = () => {
        const t = new Tactical(g, id, 22, 2, () => 0, { human: 'a' });
        t.side.a.F = 60; t.side.a.eq.atk = 12; t.side.d.eq.def = 2; t.side.d.hp = 99;
        return new Duel(t.side, (n) => n === 256 ? 13 : 0, g, 'a');
      };
      const normal = make(), special = make();
      assert.equal(special.special('a').name, name);
      assert.equal(special.threshold('a', 'special'), special.hitChance('a') + hit);
      assert.equal(special.aiCommand('a'), 'special');
      const ordinary = normal.act('a', 'attack'), result = special.act('a', 'special');
      assert.equal(result.hit, true); assert.equal(result.dmg, Math.floor(ordinary.dmg * damage / 100));
      assert.equal(special.canSpecial('a'), false);
      assert.throws(() => special.act('a', 'special'), /not allowed/);
      assert.equal(make().canSpecial('a'), true, '新单挑恢复次数');
    }
  } finally { G.setData(base); }
});

test('郭嘉和司马懿的新计略使用固定效果并限制次数，战场中断后保留次数', async () => {
  const current = data(), legacy = applyScenario(base, await loadScenario(FEMALE_SCENARIO_ID, base));
  for (const [id, skill] of [[24, 21], [86, 22]]) {
    assert.deepEqual(current.officers[id].skills, [skill]);
    assert.equal(base.officers[id].skills, undefined); assert.equal(legacy.officers[id].skills, undefined);
  }
  G.setData(current, HERO_SCENARIO_ID);
  try {
    for (const [id, skill, loss, hpLoss, riceLoss] of [[24, 21, 80, 0, 30], [86, 22, 70, 2, 0]]) {
      const g = G.newGame(4, 1, 1), war = { city: 8, from: 12, attacker: 4, defender: 2,
        att: { ids: [id], gold: 100, rice: 500 }, def: { ids: [38], gold: 100, rice: 500 } };
      const f = new Field(g, war, 'att'); f.map = Array.from({ length: 19 }, () => Array(32).fill(PLAIN));
      const me = f.units.find((u) => u.id === id), foe = f.units.find((u) => u.id === 38);
      Object.assign(me, { x: 10, y: 10 }); Object.assign(foe, { x: 12, y: 10 });
      Object.assign(g.officers[38], { soldiers: 500, hp: 90 });
      f.turn = 'att'; f.pool.att = 99; f.r = () => 0;
      assert.equal(f.canCast(me, skill, foe), true);
      assert.equal(f.cast(me, skill, foe).hit, true);
      assert.equal(g.officers[38].soldiers, 500 - loss); assert.equal(g.officers[38].hp, 90 - hpLoss);
      assert.equal(f.chest('def').rice, 500 - riceLoss); assert.equal(foe.stop, 1);
      assert.equal(f.cast(me, skill, foe).hit, true);
      assert.equal(f.canCast(me, skill, foe), false);
      assert.match(f.cast(me, skill, foe).lines[0], /次数/);
      const restored = Field.restore(g, war, f.snapshot()), restoredUnit = restored.units.find((u) => u.id === id);
      assert.equal(restoredUnit.skillUses[skill], 2);
      assert.equal(restored.canCast(restoredUnit, skill, restored.units.find((u) => u.id === 38)), false);

      const aiGame = G.newGame(4, 1, 1), aiField = new Field(aiGame, war, 'def');
      aiField.map = Array.from({ length: 19 }, () => Array(32).fill(PLAIN));
      const aiUnit = aiField.units.find((u) => u.id === id), target = aiField.units.find((u) => u.id === 38);
      Object.assign(aiUnit, { x: 10, y: 10 }); Object.assign(target, { x: 12, y: 10 });
      aiGame.officers[id].soldiers = aiGame.officers[38].soldiers = 500;
      aiField.turn = 'att'; aiField.pool.att = 99; aiField.r = () => 0;
      assert.equal(aiField.aiDecide(aiUnit).id, skill, '电脑可选择该专属计略');
      assert.equal(aiField.aiDecide(aiUnit).id, skill);
      assert.equal(aiUnit.skillUses[skill], 2);
      assert.notEqual(aiField.aiDecide(aiUnit)?.id, skill, '电脑也受每场次数限制');
    }
  } finally { G.setData(base); }
});

test('吕布只在合并版拥有方天破阵，每场单挑限用一次', async () => {
  const current = data(), legacy = applyScenario(base, await loadScenario(FEMALE_SCENARIO_ID, base));
  assert.equal(base.officers[218].duelSkill, undefined);
  assert.equal(legacy.officers[218].duelSkill, undefined);
  assert.equal(current.officers[218].duelSkill, 'fangtian');
  G.setData(current, HERO_SCENARIO_ID);
  try {
    const g = G.newGame(4, 1, 1), battle = new Tactical(g, 218, 38, 2, () => 0, { human: 'a' });
    battle.side.a.F = 60; battle.side.a.eq.atk = 12; battle.side.d.eq.def = 2; battle.side.d.hp = 99;
    const duel = new Duel(battle.side, (n) => n === 256 ? 13 : 0, g, 'a');
    assert.equal(duel.special('a').name, '方天破阵');
    assert.equal(duel.threshold('a', 'special'), duel.hitChance('a') - 10);
    assert.equal(duel.canSpecial('a'), true); assert.equal(duel.aiCommand('a'), 'special');
    assert.equal(duel.act('a', 'special').hit, true); assert.equal(duel.canSpecial('a'), false);
    assert.throws(() => duel.act('a', 'special'), /not allowed/);
    assert.equal(new Duel(battle.side, () => 0, g, 'a').canSpecial('a'), true, '新单挑重新可用');
  } finally { G.setData(base); }
});

test('陈宫和高顺在登场年份优先搜索，之前不阻挡其他人，玩家和电脑均可寻访', () => {
  G.setData(data(), HERO_SCENARIO_ID);
  try {
    for (const [id, city] of [[242, 11], [243, 12]]) {
      const g = G.newGame(4, 1, 1), original = G.searchQueue(city), first = original[0];
      g.year = 191; assert.equal(G.searchOrder(g, city)[0], first);
      g.year = 192; assert.equal(G.searchOrder(g, city)[0], id);
      assert.equal(G.cityTalent(g, city).head.id, id);
      g.sangu = true; g.cities[city].officers = [0];
      for (let n = 0; n < 3 && g.officers[id].status === G.UNAPPEARED; n++) G.search(g, city, 0);
      assert.equal(g.officers[id].status, G.SERVING);
      assert.equal(G.searchOrder(g, city)[0], first, '原有未登场武将仍可搜索');

      const ai = G.newGame(4, 1, 1), faction = ai.cities[city].faction;
      ai.year = 192; housekeeping(ai, faction, () => 0, () => true);
      assert.equal(ai.officers[id].status, G.SERVING, '电脑可按相同优先顺序搜索');
    }
  } finally { G.setData(base); }
});

test('合并版装备平衡调整不改变旧巾帼版本的装备和编号', async () => {
  const legacy = applyScenario(base, await loadScenario(FEMALE_SCENARIO_ID, base)), current = data();
  for (const name of ['落日弓', '凤羽宝衣']) {
    const a = legacy.equipment.find((e) => e.name === name), b = current.equipment.find((e) => e.name === name);
    assert.equal(a.id, b.id);
    if (name === '落日弓') assert.deepEqual([a.atk, a.weight, b.atk, b.weight], [15, 6, 14, 6]);
    else assert.deepEqual([a.dfn, a.weight, a.price, a.requirements.virtue, b.dfn, b.weight, b.price, b.requirements.virtue], [12, 4, 420, 80, 11, 5, 480, 85]);
  }
});

test('电脑在合并版购买最优可负担的弓，并可为合适武将首次购入弓或扇', () => {
  const d = data(); G.setData(d, HERO_SCENARIO_ID);
  try {
    const g = G.newGame(4, 1, 1), c = g.cities[15], bow = d.equipment.find((e) => e.name === '落日弓');
    c.officers = [237]; c.gold = 400;
    assert.equal(equip(g, c, () => 0, () => false), true);
    assert.equal(g.officers[237].weapon, bow.id); assert.equal(c.gold, 0);
    const g2 = G.newGame(4, 1, 1), c2 = g2.cities[15]; c2.officers = [38]; c2.gold = 400;
    g2.officers[38].weapon = 0; g2.officers[38].armor = 7;
    assert.equal(equip(g2, c2, () => 0, () => false), true);
    assert.equal(g2.officers[38].weapon, bow.id); assert.equal(c2.gold, 0);
    const g3 = G.newGame(4, 1, 1), c3 = g3.cities[8], fan = d.equipment.find((e) => e.name === '玄策扇');
    c3.officers = [109]; c3.gold = 260; g3.officers[109].weapon = 0; g3.officers[109].armor = 7;
    assert.equal(equip(g3, c3, () => 0, () => false), true);
    assert.equal(g3.officers[109].weapon, fan.id); assert.equal(c3.gold, 0);
  } finally { G.setData(base); }
});

test('电脑购买遵守价格和属性条件，持弓后不会来回更换武器类别', () => {
  const d = data(); G.setData(d, HERO_SCENARIO_ID);
  try {
    const g = G.newGame(4, 1, 1), c = g.cities[15]; c.officers = [38]; c.gold = 400;
    Object.assign(g.officers[38], { weapon: 0, armor: 7, war: 84 });
    assert.equal(equip(g, c, () => 0, () => false), true);
    assert.equal(d.equipment[g.officers[38].weapon].name, '穿云弓'); assert.equal(c.gold, 100);
    const g2 = G.newGame(4, 1, 1), c2 = g2.cities[4]; c2.officers = [109]; c2.gold = 360;
    Object.assign(g2.officers[109], { weapon: 37, armor: 7 });
    assert.equal(equip(g2, c2, () => 0, () => false), false);
    assert.equal(g2.officers[109].weapon, 37); assert.equal(c2.gold, 360);
    c2.gold = 1; assert.equal(equip(g2, c2, () => 0, () => true), false); assert.equal(c2.gold, 1);

    d.equipment[38].requirements.officers = [237];
    const g3 = G.newGame(4, 1, 1), c3 = g3.cities[15]; c3.officers = [38]; c3.gold = 400;
    Object.assign(g3.officers[38], { weapon: 0, armor: 7, war: 99 });
    assert.equal(equip(g3, c3, () => 0, () => false), true);
    assert.equal(d.equipment[g3.officers[38].weapon].name, '穿云弓', '指定武将条件必须生效');

    const g4 = G.newGame(4, 1, 1), c4 = g4.cities[8]; c4.officers = [38, 109]; c4.gold = 70;
    Object.assign(g4.officers[38], { weapon: 6, armor: 7 });
    Object.assign(g4.officers[109], { weapon: 0, armor: 7 });
    assert.equal(equip(g4, c4, () => 0, () => false), true);
    assert.equal(g4.officers[38].weapon, 6); assert.notEqual(g4.officers[109].weapon, 0);
    assert.ok(c4.gold >= 0, '高武力武将没有可负担升级时不阻挡其他武将');

    const g5 = G.newGame(4, 1, 1), c5 = g5.cities[8]; c5.officers = [38]; c5.gold = 300;
    Object.assign(g5.officers[38], { weapon: 2, armor: 7 });
    d.cities[8].ai_shop = [37]; d.equipment[37].weight = 20;
    assert.equal(equip(g5, c5, () => 0, () => true), false, '过重的高攻击弓不应被视为升级');
    assert.equal(g5.officers[38].weapon, 2); assert.equal(c5.gold, 300);
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

test('专属计略不会缩短已有控制，换日与中断恢复保留正确的目标行动次数', () => {
  G.setData(data(), HERO_SCENARIO_ID);
  try {
    const g = G.newGame(4, 1, 1), { f, me, foe, war } = fieldFor(g);
    f.map[foe.y][foe.x] = 0; // 虚兵的目标需要森林
    assert.equal(f.cast(me, 2, foe).hit, true); assert.equal(foe.stop, 3);
    assert.equal(f.cast(me, 18, foe).hit, true); assert.equal(foe.stop, 3); assert.equal(foe.stopBy, '虚兵');
    f.endTurn(); assert.equal(f.turn, 'def'); assert.equal(foe.stop, 3);
    f.endTurn(); assert.equal(foe.stop, 2);

    const other = fieldFor(G.newGame(4, 1, 1)), defender = other.foe, attacker = other.me;
    other.f.turn = 'def'; other.f.pool.def = 99; other.f.map[attacker.y][attacker.x] = 0;
    assert.equal(other.f.cast(defender, 2, attacker, true).hit, true); assert.equal(attacker.stop, 2);
    assert.equal(other.f.cast(defender, 18, attacker, true).hit, true); assert.equal(attacker.stop, 2);
    let resumed = Field.restore(other.f.g, other.war, other.f.snapshot());
    let restored = resumed.units.find((u) => u.id === attacker.id);
    resumed.endTurn(); assert.equal(restored.stop, 1, '原限制下一次换日后仍生效一回合');

    const expires = fieldFor(G.newGame(4, 1, 1)); expires.f.turn = 'def'; expires.f.pool.def = 99;
    Object.assign(expires.me, { stop: 1, stopBy: '虚兵' });
    assert.equal(expires.f.cast(expires.foe, 18, expires.me, true).hit, true);
    assert.equal(expires.me.stopSkipTick, true, '原限制即将失效时新限制仍需生效');
    resumed = Field.restore(expires.f.g, expires.war, expires.f.snapshot());
    restored = resumed.units.find((u) => u.id === expires.me.id);
    resumed.endTurn(); assert.equal(restored.stop, 1);
    resumed.endTurn(); resumed.endTurn(); assert.equal(restored.stop, 0);
  } finally { G.setData(base); }
});

test('电脑专属计略按预期效果和命中率选择目标，不按武将队列盲选', () => {
  G.setData(data(), HERO_SCENARIO_ID);
  try {
    const g = G.newGame(4, 0, 1), war = { city: 8, from: 12, attacker: 4, defender: 2,
      att: { ids: [242], gold: 100, rice: 500 }, def: { ids: [22, 93, 9], gold: 100, rice: 500 } };
    const f = new Field(g, war, 'def'); f.map = Array.from({ length: 19 }, () => Array(32).fill(PLAIN));
    const me = f.units.find((u) => u.id === 242), far = f.units.find((u) => u.id === 93), near = f.units.find((u) => u.id === 9);
    Object.assign(me, { x: 10, y: 10 }); Object.assign(f.units.find((u) => u.id === 22), { x: 20, y: 10 });
    Object.assign(far, { x: 15, y: 10, stop: 3 }); Object.assign(near, { x: 11, y: 10 });
    g.officers[93].soldiers = g.officers[9].soldiers = 500; f.pool.att = 99; f.r = () => 0;
    assert.ok(f.odds(me, 18, near) > f.odds(me, 18, far));
    const action = f.aiDecide(me); assert.equal(action.type, 'strategy'); assert.equal(action.t.id, 9);
    assert.equal(far.stop, 3); assert.equal(me.skillUses[18], 1);
  } finally { G.setData(base); }
});

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
