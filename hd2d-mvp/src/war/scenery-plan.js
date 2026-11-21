// 这些配置只被渲染器读取。地形、移动和中断恢复仍以战场的原格子为准。
export function luoyangCourt(siege) {
  if (siege?.style !== 'luoyang' || !siege.moatCells) return null;
  const gate = siege.gates.find(g => g.ring === siege.outer && g.face === 's');
  const palaceGate = siege.gates.find(g => g.ring === siege.inner && g.face === 's');
  return {
    gate,
    paving(x, y) {
      const key = `${x},${y}`;
      if (siege.innerDistrict.has(key)) return true;
      if (!siege.districts.has(key) || y < palaceGate.y || y > gate.y) return false;
      return Math.abs(x - gate.x) <= 1 || y === palaceGate.y + 2;
    },
  };
}
