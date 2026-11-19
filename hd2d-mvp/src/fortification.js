import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTex, rng } from './pixel.js';
import { roofTex } from './structures.js';

// 城墙按格对齐。合并静态构件，城门只移动门扇，城楼和门道始终保留。
export function buildFortification(siege, { wx, wz, topY }) {
  const fort = new THREE.Group(), batches = new Map(), gates = [];
  fort.name = 'siege-fortification';
  fort.userData.landmark = true;
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
  const masonry = ['#aa9d88', '#c1b6a0', '#857c70'].map(color => new THREE.MeshStandardMaterial({ color, map: stonework, roughness: 0.94 }));
  const cap = material('#b5a489'), timber = material('#593621');
  const tile = roofTex('#444d46', '#323c36', '#5e695e');
  tile.repeat.set(3, 2);
  const roof = new THREE.MeshStandardMaterial({ map: tile, roughness: 0.9 });
  const gateWood = material('#946541');
  const paving = new THREE.MeshStandardMaterial({ color: '#908471', map: stonework, roughness: 0.97 });
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
    local(cell, angle)(2*r + 0.1, 0.065, 0.075, 0, h, 0, timber);
  }
  function gateArch(cell, angle, height) {
    const profile = new THREE.Shape();
    const shoulder = height * 0.57;
    profile.moveTo(-0.5, 0);
    profile.lineTo(-0.5, height + 0.08);
    profile.lineTo(0.5, height + 0.08);
    profile.lineTo(0.5, 0);
    profile.lineTo(0.32, 0);
    profile.lineTo(0.32, shoulder);
    profile.quadraticCurveTo(0.25, height - 0.04, 0, height - 0.04);
    profile.quadraticCurveTo(-0.25, height - 0.04, -0.32, shoulder);
    profile.lineTo(-0.32, 0);
    profile.closePath();
    const arch = new THREE.ExtrudeGeometry(profile, { depth: 0.60, bevelEnabled: false, curveSegments: 8 });
    staticPart(arch.translate(0, 0, -0.30), masonry[1], wx(cell.x), topY(cell.x, cell.y), wz(cell.y), angle);
  }
  for (const wall of siege.walls) {
    const rx = Math.abs(wall.x - siege.cx), ry = Math.abs(wall.y - siege.cy), angle = rx === wall.ring ? Math.PI / 2 : 0;
    const box = local(wall, angle), corner = rx === ry, outer = wall.ring === siege.outer;
    const h = outer ? 0.54 : 0.43, depth = corner ? 0.99 : 0.54;
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
      tiledRoof(wall, angle, h + 0.29, 0.87, 0.82);
      box(0.30, 0.17, 0.29, 0, h + 0.49, 0, timber);
      tiledRoof(wall, angle, h + 0.60, 0.62, 0.54);
    }
  }
  for (const gate of siege.gates) {
    const vertical = gate.x !== siege.cx, angle = vertical ? Math.PI / 2 : 0;
    const box = local(gate, angle), outer = gate.ring === siege.outer, h = outer ? 0.65 : 0.52;
    gateArch(gate, angle, h);
    box(0.99, 0.065, 0.68, 0, h + 0.075, 0, stone(2));
    box(0.57, 0.23, 0.42, 0, h + 0.14, 0, timber);
    tiledRoof(gate, angle, h + 0.27, outer ? 1.16 : 0.98, 0.84);
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
    if (outer) {
      const bridge = vertical ? { x: siege.cx + Math.sign(gate.x - siege.cx) * siege.moat, y: gate.y }
        : { x: gate.x, y: siege.cy + Math.sign(gate.y - siege.cy) * siege.moat };
      const deck = local(bridge, angle);
      deck(0.82, 0.09, 1.06, 0, 0.035, 0, paving);
      for (const side of [-1, 1]) deck(0.075, 0.12, 1, side * 0.40, 0.085, 0, cap);
    }
  }
  if (siege.inner > 1) {
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
