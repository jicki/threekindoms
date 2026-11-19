// 第二版战场的城防是规则数据，绘制与存档都从同一布局读取。
const W = 32, H = 19, PLAIN = 2, RIVER = 3, CASTLE = 5;
const RECTS = { n: [10,21,0,2], s: [10,21,16,18], w: [0,3,6,12], e: [28,31,6,12] };
const ENTRY = { n: [15,1], s: [15,17], w: [1,9], e: [30,9] };
const SIEGE_REVISION = 2;
const key = (x,y) => `${x},${y}`;
const cells = (rect, x, y) => {
  const out = []; for (let yy=rect[2]; yy<=rect[3]; yy++) for (let xx=rect[0]; xx<=rect[1]; xx++) out.push([xx,yy]);
  return out.sort((a,b) => Math.abs(a[0]-x)+Math.abs(a[1]-y)-Math.abs(b[0]-x)-Math.abs(b[1]-y) || a[1]-b[1] || a[0]-b[0]);
};
export function siegeLayout(map, dep, villages, direction, connectRiver = false, revision = SIEGE_REVISION) {
  if (revision !== 1 && revision !== SIEGE_REVISION) throw new Error('无效的城防布局版本');
  const wide = revision === SIEGE_REVISION;
  const inner = wide ? 2 : 1, outer = wide ? 4 : 3, moat = outer + 1;
  map = structuredClone(map); villages = structuredClone(villages);
  const [ox,oy] = dep.defender[0], cx = Math.max(9,Math.min(22,ox));
  // 南北留三排部署区，旧中断战斗沿用保存时对应的城心。
  const cy = wide ? Math.max(8,Math.min(10,oy)) : Math.max(7,Math.min(11,oy));
  const [ax,ay] = dep.attacker[0], dx=ax-ox, dy=ay-oy;
  direction ||= Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'w' : 'e') : (dy < 0 ? 'n' : 's');
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) if (map[y][x] === CASTLE) map[y][x] = PLAIN;
  const walls=[], gates=[];
  const ring = (x, y) => Math.max(Math.abs(x-cx),Math.abs(y-cy));
  for (let y=cy-moat;y<=cy+moat;y++) for (let x=cx-moat;x<=cx+moat;x++) {
    const r=ring(x,y);
    if (r===moat) map[y][x] = (x===cx || y===cy) ? PLAIN : RIVER;
    else {
      map[y][x] = PLAIN;
      if (r===outer || r===inner) {
        if (x===cx || y===cy) gates.push({ x,y,ring:r,open:false });
        else walls.push({ x,y,ring:r });
      }
    }
  }
  map[cy][cx]=CASTLE;
  const reserved = (x,y) => Object.values(RECTS).some(([x0,x1,y0,y1]) => x>=x0 && x<=x1 && y>=y0 && y<=y1);
  const used = new Set();
  for (const v of villages) {
    const options=[];
    for (let y=0;y<H;y++) for (let x=0;x<W;x++) if (ring(x,y)>moat && !reserved(x,y) && !used.has(key(x,y))) options.push([x,y]);
    options.sort((a,b) => Math.abs(a[0]-v.x)+Math.abs(a[1]-v.y)-Math.abs(b[0]-v.x)-Math.abs(b[1]-v.y));
    if (ring(v.x,v.y)<=moat || reserved(v.x,v.y) || used.has(key(v.x,v.y))) [v.x,v.y]=options[0];
    used.add(key(v.x,v.y)); map[v.y][v.x]=PLAIN;
  }
  const edge = outer - 1;
  const attacker_rect=RECTS[direction], [ex,ey]=ENTRY[direction], defender_rect=[cx-edge,cx+edge,cy-edge,cy+edge];
  const attacker=cells(attacker_rect,ex,ey).slice(0,17);
  const available=cells(defender_rect,cx,cy).filter(([x,y]) => !walls.some(w => w.x===x && w.y===y));
  // 分散守军阵位，让城内可展开驻防。旧布局保留此前的顺序。
  const courtyard = wide ? available.filter(([x,y]) => ring(x,y) < inner) : [];
  const defender = (wide ? [...courtyard.slice(0,4), ...available.filter(([x,y]) => ring(x,y) > inner),
    ...courtyard.slice(4), ...available.filter(([x,y]) => ring(x,y) === inner)] : available).slice(0,16);
  for (const [x,y] of attacker) map[y][x]=PLAIN;
  // 天然河道被新城防截断时绕过城墙，护城河四座桥仍保持可通行。
  if (connectRiver) {
    const outside=(x,y) => ring(x,y)>moat;
    const neighbours=(x,y) => [[x-1,y],[x+1,y],[x,y-1],[x,y+1]].filter(([a,b]) => a>=0 && a<W && b>=0 && b<H && outside(a,b));
    const forbidden=(x,y) => reserved(x,y) || villages.some(v=>v.x===x && v.y===y);
    for (;;) {
      const water=[]; for(let y=0;y<H;y++) for(let x=0;x<W;x++) if(outside(x,y) && map[y][x]===RIVER) water.push([x,y]);
      if (!water.length) break;
      const seen=new Set([key(...water[0])]), queue=[water[0]];
      for(let i=0;i<queue.length;i++) for(const [x,y] of neighbours(...queue[i])) if(map[y][x]===RIVER && !seen.has(key(x,y))) { seen.add(key(x,y)); queue.push([x,y]); }
      if(water.every(([x,y])=>seen.has(key(x,y)))) break;
      const search=[...queue], prev=new Map(search.map(([x,y])=>[key(x,y),null])); let end=null;
      for(let i=0;i<search.length && !end;i++) for(const [x,y] of neighbours(...search[i])) {
        const k=key(x,y); if(prev.has(k) || forbidden(x,y)) continue; prev.set(k,key(...search[i]));
        if(map[y][x]===RIVER && !seen.has(k)) {end=k;break;} search.push([x,y]);
      }
      if(!end) break;
      for(let k=end;k;k=prev.get(k)) {const [x,y]=k.split(',').map(Number);map[y][x]=RIVER;}
    }
  }
  return { map,villages,dep:{attacker,attacker_rect:[...attacker_rect],defender,defender_rect},
    siege:{cx,cy,walls,gates,direction,inner,outer,moat,revision} };
}
export const wallAt = (siege,x,y) => siege?.walls.some(w => w.x===x && w.y===y) ?? false;
export const gateAt = (siege,x,y) => siege?.gates.find(g => g.x===x && g.y===y);
export const siegeRing = ({ cx, cy }, { x, y }) => Math.max(Math.abs(x - cx), Math.abs(y - cy));

// 只有门楼和紧邻门楼的格子能迎击正对门口的敌军。
export function gateDefense(siege, from, target) {
  if (!target) return null;
  return siege.gates.find(gate => {
    if (gate.open) return false;
    const dx = Math.sign(gate.x - siege.cx), dy = Math.sign(gate.y - siege.cy);
    const forward = (point) => (point.x - gate.x) * dx + (point.y - gate.y) * dy;
    const aligned = (point) => (point.x - gate.x) * dy === (point.y - gate.y) * dx;
    const a = forward(from), b = forward(target);
    return aligned(from) && aligned(target) && a >= -1 && a <= 0 && b > 0 && b - a <= 2;
  });
}
export function blockedStrategy(siege, a, b) {
  if (!siege || !a || !b) return false;
  const dx=b.x-a.x, dy=b.y-a.y, eps=1e-9;
  // 连线穿过墙格内部才阻隔；仅擦过边或角不算穿墙。线段裁剪对两个方向完全相同。
  const crossesWall = (wall) => {
    let lo=0, hi=1;
    for (const [start, delta, center] of [[a.x,dx,wall.x],[a.y,dy,wall.y]]) {
      const min=center-0.5, max=center+0.5;
      if (delta===0) { if (start<=min || start>=max) return false; continue; }
      const t1=(min-start)/delta, t2=(max-start)/delta;
      lo=Math.max(lo,Math.min(t1,t2)); hi=Math.min(hi,Math.max(t1,t2));
      if (hi-lo<=eps) return false;
    }
    return hi>eps && lo<1-eps;
  };
  if (siege.walls.some(crossesWall)) return true;
  // 门的外侧边界才是闭门屏障；守军站在门格仍可向城内施策。
  return siege.gates.some(gate => {
    if (gate.open) return false;
    const vertical=gate.x!==siege.cx, delta=vertical?dx:dy;
    if (delta===0) return false;
    const center=vertical?gate.x:gate.y, cityCenter=vertical?siege.cx:siege.cy;
    const face=center+(center<cityCenter?-0.5:0.5), start=vertical?a.x:a.y;
    const t=(face-start)/delta;
    if (t<=eps || t>=1-eps) return false;
    const across=(vertical?a.y:a.x)+t*(vertical?dy:dx), gateAcross=vertical?gate.y:gate.x;
    return Math.abs(across-gateAcross)<=0.5+eps;
  });
}
export function restoreGates(siege, saved) {
  if (!Array.isArray(saved) || saved.length !== siege.gates.length) return false;
  if (!siege.gates.every((g,i) => saved[i]?.x===g.x && saved[i]?.y===g.y && saved[i]?.ring===g.ring && typeof saved[i]?.open==='boolean')) return false;
  siege.gates.forEach((g,i) => { g.open=saved[i].open; }); return true;
}
