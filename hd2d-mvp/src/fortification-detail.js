import * as THREE from 'three';
import { canvasTex, rng } from './pixel.js';

export function dressedStone() {
  const W = 256, H = 192, row = 16, r = rng(97);
  const tex = canvasTex(W, H, g => {
    g.fillStyle = '#625d50'; g.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += row) {
      const starts = Array.from({ length: 8 }, (_, i) => i * 32 + 6 * r() + (y % 32 ? 14 : -5));
      for (let i = 0; i < starts.length; i++) {
        const a = starts[i], b = starts[i + 1] ?? starts[0] + W;
        const v = Math.round(145 + r() * 37), edge = 1 + r() * 2;
        const top = g.createLinearGradient(0, y, 0, y + row);
        top.addColorStop(0, `rgb(${v + 14},${v + 11},${v + 2})`);
        top.addColorStop(.32, `rgb(${v},${v - 4},${v - 12})`);
        top.addColorStop(1, `rgb(${v - 18},${v - 22},${v - 30})`);
        g.fillStyle = top;
        for (const offset of [-W, 0, W]) {
          const x = a + offset, end = b - 1 + offset;
          g.beginPath(); g.moveTo(x + edge, y + 1); g.lineTo(end - 1, y + 1.7);
          g.lineTo(end, y + row - 2); g.lineTo(x + 1, y + row - 1.5); g.closePath(); g.fill();
        }
      }
    }
    for (let i = 0; i < 3700; i++) {
      g.fillStyle = r() > 0.54 ? '#f2e3c624' : '#29271e19';
      g.fillRect(r() * W, r() * H, 1 + r() * 3, 0.7 + r());
    }
  }, { repeat: true });
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.anisotropy = 4;
  return tex;
}

// 按实际世界尺度铺石缝，长短不同的墙段和相邻城砖保持相同高度。
export function masonryUV(geo, offset = 0) {
  const { position: p, normal: n, uv } = geo.attributes;
  for (let i = 0; i < p.count; i++) {
    const top = Math.abs(n.getY(i)) > 0.8, end = Math.abs(n.getX(i)) > Math.abs(n.getZ(i));
    uv.setXY(i, ((end ? p.getZ(i) : p.getX(i)) + offset) / 1.62, (top ? p.getZ(i) : p.getY(i)) / 0.96);
  }
  return geo;
}

export function batteredBlock(width, height, base, crown, taperEnds = false) {
  const geo = new THREE.BoxGeometry(width, height, base).translate(0, height / 2, 0);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) {
    p.setZ(i, p.getZ(i) * crown / base);
    if (taperEnds) p.setX(i, p.getX(i) * 0.86);
  }
  geo.computeVertexNormals();
  return geo;
}

export function archedStone(width, height, radius, spring) {
  const shape = new THREE.Shape(), half = width / 2;
  shape.moveTo(-half, 0); shape.lineTo(-half + 0.07, height);
  shape.lineTo(half - 0.07, height); shape.lineTo(half, 0);
  shape.lineTo(radius, 0); shape.lineTo(radius, spring);
  shape.absarc(0, spring, radius, 0, Math.PI, false);
  shape.lineTo(-radius, 0); shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.82, bevelEnabled: false, curveSegments: 7 }).translate(0, 0, -0.41);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) * (1 - 0.18 * p.getY(i) / height));
  geo.computeVertexNormals();
  return masonryUV(geo);
}
