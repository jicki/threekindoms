import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutTags } from '../src/citytags.js';

const makeMark = () => {
  const style = new Map();
  return { w: 44, h: 26, dy: 0, el: { style: { setProperty: (key, value) => style.set(key, value) } }, style };
};

test('扩展地图密集标签可横向错开，仍与各自的据点相连', () => {
  const marks = Array.from({ length: 6 }, makeMark);
  const entries = marks.map((m, i) => ({ m, s: 1, d: i, keep: false, x: 250, y0: 120 }));
  const bounds = { left: 0, right: 812, top: 44, bottom: 375 };
  layoutTags(entries, { dt: 2, spread: true, bounds });
  assert.ok(marks.some((m) => Math.abs(m.dx) > 1), '密集时应利用横向空位');
  for (const [i, m] of marks.entries()) {
    const a = { x: 250 + m.dx, y: 120 + m.dy };
    assert.ok(a.y - m.h / 2 >= bounds.top - 0.1, '标签不能被顶入顶部栏');
    const angle = parseFloat(m.style.get('--lead-angle')), length = parseFloat(m.style.get('--lead'));
    const offset = (key) => { const [, sign, value] = m.style.get(key).match(/([+-]) ([\d.]+)px/); return Number(value) * (sign === '-' ? -1 : 1); };
    const left = offset('--lead-left'), start = offset('--lead-start');
    assert.ok(Number.isFinite(angle) && Number.isFinite(length));
    assert.ok(Math.abs(left - Math.sin(angle) * length + m.dx) < 0.2 && Math.abs(start + Math.cos(angle) * length + m.dy) < 0.2,
      '指引线应回到标签原有据点的位置');
    for (const other of marks.slice(i + 1)) {
      const b = { x: 250 + other.dx, y: 120 + other.dy };
      assert.ok(Math.abs(a.x - b.x) >= (m.w + other.w) / 2 || Math.abs(a.y - b.y) >= (m.h + other.h) / 2, '标签不能互相覆盖');
    }
  }
  const previous = marks.map((m) => [m.dx, m.dy]);
  layoutTags(entries, { dt: 2, spread: true, bounds });
  for (const [i, m] of marks.entries()) assert.ok(Math.hypot(m.dx - previous[i][0], m.dy - previous[i][1]) < 0.1, '静止时布局应保持稳定');
});

test('原版标签沿用原有纵向布局', () => {
  const a = makeMark(), b = makeMark();
  layoutTags([{ m: a, s: 1, d: 0, keep: false, x: 250, y0: 120 },
    { m: b, s: 1, d: 1, keep: false, x: 250, y0: 120 }], { dt: 2 });
  assert.equal(a.dx, 0); assert.equal(b.dx, 0); assert.ok(b.dy < -b.h);
  assert.equal(b.style.has('--dx'), false);
});
