import { ORIGINAL_SCENARIO, newDraft, validateScenario } from './scenario.js';
import { FEMALE_PRESETS, EXTRA_PRESETS, ROSTER_PRESETS, WARLORD_PRESETS, SOVEREIGN_PRESETS, FEMALE_SCENARIO_ID, FEMALE_SCENARIO_NAME, HERO_SCENARIO_ID, HERO_SCENARIO_NAME, ROSTER_SCENARIO_ID, ROSTER_SCENARIO_NAME, WARLORD_SCENARIO_ID, WARLORD_SCENARIO_NAME, SOVEREIGN_SCENARIO_ID, SOVEREIGN_SCENARIO_NAME, femaleOfficer, presetVisual } from './visuals.js';
import { ensureFemaleGear, addRulerWeapons } from './equipment.js';
import { famousAssignments } from './troop-specialties.js';
import { EXPANDED_MAP_ID } from './expanded-map.js';

const SESSION = 'haou-hd2d-scenario';
const api = () => new URL('/api/versions', location.href).href;
const HERO_STRATEGIES = {
  zhuge: { name: '八阵奇谋', cost: 10, soldiers: 120, hp: 0, stop: 1, rice: 0, maxUses: 2 },
  zhou: { name: '赤壁谋火', cost: 12, soldiers: 160, hp: 0, stop: 0, rice: 50, maxUses: 2 },
  chen: { name: '公台奇谋', cost: 9, soldiers: 80, hp: 3, stop: 1, rice: 0, maxUses: 2 },
  cai: { name: '胡笳扰阵', cost: 8, soldiers: 40, hp: 0, stop: 1, rice: 0, maxUses: 2 },
  wang: { name: '坚城奇策', cost: 9, soldiers: 60, hp: 2, stop: 1, rice: 0, maxUses: 2 },
  guojia: { name: '奉孝奇策', cost: 10, soldiers: 80, hp: 0, stop: 1, rice: 30, maxUses: 2 },
  simayi: { name: '鹰视守谋', cost: 10, soldiers: 70, hp: 2, stop: 1, rice: 0, maxUses: 2 },
  xin: { name: '宪英明鉴', cost: 9, soldiers: 50, hp: 0, stop: 1, rice: 30, maxUses: 2 },
  gongsun: { name: '幽骑冲阵', cost: 10, soldiers: 100, hp: 0, stop: 1, rice: 0, maxUses: 2 },
  yuanshu: { name: '淮南筹策', cost: 10, soldiers: 80, hp: 0, stop: 0, rice: 45, maxUses: 2 },
  liubiao: { name: '荆襄固阵', cost: 9, soldiers: 60, hp: 0, stop: 1, rice: 0, maxUses: 2, effectProfile: 'fortress' },
  guanjing: { name: '长史守谋', cost: 9, soldiers: 60, hp: 1, stop: 1, rice: 0, maxUses: 2 },
  yanxiang: { name: '阎象明策', cost: 9, soldiers: 60, hp: 0, stop: 1, rice: 20, maxUses: 2 },
  kuaiyue: { name: '异度奇谋', cost: 9, soldiers: 70, hp: 0, stop: 1, rice: 0, maxUses: 2 },
  tianyu: { name: '北疆守御', cost: 9, soldiers: 60, hp: 0, stop: 1, rice: 0, maxUses: 2, visualEffect: 'tianyu', effectProfile: 'frontier' },
  huangzu: { name: '江汉守备', cost: 10, soldiers: 70, hp: 0, stop: 0, rice: 25, maxUses: 2, visualEffect: 'huangzu' },
  xunyou: { name: '公达奇策', cost: 10, soldiers: 90, hp: 0, stop: 1, rice: 0, maxUses: 2, visualEffect: 'xunyou' },
  qianzhao: { name: '牵招镇边', cost: 9, soldiers: 60, hp: 0, stop: 1, rice: 0, maxUses: 2, visualEffect: 'qianzhao', effectProfile: 'interdict' },
  huangshi: { name: '黄氏巧思', cost: 9, soldiers: 50, hp: 0, stop: 1, rice: 20, maxUses: 2, visualEffect: 'huangshi' },
};
const PRESET_DUEL_SKILLS = { sun: 'gongyao', wang: 'shoucheng', gao: 'xianzhen', dao: 'baier', gongsun: 'baima', qiaorui: 'qiaorui', zhurong: 'zhurong' };

// 添加模板时复用已存在的同名计略，不覆盖管理员对它的调整。
export function addPresetAbilities(draft, preset, officer) {
  const spec = HERO_STRATEGIES[preset.key];
  if (spec) {
    let skill = draft.skills.find((item) => item.name === spec.name);
    if (!skill) { skill = { id: 16 + draft.skills.length, ...spec }; draft.skills.push(skill); }
    officer.skills = [skill.id];
  }
  if (PRESET_DUEL_SKILLS[preset.key]) officer.duelSkill = PRESET_DUEL_SKILLS[preset.key];
}

export function selectedScenario() {
  try {
    const id = sessionStorage.getItem(SESSION) || ORIGINAL_SCENARIO;
    return [FEMALE_SCENARIO_ID, HERO_SCENARIO_ID, ROSTER_SCENARIO_ID, WARLORD_SCENARIO_ID].includes(id) ? EXPANDED_MAP_ID : id;
  }
  catch { return ORIGINAL_SCENARIO; }
}
// 旧版本的动态武将编号可能与合并版冲突；保留检测能力，不在标题中提供旧版入口。
export function hasLegacyRecords(id = FEMALE_SCENARIO_ID) {
  try {
    const storage = globalThis.localStorage, save = `haou-hd2d-save:scenario:${id}`;
    const suspend = `haou-hd2d-suspend:scenario:${id}`;
    for (let i = 0; storage && i < storage.length; i++) {
      const key = storage.key(i);
      if (key === save || key?.startsWith(`${save}:`) || key === suspend) return true;
    }
    return globalThis.sessionStorage?.getItem(`haou-hd2d-load:scenario:${id}`) != null;
  } catch { return true; } // 无法检查时按可能存在记录处理，不修改浏览器数据。
}
export function selectScenario(id) {
  if (id !== ORIGINAL_SCENARIO && id !== FEMALE_SCENARIO_ID && id !== HERO_SCENARIO_ID && id !== ROSTER_SCENARIO_ID && id !== WARLORD_SCENARIO_ID && id !== SOVEREIGN_SCENARIO_ID && id !== EXPANDED_MAP_ID && !/^v-[a-f0-9]{32}$/.test(id)) throw new Error('版本编号无效');
  try { if (id === ORIGINAL_SCENARIO) sessionStorage.removeItem(SESSION); else sessionStorage.setItem(SESSION, id); }
  catch { throw new Error('无法保存当前页面的版本选择'); }
}
async function request(url, options, includeSkipped = false) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { cache: 'no-store', ...options, signal: controller.signal });
    if (!response.ok) {
      let reason; try { reason = (await response.json()).error; } catch {}
      throw new Error(typeof reason === 'string' ? reason : `版本服务请求失败（${response.status}）`);
    }
    const value = await response.json();
    if (includeSkipped && Array.isArray(value)) {
      const raw = response.headers.get('X-Game-Version-Skipped');
      const skipped = raw && /^[1-9]\d*$/.test(raw) ? Number(raw) : 0;
      Object.defineProperty(value, 'skipped', { value: Number.isSafeInteger(skipped) ? skipped : 0 });
    }
    return value;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('版本服务请求超时，请重试');
    if (error instanceof TypeError) throw new Error('无法连接版本服务');
    throw error;
  } finally { clearTimeout(timer); }
}
export async function listScenarios() { return request(api(), undefined, true); }
export async function loadScenario(id, base) {
  if (id === SOVEREIGN_SCENARIO_ID) {
    const scenario = await loadScenario(WARLORD_SCENARIO_ID, base);
    scenario.id = id; scenario.name = SOVEREIGN_SCENARIO_NAME; scenario.rulerPassives = true; scenario.enhancedRulerPassives = true; scenario.fixedAiRecruitment = true; scenario.enhancedDisasters = true;
    scenario.relationshipEffects = true; scenario.autoBattleSkills = true; scenario.safeAiLure = true; scenario.balancedTroops = true;
    scenario.smartAiReinforcement = true; scenario.cityRaids = true; scenario.campaignRules = true;
    scenario.focusedRulerPassives = true; scenario.expandedOpening = true;
    // 单城势力需要兼顾补兵和行军；仅改变新开局，不覆盖存档中的城市资源。
    for (const [i, amount] of [900, 450, 1200].entries()) scenario.factions[i].opening = { gold: amount, rice: amount };
    const first = base.officers.length + FEMALE_PRESETS.length + EXTRA_PRESETS.length + ROSTER_PRESETS.length + WARLORD_PRESETS.length;
    for (const [i, preset] of SOVEREIGN_PRESETS.entries()) {
      const officer = femaleOfficer(base, preset, first + i, ensureFemaleGear(scenario, base, preset.key, { balanced: true }));
      if (preset.appear === 'initial') Object.assign(officer, { appear: 'initial', faction: preset.faction, soldiers: preset.soldiers, loyalty: 80, level: 2, exp: 1000 });
      else if (preset.appear === 'automatic_faction') Object.assign(officer, { appear: 'automatic_faction', city: null, faction: preset.faction });
      addPresetAbilities(scenario, preset, officer); scenario.officers.push(officer);
    }
    const rulers = scenario.factions.map((f) => f.ruler);
    for (const [i, ruler] of rulers.entries()) scenario.relations.push({ from: ruler, to: first + i, kind: '君臣' });
    scenario.relations.push({ from: rulers[2], to: first + 3, kind: '父子' });
    scenario.relations.push({ from: 109, to: first + 6, kind: '夫妻' }, { from: 200, to: first + 7, kind: '夫妻' });
    // 新关系仅对启用新版规则的新局生效，避免改变既有记录中的招募与继位。
    scenario.campaignRelations = [
      { from: 222, to: 38, kind: '结义' }, { from: 222, to: 153, kind: '结义' }, { from: 38, to: 153, kind: '结义' },
      { from: 222, to: 109, kind: '君臣' }, { from: 131, to: 30, kind: '亲属' }, { from: 138, to: 93, kind: '朋友' },
    ];
    for (const preset of [...FEMALE_PRESETS, ...EXTRA_PRESETS, ...ROSTER_PRESETS, ...WARLORD_PRESETS, ...SOVEREIGN_PRESETS]) {
      const officer = scenario.officers.find((o) => o.name === preset.name);
      if (officer) officer.visual = presetVisual(`v2-${preset.key}`);
    }
    addRulerWeapons(scenario, base);
    scenario.eliteTroops = true;
    const officers = base.officers.map((o) => scenario.officers.find((modified) => modified.id === o.id) ?? o);
    officers.push(...scenario.officers.filter((o) => o.id >= base.officers.length));
    scenario.specialTroops = famousAssignments(officers);
    validateScenario(scenario, base);
    return scenario;
  }
  if (id === WARLORD_SCENARIO_ID) {
    const scenario = await loadScenario(ROSTER_SCENARIO_ID, base);
    scenario.id = id; scenario.name = WARLORD_SCENARIO_NAME;
    const first = base.officers.length + FEMALE_PRESETS.length + EXTRA_PRESETS.length + ROSTER_PRESETS.length;
    scenario.factions = [
      { id: 7, name: '公孙瓒', ruler: first, city: 0, aiProfile: 4 },
      { id: 8, name: '袁术', ruler: first + 1, city: 13, aiProfile: 1 },
      { id: 9, name: '刘表', ruler: first + 2, city: 21, aiProfile: 3 },
    ];
    for (const [i, preset] of WARLORD_PRESETS.entries()) {
      const officer = femaleOfficer(base, preset, first + i, ensureFemaleGear(scenario, base, preset.key, { balanced: true }));
      Object.assign(officer, { appear: 'initial', city: preset.city, faction: preset.faction, soldiers: preset.soldiers,
        loyalty: i < 3 ? 100 : 80, level: i < 3 ? 3 : 2, exp: i < 3 ? 2000 : 1000 });
      addPresetAbilities(scenario, preset, officer); scenario.officers.push(officer);
    }
    const copy = (officerId, city, faction, soldiers, extra = {}) => {
      const original = base.officers[officerId], fields = ['id', 'name', 'hp', 'war', 'int', 'virtue', 'loyalty', 'level', 'exp', 'soldiers', 'weapon', 'armor', 'army', 'year', 'death', 'appear', 'city', 'faction'];
      const officer = { ...Object.fromEntries(fields.map((key) => [key, original[key]])), birthYear: null, birthCity: null, portraitId: officerId, skills: [],
        appear: 'initial', year: 189, city, faction, soldiers, loyalty: 80, ...extra };
      scenario.officers.push(officer); return officer;
    };
    copy(65, 0, 7, 400);
    copy(59, 13, 8, 600, { duelSkill: 'sanjian' });
    const kuaiyue = copy(18, 21, 9, 300); addPresetAbilities(scenario, { key: 'kuaiyue' }, kuaiyue);
    copy(19, 21, 9, 300);
    copy(192, 21, 9, 600, { duelSkill: 'zhenjiang' });
    for (const [ruler, followers] of [[first, [first + 3, first + 4, 65]], [first + 1, [first + 5, first + 6, 59]], [first + 2, [first + 7, 18, 19, 192]]]) {
      for (const follower of followers) scenario.relations.push({ from: ruler, to: follower, kind: '君臣' });
    }
    scenario.relations.push({ from: 18, to: 19, kind: '兄弟' });
    validateScenario(scenario, base);
    return scenario;
  }
  if (id === ROSTER_SCENARIO_ID) {
    // 新编号隔离老合并版中可能已使用的动态武将编号。
    const scenario = await loadScenario(HERO_SCENARIO_ID, base);
    scenario.id = id; scenario.name = ROSTER_SCENARIO_NAME;
    for (const [i, preset] of ROSTER_PRESETS.entries()) {
      const officer = femaleOfficer(base, preset, base.officers.length + FEMALE_PRESETS.length + EXTRA_PRESETS.length + i,
        ensureFemaleGear(scenario, base, preset.key, { balanced: true }));
      addPresetAbilities(scenario, preset, officer); scenario.officers.push(officer);
    }
    const [dao, xin] = ROSTER_PRESETS.map((_, i) => base.officers.length + FEMALE_PRESETS.length + EXTRA_PRESETS.length + i);
    scenario.relations.push({ from: 222, to: dao, kind: '君臣' }, { from: 118, to: xin, kind: '父女' });
    validateScenario(scenario, base);
    return scenario;
  }
  if (id === FEMALE_SCENARIO_ID || id === HERO_SCENARIO_ID) {
    const expanded = id === HERO_SCENARIO_ID, scenario = { ...newDraft(base), id, name: expanded ? HERO_SCENARIO_NAME : FEMALE_SCENARIO_NAME };
    const presets = expanded ? [...FEMALE_PRESETS, ...EXTRA_PRESETS] : FEMALE_PRESETS;
    scenario.officers = presets.map((p, i) => femaleOfficer(base, p, base.officers.length + i, ensureFemaleGear(scenario, base, p.key, { balanced: expanded })));
    if (expanded) {
      scenario.skills = ['zhuge', 'zhou', 'chen', 'cai', 'wang', 'guojia', 'simayi'].map((key, i) => ({ id: 16 + i, ...HERO_STRATEGIES[key] }));
      const copy = (id, extra) => {
        const o = base.officers[id], fields = ['id', 'name', 'hp', 'war', 'int', 'virtue', 'loyalty', 'level', 'exp', 'soldiers', 'weapon', 'armor', 'army', 'year', 'death', 'appear', 'city', 'faction'];
        return { ...Object.fromEntries(fields.map((key) => [key, o[key]])), birthYear: null, birthCity: null, portraitId: id, skills: [], ...extra };
      };
      scenario.officers.push(copy(109, { skills: [16] }), copy(93, { skills: [17] }),
        copy(38, { duelSkill: 'qinglong' }), copy(144, { duelSkill: 'longdan' }), copy(153, { duelSkill: 'yanren' }), copy(218, { duelSkill: 'fangtian' }),
        copy(156, { duelSkill: 'xiaoyao' }), copy(57, { duelSkill: 'huchi' }), copy(75, { duelSkill: 'laojiang' }),
        copy(24, { skills: [21] }), copy(86, { skills: [22] }));
      Object.assign(scenario.officers[0], { duelSkill: 'gongyao' });
      Object.assign(scenario.officers[3], { skills: [19] });
      Object.assign(scenario.officers[4], { skills: [20], duelSkill: 'shoucheng' });
      Object.assign(scenario.officers[5], { skills: [18] });
      Object.assign(scenario.officers[6], { duelSkill: 'xianzhen' });
    }
    validateScenario(scenario, base);
    return scenario;
  }
  if (!/^v-[a-f0-9]{32}$/.test(id)) throw new Error('版本编号无效');
  const scenario = await request(`${api()}/${id}`);
  validateScenario(scenario, base);
  if (scenario.id !== id) throw new Error('版本编号不一致');
  return scenario;
}
export async function addScenario(scenario, base, token) {
  validateScenario(scenario, base);
  if ([FEMALE_SCENARIO_ID, HERO_SCENARIO_ID, ROSTER_SCENARIO_ID, WARLORD_SCENARIO_ID, SOVEREIGN_SCENARIO_ID].includes(scenario.id)) throw new Error('内置版本须载入为新草稿后发布');
  if (typeof token !== 'string' || !token) throw new Error('请输入管理员令牌');
  return request(api(), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(scenario) });
}
export async function uploadVisualAsset(blob, token) {
  if (typeof token !== 'string' || !token) throw new Error('请先输入管理员令牌再上传素材');
  if (!(blob instanceof Blob) || !['image/png', 'image/webp'].includes(blob.type)) throw new Error('素材格式无效');
  return request(new URL('/api/assets', location.href).href, { method: 'POST', headers: { 'Content-Type': blob.type, Authorization: `Bearer ${token}` }, body: blob });
}
export async function readVisualAsset(id) {
  if (!/^a-[a-f0-9]{64}$/.test(id)) throw new Error('素材编号无效');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(new URL(`/api/assets/${id}`, location.href), { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error('素材无法读取，请检查服务器');
    const blob = await response.blob();
    if (blob.size > 1024 * 1024 || !['image/png', 'image/webp'].includes(blob.type)) throw new Error('素材格式或大小无效');
    return blob;
  } finally { clearTimeout(timer); }
}
