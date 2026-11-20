// 第二版战场的城防是规则数据，绘制与存档都从同一布局读取。
import { fortressPlan } from './fortress-plans.js';

const W = 32, H = 19, FOREST = 0, SAND = 1, PLAIN = 2, RIVER = 3, MOUNT = 4, CASTLE = 5;
const RECTS = { n: [10,21,0,2], s: [10,21,16,18], w: [0,3,6,12], e: [28,31,6,12] };
const ENTRY = { n: [15,1], s: [15,17], w: [1,9], e: [30,9] };
const NORMALS = { n: [0,-1], s: [0,1], w: [-1,0], e: [1,0] };
const SIEGE_REVISION = 2;
const key = (x,y) => `${x},${y}`;
const cells = (rect, x, y) => {
  const out = []; for (let yy=rect[2]; yy<=rect[3]; yy++) for (let xx=rect[0]; xx<=rect[1]; xx++) out.push([xx,yy]);
  return out.sort((a,b) => Math.abs(a[0]-x)+Math.abs(a[1]-y)-Math.abs(b[0]-x)-Math.abs(b[1]-y) || a[1]-b[1] || a[0]-b[0]);
};
export function siegeLayout(map, dep, villages, direction, connectRiver = false, revision = SIEGE_REVISION, profile = null) {
  if (![1, 2, 3, 4].includes(revision) || (revision === 4 && !profile)) throw new Error('无效的城防布局版本');
  if (revision === 4) return cityFortress(map, dep, villages, direction, connectRiver, profile);
  const wide = revision >= 2, pass = revision === 3 && profile?.kind === 'pass';
  const port = revision === 3 && ['水乡', '海滨'].includes(profile?.region);
  const inner = wide ? 2 : 1, outer = wide && !pass ? 4 : 3, moat = outer + 1;
  map = structuredClone(map); villages = structuredClone(villages);
  const [ox,oy] = dep.defender[0], cx = Math.max(9,Math.min(22,ox));
  // 南北留三排部署区，旧中断战斗沿用保存时对应的城心。
  const cy = wide ? Math.max(8,Math.min(10,oy)) : Math.max(7,Math.min(11,oy));
  const [ax,ay] = dep.attacker[0], dx=ax-ox, dy=ay-oy;
  direction ||= Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'w' : 'e') : (dy < 0 ? 'n' : 's');
  const horizontal = direction === 'w' || direction === 'e';
  const passage = (x, y) => pass ? (horizontal ? y === cy : x === cx) : x === cx || y === cy;
  const water = (x, y) => !port || (horizontal ? y <= cy : x <= cx);
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) if (map[y][x] === CASTLE) map[y][x] = PLAIN;
  const walls=[], gates=[];
  const ring = (x, y) => Math.max(Math.abs(x-cx),Math.abs(y-cy));
  for (let y=cy-moat;y<=cy+moat;y++) for (let x=cx-moat;x<=cx+moat;x++) {
    const r=ring(x,y);
    if (r===moat) map[y][x] = passage(x,y) ? PLAIN : pass ? MOUNT : water(x,y) ? RIVER : FOREST;
    else {
      map[y][x] = PLAIN;
      if (r===outer || r===inner) {
        if (passage(x,y)) gates.push({ x,y,ring:r,open:false });
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
  if (pass) {
    // 留出边路供前后队列错开，进入关门时才收束为单格。
    const step = horizontal ? Math.sign(cx - ex) : Math.sign(cy - ey);
    for (let along = horizontal ? ex : ey; Math.abs(along - (horizontal ? cx : cy)) > moat; along += step) {
      for (let across = -1; across <= 1; across++) {
        const [x, y] = horizontal ? [along, cy + across] : [cx + across, along];
        map[y][x] = PLAIN;
      }
    }
  }
  const available=cells(defender_rect,cx,cy).filter(([x,y]) => !walls.some(w => w.x===x && w.y===y));
  // 分散守军阵位，让城内可展开驻防。旧布局保留此前的顺序。
  const courtyard = wide ? available.filter(([x,y]) => ring(x,y) < inner) : [];
  const defender = (wide ? [...courtyard.slice(0,4), ...available.filter(([x,y]) => ring(x,y) > inner),
    ...courtyard.slice(4), ...available.filter(([x,y]) => ring(x,y) === inner)] : available).slice(0,16);
  for (const [x,y] of attacker) map[y][x]=PLAIN;
  // 天然河道被新城防截断时绕过城墙，护城河四座桥仍保持可通行。
  if (connectRiver) connectOuterRiver(map, villages, reserved, (x,y) => ring(x,y)>moat);
  return { map,villages,dep:{attacker,attacker_rect:[...attacker_rect],defender,defender_rect},
    siege:{cx,cy,walls,gates,direction,inner,outer,moat,revision,...(revision === 3 ? { type: pass ? 'pass' : port ? 'port' : 'city' } : {})} };
}

function connectOuterRiver(map, villages, reserved, outside) {
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
const inRect = (x, y, [x0, x1, y0, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
function cityFortress(map, dep, villages, direction, connectRiver, profile) {
  const plan = fortressPlan(profile.id), pass = profile.kind === 'pass';
  const [ox, oy] = dep.defender[0], [ax, ay] = dep.attacker[0], dx = ax - ox, dy = ay - oy;
  direction ??= Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'w' : 'e') : (dy < 0 ? 'n' : 's');
  const cx = Math.max(10, Math.min(21, ox)), cy = Math.max(8, Math.min(10, oy));
  const [rx, ry] = plan.outer, [ix, iy] = plan.inner;
  const inner = 2, outer = 4, walls = [], gates = [], crossings = [], paving = new Map();
  const bounds = { inner: [ix, iy], outer: [rx, ry], moat: [rx + 1, ry + 1] };
  const faces = pass ? (NORMALS[direction][0] ? ['w', 'e'] : ['n', 's']) : Object.keys(NORMALS);
  for (const face of faces) {
    const [nx, ny] = NORMALS[face], offset = plan.offsets[face] ?? 0;
    // 两道墙相邻时门轴相接，避免内门迎面就是外墙。
    const innerOffset = (nx ? rx - ix : ry - iy) === 1 ? offset : 0;
    gates.push({ x: cx + nx * ix + ny * innerOffset, y: cy + ny * iy + nx * innerOffset, face, ring: inner, open: false });
    const gate = { x: cx + nx * rx + ny * offset, y: cy + ny * ry + nx * offset, face, ring: outer, open: false };
    gates.push(gate);
    crossings.push({ x: gate.x + nx, y: gate.y + ny, face });
  }
  const gateCells = new Set(gates.map(g => key(g.x, g.y))), crossingCells = new Set(crossings.map(c => key(c.x,c.y)));
  const [mx, my] = bounds.moat;
  const outside = (x, y) => Math.abs(x - cx) > mx || Math.abs(y - cy) > my;
  const [wx, wy] = NORMALS[plan.bank] ?? [0, 0];
  map = map.map(row => row.map(t => t === CASTLE ? PLAIN : t));
  for (let y = cy - my; y <= cy + my; y++) for (let x = cx - mx; x <= cx + mx; x++) {
    const a = Math.abs(x - cx), b = Math.abs(y - cy);
    if (a === mx || b === my) {
      const bank = (x - cx) * wx + (y - cy) * wy >= 0;
      map[y][x] = crossingCells.has(key(x,y)) ? PLAIN : plan.moat === 'full' || (plan.moat === 'bank' && bank) ? RIVER
        : plan.moat === 'rock' ? MOUNT : plan.moat === 'dry' ? SAND : FOREST;
      continue;
    }
    map[y][x] = PLAIN;
    const isOuter = a === rx || b === ry;
    if (!isOuter && !(a <= ix && b <= iy && (a === ix || b === iy))) continue;
    const [w, h] = isOuter ? bounds.outer : bounds.inner;
    if (!gateCells.has(key(x, y))) walls.push({ x, y, ring: isOuter ? outer : inner, corner: a === w && b === h,
      face: a === w ? (x < cx ? 'w' : 'e') : (y < cy ? 'n' : 's') });
  }
  const wallCells = new Set(walls.map(w => key(w.x,w.y)));
  const forward = gates.find(g => g.face === direction && g.ring === outer);
  const forwardCrossing = crossings.find(c => c.face === direction);
  const [nx, ny] = NORMALS[direction];
  const attacker_rect = [...RECTS[direction]];
  // 南北阵地退到护城河外。保留足够的横宽，十将仍可分两排布阵。
  if (ny) {
    attacker_rect[0] = Math.max(0, forward.x - 5);
    attacker_rect[1] = attacker_rect[0] + 11;
    if (ny < 0) attacker_rect[3] = Math.min(attacker_rect[3], cy - my - 1);
    else attacker_rect[2] = Math.max(attacker_rect[2], cy + my + 1);
  } else {
    attacker_rect[2] = forward.y - 3;
    attacker_rect[3] = forward.y + 3;
  }
  const anchorX = nx ? ENTRY[direction][0] : forward.x;
  const anchorY = ny ? Math.max(attacker_rect[2], Math.min(attacker_rect[3], ENTRY[direction][1])) : forward.y;
  const attacking = cells(attacker_rect, anchorX, anchorY);
  for (const [x,y] of attacking) map[y][x] = PLAIN;
  // 门桥至起始阵地留三格路面，队伍能在外侧换列。
  for (let x = forwardCrossing.x + nx, y = forwardCrossing.y + ny; !inRect(x,y,attacker_rect); x += nx, y += ny) {
    for (const side of [-1, 0, 1]) map[y + nx * side][x + ny * side] = PLAIN;
  }
  for (const gate of gates) {
    const [gx, gy] = NORMALS[gate.face];
    for (let x = gate.x, y = gate.y; !wallCells.has(key(x,y)) && (x - cx) * gx + (y - cy) * gy > 0; x -= gx, y -= gy) {
      paving.set(key(x,y), { x, y, face: gate.face });
    }
  }
  const defender_rect = [cx - rx, cx + rx, cy - ry, cy + ry];
  const available = cells(defender_rect, cx, cy).filter(([x,y]) => !wallCells.has(key(x,y)) && !gateCells.has(key(x,y)));
  const insideKeep = ([x,y]) => Math.abs(x - cx) < ix && Math.abs(y - cy) < iy;
  const courtyard = available.filter(insideKeep);
  const outerYard = available.filter(p => !insideKeep(p)).sort((a,b) =>
    Math.abs(a[0] - forward.x) + Math.abs(a[1] - forward.y) - Math.abs(b[0] - forward.x) - Math.abs(b[1] - forward.y));
  const reserve = ix + iy > 4 ? 3 : 2;
  const spare = gates.filter(g => g.ring === inner).map(g => [g.x,g.y]);
  const defender = [...courtyard.slice(0,reserve), ...outerYard.slice(0,4), ...courtyard.slice(reserve), ...outerYard.slice(4), ...spare].slice(0,16);
  const reserved = (x,y) => inRect(x,y,attacker_rect) || Object.values(RECTS).some(rect => inRect(x,y,rect));
  const used = new Set();
  villages = villages.map(v => {
    const fits = (x,y) => outside(x,y) && !reserved(x,y) && !used.has(key(x,y));
    const [x,y] = fits(v.x,v.y) ? [v.x,v.y] : cells([0,W-1,0,H-1],v.x,v.y).find(([a,b]) => fits(a,b));
    used.add(key(x,y));
    map[y][x] = PLAIN;
    return { ...v, x, y };
  });
  map[cy][cx] = CASTLE;
  if (connectRiver) connectOuterRiver(map,villages,reserved,outside);
  const siege = { cx, cy, walls, gates, direction, inner, outer, bounds, type: pass ? 'pass' : plan.moat === 'bank' ? 'port' : 'city',
    style: plan.style, crossings, paving: [...paving.values()], revision: 4 };
  return { map, villages, siege, dep: { attacker: attacking.slice(0,17), attacker_rect, defender, defender_rect } };
}

export const wallAt = (siege,x,y) => siege?.walls.some(w => w.x===x && w.y===y) ?? false;
export const gateAt = (siege,x,y) => siege?.gates.find(g => g.x===x && g.y===y);
export const siegeRing = ({ cx, cy, bounds, outer }, { x, y }) => bounds
  ? outer * Math.max(Math.abs(x - cx) / bounds.outer[0], Math.abs(y - cy) / bounds.outer[1])
  : Math.max(Math.abs(x - cx), Math.abs(y - cy));
export const gateNormal = (siege, gate) => NORMALS[gate.face] ?? [Math.sign(gate.x - siege.cx), Math.sign(gate.y - siege.cy)];
export const siegeExtent = (siege, layer) => siege.bounds?.[layer] ?? [siege[layer], siege[layer]];

// 只有门楼和紧邻门楼的格子能迎击正对门口的敌军。
export function gateDefense(siege, from, target) {
  if (!target) return null;
  return siege.gates.find(gate => {
    if (gate.open) return false;
    const [dx, dy] = gateNormal(siege, gate);
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
    const [nx, ny] = gateNormal(siege,gate), vertical=nx!==0, delta=vertical?dx:dy;
    if (delta===0) return false;
    const face=vertical ? gate.x + nx * 0.5 : gate.y + ny * 0.5, start=vertical?a.x:a.y;
    const t=(face-start)/delta;
    if (t<=eps || t>=1-eps) return false;
    const across=(vertical?a.y:a.x)+t*(vertical?dy:dx), gateAcross=vertical?gate.y:gate.x;
    return Math.abs(across-gateAcross)<=0.5+eps;
  });
}
export function restoreGates(siege, saved) {
  if (!Array.isArray(saved) || saved.length !== siege.gates.length) return false;
  if (!siege.gates.every((g,i) => saved[i]?.x===g.x && saved[i]?.y===g.y && saved[i]?.ring===g.ring
      && (siege.revision < 4 || saved[i]?.face===g.face) && typeof saved[i]?.open==='boolean')) return false;
  siege.gates.forEach((g,i) => { g.open=saved[i].open; }); return true;
}
