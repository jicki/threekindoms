// 城防的材质、屋檐和尺度供两种画面共用。编队、地格与突破消耗由城防规则决定。
const styles = {
  luoyang:  { stone: '#c5af93', light: '#dec6a2', roof: '#743b37', shade: '#47262a', ridge: '#daa658', wood: '#75402a', scale: 1.28, tiers: 3, keep: [2.65, 1.75] },
  changan:  { stone: '#bda181', light: '#d4b48c', roof: '#304e4a', shade: '#203533', ridge: '#d5a765', wood: '#674323', scale: 1.19, tiers: 2, keep: [2.12, 2.35] },
  stone:    { stone: '#9d9687', light: '#c6b89d', roof: '#55534e', shade: '#353531', ridge: '#939485', wood: '#634328', scale: 1, tiers: 1, keep: [1.8, 1.36] },
  frontier: { stone: '#ab9073', light: '#c8ac87', roof: '#725240', shade: '#48392c', ridge: '#a48459', wood: '#65422a', scale: 0.89, tiers: 1, keep: [1.55, 1.30] },
  mountain: { stone: '#83857e', light: '#aeb09e', roof: '#414d51', shade: '#303637', ridge: '#909796', wood: '#5c4c3d', scale: 0.96, tiers: 1, keep: [1.46, 1.5] },
  river:    { stone: '#b1aea1', light: '#d1c8b4', roof: '#456961', shade: '#294c48', ridge: '#839d8e', wood: '#684533', scale: 1, tiers: 2, keep: [1.80, 1.38], timberBridge: true },
  harbor:   { stone: '#aaa895', light: '#cac0a2', roof: '#466579', shade: '#2a4555', ridge: '#8da3a3', wood: '#76553c', scale: 0.92, tiers: 1, keep: [1.72, 1.25], timberBridge: true },
  pass:     { stone: '#a19276', light: '#baaa88', roof: '#5b483a', shade: '#3a3028', ridge: '#a49473', wood: '#573d28', scale: 1.08, tiers: 1, keep: [1.10, 0.80] },
  gorge:    { stone: '#767469', light: '#aaa490', roof: '#424b46', shade: '#2d3431', ridge: '#81897d', wood: '#503d2c', scale: 0.87, tiers: 1, keep: [1.0, 0.70], timberBridge: true },
};

export const fortressStyle = siege => styles[siege?.style];

export function rampartProfile(style, outer, corner) {
  return { height: (outer ? 0.81 : 0.57) * style.scale, base: corner ? 0.98 : outer ? 0.72 : 0.58,
    crown: corner ? 0.74 : outer ? 0.49 : 0.39 };
}

export function hasGateWings(siege, gate) {
  if (!['luoyang', 'changan'].includes(siege.style) || gate.ring !== siege.outer || gate.face !== 's') return false;
  return [-1, 1].every(dx => siege.walls.some(w => w.ring === gate.ring && w.x === gate.x + dx && w.y === gate.y));
}
