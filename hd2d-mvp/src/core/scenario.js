// 版本文件只包含受校验的修改，不接受可执行脚本，也不修改原始数据。
import { FEMALE_SCENARIO_ID, HERO_SCENARIO_ID, ROSTER_SCENARIO_ID, WARLORD_SCENARIO_ID, SOVEREIGN_SCENARIO_ID, MOODS, validVisualRef } from './visuals.js';
import { WEAPON_CATEGORIES, validEquipmentIcon } from './equipment.js';
import { DUEL_SKILLS } from './duel-skills.js';
import { SKILL_VISUALS } from './skill-visuals.js';
export const SCENARIO_FORMAT = 1;
export const ORIGINAL_SCENARIO = 'original';
export const RELATION_KINDS = ['亲属', '夫妻', '朋友', '对手', '师徒', '父子', '兄弟', '姐妹', '结义', '君臣', '同僚', '姻亲', '宿敌'];
export const MAX_PORTRAIT_BYTES = 64 * 1024;
export const MAX_PORTRAIT_SIDE = 384;
const ID = /^v-[a-f0-9]{32}$/;
const TEXT = /^[\p{L}\p{N}· _.-]+$/u;
const clone = (value) => JSON.parse(JSON.stringify(value));
const fail = (message) => { throw new Error(message); };
const obj = (value, label) => { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}格式错误`); };
const text = (value, label, max = 32) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.match(TEXT)?.[0] !== value) fail(`${label}只能包含文字、数字、空格、点或连字符`);
};
const integer = (value, label, min, max) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${label}须为 ${min}–${max} 的整数`);
};
const array = (value, label, max) => { if (!Array.isArray(value) || value.length > max) fail(`${label}数量或格式错误`); };
const keys = (value, allowed, label) => { if (Object.keys(value).some((key) => !allowed.includes(key))) fail(`${label}含有不支持的字段`); };
const portrait = (value) => {
  if (value == null) return;
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_PORTRAIT_BYTES / 3) * 4 + 32) fail('人物图像大小或格式错误');
  const match = /^data:image\/(png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[0] !== value) fail('人物图像只支持 PNG 或 WebP');
  let bytes;
  try { bytes = atob(match[2]); } catch { fail('人物图像编码无效'); }
  if (bytes.length > MAX_PORTRAIT_BYTES || btoa(bytes) !== match[2]) fail('人物图像大小或编码无效');
  const u32 = (at, little = false) => {
    const a = [...bytes.slice(at, at + 4)].map((c) => c.charCodeAt(0));
    if (a.length !== 4) return null;
    if (little) a.reverse();
    return (((a[0] * 256 + a[1]) * 256 + a[2]) * 256 + a[3]) >>> 0;
  };
  let width, height;
  if (match[1] === 'png' && bytes.length >= 33 && bytes.startsWith('\x89PNG\r\n\x1a\n') && u32(8) === 13 && bytes.slice(12, 16) === 'IHDR') {
    width = u32(16); height = u32(20);
  } else if (match[1] === 'webp' && bytes.length >= 30 && bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP'
    && u32(4, true) === bytes.length - 8 && u32(16, true) <= bytes.length - 20) {
    const tag = bytes.slice(12, 16), size = u32(16, true), byte = (i) => bytes.charCodeAt(i);
    if (tag === 'VP8 ' && size >= 10 && bytes.slice(23, 26) === '\x9d\x01\x2a') {
      width = (byte(26) | byte(27) << 8) & 0x3fff; height = (byte(28) | byte(29) << 8) & 0x3fff;
    } else if (tag === 'VP8L' && size >= 5 && byte(20) === 0x2f) {
      const bits = u32(21, true); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
    } else if (tag === 'VP8X' && size >= 10) {
      width = 1 + byte(24) + (byte(25) << 8) + (byte(26) << 16);
      height = 1 + byte(27) + (byte(28) << 8) + (byte(29) << 16);
    }
  }
  if (!width || !height || width > MAX_PORTRAIT_SIDE || height > MAX_PORTRAIT_SIDE) fail('人物图像内容或尺寸无效');
};

// 用双重校验值检测基础数据是否改变；不是用于认证或校验不可信代码。
export function baseSignature(base) {
  const source = JSON.stringify(base);
  let a = 2166136261, b = 2246822519;
  for (let i = 0; i < source.length; i++) {
    const c = source.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619) >>> 0;
    b = Math.imul(b ^ c, 3266489917) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

export function newDraft(base) {
  return { format: SCENARIO_FORMAT, id: null, name: '新游戏版本', base: baseSignature(base), officers: [], weapons: [], skills: [], relations: [], rulers: [] };
}

export function newScenarioId() {
  if (!globalThis.crypto?.getRandomValues) fail('浏览器无法生成安全的版本编号');
  const bytes = new Uint8Array(16); globalThis.crypto.getRandomValues(bytes);
  return `v-${Array.from(bytes, (n) => n.toString(16).padStart(2, '0')).join('')}`;
}

// 只接受已知结构；读取时也要验证，不能假定本地存储或导入文件可信。
export function validateScenario(s, base, { draft = false } = {}) {
  obj(s, '版本');
  keys(s, ['format', 'id', 'name', 'base', 'officers', 'weapons', 'armors', 'skills', 'relations', 'rulers', 'factions', 'rulerPassives', 'fixedAiRecruitment', 'enhancedDisasters', 'smartAiReinforcement', 'cityRaids'], '版本');
  if (s.format !== SCENARIO_FORMAT) fail('不支持的版本文件格式');
  if (!(draft && s.id === null) && s.id !== FEMALE_SCENARIO_ID && s.id !== HERO_SCENARIO_ID && s.id !== ROSTER_SCENARIO_ID && s.id !== WARLORD_SCENARIO_ID && s.id !== SOVEREIGN_SCENARIO_ID && (typeof s.id !== 'string' || !ID.test(s.id))) fail('版本编号无效');
  text(s.name, '版本名称', 40);
  if (s.base !== baseSignature(base)) fail('版本所需的基础数据与当前游戏不一致');
  array(s.officers, '武将', base.officers.length + 100);
  const armors = s.armors === undefined ? [] : s.armors;
  array(s.weapons, '新武器', 64); array(armors, '新防具', 64); array(s.skills, '新技能', 64); array(s.relations, '人物关系', 1000);
  if (s.rulerPassives !== undefined && typeof s.rulerPassives !== 'boolean') fail('君主被动设置无效');
  if (s.fixedAiRecruitment !== undefined && typeof s.fixedAiRecruitment !== 'boolean') fail('电脑补兵设置无效');
  if (s.enhancedDisasters !== undefined && typeof s.enhancedDisasters !== 'boolean') fail('增强灾害设置无效');
  if (s.smartAiReinforcement !== undefined && typeof s.smartAiReinforcement !== 'boolean') fail('电脑补兵优先级设置无效');
  if (s.cityRaids !== undefined && typeof s.cityRaids !== 'boolean') fail('守城事件设置无效');
  if (s.rulers !== undefined) array(s.rulers, '君主候选', base.officers.length + 100);
  const maxOfficer = base.officers.length + s.officers.filter((o) => Number.isInteger(o?.id) && o.id >= base.officers.length).length - 1;
  const factions = s.factions === undefined ? [] : s.factions;
  array(factions, '新势力', 3);
  const homes = new Set(), factionRulers = new Set(base.factions.map((f) => f.ruler));
  for (const [i, f] of factions.entries()) {
    obj(f, '新势力'); keys(f, ['id', 'name', 'ruler', 'city', 'aiProfile', 'opening'], '新势力');
    if (f.id !== base.factions.length + i) fail('新势力编号不连续');
    text(f.name, '势力名称');
    integer(f.ruler, '势力君主', 0, maxOfficer); integer(f.city, '势力开局城市', 0, base.cities.length - 1);
    integer(f.aiProfile, '势力电脑策略', 0, base.factions.length - 1);
    if (f.opening !== undefined) {
      obj(f.opening, '开局资源'); keys(f.opening, ['gold', 'rice', 'reserve'], '开局资源');
      for (const key of ['gold', 'rice', 'reserve']) if (f.opening[key] !== undefined) integer(f.opening[key], '开局资源', 0, 9999);
    }
    if (base.cities[f.city].faction !== base.factions.length || base.cities[f.city].officers.length || homes.has(f.city)) fail('新势力须占用不同的原版无主空城');
    if (factionRulers.has(f.ruler)) fail('势力君主重复');
    homes.add(f.city); factionRulers.add(f.ruler);
  }
  const allFactions = [...base.factions, ...factions];
  const ownerForCity = (id) => {
    const home = factions.find((f) => f.city === id), owner = base.cities[id]?.faction;
    return home?.id ?? (owner === base.factions.length ? allFactions.length : owner);
  };
  const seenOfficers = new Set(), seenRelations = new Set();
  const equipment = [...s.weapons.map((item) => ({ item, kind: 'weapon' })), ...armors.map((item) => ({ item, kind: 'armor' }))];
  const equipmentKinds = new Map();
  for (const { item, kind } of equipment) {
    obj(item, kind === 'weapon' ? '武器' : '防具');
    integer(item.id, '新装备编号', base.equipment.length, base.equipment.length + equipment.length - 1);
    if (equipmentKinds.has(item.id)) fail('新装备编号重复');
    equipmentKinds.set(item.id, kind);
  }
  const shops = (item) => {
    array(item.shops, '售卖城市', base.cities.length);
    for (const city of item.shops) { integer(city, '售卖城市', 0, base.cities.length - 1); if (!base.cities[city].facilities.weapons) fail('只能在设有武器屋的城市售卖'); }
    if (new Set(item.shops).size !== item.shops.length) fail('售卖城市重复');
  };
  const requirements = (item) => {
    if (item.grade !== undefined) integer(item.grade, '装备品级', 1, 5);
    if (item.requirements === undefined) return;
    const r = item.requirements; obj(r, '购买条件'); keys(r, ['war', 'int', 'virtue', 'officers'], '购买条件');
    for (const [key, label] of [['war', '最低武力'], ['int', '最低智力'], ['virtue', '最低人德']]) {
      if (r[key] !== undefined) integer(r[key], label, 1, 99);
    }
    if (r.officers !== undefined) {
      array(r.officers, '指定武将', maxOfficer + 1);
      if (!r.officers.length) fail('指定武将不能为空');
      for (const id of r.officers) integer(id, '指定武将', 0, maxOfficer);
      if (new Set(r.officers).size !== r.officers.length) fail('指定武将重复');
    }
  };
  for (const w of s.weapons) {
    keys(w, ['id', 'name', 'cat', 'atk', 'weight', 'price', 'icon', 'shops', 'grade', 'requirements'], '武器');
    text(w.name, '武器名称');
    if (!WEAPON_CATEGORIES.includes(w.cat)) fail('武器类型无效');
    integer(w.atk, '武器攻击', 0, 99); integer(w.weight, '武器重量', 0, 99); integer(w.price, '武器价格', 0, 9999);
    if (!validEquipmentIcon(w.icon, 'weapon')) fail('武器图标无效');
    shops(w); requirements(w);
  }
  for (const a of armors) {
    keys(a, ['id', 'name', 'dfn', 'weight', 'price', 'icon', 'shops', 'grade', 'requirements'], '防具');
    text(a.name, '防具名称'); integer(a.dfn, '防具防御', 0, 99); integer(a.weight, '防具重量', 0, 99); integer(a.price, '防具价格', 0, 9999);
    if (!validEquipmentIcon(a.icon, 'armor')) fail('防具图标无效');
    shops(a); requirements(a);
  }
  for (let i = 0; i < s.skills.length; i++) {
    const skill = s.skills[i]; obj(skill, '技能');
    keys(skill, ['id', 'name', 'cost', 'soldiers', 'hp', 'stop', 'rice', 'maxUses', 'visualEffect'], '技能');
    if (skill.id !== 16 + i) fail('新技能编号不连续');
    text(skill.name, '技能名称'); integer(skill.cost, '技能机动力', 1, 60);
    integer(skill.soldiers, '损兵', 0, 1000); integer(skill.hp, '体力伤害', 0, 99);
    integer(skill.stop, '限制移动天数', 0, 10); integer(skill.rice, '粮草损失', 0, 9999);
    if (skill.maxUses !== undefined) integer(skill.maxUses, '每场使用次数', 1, 3);
    if (skill.visualEffect !== undefined && (typeof skill.visualEffect !== 'string' || !Object.hasOwn(SKILL_VISUALS, skill.visualEffect))) fail('技能演出无效');
    if (!skill.soldiers && !skill.hp && !skill.stop && !skill.rice) fail('技能至少需要一种效果');
  }
  for (const o of s.officers) {
    obj(o, '武将'); keys(o, ['id', 'name', 'hp', 'war', 'int', 'virtue', 'loyalty', 'level', 'exp', 'soldiers', 'weapon', 'armor', 'army', 'year', 'death', 'birthYear', 'birthCity', 'portraitId', 'portraitData', 'appear', 'city', 'faction', 'skills', 'duelSkill', 'visual', 'searchPriority'], '武将');
    integer(o.id, '武将编号', 0, maxOfficer);
    if (seenOfficers.has(o.id)) fail('武将编号重复'); seenOfficers.add(o.id);
    text(o.name, '武将姓名');
    for (const [key, label, min, max] of [['hp', '体力', 1, 99], ['war', '武力', 1, 99], ['int', '智力', 1, 99], ['virtue', '人德', 1, 99], ['loyalty', '忠诚', 0, 100], ['level', '等级', 1, 8], ['exp', '经验', 0, 49999], ['soldiers', '兵数', 0, 1000], ['year', '登场年份', 0, 9999], ['death', '寿命年份', 0, 9999], ['portraitId', '人物图像', 0, base.officers.length - 1]]) integer(o[key], label, min, max);
    portrait(o.portraitData);
    if (o.visual !== undefined) {
      obj(o.visual, '人物素材'); keys(o.visual, ['portrait', 'faces', 'motion'], '人物素材');
      for (const kind of ['portrait', 'motion']) if (o.visual[kind] !== undefined && !validVisualRef(o.visual[kind], kind, base.officers.length)) fail('人物素材引用无效');
      if (o.visual.faces !== undefined) {
        obj(o.visual.faces, '人物表情'); keys(o.visual.faces, MOODS, '人物表情');
        for (const [kind, ref] of Object.entries(o.visual.faces)) if (!validVisualRef(ref, kind, base.officers.length)) fail('人物表情引用无效');
      }
    }
    if (o.birthYear !== null) integer(o.birthYear, '出生年份', 0, 9999);
    if (o.birthCity !== null) integer(o.birthCity, '出生地', 0, base.cities.length - 1);
    if (o.birthYear !== null && o.birthYear > o.year) fail('出生年份不能晚于登场年份');
    if (o.death < o.year) fail('寿命年份不能早于登场年份');
    const lastEquipment = base.equipment.length + equipment.length - 1;
    integer(o.weapon, '武器', 0, lastEquipment);
    if ((base.equipment[o.weapon]?.kind ?? equipmentKinds.get(o.weapon)) !== 'weapon') fail('武器不能选择防具');
    integer(o.armor, '防具', 0, lastEquipment - 24);
    if ((base.equipment[24 + o.armor]?.kind ?? equipmentKinds.get(24 + o.armor)) !== 'armor') fail('防具不能选择武器');
    if (!['平', '山', '水'].includes(o.army)) fail('兵种无效');
    if (!['initial', 'search_city', 'automatic_faction'].includes(o.appear)) fail('登场方式无效');
    if (o.searchPriority !== undefined && typeof o.searchPriority !== 'boolean') fail('搜索优先设置无效');
    if (o.searchPriority && o.appear !== 'search_city') fail('只有城市搜索登场的武将可以优先搜索');
    if (o.appear === 'automatic_faction') {
      if (o.city !== null) fail('自动出仕的武将不能指定登场城市');
      integer(o.faction, '出仕势力', 0, allFactions.length - 1);
    } else {
      integer(o.city, '登场城市', 0, base.cities.length - 1);
      if (o.appear === 'search_city') { if (o.faction !== null) fail('搜索登场的武将不能预设势力'); }
      else {
        integer(o.faction, '所属势力', 0, allFactions.length - 1);
        if (ownerForCity(o.city) !== o.faction) fail('开局城市不属于所选势力');
        if (o.year > 189) fail('开局登场的年份不能晚于 189 年');
      }
    }
    const ruler = allFactions.find((f) => f.ruler === o.id);
    if (ruler && (o.appear !== 'initial' || o.city !== (ruler.city ?? base.officers[o.id].city) || o.faction !== ruler.id)) fail('君主的开局城市和势力不能改变');
    array(o.skills, '武将技能', 64);
    for (const id of o.skills) integer(id, '技能编号', 16, 15 + s.skills.length);
    if (new Set(o.skills).size !== o.skills.length) fail('武将技能重复');
    if (o.duelSkill !== undefined && (typeof o.duelSkill !== 'string' || !Object.hasOwn(DUEL_SKILLS, o.duelSkill))) fail('单挑技无效');
  }
  for (let id = base.officers.length; id <= maxOfficer; id++) if (!seenOfficers.has(id)) fail('新武将编号不连续');
  for (const f of factions) {
    const ruler = s.officers.find((o) => o.id === f.ruler) ?? base.officers[f.ruler];
    if (!ruler || ruler.appear !== 'initial' || ruler.city !== f.city || ruler.faction !== f.id) fail('新势力君主必须在该势力开局城市');
  }
  for (const r of s.relations) {
    obj(r, '人物关系'); keys(r, ['from', 'to', 'kind'], '人物关系');
    integer(r.from, '关系起点', 0, maxOfficer); integer(r.to, '关系终点', 0, maxOfficer);
    if (r.from === r.to) fail('人物关系无效');
    text(r.kind, '关系名称', 16);
    const key = `${r.from}:${r.to}:${r.kind}`; if (seenRelations.has(key)) fail('人物关系重复'); seenRelations.add(key);
  }
  const seenRulers = new Set();
  for (const r of s.rulers ?? []) {
    obj(r, '君主候选'); keys(r, ['faction', 'officer'], '君主候选');
    integer(r.faction, '候选所属势力', 0, allFactions.length - 1);
    integer(r.officer, '候选武将', 0, maxOfficer);
    const officer = s.officers.find((o) => o.id === r.officer) ?? base.officers[r.officer];
    if (!officer || officer.appear !== 'initial' || officer.faction !== r.faction || ownerForCity(officer.city) !== r.faction) fail('君主候选必须为该势力开局武将');
    if (allFactions[r.faction].ruler === r.officer || seenRulers.has(r.officer)) fail('君主候选重复');
    seenRulers.add(r.officer);
  }
  return true;
}

export function applyScenario(base, scenario, { draft = false } = {}) {
  validateScenario(scenario, base, { draft });
  const d = clone(base), modifiedQueues = new Set();
  const extraFactions = scenario.factions ?? [];
  if (extraFactions.length) {
    const neutral = base.factions.length + extraFactions.length;
    for (const city of d.cities) if (city.faction === base.factions.length) city.faction = neutral;
    for (const f of extraFactions) {
      d.factions.push({ id: f.id, name: f.name, ruler: f.ruler, aiProfile: f.aiProfile });
      Object.assign(d.cities[f.city], f.opening ?? {}, { faction: f.id });
    }
    d.rules.turn_orders = d.rules.turn_orders.map((order, index) => order.flatMap((id, at) => {
      const next = extraFactions.findIndex((_, n) => at === Math.floor((n + 1) * order.length / (extraFactions.length + 1)));
      return next < 0 ? [id] : [id, extraFactions[(next + index) % extraFactions.length].id];
    }));
  }
  d.customSkills = clone(scenario.skills);
  d.rulerPassives = scenario.rulerPassives === true;
  d.fixedAiRecruitment = scenario.fixedAiRecruitment === true;
  d.enhancedDisasters = scenario.enhancedDisasters === true;
  d.smartAiReinforcement = scenario.smartAiReinforcement === true;
  d.cityRaids = scenario.cityRaids === true;
  d.relationships = clone(scenario.relations);
  d.rulerCandidates = clone(scenario.rulers ?? []);
  const equipment = [...scenario.weapons.map((item) => ({ item, kind: 'weapon' })), ...(scenario.armors ?? []).map((item) => ({ item, kind: 'armor' }))];
  for (const { item, kind } of equipment.sort((a, b) => a.item.id - b.item.id)) {
    d.equipment.push({ id: item.id, name: item.name, kind, cat: kind === 'weapon' ? item.cat : '防具', atk: kind === 'weapon' ? item.atk : 0,
      dfn: kind === 'armor' ? item.dfn : 0, weight: item.weight, price: item.price, icon: item.icon,
      ...(item.grade !== undefined ? { grade: item.grade } : {}), ...(item.requirements !== undefined ? { requirements: clone(item.requirements) } : {}) });
    for (const city of item.shops) {
      d.cities[city].shop.push(item.id); d.cities[city].field_shop.push(item.id); d.cities[city].ai_shop.push(item.id);
    }
  }
  for (const o of [...scenario.officers].sort((a, b) => a.id - b.id)) {
    const prior = base.officers[o.id], moves = !prior || prior.appear !== o.appear || prior.city !== o.city || prior.faction !== o.faction;
    if (moves) {
      for (const c of d.cities) c.officers = c.officers.filter((id) => id !== o.id);
      for (const [key, ids] of Object.entries(d.search_table)) if (ids.includes(o.id)) { d.search_table[key] = ids.filter((id) => id !== o.id); modifiedQueues.add(`search:${key}`); }
      for (const [key, ids] of Object.entries(d.join_table)) if (ids.includes(o.id)) { d.join_table[key] = ids.filter((id) => id !== o.id); modifiedQueues.add(`join:${key}`); }
      if (o.appear === 'initial') d.cities[o.city].officers.push(o.id);
      else {
        const table = o.appear === 'search_city' ? d.search_table : d.join_table, key = String(o.appear === 'search_city' ? o.city : o.faction);
        (table[key] ||= []).push(o.id); modifiedQueues.add(`${o.appear === 'search_city' ? 'search' : 'join'}:${key}`);
      }
    } else if (prior.year !== o.year && o.appear !== 'initial') {
      modifiedQueues.add(`${o.appear === 'search_city' ? 'search' : 'join'}:${o.appear === 'search_city' ? o.city : o.faction}`);
    }
    d.officers[o.id] = { ...(prior || { id: o.id, jp: o.name }), ...clone(o) };
  }
  // 君主是所在城市的太守；旧武将编号可能排在新君主之前。
  for (const f of extraFactions) {
    const city = d.cities[f.city]; city.officers = [f.ruler, ...city.officers.filter((id) => id !== f.ruler)];
  }
  for (const c of d.cities) {
    if (c.officers.length > 10) fail(`${c.name}的开局武将超过 10 人`);
    // 与游戏中武将全部离城时一致：空城不再属于原势力。
    if (!c.officers.length) c.faction = d.factions.length;
  }
  for (const item of modifiedQueues) {
    const [kind, key] = item.split(':'), ids = (kind === 'search' ? d.search_table : d.join_table)[key];
    ids.sort((a, b) => d.officers[a].year - d.officers[b].year);
  }
  return d;
}
