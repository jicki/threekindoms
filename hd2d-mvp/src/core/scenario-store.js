import { ORIGINAL_SCENARIO, validateScenario } from './scenario.js';

const SESSION = 'haou-hd2d-scenario';
const api = () => new URL('/api/versions', location.href).href;

export function selectedScenario() {
  try { return sessionStorage.getItem(SESSION) || ORIGINAL_SCENARIO; }
  catch { return ORIGINAL_SCENARIO; }
}
export function selectScenario(id) {
  if (id !== ORIGINAL_SCENARIO && !/^v-[a-f0-9]{32}$/.test(id)) throw new Error('版本编号无效');
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
  if (!/^v-[a-f0-9]{32}$/.test(id)) throw new Error('版本编号无效');
  const scenario = await request(`${api()}/${id}`);
  validateScenario(scenario, base);
  if (scenario.id !== id) throw new Error('版本编号不一致');
  return scenario;
}
export async function addScenario(scenario, base, token) {
  validateScenario(scenario, base);
  if (typeof token !== 'string' || !token) throw new Error('请输入管理员令牌');
  return request(api(), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(scenario) });
}
