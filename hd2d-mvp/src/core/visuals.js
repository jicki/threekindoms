// 素材引用只接受内置目录、既有动作编号或服务端内容哈希，不接受任意 URL。
export const FEMALE_PRESETS = [
  { key: 'sun', name: '孙尚香', hp: 82, war: 85, int: 68, virtue: 75, year: 209, birthYear: null, city: 15, death: 240, army: '平' },
  { key: 'zhen', name: '甄宓', hp: 70, war: 55, int: 87, virtue: 82, year: 200, birthYear: 183, city: 4, death: 221, army: '水' },
  { key: 'diao', name: '貂蝉', hp: 74, war: 63, int: 84, virtue: 76, year: 191, birthYear: null, city: 8, death: 240, army: '山' },
];
export const FEMALE_SCENARIO_ID = 'builtin-female';
export const FEMALE_SCENARIO_NAME = '巾帼群英';
export const MOODS = ['calm', 'joy', 'angry', 'grief'];
const BUILTIN = /^b-(sun|zhen|diao)-(portrait|calm|joy|angry|grief|motion)$/;
const UPLOAD = /^a-[a-f0-9]{64}$/;
const OFFICER = /^o-(0|[1-9]\d*)$/;

export function validVisualRef(ref, kind, baseCount) {
  if (typeof ref !== 'string') return false;
  if (UPLOAD.test(ref)) return true;
  const built = BUILTIN.exec(ref);
  if (built) return built[2] === kind;
  const officer = kind === 'motion' && OFFICER.exec(ref);
  return !!officer && Number.isSafeInteger(Number(officer[1])) && Number(officer[1]) < baseCount;
}
export function visualUrl(ref) {
  if (UPLOAD.test(ref ?? '')) return `/api/assets/${ref}`;
  const built = BUILTIN.exec(ref ?? '');
  return built ? `assets/characters/${built[1]}/${built[2]}.${built[2] === 'motion' ? 'png' : 'webp'}` : null;
}
export function visualRefs(visual) {
  if (!visual) return [];
  return [visual.portrait, visual.motion, ...MOODS.map((m) => visual.faces?.[m])].filter(Boolean);
}
export function presetVisual(key) {
  return { portrait: `b-${key}-portrait`, faces: Object.fromEntries(MOODS.map((m) => [m, `b-${key}-${m}`])), motion: `b-${key}-motion` };
}
export function femaleOfficer(base, preset, id, gear = {}) {
  const o = base.officers[0];
  return { id, name: preset.name, hp: preset.hp, war: preset.war, int: preset.int, virtue: preset.virtue,
    loyalty: 80, level: 1, exp: 0, soldiers: 0, weapon: gear.weapon ?? o.weapon, armor: gear.armor ?? o.armor, army: preset.army,
    year: preset.year, death: preset.death, birthYear: preset.birthYear, birthCity: null, portraitId: 0,
    appear: 'search_city', city: preset.city, faction: null, skills: [], visual: presetVisual(preset.key) };
}
