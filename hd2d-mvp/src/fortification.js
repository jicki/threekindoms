import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { roofTex } from './structures.js';

// 城墙按格对齐。合并静态构件，城门只移动门扇，城楼和门道始终保留。
export function buildFortification(siege, { wx, wz, topY }) {
  const fort = new THREE.Group(), batches = new Map(), gates = [];
  fort.name = 'siege-fortification';
  fort.userData.landmark = true;
  const material = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.91 });
  const masonry = [material('#87745d'), material('#a28c6d'), material('#6c6053')];
  const cap = material('#b5a489'), timber = material('#593621');
  const tile = roofTex('#444d46', '#323c36', '#5e695e');
  tile.repeat.set(3, 2);
  const roof = new THREE.MeshStandardMaterial({ map: tile, roughness: 0.9 });
  const gateWood = material('#946541');
  const stone = (n) => masonry[Math.abs(n) % masonry.length];
  const staticPart = (geo, mat, x, y, z, angle) => {
    const parts = batches.get(mat) ?? [];
    if (!batches.has(mat)) batches.set(mat, parts);
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
    const corners = [[-w,height,-d], [-w,height,d], [w,height,d], [w,height,-d], [-r,h,0], [r,h,0]];
    const faces = [0,1,4, 1,2,5, 1,5,4, 2,3,5, 3,0,4, 3,4,5];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(faces.flatMap(i => corners[i]), 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(faces.flatMap(i => [corners[i][0] / width + 0.5, corners[i][2] / depth + 0.5]), 2));
    geo.computeVertexNormals(); geo.setIndex(faces.map((_, i) => i));
    staticPart(geo, roof, x, y, z, angle);
    local(cell, angle)(2*r + 0.1, 0.065, 0.075, 0, h, 0, timber);
  }
  for (const wall of siege.walls) {
    const rx = Math.abs(wall.x - siege.cx), ry = Math.abs(wall.y - siege.cy), angle = rx === wall.ring ? Math.PI / 2 : 0;
    const box = local(wall, angle), corner = rx === ry, outer = wall.ring === 3;
    const h = outer ? 0.54 : 0.43, depth = corner ? 0.99 : 0.54;
    box(0.99, h, depth, 0, h/2, 0, stone(wall.x + 2 * wall.y));
    box(1.01, 0.08, depth + 0.08, 0, 0.05, 0, stone(2));
    box(1.01, 0.055, depth + 0.04, 0, h, 0, cap);
    for (const side of [-1, 1]) for (let row = 0; row < 3; row++) {
      const y = h * (0.28 + 0.22 * row);
      for (let col = 0; col < 3; col++) box(0.27, h * 0.17, 0.027,
        (col - 1) * 0.30 + (row % 2) * 0.055, y, side * depth / 2, stone(wall.x + wall.y + row + col));
    }
    for (const x of [-0.36, 0, 0.36]) for (const side of [-1, 1]) {
      box(0.18, 0.13, 0.105, x, h + 0.077, side * (depth/2 - 0.05), cap);
    }
    if (corner && outer) {
      box(0.5, 0.22, 0.52, 0, h + 0.14, 0, timber);
      tiledRoof(wall, angle, h + 0.29, 0.87, 0.82);
    }
  }
  for (const gate of siege.gates) {
    const vertical = gate.x !== siege.cx, angle = vertical ? Math.PI / 2 : 0;
    const box = local(gate, angle), outer = gate.ring === 3, h = outer ? 0.65 : 0.52;
    for (const side of [-1, 1]) box(0.18, h, 0.67, side * 0.404, h/2, 0, cap);
    box(0.99, 0.10, 0.65, 0, h, 0, stone(2));
    box(0.57, 0.23, 0.42, 0, h + 0.14, 0, timber);
    tiledRoof(gate, angle, h + 0.27, outer ? 1.16 : 0.98, 0.84);
    const door = new THREE.Group(); door.name = 'siege-door';
    door.position.set(wx(gate.x), topY(gate.x, gate.y), wz(gate.y)); door.rotation.y = angle;
    for (const side of [-1, 1]) {
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.305, h - 0.08, 0.12), gateWood);
      leaf.position.set(side * 0.157, h/2 - 0.01, 0); door.add(leaf);
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.06, 0.15), timber);
      beam.position.set(side * 0.157, h*0.66, 0); door.add(beam);
    }
    door.scale.y = gate.open ? 0.1 : 1;
    gates.push({ door, gate }); fort.add(door);
    if (outer) {
      const bridge = vertical ? { x: siege.cx + Math.sign(gate.x - siege.cx) * 4, y: gate.y }
        : { x: gate.x, y: siege.cy + Math.sign(gate.y - siege.cy) * 4 };
      const deck = local(bridge, angle);
      deck(0.82, 0.08, 1.06, 0, 0.035, 0, stone(1));
      for (const side of [-1, 1]) deck(0.075, 0.12, 1, side * 0.40, 0.085, 0, cap);
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
