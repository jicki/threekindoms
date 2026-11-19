import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { Field } from '../src/core/field.js';
import { battlefieldLayout } from '../src/core/battlefields.js';
import { blockedStrategy, siegeLayout, wallAt } from '../src/core/siege.js';
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
  const g=game(); assert.equal(g.battlefields,2); assert.equal(g.siegeTactics,true); assert.ok(G.upgrade(structuredClone(g)));
  const invalid=structuredClone(g); invalid.siegeTactics=false; assert.equal(G.upgrade(invalid),null);
  const f=new Field(g,war(),'att'); assert.ok(f.siege);
  for (const version of [undefined,1]) {
    const old=structuredClone(g); delete old.siegeTactics; if (version===undefined) delete old.battlefields; else old.battlefields=version;
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
  const g=game(), f=new Field(g,war(),'att'), a=f.side('att')[0], d=f.side('def')[0], {cx,cy,gates,moat,outer:edge,inner:keep}=f.siege;
  Object.assign(a,{x:cx-moat,y:cy}); Object.assign(d,{x:cx,y:cy}); f.units=[a,d];
  const outer=gates.find(p=>p.x===cx-edge&&p.y===cy), inner=gates.find(p=>p.x===cx-keep&&p.y===cy);
  assert.equal(blockedStrategy(f.siege,a,d),true); assert.equal(f.legal(a,0,d),false);
  const cost=f.cost(a,outer.x,outer.y); f.pool.att=100; assert.equal(f.move(a,outer.x,outer.y,cost),true); assert.equal(outer.open,true);
  assert.equal(blockedStrategy(f.siege,a,d),true); f.move(a,inner.x,inner.y,1); assert.equal(inner.open,true);
  assert.equal(blockedStrategy(f.siege,a,d),false);
  const other={x:cx+moat,y:cy}; assert.equal(blockedStrategy(f.siege,other,d),true,'不能从另一侧穿过未突破的城墙');
  assert.equal(blockedStrategy(f.siege,{x:cx-(edge-1),y:cy},{x:cx+(edge-1),y:cy}),true,'不能从同一外城区横穿未突破的内城');
  const restored=Field.restore(g,war(),f.snapshot()); assert.deepEqual(restored.siege.gates,gates);
  const bad=f.snapshot(); bad.siegeGates[0].x=999; assert.throws(()=>Field.restore(g,war(),bad));
});

test('内院扩到九格，驻门守军受闭门保护且普通移动负责突破', () => {
  const g = game(), f = new Field(g, war(), 'att'), [a] = f.side('att'), [d] = f.side('def');
  const { cx, cy, inner, outer, moat, gates } = f.siege;
  assert.deepEqual([inner, outer, moat], [2, 4, 5]);
  for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) {
    assert.ok(f.deployable(x, y), `内院布阵格 ${x},${y}`);
  }
  const gate = gates.find(p => p.x === cx - outer && p.y === cy);
  Object.assign(a, { x: cx - moat, y: cy }); Object.assign(d, { x: gate.x, y: gate.y });
  f.pool.att = 100; f.units = [a, d]; f.O(a.id).int = 99;
  assert.equal(f.legal(a, 0, d), false);
  assert.equal(f.legal(d, 0, a), false, '闭门阻隔适用于双方');
  assert.equal(f.reach(a).dist.has(`${gate.x},${gate.y}`), false, '驻门敌将阻止进入');
  Object.assign(d, { x: cx + 1, y: cy });
  const cost = f.cost(a, gate.x, gate.y);
  assert.equal(f.move(a, gate.x, gate.y, cost), true);
  assert.equal(gate.open, true);
  assert.equal(cost, f.cost(a, gate.x, gate.y) + 2);
  assert.equal(blockedStrategy(f.siege, a, d), true, '内城仍封闭');
});

test('旧版中断在原坐标恢复，再次中断也保留城门、站位及布局标记', () => {
  const g = game(), w = war(), f = new Field(g, w, 'att');
  const layout = battlefieldLayout(expanded, g, w.city, w.from);
  const old = siegeLayout(layout.map, layout.dep, layout.villages, layout.direction, false, 1);
  const snapshot = f.snapshot();
  delete snapshot.siegeRevision;
  old.siege.gates[0].open = true;
  snapshot.siegeGates = old.siege.gates;
  const unit = snapshot.units.find(u => u.side === 'att');
  Object.assign(unit, { x: old.siege.gates[0].x, y: old.siege.gates[0].y });
  const resumed = Field.restore(g, w, snapshot);
  assert.equal(resumed.siege.revision, 1);
  assert.deepEqual(resumed.siege.gates, old.siege.gates);
  assert.deepEqual(resumed.map, old.map);
  assert.deepEqual(resumed.units, snapshot.units);
  assert.deepEqual(Field.restore(g, w, resumed.snapshot()).siege, resumed.siege);
  assert.throws(() => Field.restore(g, w, { ...snapshot, siegeRevision: 99 }));
});

test('斜向计策阻隔与施放方向无关，门、墙和拐角均遵循同一规则',()=>{
  const f=new Field(game(),war(),'att'), s=f.siege, {cx,cy}=s;
  const a={x:cx-2,y:cy-6}, b={x:cx-4,y:cy-2};
  assert.equal(blockedStrategy(s,a,b),blockedStrategy(s,b,a),'此前城墙拐角的斜向判定不一致');
  for(const mask of [0,255,1,2,4,8,16,32,64,128]) {
    s.gates.forEach((gate,i)=>{gate.open=!!(mask & (1<<i));});
    for(let y=cy-6;y<=cy+6;y++) for(let x=cx-6;x<=cx+6;x++) {
      if(!f.inside(x,y) || wallAt(s,x,y)) continue;
      for(let dy=-5;dy<=5;dy++) for(let dx=-5;dx<=5;dx++) {
        const X=x+dx,Y=y+dy; if(!f.inside(X,Y)||wallAt(s,X,Y)) continue;
        assert.equal(blockedStrategy(s,{x,y},{x:X,y:Y}),blockedStrategy(s,{x:X,y:Y},{x,y}),`${mask}: ${x},${y} ↔ ${X},${Y}`);
        if(mask===0 || mask===255) assert.equal(blockedStrategy(s,{x,y},{x:X,y:Y}),blockedStrategy(s,{x:2*cx-x,y},{x:2*cx-X,y:Y}),`${mask}: 镜像路径应一致`);
      }
    }
  }
  s.gates.forEach(g=>{g.open=false;});
  const outside={x:cx-s.moat,y:cy}, court={x:cx-s.inner-1,y:cy}, center={x:cx,y:cy};
  const westOuter=s.gates.find(g=>g.x===cx-s.outer&&g.y===cy), westInner=s.gates.find(g=>g.x===cx-s.inner&&g.y===cy);
  assert.equal(blockedStrategy(s,outside,court),true);
  westOuter.open=true; assert.equal(blockedStrategy(s,outside,court),false);
  assert.equal(blockedStrategy(s,outside,center),true);
  westInner.open=true; assert.equal(blockedStrategy(s,outside,center),false);
  assert.equal(blockedStrategy(s,{x:cx+s.moat,y:cy},center),true,'不能借另一侧的缺口穿墙');
  westOuter.open=false;
  assert.equal(blockedStrategy(s,{x:cx-s.outer,y:cy},court),false,'守军站在封闭门内侧时可向城内施计');
  assert.equal(blockedStrategy(s,outside,{x:cx-s.outer,y:cy}),true,'城外不能隔着封闭城门施计');
  assert.equal(blockedStrategy(s,{x:cx-s.moat,y:cy-s.outer},{x:cx-s.outer,y:cy-s.moat}),false,'仅擦过墙角时不算穿墙');
});

test('实际战场中双方专属计策对同一斜线路径得到相同阻隔',()=>{
  for(const modern of [true,false]) {
    const g=game(), w=war(); if(!modern) delete g.siegeTactics; w.att.ids=[109]; w.def.ids=[93];
    const field=new Field(g,w,'att'), first=field.side('att')[0], second=field.side('def')[0];
    Object.assign(first,{x:13,y:3}); Object.assign(second,{x:11,y:7});
    const f=Field.restore(g,w,field.snapshot()), a=f.side('att')[0], d=f.side('def')[0];
    assert.equal(f.dist(a,d),4); assert.ok(f.strategies(a).some(s=>s.id===16)); assert.ok(f.strategies(d).some(s=>s.id===17));
    assert.equal(f.legal(a,16,d),f.legal(d,17,a),'新局和已有多层攻城记录恢复后都修复阻隔');
  }
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
  const g=game(), f=new Field(g,war(),'att'), a=f.side('att')[0], [d,guard]=f.side('def'), {cx,cy,inner}=f.siege;
  Object.assign(a,{x:cx+inner+1,y:cy-1}); Object.assign(d,{x:cx+inner+1,y:cy}); Object.assign(guard,{x:cx+inner,y:cy});
  f.units=[a,d,guard]; f.r=()=>0; f.pool.att=100; f.O(d.id).soldiers=700; f.O(guard.id).soldiers=700;
  assert.equal(f.legal(a,14,d),true); const result=f.cast(a,14,d,true);
  assert.equal(result.hit,true); assert.ok(f.O(d.id).soldiers<700); assert.equal(f.O(guard.id).soldiers,700);
});

test('新攻城电脑会保护孤立主将并推动优势兵力，旧存档保持原决策',()=>{
  const make=(modern)=>{
    const g=game(), w=war(); if(!modern) delete g.siegeTactics;
    const f=new Field(g,w,null), [a,ally,guard]=f.side('att'), [d]=f.side('def');
    Object.assign(a,{x:3,y:3,role:0,commander:true}); Object.assign(ally,{x:1,y:2,role:1});
    Object.assign(guard,{x:1,y:4,role:4}); Object.assign(d,{x:4,y:3});
    f.units=[a,ally,guard,d]; f.turn='att'; f.pool.att=50;
    for(const u of f.units) Object.assign(g.officers[u.id],{soldiers:700,hp:90,war:70,int:30,loyalty:100});
    return {f,a,ally,guard,d};
  };
  const modern=make(true), action=modern.f.aiDecide(modern.a);
  assert.equal(action?.type,'move','孤立主将应脱离同等兵力的贴身敌军');
  assert.equal(modern.f.adjacentEnemies(modern.a).length,0);
  assert.equal(modern.f.aiDecide(modern.a),null,'同一日不立即折返');
  const restored=Field.restore(structuredClone(modern.f.g),structuredClone(modern.f.war),modern.f.snapshot());
  assert.equal(restored.units.find(u=>u.id===modern.a.id).siegeCautionDay,modern.f.day,'中断后维持本日谨慎状态');
  const old=make(false); assert.equal(old.f.aiDecide(old.a)?.type,'attack','旧记录保留原决策');
  assert.ok(G.upgrade(structuredClone(old.f.g)),'旧多层攻城存档没有新标记仍可读取');
  const advance=make(true); Object.assign(advance.a,{x:2,y:2}); Object.assign(advance.ally,{x:6,y:3});
  Object.assign(advance.guard,{x:4,y:3}); Object.assign(advance.d,{x:14,y:9});
  const before=Math.abs(advance.guard.x-advance.f.siege.cx)+Math.abs(advance.guard.y-advance.f.siege.cy);
  const step=advance.f.aiDecide(advance.guard);
  assert.equal(step?.type,'move');
  assert.ok(Math.abs(advance.guard.x-advance.f.siege.cx)+Math.abs(advance.guard.y-advance.f.siege.cy)<before,'优势兵力的支援部队应朝城池推进');
  const threatened=make(true); Object.assign(threatened.a,{x:2,y:2}); Object.assign(threatened.guard,{x:4,y:3});
  Object.assign(threatened.ally,{x:6,y:3}); Object.assign(threatened.d,{x:2,y:5});
  const threatBefore=Math.abs(threatened.guard.x-threatened.d.x)+Math.abs(threatened.guard.y-threatened.d.y);
  const holding=threatened.f.aiDecide(threatened.guard);
  assert.ok(!holding || holding.type!=='move' || Math.abs(threatened.guard.x-threatened.d.x)+Math.abs(threatened.guard.y-threatened.d.y)<threatBefore,'主将受威胁时后援可迎敌，但不应忽视威胁继续攻城');
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
    const f=new Field(g,war(city,from),'att'), outside=(x,y)=>Math.max(Math.abs(x-f.siege.cx),Math.abs(y-f.siege.cy))>f.siege.moat;
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

test('相同城防和种子下，兵力占优的两类电脑攻城优于旧决策', {timeout:120000}, ()=>{
  for(const faction of [0,7]) {
    const wins={old:0,modern:0}; let count=0;
    for(const city of expanded.cities.slice(30)) for(const from of city.roads) for(let seed=0;seed<4;seed++) {
      for(const modern of [false,true]) {
        const g=game(400+seed), w=war(city.id,from); if(!modern) delete g.siegeTactics;
        w.attacker=faction; w.att.ids.push(46,47,48); w.att.rice=w.def.rice=9999;
        for(const id of [...w.att.ids,...w.def.ids]) Object.assign(g.officers[id],{soldiers:700,hp:90,loyalty:100,war:70,int:60,level:3});
        const f=new Field(g,w,null); let contact=false;
        for(let t=0;!f.over&&t<65;t++){for(const act of f.aiActions(f.turn)) if(act.type==='attack') contact=true; f.endTurn();}
        assert.ok(f.over && contact,`${city.name}来自${from}的战斗需接敌并结束`);
        if(f.over.loser==='def') wins[modern?'modern':'old']++;
      }
      count++;
    }
    assert.ok(wins.modern>wins.old,`势力配置${faction}新旧胜场：${JSON.stringify(wins)}`);
    assert.ok(wins.modern<count,`势力配置${faction}守方仍需有获胜机会`);
  }
});
