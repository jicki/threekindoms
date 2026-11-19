// War set-up and write-back shared by field battles (player involved) and AI-vs-AI auto battles.
// 出阵 (5.9 §7), 战后 (6.10 §3–6), AI 自动战 (6.5 第五/六批).
import { data, rng, NONE, DEAD, SERVING, RONIN, roads, officerCity, capturedLoyalty, recruitLoyalty, addExp, citiesOf, holdingsOf, kill, isRuler, isPass, sparedHp, rulerPassive } from './game.js';
import { abilityDuel, abilityStrategyIds, strategySpecs } from './famous-skills.js';
import { officerSquads, SPECIAL_TROOPS } from './troop-specialties.js';
import { passiveRiceUse } from './ruler-passives.js';
import { relationshipAffinity } from './relationships.js';
import { CROSSING_ROADS } from './expanded-map.js';
import { battlefieldLayout, battlefieldProfile } from './battlefields.js';
import { siegeLayout } from './siege.js';
import { advancedBattle, officerPassive } from './battle-rules.js';

// 旧版已中断的战斗仍可沿当时的出阵路线撤回，不恢复这条路线的出阵资格。
const legacyCrossing = (a, b) => data().expandedMap && CROSSING_ROADS.some(({ road: [x, y] }) => (a === x && b === y) || (a === y && b === x));

// Remove the expedition from its source city and empty the target into the defender's war chest.
export function setupWar(g, { from, to, ids, commander, gold, rice }) {
  const src = g.cities[from], dst = g.cities[to];
  const attacker = src.faction, defender = dst.faction;
  // 新规则避免势力刚经历战争又立刻遇袭；旧记录不增加状态。
  if (g.cityRaids === true) {
    const now = g.year * 12 + g.month, wars = (g.raidWars ??= {});
    wars[attacker] = now; wars[defender] = now;
  }
  src.officers = src.officers.filter((x) => !ids.includes(x));
  src.gold -= gold; src.rice -= rice;
  if (!src.officers.length) src.faction = NONE;
  const att = [commander, ...ids.filter((x) => x !== commander)];
  if (att.includes(g.factions[attacker].ruler)) g.factions[attacker].city = to;
  const war = {
    city: to, from, attacker, defender, day: 1,
    att: { ids: att, gold, rice }, def: { ids: [...dst.officers], gold: dst.gold, rice: dst.rice },
  };
  dst.officers = []; dst.gold = 0; dst.rice = 0;
  return war;
}

const allied = (g, a, b) => g.factions[a]?.alliance[b] > 0 && g.factions[b]?.alliance[a] > 0;

export function defenseCandidates(g, attacker, defender, city, occupancy = g.cities[city].officers.length) {
  if (!advancedBattle(g) || occupancy >= 10) return [];
  const candidates = [];
  for (const id of roads(city)) {
    const c = g.cities[id], f = c.faction;
    if (f === attacker || f === defender || g.factions[f]?.ruler == null || !allied(g, f, defender) || allied(g, f, attacker)) continue;
    const ids = c.officers.filter((id, i) => i > 0 && !isRuler(g, id) && g.officers[id].soldiers >= 250 && g.officers[id].hp >= 40)
      .sort((a, b) => g.officers[b].soldiers - g.officers[a].soldiers);
    const count = Math.min(2, 10 - occupancy, Math.floor(c.rice / 60), ids.length);
    if (count > 0) candidates.push({ faction: f, city: id, ids: ids.slice(0, count) });
  }
  return candidates.sort((a, b) => b.ids.reduce((sum, id) => sum + g.officers[id].soldiers, 0) - a.ids.reduce((sum, id) => sum + g.officers[id].soldiers, 0) || a.city - b.city);
}

export function joinDefense(g, war, plan) {
  if (!plan || war.raid || war.support || !war.def.ids.length) return false;
  const match = defenseCandidates(g, war.attacker, war.defender, war.city, war.def.ids.length).find(c => c.city === plan.city);
  if (!match || match.faction !== plan.faction || match.ids.length !== plan.ids?.length
    || match.ids.some((id, i) => id !== plan.ids[i])) return false;
  const c = g.cities[match.city], rice = Math.min(Math.max(0, 9999 - war.def.rice), match.ids.length * 60);
  c.officers = c.officers.filter(id => !match.ids.includes(id));
  c.rice -= rice;
  war.def.ids.push(...match.ids); war.def.rice += rice; war.support = match;
  if (g.cityRaids) (g.raidWars ??= {})[match.faction] = g.year * 12 + g.month;
  return true;
}

export function validDefenseSupport(g, war, human, units = []) {
  const s = war.support;
  if (s == null) return true;
  return advancedBattle(g) && !war.raid && Number.isInteger(s.faction) && Number.isInteger(s.city)
    && Array.isArray(s.ids) && s.ids.length >= 1 && s.ids.length <= 2 && new Set(s.ids).size === s.ids.length
    && s.faction !== war.attacker && s.faction !== war.defender && g.cities[s.city]?.faction === s.faction && roads(war.city).includes(s.city)
    && war.def.ids.length <= 10 && s.ids.every(id => Number.isInteger(id) && id >= 0 && g.officers[id] && !isRuler(g, id)
      && war.def.ids.indexOf(id) > 0 && !war.att.ids.includes(id) && !g.cities.some(c => c.officers.includes(id)))
    && (human === 'att' ? war.attacker === g.player : human !== 'def' || [s.faction, war.defender].includes(g.player))
    && units.every(u => u && (u.supporting === undefined || (u.side === 'def' && !u.commander && typeof u.supporting === 'boolean'))
      && (u.capturedForSupport === undefined || (u.capturedForSupport === true && u.gone && u.fate === 'captured' && u.capturedBy === 'def')));
}

// Empty-city capture (`$B670`): no battle.
export function occupyEmpty(g, { from, to, ids, gold, rice }) {
  const src = g.cities[from], dst = g.cities[to], f = src.faction;
  src.officers = src.officers.filter((x) => !ids.includes(x)); src.gold -= gold; src.rice -= rice;
  if (!src.officers.length) src.faction = NONE;
  dst.officers.push(...ids); dst.gold = Math.min(9999, dst.gold + gold); dst.rice = Math.min(9999, dst.rice + rice); dst.faction = f;
  if (ids.includes(g.factions[f].ruler)) g.factions[f].city = to;
}

// Retreat destination (ABA3): own neighbour with <10 officers (fewest, first on tie), else last neutral neighbour.
export function retreatCity(g, battleCity, f, prefer = null) {
  if (prefer != null && (g.cities[prefer].faction === f || (g.cities[prefer].faction === NONE && legacyCrossing(battleCity, prefer)))
    && g.cities[prefer].officers.length < 10) return prefer;
  let best = null;
  for (const n of roads(battleCity)) {
    const c = g.cities[n];
    if (c.faction === f && c.officers.length < 10 && (best == null || c.officers.length < g.cities[best].officers.length)) best = n;
  }
  if (best != null) return best;
  let neutral = null;
  for (const n of roads(battleCity)) if (g.cities[n].faction === NONE) neutral = n;
  return neutral;
}
function place(g, f, ids, cid) {
  const c = g.cities[cid];
  if (c.faction === NONE) c.faction = f;
  for (const id of ids) { if (c.officers.length >= 10) return ids.slice(ids.indexOf(id)); c.officers.push(id); }
  return [];
}
function toRoninAt(g, id, cid) { const o = g.officers[id]; o.status = RONIN; o.loc = cid; }

// The losing side's settlement queue (`$D0E1`): its survivors still on the field, then its own prisoners.
export function loserQueue(res) {
  const held = res.loser === 'att' ? res.captured.byAtt : res.captured.byDef;
  return [...res.survivors[res.loser].filter((id) => !res.retreated.some((x) => x.id === id)), ...held];
}
// The winning side's queue: its survivors still on the field, then the prisoners it took.
export function winnerQueue(res) {
  const win = res.loser === 'att' ? 'def' : 'att', held = win === 'att' ? res.captured.byAtt : res.captured.byDef;
  return [...res.survivors[win].filter((id) => !res.retreated.some((x) => x.id === id)), ...held];
}

export function supportSettlement(war, res) {
  if (!war.support) return [];
  const survivors = res.supportSurvivors ?? war.support.ids;
  return [...new Set([
    ...res.survivors.def.filter(id => survivors.includes(id)),
    ...res.captured.byDef.filter(id => res.supportCaptures?.includes(id)),
  ])];
}
// Where a human loser may send them (`$BB84`): roads from the battle city to own or ownerless cities.
// Full cities are listed too; the menu refuses them (10 per city).
export function retreatOptions(g, war, f) {
  const options = roads(war.city).filter((n) => n !== war.city && (g.cities[n].faction === f || g.cities[n].faction === NONE));
  if (f === war.attacker && legacyCrossing(war.city, war.from) && !options.includes(war.from)
    && (g.cities[war.from]?.faction === f || g.cities[war.from]?.faction === NONE)) options.push(war.from);
  return options;
}

// Field battle result. survivors: { att:[ids], def:[ids] }, dead:[ids], captured:{byAtt:[ids], byDef:[ids]},
// retreated: [{id, city}], loser:'att'|'def', chests: {att:{gold,rice}, def:{gold,rice}}.
export function resolveWar(g, war, res) {
  const r = rng(g), city = g.cities[war.city];
  const winF = res.loser === 'def' ? war.attacker : war.defender, loseF = res.loser === 'def' ? war.defender : war.attacker;
  const winSide = res.loser === 'def' ? 'att' : 'def', loseSide = res.loser;
  // 一旦战斗中受保护被俘，即使结算前关闭选项，也保留该结果。
  const protectedRuler = (id) => isRuler(g, id) && (g.noWarDeath || res.sparedRulers?.includes(id));
  const roninAt = (id, cid) => {
    toRoninAt(g, id, cid);
    if (protectedRuler(id)) g.officers[id].warRulerRonin = true;
  };
  const returning = supportSettlement(war, res);
  for (const id of res.dead) if (g.officers[id].status !== DEAD) g.officers[id].status = DEAD;
  // Occupation losses (`$BF0A`, only when the defender loses).
  if (res.loser === 'def' && !res.skipCut && !isPass(war.city)) {
    const k = war.day < 6 ? 1 : war.day < 11 ? 2 : war.day < 16 ? 3 : war.day < 21 ? 4 : 6;
    const cut = (v, kk) => Math.floor(((v * (10 - kk)) % 65536) / 10);
    city.pop = cut(city.pop, 1 + r(2)); city.land = cut(city.land, k); city.industry = cut(city.industry, k); city.gov = cut(city.gov, k);
  }
  if (res.loser === 'def') city.faction = war.attacker;
  // Prisoners join their captors with recomputed loyalty. Each side's settlement queue ends with its own prisoner list (`$BDCD`/`$D0E1`): the loser's
  // prisoners retreat with the loser rather than being dropped.
  const held = (side) => (side === 'att' ? res.captured.byAtt : res.captured.byDef);
  for (const id of [...held('att'), ...held('def')]) {
    const o = g.officers[id]; o.loyalty = capturedLoyalty(o.loyalty); o.status = SERVING;
    if (protectedRuler(id)) o.warRulerSpared = true;
  }
  if (returning.length) {
    const { faction, city: home } = war.support;
    res.survivors.def = res.survivors.def.filter(id => !returning.includes(id));
    res.retreated = res.retreated.filter(o => !returning.includes(o.id));
    for (const id of returning) {
      const c = g.cities[home];
      const dest = c.faction === faction && c.officers.length < 10 ? c : holdingsOf(g, faction).find(v => v.officers.length < 10);
      if (dest) place(g, faction, [id], dest.id); else roninAt(id, home);
    }
  }
  const prisoners = held(winSide).filter(id => !returning.includes(id));
  const left = new Map(res.retreated.map((x) => [x.id, x.city])); // units that walked off the field
  // A human side's settlement menu (`$CE9E`, `$D20D`) chose each officer's city or 下野. Those choices are
  // honoured before anything is placed automatically, so the other side's overflow cannot take the
  // ownerless city or the room the player was shown; a choice that still does not fit falls through.
  // The winners always keep at least one officer in the battle city they hold.
  const chosen = (ids, f, garrison) => {
    if (!res.placement) return ids;
    const keep = garrison && city.officers.length === 0 && !ids.some((id) => res.placement[id] === war.city) ? ids[0] : null;
    return ids.filter((id) => {
      const p = res.placement[id];
      if (id === keep || p == null || p === 'auto') return true;
      if (p === 'ronin' && !isRuler(g, id)) { const n = roads(war.city)[r(8)]; toRoninAt(g, id, n ?? war.city); return false; }
      const c = g.cities[p];
      if (c && (c.faction === f || c.faction === NONE) && c.officers.length < 10) { place(g, f, [id], p); return false; }
      return true;
    });
  };
  // Units that walked off the field already reached their city during the war (`$BC2A`).
  // 武将不战死 keeps a ruler from being lost in war, an overflow included: one who walked off is placed first, so
  // later retreats into the same city cannot push him out, and if it is still full he goes to any own city with room.
  const walked = g.noWarDeath ? [...res.retreated].sort((a, b) => isRuler(g, b.id) - isRuler(g, a.id)) : res.retreated;
  for (const { id, city: dest } of walked) {
    const f = res.survivors[winSide].includes(id) ? winF : loseF;
    let over = g.cities[dest].faction === f || g.cities[dest].faction === NONE ? place(g, f, [id], dest) : [id];
    if (over.length && g.noWarDeath && isRuler(g, id)) { const c = holdingsOf(g, f).find((c) => c.officers.length < 10); if (c) over = place(g, f, [id], c.id); }
    if (over.length) roninAt(id, dest);
  }
  let queue = [...res.survivors[winSide].filter((id) => !left.has(id)), ...prisoners], back = loserQueue(res).filter(id => !returning.includes(id));
  if (res.placementSide === winSide) queue = chosen(queue, winF, true);
  else if (res.placementSide === loseSide) back = chosen(back, loseF, false);
  // Winners (and their prisoners) fill the battle city, then neighbouring own / ownerless cities.
  queue = place(g, winF, queue, war.city);
  while (queue.length) {
    const dest = retreatCity(g, war.city, winF);
    if (dest == null) {
      for (const id of queue) {
        const room = protectedRuler(id) && holdingsOf(g, winF).find((c) => c.officers.length < 10);
        if (room) place(g, winF, [id], room.id); else roninAt(id, war.city);
      }
      break;
    }
    queue = place(g, winF, queue, dest);
  }
  // Losers retreat (attackers prefer their source city).
  const loseChest = res.chests[loseSide];
  while (back.length) {
    const dest = retreatCity(g, war.city, loseF, loseSide === 'att' ? war.from : null);
    if (dest == null) {
      for (const id of back) {
        // 败方尚未被俘的君主无路可退时，由胜方优先安置；没有空位则下野。
        const room = g.noWarDeath && isRuler(g, id) && res.survivors[loseSide].includes(id)
          && holdingsOf(g, winF).find((c) => c.officers.length < 10);
        if (room) {
          const o = g.officers[id]; o.status = SERVING; o.loyalty = capturedLoyalty(o.loyalty); o.warRulerSpared = true;
          place(g, winF, [id], room.id); held(winSide).push(id);
          res.survivors[loseSide] = res.survivors[loseSide].filter((x) => x !== id);
        } else {
          // 败方携带的君主俘虏也优先安置到该俘获方的其他城市。
          const captorRoom = protectedRuler(id) && held(loseSide).includes(id) && holdingsOf(g, loseF).find((c) => c.officers.length < 10);
          if (captorRoom) place(g, loseF, [id], captorRoom.id); else roninAt(id, war.city);
        }
      }
      break;
    }
    back = place(g, loseF, back, dest);
  }
  // Gold/rice (`$C027`): winner chest to the battle city. The loser's chest follows its commander
  // (`$052C`) only if he got out still serving the loser; dead, captured or ronin → battle city.
  const add = (c, ch) => { c.gold = Math.min(9999, c.gold + ch.gold); c.rice = Math.min(9999, c.rice + ch.rice); };
  add(city, res.chests[winSide]);
  const cmd = war[loseSide].ids[0], cmdCity = cmd != null && g.officers[cmd].status === SERVING ? officerCity(g, cmd) : null;
  add(cmdCity && cmdCity.faction === loseF && cmdCity.id !== war.city ? cmdCity : city, loseChest);
  // Ruler city bookkeeping and governor swap.
  for (const f of [war.attacker, war.defender]) {
    const ruler = g.factions[f]?.ruler; if (ruler == null) continue;
    const c = officerCity(g, ruler);
    // Only in a city of his own: a ruler taken prisoner (edited loyalty, D49) neither heads his captor's list nor
    // moves his house there; checkFactions then gives the house an heir or lets it fall.
    if (c && c.faction === f) { g.factions[f].city = c.id; c.officers = [ruler, ...c.officers.filter((x) => x !== ruler)]; }
  }
  return { winner: winF, loser: loseF };
}

// 自动战斗仍是抽象结算：每名参战武将最多计入一个可负担的专属计略及一次单挑技。
// 总加成不超过基础战力的 10% 且最多 12 点；不直接扣兵、扣米或追加随机数。
export function autoSkillBonus(g, ids, enemyIds, base, faction, enemyRice) {
  const D = data();
  if (g.autoBattleSkills !== true || !ids.length || !enemyIds.length || base < 10) return 0;
  const enemy = enemyIds.map((id) => g.officers[id]).filter(Boolean);
  const maxSoldiers = Math.max(0, ...enemy.map((o) => o.soldiers));
  const maxHp = Math.max(0, ...enemy.map((o) => o.hp));
  const troops = ids.reduce((sum, id) => sum + (g.officers[id]?.soldiers ?? 0), 0);
  const cap = D.rules.mobility_cap[Math.min(9, Math.floor(troops / 1000))] + (rulerPassive(g, faction)?.combat?.mobility ?? 0);
  let raw = 0;
  for (const id of ids) {
    const officer = g.officers[id], spec = D.officers[id];
    if (!officer || !spec || officer.hp <= 0 || officer.soldiers <= 0) continue;
    let best = 0;
    for (const skillId of abilityStrategyIds(D,g,id)) {
      const skill = strategySpecs(D,g).find((item) => item.id === skillId);
      if (!skill || skill.cost > cap) continue;
      const value = Math.min(skill.soldiers, maxSoldiers) / 100 + Math.min(skill.hp, maxHp) / 10 + skill.stop / 2 + Math.min(skill.rice, Math.max(0, enemyRice)) / 100;
      best = Math.max(best, Math.min(4, Math.ceil(value / (1 + skill.cost / 12))));
    }
    raw += best + (abilityDuel(D,g,id) ? 1 : 0);
  }
  return Math.min(raw, 12, Math.floor(base / 10));
}

// AI-vs-AI automatic battle (`10:ACD5`, `A91F`, `A9CC`, `AF9C`, `ABA3`, `11:CD68`).
// The fight itself (`A91F`, `A9CC`, `AF9C`): strength, days, troop loss, deaths, experience and the losers' loyalty
// draws (captured = draw100 ≥ loyalty). Settlement is the caller's: autoBattle for real cities, ahuinan.js for 王莆.
export function fight(g, war) {
  const r = rng(g), O = (id) => g.officers[id];
  const strength = (ids, faction) => {
    const bonus = rulerPassive(g, faction)?.combat?.war ?? 0;
    const base = Math.floor(ids.reduce((a, id) => a + Math.max(O(id).war, Math.min(99, O(id).war + bonus)), 0) / 10) + Math.floor(ids.reduce((a, id) => a + O(id).soldiers, 0) / 100) + 10 * (O(ids[0])?.exp >> 12 || 0);
    if (!advancedBattle(g) || war.phantom) return base;
    const qualified = ids.filter(id => O(id).soldiers >= 100 && O(id).hp > 0 && ['troops', 'guard', 'strategy', 'duel', 'tacticRecovery'].some(key => officerPassive(data(), g, id)?.[key]));
    return base + Math.min(4, qualified.length, Math.floor(base / 20));
  };
  const baseA = strength(war.att.ids, war.attacker), baseD = war.def.ids.length ? strength(war.def.ids, war.defender) : 0;
  const bonus = war.phantom ? { att: 0, def: 0 } : {
    att: autoSkillBonus(g, war.att.ids, war.def.ids, baseA, war.attacker, war.def.rice),
    def: autoSkillBonus(g, war.def.ids, war.att.ids, baseD, war.defender, war.att.rice),
  };
  // 电脑间抽象战斗按有兵的特色武将计入少量战力，总加成不超过基础战力的约 3%。
  const squads = (id, side) => officerSquads(data(), g, id, g.campaignRevision >= 4 && side === 'def' && war.city != null);
  const troopStrength = (ids, enemies, base, side) => {
    if (!enemies.length || g.eliteTroops !== true) return 0;
    const hasSpecialty = ({ special }) => special && (!(g.campaignRevision >= 5) || special !== SPECIAL_TROOPS.infantry.sprite);
    const able = ids.filter(id => O(id)?.hp > 0 && O(id)?.soldiers > 0 && squads(id, side).some(hasSpecialty));
    return Math.min(Math.floor(base / 30), able.length);
  };
  const troops = war.phantom ? { att: 0, def: 0 } : {
    att: troopStrength(war.att.ids, war.def.ids, baseA, 'att'), def: troopStrength(war.def.ids, war.att.ids, baseD, 'def'),
  };
  const equipment = (ids, enemies, base) => {
    if (g.campaignRules !== true || !enemies.length) return 0;
    const D = data(), value = ids.reduce((sum, id) => {
      const o = O(id);
      if (!o || o.hp <= 0 || o.soldiers <= 0) return sum;
      return sum + (D.equipment[o.weapon]?.atk ?? 0) + (D.equipment[24 + o.armor]?.dfn ?? 0);
    }, 0);
    return Math.min(6, Math.floor(base / 40), Math.floor(value / 12));
  };
  const gear = war.phantom ? { att: 0, def: 0 } : {
    att: equipment(war.att.ids, war.def.ids, baseA), def: equipment(war.def.ids, war.att.ids, baseD),
  };
  const gate = !war.phantom && g.campaignRules === true && war.def.ids.length && isPass(war.city) ? Math.min(3, Math.floor(baseD / 50)) : 0;
  let riverMap;
  const hasRiver = () => {
    if (!riverMap) {
      const D=data(), layout=battlefieldLayout(D,g,war.city,war.from);
      const dep=g.battlefields===2 ? layout?.dep ?? (D.deploy[war.city]?.[war.from] || Object.values(D.deploy[war.city] ?? {})[0]) : null;
      riverMap=dep ? siegeLayout(layout?.map ?? D.maps[war.city],dep,layout?.villages ?? D.villages[war.city] ?? [],layout?.direction,
        [30,31].includes(war.city), advancedBattle(g) ? 3 : 2, battlefieldProfile(g,war.city)).map : layout?.map ?? D.maps[war.city];
    }
    return riverMap?.some(row => row.includes(3));
  };
  // 自动结算没有逐格地形与白兵行动，用有上限的近似值体现可判断的专属战斗效果。
  const lordBonus = (ids, enemies, faction, side, base) => {
    if (g.campaignRules !== true || !enemies.length || !ids.some((id) => O(id)?.soldiers > 0)) return 0;
    const unique = rulerPassive(g, faction)?.combat?.unique, ruler = g.factions[faction]?.ruler;
    const active = ids.filter((id) => O(id)?.hp > 0 && O(id)?.soldiers > 0), D = data();
    const hasCavalry = id => squads(id, side).some(squad => squad.kind === 'cav');
    const applies = unique === 'assault' && side === 'att'
      || unique === 'muster' && active.length >= 4
      || unique === 'river' && hasRiver()
      || unique === 'tactics' && active.some((id) => O(id).int >= 50)
      || unique === 'bonds' && active.filter((id) => id !== ruler && relationshipAffinity(D, g, ruler, id) > 0).length >= 2
      || unique === 'fortify' && side === 'def'
      || unique === 'massed' && active.length >= 3
      || (unique === 'cavalry' || unique === 'horsebow') && active.some(hasCavalry)
      || unique === 'garrison' && side === 'def';
    return applies ? Math.min(2, Math.floor(base / 80)) : 0;
  };
  const lord = war.phantom ? { att: 0, def: 0 } : {
    att: lordBonus(war.att.ids, war.def.ids, war.attacker, 'att', baseA),
    def: lordBonus(war.def.ids, war.att.ids, war.defender, 'def', baseD),
  };
  const sa = baseA + bonus.att + troops.att + gear.att + lord.att, sd = baseD + bonus.def + troops.def + gear.def + gate + lord.def;
  const q = Math.floor((100 * sa) / Math.max(1, sa + sd));
  const days = 30 - Math.abs(Math.floor(q / 2) - 25);
  const proj = (ids, faction) => {
    const soldiers = ids.reduce((a, id) => a + O(id).soldiers, 0), passive = rulerPassive(g, faction);
    // 曹操的保底节粮按日生效，不能对整场粮耗只取整一次；其他规则保留原自动结算公式。
    return passive?.combat?.unique === 'supply' ? passiveRiceUse(Math.floor(soldiers * 4 / 1000), passive) * days
      : Math.floor((Math.floor(soldiers / 100) * (days * 4)) / 10);
  };
  const attWins = !war.def.ids.length || war.def.rice < proj(war.def.ids, war.defender) || r(100) < q;
  war.day = days;
  // Troop loss by current HP, deaths, experience.
  const loss = { att: 0, def: 0 }, deadN = { att: 0, def: 0 }, dead = [];
  for (const side of ['att', 'def']) for (const id of war[side].ids) { const o = O(id), left = Math.floor((o.soldiers * o.hp) / 100); loss[side] += o.soldiers - left; o.soldiers = left; }
  const surv = { att: [...war.att.ids], def: [...war.def.ids] };
  for (const side of ['att', 'def']) {
    const n = surv[side].length;
    if (n < 5) continue;
    for (let k = 0; k < Math.floor(n / 4); k++) {
      let pick = null;
      for (const id of surv[side]) if ((O(id).loyalty !== 100 || (g.noWarDeath && isRuler(g, id))) && (pick == null || O(id).war + O(id).int < O(pick).war + O(pick).int)) pick = id;
      if (pick == null) break;
      surv[side] = surv[side].filter((x) => x !== pick); dead.push(pick); deadN[side]++;
    }
  }
  for (const side of ['att', 'def']) {
    const other = side === 'att' ? 'def' : 'att', n0 = war[side].ids.length;
    for (const id of surv[side]) addExp(g, id, Math.floor(Math.floor((loss[other] + 120 * deadN[other]) / Math.max(1, n0)) / 2));
  }
  // Prisoners: loser officers with draw100 ≥ loyalty are captured.
  const loseSide = attWins ? 'def' : 'att', winSide = attWins ? 'att' : 'def';
  const captured = { byAtt: [], byDef: [] };
  // 不战死时伤亡改为被俘，君主恢复体力并保留这一结果供战后安置使用。
  const sparedRulers = [];
  if (g.noWarDeath) for (const id of dead.splice(0)) {
    (war.att.ids.includes(id) ? captured.byDef : captured.byAtt).push(id);
    if (isRuler(g, id)) { O(id).hp = sparedHp(g, id); sparedRulers.push(id); }
  }
  surv[loseSide] = surv[loseSide].filter((id) => {
    const l = O(id).loyalty;
    if (l === 100) { if (!attWins) r(100); return true; }
    if (r(100) >= l) { (winSide === 'att' ? captured.byAtt : captured.byDef).push(id); return false; }
    return true;
  });
  return { r, attWins, days, proj, surv, dead, captured, loseSide, winSide, ...(sparedRulers.length ? { sparedRulers } : {}),
    ...(bonus.att || bonus.def ? { autoSkillBonus: bonus } : {}), ...(troops.att || troops.def ? { autoTroopBonus: troops } : {}),
    ...(gear.att || gear.def ? { autoGearBonus: gear } : {}), ...(gate ? { autoGateBonus: gate } : {}),
    ...(lord.att || lord.def ? { autoRulerBonus: lord } : {}) };
}

export function autoBattle(g, war) {
  const { r, attWins, days, proj, surv, dead, captured, loseSide, sparedRulers, autoSkillBonus: skillBonus, autoTroopBonus: troopBonus, autoGearBonus: gearBonus, autoGateBonus: gateBonus, autoRulerBonus: lordBonus } = fight(g, war);
  // Rice: projected use, then defender rice/gold shrink by the byte-indexed table.
  const shrink = (v) => v - Math.floor((v * (v < 500 ? 50 : v < 1000 ? 0 : v < 3000 ? 60 : v < 5000 ? 0 : 70)) / 100);
  const chests = {
    att: { gold: war.att.gold, rice: Math.max(0, war.att.rice - (attWins ? proj(surv.att, war.attacker) : 0)) },
    def: { gold: shrink(war.def.gold), rice: shrink(Math.max(0, war.def.rice - proj(surv.def, war.defender))) },
  };
  // City damage when the attacker wins (11:CD68) replaces the field-battle occupation formula.
  if (attWins && !isPass(war.city)) {
    const c = g.cities[war.city], pct = days < 5 ? 10 : days < 10 ? 20 : days < 15 ? 30 : days < 20 ? 40 : 60;
    c.pop -= Math.floor((c.pop * (10 + r(10))) / 100);
    for (const k of ['land', 'industry', 'gov']) c[k] -= Math.floor((c[k] * pct) / 100);
  }
  const res = resolveWar(g, war, { loser: loseSide, survivors: surv, dead, captured, retreated: [], chests, skipCut: true, ...(sparedRulers?.length ? { sparedRulers } : {}) });
  for (const id of dead) kill(g, id);
  return { ...res, attWins, days, dead, captured: [...captured.byAtt, ...captured.byDef], ...(skillBonus ? { autoSkillBonus: skillBonus } : {}), ...(troopBonus ? { autoTroopBonus: troopBonus } : {}),
    ...(gearBonus ? { autoGearBonus: gearBonus } : {}), ...(gateBonus ? { autoGateBonus: gateBonus } : {}), ...(lordBonus ? { autoRulerBonus: lordBonus } : {}) };
}

// Officers that can still be placed anywhere for a faction (used for fall checks).
export const factionHasCities = (g, f) => citiesOf(g, f).length > 0;
