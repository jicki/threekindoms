import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { applyScenario } from '../src/core/scenario.js';
import { loadScenario } from '../src/core/scenario-store.js';
import { SOVEREIGN_SCENARIO_ID } from '../src/core/visuals.js';
import { EXPANDED_MAP_ID, expandMap } from '../src/core/expanded-map.js';
import { abilityDuel, abilityStrategy, abilityStrategyIds, famousLabel } from '../src/core/famous-skills.js';
import { Field } from '../src/core/field.js';
import { Tactical } from '../src/core/tactical.js';
import { Duel, skirmish } from '../src/core/skirmish.js';
import { autoSkillBonus } from '../src/core/warcore.js';

const base=JSON.parse(readFileSync(new URL('../data/game-data.json',import.meta.url)));
const D=expandMap(applyScenario(base,await loadScenario(SOVEREIGN_SCENARIO_ID,base)));
// 此文件覆盖上一版名将规则，模拟其没有新增三名人物的既有存档。
const game=()=>{ G.setData(D,EXPANDED_MAP_ID); const g=G.newGame(4,1,7); g.campaignRevision=1; g.famousSkills=true; delete g.famousRoster; g.officers.length=262; G.registerClones(g); return g; };
const war=(a,d)=>({city:34,from:8,attacker:0,defender:4,att:{ids:[a],gold:100,rice:3000},def:{ids:[d],gold:100,rice:3000}});

test('第一版战役规则启用名将名单；更早记录及其他版本保持技能',()=>{
  const g=game(); assert.equal(g.famousSkills,true); assert.ok(G.upgrade(structuredClone(g)));
  const old=structuredClone(g); delete old.famousSkills; assert.ok(G.upgrade(old));
  const invalid=structuredClone(g); invalid.famousSkills=false; assert.equal(G.upgrade(invalid),null);
  for(const id of [240,245,249,251,260]) {
    assert.equal(abilityStrategyIds(D,g,id).length,0,D.officers[id].name);
    assert.ok(abilityStrategyIds(D,old,id).length,D.officers[id].name);
  }
  for(const id of [241,255]) {assert.equal(abilityDuel(D,g,id),null);assert.ok(abilityDuel(D,old,id));}
  assert.equal(abilityStrategyIds(D,g,241)[0],20,'王异保留史料中的守城谋略');
  assert.equal(abilityDuel(D,g,261).name,'南中飞刀','演义武将保留');
  G.setData(structuredClone(base)); assert.equal(G.newGame(4,1,7).famousSkills,undefined);
});

test('名单、效果和名称在战场、单挑及自动结算中一致，旧规则名称不变',()=>{
  const g=game(), old=structuredClone(g); delete old.famousSkills;
  const newField=new Field(g,war(24,40),'att'), oldField=new Field(old,war(24,40),'att');
  assert.ok(oldField.strategies(oldField.side('att')[0]).some(s=>s.name==='奉孝奇策'));
  // 创建同一套游戏的 Field 会重建全局计策表，随后只对该场使用。
  const field=new Field(g,war(24,40),'att'); assert.ok(field.strategies(field.side('att')[0]).some(s=>s.name==='奉孝奇谋'));
  assert.equal(abilityStrategy(D,g,D.customSkills.find(s=>s.id===21)).soldiers,80);
  for(const [id,name,hit,damage] of [[218,'飞将破阵',-10,120],[153,'长坂怒击',-15,130],[261,'南中飞刀',5,110]]) {
    const t=new Tactical(g,id,40,2,()=>0), duel=new Duel(t.side,()=>0,g);
    assert.deepEqual(duel.special('a'),{name,hit,damage}); assert.equal(duel.canSpecial('a'),true);
  }
  const t=new Tactical(g,255,40,2,()=>0); assert.equal(new Duel(t.side,()=>0,g).canSpecial('a'),false);
  for(const state of [g,old]) { state.officers[240].soldiers=700; state.officers[240].hp=90; state.officers[40].soldiers=700; }
  assert.ok(autoSkillBonus(old,[240],[40],100,0,3000)>autoSkillBonus(g,[240],[40],100,0,3000));
  assert.equal(famousLabel(D,g,241),'守城谋士'); assert.equal(famousLabel(D,old,241),null);
  assert.ok(newField.siege);
});

test('所有内置专属持有人有可解释的标注，克隆和同名伪造不能获得技能',()=>{
  const g=game(); let strategies=0,duels=0;
  for(const o of D.officers) {
    const ids=abilityStrategyIds(D,g,o.id), skill=abilityDuel(D,g,o.id);
    if(ids.length || skill) assert.ok(famousLabel(D,g,o.id),o.name);
    strategies+=ids.length; duels+=skill?1:0;
  }
  assert.equal(strategies,14); assert.equal(duels,14);
  const cloned=structuredClone(D); cloned.officers[218].clone=true; assert.equal(abilityDuel(cloned,g,218),null);
  cloned.officers[218].clone=false; cloned.officers[218].name='其他人'; assert.equal(abilityDuel(cloned,g,218),null);
});

test('自动白兵中发生单挑时也使用当前开局的名单，旧记录保留原招式',()=>{
  const g=game(), old=structuredClone(g); delete old.famousSkills;
  for(const state of [g,old]) for(const id of [255,40]) Object.assign(state.officers[id],{soldiers:0,hp:90});
  const modern=skirmish(g,255,40,2,()=>0), legacy=skirmish(old,255,40,2,()=>0);
  assert.ok(modern.duel && legacy.duel);
  assert.equal(modern.duel.actions.some(a=>a.by===255 && a.cmd==='special'),false);
  assert.equal(legacy.duel.actions.some(a=>a.by===255 && a.name==='淮军奋击'),true);
});

test('新旧战场中断后继续各自技能名称、效果和剩余次数',()=>{
  for(const modern of [true,false]) {
    const g=game(); if(!modern) delete g.famousSkills;
    const w=war(24,40), f=new Field(g,w,'att'), a=f.side('att')[0], d=f.side('def')[0];
    Object.assign(a,{x:3,y:2}); Object.assign(d,{x:4,y:2}); f.pool.att=100; f.turn='att'; f.r=()=>0;
    g.officers[d.id].soldiers=700; const cast=f.cast(a,21,d); assert.equal(cast.hit,true);
    const resumed=Field.restore(structuredClone(g),structuredClone(w),f.snapshot()), caster=resumed.side('att')[0];
    assert.equal(caster.skillUses[21],1);
    assert.equal(resumed.strategies(caster).find(s=>s.id===21).name,modern?'奉孝奇谋':'奉孝奇策');
    assert.equal(resumed.O(d.id).soldiers,620);
  }
});
