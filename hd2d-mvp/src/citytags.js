// The 战略地图's city tags (DOM .ctag), spaced the same on the 3D map and the flat one.
// A mark is { el, dy, w, h }; an entry is { m: mark, s: scale, d: nearness (smaller goes first), keep: wanted right now, x, y0: the tag's middle on screen, foot: how far below that its city's anchor is (0 if there), px }.

// Tag sizes, read once after their text or form changes; false while they have no size yet (their layer hidden, say).
export function measureTags(marks) {
  for (const m of marks) { m.w = m.el.offsetWidth; m.h = m.el.offsetHeight; }
  return marks.every((m) => m.w > 0);
}

// Tags that would cover one another move out of the way on a thin leader to their city, the wanted and nearest first.
export function layoutTags(entries, { dt, spread = false, bounds = null }) {
  const placed = [], ease = 1 - Math.exp(-dt * 10);
  entries.sort((a, b) => b.keep - a.keep || a.d - b.d);
  for (const { m, s, x, y0, foot = 0 } of entries) {
    if (!m.w) continue;
    const w = m.w * s, h = m.h * s;
    let dy = 0;
    for (let k = 0; k < Math.min(12, entries.length); k++) {
      const hit = placed.find((r) => Math.abs(r.x - x) < (r.w + w) / 2 + 2 && Math.abs(r.y - (y0 + dy)) < (r.h + h) / 2 + 1);
      if (!hit) break;
      dy = hit.y - (hit.h + h) / 2 - 2 - y0;
    }
    let dx = 0;
    // 密集据点优先在附近找空位，避免一串标签被逐个顶出手机顶栏。
    if (spread && (dy < -h * 1.6 || (bounds && y0 >= bounds.top && y0 - h / 2 + dy < bounds.top))) {
      const nearby = placed.filter((r) => Math.abs(r.x - x) < (r.w + w) / 2 + w * 2 && Math.abs(r.y - y0) < h * 5);
      const xs = [0];
      for (const r of nearby) xs.push(r.x - (r.w + w) / 2 - 3 - x, r.x + (r.w + w) / 2 + 3 - x);
      let best = null;
      for (const xx of xs) {
        if (Math.abs(xx) > w * 3) continue;
        if (bounds && x >= bounds.left && x <= bounds.right && (x + xx - w / 2 < bounds.left || x + xx + w / 2 > bounds.right)) continue;
        const relevant = nearby.filter((r) => Math.abs(r.x - x - xx) < (r.w + w) / 2 + 2);
        const ys = [0];
        for (const r of relevant) ys.push(r.y - (r.h + h) / 2 - 2 - y0, r.y + (r.h + h) / 2 + 2 - y0);
        for (const yy of ys) {
          if (bounds && y0 >= bounds.top && y0 <= bounds.bottom && (y0 + yy - h / 2 < bounds.top || y0 + yy + h / 2 > bounds.bottom)) continue;
          if (placed.some((r) => Math.abs(r.x - x - xx) < (r.w + w) / 2 + 2 && Math.abs(r.y - y0 - yy) < (r.h + h) / 2 + 1)) continue;
          const cost = xx * xx * 1.1 + yy * yy + (yy > 0 ? 25 : 0);
          if (!best || cost < best.cost) best = { dx: xx, dy: yy, cost };
        }
      }
      if (best) { dx = best.dx; dy = best.dy; }
    }
    placed.push({ x: x + dx, y: y0 + dy, w, h });
    m.dy += (dy - m.dy) * ease;
    m.dx = (m.dx ?? 0) + (dx - (m.dx ?? 0)) * ease;
    m.el.style.setProperty('--dy', `${m.dy.toFixed(1)}px`);
    if (spread) {
      const anchorX = -m.dx, anchorY = foot - m.dy;
      const edgeX = Math.max(-w / 2, Math.min(w / 2, anchorX)), edgeY = Math.max(-h / 2, Math.min(h / 2, anchorY));
      const horizontal = anchorX - edgeX, vertical = anchorY - edgeY;
      const offset = (v) => `calc(50% ${v < 0 ? '-' : '+'} ${Math.abs(v / s).toFixed(1)}px)`;
      m.el.style.setProperty('--dx', `${m.dx.toFixed(1)}px`);
      m.el.style.setProperty('--lead-left', offset(edgeX)); m.el.style.setProperty('--lead-start', offset(edgeY));
      m.el.style.setProperty('--lead', `${(Math.hypot(horizontal, vertical) / s).toFixed(1)}px`);
      m.el.style.setProperty('--lead-angle', `${Math.atan2(-horizontal, vertical)}rad`);
    } else {
      m.el.style.setProperty('--lead', `${Math.max(0, (-m.dy - h * 0.55 + foot) / s).toFixed(1)}px`);
    }
  }
}
