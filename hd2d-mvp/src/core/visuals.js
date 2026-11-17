// 素材引用只接受内置目录、既有动作编号或服务端内容哈希，不接受任意 URL。
export const FEMALE_PRESETS = [
  { key: 'sun', name: '孙尚香', hp: 82, war: 85, int: 68, virtue: 75, year: 209, birthYear: null, city: 15, death: 240, army: '平' },
  { key: 'zhen', name: '甄宓', hp: 70, war: 55, int: 87, virtue: 82, year: 200, birthYear: 183, city: 4, death: 221, army: '水' },
  { key: 'diao', name: '貂蝉', hp: 74, war: 63, int: 84, virtue: 76, year: 191, birthYear: null, city: 8, death: 240, army: '山' },
];
// 新角色只进入新的扩展版本，避免旧版存档中动态武将的编号被占用。
export const EXTRA_PRESETS = [
  { key: 'cai', name: '蔡琰', hp: 70, war: 30, int: 90, virtue: 80, year: 207, birthYear: null, city: 8, death: 240, army: '平' },
  { key: 'wang', name: '王异', hp: 80, war: 80, int: 82, virtue: 86, year: 213, birthYear: null, city: 6, death: 240, army: '山' },
  { key: 'chen', name: '陈宫', hp: 75, war: 55, int: 92, virtue: 76, year: 192, birthYear: null, city: 11, death: 198, army: '平', searchPriority: true },
  { key: 'gao', name: '高顺', hp: 85, war: 90, int: 73, virtue: 82, year: 192, birthYear: null, city: 12, death: 198, army: '平', weapon: 20, armor: 4, searchPriority: true },
];
// 素材暂复用内置人物，允许管理员在版本编辑器中替换；两人的出生资料缺乏可靠记载。
export const ROSTER_PRESETS = [
  { key: 'dao', name: '陈到', hp: 85, war: 86, int: 73, virtue: 90, year: 196, birthYear: null, city: 14, death: 240, army: '平', weapon: 20, armor: 2, visualKey: 'gao', searchPriority: true },
  { key: 'xin', name: '辛宪英', hp: 68, war: 28, int: 90, virtue: 86, year: 207, birthYear: null, city: 14, death: 269, army: '平', visualKey: 'cai', searchPriority: true },
];
// 开局年份与城市按十势力剧本设定；资料不明的出生信息留空。
export const WARLORD_PRESETS = [
  { key: 'gongsun', name: '公孙瓒', hp: 88, war: 85, int: 67, virtue: 60, year: 189, birthYear: null, city: 0, death: 199, army: '平', weapon: 18, armor: 2, visualKey: 'gao', soldiers: 800, faction: 7 },
  { key: 'yuanshu', name: '袁术', hp: 75, war: 65, int: 55, virtue: 35, year: 189, birthYear: null, city: 13, death: 199, army: '平', weapon: 10, armor: 2, visualKey: 'gao', soldiers: 800, faction: 8 },
  { key: 'liubiao', name: '刘表', hp: 74, war: 52, int: 82, virtue: 76, year: 189, birthYear: null, city: 21, death: 208, army: '平', weapon: 1, armor: 1, visualKey: 'chen', soldiers: 700, faction: 9 },
  { key: 'guanjing', name: '关靖', hp: 66, war: 38, int: 80, virtue: 58, year: 189, birthYear: null, city: 0, death: 199, army: '平', weapon: 1, armor: 0, visualKey: 'chen', soldiers: 300, faction: 7 },
  { key: 'tiankai', name: '田楷', hp: 80, war: 76, int: 60, virtue: 65, year: 189, birthYear: null, city: 0, death: 199, army: '平', weapon: 18, armor: 2, visualKey: 'gao', soldiers: 500, faction: 7 },
  { key: 'yanxiang', name: '阎象', hp: 66, war: 35, int: 84, virtue: 76, year: 189, birthYear: null, city: 13, death: 240, army: '平', weapon: 1, armor: 0, visualKey: 'chen', soldiers: 300, faction: 8 },
  { key: 'zhangxun', name: '张勋', hp: 79, war: 78, int: 54, virtue: 50, year: 189, birthYear: null, city: 13, death: 240, army: '平', weapon: 18, armor: 2, visualKey: 'gao', soldiers: 500, faction: 8 },
  { key: 'caimao', name: '蔡瑁', hp: 78, war: 73, int: 70, virtue: 45, year: 189, birthYear: null, city: 21, death: 240, army: '水', weapon: 10, armor: 2, visualKey: 'gao', soldiers: 500, faction: 9 },
];
// 新阵容使用独立版本编号，避免占用十方诸侯旧记录中的动态武将编号。
export const SOVEREIGN_PRESETS = [
  { key: 'tianyu', name: '田豫', hp: 80, war: 78, int: 82, virtue: 86, year: 189, birthYear: null, city: 0, death: 252, army: '平', weapon: 18, armor: 2, appear: 'initial', faction: 7, soldiers: 400 },
  { key: 'qiaorui', name: '乔蕤', hp: 78, war: 77, int: 54, virtue: 55, year: 189, birthYear: null, city: 13, death: 197, army: '平', weapon: 18, armor: 2, appear: 'initial', faction: 8, soldiers: 500 },
  { key: 'huangzu', name: '黄祖', hp: 80, war: 75, int: 58, virtue: 48, year: 189, birthYear: null, city: 21, death: 208, army: '水', weapon: 10, armor: 2, appear: 'initial', faction: 9, soldiers: 500 },
  { key: 'liuqi', name: '刘琦', hp: 70, war: 45, int: 72, virtue: 75, year: 191, birthYear: null, city: 21, death: 209, army: '水', weapon: 1, armor: 1, appear: 'automatic_faction', faction: 9 },
  { key: 'xunyou', name: '荀攸', hp: 70, war: 32, int: 94, virtue: 85, year: 192, birthYear: 157, city: 8, death: 214, army: '平', weapon: 1, armor: 0, searchPriority: true },
  { key: 'qianzhao', name: '牵招', hp: 81, war: 79, int: 82, virtue: 87, year: 191, birthYear: null, city: 4, death: 240, army: '平', weapon: 18, armor: 2, searchPriority: true },
  { key: 'huangshi', name: '黄夫人', hp: 70, war: 30, int: 90, virtue: 86, year: 207, birthYear: null, city: 21, death: 240, army: '平', weapon: 1, armor: 0, searchPriority: true },
  { key: 'zhurong', name: '祝融夫人', hp: 82, war: 83, int: 65, virtue: 70, year: 225, birthYear: null, city: 28, death: 240, army: '山', weapon: 18, armor: 2, searchPriority: true },
];
export const CHARACTER_PRESETS = [...FEMALE_PRESETS, ...EXTRA_PRESETS];
export const OFFICER_PRESETS = [...CHARACTER_PRESETS, ...ROSTER_PRESETS, ...WARLORD_PRESETS, ...SOVEREIGN_PRESETS];
// 新风格保留旧素材引用，历史版本和已发布版本不会被覆盖。
export const THEME_PRESETS = OFFICER_PRESETS.map((p) => ({ key: `v2-${p.key}`, name: `${p.name}（新风格）` }));
export const VISUAL_PRESETS = [...CHARACTER_PRESETS, ...SOVEREIGN_PRESETS, ...THEME_PRESETS];
export const FEMALE_SCENARIO_ID = 'builtin-female';
export const FEMALE_SCENARIO_NAME = '巾帼群英';
export const HERO_SCENARIO_ID = 'builtin-heroes';
export const HERO_SCENARIO_NAME = '群英新篇';
export const ROSTER_SCENARIO_ID = 'builtin-heroes-roster';
export const ROSTER_SCENARIO_NAME = '群英新篇·新阵容';
export const WARLORD_SCENARIO_ID = 'builtin-warlords';
export const WARLORD_SCENARIO_NAME = '群英新篇·十方诸侯';
export const SOVEREIGN_SCENARIO_ID = 'builtin-sovereigns';
export const SOVEREIGN_SCENARIO_NAME = '群英新篇·君主列传';
export const MOODS = ['calm', 'joy', 'angry', 'grief'];
const BUILTIN = /^b-(sun|zhen|diao|cai|wang|chen|gao|gongsun|yuanshu|liubiao|tianyu|qiaorui|huangzu|liuqi|xunyou|qianzhao|huangshi|zhurong|v2-(?:sun|zhen|diao|cai|wang|chen|gao|dao|xin|gongsun|yuanshu|liubiao|guanjing|tiankai|yanxiang|zhangxun|caimao|tianyu|qiaorui|huangzu|liuqi|xunyou|qianzhao|huangshi|zhurong))-(portrait|calm|joy|angry|grief|motion)$/;
const MOTION_ONLY = new Set(['gongsun', 'yuanshu', 'liubiao']);
const builtinAllowed = (match) => !(match[2] === 'motion' && match[1].startsWith('v2-')) && (!MOTION_ONLY.has(match[1]) || match[2] === 'motion');
const UPLOAD = /^a-[a-f0-9]{64}$/;
const OFFICER = /^o-(0|[1-9]\d*)$/;

export function validVisualRef(ref, kind, baseCount) {
  if (typeof ref !== 'string') return false;
  if (UPLOAD.test(ref)) return true;
  const built = BUILTIN.exec(ref);
  if (built) return built[2] === kind && builtinAllowed(built);
  const officer = kind === 'motion' && OFFICER.exec(ref);
  return !!officer && Number.isSafeInteger(Number(officer[1])) && Number(officer[1]) < baseCount;
}
export function visualUrl(ref) {
  if (UPLOAD.test(ref ?? '')) return `/api/assets/${ref}`;
  const built = BUILTIN.exec(ref ?? '');
  return built && builtinAllowed(built) ? `assets/characters/${built[1]}/${built[2]}.${built[2] === 'motion' ? 'png' : 'webp'}` : null;
}
export function visualRefs(visual) {
  if (!visual) return [];
  return [visual.portrait, visual.motion, ...MOODS.map((m) => visual.faces?.[m])].filter(Boolean);
}
export function presetVisual(key) {
  // 三位君主使用专属动作，其余未配置独立动作的角色沿用既有素材。
  const oldMotion = { dao: 'gao', xin: 'cai', guanjing: 'chen', tiankai: 'gao', yanxiang: 'chen', zhangxun: 'gao', caimao: 'gao' };
  const raw = key.startsWith('v2-') ? key.slice(3) : key;
  const motion = key.startsWith('v2-') ? oldMotion[raw] ?? raw : key;
  return { portrait: `b-${key}-portrait`, faces: Object.fromEntries(MOODS.map((m) => [m, `b-${key}-${m}`])), motion: `b-${motion}-motion` };
}
export function femaleOfficer(base, preset, id, gear = {}) {
  const o = base.officers[0];
  return { id, name: preset.name, hp: preset.hp, war: preset.war, int: preset.int, virtue: preset.virtue,
    loyalty: 80, level: 1, exp: 0, soldiers: 0, weapon: preset.weapon ?? gear.weapon ?? o.weapon, armor: preset.armor ?? gear.armor ?? o.armor, army: preset.army,
    year: preset.year, death: preset.death, birthYear: preset.birthYear, birthCity: null, portraitId: 0,
    appear: 'search_city', city: preset.city, faction: null, skills: [], ...(preset.searchPriority ? { searchPriority: true } : {}), visual: presetVisual(preset.visualKey ?? preset.key) };
}
