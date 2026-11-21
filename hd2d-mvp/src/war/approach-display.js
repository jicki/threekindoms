import * as THREE from 'three';

export const APPROACH_COLORS = { main: '#d5ac72', flank: '#b5aa86', bridge: '#8d6342', post: '#f2c064' };
const ROAD_WIDTH = { main: 0.48, flank: 0.3 };
const CROSSING_COLORS = { bridge: '#9b7350', ford: '#bdac8a', plank: '#79543b' };
const SITE_COLORS = { house: '#573c2c', camp: '#c99052', harbor: '#ac8260', landing: '#f6dca6' };

export function paintRoadSurface(P, G, approaches) {
  if (!approaches) return;
  const { g, x0, y0, px } = P;
  const point = ([x, y]) => [(x - x0 + 0.5) * px, (y - y0 + 0.5) * px];
  const crossing = p => CROSSING_COLORS[approaches.roads.get(p.join(','))?.kind];
  const dirt = P.pattern(G.img['road-earth'] ? 'road-earth' : 'dirt');
  const middle = ([x,y], [nx,ny]) => [(x+nx)/2, (y+ny)/2];
  g.save();
  g.lineCap = g.lineJoin = 'round';
  for (const { cells, kind } of approaches.routes) {
    g.beginPath();
    let start = 0;
    while (start < cells.length) {
      if (crossing(cells[start])) { start++; continue; }
      let end = start + 1;
      while (end < cells.length && !crossing(cells[end])) end++;
      const line = cells.slice(start, end).map(point);
      if (start > 0) line.unshift(middle(point(cells[start - 1]), line[0]));
      if (end < cells.length) line.push(middle(line.at(-1), point(cells[end])));
      g.moveTo(...line[0]);
      for (let i = 1; i < line.length - 1; i++) g.quadraticCurveTo(...line[i], ...middle(line[i], line[i + 1]));
      if (line.length > 1) g.lineTo(...line.at(-1));
      start = end;
    }
    const width = (kind === 'main' ? 0.63 : 0.40) * px;
    g.globalAlpha = 0.31; g.strokeStyle = '#9a8055'; g.lineWidth = width + px * 0.24; g.stroke();
    g.globalAlpha = 0.9; g.strokeStyle = dirt; g.lineWidth = width; g.stroke();
    g.globalAlpha = 0.18; g.strokeStyle = '#ae966e'; g.lineWidth = width * 0.44; g.stroke();
  }
  g.restore();
}

export function paintApproaches(ctx, approaches, cell, { routes = true } = {}) {
  if (!approaches) return;
  ctx.save();
  ctx.scale(cell, cell);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const route of routes ? approaches.routes : []) {
    ctx.beginPath();
    for (const [i, [x, y]] of route.cells.entries()) {
      if (i === 0) ctx.moveTo(x + 0.5, y + 0.5);
      else ctx.lineTo(x + 0.5, y + 0.5);
    }
    ctx.lineWidth = ROAD_WIDTH[route.kind] + 0.13;
    ctx.strokeStyle = '#54412a';
    ctx.stroke();
    ctx.lineWidth = ROAD_WIDTH[route.kind];
    ctx.strokeStyle = APPROACH_COLORS[route.kind];
    ctx.stroke();
  }
  ctx.fillStyle = APPROACH_COLORS.bridge;
  for (const cell of approaches.roads.values()) if (cell.bridge) ctx.fillRect(cell.x + 0.15, cell.y + 0.15, 0.7, 0.7);
  for (const { x, y, face, kind } of approaches.roads.values()) {
    if (!CROSSING_COLORS[kind]) continue;
    const eastWest = face === 'e' || face === 'w';
    ctx.fillStyle = CROSSING_COLORS[kind];
    for (let n = 0; n < 3; n++) {
      const p = 0.06 + n * 0.31, width = kind === 'ford' ? 0.38 : 0.74;
      if (eastWest) ctx.fillRect(x + p, y + (1 - width) / 2, 0.22, width);
      else ctx.fillRect(x + (1 - width) / 2, y + p, width, 0.22);
    }
  }
  for (const { x, y, kind } of approaches.sites ?? []) {
    ctx.fillStyle = SITE_COLORS[kind];
    ctx.fillRect(x + 0.15, y + 0.2, 0.7, 0.57);
    ctx.beginPath(); ctx.moveTo(x + 0.08, y + 0.48); ctx.lineTo(x + 0.5, y + 0.11); ctx.lineTo(x + 0.92, y + 0.48); ctx.fill();
    ctx.strokeStyle = '#422f21'; ctx.lineWidth = 0.10; ctx.stroke();
  }
  const { x, y } = approaches.post;
  ctx.translate(x + 0.5, y + 0.5);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = '#423120'; ctx.fillRect(-0.36, -0.36, 0.72, 0.72);
  ctx.fillStyle = APPROACH_COLORS.post; ctx.fillRect(-0.26, -0.26, 0.52, 0.52);
  ctx.restore();
}

export function addApproachScenery(scene, approaches, { wx, wz, topY, jiange, court, city, paintedRoads }) {
  const group = new THREE.Group();
  group.name = 'battle-approaches';
  const transform = new THREE.Object3D();
  for (const route of paintedRoads ? [] : approaches.routes) {
    const width = ROAD_WIDTH[route.kind];
    const material = new THREE.MeshStandardMaterial({ color: APPROACH_COLORS[route.kind], roughness: 1 });
    const strip = new THREE.InstancedMesh(new THREE.BoxGeometry(width, 0.025, 1 + width), material, route.cells.length - 1);
    strip.receiveShadow = true;
    for (let i = 1; i < route.cells.length; i++) {
      const [x, y] = route.cells[i - 1], [nx, ny] = route.cells[i];
      const a = approaches.roads.get(`${x},${y}`), b = approaches.roads.get(`${nx},${ny}`);
      const paved = !approaches.barriers || ((!a?.kind || a.kind === 'road') && (!b?.kind || b.kind === 'road'));
      transform.scale.setScalar(paved ? 1 : 0);
      transform.position.set(wx((x + nx) / 2), topY(x, y) + (route.kind === 'main' ? 0.009 : 0.017), wz((y + ny) / 2));
      transform.rotation.y = x === nx ? 0 : Math.PI / 2;
      transform.updateMatrix();
      strip.setMatrixAt(i - 1, transform.matrix);
    }
    group.add(strip);
  }
  transform.scale.setScalar(1);
  const bridges = [...approaches.roads.values()].filter(cell => cell.bridge && !cell.kind);
  if (bridges.length) {
    const deck = new THREE.InstancedMesh(new THREE.BoxGeometry(0.76, 0.075, 0.76),
      new THREE.MeshStandardMaterial({ color: APPROACH_COLORS.bridge, roughness: 1 }), bridges.length);
    deck.receiveShadow = true;
    for (const [i, { x, y }] of bridges.entries()) {
      transform.position.set(wx(x), topY(x, y) + 0.025, wz(y));
      transform.rotation.y = 0;
      transform.updateMatrix();
      deck.setMatrixAt(i, transform.matrix);
    }
    group.add(deck);
  }

  // 所有桥板、屋顶和檐柱按材质实例化，扩大地图时仍只产生少量绘制调用。
  const boxGeometry = new THREE.BoxGeometry();
  const batches = new Map();
  const part = (color, x, y, z, dx, dy, dz, angle = 0, slope = 0) => {
    transform.position.set(x, y, z); transform.scale.set(dx, dy, dz);
    transform.rotation.set(slope, angle, 0, 'YXZ'); transform.updateMatrix();
    if (!batches.has(color)) batches.set(color, []);
    batches.get(color).push(transform.matrix.clone());
  };
  const isPlank = (x, y) => approaches.roads.get(`${x},${y}`)?.kind === 'plank';
  for (const { x, y, kind, face } of approaches.roads.values()) {
    if (!CROSSING_COLORS[kind]) continue;
    if (jiange && kind === 'plank') {
      const bx = wx(x), bz = wz(y), floor = topY(x, y);
      const deck = '#ab8057', rail = '#523822';
      part(deck, bx, floor + 0.022, bz, 0.66, 0.07, 0.65);
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        if (!isPlank(x + dx, y + dy)) continue;
        const delta = topY(x + dx, y + dy) - floor, angle = dx ? Math.PI / 2 : 0;
        const height = floor + delta / 2, length = Math.hypot(1, delta), slope = -Math.atan(delta);
        for (const k of [0.26, 0.41, 0.59, 0.74]) {
          part(deck, bx + dx * k, floor + delta * k + 0.028, bz + dy * k, 0.65, 0.075, 0.165, angle, slope);
        }
        for (const side of [-1, 1]) {
          if (isPlank(x + dy * side, y + dx * side) || isPlank(x + dx + dy * side, y + dy + dx * side)) continue;
          const px = bx + dy * side * 0.31, pz = bz + dx * side * 0.31;
          part(rail, px + dx / 2, height + 0.23, pz + dy / 2, 0.048, 0.055, length, angle, slope);
          part(rail, px, floor + 0.132, pz, 0.055, 0.29, 0.055);
        }
        // 外侧斜撑接到谷底，转弯处也保留一整块可站立的平台。
        if (floor > 0.52) part(rail, bx, (floor + 0.3) / 2, bz, 0.12, floor - 0.3, 0.12);
      }
      continue;
    }
    const eastWest = face === 'e' || face === 'w', angle = eastWest ? Math.PI / 2 : 0;
    const span = kind === 'bridge' ? 0.85 : kind === 'plank' ? 0.55 : 0.32;
    const bx = wx(x), bz = wz(y), floor = topY(x,y), height = kind === 'bridge' ? floor - 0.055 : floor + 0.018;
    for (let i = -2; i <= 2; i++) {
      part(CROSSING_COLORS[kind], bx + (eastWest ? i * 0.2 : 0), height, bz + (eastWest ? 0 : i * 0.2),
        span, kind === 'ford' ? 0.036 : 0.09, 0.19, angle);
    }
    if (kind === 'ford' && city === 30) {
      // 浅滩留出明亮的石洲，两端的路纹与木桥明显区分。
      for (const side of [-1, 1]) {
        part('#b5a98a', bx + (eastWest ? 0.15 : side * 0.23), floor + 0.036,
          bz + (eastWest ? side * 0.23 : -0.13), 0.25, 0.09, 0.16, angle + side * 0.23);
      }
    }
    if (kind === 'bridge') for (const side of [-1, 1]) {
      part('#6d4931', bx + (eastWest ? 0 : side * span / 2), floor + 0.10,
        bz + (eastWest ? side * span / 2 : 0), 0.045, 0.07, 1, angle);
    }
  }
  for (const { x, y, kind } of approaches.sites ?? []) {
    if (court && kind === 'house') continue;
    const bx = wx(x), bz = wz(y), floor = topY(x,y);
    if (kind === 'landing') {
      part('#c8ae79', bx + 0.37, floor + 0.20, bz + 0.37, 0.04, 0.40, 0.04);
      part(SITE_COLORS.landing, bx + 0.30, floor + 0.34, bz + 0.37, 0.14, 0.11, 0.025);
      continue;
    }
    if (kind === 'camp') {
      part('#8d7652', bx, floor + 0.012, bz, 0.94, 0.027, 0.92);
      for (const [ox, oz, scale] of [[-0.27, 0.24, 0.58], [0.25, -0.23, 0.77], [-0.25, -0.26, 0.54]]) {
        const xx = bx + ox, zz = bz + oz;
        for (const side of [-1, 1]) part('#d9b986', xx, floor + scale * 0.20,
          zz + side * scale * 0.095, scale * 0.56, 0.035, scale * 0.35, 0, side * 0.8);
        part('#60472d', xx - scale * 0.25, floor + scale * 0.18, zz, 0.032, scale * 0.36, 0.033);
      }
      part('#654a2d', bx + 0.36, floor + 0.28, bz + 0.32, 0.035, 0.56, 0.035);
      part('#9f4435', bx + 0.26, floor + 0.48, bz + 0.32, 0.20, 0.13, 0.028);
      continue;
    }
    if (kind === 'harbor' && (city === 30 || city === 38)) {
      const direction = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => {
        const type = approaches.barriers.get(`${x + dx},${y + dy}`);
        return type === '深海' || type === '深水';
      });
      if (direction) {
        const [dx, dy] = direction, angle = Math.atan2(dx, dy);
        const waterY = topY(x + dx, y + dy);
        const offshore = approaches.barriers.get(`${x + 2 * dx},${y + 2 * dy}`) === '深海';
        for (let i = 0; i < 6; i++) part('#9e724b', bx + dx * (0.24 + i * 0.19), floor + 0.04,
          bz + dy * (0.24 + i * 0.19), 0.52, 0.07, 0.175, angle);
        for (const length of [0.45, 1.18]) for (const side of [-1, 1]) {
          part('#5e412c', bx + dx * length + dy * side * 0.22, floor - 0.09,
            bz + dy * length + dx * side * 0.22, 0.067, 0.39, 0.067);
        }
        if (offshore) {
          const ox = bx + dx * 2, oz = bz + dy * 2, hullY = waterY + 0.07, parallel = angle + Math.PI / 2;
          part('#5b3d29', ox, hullY, oz, 0.26, 0.15, 0.69, parallel);
          part('#987153', ox, hullY + 0.078, oz, 0.21, 0.042, 0.57, parallel);
          part('#64482a', ox, hullY + 0.31, oz, 0.034, 0.50, 0.034);
          part('#cdb696', ox, hullY + 0.37, oz, 0.025, 0.26, 0.18, parallel);
        }
      }
    }
    const house = kind === 'house', width = house ? 0.72 : 0.56, y0 = house ? 0.31 : 0.17;
    if (house) part('#92734c', bx, floor + 0.12, bz, width, 0.24, 0.63);
    else for (const a of [-1, 1]) for (const b of [-1, 1]) {
      part('#675038', bx + a * 0.22, floor + 0.18, bz + b * 0.18, 0.049, 0.36, 0.049);
    }
    for (const sign of [-1, 1]) part(SITE_COLORS[kind], bx, floor + y0, bz + sign * 0.18,
      width + 0.10, 0.07, 0.42, 0, sign * 0.44);
  }
  if (!batches.size) boxGeometry.dispose();
  for (const [color, matrices] of batches) {
    const mesh = new THREE.InstancedMesh(boxGeometry, new THREE.MeshStandardMaterial({ color, roughness: 1 }), matrices.length);
    mesh.castShadow = mesh.receiveShadow = true;
    matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix)); group.add(mesh);
  }
  const { x, y } = approaches.post;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.36, 0.26, 4),
    new THREE.MeshStandardMaterial({ color: APPROACH_COLORS.post, roughness: 1 }));
  post.position.set(wx(x), topY(x, y) + 0.13, wz(y));
  post.castShadow = true;
  group.add(post);
  scene.add(group);
}
