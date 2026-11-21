import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTex, rng } from './pixel.js';
import { roofGeo, roofTex } from './structures.js';
import { gateNormal } from './core/siege.js';
import { fortressStyle, hasGateWings, rampartProfile } from './fortress-style.js';
import { archedStone, batteredBlock, dressedStone, masonryUV } from './fortification-detail.js';

// 城墙按格对齐。合并静态构件，城门只移动门扇，城楼和门道始终保留。
export function buildFortification(siege, { wx, wz, topY, court, houses = [], jiange, refined = false }) {
  const fort = new THREE.Group(), batches = new Map(), gates = [];
  fort.name = 'siege-fortification';
  fort.userData.landmark = true;
  const style = fortressStyle(siege), scale = style?.scale ?? 1;
  if (style) fort.userData.style = siege.style;
  const material = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.91 });
  const stonework = canvasTex(128, 64, ctx => {
    const random = rng(53);
    ctx.fillStyle = '#77726a'; ctx.fillRect(0, 0, 128, 64);
    for (let row = 0; row < 6; row++) {
      for (let x = row % 2 ? -12 : 0; x < 128; x += 24) {
        const value = 148 + Math.floor(random() * 36), y = row * 11;
        ctx.fillStyle = `rgb(${value},${value - 7},${value - 17})`;
        ctx.fillRect(x + 1, y + 1, 22, 9);
        ctx.fillStyle = '#d1c5af'; ctx.fillRect(x + 2, y + 1, 19, 1);
      }
    }
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = i % 2 ? '#3c342026' : '#f9eed326';
      ctx.fillRect(random() * 128, random() * 64, 1 + random() * 2, 1);
    }
  }, { repeat: true });
  const masonry = (style ? [style.stone, style.light, new THREE.Color(style.stone).multiplyScalar(0.75)] : ['#aa9d88', '#c1b6a0', '#857c70'])
    .map(color => new THREE.MeshStandardMaterial({ color, map: stonework, roughness: 0.94 }));
  const cap = material(style?.light ?? '#b5a489'), timber = material(style?.wood ?? '#593621');
  const ridge = style ? material(style.ridge) : timber;
  const tile = court ? roofTex('#444d4f', '#32363b', '#727872')
    : roofTex(style?.roof ?? '#444d46', style?.shade ?? '#323c36', style?.ridge ?? '#5e695e');
  tile.repeat.set(refined ? 1 : 3, refined ? 1 : 2);
  const roof = new THREE.MeshStandardMaterial({ map: tile, roughness: 0.9 });
  const gateWood = material('#946541');
  const paving = new THREE.MeshStandardMaterial({ color: '#908471', map: stonework, roughness: 0.97 });
  const lacquer = court ? material('#803d2b') : timber;
  const stoneTint = refined ? new THREE.Color(style.stone).lerp(new THREE.Color('#e8e3d6'), 0.66) : null;
  const ashlar = refined ? new THREE.MeshStandardMaterial({ color: stoneTint, map: dressedStone(), roughness: 0.95 }) : null;
  const coping = refined ? material(stoneTint.clone().lerp(new THREE.Color('#8c8473'), 0.85)) : cap;
  const joinery = refined ? material('#42352c') : timber;
  const vermilion = refined ? material('#8c3c2d') : lacquer;
  const flag = refined ? material('#a83128') : null;
  const stone = (n) => masonry[Math.abs(n) % masonry.length];
  const staticPart = (geo, mat, x, y, z, angle) => {
    const parts = batches.get(mat) ?? [];
    if (!batches.has(mat)) batches.set(mat, parts);
    if (!geo.index) geo.setIndex(Array.from({ length: geo.attributes.position.count }, (_, i) => i));
    parts.push(geo.rotateY(angle).translate(x, y, z));
  };
  function local(cell, angle = 0) {
    const [ox, oy, oz] = [wx(cell.x), topY(cell.x, cell.y), wz(cell.y)];
    const c = Math.cos(angle), s = Math.sin(angle);
    return (w, h, d, x, y, z, mat) => staticPart(new THREE.BoxGeometry(w, h, d), mat,
      ox + c * x + s * z, oy + y, oz - s * x + c * z, angle);
  }
  function tiledRoof(cell, angle, height, width, depth) {
    const [x, y, z] = [wx(cell.x), topY(cell.x, cell.y), wz(cell.y)];
    if (refined) {
      const rise = Math.min(0.48, depth * 0.32), ridgeLength = width * 0.51;
      staticPart(roofGeo(width / 2, depth / 2, rise, 0.51, 0.4, 10), roof, x, y + height, z, angle);
      const box = local(cell, angle);
      box(ridgeLength + 0.09, 0.042, 0.065, 0, height + rise + 0.012, 0, joinery);
      for (const side of [-1, 1]) box(0.051, 0.091, 0.063, side * (ridgeLength / 2 + 0.035), height + rise + 0.04, 0, joinery);
      return;
    }
    const w = width / 2, d = depth / 2, r = width * 0.33, h = height + 0.22;
    const corners = [
      [-w,height+0.035,-d], [-w,height+0.035,d], [w,height+0.035,d], [w,height+0.035,-d],
      [-w*0.86,height+0.098,-d*0.61], [-w*0.86,height+0.098,d*0.61],
      [w*0.86,height+0.098,d*0.61], [w*0.86,height+0.098,-d*0.61], [-r,h,0], [r,h,0],
    ];
    const faces = [4,5,8, 5,6,9, 5,9,8, 6,7,9, 7,4,8, 7,8,9];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      faces.push(i,j,j+4, i,j+4,i+4);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(faces.flatMap(i => corners[i]), 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(faces.flatMap(i => [corners[i][0] / width + 0.5, corners[i][2] / depth + 0.5]), 2));
    geo.computeVertexNormals(); geo.setIndex(faces.map((_, i) => i));
    staticPart(geo, roof, x, y, z, angle);
    local(cell, angle)(2*r + 0.1, 0.065, 0.075, 0, h, 0, ridge);
  }
  function gateArch(cell, angle, height, width = 1) {
    const profile = new THREE.Shape();
    const half = width / 2;
    const shoulder = height * 0.57;
    profile.moveTo(-half, 0);
    profile.lineTo(-half, height + 0.08);
    profile.lineTo(half, height + 0.08);
    profile.lineTo(half, 0);
    profile.lineTo(0.32, 0);
    profile.lineTo(0.32, shoulder);
    profile.quadraticCurveTo(0.25, height - 0.04, 0, height - 0.04);
    profile.quadraticCurveTo(-0.25, height - 0.04, -0.32, shoulder);
    profile.lineTo(-0.32, 0);
    profile.closePath();
    const arch = new THREE.ExtrudeGeometry(profile, { depth: 0.60, bevelEnabled: false, curveSegments: 8 });
    staticPart(arch.translate(0, 0, -0.30), masonry[1], wx(cell.x), topY(cell.x, cell.y), wz(cell.y), angle);
  }
  function ashlarBlock(cell, angle, width, height, base, crown, taperEnds = false) {
    const geo = batteredBlock(width, height, base, crown, taperEnds);
    const along = angle ? -cell.y : cell.x;
    staticPart(masonryUV(geo, along), ashlar, wx(cell.x), topY(cell.x, cell.y), wz(cell.y), angle);
  }
  function pavilion(cell, angle, y, width, depth, height, columns, ceremonial) {
    const box = local(cell, angle), wood = ceremonial ? vermilion : timber;
    box(width * 0.80, height * 0.92, depth * 0.69, 0, y + height * 0.46, 0, joinery);
    for (const side of [-1, 1]) {
      const z = side * depth * 0.39;
      box(width * 0.94, 0.046, 0.083, 0, y + height, z, wood);
      box(width * 0.91, 0.057, 0.072, 0, y + 0.034, z, wood);
      for (let bay = 0; bay < columns; bay++) {
        const x = (bay / (columns - 1) - 0.5) * width * 0.86;
        box(0.063, height, 0.073, x, y + height / 2, z, wood);
        box(0.096, 0.043, 0.094, x, y + height - 0.029, z, wood);
      }
    }
    tiledRoof(cell, angle, y + height + 0.024, width * 1.09, depth * 1.14);
  }
  function archCasing(cell, angle, spring, radius, height) {
    const [ox, oy, oz] = [wx(cell.x), topY(cell.x, cell.y), wz(cell.y)];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 9; i++) {
        const a = i * Math.PI / 9 + 0.013, b = (i + 1) * Math.PI / 9 - 0.013;
        const shape = new THREE.Shape();
        shape.absarc(0, spring, radius, a, b, false);
        shape.absarc(0, spring, radius + (i === 4 ? 0.105 : 0.079), b, a, true);
        shape.closePath();
        const geo = new THREE.ShapeGeometry(shape, 3);
        const p = geo.attributes.position;
        for (let k = 0; k < p.count; k++) p.setZ(k, side * (0.422 - p.getY(k) * 0.074 / height));
        if (side < 0) geo.setIndex(Array.from(geo.index.array).reverse());
        geo.computeVertexNormals();
        staticPart(geo, coping, ox, oy, oz, angle);
      }
      const box = local(cell, angle);
      for (const edge of [-1, 1]) for (let row = 0; row < 4; row++) {
        const y = spring * (row + 0.5) / 4;
        box(0.066, spring / 4 - 0.009, 0.024, edge * (radius + 0.036), y, side * (0.414 - 0.074 * y / height), coping);
      }
    }
  }
  function merlons(box, height, depth, width = 1) {
    for (const side of [-1, 1]) {
      const z = side * (depth / 2 - 0.05);
      box(width, 0.085, 0.096, 0, height + 0.027, z, coping);
      for (const x of [-0.34, 0, 0.34]) {
        box(0.18 * width, 0.096, 0.106, x * width, height + 0.111, z, coping);
        box(0.20 * width, 0.023, 0.117, x * width, height + 0.168, z, coping);
      }
    }
  }
  const capitalGate = court?.gate ?? (siege.style === 'changan' && siege.gates.find(g => g.ring === siege.outer && g.face === 's'));
  function detailedGate(gate, angle, outer) {
    const grand = gate === capitalGate, main = grand || (jiange && outer);
    const wings = hasGateWings(siege, gate);
    const width = wings ? 2.42 : 0.99, radius = main ? 0.34 : 0.31;
    const height = (main ? 1.23 : outer ? 1.01 : 0.82) * scale;
    const spring = height - radius - 0.23, box = local(gate, angle);
    const [x, y, z] = [wx(gate.x), topY(gate.x, gate.y), wz(gate.y)];
    staticPart(archedStone(width, height, radius, spring), ashlar, x, y, z, angle);
    archCasing(gate, angle, spring, radius, height);
    box(width - 0.09, 0.073, 0.75, 0, height - 0.035, 0, coping);
    box(width - 0.13, 0.054, 0.80, 0, height + 0.012, 0, ashlar);
    const hallWidth = wings ? 1.91 : main ? 1.18 : 0.84;
    const hallHeight = main ? 0.40 : 0.29, hallDepth = main ? 0.82 : 0.65;
    pavilion(gate, angle, height + 0.043, hallWidth, hallDepth, hallHeight, wings ? 7 : 4, outer && (main || scale > 1.1));
    if (outer && (main || style.tiers >= 2)) {
      const upper = height + hallHeight + 0.19;
      pavilion(gate, angle, upper, hallWidth * 0.69, hallDepth * 0.76, 0.29, wings ? 5 : 3, main);
    }
    if (wings) for (const side of [-1, 1]) {
      box(0.13, 0.55, 0.027, side * 0.83, height - 0.28, 0.404, flag);
      box(0.18, 0.024, 0.061, side * 0.83, height + 0.011, 0.411, joinery);
      box(0.072, 0.21, 0.018, side * 0.83, height - 0.30, 0.422, vermilion);
    }
    if (grand && gate === court?.gate) {
      // 瓮城用低护墙沿既有南门前的边缘收口，中间门道保持完整宽度。
      box(1.88, 0.023, 1.45, 0, 0.012, 0.92, paving);
      for (const side of [-1, 1]) {
        box(0.18, 0.27, 0.93, side * 0.85, 0.135, 0.94, ashlar);
        box(0.21, 0.058, 0.96, side * 0.85, 0.275, 0.94, coping);
        for (const z of [0.60, 0.88, 1.16, 1.39]) box(0.19, 0.10, 0.12, side * 0.85, 0.35, z, coping);
        box(0.10, 0.235, 0.016, side * 0.85, 0.46, 1.37, flag);
        box(0.017, 0.31, 0.021, side * 0.90, 0.47, 1.37, joinery);
      }
    }
    const door = new THREE.Group(); door.name = 'siege-door';
    door.position.set(x, y, z); door.rotation.y = angle;
    for (const side of [-1, 1]) {
      const profile = new THREE.Shape(), edge = radius - 0.012;
      const a = side > 0 ? 0 : Math.PI / 2, b = a + Math.PI / 2;
      profile.moveTo(Math.cos(a) * edge, 0.018); profile.lineTo(Math.cos(a) * edge, spring + Math.sin(a) * edge);
      profile.absarc(0, spring, edge, a, b, false); profile.lineTo(Math.cos(b) * edge, 0.018); profile.closePath();
      const leaf = new THREE.Mesh(new THREE.ExtrudeGeometry(profile, { depth: 0.105, bevelEnabled: false, curveSegments: 7 }).translate(0, 0, -0.052), gateWood);
      door.add(leaf);
      for (const high of [0.19, 0.67]) {
        const beam = new THREE.Mesh(new THREE.BoxGeometry(edge - 0.012, 0.042, 0.128), joinery);
        beam.position.set(side * edge / 2, spring * high, 0); door.add(beam);
      }
    }
    return door;
  }
  for (const wall of siege.walls) {
    const rx = Math.abs(wall.x - siege.cx), ry = Math.abs(wall.y - siege.cy);
    const angle = (wall.face ? wall.face === 'w' || wall.face === 'e' : rx === wall.ring) ? Math.PI / 2 : 0;
    const box = local(wall, angle), corner = wall.corner ?? rx === ry, outer = wall.ring === siege.outer;
    if (refined) {
      const { height, base, crown } = rampartProfile(style, outer, corner);
      ashlarBlock(wall, angle, 1.005, height, base, crown);
      box(1.009, 0.08, Math.min(base + 0.07, 1), 0, 0.038, 0, ashlar);
      box(1.01, 0.052, crown + 0.064, 0, height - 0.015, 0, coping);
      merlons(box, height, crown);
      if (corner && outer) {
        const tower = height + 0.20 * scale;
        ashlarBlock(wall, angle, 0.82, tower, 0.91, 0.68, true);
        box(0.73, 0.073, 0.75, 0, tower, 0, coping);
        pavilion(wall, angle, tower + 0.025, 0.72 * scale, 0.67 * scale, 0.28, 3, scale > 1.1);
      }
      continue;
    }
    const h = (outer ? 0.54 : 0.43) * scale, depth = corner ? 0.99 : 0.54;
    const rampart = new THREE.BoxGeometry(1.005, h, depth), pos = rampart.attributes.position;
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0) pos.setZ(i, pos.getZ(i) * 0.78);
    rampart.computeVertexNormals();
    staticPart(rampart, stone(wall.x + 2 * wall.y), wx(wall.x), topY(wall.x, wall.y) + h/2, wz(wall.y), angle);
    box(1.01, 0.08, depth + 0.08, 0, 0.05, 0, stone(2));
    box(1.01, 0.055, depth * 0.80, 0, h, 0, cap);
    for (const x of [-0.36, 0, 0.36]) for (const side of [-1, 1]) {
      box(0.18, 0.13, 0.105, x, h + 0.077, side * (depth*0.4 - 0.05), cap);
    }
    if (corner && outer) {
      box(0.5, 0.22, 0.52, 0, h + 0.14, 0, timber);
      tiledRoof(wall, angle, h + 0.29, 0.87 * scale, 0.82 * scale);
      if (!style || scale >= 1) {
        box(0.30, 0.17, 0.29, 0, h + 0.49, 0, timber);
        tiledRoof(wall, angle, h + 0.60, 0.62 * scale, 0.54 * scale);
      }
    }
  }
  for (const gate of siege.gates) {
    const [dx, dy] = gateNormal(siege, gate), angle = dx ? Math.PI / 2 : 0;
    const box = local(gate, angle), outer = gate.ring === siege.outer;
    if (refined) {
      const door = detailedGate(gate, angle, outer);
      door.scale.y = gate.open ? 0.1 : 1;
      gates.push({ door, gate }); fort.add(door);
      continue;
    }
    const main = gate === court?.gate, monumental = main || (jiange && outer);
    const h = (monumental ? 0.87 : outer ? 0.65 : 0.52) * scale, wide = monumental ? 1.28 : 1;
    gateArch(gate, angle, h, wide);
    box(0.99 * wide, 0.065, 0.68, 0, h + 0.075, 0, stone(2));
    box(0.57 * wide, 0.23, 0.42, 0, h + 0.14, 0, main ? lacquer : timber);
    tiledRoof(gate, angle, h + 0.27, (outer ? 1.16 : 0.98) * scale * wide, 0.84 * scale);
    if (outer && (style?.tiers >= 2 || monumental)) {
      box(0.42 * wide, 0.19, 0.34, 0, h + 0.46, 0, main ? lacquer : timber);
      tiledRoof(gate, angle, h + 0.58, 0.78 * scale * wide, 0.64 * scale);
    }
    if (main) {
      // 南门的两座墩台落在既有墙格上，向外用低挡墙勾出瓮城。门前仍可横向调兵。
      box(1.75, 0.035, 1.55, 0, 0.016, 0.90, paving);
      for (const side of [-1, 1]) {
        const pier = { x: gate.x + side, y: gate.y };
        const tower = local(pier);
        tower(0.79, 0.72, 0.77, 0, 0.36, 0.12, stone(0));
        tower(0.56, 0.28, 0.46, 0, 0.85, 0.12, lacquer);
        tiledRoof(pier, 0, 1.00, 0.88, 0.79);
        box(0.20, 0.22, 0.94, side * 0.69, 0.11, 0.79, stone(1));
        box(0.23, 0.045, 0.98, side * 0.69, 0.23, 0.79, cap);
        box(0.09, 0.40, 0.09, side * 0.48, h + 0.17, 0.26, lacquer);
      }
    }
    const door = new THREE.Group(); door.name = 'siege-door';
    door.position.set(wx(gate.x), topY(gate.x, gate.y), wz(gate.y)); door.rotation.y = angle;
    for (const side of [-1, 1]) {
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.305, h - 0.12, 0.12), gateWood);
      leaf.position.set(side * 0.157, (h - 0.12)/2, 0); door.add(leaf);
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.06, 0.15), timber);
      beam.position.set(side * 0.157, h*0.66, 0); door.add(beam);
    }
    door.scale.y = gate.open ? 0.1 : 1;
    gates.push({ door, gate }); fort.add(door);
    if (outer && !siege.moatCells) {
      const bridge = style ? { x: gate.x + dx, y: gate.y + dy } : { x: siege.cx + dx * siege.moat, y: siege.cy + dy * siege.moat };
      const deck = local(bridge, angle);
      deck(0.82, 0.09, 1.06, 0, 0.035, 0, style?.timberBridge ? timber : paving);
      for (const side of [-1, 1]) deck(0.075, 0.12, 1, side * 0.40, 0.085, 0, cap);
    }
  }
  if (style) {
    for (const cell of siege.paving) local(cell, cell.face === 'e' || cell.face === 'w' ? Math.PI / 2 : 0)(0.56, 0.018, 0.99, 0, 0.012, 0, paving);
    const keep = { x: siege.cx, y: siege.cy };
    const angle = !court && ['e', 'w'].includes(siege.direction) ? Math.PI / 2 : 0;
    const box = local(keep, angle);
    let [width, depth] = court ? [2.95, 1.82] : style.keep;
    const raised = court ? 0.52 : 0;
    box(width + 0.20, 0.20 + raised, depth + 0.20, 0, 0.02 + raised / 2, 0, masonry[0]);
    if (court) {
      box(3.48, 0.12, 2.42, 0, 0.05, 0, masonry[2]);
      for (let i = 0; i < 5; i++) box(0.94, 0.075 + i * 0.09, 0.15, 0, 0.04 + i * 0.045, 1.66 - i * 0.15, stone(1));
      for (const side of [-1, 1]) box(0.09, 0.22, 0.78, side * 0.55, 0.12, 1.33, cap);
    }
    for (let level = 0; level < style.tiers; level++) {
      const y = raised + level * 0.41;
      box(width * 0.78, 0.38, depth * 0.76, 0, 0.28 + y, 0, court ? lacquer : timber);
      const columns = court && level === 0 ? [-0.38, -0.19, 0, 0.19, 0.38] : [-0.30, 0, 0.30];
      for (const x of columns) for (const z of [-0.42, 0.42]) box(0.07, 0.35, 0.09, width * x, 0.28 + y, depth * z, court ? lacquer : cap);
      tiledRoof(keep, angle, 0.49 + y, width, depth);
      width *= 0.73; depth *= 0.76;
    }
    for (const home of houses) {
      // 只在已占地的街坊格上增加庭院和多间屋舍。
      const turn = (home.x + home.y) % 2 ? Math.PI / 2 : 0, yard = local(home, turn);
      yard(0.93, 0.035, 0.92, 0, 0.018, 0, paving);
      yard(0.64, 0.27, 0.49, 0, 0.15, -0.12, stone(home.x));
      yard(0.52, 0.05, 0.09, 0, 0.27, 0.13, lacquer);
      tiledRoof(home, turn, 0.29, 0.80, 0.59);
      for (const side of [-1, 1]) yard(0.065, 0.13, 0.32, side * 0.41, 0.082, 0.28, stone(2));
      yard(0.38, 0.11, 0.06, -0.23, 0.065, 0.44, stone(1));
    }
  } else if (siege.inner > 1) {
    // 铺装沿门轴展开，内院四角留给站位和单位轮廓。
    for (let offset = -siege.outer; offset <= siege.outer; offset++) {
      if (!offset) continue;
      local({ x: siege.cx + offset, y: siege.cy })(0.99, 0.018, 0.58, 0, 0.012, 0, paving);
      local({ x: siege.cx, y: siege.cy + offset })(0.58, 0.018, 0.99, 0, 0.012, 0, paving);
    }
  }
  for (const [mat, parts] of batches) {
    const geometry = mergeGeometries(parts);
    parts.forEach(piece => piece.dispose());
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    fort.add(mesh);
  }
  return { fort, gates };
}
