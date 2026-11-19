import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { Field } from '../src/core/field.js';
import { battlefieldLayout } from '../src/core/battlefields.js';
import { blockedStrategy } from '../src/core/siege.js';
import { applyScenario } from '../src/core/scenario.js';
import { loadScenario } from '../src/core/scenario-store.js';
import { SOVEREIGN_SCENARIO_ID } from '../src/core/visuals.js';
import { EXPANDED_MAP_ID, expandMap } from '../src/core/expanded-map.js';
import { suspend, takeSuspend } from '../src/core/suspend.js';
import { fight } from '../src/core/warcore.js';

const base=JSON.parse(readFileSync(new URL('../data/game-data.json',import.meta.url)));
const expanded=expandMap(applyScenario(base,await loadScenario(SOVEREIGN_SCENARIO_ID,base)));
function game(seed=7) { G.setData(expanded,EXPANDED_MAP_ID); return G.newGame(4,1,seed); }
function war(city=34,from=8) { return {city,from,attacker:0,defender:4,day:1,att:{ids:[40,41,42],gold:100,rice:3000},def:{ids:[43,44,45],gold:100,rice:3000}}; }

test('新开局启用城防，原版及前版存档仍使用原规则',() => {
  const g=game(); assert.equal(g.battlefields,2); assert.ok(G.upgrade(structuredClone(g)));
  const f=new Field(g,war(),'att'); assert.ok(f.siege);
  for (const version of [undefined,1]) {
    const old=structuredClone(g); if (version===undefined) delete old.battlefields; else old.battlefields=version;
    const legacy=new Field(old,war(),'att'); assert.equal(legacy.siege,null);
    assert.deepEqual(Field.restore(old,war(),legacy.snapshot()).map,legacy.map);
  }
  G.setData(structuredClone(base)); assert.equal(G.newGame(4,1,7).battlefields,undefined);
});

test('每个城市和入口布阵无重叠，城墙不可通过，城门可到达且守军可出城',() => {
  for (const city of expanded.cities) for (const from of city.roads) {
    const g=game(), w=war(city.id,from); w.att.ids=Array.from({length:10},(_,i)=>i); w.def.ids=Array.from({length:10},(_,i)=>i+10);
    const f=new Field(g,w,'att'), all=f.units.map(u=>`${u.x},${u.y}`);
    assert.equal(new Set(all).size,20,city.name); assert.ok(f.units.every(u=>f.deployable(u.x,u.y)),city.name);
    assert.equal(f.siege.gates.length,8); assert.ok(f.siege.walls.every(p=>!f.deployable(p.x,p.y)),city.name);
    const a=f.side('att')[0]; f.units=[a]; assert.ok(f.reach(a,500).dist.has(f.castle().join(',')),`${city.name}进攻无法抵城`);
    const d={...a,side:'def',x:f.siege.cx,y:f.siege.cy}; f.units=[d];
    assert.ok(f.reach(d,500).dist.has(f.dep.attacker[0].join(',')),`${city.name}守军无法出城`);
  }
});

test('城门消耗、突破和中断恢复一致，计策只能穿过对应已突破城门',() => {
  const g=game(), f=new Field(g,war(),'att'), a=f.side('att')[0], d=f.side('def')[0], {cx,cy,gates}=f.siege;
  Object.assign(a,{x:cx-4,y:cy}); Object.assign(d,{x:cx,y:cy}); f.units=[a,d];
  const outer=gates.find(p=>p.x===cx-3&&p.y===cy), inner=gates.find(p=>p.x===cx-1&&p.y===cy);
  assert.equal(blockedStrategy(f.siege,a,d),true); assert.equal(f.legal(a,0,d),false);
  const cost=f.cost(a,outer.x,outer.y); f.pool.att=100; assert.equal(f.move(a,outer.x,outer.y,cost),true); assert.equal(outer.open,true);
  assert.equal(blockedStrategy(f.siege,a,d),true); f.move(a,inner.x,inner.y,1); assert.equal(inner.open,true);
  assert.equal(blockedStrategy(f.siege,a,d),false);
  const other={x:cx+4,y:cy}; assert.equal(blockedStrategy(f.siege,other,d),true,'不能从另一侧穿过未突破的城墙');
  assert.equal(blockedStrategy(f.siege,{x:cx-2,y:cy},{x:cx+2,y:cy}),true,'不能从同一外城区横穿未突破的内城');
  const restored=Field.restore(g,war(),f.snapshot()); assert.deepEqual(restored.siege.gates,gates);
  const bad=f.snapshot(); bad.siegeGates[0].x=999; assert.throws(()=>Field.restore(g,war(),bad));
});

test('真实战场中断存取保留城门状态，损坏的城门记录不能恢复',() => {
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage'), store=new Map();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)}});
  try {
    const g=game(), w=war(), f=new Field(g,w,'att'); f.siege.gates[0].open=true;
    assert.equal(suspend(g,w,f,{side:'att',start:{},after:{kind:'att'}}),true);
    const rec=takeSuspend(); assert.ok(rec); assert.deepEqual(Field.restore(rec.g,rec.war,rec.field).siege.gates,f.siege.gates);
    const bad=new Field(g,war(),'att'); bad.siege.gates[0].x=-1;
    assert.equal(suspend(g,war(),bad,{side:'att',start:{},after:{kind:'att'}}),false);
  } finally { if(descriptor) Object.defineProperty(globalThis,'localStorage',descriptor); else delete globalThis.localStorage; }
});

test('范围计策不能通过可命中的城外目标波及城墙后的守军',() => {
  const g=game(), f=new Field(g,war(),'att'), a=f.side('att')[0], [d,guard]=f.side('def'), {cx,cy}=f.siege;
  Object.assign(a,{x:cx+2,y:cy-1}); Object.assign(d,{x:cx+2,y:cy}); Object.assign(guard,{x:cx+1,y:cy});
  f.units=[a,d,guard]; f.r=()=>0; f.pool.att=100; f.O(d.id).soldiers=700; f.O(guard.id).soldiers=700;
  assert.equal(f.legal(a,14,d),true); const result=f.cast(a,14,d,true);
  assert.equal(result.hit,true); assert.ok(f.O(d.id).soldiers<700); assert.equal(f.O(guard.id).soldiers,700);
});

test('电脑自动结算的水域判断读取包含护城河的新地图',() => {
  const g=game(), w=war(32,12); w.attacker=3; w.att.ids.push(46,47,48);
  for(const id of [...w.att.ids,...w.def.ids]) Object.assign(g.officers[id],{soldiers:1000,hp:90});
  assert.equal(fight(g,w).autoRulerBonus?.att,1);
});

test('襄阳和江州新版天然河道四向连通，上一版保持不变',() => {
  for (const [city,from] of [[30,13],[31,26]]) {
    const g=game(), layout=battlefieldLayout(expanded,g,city,from), cells=[];
    for (let y=0;y<19;y++) for (let x=0;x<32;x++) if (layout.map[y][x]===3) cells.push([x,y]);
    const seen=new Set([cells[0].join(',')]), queue=[cells[0]];
    for (let i=0;i<queue.length;i++) for (const [dx,dy] of [[0,1],[0,-1],[1,0],[-1,0]]) { const x=queue[i][0]+dx,y=queue[i][1]+dy,k=`${x},${y}`; if (layout.map[y]?.[x]===3&&!seen.has(k)) {seen.add(k);queue.push([x,y]);} }
    assert.equal(seen.size,cells.length,`${city}河道断开`);
    const f=new Field(g,war(city,from),'att'), outside=(x,y)=>Math.max(Math.abs(x-f.siege.cx),Math.abs(y-f.siege.cy))>4;
    const natural=[]; for(let y=0;y<19;y++) for(let x=0;x<32;x++) if(outside(x,y)&&f.map[y][x]===3) natural.push([x,y]);
    const actualSeen=new Set([natural[0].join(',')]), actualQueue=[natural[0]];
    for(let i=0;i<actualQueue.length;i++) for(const [dx,dy] of [[0,1],[0,-1],[1,0],[-1,0]]) {const x=actualQueue[i][0]+dx,y=actualQueue[i][1]+dy,k=`${x},${y}`;if(f.map[y]?.[x]===3&&outside(x,y)&&!actualSeen.has(k)){actualSeen.add(k);actualQueue.push([x,y]);}}
    assert.equal(actualSeen.size,natural.length,`${city}城防地形截断天然河道`);
    const old=structuredClone(g); old.battlefields=1; assert.notDeepEqual(battlefieldLayout(expanded,old,city,from).map,layout.map);
  }
});

test('各新增据点电脑可接敌并结束，兵力优势可突破城防', {timeout:120000}, () => {
  let wins=0;
  for (const city of expanded.cities.slice(30)) for (const from of city.roads) {
    const g=game(city.id*100+from), w=war(city.id,from); w.att.ids.push(46,47,48);
    for (const id of [...w.att.ids,...w.def.ids]) Object.assign(g.officers[id],{soldiers:700,hp:90,loyalty:100,war:70,int:60,level:3});
    const f=new Field(g,w,null); let attacks=0;
    for (let turn=0;!f.over && turn<65;turn++) { for (const act of f.aiActions(f.turn)) if(act.type==='attack') attacks++; f.endTurn(); }
    assert.ok(f.over,`${city.name}未结束`); assert.ok(attacks || f.over.why==='castle',`${city.name}未接敌`);
    if (f.over.loser==='def') wins++;
  }
  assert.ok(wins>0,'兵力优势应能攻破城防');
});
