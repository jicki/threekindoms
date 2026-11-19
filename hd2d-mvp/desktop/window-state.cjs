// 将上次窗口限制在当前显示器的工作区域内；屏幕移除后回到主屏。
function fitBounds(saved, displays) {
  const areas = displays.map((d) => d.workArea).filter((a) => a && a.width > 0 && a.height > 0);
  if (!areas.length) return { width: 1600, height: 900, maximize: false, fullscreen: false };
  const valid = saved && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(saved[k])) && saved.width > 0 && saved.height > 0;
  const intersection = (a) => valid ? Math.max(0, Math.min(saved.x + saved.width, a.x + a.width) - Math.max(saved.x, a.x)) * Math.max(0, Math.min(saved.y + saved.height, a.y + a.height) - Math.max(saved.y, a.y)) : 0;
  const area = areas.reduce((best, a) => intersection(a) > intersection(best) ? a : best, areas[0]);
  const w = Math.min(area.width, Math.max(1024, valid ? Math.round(saved.width) : 1600));
  const h = Math.min(area.height, Math.max(600, valid ? Math.round(saved.height) : 900));
  const visible = intersection(area) >= 10000;
  const x = Math.max(area.x, Math.min(area.x + area.width - w, visible ? Math.round(saved.x) : area.x + Math.floor((area.width - w) / 2)));
  const y = Math.max(area.y, Math.min(area.y + area.height - h, visible ? Math.round(saved.y) : area.y + Math.floor((area.height - h) / 2)));
  return { x, y, width: w, height: h, maximize: area.width < 1024 || area.height < 600 || saved?.maximize === true, fullscreen: saved?.fullscreen === true };
}
module.exports = { fitBounds };
