// The 战略地图's city tags (DOM .ctag), spaced the same on the 3D map and the flat one.
// A mark is { el, dy, w, h }; an entry is { m: mark, s: scale, d: nearness (smaller goes first), keep: wanted right now, x, y0: the tag's middle on screen, foot: how far below that its city's anchor is (0 if there), px }.

// Tag sizes, read once after their text or form changes; false while they have no size yet (their layer hidden, say).
export function measureTags(marks) {
  for (const m of marks) { m.w = m.el.offsetWidth; m.h = m.el.offsetHeight; }
  return marks.every((m) => m.w > 0);
}

// Tags that would cover one another step up out of the way on a thin leader to their city, the wanted and
// nearest first (T14: 新野 under 洛阳, 豫州 over 兖州 at the default view).
export function layoutTags(entries, { dt }) {
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
    placed.push({ x, y: y0 + dy, w, h });
    m.dy += (dy - m.dy) * ease;
    m.el.style.setProperty('--dy', `${m.dy.toFixed(1)}px`);
    m.el.style.setProperty('--lead', `${Math.max(0, (-m.dy - h * 0.55 + foot) / s).toFixed(1)}px`);
  }
}
