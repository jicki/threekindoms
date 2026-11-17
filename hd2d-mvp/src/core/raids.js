// 特殊守城不创建可占城的势力；临时敌将只存在于战斗和中断记录中。
import { data, rng, NONE, SERVING, RONIN, DEAD, maxHp, toRonin, isPass } from './game.js';

// 以游戏的州郡范围划分近海，河流或洪水名单不能作为海岸判断。
export const COASTAL_CITIES = Object.freeze([0, 3, 10, 16, 17, 18, 38]);
export const RAID_COOLDOWN = 18;
const label = (kind) => kind === 'pirate' ? '海贼' : '山贼';
const stamp = (g) => g.year * 12 + g.month;

// 每个势力每月只抽一次；全图每月最多一场，同一势力及城市至少间隔 18 个月。
export function chooseRaid(g, faction) {
  if (g.cityRaids !== true || g.over || g.raidBattle || g.year < 190 || g.factions[faction]?.ruler == null) return null;
  const now = stamp(g), history = (g.raidHistory ??= { last: null, factions: {}, cities: {}, checked: {} });
  if (history.checked[faction] === now) return null;
  history.checked[faction] = now;
  if (history.last === now || now - (history.factions[faction] ?? -Infinity) < RAID_COOLDOWN || now - (g.raidWars?.[faction] ?? -Infinity) < 2) return null;
  // 先让整个受灾势力处理灾情，避免同月在任何城市被迫进入守城。
  if (g.disasterFactions?.[faction] === now || g.cities.some((c) => c.faction === faction && g.disasterHistory?.[c.id] === now)) return null;
  const cities = g.cities.filter((c) => {
    if (c.faction !== faction || isPass(c.id) || !c.officers.length || now - (history.cities[c.id] ?? -Infinity) < RAID_COOLDOWN) return false;
    const troops = c.officers.reduce((sum, id) => sum + g.officers[id].soldiers, 0);
    return troops >= 100 && g.officers[c.officers[0]].hp >= 20 && c.rice >= Math.max(50, Math.ceil(troops * 4 / 1000) * 20);
  });
  // 仅内陆本月新发生的暴乱可引来山贼；其余暴乱冷却初期仍不叠加随机袭扰。
  const riots = cities.filter((c) => c.riot >= 5 && g.raidRiots?.[c.id] === now && !COASTAL_CITIES.includes(c.id));
  const candidates = riots.length ? riots : cities.filter((c) => !(c.riot >= 5));
  if (!candidates.length) return null;
  const r = rng(g), human = !g.factions[faction].ai;
  if (r(100) >= (human ? 5 : 1)) return null;
  const c = candidates[r(candidates.length)], troops = c.officers.reduce((sum, id) => sum + g.officers[id].soldiers, 0);
  const kind = COASTAL_CITIES.includes(c.id) ? 'pirate' : 'bandit';
  history.last = now; history.factions[faction] = now; history.cities[c.id] = now;
  const cause = riots.length ? 'riot' : null, ratio = cause ? (human ? 0.3 : 0.15) : (human ? 0.4 : 0.2);
  return { city: c.id, faction, kind, troops: Math.max(1, Math.min(2000, Math.floor(troops * ratio))), ...(cause ? { cause } : {}) };
}

// 中断记录只允许尾部连续的临时敌将，避免覆盖真实人物或旧版动态武将。
export function validRaidRecord(g, war) {
  const raid = g?.raidBattle, ids = war?.att?.ids;
  if (!raid || !war?.raid || !['bandit', 'pirate'].includes(raid.kind) || raid.kind !== war.raid.kind
    || !Number.isInteger(raid.first) || !Number.isInteger(raid.count) || raid.count < 1 || raid.count > 2
    || !Array.isArray(g.officers) || raid.first + raid.count !== g.officers.length || !Array.isArray(ids) || ids.length !== raid.count
    || !Number.isInteger(war.city) || !Number.isInteger(war.from) || !g.cities?.[war.from] || !Array.isArray(war.def?.ids)
    || !Array.isArray(war.raid.defenders) || war.def.ids.length < 1 || war.def.ids.length > 10 || war.def.ids.length !== war.raid.defenders.length
    || new Set(war.raid.defenders).size !== war.raid.defenders.length || war.raid.defenders.some((id) => !war.def.ids.includes(id) || !Number.isInteger(id) || id < 0 || id >= raid.first)
    || !g.cities?.[war.city] || !g.factions?.[war.defender] || war.attacker !== NONE || (g.clones != null && !Array.isArray(g.clones))
    || (g.clones ?? []).some((id) => ids.includes(id))) return false;
  const D = data(), minimum = D.officers.filter((o) => o && !o.clone).length;
  return raid.first >= minimum && ids.every((id, i) => id === raid.first + i && g.officers[id]?.id === id && g.officers[id]?.raidEnemy === true
    && (!D.officers[id] || D.officers[id].clone));
}

export function registerRaidTemplates(g, war) {
  if (!validRaidRecord(g, war)) return false;
  const D = data(), { kind, first, count } = g.raidBattle;
  for (let i = 0; i < count; i++) {
    const id = first + i;
    D.officers[id] = { ...D.officers[0], id, name: `${label(kind)}${i ? '喽啰' : '头目'}`, hp: 70, army: kind === 'pirate' ? '水' : '山',
      portraitId: 0, visual: null, skills: [], duelSkill: null, troopType: null, troopLimit: null, clone: true, raidTemp: true };
  }
  return true;
}

// 准备战场时保留原守军及军资，战后只将守方状态写回原城。
export function startRaid(g, plan) {
  const c = g.cities[plan.city], D = data(), first = g.officers.length;
  if (g.raidBattle || !c || !g.factions[plan.faction] || c.faction !== plan.faction || !Array.isArray(c.officers) || !c.officers.length || c.officers.length > 10 || new Set(c.officers).size !== c.officers.length
    || c.officers.some((id) => !Number.isInteger(id) || id < 0 || id >= first || !g.officers[id]) || !['bandit', 'pirate'].includes(plan.kind)
    || !Number.isInteger(plan.troops) || plan.troops < 1 || plan.troops > 2000 || first < D.officers.filter((o) => o && !o.clone).length
    || (g.clones != null && !Array.isArray(g.clones)) || (g.clones ?? []).some((id) => id >= first)
    || [first, first + 1].some((id) => D.officers[id] && !D.officers[id].clone)) throw new Error('无法准备守城战斗');
  const count = Math.max(1, Math.ceil(plan.troops / 1000)), ids = [];
  for (let i = 0, left = plan.troops; i < count; i++) {
    // 先补足主将，再分配副将，避免越过 1000 人时主将兵力突然减半。
    const id = first + i, soldiers = Math.min(1000, left); left -= soldiers; ids.push(id);
    g.officers.push({ id, hp: 70, maxHp: 70, war: i ? 45 : 55, int: 28, virtue: 30, loyalty: 100,
      exp: 0, level: 1, soldiers, weapon: 8, armor: 0, army: plan.kind === 'pirate' ? '水' : '山', status: SERVING, loc: null, raidEnemy: true });
  }
  g.raidBattle = { kind: plan.kind, first, count };
  const war = { city: c.id, from: D.cities[c.id].roads[0] ?? c.id, attacker: NONE, defender: c.faction, day: 1,
    raid: { kind: plan.kind, defenders: [...c.officers], ...(plan.cause === 'riot' ? { cause: 'riot' } : {}) },
    att: { ids, gold: 0, rice: Math.max(300, Math.ceil(plan.troops * 4 / 1000) * 31) },
    def: { ids: [...c.officers], gold: c.gold, rice: c.rice } };
  if (!registerRaidTemplates(g, war)) { g.officers.length = first; delete g.raidBattle; throw new Error('临时敌军资料无效'); }
  c.officers = []; c.gold = 0; c.rice = 0;
  return war;
}

export function resolveRaid(g, war, res) {
  if (!validRaidRecord(g, war)) throw new Error('守城战斗记录无效');
  const c = g.cities[war.city], owner = war.defender, ruler = g.factions[owner].ruler;
  const dead = new Set(res.dead), captured = new Set(res.captured.byAtt), retreats = new Map(res.retreated.map((item) => [item.id, item.city]));
  c.gold = Math.max(0, Math.min(9999, res.chests.def.gold)); c.rice = Math.max(0, Math.min(9999, res.chests.def.rice));
  c.faction = owner; c.officers = [];
  for (const id of war.raid.defenders) {
    const o = g.officers[id];
    if (dead.has(id) || captured.has(id)) {
      // 战场记录的是致命一刻的结果；事后切换不战死不能改写已经发生的阵亡。
      if (id === ruler && dead.has(id)) {
        o.status = DEAD; o.hp = 0;
        if (owner === g.player) g.over = { type: 'gameover' };
      } else {
        o.status = RONIN; o.loc = war.city; o.hp = Math.min(30, maxHp(o, id)); o.soldiers = 0;
        if (id === ruler) o.warRulerRonin = true;
      }
      continue;
    }
    const dest = g.cities[retreats.get(id)];
    if (dest && (dest.faction === owner || dest.faction === NONE) && dest.officers.length < 10) {
      dest.faction = owner; dest.officers.push(id);
    } else c.officers.push(id);
    o.status = SERVING;
  }
  if (!c.officers.length) c.faction = NONE;
  if (res.loser === 'def') for (const key of ['gold', 'rice', 'land', 'industry']) c[key] -= Math.floor(c[key] * 0.05);
  const rulerCity = g.cities.find((city) => city.faction === owner && city.officers.includes(ruler));
  if (rulerCity) { g.factions[owner].city = rulerCity.id; rulerCity.officers = [ruler, ...rulerCity.officers.filter((id) => id !== ruler)]; }
  return { winner: res.loser === 'att' ? owner : NONE, loser: res.loser === 'att' ? NONE : owner };
}

export function finishRaid(g, war) {
  if (!validRaidRecord(g, war)) throw new Error('无法清理守城敌军');
  const D = data(), { first, count } = g.raidBattle;
  for (let id = first; id < first + count; id++) if (D.officers[id]?.raidTemp) delete D.officers[id];
  while (D.officers.length && !D.officers[D.officers.length - 1]) D.officers.pop();
  g.officers.length = first; delete g.raidBattle;
}

// 电脑遭遇的袭扰较弱，败北仅少量受损；至少留一名守将，贼军永不占城。
export function resolveAiRaid(g, plan) {
  const c = g.cities[plan.city], r = rng(g), ruler = g.factions[plan.faction].ruler;
  // 暴乱已经损害城市，随之而来的袭扰也应比普通袭扰更弱。
  const riot = plan.cause === 'riot', breached = r(100) < (riot ? 15 : 20), percent = breached ? (riot ? 6 : 8) : (riot ? 2 : 3);
  for (const id of c.officers) g.officers[id].soldiers -= Math.floor(g.officers[id].soldiers * percent / 100);
  let ronin = null;
  const candidates = c.officers.filter((id) => id !== ruler);
  if (breached && c.officers.length > 1 && candidates.length && r(100) < 20) {
    ronin = candidates[r(candidates.length)]; g.officers[ronin].hp = Math.min(30, maxHp(g.officers[ronin], ronin));
    g.officers[ronin].soldiers = 0; toRonin(g, ronin);
  }
  if (breached) for (const key of ['gold', 'rice', 'land', 'industry']) c[key] -= Math.floor(c[key] * 0.05);
  return { breached, ronin };
}
