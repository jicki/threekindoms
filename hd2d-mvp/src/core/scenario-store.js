import { ORIGINAL_SCENARIO, newDraft, validateScenario } from './scenario.js';
import { FEMALE_PRESETS, EXTRA_PRESETS, FEMALE_SCENARIO_ID, FEMALE_SCENARIO_NAME, HERO_SCENARIO_ID, HERO_SCENARIO_NAME, femaleOfficer } from './visuals.js';
import { ensureFemaleGear } from './equipment.js';

const SESSION = 'haou-hd2d-scenario';
const api = () => new URL('/api/versions', location.href).href;
const HERO_STRATEGIES = {
  zhuge: { name: '八阵奇谋', cost: 10, soldiers: 120, hp: 0, stop: 1, rice: 0, maxUses: 2 },
  zhou: { name: '赤壁谋火', cost: 12, soldiers: 160, hp: 0, stop: 0, rice: 50, maxUses: 2 },
  chen: { name: '公台奇谋', cost: 9, soldiers: 80, hp: 3, stop: 1, rice: 0, maxUses: 2 },
  cai: { name: '胡笳扰阵', cost: 8, soldiers: 40, hp: 0, stop: 1, rice: 0, maxUses: 2 },
  wang: { name: '坚城奇策', cost: 9, soldiers: 60, hp: 2, stop: 1, rice: 0, maxUses: 2 },
};
const PRESET_DUEL_SKILLS = { sun: 'gongyao', wang: 'shoucheng', gao: 'xianzhen' };

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
  try { return sessionStorage.getItem(SESSION) || ORIGINAL_SCENARIO; }
  catch { return ORIGINAL_SCENARIO; }
}
// 旧版本的动态武将编号可能与合并版的新角色冲突，记录必须留在原版本中继续。
export function hasLegacyRecords() {
  try {
    const storage = globalThis.localStorage, save = `haou-hd2d-save:scenario:${FEMALE_SCENARIO_ID}`;
    const suspend = `haou-hd2d-suspend:scenario:${FEMALE_SCENARIO_ID}`;
    for (let i = 0; storage && i < storage.length; i++) {
      const key = storage.key(i);
      if (key === save || key?.startsWith(`${save}:`) || key === suspend) return true;
    }
    return globalThis.sessionStorage?.getItem(`haou-hd2d-load:scenario:${FEMALE_SCENARIO_ID}`) != null;
  } catch { return true; } // 无法检查时仍保留入口，避免隐藏用户的旧记录。
}
export function selectScenario(id) {
  if (id !== ORIGINAL_SCENARIO && id !== FEMALE_SCENARIO_ID && id !== HERO_SCENARIO_ID && !/^v-[a-f0-9]{32}$/.test(id)) throw new Error('版本编号无效');
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
  if (id === FEMALE_SCENARIO_ID || id === HERO_SCENARIO_ID) {
    const expanded = id === HERO_SCENARIO_ID, scenario = { ...newDraft(base), id, name: expanded ? HERO_SCENARIO_NAME : FEMALE_SCENARIO_NAME };
    const presets = expanded ? [...FEMALE_PRESETS, ...EXTRA_PRESETS] : FEMALE_PRESETS;
    scenario.officers = presets.map((p, i) => femaleOfficer(base, p, base.officers.length + i, ensureFemaleGear(scenario, base, p.key, { balanced: expanded })));
    if (expanded) {
      scenario.skills = ['zhuge', 'zhou', 'chen', 'cai', 'wang'].map((key, i) => ({ id: 16 + i, ...HERO_STRATEGIES[key] }));
      const copy = (id, extra) => {
        const o = base.officers[id], fields = ['id', 'name', 'hp', 'war', 'int', 'virtue', 'loyalty', 'level', 'exp', 'soldiers', 'weapon', 'armor', 'army', 'year', 'death', 'appear', 'city', 'faction'];
        return { ...Object.fromEntries(fields.map((key) => [key, o[key]])), birthYear: null, birthCity: null, portraitId: id, skills: [], ...extra };
      };
      scenario.officers.push(copy(109, { skills: [16] }), copy(93, { skills: [17] }),
        copy(38, { duelSkill: 'qinglong' }), copy(144, { duelSkill: 'longdan' }), copy(153, { duelSkill: 'yanren' }), copy(218, { duelSkill: 'fangtian' }));
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
  if (scenario.id === FEMALE_SCENARIO_ID || scenario.id === HERO_SCENARIO_ID) throw new Error('内置版本须载入为新草稿后发布');
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
