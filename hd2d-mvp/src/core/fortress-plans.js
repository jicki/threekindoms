// 按城市编号配置。尺寸为东西／南北的半径，单位为格。
// 水岸用实际方位定义。外围城门只在表中指定的方向偏移。
const PLANS = [
  ['frontier', 4, 3, 'dry'],                   // 辽东
  ['frontier', 5, 3, 'dry', null, { n: -1 }],  // 幽州
  ['mountain', 3, 4, 'rock', null, { s: 1 }],  // 并州
  ['harbor', 4, 3, 'bank', 'e'],               // 青州
  ['stone', 5, 3, 'full'],                    // 冀州
  ['frontier', 3, 3, 'dry'],                  // 西安阳
  ['frontier', 5, 3, 'dry', null, { w: 1 }],   // 凉州
  ['mountain', 3, 3, 'rock'],                 // 安定
  ['changan', 5, 5, 'full', null, { w: -1, e: 1 }, [2, 3]],
  ['mountain', 4, 3, 'rock'],                 // 西平关
  ['river', 4, 4, 'bank', 'n'],                // 徐州
  ['stone', 4, 4, 'full'],                    // 兖州
  ['luoyang', 6, 4, 'full', null, { n: -1, s: 1 }, [3, 2]],
  ['stone', 4, 3, 'dry'],                     // 新野
  ['stone', 5, 3, 'full', null, { s: 1 }],     // 豫州
  ['river', 5, 4, 'bank', 'w'],                // 建业
  ['river', 4, 3, 'bank', 's'],                // 扬州
  ['harbor', 4, 4, 'bank', 'e'],               // 建安
  ['harbor', 5, 3, 'bank', 's'],               // 交州
  ['mountain', 3, 4, 'rock', null, { e: 1 }],  // 郁林
  ['river', 4, 3, 'bank', 'e'],                // 江夏
  ['river', 5, 4, 'bank', 's'],                // 荆州
  ['mountain', 4, 3, 'rock', null, { e: -1 }], // 衡阳
  ['river', 4, 4, 'bank', 'w'],                // 长沙
  ['mountain', 3, 4, 'rock'],                 // 零陵
  ['mountain', 5, 3, 'rock'],                 // 汉中
  ['stone', 5, 4, 'full', null, { e: -1 }],    // 成都
  ['mountain', 4, 3, 'bank', 's'],             // 涪陵
  ['mountain', 3, 3, 'rock', null, { s: -1 }], // 云南
  ['mountain', 3, 4, 'rock', null, { w: 1 }],  // 永昌
  ['river', 4, 4, 'bank', 'n', { n: 1 }],      // 襄阳
  ['mountain', 4, 3, 'bank', 's', { s: -1 }],  // 江州
  ['stone', 4, 4, 'dry', null, { w: 1 }],      // 宛城
  ['pass', 4, 3, 'rock'],                     // 虎牢关
  ['pass', 4, 3, 'rock', null, { w: 1, e: 1 }], // 函谷关
  ['pass', 3, 4, 'rock', null, { n: -1, s: -1 }], // 武关
  ['pass', 3, 4, 'rock'],                     // 剑阁
  ['gorge', 3, 4, 'rock', null, { n: 1, s: -1 }], // 望垣峡
  ['harbor', 3, 4, 'bank', 'w'],               // 夷洲
];

export function fortressPlan(id) {
  const [style, x, y, moat, bank, offsets = {}, inner = [2, 2]] = PLANS[id];
  return { style, outer: [x, y], inner, moat, bank, offsets };
}
