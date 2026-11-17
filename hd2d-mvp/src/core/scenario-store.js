import { ORIGINAL_SCENARIO, newDraft, validateScenario } from './scenario.js';
import { FEMALE_PRESETS, FEMALE_SCENARIO_ID, FEMALE_SCENARIO_NAME, femaleOfficer } from './visuals.js';
import { ensureFemaleGear } from './equipment.js';

const SESSION = 'haou-hd2d-scenario';
const api = () => new URL('/api/versions', location.href).href;

export function selectedScenario() {
  try { return sessionStorage.getItem(SESSION) || ORIGINAL_SCENARIO; }
  catch { return ORIGINAL_SCENARIO; }
}
export function selectScenario(id) {
  if (id !== ORIGINAL_SCENARIO && id !== FEMALE_SCENARIO_ID && !/^v-[a-f0-9]{32}$/.test(id)) throw new Error('版本编号无效');
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
  if (id === FEMALE_SCENARIO_ID) {
    const scenario = { ...newDraft(base), id, name: FEMALE_SCENARIO_NAME };
    scenario.officers = FEMALE_PRESETS.map((p, i) => femaleOfficer(base, p, base.officers.length + i, ensureFemaleGear(scenario, base, p.key)));
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
  if (scenario.id === FEMALE_SCENARIO_ID) throw new Error('内置版本须载入为新草稿后发布');
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
