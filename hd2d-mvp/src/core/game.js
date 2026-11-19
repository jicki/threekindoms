// Strategic rules core: game state, the monthly faction rotation and every player command.
// Formulas follow 霸王的大陆_HD-2D重制参考.md (chapters 5.2–5.9, 6.6, 6.9). The original draws from a
// fixed 256-byte permutation with per-system cursors; here one seeded generator stands in for all
// of them, so outcomes follow the same ranges and rejection rules but not the original sequence.

import { roll100 } from './origrng.js';
import { withRecordLock } from './record-lock.js';
import { applyScenario, ORIGINAL_SCENARIO } from './scenario.js';
import { loadScenario, selectedScenario } from './scenario-store.js';
import { applyRulerPassive, describeRulerPassive } from './ruler-passives.js';
import { relationDisposition, recruitDisposition, recruitThreshold, recruitLoyaltyWithRelation } from './relationships.js';
import { EXPANDED_MAP_ID, EXPANDED_NODES, expandMap, applyExpandedOpening } from './expanded-map.js';
import { SOVEREIGN_SCENARIO_ID } from './visuals.js';
import { chooseCampaignEvent, applyCampaignEvent } from './campaign-events.js';
import { FAMOUS_ROSTER, FAMOUS_ROSTER_START, activateFamousRoster, extraSearchIds, famousRosterTemplate, hasFamousRoster, rosterRecordName, staticRosterSize } from './famous-roster.js';
import { readResource } from '../resource.js';
import { officerPassive, advancedBattle } from './battle-rules.js';
// 原版无主为 7；扩展剧本将无主编号放在实际势力编号之后。
export let NONE = 7;
export const DEAD = 3, SERVING = 2, UNAPPEARED = 1, RONIN = 0;
export const FACTION_COLORS = ['#5a5a66', '#c8402f', '#7a4ad0', '#e0a020', '#3f8f4f', '#c060a0', '#2f9fb0', '#4673aa', '#a46324', '#857b3d'];

let D = null; // static data (data/game-data.json)
let scenarioId = ORIGINAL_SCENARIO;
export const data = () => D;
export const currentScenario = () => scenarioId;
export const scenarioKey = (key) => scenarioId === ORIGINAL_SCENARIO ? key : `${key}:scenario:${scenarioId}`;
export async function loadData(url = 'data/game-data.json') {
  const base = await readResource(url, (r) => r.json()), id = selectedScenario();
  if (id === ORIGINAL_SCENARIO) return setData(base, id);
  const scenario = await loadScenario(id === EXPANDED_MAP_ID ? SOVEREIGN_SCENARIO_ID : id, base);
  let next = applyScenario(base, scenario);
  if (id === EXPANDED_MAP_ID || scenario.map === 'expanded') next = expandMap(next);
  next.scenarioName = scenario.name; return setData(next, id);
}
export function setData(d, id = ORIGINAL_SCENARIO) { D = d; NONE = d?.factions?.length ?? 7; scenarioId = id; return D; }
// 体力上限: the ROM template's hp, unless the save editor set one on the record (o.maxHp). id for copies of a record.
export const maxHp = (o, id = o.id) => o.maxHp ?? D.officers[id].hp;

// ---------- RNG ----------
export function rng(g) {
  // mulberry32 over g.seed; returns 0..n-1
  return (n) => {
    let t = (g.seed = (g.seed + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
}

const cityRecord = (c) => ({ id: c.id, faction: c.faction, gold: c.gold, rice: c.rice, pop: c.pop, land: c.land, industry: c.industry,
  disaster: c.disaster, gov: c.gov, reserve: c.reserve, treasure: c.treasure, officers: [...c.officers], riot: 0 });
const officerRecord = (o) => ({
  id: o.id, hp: o.hp, war: o.war, int: o.int, loyalty: o.loyalty, virtue: o.virtue, exp: o.exp, soldiers: o.soldiers,
  weapon: o.weapon, armor: o.armor, level: o.level, army: o.army, status: o.appear === 'initial' ? SERVING : UNAPPEARED, loc: o.city,
});

// 战役规则修订号独立于存档结构。读取旧记录保留其规则，由玩家在战略回合选择升级。
const CAMPAIGN_REVISION = 4;
const FAMOUS_CAMPAIGN_RULES = { battlefields: 2, famousSkills: 2, famousRoster: 1, siegeTactics: true };
const supportsNewBattle = () => D.expandedMap === true && (scenarioId === EXPANDED_MAP_ID || D.newBattleRules === true);
function campaignDefaults() {
  const defaults = {};
  for (const key of ['enhancedDisasters', 'smartAiReinforcement', 'cityRaids', 'focusedRulerPassives', 'battleRulerPassives',
    'relationshipEffects', 'autoBattleSkills', 'eliteTroops', 'safeAiLure', 'balancedTroops', 'campaignRules']) {
    if (D[key]) defaults[key] = true;
  }
  if (D.rulerPassives && D.enhancedRulerPassives) defaults.enhancedRulerPassives = true;
  if (defaults.campaignRules) defaults.safeStrategyChance = true;
  return defaults;
}

// 仅用于君主列传扩展地图的新局；旧记录和已发布版本的静态人物配置不变。
const FEMALE_OPENING_STATS = {
  '孙尚香': { hp: 88, war: 89, int: 76, virtue: 80 },
  '甄宓': { hp: 78, war: 62, int: 91, virtue: 86 },
  '貂蝉': { hp: 81, war: 70, int: 89, virtue: 82 },
  '蔡琰': { hp: 78, war: 42, int: 94, virtue: 85 },
  '王异': { hp: 86, war: 85, int: 86, virtue: 90 },
  '辛宪英': { hp: 76, war: 40, int: 94, virtue: 90 },
  '黄夫人': { hp: 78, war: 42, int: 93, virtue: 90 },
  '祝融夫人': { hp: 88, war: 88, int: 72, virtue: 78 },
};

// ---------- New game ----------
export function newGame(playerFaction, level, seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0, { ruler = null } = {}) {
  const g = { version: SAVE_VERSION, level, player: playerFaction, year: D.startYear ?? 189, month: 0, seed, turnIdx: -1, monthDone: false, current: null, books: 0, over: null };
  if (scenarioId !== ORIGINAL_SCENARIO) g.scenarioId = scenarioId;
  Object.assign(g, campaignDefaults());
  if (scenarioId === EXPANDED_MAP_ID && D.expandedMap === true) {
    if (staticRosterSize(D, null) !== FAMOUS_ROSTER_START) throw new Error('内置人物数据与名将名单不匹配');
    Object.assign(g, FAMOUS_CAMPAIGN_RULES, { campaignRevision: CAMPAIGN_REVISION });
  } else if (supportsNewBattle()) {
    Object.assign(g, { campaignRevision: CAMPAIGN_REVISION, campaignRules: true, safeStrategyChance: true, battlefields: 2, siegeTactics: true });
  }
  if (D.expandedMap && D.frontierMap) g.frontierMap = true;
  activateFamousRoster(D,g);
  const r = rng(g);
  g.order = r(5); // 新游戏随机0–4 (5.2)
  g.cities = D.cities.map(cityRecord);
  g.officers = D.officers.filter((o) => o && !o.clone).map(officerRecord);
  if (scenarioId === EXPANDED_MAP_ID) for (const source of D.officers) {
    if (source && !source.clone && Object.hasOwn(FEMALE_OPENING_STATS, source.name) && g.officers[source.id]) {
      const stats = FEMALE_OPENING_STATS[source.name];
      // 上限写入本局，避免修改静态数据造成旧记录的治疗上限变化。
      Object.assign(g.officers[source.id], stats, { maxHp: stats.hp });
    }
  }
  g.factions = D.factions.map((f) => ({ id: f.id, ruler: f.ruler, city: D.officers[f.ruler].city, ai: f.id !== playerFaction, alliance: Array(D.factions.length).fill(0) }));
  g.aiCursor = Array(D.factions.length).fill(0);
  if (D.expandedMap && (scenarioId === EXPANDED_MAP_ID || D.expandedOpening)) {
    applyExpandedOpening(g);
    g.expandedOpeningGuard = true;
  }
  if (ruler != null && ruler !== g.factions[playerFaction]?.ruler) {
    const allowed = D.rulerCandidates?.some((r) => r.faction === playerFaction && r.officer === ruler);
    const city = g.cities.find((c) => c.faction === playerFaction && c.officers.includes(ruler));
    if (!allowed || !city || g.officers[ruler]?.status !== SERVING) throw new Error('君主候选不属于该势力的开局武将');
    g.factions[playerFaction].ruler = ruler; g.factions[playerFaction].city = city.id;
    city.officers = [ruler, ...city.officers.filter((id) => id !== ruler)];
    g.officers[ruler].loyalty = 100;
  }
  return g;
}

// The original's ruler-select 秘技 (hold START, ↑↓←→ ×3 at 「クンシュを えらんでください」, before A):
// the player ruler's seat city starts maxed, every level. Read from the unmodified ROM in FCEUmm
// (research/player-commands-evidence.md): 金/米/人口/土地/后备兵 9999, 产业 999, 防灾/统治/宝 99.
// Officers and the faction's other cities are untouched; 土地 9999 is above the 999 development cap.
export function maxRulerCity(g) {
  const c = g.cities[g.factions[g.player].city];
  Object.assign(c, { gold: 9999, rice: 9999, pop: 9999, land: 9999, reserve: 9999, industry: 999, disaster: 99, gov: 99, treasure: 99 });
  g.cheat = true;
  return g;
}

// ---------- Queries ----------
export const officerCity = (g, id) => g.cities.find((c) => c.officers.includes(id));
export const factionOf = (g, id) => officerCity(g, id)?.faction ?? NONE;
export const isPass = (cid) => D.cities[cid]?.kind === 'pass';
export const holdingsOf = (g, f) => g.cities.filter((c) => c.faction === f);
export const citiesOf = (g, f) => holdingsOf(g, f).filter((c) => !isPass(c.id));
export const cityCount = () => D.cities.filter((c) => c.kind !== 'pass').length;
export const alive = (g, f) => g.factions[f].ruler != null;
export const isRuler = (g, id) => g.factions.some((f) => f.ruler === id);
export const boundRulerWeapon = (g, id) => D.equipment[g.officers[id]?.weapon]?.exclusiveRuler === id;
export const roads = (cid) => D.cities[cid].roads;
export const name = (id) => D.officers[id].name;
export const recordOfficerName = (g,id) => rosterRecordName(D,g,id) ?? '未知';
// 仅改变展示名称，不修改城市数据、版本校验或存档中的编号。若新据点使用同名，保留原名避免歧义。
const HISTORICAL_NAMES = { 幽州: '北平', 并州: '晋阳', 冀州: '邺', 兖州: '陈留', 豫州: '许昌', 青州: '北海', 徐州: '下邳', 扬州: '寿春', 荆州: '南郡', 凉州: '武威', 交州: '南海', 西平关: '金城', 西安阳: '五原' };
let historicalNames = (() => { try { return localStorage.getItem('hd2d-place-names') === '1'; } catch { return false; } })();
export const placeNames = () => historicalNames;
export function setPlaceNames(on) { historicalNames = !!on; try { localStorage.setItem('hd2d-place-names', on ? '1' : '0'); } catch {} }
export const cityName = (cid) => {
  const city = D.cities[cid], alt = Object.hasOwn(HISTORICAL_NAMES, city.name) ? HISTORICAL_NAMES[city.name] : null;
  return historicalNames && cid < 30 && alt && !D.cities.some((other) => other.id !== cid && other.name === alt) ? alt : city.name;
};
export const cityOrigName = (cid) => cityName(cid) === D.cities[cid].name ? null : D.cities[cid].name;
export const placeNamePairs = () => D.cities.filter((c) => c.id < 30 && Object.hasOwn(HISTORICAL_NAMES, c.name)).map((c) => [c.name, HISTORICAL_NAMES[c.name]]);
// 原版武器按每八件分组；新武器使用其显式类别，不依赖编号。
export const weaponGroup = (id) => id < 24 ? Math.floor(id / 8) : ({ 剑: 0, 刀: 1, 枪: 2, 扇: 3, 弓: 4 }[D.equipment[id]?.cat] ?? -1);
// A house goes by its ruler of the day; a fallen one by the ruler it fell under (the scenario's name for an older
// record that has no note of him).
export const factionName = (g, f) => {
  if (f == null || f === NONE) return '无主';
  const who = g.factions[f].ruler ?? g.factions[f].fallen;
  return who != null ? name(who) : D.factions[f].name;
};
export const troopsOf = (g, c) => c.officers.reduce((a, id) => a + g.officers[id].soldiers, 0);
export const books = (g, f) => D.rules.books[citiesOf(g, f).length];
export function rulerPassive(g, f) {
  const id = g.factions[f]?.ruler, officer = id == null ? null : g.officers[id];
  return D.rulerPassives && officer?.status === SERVING ? describeRulerPassive({ ...D.officers[id], ...officer }, g.enhancedRulerPassives === true, g.campaignRules === true, g.focusedRulerPassives === true, g.battleRulerPassives === true) : null;
}
function grantRulerPassive(g, f) {
  const turn = `${g.year}:${g.month}:${f}`;
  if (g.rulerPassiveTurn === turn) return;
  if (applyRulerPassive(g, f, rulerPassive(g, f), isPass(g.factions[f].city))) g.rulerPassiveTurn = turn;
}

// ---------- Income (5.2): every city, ID 29→0, regardless of owner ----------
const GOV_C = (t) => (t <= 50 ? 50 : t <= 70 ? 60 : t <= 80 ? 70 : t <= 90 ? 80 : t <= 99 ? 90 : 100);
export function income(g, kind) {
  const [A, B] = D.rules.income_ab[g.level];
  const out = [];
  for (const c of [...g.cities].reverse()) {
    if (c.faction === NONE || isPass(c.id)) continue;
    const Dv = kind === 'gold' ? c.industry : c.land, N = kind === 'gold' ? 80 : 60;
    const q = Math.floor((c.pop * (Math.floor(Dv / A) + B)) / N);
    let inc = Math.floor((q * GOV_C(c.gov)) / 100);
    const lord = g.factions[c.faction]?.ruler, home = lord == null ? null : officerCity(g, lord);
    const unique = home?.faction === c.faction ? rulerPassive(g, c.faction)?.combat?.unique : null;
    if ((kind === 'gold' && unique === 'tax') || (kind === 'rice' && unique === 'harvest')) inc += Math.min(kind === 'gold' ? 40 : 50, Math.floor(inc / 20));
    c[kind] = Math.min(9999, c[kind] + inc);
    out.push([c.id, inc]);
  }
  return out;
}

// ---------- Disasters and riots (5.5) ----------
function disasterK(c, r) {
  const Dv = c.disaster;
  let k, b;
  if (Dv === 0) { k = 0; b = 0; } else if (Dv < 20) { k = 2; b = 0; } else if (Dv < 50) { k = 4; b = 1; } else if (Dv < 80) { k = 6; b = 5; } else if (Dv < 99) { k = 8; b = 7; } else { k = 10; b = 10; }
  if (Dv >= 20) c.disaster = Math.max(0, Dv - (b + r(6)));
  return k;
}
const qLoss = (v, k) => (k === 0 ? Math.floor(v / 4) : Math.floor((Math.floor(v / 4) * k) / 10));
const hLoss = (v, k) => (k === 0 ? Math.floor(v / 2) : Math.floor((Math.floor(v / 2) * k) / 10));
const eventMonth = (g) => g.year * 12 + g.month;
function enhancedDisaster(g, c, kind, defense, consecutive = false) {
  const severity = 100 - Math.max(0, Math.min(99, defense));
  // 金米最低各损失 50，土地和产业最低各损失 5；库存不足时只扣除现有量。
  const rate = 2 + Math.ceil(severity / 20), fraction = (value, divisor) => {
    const loss = Math.floor(Math.floor(value / divisor) * severity / 100);
    return consecutive ? Math.floor(loss / 2) : loss;
  };
  const cost = (value, minimum, extra = 0) => Math.min(Math.max(0, value), Math.max(minimum, Math.floor(value * rate / 100)) + extra);
  const losses = {
    gold: cost(c.gold, 50), rice: cost(c.rice, 50, kind === 'flood' ? fraction(c.rice, 2) : 0),
    land: cost(c.land, 5, kind === 'drought' ? fraction(c.land, 4) : 0),
    industry: cost(c.industry, 5, kind === 'flood' ? fraction(c.industry, 4) : 0),
    pop: fraction(c.pop, 4), soldiers: 0, disaster: defense - c.disaster,
  };
  for (const key of ['gold', 'rice', 'land', 'industry', 'pop']) c[key] -= losses[key];
  if (kind === 'drought') for (const id of c.officers) {
    const o = g.officers[id], loss = fraction(o.soldiers, 4); o.soldiers -= loss; losses.soldiers += loss;
  }
  return losses;
}
export function disaster(g, kind) {
  const r = rng(g), list = kind === 'drought' ? D.rules.drought_cities : D.rules.flood_cities, hit = [];
  for (const cid of [...list, null]) {
    if (r(6) !== 0 || cid == null) continue; // 16 sequential draws, the trailing FF slot included
    const c = g.cities[cid];
    if (c.faction === NONE || isPass(c.id)) continue;
    const defense = c.disaster, k = disasterK(c, r);
    // 时间随游戏记录，旧记录无此字段时从首次受灾开始计算。
    const now = eventMonth(g), previous = g.disasterHistory?.[cid];
    if (g.enhancedDisasters === true || g.cityRaids === true) (g.disasterHistory ??= {})[cid] = now;
    if (g.cityRaids === true) (g.disasterFactions ??= {})[c.faction] = now;
    if (g.enhancedDisasters === true) { hit.push([cid, k, enhancedDisaster(g, c, kind, defense, previous === now - 1)]); continue; }
    if (k === 10) { hit.push([cid, 0]); continue; }
    c.pop -= qLoss(c.pop, k);
    if (kind === 'drought') { c.land -= qLoss(c.land, k); for (const id of c.officers) g.officers[id].soldiers -= qLoss(g.officers[id].soldiers, k); }
    else { c.industry -= qLoss(c.industry, k); c.rice -= hLoss(c.rice, k); }
    hit.push([cid, k]);
  }
  return hit;
}
export function riots(g) {
  if (g.year === 189 && g.month < 4) return [];
  const r = rng(g), out = [];
  for (const c of g.cities) {
    if (c.faction === NONE || isPass(c.id)) continue;
    if (c.riot > 0) { c.riot--; continue; }
    const p = c.gov >= 50 ? 0 : c.gov >= 40 ? 5 : c.gov >= 30 ? 10 : c.gov >= 20 ? 30 : 50;
    if (!p || r(100) >= p) continue;
    c.riot = 6;
    const k = { 5: [1, 4], 10: [2, 6], 30: [3, 7], 50: [4, 8] }[p], type = 1 + r(3);
    const cut = (v, kk) => v - Math.floor(v / 16) * kk;
    if (type === 1) c.pop = cut(c.pop, k[0]);
    else if (type === 2) { c.gold = cut(c.gold, k[1]); c.rice = cut(c.rice, k[1]); }
    else { c.land = cut(c.land, k[1]); c.industry = cut(c.industry, k[1]); }
    if (g.cityRaids === true) (g.raidRiots ??= {})[c.id] = eventMonth(g);
    out.push([c.id, type]);
  }
  return out;
}

// ---------- Appearance, death, succession (6.6) ----------
// 登场队列: a city's 搜索 table and a faction's 自动出仕 table are read in order; only the first officer
// not yet appeared counts, and until his year comes the queue waits (搜索 then finds nearby ronin instead).
// An AI faction's 搜索 reads the same table its own way (C5D2, core/ai.js housekeeping).
export const searchQueue = (cid) => D.search_table[String(cid)] || [];
export const joinQueue = (f) => D.join_table[String(f)] || [];
// 指定优先的武将到达登场年份后才排到队首；其他武将仍按原队列顺序寻访。
export function searchOrder(g, cid) {
  const list = [...searchQueue(cid), ...extraSearchIds(g,cid)];
  const priority = list.filter((id) => D.officers[id].searchPriority && g.officers[id].status === UNAPPEARED && D.officers[id].year <= g.year);
  if (!priority.length) return list;
  const selected = new Set(priority);
  return [...priority, ...list.filter((id) => !selected.has(id))];
}
export function queueHead(g, list) {
  const id = list.find((i) => g.officers[i].status === UNAPPEARED);
  return id == null ? null : { id, ready: D.officers[id].year <= g.year };
}
// How and where an officer enters play: kind 'initial' (in a city at the start), 'search' (city's 搜索 queue,
// order = place in it), 'auto' (joins the faction's ruler city by himself) or 'phantom' (an 阿会喃 copy that came
// out of 王莆, core/ahuinan.js); prefer = faction he favours when found.
export function debutInfo(id) {
  const o = D.officers[id];
  if (o.clone) return { year: o.year, prefer: null, kind: 'phantom' };
  if (o.famousExtra) return { year:o.year, prefer:null, kind:'search', city:o.city, order:1, priority:true };
  const prefer = Object.entries(D.rules.search_preference).find(([, ids]) => ids.includes(id))?.[0];
  const base = { year: o.year, prefer: prefer == null ? null : Number(prefer) };
  for (const [k, list] of Object.entries(D.search_table)) { const i = list.indexOf(id); if (i >= 0) return { ...base, kind: 'search', city: Number(k), order: i + 1, ...(o.searchPriority ? { priority: true } : {}) }; }
  for (const [k, list] of Object.entries(D.join_table)) { const i = list.indexOf(id); if (i >= 0) return { ...base, kind: 'auto', faction: Number(k), order: i + 1 }; }
  return { ...base, kind: 'initial', city: o.city };
}
// What 搜索 in this city can turn up now: the queue head (ready or waiting for his year), how many are still
// to come, whether the city is too full to take anyone, and the ronin a search could find instead.
export function cityTalent(g, cid) {
  const list = searchOrder(g, cid), near = [cid, ...roads(cid)];
  return {
    list, head: queueHead(g, list), left: list.filter((i) => g.officers[i].status === UNAPPEARED).length,
    full: g.cities[cid].officers.length >= 10, ronin: g.officers.filter((o) => o.status === RONIN && near.includes(o.loc)).map((o) => o.id),
  };
}

export function autoJoin(g, f) {
  const head = queueHead(g, joinQueue(f));
  if (!head?.ready) return null;
  const id = head.id;
  const c = g.cities[g.factions[f].city];
  if (!c || c.faction !== f || c.officers.length >= 10) return null;
  g.officers[id].status = SERVING; c.officers.push(id);
  return { id, city: c.id };
}
// A ruler taken prisoner (D49, smdqj@devblog, 2026-11-13). The original gates every capture on loyalty 100, so this
// needs a ruler whose loyalty was edited down; its own answer there is an anomaly (he stays his house's ruler while
// serving his captor, and the house's queue joins the captor's city: docs/曹操被俘后自动出仕的原版对照_2026-11-13.md).
// Here the house crowns an heir as if he had died (checkFactions, and rotate for a record saved in the stuck state),
// or falls when it has no city left; then its 自动出仕 queue follows him.
export const rulerTaken = (g, f) => {
  const id = g.factions[f].ruler, c = id == null || g.officers[id].status !== SERVING ? null : officerCity(g, id);
  return !!c && c.faction !== f;
};
// 0.3.4 and before wrote the prisoner at the head of his captor's city, over the captor's own ruler when he was
// there too: a record from then gets the ruler back in front (the first of a city's list is its 太守).
function rulerFirst(g, c) {
  const lord = g.factions[c.faction]?.ruler;
  if (c.officers.includes(lord)) c.officers = [lord, ...c.officers.filter((x) => x !== lord)];
}
// The queue of a house that fell with its ruler in another's service: on the house's place in the turn order the
// head joins the city he serves in, under autoJoin's terms (his year, one a turn, room in the city). It stops once he
// is dead or out of office; a house that fell any other way has no such ruler and its queue rests, as in the original.
export function followJoin(g, f) {
  const fac = g.factions[f], lord = fac.ruler == null ? fac.fallen : null;
  if (lord == null || g.officers[lord].status !== SERVING) return null;
  const head = queueHead(g, joinQueue(f)), c = officerCity(g, lord);
  if (c) rulerFirst(g, c);
  if (!head?.ready || !c || c.officers.length >= 10) return null;
  g.officers[head.id].status = SERVING; c.officers.push(head.id);
  return { id: head.id, city: c.id, faction: c.faction, lord };
}

const DEATH_P = [5, 10, 20, 37, 80, 160, 201];
// 不战死时体力归零的武将（包括君主）退出战场并被俘；君主的恢复体力不超过其自定义上限。
export const SPARED_HP = 30;
export const spared = (g) => (g.noWarDeath ? 'captured' : null);
export const sparedHp = (g, id) => isRuler(g, id) ? Math.min(SPARED_HP, maxHp(g.officers[id], id)) : SPARED_HP;
// 武将不老 (g.ageless, an option off by default and absent from older records): nobody dies of age; war deaths stay.
export function naturalDeaths(g, f) {
  if (g.ageless) return [];
  const r = rng(g), dead = [], ruler = g.factions[f].ruler;
  for (const c of holdingsOf(g, f)) {
    for (let i = 0; i < c.officers.length; i++) { // the original advances the slot even after compaction (skip quirk kept)
      const id = c.officers[i];
      if (id === ruler) continue;
      if (dies(id)) { kill(g, id); dead.push(id); }
    }
  }
  if (ruler != null && dies(ruler)) { kill(g, ruler); dead.push(ruler); }
  return dead;
  function dies(id) {
    const d = g.year - D.officers[id].death;
    return d >= 0 && r(200) < DEATH_P[Math.min(6, d)];
  }
}
export function kill(g, id) {
  const o = g.officers[id], c = officerCity(g, id);
  o.status = DEAD; o.hp = 0;
  if (c) { c.officers = c.officers.filter((x) => x !== id); if (!c.officers.length) c.faction = NONE; }
}

export function heirCandidates(g, f) {
  return holdingsOf(g, f).flatMap((c) => c.officers);
}
export function autoHeir(g, f) {
  const cands = heirCandidates(g, f);
  const pref = (D.succession[String(f)] || []).find((id) => cands.includes(id));
  if (pref != null) return pref;
  let best = null;
  for (const id of cands) if (best == null || g.officers[id].virtue >= g.officers[best].virtue) best = id;
  return best;
}
export function crown(g, f, heir, oldRuler) {
  const r = rng(g), fac = g.factions[f], c = officerCity(g, heir), quit = [];
  fac.ruler = heir; fac.city = c.id;
  c.officers = [heir, ...c.officers.filter((x) => x !== heir)];
  if (!(D.succession[String(f)] || []).includes(heir)) {
    const dv = Math.floor(g.officers[heir].virtue / 5) - Math.floor(g.officers[oldRuler].virtue / 5);
    for (const id of heirCandidates(g, f)) {
      if (id === heir) continue;
      const o = g.officers[id];
      o.loyalty = Math.max(10, Math.min(99, o.loyalty + dv - 10 + 2 * relationDisposition(D, g, heir, id)));
      if (o.loyalty < 31 && r(100) < 20) quit.push(id);
    }
  }
  g.officers[heir].loyalty = 100;
  for (const id of quit) toRonin(g, id);
  return quit;
}
export function toRonin(g, id) {
  const c = officerCity(g, id), o = g.officers[id];
  o.status = RONIN; o.loc = c?.id ?? o.loc;
  // 被俘后的君主可能在原势力继位前因俘获方继位等原因离开，仍应活着下野。
  if (o.warRulerSpared && isRuler(g, id)) o.warRulerRonin = true;
  if (c) { c.officers = c.officers.filter((x) => x !== id); if (!c.officers.length) c.faction = NONE; }
}
export function destroyFaction(g, f) {
  g.factions[f].fallen = g.factions[f].ruler; g.factions[f].ruler = null;
  for (const c of holdingsOf(g, f)) { for (const id of [...c.officers]) toRonin(g, id); c.faction = NONE; }
}

// Recruit loyalty (CF3F): 8-bit subtraction wrap, then clamp 10..90.
export const recruitLoyalty = (rulerVirtue, old) => Math.min(90, Math.max(10, (70 + Math.floor(rulerVirtue / 10) - old) & 255));
export const capturedLoyalty = (old) => Math.max(10, 51 - Math.abs(50 - old));

// ---------- Experience (6.1) ----------
// Level-ups not told yet, per game: officer id → his level and 武力 before the first of them. Kept off the game
// record so a save never carries them. The original compares each general's level and 武力 with what they were
// before the fight (bank13 $C716 / $DEE9, research/experience-evidence.md §5), so two levels in one 白兵 make one
// message with the whole gain.
const untold = new WeakMap();
export function addExp(g, id, raw) {
  const o = g.officers[id];
  o.exp = Math.min(49999, o.exp + raw);
  const th = D.rules.level_exp[o.level - 1];
  if (o.level < 8 && o.exp >= th) {
    const q = untold.get(g) ?? new Map(); untold.set(g, q);
    if (!q.has(id)) q.set(id, { level: o.level, war: o.war });
    o.level++;
    o.war += o.war <= 50 ? 6 : o.war <= 70 ? 5 : o.war <= 80 ? 4 : o.war <= 89 ? 2 : 0;
    return true;
  }
  return false;
}
// The level-ups since the last call, in the order they came: [{ id, from, to, warFrom, war }]. Clears them.
export function takeLevelUps(g) {
  const q = untold.get(g); if (!q?.size) return [];
  untold.delete(g);
  return [...q].map(([id, b]) => ({ id, from: b.level, to: g.officers[id].level, warFrom: b.war, war: g.officers[id].war }));
}

// ---------- Talent / unification checks (6.9) ----------
export function talentCount(g) {
  const otherRulers = new Set(g.factions.filter((f) => f.id !== g.current).map((f) => f.ruler));
  return g.officers.filter((o) => o.status !== DEAD && !otherRulers.has(o.id)).length;
}
export function unificationParts(g) {
  const ruler = g.factions[g.player].ruler;
  let n = 0, loy = 0, gov = 0;
  for (const c of g.cities) { if (!isPass(c.id)) gov += c.gov; for (const id of c.officers) if (id !== ruler) { n++; loy += g.officers[id].loyalty; } }
  return { officers: n, loyalty: n ? Math.floor(loy / n) : 0, talent: Math.floor((n * 100) / 130), gov: Math.floor(gov / cityCount()) };
}
export function unificationScore(g) {
  const { loyalty, talent, gov } = unificationParts(g);
  return Math.floor((loyalty + talent + gov) / 3);
}
// Who congratulates the ruler: the realm's sharpest mind, the later city and slot on a tie, as the original's scan at
// bank 26 $C626 (research/endings-two-player-evidence.md §2), which does not leave out the ruler.
export function evaluator(g) {
  let best = g.factions[g.player].ruler, top = -1;
  for (const c of g.cities) for (const id of c.officers) if (g.officers[id].int >= top) { top = g.officers[id].int; best = id; }
  return best;
}

// 敌方策动我军时由仍在本势力任职、智力最高的部将通报。
export function playerAdvisor(g) {
  const ruler = g.factions[g.player]?.ruler;
  const officers = g.cities.filter((c) => c.faction === g.player).flatMap((c) => c.officers)
    .filter((id) => id !== ruler && g.officers[id]?.status === SERVING);
  return officers.reduce((best, id) => best == null || g.officers[id].int > g.officers[best].int ? id : best, null) ?? ruler ?? null;
}

// ---------- Turn loop (5.8) ----------
// io: { event(e), chooseHeir(f, cands, why), aiTurn(f), playerTurn(f) } — all async. Runs until the game ends.
export async function run(g, io) {
  while (!g.over) {
    // Unification is judged before the turn can rotate: a war won with the last command book must not
    // roll into next month's deaths and successions first (the original checks at the command entry).
    if (citiesOf(g, g.player).length === cityCount()) { g.over = { type: 'unify', score: unificationScore(g) }; await io.event({ type: 'unify', score: g.over.score }); return; }
    if (g.current == null || g.books <= 0 || g.endTurn) { g.endTurn = false; await rotate(g, io); continue; }
    // 若页面在回合初始化途中恢复，补发尚未领取的被动；已领取的回合不会重复。
    if (D.rulerPassives) grantRulerPassive(g, g.current);
    await io.playerTurn(g.current);
  }
}

// After any war or event that can kill rulers or empty a faction: succession, then fall.
export async function checkFactions(g, io) {
  for (const fac of g.factions) {
    if (fac.ruler == null) continue;
    const f = fac.id, ruler = fac.ruler;
    const taken = rulerTaken(g, f), ronin = g.officers[ruler].status === RONIN && g.officers[ruler].warRulerRonin === true;
    if (taken || g.officers[ruler].status === DEAD || g.officers[ruler].status === RONIN) {
      if (g.officers[ruler].status === RONIN && !ronin) g.officers[ruler].status = DEAD; // 原版无路可退
      const succeeded = await succession(g, io, f, ruler, taken, ronin);
      delete g.officers[ruler].warRulerRonin; delete g.officers[ruler].warRulerSpared;
      if (!succeeded) continue;
    }
    if (!citiesOf(g, f).length) {
      destroyFaction(g, f);
      await io.event({ type: 'fall', faction: f });
      if (f === g.player) { g.over = { type: 'gameover' }; await io.event({ type: 'gameover' }); }
    }
  }
}

async function rotate(g, io) {
  for (;;) {
    g.turnIdx++;
    if (g.turnIdx >= g.factions.length) {
      g.turnIdx = 0; g.monthDone = false; g.month++;
      if (g.month >= 12) { g.month = 0; g.year++; }
      for (const f of g.factions) f.alliance = f.alliance.map((t) => Math.max(0, t - 1));
    }
    const f = D.rules.turn_orders[g.order][g.turnIdx];
    if (!alive(g, f)) {
      const followed = followJoin(g, f);
      if (followed) await io.event({ type: 'join', ...followed });
      continue;
    }
    // 恢复尚未完成继位的记录，包括旧版被俘记录和战后下野记录。
    const pendingRuler = g.factions[f].ruler, taken = rulerTaken(g, f);
    const ronin = g.officers[pendingRuler].status === RONIN && g.officers[pendingRuler].warRulerRonin === true;
    if (taken || ronin) {
      const succeeded = await succession(g, io, f, pendingRuler, taken, ronin);
      delete g.officers[pendingRuler].warRulerRonin; delete g.officers[pendingRuler].warRulerSpared;
      if (!succeeded) { if (g.over) return; continue; }
    }
    g.current = f;
    if (talentCount(g) < 30) { g.over = { type: 'talent' }; await io.event({ type: 'talent' }); return; }
    g.books = books(g, f);
    if (!g.monthDone) {
      g.monthDone = true;
      if (g.month === 3) await io.event({ type: 'income', kind: 'gold', list: income(g, 'gold') });
      else if (g.month === 9) await io.event({ type: 'income', kind: 'rice', list: income(g, 'rice') });
      else { const list = riots(g); if (list.length) await io.event({ type: 'riot', list }); }
      if (g.month === 7 || g.month === 8) await io.event({ type: 'disaster', kind: 'drought', list: disaster(g, 'drought') });
      if (g.month === 4 || g.month === 5) await io.event({ type: 'disaster', kind: 'flood', list: disaster(g, 'flood') });
    }
    const joined = autoJoin(g, f);
    if (joined) await io.event({ type: 'join', faction: f, ...joined });
    const oldRuler = g.factions[f].ruler;
    const dead = naturalDeaths(g, f);
    if (dead.length) await io.event({ type: 'death', faction: f, list: dead });
    if (g.officers[oldRuler].status === DEAD && !(await succession(g, io, f, oldRuler))) continue;
    // 君主可能驻守关隘；最后一城的守将病逝或继位后下野时，须在本回合立即判定灭亡。
    if (D.expandedMap && !citiesOf(g, f).length) {
      await checkFactions(g, io);
      if (g.over) return;
      if (!alive(g, f)) continue;
    }
    // 君主继位后按新君主的当前属性生效；已开始的回合和中断战斗恢复不会重复领取。
    if (D.rulerPassives) grantRulerPassive(g, f);
    // 只在本势力新回合检查，玩家从中断战斗恢复后不会重复抽取。
    if (g.cityRaids === true && io.raid) { await io.raid(f); if (g.over) return; }
    const development = chooseCampaignEvent(g, f, { rng, isPass });
    if (development) {
      const c = g.cities[development.city];
      const choice = g.factions[f].ai ? (c.rice < 200 || (c.disaster >= 100 && c.land >= 999) ? 'rice' : 'works') : await io.campaignEvent?.(development);
      applyCampaignEvent(g, development, choice);
    }
    if (g.factions[f].ai) {
      await io.aiTurn(f); if (g.over) return;
      // 电脑外交可能诱走最后守将；战斗已有自己的结算检查，此处也覆盖非战斗行动。
      if (D.expandedMap) { await checkFactions(g, io); if (g.over) return; }
      g.books = 0; continue;
    }
    const delegated = runGovernors(g);
    if (delegated.length) await io.event({ type: 'governors', entries: delegated });
    return; // player's turn begins
  }
}

// 被俘或下野的君主仍然活着，继位提示要与死亡区分。
export async function succession(g, io, f, oldRuler, captured = false, ronin = false) {
  if (captured) rulerFirst(g, officerCity(g, oldRuler));
  const cands = heirCandidates(g, f);
  if (!cands.length) {
    destroyFaction(g, f);
    await io.event({ type: 'fall', faction: f });
    if (f === g.player) { g.over = { type: 'gameover' }; await io.event({ type: 'gameover' }); }
    return false;
  }
  const heir = g.factions[f].ai ? autoHeir(g, f) : await io.chooseHeir(f, cands, captured ? 'captured' : ronin ? 'ronin' : 'dead');
  const quit = crown(g, f, heir, oldRuler);
  await io.event({ type: 'heir', faction: f, heir, old: oldRuler, quit, ...(captured ? { captured: true } : ronin ? { ronin: true } : {}) });
  return true;
}

// ---------- Player commands (5.3, 5.7, 5.9) ----------
// Each returns { ok, msg, ... }; the caller spends one command book on success unless noBook.
const bandI = (i) => (i <= 50 ? 0 : i <= 80 ? 1 : 2);
export function devCost(g, executor) { const r = rng(g); return [10, 12, 14, 16, 18, 20, 22, 24, 26][bandI(g.officers[executor].int) * 2 + r(5)]; }
// What one 开发 / 防灾 by this officer can cost, [least, most]: the tables above without their roll (for a run of several, whose later
// costs are not rolled until each is carried out).
export const devCostRange = (g, executor) => { const b = bandI(g.officers[executor].int) * 4; return [10 + b, 18 + b]; };
export const disasterCostRange = (g, executor) => { const b = [10, 13, 16][bandI(g.officers[executor].int)]; return [b, b + 3]; };
export function develop(g, cid, executor, field, cost) {
  if (isPass(cid)) return { ok: false, msg: '关隘不能开发城市' };
  const c = g.cities[cid], r = rng(g);
  const cap = field === 'pop' ? 9999 : 999;
  if (c[field] >= cap) return { ok: false, msg: '已经达到上限' };
  if (c.gold < cost) return { ok: false, msg: '金不足' };
  c.gold -= cost;
  const q = Math.floor((cost * g.officers[executor].int) / 100);
  const d = Math.max(1, Math.floor((q * (r(8) + 10)) / 10));
  const want = (field === 'pop' ? Math.max(1, Math.floor(d / 2)) : d) + (officerPassive(D, g, executor)?.development ?? 0);
  const before = c[field]; c[field] = Math.min(cap, before + want);
  const a = c[field] - before;
  c.gov = Math.min(100, c.gov + 1 + (a >= 31 ? 1 : 0));
  return { ok: true, gain: a, msg: `${{ land: '土地', industry: '产业', pop: '人口' }[field]} +${field === 'pop' ? a * 100 : a}` };
}
export function disasterCost(g, executor) { const r = rng(g); return [10, 13, 16][bandI(g.officers[executor].int)] + r(4); }
export function prevent(g, cid, executor, cost) {
  if (isPass(cid)) return { ok: false, msg: '关隘无需防灾' };
  const c = g.cities[cid], r = rng(g);
  if (c.disaster >= 99) return { ok: false, msg: '防灾已满' };
  if (c.gold < cost) return { ok: false, msg: '金不足' };
  c.gold -= cost;
  const q = Math.floor((cost * g.officers[executor].int) / 100), d = Math.max(1, Math.floor((q * (6 + r(5))) / 10));
  const before = c.disaster; c.disaster = Math.min(99, before + d + (officerPassive(D, g, executor)?.prevention ?? 0));
  return { ok: true, gain: c.disaster - before, msg: `防灾 +${c.disaster - before}` };
}
export function reward(g, cid, target, gold, treasure = false) {
  const c = g.cities[cid], o = g.officers[target], r = rng(g);
  if (o.loyalty >= 90) return { ok: false, msg: '忠诚已高，无需赏赐' };
  const V = g.officers[g.factions[c.faction].ruler].virtue;
  let inc;
  if (treasure) { if (c.treasure < 1) return { ok: false, msg: '没有宝物' }; c.treasure--; inc = Math.floor(((Math.floor(V / 10) + 3) * (10 + r(7))) / 10); }
  else { if (gold < 10 || c.gold < gold) return { ok: false, msg: '金不足' }; c.gold -= gold; inc = Math.floor(((Math.floor(V / 10) + Math.floor(gold / 20)) * (7 + r(4))) / 10); }
  const before = o.loyalty; o.loyalty = Math.min(99, before + inc);
  return { ok: true, msg: `${name(target)} 忠诚 +${o.loyalty - before}` };
}
export function charity(g, cid, gold, rice) {
  if (isPass(cid)) return { ok: false, msg: '关隘不能施舍' };
  const c = g.cities[cid], r = rng(g);
  if (c.gov >= 100) return { ok: false, msg: '统治度已满' };
  if ((!gold && !rice) || c.gold < gold || c.rice < rice) return { ok: false, msg: '金米不足' };
  c.gold -= gold; c.rice -= rice;
  const Vg = g.officers[c.officers[0]].virtue;
  const q = Math.floor(((gold + rice) * Vg) / 2000), d = Math.floor((q * (10 + r(7))) / 10);
  const before = c.gov; c.gov = Math.min(100, before + d + (d > 0 ? officerPassive(D, g, c.officers[0])?.charity ?? 0 : 0));
  return { ok: true, msg: `统治度 +${c.gov - before}` };
}
// 武将不能读书 (g.noStudy, an option off by default and absent from older records; not in the ROM): no officer, the
// player's or the computer's, raises 智力 by study. 学问所 is greyed out in the city menu, and the AI's study draw
// (ai.js domestic) finds no one, as when every officer is outside 50–79.
export const NO_STUDY = '已开启「武将不能读书」';
export function study(g, cid, id) {
  const c = g.cities[cid], o = g.officers[id], r = rng(g);
  if (g.noStudy) return { ok: false, msg: NO_STUDY };
  if (!D.cities[cid].facilities.school) return { ok: false, msg: '此城没有学问所' };
  if (o.int >= 80) return { ok: false, msg: '智力80以上无法再学' };
  const [cost, base] = o.int <= 30 ? [30, 5] : o.int <= 60 ? [20, 8] : [10, 6];
  if (c.gold < cost) return { ok: false, msg: '金不足' };
  c.gold -= cost; const inc = base + r(5); o.int += inc;
  return { ok: true, msg: `${name(id)} 智力 +${inc}（花费${cost}金）` };
}
export function heal(g, cid, id) {
  const c = g.cities[cid], o = g.officers[id], r = rng(g), max = maxHp(o);
  if (!D.cities[cid].facilities.hospital) return { ok: false, msg: '此城没有病院' };
  if (o.hp >= max) return { ok: false, msg: '体力已满' };
  if (c.gold < 50) return { ok: false, msg: '金不足' };
  c.gold -= 50; const before = o.hp; o.hp = Math.min(max, o.hp + 35 + r(11));
  return { ok: true, msg: `${name(id)} 体力 +${o.hp - before}` };
}
export const conscriptMax = (c) => Math.floor(Math.min(Math.max(0, 10000 - c.reserve), Math.floor(c.gold / 20) * 100) / 100);
export function conscript(g, cid, hundreds) {
  if (isPass(cid)) return { ok: false, msg: '关隘不能征兵，请从城市补给' };
  const c = g.cities[cid];
  if (hundreds < 1 || hundreds > conscriptMax(c)) return { ok: false, msg: '无法征兵' };
  c.gold -= 20 * hundreds; c.reserve += 100 * hundreds;
  return { ok: true, msg: `征兵 ${hundreds * 100}` };
}
// 分兵 (5.9 §8): round to 100, +100 while ≤999 (so 1000 max), −100 keeps reserve ≤10000. No book.
export function assignTroops(g, cid, id, delta) {
  const c = g.cities[cid], o = g.officers[id];
  const rem = o.soldiers % 100; o.soldiers -= rem; c.reserve += rem;
  if (c.reserve > 10000) { o.soldiers += c.reserve - 10000; c.reserve = 10000; }
  if (delta > 0 && o.soldiers <= 900 && c.reserve > 0) { const n = Math.min(100, c.reserve); o.soldiers += n; c.reserve -= n; }
  if (delta < 0 && o.soldiers > 0 && !rem && c.reserve < 9901) { o.soldiers -= 100; c.reserve += 100; }
}
// 关隘不计入城数，最后一城向关隘派兵时必须留守，避免移动后出现没有城市的存续势力。
export function mustGuardLastCity(g, from, to) {
  const c = g.cities[from];
  return !!c && c.faction !== NONE && !isPass(from) && isPass(to) && citiesOf(g, c.faction).length === 1;
}
export function moveOfficers(g, from, to, ids) {
  const a = g.cities[from], b = g.cities[to];
  if (!roads(from).includes(to)) return { ok: false, msg: '只能移往道路相连的城' };
  if (b.faction !== a.faction && b.faction !== NONE) return { ok: false, msg: '只能移往己方或无主城' };
  if (b.officers.length + ids.length > 10) return { ok: false, msg: '目标城武将已满10人' };
  if (mustGuardLastCity(g, from, to) && a.officers.every((id) => ids.includes(id))) return { ok: false, msg: '前往关隘时须在最后一座城市留守至少一名武将' };
  const f = a.faction, ruler = g.factions[f].ruler;
  a.officers = a.officers.filter((x) => !ids.includes(x));
  b.officers.push(...ids);
  if (ids.includes(ruler)) { b.officers = [ruler, ...b.officers.filter((x) => x !== ruler)]; g.factions[f].city = to; }
  if (!a.officers.length) a.faction = NONE;
  b.faction = f;
  return { ok: true, msg: `${ids.map(name).join('、')} 移往${cityName(to)}` };
}
export function transport(g, from, to, gold, rice, treasure) {
  const a = g.cities[from], b = g.cities[to];
  if (!transportRoutes(g, from).has(to)) return { ok: false, msg: advancedBattle(g) ? '没有连通的己方运输路线' : '只能运往相邻己方城' };
  gold = Math.min(gold, a.gold, 9999 - b.gold); rice = Math.min(rice, a.rice, 9999 - b.rice); treasure = Math.min(treasure, a.treasure, 99 - b.treasure);
  if (!gold && !rice && !treasure) return { ok: false, msg: '没有可运输的物资' };
  a.gold -= gold; b.gold += gold; a.rice -= rice; b.rice += rice; a.treasure -= treasure; b.treasure += treasure;
  return { ok: true, msg: `运往${cityName(to)}：金${gold} 米${rice}${treasure ? ` 宝${treasure}` : ''}` };
}
export function transportRoutes(g, from) {
  const src = g.cities[from], paths = new Map();
  if (!src || src.faction === NONE) return paths;
  const queue = [from], seen = new Set(queue), limit = advancedBattle(g) ? 3 : 1;
  for (const id of queue) {
    const path = paths.get(id) ?? [from];
    if (path.length > limit) continue;
    for (const next of roads(id)) {
      if (seen.has(next) || g.cities[next].faction !== src.faction) continue;
      seen.add(next); queue.push(next); paths.set(next, [...path, next]);
    }
  }
  return paths;
}

export function setGovernorOrder(g, cid, task, reserve = 100) {
  if (!advancedBattle(g) || g.cities[cid]?.faction !== g.player || isPass(cid)) return false;
  if (task != null && (!['prevent', 'recruit', 'rice'].includes(task) || !Number.isInteger(reserve) || reserve < 0 || reserve > 9999)) return false;
  const orders = (g.governorOrders ??= {});
  if (task == null) delete orders[cid]; else orders[cid] = { task, reserve };
  return true;
}

export function runGovernors(g) {
  if (!advancedBattle(g) || !g.governorOrders || g.current !== g.player) return [];
  const month = g.year * 12 + g.month, entries = [];
  if (g.governorMonth === month) return entries;
  g.governorMonth = month;
  for (const [id, { task, reserve }] of Object.entries(g.governorOrders)) {
    if (g.books <= 1 || entries.length === 2) break;
    const c = g.cities[id], officer = c?.officers[0], gold = c?.gold - reserve;
    if (c?.faction !== g.player || officer == null || gold <= 0) continue;
    let res;
    if (task === 'prevent' && c.disaster < 75 && gold >= disasterCostRange(g, officer)[1]) res = prevent(g, c.id, officer, disasterCost(g, officer));
    if (task === 'recruit' && c.reserve < 300 && gold >= 20) res = conscript(g, c.id, 1);
    const buy = D.cities[id].rice_rate[1];
    if (task === 'rice' && buy >= 1 && c.rice < 500 && gold >= Math.floor(10000 / buy)) res = buyRice(g, c.id, 100);
    if (res?.ok) { g.books--; entries.push({ city: c.id, message: res.msg }); }
  }
  return entries;
}
export function appoint(g, cid, id) {
  const c = g.cities[cid];
  if (c.officers.includes(g.factions[c.faction].ruler)) return { ok: false, msg: '君主所在城由君主任太守' };
  c.officers = [id, ...c.officers.filter((x) => x !== id)];
  return { ok: true, msg: `${name(id)} 任${cityName(cid)}太守`, noBook: true };
}
export function buyRice(g, cid, rice) {
  const c = g.cities[cid], [, buy] = D.cities[cid].rice_rate;
  if (!buy) return { ok: false, msg: '此城没有米市' };
  const max = Math.ceil((c.gold * buy) / 100); rice = Math.min(rice, max, 9999 - c.rice);
  if (rice <= 0) return { ok: false, msg: '金不足' };
  c.gold = Math.max(0, c.gold - Math.floor((rice * 100) / buy)); c.rice += rice;
  return { ok: true, msg: `买米 ${rice}` };
}
export function sellRice(g, cid, rice) {
  const c = g.cities[cid], [sell] = D.cities[cid].rice_rate;
  if (!sell) return { ok: false, msg: '此城没有米市' };
  rice = Math.min(rice, c.rice); if (rice <= 0) return { ok: false, msg: '没有米' };
  c.rice -= rice; c.gold = Math.min(9999, c.gold + Math.floor((rice * sell) / 100));
  return { ok: true, msg: `卖米 ${rice}` };
}
export function sellTreasure(g, cid, n) {
  const c = g.cities[cid]; n = Math.min(n, c.treasure);
  if (n <= 0) return { ok: false, msg: '没有宝物' };
  c.treasure -= n; c.gold = Math.min(9999, c.gold + 100 * n);
  return { ok: true, msg: `卖宝 ${n} 件，得金 ${100 * n}` };
}
// Special items in the strategy shop (`0x38A7B`): owner or stat gate, plus a one-time global bought
// flag (`$6FE1`) written only when the purchase goes through. 狼牙枪/圣者之衣 compare against 91 here.
const SPECIAL = { 15: { bit: 0x02, ok: (o) => o.id === 38, need: '关羽专用' }, 23: { bit: 0x04, ok: (o) => o.id === 153, need: '张飞专用' },
  22: { bit: 0x08, ok: (o) => o.war >= 91, need: '需武力91' }, 30: { bit: 0x10, ok: (o) => o.virtue >= 91, need: '需人德91' } };
// The battlefield shop entry (file 0x1274B) compares 武力/人德 with 90 (BCC on #$5A); the city entry uses 91.
const FIELD_SPECIAL = { 22: { ok: (o) => o.war >= 90, need: '需武力90' }, 30: { ok: (o) => o.virtue >= 90, need: '需人德90' } };
export function equipBlock(g, id, eq, { field = false } = {}) {
  const sp = SPECIAL[eq], officer = g.officers[id];
  const item = D.equipment[eq];
  if (item?.exclusiveRuler !== undefined) return '君主专属武器不可购买或转移';
  if (sp) {
    if ((g.specialBought || 0) & sp.bit) return '已售出';
    const test = (field && FIELD_SPECIAL[eq]) || sp;
    if (!test.ok(officer)) return test.need;
  }
  const requirement = D.equipment[eq]?.requirements;
  if (requirement?.officers && !requirement.officers.includes(id)) {
    const names = requirement.officers.slice(0, 3).map((who) => D.officers[who].name).join('、');
    return `仅限${names}${requirement.officers.length > 3 ? '等武将' : ''}购买`;
  }
  for (const [key, label] of [['war', '武力'], ['int', '智力'], ['virtue', '人德']]) {
    if (requirement?.[key] !== undefined && officer[key] < requirement[key]) return `需${label}${requirement[key]}`;
  }
  return null;
}
// Put a bought item on (no refund for the old one) and mark a special piece as sold for the rest of the game.
export function wearEquip(g, id, eq) {
  const e = D.equipment[eq], o = g.officers[id];
  if (e?.exclusiveRuler !== undefined) return '君主专属武器不可购买或转移';
  if (SPECIAL[eq]) g.specialBought = (g.specialBought || 0) | SPECIAL[eq].bit;
  if (e.kind === 'weapon') o.weapon = eq; else o.armor = eq - 24;
  return `${name(id)} 装备了${e.name}`;
}
export function buyEquip(g, cid, id, eq) {
  const c = g.cities[cid], e = D.equipment[eq];
  if (!D.cities[cid].facilities.weapons || !D.cities[cid].shop.includes(eq)) return { ok: false, msg: '此城不卖' };
  const block = equipBlock(g, id, eq); if (block) return { ok: false, msg: `${e.name}：${block}` };
  if (c.gold < e.price) return { ok: false, msg: '金不足' };
  c.gold -= e.price;
  return { ok: true, msg: wearEquip(g, id, eq) };
}

// 搜索 (5.7): matrix row by roster/int/virtue band; candidates from the city's table, else ronin nearby.
// 三顾模式 (g.sangu, an option off by default and absent from older records; the player's 搜索 only, the AI's
// is in ai.js): each search in a city with room while its queue head is ready counts one visit for him
// (g.visits, by officer, kept in the record), whatever it turns up; the third brings him in, whoever he favours.
const band = (v) => (v <= 40 ? 40 : v <= 80 ? 80 : 99);
export const SANGU_VISITS = 3;
export function search(g, cid, executor) {
  if (isPass(cid)) return { ok: false, msg: '关隘不能搜索人才' };
  const c = g.cities[cid], o = g.officers[executor], r = rng(g);
  const n = Math.min(10, c.officers.length);
  const row = D.search_outcomes[`${Math.max(1, n)},${band(o.int)},${band(o.virtue)}`];
  const full = c.officers.length >= 10;
  const head = g.sangu && !full ? queueHead(g, searchOrder(g, cid)) : null;
  if (head?.ready) {
    const v = g.visits ||= {};
    v[head.id] = (v[head.id] || 0) + 1;
    if (v[head.id] >= SANGU_VISITS) { join(g, cid, head.id); return { ok: true, msg: `${name(head.id)} 感于三顾之诚，愿意出仕`, joined: head.id }; }
  }
  let res = row[r(8)];
  let cand = null;
  if (!full && (res === 5 || res === 6)) {
    cand = searchCandidate(g, cid);
    if (cand == null) { do res = [1, 1, 2, 2, 8, 8, 8, 8][r(8)]; while (res >= 5); }
    else if (Object.entries(D.rules.search_preference).some(([f, ids]) => ids.includes(cand))) res = 7;
  }
  if (full) while (res >= 5) res = row[r(8)];
  const extra = () => { let v; do v = r(256); while (v >= 41); return v; };
  if (res === 1) { const v = 30 + extra(); c.gold = Math.min(9999, c.gold + v); return { ok: true, msg: `发现了金 ${v}` }; }
  if (res === 2) { const v = 50 + extra(); c.rice = Math.min(9999, c.rice + v); return { ok: true, msg: `发现了米 ${v}` }; }
  if (res === 3) { const v = 80 + extra(); c.gold = Math.min(9999, c.gold + v); return { ok: true, msg: `发现了大量的金 ${v}` }; }
  if (res === 4) { const v = 1 + r(3); c.treasure = Math.min(99, c.treasure + v); return { ok: true, msg: `发现了宝物 ${v} 件` }; }
  if (res === 8) return { ok: true, msg: '什么也没有找到' };
  const t = g.officers[cand];
  if (res === 5) { join(g, cid, cand); return { ok: true, msg: `${name(cand)} 愿意出仕`, joined: cand }; }
  if (res === 6) return { ok: true, offer: cand, price: Math.floor((t.hp + t.war + t.int) / 3), msg: `${name(cand)} 要求 ${Math.floor((t.hp + t.war + t.int) / 3)} 金` };
  const pf = Number(Object.entries(D.rules.search_preference).find(([, ids]) => ids.includes(cand))[0]);
  const base = c.faction === pf ? 2 : 13, direction = recruitDisposition(D, g, c.faction, cand);
  const threshold = Math.max(1, Math.min(15, base - direction)), draw = r(16), accept = draw >= threshold;
  if (accept) { join(g, cid, cand); return { ok: true, msg: `${name(cand)} ${draw < base ? '因旧交情愿意出仕' : '被您的仁德打动，愿意出仕'}`, joined: cand }; }
  return { ok: true, msg: `${name(cand)} ${draw >= base ? '因旧怨拒绝出仕' : '拒绝了出仕'}`, refused: cand };
}
function searchCandidate(g, cid) {
  const head = queueHead(g, searchOrder(g, cid));
  if (head?.ready) return head.id;
  const near = [cid, ...roads(cid)];
  return g.officers.find((o) => o.status === RONIN && near.includes(o.loc))?.id ?? null;
}
export function hire(g, cid, id, price) {
  const c = g.cities[cid];
  if (c.gold < price) return { ok: false, msg: '金不足' };
  c.gold -= price; join(g, cid, id);
  return { ok: true, msg: `${name(id)} 出仕`, joined: id };
}
function join(g, cid, id) {
  const c = g.cities[cid], o = g.officers[id];
  if (g.visits) delete g.visits[id];
  const loyalty = o.status === RONIN ? recruitLoyalty(g.officers[g.factions[c.faction].ruler].virtue, o.loyalty) : o.loyalty;
  o.loyalty = recruitLoyaltyWithRelation(D, g, c.faction, id, loyalty);
  o.status = SERVING; c.officers.push(id);
}

// ---------- Save / load (localStorage, numbered slots) ----------
// The original kept a single record; here slots 1–SLOTS each hold a whole game. A record from before slots
// (stored under KEY itself) moves into the first empty slot the first time the slots are read.
// Each slot keeps the record it held before the last write under `:bak`, and a slot that no longer parses or
// checks out (a cut-off write, a hand edit) loads that one instead; restored() tells the game so it can say so.
// g.version is the record's layout: MIGRATIONS[n] lifts a version-n record to n + 1 when it loads, and a record
// written by a newer release is refused rather than misread.
export const SLOTS = 8, SAVE_VERSION = 1;
const MIGRATIONS = {};
const KEY = 'haou-hd2d-save', key = () => scenarioKey(KEY), slotKey = (n) => `${key()}:${n}`, bakKey = (n) => `${key()}:${n}:bak`;
const quickKey = () => `${key()}:quick`, quickBak = () => `${quickKey()}:bak`;
const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const read = (k) => { try { return parse(localStorage.getItem(k)); } catch { return null; } };
export const futureVersion = (g) => (Number.isInteger(g?.version) && g.version > SAVE_VERSION)
  || (Number.isInteger(g?.campaignRevision) && g.campaignRevision > CAMPAIGN_REVISION);
const slotStates = new WeakMap();
export function slotToken(slot) { try { return localStorage.getItem(slotKey(slot)); } catch { return undefined; } }
export const futureSlot = (slot) => futureVersion(parse(slotToken(slot)));
export function currentSlot(g, slot, token = slotToken(slot)) {
  const saved = slotStates.get(g);
  return token !== undefined && g?.slot === slot && saved?.slot === slot && saved.token === token;
}
export const loadedSlotToken = (g) => slotStates.get(g)?.token;
// 灾害及袭扰时间来自存档；拒绝损坏状态，避免读档后在回合中途报错或重置冷却。
function validRaidState(g) {
  const raids = g.cityRaids === true;
  if (!raids && g.enhancedDisasters !== true) return true;
  const time = (v) => Number.isSafeInteger(v) && v >= 0;
  const table = (v, limit) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.entries(v).every(([key, value]) =>
    /^(0|[1-9]\d*)$/.test(key) && Number(key) < limit && time(value));
  if (g.disasterHistory != null && !table(g.disasterHistory, g.cities.length)) return false;
  if (!raids) return true;
  if (g.disasterFactions != null && !table(g.disasterFactions, g.factions.length)) return false;
  if (g.raidRiots != null && !table(g.raidRiots, g.cities.length)) return false;
  const h = g.raidHistory;
  if (h != null && (typeof h !== 'object' || Array.isArray(h) || !(h.last === null || time(h.last))
    || !table(h.factions, g.factions.length) || !table(h.cities, g.cities.length) || !table(h.checked, g.factions.length))) return false;
  return g.raidWars == null || table(g.raidWars, g.factions.length);
}
function validCampaignEventState(g) {
  const h = g.campaignEventHistory;
  if (h == null) return true;
  const time = (v) => Number.isSafeInteger(v) && v >= 0;
  const table = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.entries(v).every(([key, value]) =>
    /^(0|[1-9]\d*)$/.test(key) && Number(key) < g.factions.length && time(value));
  return typeof h === 'object' && !Array.isArray(h) && (h.last === null || time(h.last))
    && (h.applied === undefined || time(h.applied)) && table(h.factions) && table(h.checked);
}
// 旧记录可能包含动态武将或袭城临时武将，因此只验证实际记录和引用，不要求其存在于静态武将表。
function validRoster(g) {
  const validId = (id) => Number.isInteger(id) && id >= 0 && !!g.officers[id];
  const fields = ['hp', 'war', 'int', 'loyalty', 'virtue', 'exp', 'soldiers', 'weapon', 'armor', 'level', 'status'];
  if (!g.factions[g.player] || g.officers.some((o, id) => !o || o.id !== id || fields.some((key) => !Number.isFinite(o[key])))) return false;
  if (g.clones != null) {
    const firstClone = D ? staticRosterSize(D,g) : 0;
    if (!Array.isArray(g.clones) || new Set(g.clones).size !== g.clones.length || g.clones.some((id) => !validId(id) || id < firstClone)) return false;
  }
  if (g.factions.some((f) => !f || (f.ruler != null && !validId(f.ruler)))) return false;
  if (g.officers.some((o) => {
    const weapon = D.equipment[o.weapon];
    return weapon?.exclusiveRuler !== undefined && weapon.exclusiveRuler !== o.id;
  })) return false;
  const cityFields = ['gold', 'rice', 'pop', 'land', 'industry', 'disaster', 'gov', 'reserve', 'treasure'];
  return g.cities.every((c, id) => c.id === id && Number.isInteger(c.faction) && (c.faction === NONE || !!g.factions[c.faction])
    && cityFields.every((key) => Number.isFinite(c[key])) && c.officers.every(validId));
}
export function upgrade(g) {
  if (!g || typeof g !== 'object') return null;
  if ((g.scenarioId ?? ORIGINAL_SCENARIO) !== scenarioId) return null;
  try { g.version ??= 1; while (g.version < SAVE_VERSION) MIGRATIONS[g.version++](g); } catch { return null; }
  if (g.campaignRevision !== undefined && (!Number.isInteger(g.campaignRevision) || g.campaignRevision < 1
    || g.campaignRevision > CAMPAIGN_REVISION || !supportsNewBattle()
    || (g.campaignRevision === 1 && scenarioId !== EXPANDED_MAP_ID))) return null;
  if (g.frontierMap !== undefined && typeof g.frontierMap !== 'boolean') return null;
  if (g.governorMonth !== undefined && (!advancedBattle(g) || !Number.isSafeInteger(g.governorMonth) || g.governorMonth < 0)) return null;
  if (g.governorOrders !== undefined && (!advancedBattle(g) || !g.governorOrders || typeof g.governorOrders !== 'object' || Array.isArray(g.governorOrders)
    || Object.entries(g.governorOrders).some(([id, order]) => !/^(0|[1-9]\d*)$/.test(id) || !D.cities[id] || isPass(+id) || !order
      || !['prevent', 'recruit', 'rice'].includes(order.task) || !Number.isInteger(order.reserve) || order.reserve < 0 || order.reserve > 9999))) return null;
  if (g.famousSkills !== undefined && (![true,2].includes(g.famousSkills) || scenarioId !== EXPANDED_MAP_ID || D.expandedMap !== true)) return null;
  if (g.famousRoster !== undefined && (g.famousRoster !== 1 || g.famousSkills !== 2 || scenarioId !== EXPANDED_MAP_ID || D.expandedMap !== true)) return null;
  if (g.famousSkills === 2 && (g.famousRoster !== 1 || !Array.isArray(g.officers) || g.officers.length < FAMOUS_ROSTER_START+FAMOUS_ROSTER.length)) return null;
  if (g.siegeTactics !== undefined && (g.siegeTactics !== true || g.battlefields !== 2 || !supportsNewBattle())) return null;
  if (g.battlefields !== undefined && (![1, 2].includes(g.battlefields) || !supportsNewBattle())) return null;
  // 旧扩展地图记录只补充无主的新据点，已有城市、武将及战斗状态不重置。
  const legacyCount = 30 + EXPANDED_NODES.length;
  if (D.expandedMap && D.frontierMap && Array.isArray(g.cities) && g.cities.length === legacyCount && g.frontierMap !== true) {
    g.cities.push(...D.cities.slice(legacyCount).map(cityRecord)); g.frontierMap = true;
  }
  const ok = g.version === SAVE_VERSION && Number.isInteger(g.year) && Number.isInteger(g.month) && Number.isInteger(g.player)
    && (g.enhancedRulerPassives === undefined || typeof g.enhancedRulerPassives === 'boolean')
    && (g.focusedRulerPassives === undefined || typeof g.focusedRulerPassives === 'boolean')
    && (g.battleRulerPassives === undefined || typeof g.battleRulerPassives === 'boolean')
    && (!g.battleRulerPassives || (g.focusedRulerPassives === true && g.campaignRules === true))
    && (g.relationshipEffects === undefined || typeof g.relationshipEffects === 'boolean')
    && (g.autoBattleSkills === undefined || typeof g.autoBattleSkills === 'boolean')
    && (g.eliteTroops === undefined || typeof g.eliteTroops === 'boolean')
    && (g.safeAiLure === undefined || typeof g.safeAiLure === 'boolean')
    && (g.safeStrategyChance === undefined || typeof g.safeStrategyChance === 'boolean')
    && (g.balancedTroops === undefined || typeof g.balancedTroops === 'boolean')
    && (g.expandedOpeningGuard === undefined || typeof g.expandedOpeningGuard === 'boolean')
    && (g.campaignRules === undefined || typeof g.campaignRules === 'boolean')
    && Array.isArray(g.officers) && Array.isArray(g.factions) && Array.isArray(g.cities) && g.cities.length === D.cities.length && g.cities.every((c) => Array.isArray(c?.officers)) && validRoster(g) && validRaidState(g) && validCampaignEventState(g);
  return ok ? g : null;
}

function missingCampaignDefaults(g) {
  const defaults = campaignDefaults();
  // 玩家已经选择旧版被动方案时，保留该选择及其前置开关。
  if ((g.focusedRulerPassives ?? defaults.focusedRulerPassives) !== true
    || (g.campaignRules ?? defaults.campaignRules) !== true) delete defaults.battleRulerPassives;
  return Object.entries(defaults).filter(([key]) => g[key] === undefined);
}

export function campaignUpgradeAvailable(g) {
  if (!D || !supportsNewBattle() || g?.scenarioId !== scenarioId
    || g.over || g.raidBattle || (g.campaignRevision ?? 0) >= CAMPAIGN_REVISION) return false;
  return scenarioId === EXPANDED_MAP_ID || advancedBattle(g);
}

export function upgradeCampaign(g) {
  if (!campaignUpgradeAvailable(g)) return false;
  const next = upgrade(structuredClone(g));
  if (!next) return false;
  if (advancedBattle(next)) {
    next.campaignRevision = CAMPAIGN_REVISION;
    if (!upgrade(next)) return false;
    Object.assign(g, next);
    registerClones(g);
    return true;
  }
  if (!hasFamousRoster(next)) {
    // 原有编号保留。旧记录的分身排在新增名将之后，城市、势力及三顾计数一并迁移。
    const extras = next.officers.slice(FAMOUS_ROSTER_START), clones = new Set(next.clones);
    if (next.officers.length < FAMOUS_ROSTER_START || extras.some((o) => !clones.has(o.id))) return false;
    const remap = (id) => clones.has(id) ? id + FAMOUS_ROSTER.length : id;
    const recruits = FAMOUS_ROSTER.map((_, i) => officerRecord(famousRosterTemplate(FAMOUS_ROSTER_START + i)));
    next.officers = [...next.officers.slice(0, FAMOUS_ROSTER_START), ...recruits, ...extras.map((o) => ({ ...o, id: remap(o.id) }))];
    if (clones.size) {
      next.clones = next.clones.map(remap);
      for (const city of next.cities) city.officers = city.officers.map(remap);
      for (const faction of next.factions) {
        faction.ruler = remap(faction.ruler);
        if (faction.fallen != null) faction.fallen = remap(faction.fallen);
      }
      if (next.visits) next.visits = Object.fromEntries(Object.entries(next.visits).map(([id, count]) => [remap(Number(id)), count]));
    }
  }
  Object.assign(next, Object.fromEntries(missingCampaignDefaults(next)), FAMOUS_CAMPAIGN_RULES, { campaignRevision: CAMPAIGN_REVISION });
  if (!upgrade(next)) return false;
  Object.assign(g, next);
  registerClones(g);
  return true;
}
const fromBak = new WeakSet();
export const restored = (g) => fromBak.has(g);
function migrate() {
  if (scenarioId !== ORIGINAL_SCENARIO) return;
  try {
    const old = localStorage.getItem(KEY); if (!old) return;
    for (let n = 1; n <= SLOTS; n++) if (!localStorage.getItem(slotKey(n))) { localStorage.setItem(slotKey(n), old); localStorage.removeItem(KEY); return; }
  } catch {}
}
function prepareSave(g, slot) {
  const savedAt = Date.now();
  return { savedAt, text: JSON.stringify({ ...g, slot, savedAt, version: SAVE_VERSION }) };
}
// 单个 localStorage 写入失败时该键保持原值。主档写入失败后恢复本次已轮换的备份。
function writeRecordPair(key, backupKey, text, previous) {
  const backup = localStorage.getItem(backupKey);
  if (futureVersion(parse(backup))) return 'newer';
  const rotate = previous && previous !== backup;
  if (rotate) localStorage.setItem(backupKey, previous);
  try {
    localStorage.setItem(key, text);
  } catch (error) {
    if (rotate) {
      try {
        if (backup === null) localStorage.removeItem(backupKey);
        else localStorage.setItem(backupKey, backup);
      } catch (restoreError) { console.error('存档写入失败后无法恢复备份', restoreError); }
    }
    throw error;
  }
  return 'saved';
}
function commitSave(g, slot, expected, previous, prepared) {
  try {
    const current = slotToken(slot);
    if (current === undefined) return 'failed';
    if (current !== expected) return 'changed';
    if (futureVersion(parse(current)) || futureVersion(parse(previous))) return 'newer';
    if (!upgrade(parse(prepared.text))) return 'failed';
    const result = writeRecordPair(slotKey(slot), bakKey(slot), prepared.text, upgrade(parse(previous)) ? previous : null);
    if (result !== 'saved') return result;
    g.slot = slot; g.savedAt = prepared.savedAt; g.version = SAVE_VERSION;
    slotStates.set(g, { slot, token: prepared.text });
    return 'saved';
  } catch { return 'failed'; }
}
export function save(g, slot = g.slot ?? 1) {
  try {
    if ((g.scenarioId ?? ORIGINAL_SCENARIO) !== scenarioId || futureVersion(g)) return false;
    const current = slotToken(slot);
    if (current === undefined || futureVersion(parse(current))) return false;
    return commitSave(g, slot, current, current, prepareSave(g, slot)) === 'saved';
  } catch { return false; }
}
// 确认期间或等待锁期间若记录被其他页面更改，保留现有内容并要求重新选择。
export async function saveChecked(g, slot, expected, { snapshot = g, isCurrent = () => true, onSaved = () => {}, acceptedConflict, onConflict = () => {}, acceptedPending, onPending = () => {} } = {}) {
  if (futureVersion(snapshot)) return 'newer';
  if ((snapshot.scenarioId ?? ORIGINAL_SCENARIO) !== scenarioId) return 'wrong-scenario';
  return withRecordLock(slotKey(slot), (state) => {
    const token = slotToken(slot);
    if (token === undefined) return 'failed';
    if (token !== expected) return 'changed';
    if (futureVersion(parse(token)) || (state && futureVersion(parse(state.token)))) return 'newer';
    if (!isCurrent()) return 'cancelled';
    if (state && state.token !== expected && state.token !== acceptedConflict) { onConflict(state.token); return 'changed'; }
    const prepared = prepareSave(snapshot, slot);
    return { before: token, token: prepared.text, commit: (previous) => {
      if (!isCurrent()) return 'cancelled';
      const result = commitSave(snapshot, slot, expected, previous, prepared);
      if (result !== 'saved') return result;
      if (snapshot !== g) {
        g.slot = snapshot.slot; g.savedAt = snapshot.savedAt; g.version = snapshot.version;
        slotStates.set(g, slotStates.get(snapshot));
      }
      try { onSaved(prepared.text); } catch { /* 记录已经写入 */ }
      return 'saved';
    } };
  }, { readCurrent: () => slotToken(slot), acceptedPending, onPending });
}
// The phone's 自动续玩 (src/app.js): the campaign as it stood when the page went out of sight, kept apart from the eight records
// and the quick one. It is written when the page is hidden and dropped when the page comes back, so it only outlives a page the
// system threw away; continuing from it takes it. It is no record: nothing is spent, and it cannot be loaded a second time.
const autoKey = () => `${key()}:auto`;
export function autoToken() { try { return localStorage.getItem(autoKey()); } catch { return undefined; } }
export function saveAuto(g, onSaved) {
  if ((g.scenarioId ?? ORIGINAL_SCENARIO) !== scenarioId || futureVersion(g)) return false;
  try {
    const previous = autoToken();
    if (previous === undefined || futureVersion(parse(previous))) return false;
    const text = JSON.stringify({ ...g, savedAt: Date.now(), version: SAVE_VERSION });
    localStorage.setItem(autoKey(), text);
    onSaved?.(text);
    return true;
  } catch { return false; }
}
export function loadAuto({ preview = false } = {}) { const g = upgrade(read(autoKey())); if (g) { if (!preview) registerClones(g); g.auto = true; } return g; }
export function dropAuto(expected = autoToken()) {
  if (expected == null || futureVersion(parse(expected))) return false;
  try {
    if (autoToken() !== expected) return false;
    localStorage.removeItem(autoKey());
    return true;
  } catch { return false; }
}
export function load(slot, { preview = false } = {}) {
  migrate();
  const raw = slotToken(slot), parsed = parse(raw);
  if (futureVersion(parsed)) return null;
  let g = upgrade(parsed);
  if (!g && raw && (g = upgrade(read(bakKey(slot))))) fromBak.add(g); // an empty slot stays empty
  if (g) { g.slot = slot; if (!preview) registerClones(g); slotStates.set(g, { slot, token: raw }); }
  return g;
}
// The quick record is separate from the eight numbered records. Its owner identifies a campaign, not a
// ruler or a month: two games started with the same ruler must still ask before replacing one another.
const newQuickId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
// The title and editor immediately dereference the player's ruler and city. A parsed JSON object that
// lacks either is damaged, even if the generic legacy record check accepts its arrays.
function quickUpgrade(g) {
  g = upgrade(g); if (!g) return null;
  const originalOfficers = D ? staticRosterSize(D,g) : 0;
  if (!originalOfficers || g.officers.length < originalOfficers
    || !Number.isInteger(g.month) || g.month < 0 || g.month >= 12
    || !Number.isInteger(g.level) || !D.rules.income_ab[g.level]
    || !Number.isInteger(g.order) || !D.rules.turn_orders[g.order]
    || !Number.isInteger(g.turnIdx) || g.turnIdx < -1 || g.turnIdx >= g.factions.length
    || (g.current != null && (!Number.isInteger(g.current) || !g.factions[g.current]))
    || !Number.isInteger(g.books) || g.books < 0
    || !Array.isArray(g.aiCursor) || g.aiCursor.length < g.factions.length || g.aiCursor.some((i) => !Number.isInteger(i) || i < 0 || i > D.cities.length)) return null;
  const f = g.factions[g.player], ruler = f?.ruler, city = f?.city;
  if (g.clones != null && !Array.isArray(g.clones)) return null;
  const clones = new Set(g.clones ?? []);
  const known = (id) => Number.isInteger(id) && !!g.officers[id] && !!(D?.officers?.[id] || clones.has(id) || (hasFamousRoster(g) && id>=FAMOUS_ROSTER_START && id<FAMOUS_ROSTER_START+FAMOUS_ROSTER.length));
  if (!known(ruler) || !Number.isInteger(city) || !g.cities[city]) return null;
  // The HUD, turn loop and editor iterate every officer/faction and dereference each city's roster.
  if (g.officers.some((o, i) => !o || o.id !== i || !known(i))) return null;
  if (g.factions.length !== D?.factions?.length || g.factions.some((fac, i) => !fac || fac.id !== i || !Array.isArray(fac.alliance) || fac.alliance.length < g.factions.length
    || (fac.ruler != null && (!known(fac.ruler) || !Number.isInteger(fac.city) || !g.cities[fac.city])) || (fac.fallen != null && !known(fac.fallen)))) return null;
  if (g.cities.some((c, i) => c.id !== i || !Number.isInteger(c.faction) || (c.faction !== NONE && !g.factions[c.faction]) || c.officers.some((id) => !known(id)))) return null;
  return g;
}
// The raw value is also a change token while an overwrite confirmation is open in another tab.
export function quickToken() { try { return localStorage.getItem(quickKey()); } catch { return undefined; } }
export function hasQuick() { return !!quickToken(); }
export const futureQuick = (token = quickToken()) => futureVersion(parse(token));
function prepareQuick(g) {
  const id = g.quickId || newQuickId();
  const text = JSON.stringify({ ...g, quickId: id, savedAt: Date.now(), version: SAVE_VERSION });
  return quickUpgrade(parse(text)) ? { id, text } : null;
}
function commitQuick(g, expected, previous, prepared) {
  try {
    const current = quickToken();
    if (current === undefined) return 'failed';
    if (current !== expected) return 'changed';
    if (futureQuick(current) || futureQuick(previous)) return 'newer';
    const result = writeRecordPair(quickKey(), quickBak(), prepared.text, quickUpgrade(parse(previous)) ? previous : null);
    if (result !== 'saved') return result;
    g.quickId = prepared.id; // never change the running game or its current numbered slot on a failed write
    return 'saved';
  } catch { return 'failed'; }
}
export function saveQuick(g) {
  try {
    if (futureVersion(g)) return false;
    const current = quickToken(), prepared = prepareQuick(g);
    return current !== undefined && !!prepared && commitQuick(g, current, current, prepared) === 'saved';
  } catch { return false; }
}
// Every game/editor writer checks and writes inside the same origin-wide lock. A token check outside
// the lock alone cannot protect two tabs that both see the empty slot at the same instant.
export async function saveQuickChecked(g, expected, { isCurrent = () => true, onSaved = () => {}, acceptedConflict, onConflict = () => {}, acceptedPending, onPending = () => {} } = {}) {
  if (futureVersion(g)) return 'newer';
  if ((g.scenarioId ?? ORIGINAL_SCENARIO) !== scenarioId) return 'wrong-scenario';
  return withRecordLock(quickKey(), (state) => {
    const token = quickToken();
    if (token === undefined) return 'failed';
    if (token !== expected) return 'changed';
    if (futureQuick(token) || (state && futureQuick(state.token))) return 'newer';
    if (!isCurrent()) return 'cancelled';
    if (state && state.token !== expected && state.token !== acceptedConflict) { onConflict(state.token); return 'changed'; }
    const prepared = prepareQuick(g);
    if (!prepared) return 'failed';
    return { before: token, token: prepared.text, commit: (previous) => {
      if (!isCurrent()) return 'cancelled';
      const result = commitQuick(g, expected, previous, prepared);
      if (result !== 'saved') return result;
      try { onSaved(prepared.text); } catch { /* the record was already written */ }
      return 'saved';
    } };
  }, { readCurrent: quickToken, acceptedPending, onPending });
}
export function loadQuick({ preview = false } = {}) {
  let raw = null; try { raw = localStorage.getItem(quickKey()); } catch {}
  if (!raw) return null;
  const parsed = parse(raw);
  // An unknown future layout is not a damaged record: do not silently offer an older backup in its place.
  if (futureVersion(parsed)) return null;
  let g = quickUpgrade(parsed), backup = false;
  if (!g && (g = quickUpgrade(read(quickBak())))) backup = true;
  // The numbered slot saved in the snapshot may since have been replaced by another campaign. A manual
  // save after loading must ask before overwriting it, just as for any other occupied slot.
  return g && loadSnapshot(g, { quick: true, backup, preview });
}
// Reconstitute the record the player confirmed after a page restart, retaining backup diagnostics.
export function loadSnapshot(g, { quick = false, backup = false, preview = false } = {}) {
  g = quick ? quickUpgrade(g) : upgrade(g); if (!g) return null;
  if (quick) g.slot = null;
  if (backup) fromBak.add(g);
  if (!preview) registerClones(g);
  return g;
}
// 阿会喃 copies made by the 原版漏洞 mode (core/ahuinan.js) are officers past the original 237. Each borrows officer
// 0's static entry (name, portrait, army, appearance) under its own id, so every lookup by id keeps working.
export function registerClones(g) {
  activateFamousRoster(D,g);
  if (D) for (const id of g.clones ?? []) D.officers[id] = { ...D.officers[0], id, clone: true, year: g.officers[id]?.debut ?? g.year };
  return g;
}
// Every slot in order, null where empty; latest() is the one saved most recently (a migrated record has no time).
export function saves() { migrate(); return Array.from({ length: SLOTS }, (_, i) => load(i + 1, { preview:true })); }
export function latest(list = saves()) { return list.filter(Boolean).sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))[0] ?? null; }
// A resumed game draws a fresh seed, so loading the same record and doing the same thing does not replay the
// same events. The original's random cursor drifted with idle frames instead (waiting changed the outcome);
// that is not copied, as it teaches load-wait-retry. The saved seed is kept for reproducing a report.
export function reseed(g, seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0) { g.savedSeed = g.seed; g.seed = seed; return g; }

// ---------- Diplomacy (5.6, player side) ----------
// 同盟 (`bank25` proposal), 诱纳 and 离间 (`$D036` → `$E843`) all make the original's percent roll: table bytes from the
// moving cursor, those of 100 and over thrown away (core/origrng.js), which comes under p more often than p in 100.
export function allianceOffer(g, cid, actor, target) {
  const r = rng(g), me = g.cities[cid].faction, a = g.officers[actor], tr = g.officers[g.factions[target].ruler];
  const t = Math.max(a.int + a.virtue - tr.int, 0);
  let p = Math.floor(t / 4) + Math.max(citiesOf(g, me).length - citiesOf(g, target).length, 0);
  if (p & 128) p = 0;
  if (roll100(r) >= p) return { ok: true, msg: `${factionName(g, target)}拒绝了同盟` };
  const c = g.cities[cid], thr = c.gold > c.rice ? 3 : c.gold === c.rice ? 5 : 7;
  return { ok: true, quote: 4 * (100 - p), kind: r(10) < thr ? 'gold' : 'rice', target, msg: `${factionName(g, target)}愿意结盟` };
}
export function payAlliance(g, cid, target, kind, amount) {
  const c = g.cities[cid], me = c.faction;
  if (c[kind] < amount) return { ok: false, msg: `${kind === 'gold' ? '金' : '米'}不足，同盟未成`, noBook: true };
  c[kind] -= amount;
  const dst = officerCity(g, g.factions[target].ruler);
  if (dst) dst[kind] = Math.min(9999, dst[kind] + amount);
  const duration = advancedBattle(g) ? 14 : 12;
  g.factions[me].alliance[target] = g.factions[target].alliance[me] = duration;
  return { ok: true, msg: `与${factionName(g, target)}结成同盟（${duration}个月）`, noBook: true };
}
// 废除同盟 (bank 28 $CD0A→$CEAD→$CEC7): an ally chosen under 同盟 skips the envoy and asks only for the book;
// 是 clears both sides' timers through $D508 and nothing else — no envoy, payment, loyalty or reply. $0473=$80
// skips the officer picture ($D186), so the result is the bare message $44.
export function breakAlliance(g, me, target) {
  g.factions[me].alliance[target] = 0; g.factions[target].alliance[me] = 0;
  return { ok: true, msg: `与${factionName(g, target)}的同盟已经废除`, plain: true };
}
const LURE = [[30, 5000, 250], [40, 4000, 450], [50, 3000, 900], [60, 2000, 1300], [70, 1000, 2000], [75, 0, 2400]];
export function lure(g, cid, actor, id) {
  const r = rng(g), c = g.cities[cid], a = g.officers[actor], o = g.officers[id];
  if (c.officers.length >= 10) return { ok: false, msg: '本城武将已满' };
  if (isRuler(g, id)) return { ok: false, msg: '无法诱纳君主' };
  const row = LURE.find(([l]) => o.loyalty <= l);
  const base = row ? Math.floor((a.int * a.virtue + row[1] + 100 * (a.level - 1)) / row[2]) : 0;
  const p = recruitThreshold(D, g, c.faction, id, base, factionOf(g, id));
  if (roll100(r) >= p) return { ok: true, msg: `诱纳${name(id)}失败`, failed: true };
  const from = officerCity(g, id);
  from.officers = from.officers.filter((x) => x !== id); if (!from.officers.length) from.faction = NONE;
  c.officers.push(id); o.loyalty = recruitLoyaltyWithRelation(D, g, c.faction, id, recruitLoyalty(g.officers[g.factions[c.faction].ruler].virtue, o.loyalty));
  return { ok: true, msg: `${name(id)}接受诱纳，加入我军`, joined: id };
}
export function sow(g, actor, id) {
  const r = rng(g), a = g.officers[actor], o = g.officers[id];
  if (isRuler(g, id)) return { ok: false, msg: '无法离间君主' };
  const p = Math.floor((((a.int + a.virtue) & 255) * Math.max(98 - o.loyalty, 0)) / 100);
  if (roll100(r) >= p) return { ok: true, msg: `离间${name(id)}失败`, failed: true };
  const loss = Math.floor(a.int / 20) + (r(256) & 3);
  if (!loss) return { ok: true, msg: `离间${name(id)}失败`, failed: true };
  o.loyalty = Math.max(0, o.loyalty - loss);
  return { ok: true, msg: `${name(id)}忠诚 −${loss}（现${o.loyalty}）` };
}
