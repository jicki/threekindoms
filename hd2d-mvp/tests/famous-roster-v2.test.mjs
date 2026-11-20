import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { applyScenario } from '../src/core/scenario.js';
import { loadScenario } from '../src/core/scenario-store.js';
import { SOVEREIGN_SCENARIO_ID } from '../src/core/visuals.js';
import { EXPANDED_MAP_ID, expandMap } from '../src/core/expanded-map.js';
import { abilityDuel, abilityStrategy, abilityStrategyIds, famousLabel, strategySpecs } from '../src/core/famous-skills.js';
import { Field } from '../src/core/field.js';
import { officerPassive } from '../src/core/battle-rules.js';
import { Tactical } from '../src/core/tactical.js';
import { Duel } from '../src/core/skirmish.js';
import { autoSkillBonus } from '../src/core/warcore.js';
import { startRaid, validRaidRecord } from '../src/core/raids.js';
import { suspend, peekSuspend, takeSuspend, suspendToken, futureSuspend, dropSuspend, SUSPEND_KEY, SUSPEND_VERSION } from '../src/core/suspend.js';
import { legacyRoster } from './legacy-roster.mjs';

const base=JSON.parse(readFileSync(new URL('../data/game-data.json',import.meta.url)));
const D=expandMap(applyScenario(base,await loadScenario(SOVEREIGN_SCENARIO_ID,base)));
const game=()=>{G.setData(D,EXPANDED_MAP_ID);return G.newGame(4,1,7);};
const generals='关羽 张飞 赵云 马超 黄忠 张辽 于禁 张郃 徐晃 典韦 许褚 庞德 邓艾 钟会 夏侯惇 夏侯渊 周瑜 吕蒙 陆逊 甘宁 太史慈 孙翊 吕布 颜良 文丑 华雄 张绣'.split(' ');
const advisers='诸葛亮 庞统 姜维 法正 荀彧 荀攸 郭嘉 贾诩 司马懿 司马师 司马昭 周瑜 鲁肃 张昭 张纮 诸葛瑾 步骘 陈宫 杨修'.split(' ');
const byName=(n)=>D.officers.find(o=>o?.name===n && !o.clone);

test('指定名单全部存在，名将和名臣有各自专属技能；重复人物不重复配置',()=>{
  const g=legacyRoster(game(),1); assert.equal(g.famousSkills,2); assert.equal(g.famousRoster,1); assert.ok(G.upgrade(structuredClone(g)));
  for(const name of generals) { const o=byName(name); assert.ok(o,`${name}不存在`); assert.ok(abilityDuel(D,g,o.id),`${name}缺少单挑技`); assert.ok(famousLabel(D,g,o.id)); }
  for(const name of advisers) { const o=byName(name); assert.ok(o,`${name}不存在`); assert.equal(abilityStrategyIds(D,g,o.id).length,1,`${name}缺少计策`); assert.ok(famousLabel(D,g,o.id)); }
  assert.equal(generals.filter(n=>n==='周瑜').length,1); assert.equal(advisers.filter(n=>n==='贾诩').length,1);
  for(const name of ['王异','孙尚香','公孙瓒','吕布']) {const o=byName(name); if(name!=='吕布') { assert.equal(abilityDuel(D,g,o.id),null); assert.deepEqual(abilityStrategyIds(D,g,o.id),[]); }}
  const skillNames=advisers.map(name=>abilityStrategy(D,g,strategySpecs(D,g).find(s=>s.id===abilityStrategyIds(D,g,byName(name).id)[0])).name);
  const duelNames=generals.map(name=>abilityDuel(D,g,byName(name).id).name);
  assert.equal(new Set(skillNames).size,advisers.length); assert.equal(new Set(duelNames).size,generals.length);
});

test('新人物按照各自年份、城市进入真实搜索队列',()=>{
  for(const [name,id,city,year] of [['张昭',262,15,195],['张纮',263,15,195],['张绣',264,32,197]]) {
    const g=game();
    assert.equal(byName(name).id,id); assert.equal(g.officers[id].status,G.UNAPPEARED);
    assert.equal(G.debutInfo(id).city,city);
    for(const other of G.searchOrder(g,city)) if(other!==id) g.officers[other].status=G.SERVING;
    g.year=year-1; assert.deepEqual(G.queueHead(g,G.searchOrder(g,city)),{id,ready:false});
    g.year=year; assert.deepEqual(G.queueHead(g,G.searchOrder(g,city)),{id,ready:true});
    assert.equal(G.data().officers[id].year,year);
  }
});

test('新版计策和单挑通过实际战斗、电脑估算及次数限制生效',()=>{
  const g=game(); g.campaignRevision=1;
  const a=byName('法正'), b=byName('关羽'), w={city:34,from:8,attacker:5,defender:4,
    att:{ids:[a.id],gold:100,rice:3000},def:{ids:[b.id],gold:100,rice:3000}};
  const f=new Field(g,w,'att'),u=f.side('att')[0],v=f.side('def')[0]; Object.assign(u,{x:3,y:3});Object.assign(v,{x:4,y:3});
  f.pool.att=100; f.turn='att'; f.r=()=>0; g.officers[a.id].soldiers=1000; g.officers[b.id].soldiers=700;
  assert.ok(autoSkillBonus(g,[a.id],[b.id],100,5,3000)>0, '电脑自动战斗应计入新版专属计策');
  const skill=f.strategies(u).find(s=>s.name==='汉中奇谋'); assert.ok(skill); assert.equal(f.cast(u,skill.id,v).hit,true);
  assert.equal(g.officers[b.id].soldiers,590); assert.equal(f.cast(u,skill.id,v).hit,true); assert.equal(f.canCast(u,skill.id,v),false);
  const t=new Tactical(g,byName('马超').id,b.id,2,()=>0), duel=new Duel(t.side,()=>0,g);
  assert.equal(duel.special('a').name,'锦骑破阵'); duel.act('a','special'); assert.equal(duel.canSpecial('a'),false);
});

test('旧分身编号不被新人物覆盖，预览存档不改变正在进行的新局',()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage'), store=new Map();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)}});
  try {
    const current=game(), old=legacyRoster(structuredClone(current)); delete old.famousRoster; old.famousSkills=true; old.officers.length=262;
    old.clones=[262]; old.officers.push({...old.officers[0],id:262,status:G.SERVING}); old.cities[2].officers.push(262);
    assert.ok(G.upgrade(old)); G.registerClones(old); assert.equal(G.name(262),'阿会喃'); assert.equal(G.save(old,1),true); assert.equal(G.saveQuick(old),true);
    G.registerClones(current); assert.equal(G.name(262),'张昭');
    assert.ok(G.saves()[0]); assert.ok(G.loadQuick({preview:true})); assert.equal(G.name(262),'张昭','预览旧分身不能覆盖当前人物');
    const loaded=G.load(1); assert.ok(loaded); assert.equal(G.name(262),'阿会喃');
    G.registerClones(current); assert.equal(G.name(262),'张昭'); assert.ok(G.saveQuick(current));
    G.registerClones(old); const preview=G.loadQuick({preview:true}); assert.ok(preview); assert.equal(G.name(262),'阿会喃');
    const resumed=G.loadQuick(); assert.equal(resumed.famousRoster,3); assert.equal(G.name(262),'张昭');
  } finally {if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else delete globalThis.localStorage;}
});

test('旧袭城中断与新人物编号重叠时仍可预览、恢复和识别敌军',()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage'), store=new Map();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)}});
  try {
    const current=game(), old=legacyRoster(structuredClone(current)); delete old.famousRoster; old.famousSkills=true; old.officers.length=262; G.registerClones(old);
    const w=startRaid(old,{city:2,faction:4,kind:'bandit',troops:300}); const f=new Field(old,w,'def');
    assert.equal(w.att.ids[0],262); assert.equal(suspend(old,w,f,{side:'def',start:{},after:{kind:'raid'}}),true);
    G.registerClones(current); assert.equal(G.name(262),'张昭');
    assert.ok(peekSuspend(),'新人物存在时仍须识别旧袭城记录');
    const rec=takeSuspend(); assert.ok(rec && validRaidRecord(rec.g,rec.war)); assert.equal(G.name(262),'山贼头目');
    assert.equal(G.upgradeCampaign(rec.g), false);
    assert.equal(rec.g.famousSkills, true);
    G.registerClones(current); assert.equal(G.name(262),'张昭');
  } finally {if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else delete globalThis.localStorage;}
});

function legacyCampaign() {
  const g = game();
  for (const key of ['campaignRevision', 'famousRoster', 'siegeTactics', 'autoBattleSkills', 'safeStrategyChance', 'expandedOpeningGuard']) delete g[key];
  g.famousSkills = true;
  g.battlefields = 1;
  g.officers.length = 262;
  g.year = 196;
  g.month = 5;
  g.books = 3;
  g.enhancedRulerPassives = false;
  g.battleRulerPassives = false;
  g.cities[2].gold = 1711;
  return g;
}

test('战役升级保留已有进度和开关，并启用新增人物、计策和战场', () => {
  const g = legacyCampaign(), before = structuredClone(g);
  assert.ok(G.campaignUpgradeAvailable(g));
  assert.deepEqual(G.upgrade(structuredClone(g)), before, '普通读取仍使用记录保存的规则');
  assert.ok(G.upgradeCampaign(g));
  assert.deepEqual(g.cities, before.cities);
  assert.deepEqual(g.factions, before.factions);
  assert.deepEqual(g.officers.slice(0, 262), before.officers);
  for (const k of ['year', 'month', 'books', 'seed', 'expandedOpeningGuard', 'enhancedRulerPassives', 'battleRulerPassives']) {
    assert.equal(g[k], before[k], k);
  }
  assert.equal(g.famousSkills, 2);
  assert.equal(g.famousRoster, 3);
  assert.equal(g.battlefields, 2);
  assert.equal(g.siegeTactics, true);
  assert.equal(g.autoBattleSkills, true);
  assert.equal(g.safeStrategyChance, true);
  assert.equal(abilityDuel(D, g, 264), null);
  assert.equal(officerPassive(D, { ...g, campaignRevision: 7 }, 264).name, '锐进');
  assert.equal(officerPassive(D, g, 264).name, '宛城骑锋');
  assert.equal(g.officers[262].status, G.UNAPPEARED);
  assert.ok(G.searchOrder(g, 15).includes(262));
  assert.ok(G.searchOrder(g, 32).includes(264));
  assert.equal(G.campaignUpgradeAvailable(g), false);
  assert.equal(G.upgradeCampaign(g), false);
  assert.deepEqual(G.upgrade(structuredClone(g)), g);
});

test('升级时顺延旧档分身，城市名册、君主、衰亡势力及寻访计数仍指向对应武将', () => {
  const g = legacyCampaign(), city = g.cities.find(c => c.faction === g.player);
  const [first, second] = [262, 263];
  g.clones = [first, second];
  g.officers.push({ ...g.officers[0], id: first, soldiers: 325, loc: city.id }, { ...g.officers[0], id: second, hp: 0, status: G.DEAD });
  city.officers.push(first);
  g.factions[g.player].ruler = first;
  g.factions[0].fallen = second;
  g.visits = { [first]: 1, [second]: 2, 38: 1 };
  assert.ok(G.upgradeCampaign(g));
  assert.deepEqual(g.clones, [284, 285]);
  assert.equal(G.name(262), '张昭');
  assert.equal(G.name(284), '阿会喃');
  assert.equal(g.officers[284].soldiers, 325);
  assert.equal(g.officers[285].status, G.DEAD);
  assert.equal(G.officerCity(g, 284).id, city.id);
  assert.equal(g.factions[g.player].ruler, 284);
  assert.equal(g.factions[0].fallen, 285);
  assert.deepEqual(g.visits, { 284: 1, 285: 2, 38: 1 });
});

test('无法确认身份的动态武将会退出升级，原记录和其他版本仍能按原规则读取', () => {
  const g = legacyCampaign();
  g.officers.push({ ...g.officers[0], id: 262 });
  const before = structuredClone(g);
  assert.equal(G.upgradeCampaign(g), false);
  assert.deepEqual(g, before);
  assert.ok(G.upgrade(g));
  G.setData(base);
  const original = G.newGame(4, 1, 7);
  assert.equal(G.campaignUpgradeAvailable(original), false);
  assert.equal(G.upgradeCampaign(original), false);
  assert.ok(G.upgrade(original));
  G.setData(D, 'v-00000000000000000000000000000000');
  const published = G.newGame(4, 1, 7);
  assert.equal(G.campaignUpgradeAvailable(published), false);
  assert.equal(G.upgradeCampaign(published), false);
  assert.ok(G.upgrade(published));
});

test('早期扩展地图的普通、快捷和自动记录可读取，升级后可以保存且保护较新规则记录', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), store = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)),
  } });
  try {
    const g = legacyCampaign(), prefix = G.scenarioKey('haou-hd2d-save');
    g.cities.length = 37;
    delete g.frontierMap;
    const raw = JSON.stringify(g);
    for (const key of ['1', 'quick', 'auto']) store.set(`${prefix}:${key}`, raw);
    for (const record of [G.load(1), G.loadQuick(), G.loadAuto()]) {
      assert.ok(record);
      assert.deepEqual(record.cities.map(c => c.id).slice(37), [37, 38]);
      assert.equal(record.famousSkills, true);
      assert.ok(G.upgradeCampaign(record));
      assert.equal(record.famousSkills, 2);
    }
    for (const key of ['1', 'quick', 'auto']) assert.equal(store.get(`${prefix}:${key}`), raw);
    const upgraded = G.loadQuick();
    assert.ok(G.upgradeCampaign(upgraded));
    assert.ok(G.saveQuick(upgraded));
    assert.ok(G.save(upgraded, 2));
    assert.equal(G.loadQuick().campaignRevision, upgraded.campaignRevision);
    assert.equal(G.load(2).campaignRevision, upgraded.campaignRevision);
    assert.equal(store.get(`${prefix}:quick:bak`), raw);
    const future = JSON.stringify({ ...upgraded, campaignRevision: upgraded.campaignRevision + 1 });
    store.set(`${prefix}:2`, future);
    store.set(`${prefix}:quick`, future);
    assert.equal(G.load(2), null);
    assert.equal(G.loadQuick(), null);
    assert.equal(G.save(upgraded, 2), false);
    assert.equal(G.saveQuick(upgraded), false);
    assert.equal(store.get(`${prefix}:2`), future);
    assert.equal(store.get(`${prefix}:quick`), future);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});

test('自动续玩和中断保护较新版本和其他页面刚写的记录', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), store = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k),
  } });
  try {
    const g = game(), autoKey = G.scenarioKey('haou-hd2d-save') + ':auto', battleKey = G.scenarioKey(SUSPEND_KEY);
    const w = { city: 34, from: 8, attacker: 0, defender: 4, att: { ids: [40], rice: 500, gold: 0 }, def: { ids: [43], rice: 500, gold: 0 } };
    const field = new Field(g, w, 'att'), options = { side: 'att', after: { kind: 'att' } };
    assert.ok(G.saveAuto(g));
    assert.ok(suspend(g, w, field, options));
    const rawAuto = G.autoToken(), rawBattle = suspendToken();
    assert.ok(rawAuto && rawBattle);
    const auto = JSON.parse(rawAuto), battle = JSON.parse(rawBattle);
    for (const future of [{ ...auto, version: auto.version + 1 }, { ...auto, campaignRevision: auto.campaignRevision + 1 }]) {
      const raw = JSON.stringify(future);
      store.set(autoKey, raw);
      assert.equal(G.loadAuto(), null);
      assert.equal(G.saveAuto(g), false);
      assert.equal(G.dropAuto(raw), false);
      assert.equal(G.autoToken(), raw);
    }
    for (const future of [{ ...battle, version: SUSPEND_VERSION + 1 },
      { ...battle, g: { ...battle.g, version: battle.g.version + 1 } },
      { ...battle, g: { ...battle.g, campaignRevision: battle.g.campaignRevision + 1 } }]) {
      const raw = JSON.stringify(future);
      store.set(battleKey, raw);
      assert.equal(futureSuspend(), true);
      assert.equal(peekSuspend(), null);
      assert.equal(takeSuspend(), null);
      assert.equal(suspend(g, w, field, options), false);
      assert.equal(dropSuspend(raw), 'newer');
      assert.equal(suspendToken(), raw);
    }
    const replacementAuto = JSON.stringify({ ...auto, savedAt: auto.savedAt + 1 });
    const replacementBattle = JSON.stringify({ ...battle, savedAt: battle.savedAt + 1 });
    store.set(autoKey, replacementAuto);
    store.set(battleKey, replacementBattle);
    assert.equal(G.dropAuto(rawAuto), false);
    assert.equal(dropSuspend(rawBattle), 'changed');
    assert.equal(suspend(g, w, field, { ...options, expected: null }), false);
    assert.equal(G.autoToken(), replacementAuto);
    assert.equal(suspendToken(), replacementBattle);
    assert.ok(G.dropAuto(replacementAuto));
    assert.equal(dropSuspend(replacementBattle), 'dropped');
    assert.equal(G.autoToken(), null);
    assert.equal(suspendToken(), null);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});
