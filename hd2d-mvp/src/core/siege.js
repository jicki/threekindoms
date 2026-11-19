// 第二版战场的城防是规则数据，绘制与存档都从同一布局读取。
const W = 32, H = 19, PLAIN = 2, RIVER = 3, CASTLE = 5;
const RECTS = { n: [10,21,0,2], s: [10,21,16,18], w: [0,3,6,12], e: [28,31,6,12] };
const ENTRY = { n: [15,1], s: [15,17], w: [1,9], e: [30,9] };
const key = (x,y) => `${x},${y}`;
const cells = (rect, x, y) => {
  const out = []; for (let yy=rect[2]; yy<=rect[3]; yy++) for (let xx=rect[0]; xx<=rect[1]; xx++) out.push([xx,yy]);
  return out.sort((a,b) => Math.abs(a[0]-x)+Math.abs(a[1]-y)-Math.abs(b[0]-x)-Math.abs(b[1]-y) || a[1]-b[1] || a[0]-b[0]);
};
export function siegeLayout(map, dep, villages, direction, connectRiver = false) {
  map = structuredClone(map); villages = structuredClone(villages);
  const [ox,oy] = dep.defender[0], cx = Math.max(9,Math.min(22,ox)), cy = Math.max(7,Math.min(11,oy));
  const [ax,ay] = dep.attacker[0], dx=ax-ox, dy=ay-oy;
  direction ||= Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'w' : 'e') : (dy < 0 ? 'n' : 's');
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) if (map[y][x] === CASTLE) map[y][x] = PLAIN;
  const walls=[], gates=[];
  for (let y=cy-4;y<=cy+4;y++) for (let x=cx-4;x<=cx+4;x++) {
    const r=Math.max(Math.abs(x-cx),Math.abs(y-cy));
    if (r===4) map[y][x] = (x===cx || y===cy) ? PLAIN : RIVER;
    else if (r<=3) {
      map[y][x] = PLAIN;
      if (r===3 || r===1) {
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
    for (let y=0;y<H;y++) for (let x=0;x<W;x++) if (Math.max(Math.abs(x-cx),Math.abs(y-cy))>4 && !reserved(x,y) && !used.has(key(x,y))) options.push([x,y]);
    options.sort((a,b) => Math.abs(a[0]-v.x)+Math.abs(a[1]-v.y)-Math.abs(b[0]-v.x)-Math.abs(b[1]-v.y));
    if (Math.max(Math.abs(v.x-cx),Math.abs(v.y-cy))<=4 || reserved(v.x,v.y) || used.has(key(v.x,v.y))) [v.x,v.y]=options[0];
    used.add(key(v.x,v.y)); map[v.y][v.x]=PLAIN;
  }
  const attacker_rect=RECTS[direction], [ex,ey]=ENTRY[direction], defender_rect=[cx-2,cx+2,cy-2,cy+2];
  const attacker=cells(attacker_rect,ex,ey).slice(0,17);
  const defender=cells(defender_rect,cx,cy).filter(([x,y]) => !walls.some(w => w.x===x && w.y===y)).slice(0,16);
  for (const [x,y] of attacker) map[y][x]=PLAIN;
  // 天然河道被新城防截断时绕过城墙，护城河四座桥仍保持可通行。
  if (connectRiver) {
    const outside=(x,y) => Math.max(Math.abs(x-cx),Math.abs(y-cy))>4;
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
  return { map,villages,dep:{attacker,attacker_rect:[...attacker_rect],defender,defender_rect}, siege:{cx,cy,walls,gates,direction} };
}
export const wallAt = (siege,x,y) => siege?.walls.some(w => w.x===x && w.y===y) ?? false;
export const gateAt = (siege,x,y) => siege?.gates.find(g => g.x===x && g.y===y);
export function blockedStrategy(siege, a, b) {
  if (!siege || !a || !b) return false;
  const radius = (u) => Math.max(Math.abs(u.x-siege.cx),Math.abs(u.y-siege.cy));
  const points=[]; let x=a.x,y=a.y;
  const dx=Math.abs(b.x-x),dy=Math.abs(b.y-y),sx=x<b.x?1:-1,sy=y<b.y?1:-1; let err=dx-dy;
  for (;;) { points.push({x,y}); if (x===b.x && y===b.y) break; const twice=2*err; if (twice>-dy) { err-=dy; x+=sx; } if (twice<dx) { err+=dx; y+=sy; } }
  return [1,3].some(ring => points.some((p,i) => {
    if (!i || (radius(points[i-1])<=ring)===(radius(p)<=ring)) return false;
    const onWall=radius(p)===ring ? p : points[i-1];
    return !siege.gates.some(g => g.ring===ring && g.x===onWall.x && g.y===onWall.y && g.open);
  }));
}
export function restoreGates(siege, saved) {
  if (!Array.isArray(saved) || saved.length !== siege.gates.length) return false;
  if (!siege.gates.every((g,i) => saved[i]?.x===g.x && saved[i]?.y===g.y && saved[i]?.ring===g.ring && typeof saved[i]?.open==='boolean')) return false;
  siege.gates.forEach((g,i) => { g.open=saved[i].open; }); return true;
}
