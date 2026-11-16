// 版本文件只包含受校验的修改，不接受可执行脚本，也不修改原始数据。
export const SCENARIO_FORMAT = 1;
export const ORIGINAL_SCENARIO = 'original';
export const RELATION_KINDS = ['亲属', '夫妻', '朋友', '对手', '师徒'];
const ID = /^v-[a-f0-9]{32}$/;
const TEXT = /^[\p{L}\p{N}· _.-]+$/u;
const clone = (value) => JSON.parse(JSON.stringify(value));
const fail = (message) => { throw new Error(message); };
const obj = (value, label) => { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}格式错误`); };
const text = (value, label, max = 32) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max || !TEXT.test(value)) fail(`${label}只能包含文字、数字、空格、点或连字符`);
};
const integer = (value, label, min, max) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${label}须为 ${min}–${max} 的整数`);
};
const array = (value, label, max) => { if (!Array.isArray(value) || value.length > max) fail(`${label}数量或格式错误`); };
const keys = (value, allowed, label) => { if (Object.keys(value).some((key) => !allowed.includes(key))) fail(`${label}含有不支持的字段`); };

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
  return { format: SCENARIO_FORMAT, id: null, name: '新游戏版本', base: baseSignature(base), officers: [], weapons: [], skills: [], relations: [] };
}

export function newScenarioId() {
  if (!globalThis.crypto?.getRandomValues) fail('浏览器无法生成安全的版本编号');
  const bytes = new Uint8Array(16); globalThis.crypto.getRandomValues(bytes);
  return `v-${Array.from(bytes, (n) => n.toString(16).padStart(2, '0')).join('')}`;
}

// 只接受已知结构；读取时也要验证，不能假定本地存储或导入文件可信。
export function validateScenario(s, base, { draft = false } = {}) {
  obj(s, '版本');
  keys(s, ['format', 'id', 'name', 'base', 'officers', 'weapons', 'skills', 'relations'], '版本');
  if (s.format !== SCENARIO_FORMAT) fail('不支持的版本文件格式');
  if (!(draft && s.id === null) && (typeof s.id !== 'string' || !ID.test(s.id))) fail('版本编号无效');
  text(s.name, '版本名称', 40);
  if (s.base !== baseSignature(base)) fail('版本所需的基础数据与当前游戏不一致');
  array(s.officers, '武将', base.officers.length + 100);
  array(s.weapons, '新武器', 64); array(s.skills, '新技能', 64); array(s.relations, '人物关系', 1000);
  const seenOfficers = new Set(), seenRelations = new Set();
  for (let i = 0; i < s.weapons.length; i++) {
    const w = s.weapons[i]; obj(w, '武器');
    keys(w, ['id', 'name', 'cat', 'atk', 'weight', 'price', 'icon', 'shops'], '武器');
    if (w.id !== base.equipment.length + i) fail('新武器编号不连续');
    text(w.name, '武器名称');
    if (!['剑', '刀', '枪'].includes(w.cat)) fail('武器类型无效');
    integer(w.atk, '武器攻击', 0, 99); integer(w.weight, '武器重量', 0, 99); integer(w.price, '武器价格', 0, 9999);
    integer(w.icon, '武器图标', 0, 23);
    array(w.shops, '售卖城市', base.cities.length);
    for (const city of w.shops) { integer(city, '售卖城市', 0, base.cities.length - 1); if (!base.cities[city].facilities.weapons) fail('只能在设有武器屋的城市售卖'); }
    if (new Set(w.shops).size !== w.shops.length) fail('售卖城市重复');
  }
  for (let i = 0; i < s.skills.length; i++) {
    const skill = s.skills[i]; obj(skill, '技能');
    keys(skill, ['id', 'name', 'cost', 'soldiers', 'hp', 'stop', 'rice'], '技能');
    if (skill.id !== 16 + i) fail('新技能编号不连续');
    text(skill.name, '技能名称'); integer(skill.cost, '技能机动力', 1, 60);
    integer(skill.soldiers, '损兵', 0, 1000); integer(skill.hp, '体力伤害', 0, 99);
    integer(skill.stop, '限制移动天数', 0, 10); integer(skill.rice, '粮草损失', 0, 9999);
    if (!skill.soldiers && !skill.hp && !skill.stop && !skill.rice) fail('技能至少需要一种效果');
  }
  const maxOfficer = base.officers.length + s.officers.filter((o) => Number.isInteger(o?.id) && o.id >= base.officers.length).length - 1;
  for (const o of s.officers) {
    obj(o, '武将'); keys(o, ['id', 'name', 'hp', 'war', 'int', 'virtue', 'loyalty', 'level', 'exp', 'soldiers', 'weapon', 'armor', 'army', 'year', 'death', 'birthYear', 'birthCity', 'portraitId', 'appear', 'city', 'faction', 'skills'], '武将');
    integer(o.id, '武将编号', 0, maxOfficer);
    if (seenOfficers.has(o.id)) fail('武将编号重复'); seenOfficers.add(o.id);
    text(o.name, '武将姓名');
    for (const [key, label, min, max] of [['hp', '体力', 1, 99], ['war', '武力', 1, 99], ['int', '智力', 1, 99], ['virtue', '人德', 1, 99], ['loyalty', '忠诚', 0, 100], ['level', '等级', 1, 8], ['exp', '经验', 0, 49999], ['soldiers', '兵数', 0, 1000], ['armor', '防具', 0, 7], ['year', '登场年份', 0, 9999], ['death', '寿命年份', 0, 9999], ['portraitId', '人物图像', 0, base.officers.length - 1]]) integer(o[key], label, min, max);
    if (o.birthYear !== null) integer(o.birthYear, '出生年份', 0, 9999);
    if (o.birthCity !== null) integer(o.birthCity, '出生地', 0, base.cities.length - 1);
    if (o.birthYear !== null && o.birthYear > o.year) fail('出生年份不能晚于登场年份');
    if (o.death < o.year) fail('寿命年份不能早于登场年份');
    integer(o.weapon, '武器', 0, base.equipment.length + s.weapons.length - 1);
    if (o.weapon >= 24 && o.weapon < base.equipment.length) fail('武器不能选择防具');
    if (!['平', '山', '水'].includes(o.army)) fail('兵种无效');
    if (!['initial', 'search_city', 'automatic_faction'].includes(o.appear)) fail('登场方式无效');
    if (o.appear === 'automatic_faction') {
      if (o.city !== null) fail('自动出仕的武将不能指定登场城市');
      integer(o.faction, '出仕势力', 0, base.factions.length - 1);
    } else {
      integer(o.city, '登场城市', 0, base.cities.length - 1);
      if (o.appear === 'search_city') { if (o.faction !== null) fail('搜索登场的武将不能预设势力'); }
      else {
        integer(o.faction, '所属势力', 0, base.factions.length - 1);
        if (base.cities[o.city].faction !== o.faction) fail('开局城市不属于所选势力');
        if (o.year > 189) fail('开局登场的年份不能晚于 189 年');
      }
    }
    const ruler = base.factions.find((f) => f.ruler === o.id);
    if (ruler && (o.appear !== 'initial' || o.city !== base.officers[o.id].city || o.faction !== ruler.id)) fail('君主的开局城市和势力不能改变');
    array(o.skills, '武将技能', 64);
    for (const id of o.skills) integer(id, '技能编号', 16, 15 + s.skills.length);
    if (new Set(o.skills).size !== o.skills.length) fail('武将技能重复');
  }
  for (let id = base.officers.length; id <= maxOfficer; id++) if (!seenOfficers.has(id)) fail('新武将编号不连续');
  for (const r of s.relations) {
    obj(r, '人物关系'); keys(r, ['from', 'to', 'kind'], '人物关系');
    integer(r.from, '关系起点', 0, maxOfficer); integer(r.to, '关系终点', 0, maxOfficer);
    if (r.from === r.to || !RELATION_KINDS.includes(r.kind)) fail('人物关系无效');
    const key = `${r.from}:${r.to}:${r.kind}`; if (seenRelations.has(key)) fail('人物关系重复'); seenRelations.add(key);
  }
  return true;
}

export function applyScenario(base, scenario, { draft = false } = {}) {
  validateScenario(scenario, base, { draft });
  const d = clone(base), modifiedQueues = new Set();
  d.customSkills = clone(scenario.skills);
  d.relationships = clone(scenario.relations);
  for (const w of scenario.weapons) {
    d.equipment.push({ id: w.id, name: w.name, kind: 'weapon', cat: w.cat, atk: w.atk, dfn: 0, weight: w.weight, price: w.price, icon: w.icon });
    for (const city of w.shops) {
      d.cities[city].shop.push(w.id); d.cities[city].field_shop.push(w.id); d.cities[city].ai_shop.push(w.id);
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
  for (const c of d.cities) {
    if (c.officers.length > 10) fail(`${c.name}的开局武将超过 10 人`);
    // 与游戏中武将全部离城时一致：空城不再属于原势力。
    if (!c.officers.length) c.faction = 7;
  }
  for (const item of modifiedQueues) {
    const [kind, key] = item.split(':'), ids = (kind === 'search' ? d.search_table : d.join_table)[key];
    ids.sort((a, b) => d.officers[a].year - d.officers[b].year);
  }
  return d;
}
