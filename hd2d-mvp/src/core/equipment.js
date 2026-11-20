// 新装备图标使用固定白名单，旧版本仍可按原有编号引用素材。
import { REGIONAL_WEAPONS } from './regional-content.js';

const REGIONAL_ICONS = new Set(REGIONAL_WEAPONS.map(({ icon }) => icon));
export const EQUIPMENT_ICONS = [
  { id: 'b-bow', name: '朱雀弓', kind: 'weapon', file: 'bow' },
  { id: 'b-fan', name: '白羽扇', kind: 'weapon', file: 'fan' },
  { id: 'b-female-armor', name: '锦鳞轻甲', kind: 'armor', file: 'armor' },
];
export const WEAPON_CATEGORIES = ['剑', '刀', '枪', '扇', '弓'];

export function validEquipmentIcon(value, kind) {
  if (Number.isSafeInteger(value)) return kind === 'weapon' ? value >= 0 && value < 24 : value >= 24 && value < 32;
  return EQUIPMENT_ICONS.some((icon) => icon.id === value && icon.kind === kind);
}
export function equipmentIconUrl(value) {
  if (Number.isSafeInteger(value) && value >= 0 && value < 32) return `assets/ai/icon/equip/${value}.webp`;
  if (REGIONAL_ICONS.has(value)) return `assets/regional/${value}.webp`;
  const icon = EQUIPMENT_ICONS.find((item) => item.id === value);
  return icon ? `assets/equipment/${icon.file}.webp` : null;
}

// 名称有史籍或演义依据时沿用记载，否则使用可辨认的游戏命名；不改变已有装备编号。
export function addRulerWeapons(draft, base) {
  const specs = [
    ['董卓手戟', '枪', 22, 9, 17], ['袁绍佩刀', '刀', 20, 7, 11], ['倚天剑·孟德', '剑', 21, 7, 6],
    ['伯符枪', '枪', 22, 9, 20], ['双股剑', '剑', 21, 6, 5], ['刘璋佩剑', '剑', 20, 4, 1],
    ['马腾战枪', '枪', 21, 7, 20], ['两刃矛', '枪', 21, 7, 16], ['公路双刀', '刀', 20, 7, 11], ['刘表佩剑', '剑', 20, 4, 2],
  ];
  const rulers = [...base.factions, ...(draft.factions ?? [])];
  const fields = ['id', 'name', 'hp', 'war', 'int', 'virtue', 'loyalty', 'level', 'exp', 'soldiers', 'weapon', 'armor', 'army', 'year', 'death', 'appear', 'city', 'faction'];
  for (const [index, [name, cat, atk, weight, icon]] of specs.entries()) {
    const id = rulers[index].ruler;
    let officer = draft.officers.find((item) => item.id === id);
    if (!officer) {
      const original = base.officers[id];
      officer = { ...Object.fromEntries(fields.map((key) => [key, original[key]])), birthYear: null, birthCity: null, portraitId: id, skills: [] };
      draft.officers.push(officer);
    }
    const weapon = { id: base.equipment.length + draft.weapons.length + (draft.armors?.length ?? 0), name, cat, atk, weight,
      price: 0, icon, grade: 4, shops: [], exclusiveRuler: id };
    draft.weapons.push(weapon); officer.weapon = weapon.id;
  }
}

// 角色模板复用同名同类型的装备；缺少时在版本内追加，编号不因之后添加装备而移动。
export function ensureFemaleGear(draft, base, character, { balanced = false } = {}) {
  const armors = draft.armors ??= [];
  const cityIds = (ids) => base.cities.filter((c) => c.facilities.weapons && (!ids || ids.includes(c.id))).map((c) => c.id);
  const nextId = () => base.equipment.length + draft.weapons.length + armors.length;
  const add = (kind, spec) => {
    const items = kind === 'weapon' ? draft.weapons : armors;
    const existing = items.find((item) => item.name === spec.name && item.icon === spec.icon && (kind !== 'weapon' || item.cat === spec.cat));
    if (existing) return existing;
    const { cities, ...attributes } = spec, item = { id: nextId(), ...attributes, shops: cityIds(cities) };
    items.push(item); return item;
  };
  // 最早的三个编号保持不变，已存档角色仍指向同一装备。
  const bow = add('weapon', { name: '朱雀弓', cat: '弓', atk: 11, weight: 5, price: 220, icon: 'b-bow', grade: 3, cities: [8, 12, 15, 20] });
  const armor = add('armor', { name: '锦鳞轻甲', dfn: 8, weight: 5, price: 220, icon: 'b-female-armor', grade: 3, cities: [4, 8, 12, 15, 20, 26] });
  const fan = add('weapon', { name: '白羽扇', cat: '扇', atk: 8, weight: 3, price: 160, icon: 'b-fan', grade: 3, cities: [4, 8, 12, 15, 20, 26] });
  const weapons = [
    { name: '木弓', cat: '弓', atk: 3, weight: 3, price: 70, icon: 'b-bow', grade: 1 },
    { name: '角弓', cat: '弓', atk: 6, weight: 4, price: 130, icon: 'b-bow', grade: 2 },
    { name: '穿云弓', cat: '弓', atk: 13, weight: 5, price: 300, icon: 'b-bow', grade: 4, requirements: { war: 70 }, cities: [4, 8, 12, 15, 20, 26] },
    { name: '落日弓', cat: '弓', atk: balanced ? 14 : 15, weight: 6, price: 400, icon: 'b-bow', grade: 5, requirements: { war: 85 }, cities: [15, 20] },
    { name: '竹扇', cat: '扇', atk: 3, weight: 2, price: 60, icon: 'b-fan', grade: 1 },
    { name: '轻羽扇', cat: '扇', atk: 5, weight: 2, price: 110, icon: 'b-fan', grade: 2 },
    { name: '玄策扇', cat: '扇', atk: 11, weight: 4, price: 260, icon: 'b-fan', grade: 4, requirements: { int: 75 }, cities: [4, 8, 12, 26] },
    { name: '洛神羽扇', cat: '扇', atk: 14, weight: 4, price: 360, icon: 'b-fan', grade: 5, requirements: { int: 85 }, cities: [4, 12] },
  ];
  const protection = [
    { name: '绫罗轻衣', dfn: 3, weight: 2, price: 80, icon: 'b-female-armor', grade: 1 },
    { name: '银纹战衣', dfn: 5, weight: 3, price: 140, icon: 'b-female-armor', grade: 2 },
    { name: '凤纹轻铠', dfn: 10, weight: 5, price: 300, icon: 'b-female-armor', grade: 4, requirements: { virtue: 70 }, cities: [4, 8, 12, 15, 26] },
    { name: '凤羽宝衣', dfn: balanced ? 11 : 12, weight: balanced ? 5 : 4, price: balanced ? 480 : 420, icon: 'b-female-armor', grade: 5, requirements: { virtue: balanced ? 85 : 80 }, cities: [4, 12, 15] },
  ];
  for (const item of weapons) add('weapon', item);
  for (const item of protection) add('armor', item);
  return { weapon: (character === 'sun' || character === 'wang' ? bow : fan).id, armor: armor.id - 24 };
}
