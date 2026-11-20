import { EXTRA_PASSIVES, revisedOfficerPassive } from './officer-passives.js';

export const fullStrategyWeather = (g) => g?.campaignRevision >= 3;
export const advancedBattle = (g) => g?.campaignRevision >= 2;
export const revisedPassives = (g) => g?.campaignRevision >= 8;

export const WEATHER_NAMES = { clear: '晴', rain: '雨', snow: '雪' };
const NORTH = new Set([0, 1, 2, 3, 4, 5, 8, 9, 11, 12, 14, 33, 34, 35, 37]);
export function battleWeather(g, city) {
  if (!advancedBattle(g)) return null;
  if (NORTH.has(city) && [0, 10, 11].includes(g.month)) return 'snow';
  if ([4, 5].includes(g.month) || (!NORTH.has(city) && g.month === 6)) return 'rain';
  return 'clear';
}

export const PASSIVES = {
  kongming: { name: '观天', text: '计策命中阈值＋8，施计与行军免受雨雪影响', strategy: 8, weatherproof: true },
  fire: { name: '火攻', text: '火计类效果伤害＋12%，雨天仍会削弱', fire: 12 },
  water: { name: '水战', text: '乱水、水攻伤害＋12%，雨天行军免受影响', water: 12, rainproof: true },
  calculate: { name: '谋定', text: '计策命中阈值＋5', strategy: 5 },
  range: { name: '深谋', text: '普通远程计策范围＋1格', range: 1 },
  ward: { name: '识计', text: '敌方对本人计策命中阈值－6', ward: 6 },
  charge: { name: '锐进', text: '兵力达到600时，平地行军每格少耗1点，最低1点', march: true },
  mountain: { name: '越险', text: '通过山地少耗1点，最低1点', mountains: 1 },
  duel: { name: '骁勇', text: '单挑攻击命中阈值＋8', duel: 8 },
  endure: { name: '坚忍', text: '每白兵回合自身恢复1体力，须仍在场', recovery: 1 },
  command: { name: '练兵', text: '白兵所带兵队普通攻击伤害＋6%', troops: 6 },
  protection: { name: '严阵', text: '白兵所带兵队受到普通攻击伤害－6%', guard: 6 },
  morale: { name: '振军', text: '白兵每3回合恢复1点战术点，最多恢复2次', tacticRecovery: true },
  county: { name: '理政', text: '执行开发的成果＋1', development: 1 },
  repair: { name: '兴修', text: '执行防灾的成果＋1', prevention: 1 },
  goodwill: { name: '安民', text: '任太守时成功施舍额外提高1点统治', charity: 1 },
  ...EXTRA_PASSIVES,
};
const ASSIGNED = new Map(Object.entries({
  kongming: ['诸葛亮'], fire: ['周瑜', '陆逊', '庞统'], water: ['吕蒙', '鲁肃', '黄祖', '甘宁'],
  calculate: ['荀攸', '郭嘉', '张纮', '杨修'], range: ['法正', '姜维', '钟会', '陈宫'],
  ward: ['司马懿', '司马师', '贾诩', '徐庶'], charge: ['赵云', '马超', '张辽', '公孙瓒', '张绣', '夏侯渊', '文丑'],
  mountain: ['邓艾', '张郃', '祝融夫人', '庞德'], duel: ['关羽', '吕布', '张飞', '许褚', '典韦', '黄忠', '太史慈', '华雄', '颜良'],
  endure: ['夏侯惇', '孙翊', '徐晃'], command: ['孙尚香', '司马昭', '孙策', '田豫'],
  protection: ['于禁', '高顺', '陈到', '王异', '牵招'], morale: ['曹操', '文聘', '刘备'],
  county: ['荀彧', '张昭', '步骘'], repair: ['刘表', '辛宪英'], goodwill: ['诸葛瑾', '蔡琰'],
}).flatMap(([key, names]) => names.map(name => [name, key])));

export function officerPassive(data, g, id) {
  if (!advancedBattle(g)) return null;
  const o = data.officers[id];
  if (!o || o.raidTemp) return null;
  if (Object.hasOwn(PASSIVES, o.passive)) return PASSIVES[o.passive];
  if (revisedPassives(g)) return revisedOfficerPassive(o, PASSIVES);
  const key = !o.clone && ASSIGNED.get(o.name);
  if (key) return PASSIVES[key];
  return o.war >= 86 ? PASSIVES.command : o.int >= 86 ? PASSIVES.calculate : o.virtue >= 75 ? PASSIVES.goodwill : id % 2 ? PASSIVES.county : PASSIVES.repair;
}

// 加成只在交战时生效，按难度封顶，不改存档中的人物原始能力。
export const aiBattleBonus = (g, faction) => advancedBattle(g) && g.factions[faction]?.ai ? [2, 4, 6][g.level] ?? 4 : 0;

export function weatherPenalty(weather, terrain, passive, army) {
  if (passive?.weatherproof || (weather === 'rain' && passive?.rainproof)) return 0;
  if (weather === 'rain' && (terrain === 0 || (terrain === 3 && army !== '水'))) return 1;
  return weather === 'snow' && [0, 2, 4].includes(terrain) ? 1 : 0;
}

// 命中修正按随机表阈值计算。倍率用于直接效果，埋伏的倍率在触发时读取。
const FIRE = [[-10, 85], [-6, 90]];
const WATER = [[8, 115], [-8, 90]];
const STRATEGY_WEATHER = [
  FIRE, [[6, 100], [-4, 100]], [[5, 100], [6, 100]], [[4, 100], [-4, 100]],
  WATER, FIRE, FIRE, FIRE, [[-4, 100], [4, 100]], [[4, 100], [-4, 100]],
  [[8, 100], [-8, 100]], [[0, 110], [0, 108]], WATER, [[-6, 100], [-4, 100]],
  FIRE, null, [[-6, 100], [-8, 100]], [[4, 100], [6, 100]],
];
const NEUTRAL = [0, 100];
export function tacticWeather(g, id, weather, passive) {
  if (passive?.weatherproof || !weather || weather === 'clear') return NEUTRAL;
  if (fullStrategyWeather(g)) return STRATEGY_WEATHER[id]?.[weather === 'rain' ? 0 : 1] ?? NEUTRAL;
  if (weather !== 'rain' || !advancedBattle(g)) return NEUTRAL;
  if ([0, 6, 7, 14].includes(id)) return FIRE[0];
  if (id === 5) return [-10, 100];
  if ([4, 12].includes(id)) return WATER[0];
  return id === 10 ? [8, 100] : NEUTRAL;
}
