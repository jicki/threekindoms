// Strategic AI (6.5). Budget = command books × 10 points; the main dispatch draws 0–15 against the
// faction/difficulty/situation weights (`10:A19C` uses D4AD, so sums above 16 never reach the last
// branches), then attack/vacant expansion, inner moves + BD7A reinforcement, diplomacy, or domestic work.
import { data, currentScenario, rng, NONE, SERVING, UNAPPEARED, RONIN, roads, citiesOf, holdingsOf, isPass, troopsOf, recruitLoyalty, books, isRuler, officerCity, searchOrder, maxHp, weaponGroup, equipBlock, wearEquip } from './game.js';
import { setupWar, occupyEmpty, autoBattle, defenseCandidates, joinDefense } from './warcore.js';
import { advancedBattle, officerPassive } from './battle-rules.js';
import { phantomWar } from './ahuinan.js';
import { FEMALE_SCENARIO_ID } from './visuals.js';
import { recruitThreshold, recruitLoyaltyWithRelation } from './relationships.js';

const KEEP = [[30, 60, 90], [20, 50, 80], [10, 40, 70]]; // cumulative cut-offs for keeping 4/3/2 (else 1)
const REAR = [2, 3, 3, 2, 3, 3, 2], FRONT = [4, 5, 4, 3, 4, 5, 4]; // A303 thresholds by faction
const aiProfile = (f) => data().factions[f]?.aiProfile ?? f;

export async function aiTurn(g, f, io) {
  const r = rng(g);
  let pts = books(g, f) * 10;
  const spend = (n) => (pts -= n) > 0;
  // A war on the player hands over the points left at that moment: a war suspended on the field (战场中断, src/core/suspend.js)
  // resumes the rest of this turn through aiDomestic with them, as the turn itself goes on below once the war is settled.
  const base = io; io = { ...base, war: (war) => base.war(war, { faction: f, pts }) };
  // A00F is entered twice per turn and runs the whole prelude each time: phase 0 then reads the weights (A043),
  // phase 1 draws from them (A19C), so the second pass does not change them.
  housekeeping(g, f, r, spend);
  const w = weights(g, f);
  if (pts > 0) housekeeping(g, f, r, spend);
  if (pts <= 0 || g.over) return;
  // A19C dispatches once. Every path enters BEC7, which stays in domestic work; a war gets there through
  // A8D7/CA19 once settled. D4AD masks to 0–15 even when the nominal weight sum exceeds 16.
  const x = r(Math.min(16, w[0] + w[1] + w[2]));
  if (x < w[0]) {
    await attackBranch(g, f, r, io, spend);
  } else if (x < w[0] + w[1]) {
    // B49C/B5FC: 10 of 50 → diplomacy, otherwise B4AC → BD7A; both then enter BEC7.
    if (r(50) < 10) {
      const y = r(90); await (y < 30 ? incite : y < 60 ? recruit : ally)(g, f, r, io);
    } else if (redeploy(g, f, spend) && pts > 0) reinforce(g, f, spend);
  }
  aiDomestic(g, f, pts, r);
}

// BEC7's domestic loop with `pts` points left: the end of every AI turn (aiTurn), and the rest of one whose war on the
// player was suspended and resumed (src/app.js). Its draws come from g.seed, so a resumed turn draws as the unbroken one.
export function aiDomestic(g, f, pts, r = rng(g)) {
  if (!citiesOf(g, f).length) return;
  const spend = (n) => (pts -= n) > 0;
  let wraps = 0;
  while (pts > 0 && !g.over) {
    // BEE6 increments before checking ownership. On the third wrap it exits before writing 0,
    // leaving the persistent cursor at 30; the following turn resumes from that actual value.
    let cur = g.aiCursor[f];
    do {
      cur++;
      if (cur >= g.cities.length) {
        if (++wraps === 3) { g.aiCursor[f] = cur; return; }
        cur = 0;
      }
    } while (g.cities[cur].faction !== f || isPass(cur));
    g.aiCursor[f] = cur;
    // Failed work returns to BEC7 without a debit. Successful actions charge their own five points.
    domestic(g, f, g.cities[cur], r, spend);
  }
}

function weights(g, f) {
  const D = data();
  // A0D3 situation bucket: over every city and road, count own/neutral neighbours; numerator when the city has <4 officers.
  let den = 0, num = 0;
  for (const c of g.cities) for (const n of roads(c.id)) {
    const nc = g.cities[n];
    if (nc.faction === f || nc.faction === NONE) { den++; if (c.officers.length < 4) { num++; break; } }
  }
  const ratio = den ? Math.floor((100 * num) / den) : 0, bucket = ratio < 31 ? 0 : ratio < 71 ? 1 : 2;
  const e = D.rules.ai_dispatch.find((d) => d.difficulty_index === g.level && d.faction_id === aiProfile(f) && d.ratio_bucket === bucket);
  return e ? e.weights : [6, 4, 6];
}

// Frontier = a road to a city owned by another faction (allies included); neutral cities do not count.
const isFront = (g, f, c) => roads(c.id).some((n) => ![f, NONE].includes(g.cities[n].faction));
const capitalOf = (g, f) => officerCity(g, g.factions[f].ruler);

// D4CB/D583 "connected" test: per-city rows of direct own neighbours (no self), ORed byte by byte in the
// original order; two cities pass only when one row holds both. Not graph reachability (two adjacent own
// cities with no third own city fail it).
function linker(g, f) {
  // 扩展地图允许据点串联，旧地图保留 ROM 的特殊连通算法和结果。
  if (data().expandedMap) return (a, b) => {
    if (g.cities[a]?.faction !== f || g.cities[b]?.faction !== f) return false;
    const seen = new Set([a]), queue = [a];
    for (let i = 0; i < queue.length; i++) for (const n of roads(queue[i])) {
      if (g.cities[n].faction === f && !seen.has(n)) { seen.add(n); queue.push(n); }
    }
    return seen.has(b);
  };
  const rows = g.cities.map(() => [0, 0, 0, 0]);
  for (const c of g.cities) if (c.faction === f) for (const n of roads(c.id)) if (g.cities[n].faction === f) rows[c.id][n >> 3] |= 1 << (n & 7);
  for (let d = 0; d < 29; d += 2) for (let v = Math.max(1, d - 1); v < 30; v++) for (let k = 0; k < 4; k++) if (rows[d][k] & rows[v][k]) rows[v][k] |= rows[d][k];
  const has = (row, x) => row[x >> 3] & (1 << (x & 7));
  return (a, b) => rows.some((row) => has(row, a) && has(row, b));
}

const moveTo = (g, f, from, to, id) => {
  from.officers = from.officers.filter((x) => x !== id); to.officers.push(id);
  if (id === g.factions[f].ruler) g.factions[f].city = to.id;
};

// A00F prelude: ruler retreat (C50E), talent search (C5D2/C6CC), medical (C79A), governor (C9A5), rice sale (CC12).
export function housekeeping(g, f, r, spend) {
  const D = data(), ruler = g.factions[f].ruler, aff = D.rules.search_preference[String(f)] || [];
  evade(g, f, spend);
  for (const c of citiesOf(g, f)) {
    if (r(100) < 10 && c.officers.length < 10) {
      // C5D2: each entry in turn whose year has come, up to the first whose has not, on its own affinity draw, so a
      // later one can come first (诸葛亮 194 before 徐庶 192 in 荆州). The head alone (F23, 2026-10-31) left an entry the
      // ruler does not favour holding back those he does, for years (devblog #98/#102, 2026-11-03). The player's 搜索 keeps
      // to the head (`$B964`, core/game.js), the original's own asymmetry.
      for (const id of searchOrder(g, c.id)) {
        const o = g.officers[id];
        if (D.officers[id].year > g.year) break;
        if (o.status !== UNAPPEARED) continue;
        if (r(100) < recruitThreshold(D, g, f, id, aff.includes(id) ? 90 : 10, null, false)) {
          o.loyalty = recruitLoyaltyWithRelation(D, g, f, id, o.loyalty); o.status = SERVING; c.officers.push(id); break;
        }
      }
    }
    if (r(100) < 10 && c.officers.length < 10) {
      // C6CC: every ronin spends its affinity draw (C66F 10/90) before the here-or-adjacent check.
      const near = [c.id, ...roads(c.id)];
      const o = g.officers.find((x) => x.status === RONIN && r(100) < recruitThreshold(D, g, f, x.id, aff.includes(x.id) ? 90 : 10, null, false) && near.includes(x.loc));
      if (o) { o.status = SERVING; o.loyalty = recruitLoyaltyWithRelation(D, g, f, o.id, recruitLoyalty(g.officers[ruler].virtue, o.loyalty)); c.officers.push(o.id); }
    }
  }
  medical(g, f, r, spend);
  // C98F/C9A5 over every own city, the ruler's included (C50E and medical append to the last slot): the first
  // loyalty-100 officer, else the highest loyalty+virtue (later slot on ties), swaps with slot 0.
  for (const c of citiesOf(g, f)) {
    if (!c.officers.length) continue;
    let gov = c.officers.findIndex((id) => g.officers[id].loyalty === 100);
    if (gov < 0) c.officers.forEach((id, i) => { if (gov < 0 || g.officers[id].loyalty + g.officers[id].virtue >= g.officers[c.officers[gov]].loyalty + g.officers[c.officers[gov]].virtue) gov = i; });
    [c.officers[0], c.officers[gov]] = [c.officers[gov], c.officers[0]];
  }
  for (const c of citiesOf(g, f)) {
    if (c.gold < 50 && D.cities[c.id].facilities.market) {
      const keep = Math.floor((troopsOf(g, c) * 3) / 25);
      if (c.rice < keep) continue;
      const sale = Math.min(c.rice - keep, 300);
      c.rice -= sale; c.gold = Math.min(9999, c.gold + Math.floor((sale * D.cities[c.id].rice_rate[0]) / 100));
      spend(2); // charged even when the sale is 0
    }
  }
}

// C50E: a ruler whose city borders an enemy moves to the most-garrisoned safe own city (later city on ties).
function evade(g, f, spend) {
  const ruler = g.factions[f].ruler, home = capitalOf(g, f);
  if (!home || home.faction !== f || !isFront(g, f, home) || home.officers.length < 2) return; // never strand an empty owned city
  const link = linker(g, f);
  let dest = null;
  for (const c of citiesOf(g, f)) if (c !== home && !isFront(g, f, c) && c.officers.length < 10 && link(home.id, c.id) && (dest == null || c.officers.length >= dest.officers.length)) dest = c;
  if (!dest) return;
  moveTo(g, f, home, dest, ruler);
  spend(2);
}

// C79A/C917/C80A/C885: in every city with 2+ officers take the lowest raw HP (first on ties) and treat when
// a 0–255 byte ≥ floor(HP×256/max). 20 gold first; heal on the spot with a hospital, otherwise walk random
// road slots (two hops) to an own hospital city under 10 officers, move there, heal, 5 points.
// No hospital found: the 20 gold is lost. HP never recovers on its own in the original.
function medical(g, f, r, spend) {
  const D = data();
  const shuffled = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = r(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const ok = (n) => g.cities[n].faction === f && D.cities[n].facilities.hospital && g.cities[n].officers.length < 10;
  for (const c of citiesOf(g, f)) {
    if (c.officers.length < 2) continue;
    let low = c.officers[0];
    for (const id of c.officers) if (g.officers[id].hp < g.officers[low].hp) low = id;
    const o = g.officers[low], max = maxHp(o), q = Math.floor((o.hp * 256) / max);
    if (q >= 256 || r(256) < q || c.gold < 20) continue;
    c.gold -= 20;
    if (D.cities[c.id].facilities.hospital) { o.hp = max; continue; }
    let dest = null;
    for (const n of shuffled(roads(c.id))) {
      if (ok(n)) { dest = n; break; }
      if (g.cities[n].faction === f) { dest = shuffled(roads(n)).find(ok) ?? null; if (dest != null) break; }
    }
    if (dest == null) continue;
    moveTo(g, f, c, g.cities[dest], low);
    o.hp = max;
    if (!spend(5)) return;
  }
}

// 电脑好战 (g.warlike, an option off by default and absent from older records; not in the ROM). Under the original
// rules (counted in this remake, tools/sim_warlike.mjs) about one attack dispatch in ten marches, and four in ten
// stop at A303 short of officers. With the option on, three
// numbers of the march on an enemy city change and nothing else, no draw added or dropped: the source needs
// defenders+2 officers instead of +3 (A208), each city A303 draws on gives down to one below its threshold (never its
// last officer; the empty-city march B10E gathers through the same A303), and one fewer stays behind (A6C9). Measured over 56 five-year campaigns a level with a player who only
// garrisons: wars on the player 1.5–1.9 → 2.8–3.2, campaigns never attacked about 50% → 21–29%, wars between AI
// factions ×1.4–1.7, the size of a marching army unchanged. The 阿会喃 march (core/ahuinan.js) keeps the original count.
const warlike = (g) => (g.warlike ? 1 : 0);

function outCount(g, n, r, eager = 0) {
  const x = r(100), t = KEEP[g.level];
  const keep = x < t[0] ? 4 : x < t[1] ? 3 : x < t[2] ? 2 : 1;
  return Math.max(1, n - Math.max(1, keep - eager));
}

// 扩展地图新局前五年，君主城和最后一城按全势力人数保留 1–3 将；小势力仍能派人扩张。
// 标记随记录保存，旧存档和其他版本保持既有决策。
function protectedOpeningCity(g, f, c) {
  return data().expandedMap && g.expandedOpeningGuard === true && g.year < 194 && !isPass(c.id)
    && (c === capitalOf(g, f) || citiesOf(g, f).length === 1);
}
function openingGarrison(g, f, c) {
  if (!protectedOpeningCity(g, f, c)) return 1;
  const officers = holdingsOf(g, f).reduce((n, holding) => n + holding.officers.length, 0);
  return Math.max(1, Math.min(3, Math.ceil(officers / 2)));
}

// A303: bring officers into `dst` until it holds `need`. Pass 1 rear non-capital cities, pass 2 capital or
// frontier cities; each must pass D583 and holds ≥ its faction threshold before giving one. A3D6 mode 0
// takes the highest war, mode 1 the highest loyalty skipping the governor slot; ruler never, last slot on
// ties; 2 points each. Returns true on success, false (moves kept) to fall back to domestic, null when the
// budget ran out.
function gather(g, f, dst, need, mode, spend) {
  const ruler = g.factions[f].ruler, home = capitalOf(g, f), link = linker(g, f);
  for (const pass of [0, 1]) {
    // 小势力通过关隘时允许从连通城市调兵，但每个来源至少留一人守城。
    const th = data().expandedMap && isPass(dst.id) ? 2 : Math.max(2, (pass ? FRONT : REAR)[aiProfile(f)] - warlike(g));
    for (const c of g.cities) {
      if (c === dst || c.faction !== f || (c === home || isFront(g, f, c)) !== (pass === 1) || !link(dst.id, c.id)) continue;
      while (c.officers.length >= th && c.officers.length > openingGarrison(g, f, c)) {
        let pick = null, best = 0;
        c.officers.forEach((id, i) => {
          if (id === ruler || (mode && i === 0)) return;
          const s = mode ? g.officers[id].loyalty : g.officers[id].war;
          if (s >= best) { best = s; pick = id; }
        });
        if (pick == null) break;
        moveTo(g, f, c, dst, pick);
        if (!spend(2)) return null;
        if (dst.officers.length >= need) return true;
      }
    }
  }
  return false;
}

// A55C/A60C: 100 at a time from the richest other own city above 100 (first on ties, no road check), 2 points.
function requisition(g, f, dst, k, spend) {
  let donor = null;
  const link = data().expandedMap ? linker(g, f) : null;
  for (const c of citiesOf(g, f)) if (c !== dst && (!link || link(dst.id, c.id)) && c[k] > 100 && (donor == null || c[k] > donor[k])) donor = c;
  if (!donor) return false;
  const amt = Math.min(100, donor[k] - 100);
  donor[k] -= amt; dst[k] = Math.min(9999, dst[k] + amt);
  return spend(2) ? true : null;
}
const cover = (g, f, c, k, need, spend) => { while (c[k] < need) { const t = requisition(g, f, c, k, spend); if (t !== true) return t; } return true; };

// 旧规则保留 A481 的额外征兵百人；修正规则按实际缺口向上取整，现有后备兵足够时不花钱。
function fillCost(c, o) {
  const need = 1000 - o.soldiers;
  if (data().fixedAiRecruitment) return Math.ceil(Math.max(0, need - c.reserve) / 100) * 20;
  return c.reserve > need ? 0 : (Math.floor((need - c.reserve) / 100) + 1) * 20;
}
function fill(c, o, paid) {
  const need = 1000 - o.soldiers, cost = fillCost(c, o);
  if (paid) c.gold -= cost;
  c.reserve = Math.min(9999, c.reserve + (cost / 20) * 100 - need); o.soldiers = 1000;
}

// 关隘不能自行征兵：驻军只能消耗关内已有后备兵，或由连通的己方城市提供后备兵和征兵费用。
function passDonors(g, f, gate) {
  const linked = linker(g, f);
  return citiesOf(g, f).filter((c) => linked(gate.id, c.id));
}
function passSupply(g, f, gate) {
  return gate.reserve + passDonors(g, f, gate).reduce((n, c) => n + c.reserve + Math.floor(c.gold / 20) * 100, 0);
}
function refillAtPass(g, f, gate, officer) {
  const before = officer.soldiers;
  const take = (c) => {
    const n = Math.min(1000 - officer.soldiers, c.reserve);
    c.reserve -= n; officer.soldiers += n;
  };
  take(gate);
  const donors = passDonors(g, f, gate);
  for (const c of donors) { if (officer.soldiers >= 1000) break; take(c); }
  for (const c of donors) {
    if (officer.soldiers >= 1000) break;
    const need = 1000 - officer.soldiers;
    const hundreds = Math.min(Math.ceil(need / 100), Math.floor(c.gold / 20));
    const recruited = hundreds * 100, moved = Math.min(need, recruited);
    c.gold -= hundreds * 20; officer.soldiers += moved; c.reserve += recruited - moved;
  }
  return officer.soldiers - before;
}

async function attackBranch(g, f, r, io, spend) {
  if (r(100) < (g.level === 2 ? 30 : 20)) return vacant(g, f, r, spend);
  const open = g.level === 2 || g.year >= 190 || (g.level === 1 && g.month >= 6);
  if (!open) return false;
  // A240: target with the fewest officers among non-allied enemy neighbours.
  let target = null, source = null, bestScore = Infinity;
  for (const c of holdingsOf(g, f)) for (const n of roads(c.id)) {
    const t = g.cities[n];
    if (t.faction === NONE || t.faction === f || g.factions[f].alliance[t.faction] > 0) continue;
    // 刚遭袭扰的势力本月不再成为电脑战争目标，避免连续被迫作战。
    if (g.cityRaids === true && g.raidHistory?.factions?.[t.faction] === g.year * 12 + g.month) continue;
    if (g.campaignRules === true) {
      // 守将数之外兼顾实际兵力、出发城粮草及关隘价值；不额外消耗随机数。
      const score = t.officers.length * 20 + Math.floor(troopsOf(g, t) / 100)
        - Math.min(30, Math.floor(troopsOf(g, c) / 200)) - Math.min(6, c.officers.length) * 5
        + (c.rice < 240 ? 20 : 0) + (c.gold < 100 ? 10 : 0) - (isPass(t.id) ? 4 : 0)
        + (advancedBattle(g) ? frontierScore(g, c, t) : 0);
      if (score < bestScore || (score === bestScore && c.officers.length >= (source == null ? 0 : g.cities[source].officers.length))) {
        target = n; source = c.id; bestScore = score;
      }
      continue;
    }
    if (target == null || t.officers.length < g.cities[target].officers.length || (t.officers.length === g.cities[target].officers.length && n !== target)) { target = n; source = c.id; }
    else if (n === target && c.officers.length >= g.cities[source].officers.length) source = c.id;
  }
  if (target == null) {
    // A208 never checks for FF; the remake gives up here unless the record keeps the 阿会喃 bug (core/ahuinan.js).
    if (!g.bugs?.ahuinan) return false;
    const res = phantomWar(g, f, r, { cover, outCount, spend });
    if (!res) return res === null; // as the other cover() exits: out of budget → true, no supplies → domestic
    await io.event({ type: 'phantom', ...res });
    return 'war';
  }
  const src = g.cities[source];
  // A208: the source must hold min(10, defenders+3) officers, else A303 gathers them (failure → domestic).
  const need = Math.min(10, g.cities[target].officers.length + (data().expandedMap && isPass(source) ? 2 : 3) - warlike(g));
  if (src.officers.length < need) { const ok = gather(g, f, src, need, 0, spend); if (ok !== true) return ok === null; }
  // A45C/A481: every officer in the source to 1000, 2 points each. Short of gold, A55C requisitions it; when
  // no city can pay, the whole attack is dropped for domestic work (no one marches under strength).
  for (const id of [...src.officers]) {
    const o = g.officers[id];
    if (o.soldiers >= 1000) continue;
    if (data().expandedMap && isPass(src.id)) {
      const moved = refillAtPass(g, f, src, o);
      if (moved && !spend(2)) return true;
      if (o.soldiers < 1000) return false;
      continue;
    }
    const t = cover(g, f, src, 'gold', fillCost(src, o), spend);
    if (t !== true) return t === null;
    fill(src, o, true);
    if (!spend(2)) return true;
  }
  // A6C9: marching count and supplies (rice 120 each, gold 100 each ± draw100), requisitioned or → domestic.
  const dispatched = outCount(g, src.officers.length, r, warlike(g));
  const n = protectedOpeningCity(g, f, src) ? Math.min(dispatched, src.officers.length - openingGarrison(g, f, src)) : dispatched;
  if (n < 1) return false;
  const rice = n * 120, gold = Math.max(0, n * 100 + (r(256) >= 128 ? 1 : -1) * r(100));
  for (const [k, amt] of [['gold', gold], ['rice', rice]]) { const t = cover(g, f, src, k, amt, spend); if (t !== true) return t === null; }
  // A79C: officers by floor(war/2)+loyalty, loyalty 100 excluded, last slot on ties.
  const pool = src.officers.filter((id) => g.officers[id].loyalty !== 100)
    .map((id, i) => ({ id, k: Math.floor(g.officers[id].war / 2) + g.officers[id].loyalty, i })).sort((a, b) => b.k - a.k || b.i - a.i);
  const ids = pool.slice(0, n).map((p) => p.id);
  if (!ids.length || ids.length >= src.officers.length) return false;
  const war = setupWar(g, { from: source, to: target, ids, commander: ids[0], gold, rice });
  const relief = defenseCandidates(g, f, war.defender, war.city, war.def.ids.length);
  const player = relief.find(c => c.faction === g.player);
  const accepted = player && await io.offerSupport?.(war, player) && joinDefense(g, war, player);
  if (!accepted) {
    const fallback = defenseCandidates(g, f, war.defender, war.city, war.def.ids.length).find(c => c.faction !== g.player);
    joinDefense(g, war, fallback);
  }
  if (!g.factions[war.defender].ai || war.support?.faction === g.player) { await io.war(war); return 'war'; }
  const res = autoBattle(g, war);
  await io.event({ type: 'autobattle', war, res });
  await io.afterWar(war);
  return 'war'; // one expedition per turn
}

function frontierScore(g, source, target) {
  const support = defenseCandidates(g, source.faction, target.faction, target.id)[0];
  const relief = support?.ids.reduce((n, id) => n + g.officers[id].soldiers, 0) ?? 0;
  const pressure = roads(source.id).filter(id => {
    const c = g.cities[id];
    return c.faction !== target.faction && c.faction !== source.faction && c.faction !== NONE &&
      !g.factions[source.faction].alliance[c.faction] && troopsOf(g, c) > troopsOf(g, source);
  }).length;
  const leader = citiesOf(g, target.faction).length >= citiesOf(g, source.faction).length + 3;
  return Math.min(32, Math.floor(relief / 100)) + pressure * 18 - (leader ? 12 : 0);
}

function vacant(g, f, r, spend) {
  // 关隘不计城数；有两名武将时允许留一人守城、派一人先占领无主关隘。
  if (data().expandedMap) for (const c of holdingsOf(g, f)) {
    if (c.officers.length <= openingGarrison(g, f, c)) continue;
    const target = roads(c.id).find((n) => isPass(n) && g.cities[n].faction === NONE && !g.cities[n].officers.length);
    const id = c.officers.find((o) => o !== g.factions[f].ruler);
    if (target == null || id == null) continue;
    const gold = Math.min(50, c.gold), rice = Math.min(150, c.rice);
    occupyEmpty(g, { from: c.id, to: target, ids: [id], gold, rice });
    spend(4); return true;
  }
  // 有人驻守的关隘可以继续向前占领空城，不必等待城市的平均守将达到四人。
  if (data().expandedMap) for (const c of holdingsOf(g, f)) {
    if (!isPass(c.id)) continue;
    const target = roads(c.id).find((n) => !isPass(n) && g.cities[n].faction === NONE && !g.cities[n].officers.length);
    if (target == null) continue;
    if (c.officers.length < 2) {
      const result = gather(g, f, c, 2, 0, spend);
      if (result === null) return true;
      if (!result) continue;
    }
    const id = c.officers.find((o) => o !== g.factions[f].ruler);
    if (id == null) continue;
    occupyEmpty(g, { from: c.id, to: target, ids: [id], gold: Math.min(50, c.gold), rice: Math.min(100, c.rice) });
    spend(4); return true;
  }
  // B10E: average officers over own frontier cities (else all); <2 → abandon a city, 2–3 → domestic,
  // 4+ → expand with that average as the source's required count.
  const mine = citiesOf(g, f), front = mine.filter((c) => isFront(g, f, c));
  const base = front.length ? front : mine, avg = Math.floor(base.reduce((a, c) => a + c.officers.length, 0) / Math.max(1, base.length));
  if (avg < 2) return abandon(g, f, spend);
  if (avg < 4) return false;
  // B180: last different empty neutral target wins; same target keeps the source with more officers (later on ties).
  let target = null, source = null;
  for (const c of holdingsOf(g, f)) for (const n of roads(c.id)) {
    if (g.cities[n].faction !== NONE || g.cities[n].officers.length) continue;
    if (n !== target) { target = n; source = c.id; } else if (c.officers.length >= g.cities[source].officers.length) source = c.id;
  }
  if (target == null) return false;
  const src = g.cities[source], need = Math.min(avg, 10);
  if (src.officers.length < need) { const ok = gather(g, f, src, need, 1, spend); if (ok !== true) return ok === null; }
  // B1FD: supplies for `need` officers; both needs subtract the target's gold (original quirk); short → A55C/A60C or domestic.
  const tg = g.cities[target].gold;
  const gold = Math.max(0, need * 100 + (r(256) >= 128 ? 1 : -1) * r(100) - tg), rice = Math.max(0, need * 120 - tg);
  for (const [k, amt] of [['gold', gold], ['rice', rice]]) { const t = cover(g, f, src, k, amt, spend); if (t !== true) return t === null; }
  // B287: need-2 officers, highest loyalty after the governor slot, later slot on ties.
  const ids = [], left = src.officers.slice(1);
  const limit = Math.min(need - 2, src.officers.length - openingGarrison(g, f, src));
  for (let k = 0; k < limit && left.length; k++) {
    let best = 0; left.forEach((id, i) => { if (g.officers[id].loyalty >= g.officers[left[best]].loyalty) best = i; });
    ids.push(left.splice(best, 1)[0]);
  }
  if (!ids.length) return false;
  occupyEmpty(g, { from: source, to: target, ids, gold, rice });
  return true;
}

// B357: of own cities with exactly one own neighbour, the lowest land+industry (first on ties) hands every
// officer, gold and rice to that neighbour and becomes neutral; 4+2×officers points. The original writes past
// a full destination roster; here the move is skipped instead.
function abandon(g, f, spend) {
  // 关隘不算城市，不能把最后一座城市迁空到关隘而让势力在下一次检查时灭亡。
  if (data().expandedMap && citiesOf(g, f).length <= 1) return false;
  let from = null, to = null;
  for (const c of citiesOf(g, f)) {
    if (protectedOpeningCity(g, f, c)) continue;
    const own = roads(c.id).filter((n) => g.cities[n].faction === f);
    if (own.length === 1 && (from == null || c.land + c.industry < from.land + from.industry)) { from = c; to = g.cities[own[0]]; }
  }
  if (!from || from.officers.length + to.officers.length > 10) return false;
  const ids = [...from.officers];
  for (const id of ids) moveTo(g, f, from, to, id);
  to.gold = Math.min(9999, to.gold + from.gold); to.rice = Math.min(9999, to.rice + from.rice);
  from.gold = 0; from.rice = 0; from.faction = NONE;
  spend(4 + 2 * ids.length);
  return true;
}

// B4AC: pass 1 rear non-capital cities with 3+, pass 2 frontier non-capital cities with ≥ avg+2 officers send
// their highest-war officer (later slot on ties) to the capital or an own frontier city that passes D583 and
// has room, fewest officers first; 2 points each. False when the budget ran out (BD7A is not reached).
function redeploy(g, f, spend) {
  const mine = citiesOf(g, f);
  if (!mine.length) return false;
  const home = capitalOf(g, f), link = linker(g, f);
  const avg = Math.floor(mine.reduce((a, c) => a + c.officers.length, 0) / mine.length);
  for (const pass of [0, 1]) {
    const th = pass ? avg + 2 : 3;
    for (const src of g.cities) {
      if (src === home || src.faction !== f || isFront(g, f, src) !== (pass === 1)) continue;
      while (src.officers.length >= th && src.officers.length > openingGarrison(g, f, src)) {
        let dst = null;
        for (const c of g.cities) if (c !== src && (c === home || (c.faction === f && isFront(g, f, c))) && c.officers.length < 10 && link(src.id, c.id) && (dst == null || c.officers.length < dst.officers.length)) dst = c;
        if (!dst) break;
        let pick = src.officers[0];
        for (const id of src.officers) if (g.officers[id].war >= g.officers[pick].war) pick = id;
        moveTo(g, f, src, dst, pick);
        if (!spend(2)) return false;
      }
    }
  }
  return true;
}

// BD7A: one officer below 1000 across all own cities (governor slot scores 100, others war; later wins ties)
// uses the legacy low-byte gate and ignored failed payment unless this scenario opts into corrected recruitment.
function reinforce(g, f, spend) {
  const fixed = data().fixedAiRecruitment;
  const smart = fixed && g.smartAiReinforcement === true, home = smart ? capitalOf(g, f) : null;
  let best = null, top = 0;
  for (const c of citiesOf(g, f)) {
    if (fixed ? c.reserve <= 0 && c.gold < 20 : (c.gold & 255) * 256 < 300) continue;
    c.officers.forEach((id, i) => {
      if (g.officers[id].soldiers >= 1000) return;
      const priority = (i === 0 ? 100 : g.officers[id].war) + (smart && isFront(g, f, c) ? 45 : 0) + (smart && c === home ? 30 : 0);
      // 先考虑本次实际可补人数，再兼顾前线、君主城和太守；旧记录仍用原有排序。
      const available = smart ? Math.min(1000 - g.officers[id].soldiers, c.reserve + 100 * Math.max(0, Math.floor(c.gold / 20))) : 1;
      const s = smart ? available * (100 + priority) : priority;
      if (s >= top) { top = s; best = { c, o: g.officers[id] }; }
    });
  }
  if (data().expandedMap && fixed) for (const c of holdingsOf(g, f)) {
    if (!isPass(c.id)) continue;
    const supply = passSupply(g, f, c);
    if (supply <= 0) continue;
    c.officers.forEach((id, i) => {
      const o = g.officers[id]; if (o.soldiers >= 1000) return;
      const priority = (i === 0 ? 100 : o.war) + (smart && isFront(g, f, c) ? 45 : 0) + (smart && c === home ? 30 : 0);
      const available = smart ? Math.min(1000 - o.soldiers, supply) : 1;
      const score = smart ? available * (100 + priority) : priority;
      if (score >= top) { top = score; best = { c, o, pass: true }; }
    });
  }
  if (!best) return;
  if (best.pass) { refillAtPass(g, f, best.c, best.o); spend(2); return; }
  if (fixed) {
    const { c, o } = best, need = 1000 - o.soldiers;
    // 先使用后备兵，再按每 20 金购买 100 人；资金不足时只补充实际可负担的人数。
    const hundreds = Math.min(Math.ceil(Math.max(0, need - c.reserve) / 100), Math.max(0, Math.floor(c.gold / 20)));
    const available = c.reserve + 100 * hundreds, moved = Math.min(need, available);
    c.gold -= 20 * hundreds; c.reserve = available - moved; o.soldiers += moved;
  } else fill(best.c, best.o, best.c.gold >= fillCost(best.c, best.o));
  spend(2);
}

// One BEC7 action in the selected city: faction threshold out of 80, then the sub-draw.
function domestic(g, f, c, r, spend) {
  const D = data(), K = D.rules.ai_domestic.development_multiplier_tenths[g.level];
  const passive = officerPassive(D, g, c.officers[0]);
  if (r(80) < D.rules.ai_domestic.faction_development_threshold_out_of_80[aiProfile(f)]) {
    const x = r(100);
    if (x < 70) {
      const cost = 10 + r(14);
      if (c.gold < cost) return false;
      const gain = Math.floor((cost * K) / 10);
      c.gold -= cost;
      if (x < 40) {
        const field = g.month >= 3 && g.month <= 7 ? 'land' : 'industry';
        c.gov = Math.min(100, c.gov + (gain >= 31 ? 2 : 1));
        c[field] = Math.min(999, c[field] + gain + (passive?.development ?? 0));
      } else { c.gov = Math.min(100, c.gov + 1); c.pop = Math.min(9999, c.pop + Math.floor(gain / 2) + (passive?.development ?? 0)); }
    } else if (x < 90) {
      const cost = 10 + r(10);
      if (c.gold < cost) return false;
      c.gold -= cost;
      c.disaster = Math.min(99, c.disaster + Math.floor((cost * D.rules.ai_domestic.disaster_multiplier_tenths[g.level]) / 10) + (passive?.prevention ?? 0));
    } else {
      const gc = 30 + r(30); if (c.gold < gc) return false;
      const rc = 30 + r(30);
      if (advancedBattle(g) && c.rice < rc) return false;
      c.gold -= gc; // 旧战役保留扣金后才检查米的顺序。
      if (c.rice < rc) return false;
      c.rice -= rc;
      c.gov = Math.min(99, c.gov + Math.floor((gc + rc) / [25, 20, 15][g.level]) + (passive?.charity ?? 0));
    }
    return spend(5) || true;
  }
  const base = D.rules.ai_domestic.study_reward_base_gain[g.level];
  if (r(100) < 30) {
    const id = [...c.officers].sort((a, b) => g.officers[a].loyalty - g.officers[b].loyalty).find((x) => g.officers[x].loyalty < 70);
    if (id == null) return equip(g, c, r, spend);
    const cost = 20 + r(10); if (c.gold < cost) return false;
    c.gold -= cost; g.officers[id].loyalty = Math.min(100, g.officers[id].loyalty + base + r(5));
  } else {
    // 武将不能读书 (g.noStudy, game.js study): the draw finds no one to study, the same as no officer at 50–79.
    const id = g.noStudy ? null : [...c.officers].sort((a, b) => g.officers[a].int - g.officers[b].int).find((x) => g.officers[x].int >= 50 && g.officers[x].int < 80);
    if (id == null) return false;
    const cost = 20 + r(10); if (c.gold < cost) return false;
    c.gold -= cost; g.officers[id].int += base + r(5);
  }
  return spend(5) || true;
}

// 扩展装备按实际能力、价格和购买条件比较；首次换弓、扇后不再自动跨类，避免反复购买。
function equipExtended(g, c, stock, spend) {
  const D = data();
  const price = (id) => id >= 24 && id < 32 ? 240 : D.equipment[id].price;
  // 重量影响单挑先攻；以一点攻防抵消两点重量，再按攻击、防御和价格打破平局。
  const quality = (gear, stat) => 2 * gear[stat] - gear.weight;
  const better = (a, b, stat) => quality(D.equipment[b], stat) - quality(D.equipment[a], stat)
    || D.equipment[b][stat] - D.equipment[a][stat]
    || D.equipment[a].weight - D.equipment[b].weight || price(a) - price(b) || a - b;
  for (let bought = false; ;) {
    let best = null, item = null;
    for (const id of c.officers) {
      const o = g.officers[id], group = weaponGroup(o.weapon), current = D.equipment[o.weapon];
      const available = stock.filter((e) => D.equipment[e] && price(e) <= c.gold && !equipBlock(g, id, e));
      const weapons = available.filter((e) => {
        const gear = D.equipment[e], next = weaponGroup(e);
        if (gear.kind !== 'weapon') return false;
        if (next === group) return gear.atk > current.atk && quality(gear, 'atk') > quality(current, 'atk');
        if (group < 0 || group > 2 || e < 32 || gear.atk < current.atk || quality(gear, 'atk') < quality(current, 'atk')) return false;
        return (next === 4 && o.war >= 70) || (next === 3 && o.int >= 75);
      }).sort((a, b) => better(a, b, 'atk'));
      const currentArmor = D.equipment[24 + o.armor];
      const armor = available.filter((e) => D.equipment[e].kind === 'armor' && D.equipment[e].dfn > currentArmor.dfn && quality(D.equipment[e], 'dfn') > quality(currentArmor, 'dfn'))
        .sort((a, b) => better(a, b, 'dfn'));
      const candidate = weapons[0] ?? armor[0];
      if (candidate != null && (best == null || o.war >= g.officers[best].war)) { best = id; item = candidate; }
    }
    if (best == null) return bought;
    c.gold -= price(item); wearEquip(g, best, item); bought = true;
    if (!spend(5)) return true;
  }
}

// C337 equipment: highest-war officer with an upgrade in the AI stock; armour always charged 240. Repeats
// (the same officer may upgrade again) until no candidate, short of gold, or out of budget.
export function equip(g, c, r, spend) {
  const D = data();
  if (!D.cities[c.id].facilities.weapons) return false;
  const stock = D.cities[c.id].ai_shop; // its own table (0x164FE), not the player's shop with 关王刀 and 蛇矛
  if (currentScenario() !== FEMALE_SCENARIO_ID && stock.some((id) => id >= 32)) return equipExtended(g, c, stock, spend);
  for (let bought = false; ;) {
    let best = null, item = null, fallback = null, fallbackItem = null;
    for (const id of c.officers) {
      const o = g.officers[id], grp = weaponGroup(o.weapon), currentAtk = D.equipment[o.weapon]?.atk ?? 0;
      const currentDef = D.equipment[24 + o.armor]?.dfn ?? 0;
      const customWeapon = stock.find((e) => e >= 32 && D.equipment[e]?.kind === 'weapon' && weaponGroup(e) === grp && D.equipment[e].atk > currentAtk && D.equipment[e].price <= c.gold && !equipBlock(g, id, e));
      const customArmor = stock.find((e) => e >= 32 && D.equipment[e]?.kind === 'armor' && D.equipment[e].dfn > currentDef && D.equipment[e].price <= c.gold && !equipBlock(g, id, e));
      const alternative = customWeapon ?? customArmor;
      if (alternative != null && (fallback == null || o.war >= g.officers[fallback].war)) { fallback = id; fallbackItem = alternative; }
      let it = stock.find((e) => e < 24 && Math.floor(e / 8) === grp && (o.weapon < 24 ? e > o.weapon : D.equipment[e].atk > currentAtk));
      if ((it == null || D.equipment[it].price > c.gold) && customWeapon != null) it = customWeapon;
      if (it == null) it = stock.find((e) => e >= 24 && e < 32 && (o.armor < 8 ? e - 24 > o.armor : D.equipment[e].dfn > currentDef));
      const price = it == null ? 0 : it >= 24 && it < 32 ? 240 : D.equipment[it].price;
      if ((it == null || price > c.gold) && customArmor != null) it = customArmor;
      if (it != null && (best == null || o.war >= g.officers[best].war)) { best = id; item = it; }
    }
    if (best == null) return bought;
    let price = D.equipment[item].kind === 'weapon' || item >= 32 ? D.equipment[item].price : 240;
    if (c.gold < price && fallback != null) { best = fallback; item = fallbackItem; price = D.equipment[item].price; }
    if (c.gold < price) return bought;
    c.gold -= price;
    if (D.equipment[item].kind === 'weapon') g.officers[best].weapon = item; else g.officers[best].armor = item - 24;
    bought = true;
    if (!spend(5)) return true;
  }
}

// ---------- AI diplomacy (6.5 第七批: 10:BBB2 / B98B / B619) ----------
const maxBy = (arr, f) => arr.reduce((best, x) => (best == null || f(x) >= f(best) ? x : best), null);
async function incite(g, f, r, io) {
  const actor = maxBy(holdingsOf(g, f).flatMap((c) => c.officers), (id) => g.officers[id].int);
  const city = maxBy(g.cities.filter((c) => c.faction !== f && c.faction !== NONE && !g.factions[c.faction].ai && c.officers.length >= 6), (c) => c.officers.length);
  if (actor == null || !city) return;
  const cands = city.officers.filter((id) => g.officers[id].loyalty >= 50 && g.officers[id].loyalty <= 89 && !isRuler(g, id));
  if (!cands.length) return;
  const id = cands.length === 1 ? cands[0] : cands[r(Math.min(16, cands.length))];
  const th = Math.max(0, g.officers[actor].int - g.officers[id].int) + [16, 32, 48][g.level];
  if (r(100) >= th) return;
  const loss = Math.floor(g.officers[actor].int / 20) + r(7) + 1;
  g.officers[id].loyalty = Math.max(0, g.officers[id].loyalty - loss);
  await io.event({ type: 'aiIncite', faction: f, actor, id, loss });
}
async function recruit(g, f, r, io) {
  const dest = citiesOf(g, f).filter((c) => c.officers.length < 10).sort((a, b) => a.officers.length - b.officers.length)[0];
  if (!dest) return;
  let target = null;
  for (const c of g.cities) if (c.faction !== f && c.faction !== NONE) for (const id of c.officers) if (!isRuler(g, id) && (target == null || g.officers[id].loyalty < g.officers[target].loyalty)) target = id;
  if (target == null || g.officers[target].loyalty >= 70) return;
  const t = g.officers[target], lb = t.loyalty <= 30 ? 0 : t.loyalty <= 50 ? 1 : 2;
  const own = Math.max(...holdingsOf(g, f).flatMap((c) => c.officers).map((id) => g.officers[id].level - 1)), diff = own - (t.level - 1);
  const raw = [[40, 15, 0], [50, 20, 0], [60, 30, 10]][g.level][lb] + Math.floor(t.virtue / 20) + (diff >= 0 ? diff : 2 * diff);
  // 原版按无符号字节回绕；新规则避免负概率变成必然成功，记录缺少标记时不改变旧行为。
  const th = g.safeAiLure === true ? Math.max(0, Math.min(100, raw)) : raw & 255;
  const from = officerCity(g, target), lostF = from.faction;
  if (r(100) >= recruitThreshold(data(), g, f, target, th, lostF, false)) return;
  from.officers = from.officers.filter((x) => x !== target); if (!from.officers.length) from.faction = NONE;
  dest.officers.push(target); t.loyalty = recruitLoyaltyWithRelation(data(), g, f, target, recruitLoyalty(g.officers[g.factions[f].ruler].virtue, t.loyalty));
  await io.event({ type: 'aiLure', faction: f, id: target, from: lostF, city: dest.id });
}
async function ally(g, f, r, io) {
  const fac = g.factions[f], live = g.factions.filter((x) => x.ruler != null).length;
  if (live < 3 || fac.alliance.some((t) => t > 0)) return;
  const mine = citiesOf(g, f), holdings = holdingsOf(g, f), adj = new Set();
  if (!holdings.some((c) => c.officers.some((id) => id !== fac.ruler))) return; // B619 needs a non-ruler envoy
  for (const c of holdings) for (const n of roads(c.id)) { const o = g.cities[n].faction; if (o !== f && o !== NONE) adj.add(o); }
  if (adj.size < 2) return;
  const strength = (o) => citiesOf(g, o).length;
  const threat = maxBy([...adj], strength);
  let target = threat;
  if (advancedBattle(g) && strength(threat) > mine.length + 1) {
    // 邻国既能从前线驰援，又受同一个大势力威胁时，共守边境更有价值。
    const candidates = [...adj].filter(o => o !== threat && strength(o) <= strength(threat) && !g.factions[o].alliance[threat]);
    const border = (o) => holdingsOf(g, o).reduce((score, c) => score + roads(c.id).filter(id => g.cities[id].faction === threat).length, 0);
    const partner = maxBy(candidates, o => border(o) * 3 + Math.min(strength(o), 3));
    if (partner != null && border(partner) > 0) target = partner;
  }
  const tc = citiesOf(g, target).length;
  if (target === threat && tc <= mine.length + 2) return;
  const gold = r(100) < 50, amount = (3 * tc + 7) * (gold ? 4 : 6), kind = gold ? 'gold' : 'rice';
  const home = officerCity(g, fac.ruler);
  if (!home || home[kind] < amount) return;
  // 原版保留低字节截断；新版按完整报价支付，避免超过 255 后出现零价同盟。
  const paid = g.campaignRules === true ? amount : amount & 255;
  const duration = advancedBattle(g) ? 14 : 10;
  const accepted = g.factions[target].ai ? true : await io.allianceOffer(f, kind, paid, duration);
  if (!accepted) return;
  home[kind] -= paid; const dst = officerCity(g, g.factions[target].ruler); if (dst) dst[kind] = Math.min(9999, dst[kind] + paid);
  fac.alliance[target] = g.factions[target].alliance[f] = duration;
  await io.event({ type: 'aiAlliance', faction: f, target });
}
