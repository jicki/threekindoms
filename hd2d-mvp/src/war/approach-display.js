import * as THREE from 'three';

export const APPROACH_COLORS = { main: '#d5ac72', flank: '#b5aa86', bridge: '#8d6342', post: '#f2c064' };
const ROAD_WIDTH = { main: 0.48, flank: 0.3 };

export function paintApproaches(ctx, approaches, cell) {
  if (!approaches) return;
  ctx.save();
  ctx.scale(cell, cell);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const route of approaches.routes) {
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
  const { x, y } = approaches.post;
  ctx.translate(x + 0.5, y + 0.5);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = '#423120'; ctx.fillRect(-0.36, -0.36, 0.72, 0.72);
  ctx.fillStyle = APPROACH_COLORS.post; ctx.fillRect(-0.26, -0.26, 0.52, 0.52);
  ctx.restore();
}

export function addApproachScenery(scene, approaches, { wx, wz, topY }) {
  const group = new THREE.Group();
  group.name = 'battle-approaches';
  const transform = new THREE.Object3D();
  for (const route of approaches.routes) {
    const width = ROAD_WIDTH[route.kind];
    const material = new THREE.MeshStandardMaterial({ color: APPROACH_COLORS[route.kind], roughness: 1 });
    const strip = new THREE.InstancedMesh(new THREE.BoxGeometry(width, 0.025, 1 + width), material, route.cells.length - 1);
    strip.receiveShadow = true;
    for (let i = 1; i < route.cells.length; i++) {
      const [x, y] = route.cells[i - 1], [nx, ny] = route.cells[i];
      transform.position.set(wx((x + nx) / 2), topY(x, y) + (route.kind === 'main' ? 0.009 : 0.017), wz((y + ny) / 2));
      transform.rotation.y = x === nx ? 0 : Math.PI / 2;
      transform.updateMatrix();
      strip.setMatrixAt(i - 1, transform.matrix);
    }
    group.add(strip);
  }
  const bridges = [...approaches.roads.values()].filter(cell => cell.bridge);
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
  const { x, y } = approaches.post;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.36, 0.26, 4),
    new THREE.MeshStandardMaterial({ color: APPROACH_COLORS.post, roughness: 1 }));
  post.position.set(wx(x), topY(x, y) + 0.13, wz(y));
  post.castShadow = true;
  group.add(post);
  scene.add(group);
}
