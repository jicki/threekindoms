// 白兵 tactical battle on the original 16×10 grids (6.4, S01–S21). Ported: per-terrain grid maps and
// army passability (山军 class 2, 水军 class 3/4, arrows over 4/5), four formations plus the two castle
// tables, squad split and type cut-points, F factor, troop/HP ladder B, cavalry and general damage
// reduction, archers 60% melee / 70% ranged (range 2..4, 强弩 2..6, all four rays: the left-ray quirk is fixed), the round
// cadence (infantry→archers→cavalry→generals, attacker slots then defender, cavalry/generals twice),
// axis-greedy stepping with one alternate axis, four commands (前进/后退/待机/包围), six tactics with
// their costs and effects, AI command schedule and tactic priorities, capture and AI withdrawal.
// The engine is stepped by the UI (one event per call) or run to the end for AI-only battles.
import { data, addExp, isRuler, spared, sparedHp, maxHp, weaponGroup, boundRulerWeapon } from './game.js';
import { Duel } from './skirmish.js';
import { SPECIAL_TROOPS, officerSquads, troopDamage, troopGroup, counterBonus } from './troop-specialties.js';
import { advancedBattle, aiBattleBonus, officerPassive } from './battle-rules.js';
import { skirmishMap } from './skirmish-maps.js';

export const GW = 16, GH = 10, KINDS = ['inf', 'arc', 'cav', 'gen'];
export const COMMANDS = { advance: '前进', retreat: '后退', wait: '待机', surround: '包围' };
export const TACTICS = [
  { id: 'bind', name: '咒缚', cost: 3 }, { id: 'taunt', name: '挑发', cost: 5 }, { id: 'xbow', name: '强弩', cost: 7 },
  { id: 'morale', name: '士气向上', cost: 8 }, { id: 'fire', name: '火矢', cost: 10 }, { id: 'blast', name: '爆炎', cost: 12 },
];
export const FORMATIONS = ['长蛇', '雁行', '锥行', '鱼鳞'];
const B = (h) => (h < 15 ? 20 : h < 35 ? 40 : h < 60 ? 50 : h < 80 ? 70 : h < 90 ? 85 : h < 100 ? 95 : 100);
const C = (w) => (w < 65 ? 45 : w < 80 ? 50 : w < 87 ? 55 : w < 92 ? 60 : w < 97 ? 65 : 70);
const PASS = { 平: [0], 山: [0, 2], 水: [0, 3, 4] }, ARROW = [0, 4, 5];
const CASTLE = 5;
const FRONT_RANK = { shield: 0, spear: 0, inf: 1, hammer: 1, cav: 2, arc: 3 };
const byFrontRank = (a, b) => FRONT_RANK[troopGroup(a)] - FRONT_RANK[troopGroup(b)];

// 单挑斩杀的宝物 (bank24 $C30E→$C35D, research/death-succession-events-evidence.md §5): only a death in a 单挑.
// The four named officers match by id, ruler or not, ahead of the ruler rule: 曹操 倚天剑 30%, 董卓 七星剑 if the
// winner is Lv1–2, 马腾 青釭剑, 刘备 龙鳞之铠. Any other ruler: 龙牙刀 50%, once a game ($6FE1 bit0, g.dragonFang).
// The treasure replaces what the winner wore, better or not. Returns the equipment id, or null.
const DUEL_LOOT = { 131: { eq: 6, p: 30 }, 173: { eq: 7, lv: 2 }, 182: { eq: 5 }, 222: { eq: 31 } };
export function duelLoot(g, winner, dead, r) {
  const rule = DUEL_LOOT[dead], o = g.officers[winner];
  // 已绑定的专属武器不能被单挑所得的普通武器覆盖；护甲战利品仍可获得。
  if (boundRulerWeapon(g, winner) && (!rule || rule.eq < 24)) return null;
  let eq = null;
  if (rule) { if ((rule.p == null || r(100) < rule.p) && (rule.lv == null || o.level <= rule.lv)) eq = rule.eq; }
  else if (isRuler(g, dead) && !g.dragonFang && r(100) < 50) { g.dragonFang = true; eq = 14; }
  if (eq == null) return null;
  if (eq < 24) o.weapon = eq; else o.armor = eq - 24;
  return eq;
}

export class Tactical {
  constructor(g, aId, dId, terrain, r, { human = null, bonuses = null, sceneProfile = null, weather = null, factions = null, disrupted = null } = {}) {
    const D = data();
    this.g = g; this.r = r; this.terrain = terrain; this.human = human; this.round = 1; this.sceneProfile = sceneProfile;
    this.map = D.skirmish_maps[terrain] || D.skirmish_maps[2];
    this.modern = advancedBattle(g);
    this.weather = this.modern ? weather : null;
    if (this.modern) this.map = skirmishMap(this.map, terrain, sceneProfile);
    this.units = []; this.queue = []; this.log = []; this.over = null; this.duel = null;
    const mk = (id, key) => {
      const original = g.officers[id], bonus = bonuses?.[key];
      // 武将可能在白兵中升级；战斗属性临时加成，同时保持等级等其他字段与原武将同步。
      const o = bonus ? new Proxy(original, { get(target, prop, receiver) {
        if (prop === 'war' || prop === 'int') return Math.max(target[prop], Math.min(99, target[prop] + (bonus[prop] ?? 0)));
        return Reflect.get(target, prop, receiver);
      } }) : original;
      const eq = { atk: D.equipment[o.weapon]?.atk || 0, def: D.equipment[24 + o.armor]?.dfn || 0, wgrp: weaponGroup(o.weapon), weight: (D.equipment[o.weapon]?.weight || 0) + (D.equipment[24 + o.armor]?.weight || 0) };
      const ai = aiBattleBonus(g, factions?.[key]), raw = Math.floor((C(o.war) * o.war) / 100) + 9 - r(9) + ai;
      const F = disrupted?.[key] ? Math.floor(raw * 0.9) : raw;
      return { key, id, o, baseWar: original.war, tacticRounds: bonus?.tacticRounds ?? 0, unique: bonus?.unique, fortify: bonus?.fortify === true, massed: bonus?.massed === true, F, eq, hp: o.hp, start: o.soldiers, tp: Math.floor((o.int * 13) / 100) + Math.floor(ai / 2), fx: {}, cmd: { gen: 'advance', cav: 'advance', arc: 'advance', inf: 'advance' }, formation: 0,
        ...(this.modern ? { passive: officerPassive(D, g, id), ai, tacticRecovered: 0 } : {}) };
    };
    this.side = { a: mk(aId, 'a'), d: mk(dId, 'd') };
    this.side.a.foe = this.side.d; this.side.d.foe = this.side.a;
    this.castleDef = terrain === CASTLE;
    if (!this.isHuman('a')) this.side.a.formation = r(4);
    if (!this.isHuman('d')) this.side.d.formation = r(4);
  }
  isHuman(s) { return this.human === s; }
  // Squads: k=ceil(N/100), even split, infantry→archers→cavalry by level × war band (S02/S03).
  deploy() {
    const D = data();
    for (const s of ['a', 'd']) {
      const S = this.side[s], o = S.o, n = o.soldiers, k = Math.ceil(n / 100);
      const q = k ? Math.floor(n / k) : 0, rem = k ? n % k : 0, castle = s === 'd' && this.castleDef;
      const squads = officerSquads(D, this.g, S.id, castle, S.baseWar);
      const place = (idx, kind) => {
        const f = castle ? D.formations[kind === 'arc' ? 4 : 5] : D.formations[S.formation];
        const [ax, y, dx] = f[idx]; return [s === 'a' ? ax : castle ? 15 - ax : dx, y];
      };
      const [gx, gy] = place(0, 'gen');
      this.units.push({ side: s, kind: 'gen', idx: 0, x: gx, y: gy, hp: S.hp, id: S.id });
      for (let i = 0; i < squads.length; i++) {
        const squad = squads[i];
        const [x, y] = place(i + 1, squad.kind);
        this.units.push({ ...squad, side: s, idx: i + 1, x, y, hp: q + (i < rem ? 1 : 0) });
      }
      if (this.modern && !castle) this.organize(s);
    }
    this.buildQueue();
  }
  organize(s) {
    const line = this.units.filter(u => u.side === s && u.kind !== 'gen').sort(byFrontRank);
    const slots = line.map(u => [u.x, u.y]).sort((a, b) => (s === 'a' ? b[0] - a[0] : a[0] - b[0]) || a[1] - b[1]);
    line.forEach((u, i) => { [u.x, u.y] = slots[i]; });
  }
  formationKinds(s, formation) {
    const pts = data().formations[formation];
    const kinds = [];
    for (const unit of this.units) if (unit.side === s && unit.kind !== 'gen') kinds[unit.idx] = unit.kind;
    if (!this.modern) return kinds;
    const line = this.units.filter(u => u.side === s && u.kind !== 'gen');
    const slots = line.map(u => u.idx).sort((a, b) => pts[b][0] - pts[a][0] || pts[a][1] - pts[b][1]);
    line.sort(byFrontRank);
    return slots.reduce((result, slot, i) => { result[slot] = line[i].kind; return result; }, []);
  }
  get live() { return this.units.filter((u) => !u.dead && !u.out); }
  at(x, y) { return this.live.find((u) => u.x === x && u.y === y); }
  gen(s) { return this.units.find((u) => u.side === s && u.kind === 'gen'); }
  // The men a side still has: a squad that left the board keeps its men, for the end of the battle and the HUD.
  troops(s) { return this.units.filter((u) => u.side === s && u.kind !== 'gen' && !u.dead).reduce((a, u) => a + u.hp, 0); }
  // The men on the board, all the AI's odds read (D32A skips a squad that has left; devblog #99, 2026-11-03).
  fielded(s) { return this.live.filter((u) => u.side === s && u.kind !== 'gen').reduce((a, u) => a + u.hp, 0); }
  inside(x, y) { return x >= 0 && y >= 0 && x < GW && y < GH; }
  passable(u, x, y) { return this.inside(x, y) && PASS[this.side[u.side].o.army].includes(this.map[y][x]) && !this.at(x, y); }

  // Round cadence (S06): by type, attacker slots then defender, cavalry/generals act twice.
  buildQueue() {
    this.queue = [];
    for (const kind of KINDS) for (const s of ['a', 'd']) for (const u of this.units.filter((x) => x.side === s && x.kind === kind).sort((a, b) => a.idx - b.idx)) {
      const slowed = this.weather === 'snow' && !this.side[s].passive?.weatherproof;
      const count = kind === 'gen' || (kind === 'cav' && !slowed) ? 2 : 1;
      for (let k = 0; k < count; k++) this.queue.push(u);
    }
  }
  // AI command schedule (2.8): rounds 1–4 [gen wait, cav rnd, arc rnd, inf advance], then [rnd, adv, adv, adv].
  aiCommands(s) {
    const S = this.side[s], army = S.o.army, t = this.terrain, early = this.round <= 4;
    if (S.withdraw) { for (const k of KINDS) S.cmd[k] = 'retreat'; return; }
    if (this.modern) {
      const general = this.gen(s), enemy = this.gen(S.foe.key);
      const close = this.adjEnemies(general).length > 0;
      const stronger = this.fielded(s) > this.fielded(S.foe.key) * 1.2;
      const shooting = this.live.some(u => u.side === s && u.kind === 'arc' && this.rangedTargets(u).length);
      Object.assign(S.cmd, { gen: close && S.hp < 28 ? 'retreat' : stronger && S.hp >= 60 && this.round > 2 ? 'advance' : 'wait',
        cav: s === 'd' && this.castleDef && this.round <= 3 ? 'wait' : 'surround', arc: shooting ? 'wait' : 'advance',
        inf: s === 'd' && this.castleDef && enemy.x < 7 ? 'wait' : 'advance' });
      return;
    }
    if (this.castleDef) {
      if (s === 'a') { S.cmd.gen = early ? 'wait' : 'advance'; S.cmd.cav = S.cmd.arc = S.cmd.inf = 'advance'; }
      else {
        for (const k of KINDS) S.cmd[k] = 'wait';
        if (this.round > 6) S.cmd.cav = 'advance';
        if (!this.live.some((u) => u.side === 'a' && u.kind !== 'gen' && u.x < 8)) S.cmd.arc = 'advance';
      }
      return;
    }
    if ((army === '山' && t === 4) || (army === '水' && t === 3)) { Object.assign(S.cmd, early ? { gen: 'wait', cav: 'advance', arc: 'advance', inf: 'advance' } : { gen: 'rnd', cav: 'advance', arc: 'advance', inf: 'advance' }); return; }
    Object.assign(S.cmd, early ? { gen: 'wait', cav: 'rnd', arc: 'rnd', inf: 'advance' } : { gen: 'rnd', cav: 'advance', arc: 'advance', inf: 'advance' });
  }

  // One event per call; null when the battle is over.
  step() {
    if (this.over) return null;
    if (this.duel) return null; // UI resolves it, then calls resolveDuel()
    // Queued events go out first: an AI 挑发 arrives as its {ask} event, which the UI answers once via
    // answerTaunt(); only if nobody consumed it does the battle block on the pending challenge.
    if (this.events?.length) return this.events.shift();
    if (this.awaitTaunt) return null;
    if (!this.queue.length) return this.endRound();
    const u = this.queue.shift();
    if (u.dead || u.out) return this.step();
    return this.act(u);
  }
  // The HP a side's general must fall under to be taken (S19, by difficulty); null when he never surrenders.
  captureGate(s) { return this.side[s].o.loyalty === 100 ? null : [45, 40, 30][this.g.level]; }
  endRound() {
    const ev = { type: 'round', round: this.round };
    for (const s of ['a', 'd']) {
      const S = this.side[s], u = this.gen(s), P = S.passive;
      if (!P || !u || u.dead || u.out) continue;
      if (P.recovery && this.round % (P.recoveryPeriod ?? 1) === 0) { S.hp = Math.min(maxHp(S.o), S.hp + P.recovery); u.hp = S.hp; }
      const period = P.tacticPeriod ?? (P.tacticRecovery ? 3 : 0);
      if (period && this.round % period === 0 && S.tacticRecovered < (P.tacticLimit ?? 2)) { S.tp++; S.tacticRecovered++; }
    }
    // capture (S19): from round 4, HP below the difficulty gate, ≥2 adjacent enemies, loyalty ≠100
    if (this.round >= 4) for (const s of ['a', 'd']) {
      const gu = this.gen(s), S = this.side[s];
      if (gu.dead || gu.out) continue;
      const adj = this.adjEnemies(gu).length, capT = this.captureGate(s), capP = [55, 50, 30][this.g.level];
      if (capT != null && S.hp < capT && adj >= 2 && this.r(100) < capP) { gu.dead = true; S.fate = 'captured'; this.over = { why: 'capture', side: s }; return { type: 'capture', u: gu }; }
    }
    // AI withdrawal (D32A/D067): troops <200 and enemy > own+400, from round 4, 30/40/45%.
    for (const s of ['a', 'd']) {
      if (this.isHuman(s) || this.side[s].withdraw || this.round < 4) continue;
      const mine = this.fielded(s), foe = this.fielded(s === 'a' ? 'd' : 'a');
      if (mine < 200 && foe > mine + 400 && this.r(100) < [30, 40, 45][this.g.level]) { this.side[s].withdraw = true; ev.withdraw = s; }
    }
    // effect counters tick down at the round end; 士气 restores F when it lapses
    for (const S of Object.values(this.side)) for (const [k, v] of Object.entries(S.fx)) {
      if (v > 0) S.fx[k] = v - 1;
      if (k === 'morale' && S.fx[k] === 0 && S.baseF != null) { S.F = S.baseF; S.baseF = null; }
    }
    this.round++;
    if (this.round > 30) { this.over = { why: 'time' }; return ev; }
    for (const s of ['a', 'd']) { if (!this.isHuman(s)) { this.aiCommands(s); this.aiTactic(s); } }
    this.buildQueue();
    return ev;
  }
  cmdOf(u) {
    let c = this.side[u.side].cmd[u.kind];
    if (c === 'rnd') c = this.r(256) & 1 ? 'advance' : 'wait';
    return c;
  }
  adjEnemies(u) { return [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => this.at(u.x + dx, u.y + dy)).filter((e) => e && e.side !== u.side); }

  act(u) {
    const S = this.side[u.side], cmd = this.cmdOf(u), foeGen = this.gen(u.side === 'a' ? 'd' : 'a');
    // general contact with the enemy general starts a duel (S19/A61D)
    // A general who broke off a duel gets his own next action to fall back before contact with him starts
    // another (otherwise the foe's next step re-enters the duel at once). Only that: a general under 退却 orders,
    // the AI's withdrawal among them, or one who is bound or boxed in once his action has passed, can be met
    // again, as in the original, where only the mover's own 退却 skips the contact (feedback R02, 2026-11-02).
    if (u.kind === 'gen') S.brokeOff = false;
    const fleeing = !!this.side[foeGen.side].brokeOff;
    if (u.kind === 'gen' && !foeGen.dead && !foeGen.out && Math.abs(u.x - foeGen.x) + Math.abs(u.y - foeGen.y) === 1 && cmd !== 'retreat' && !fleeing) return this.startDuel(u.side);
    if (cmd !== 'retreat') {
      const t = this.pickTarget(u, cmd);
      if (t) return this.attack(u, t.unit, t.ranged);
    }
    if (cmd === 'wait') return { type: 'idle', u };
    // 咒缚 blocks the bound general's movement only (S15)
    if (u.kind === 'gen' && this.side[u.side === 'a' ? 'd' : 'a'].fx.bind > 0) return { type: 'idle', u, bound: true };
    const tx = cmd === 'retreat' ? (u.side === 'a' ? -1 : GW) : foeGen.x, ty = cmd === 'retreat' ? u.y : foeGen.y;
    return this.move(u, tx, ty, cmd === 'retreat');
  }
  pickTarget(u, cmd) {
    const S = this.side[u.side], skipGen = cmd === 'surround';
    const bowGeneral = u.kind === 'gen' && S.eq.wgrp === 4;
    const horsebow = u.kind === 'cav' && u.special === SPECIAL_TROOPS.horsebow.sprite;
    if (this.modern && !this.isHuman(u.side)) {
      const targets = this.rangedTargets(u).filter(t => !skipGen || t.kind !== 'gen').map(unit => ({ unit, ranged: true }));
      targets.push(...this.adjEnemies(u).filter(t => (!skipGen || t.kind !== 'gen') && !(u.kind === 'gen' && t.kind === 'gen')).map(unit => ({ unit, ranged: false })));
      const rank = ({ unit, ranged }) => (unit.kind === 'gen' ? 28 : 0) + Math.max(0, 60 - unit.hp) + counterBonus(u, unit, ranged) * 2 + (ranged ? 4 : 0);
      return targets.sort((a, b) => rank(b) - rank(a))[0] ?? null;
    }
    if (u.kind === 'arc' || bowGeneral || horsebow) {
      const range = this.shotRange(u);
      // The original skips the right ray whenever the left one finds nothing (`$C463`), so the attacker's archers,
      // who face right, walk on past foes in range; all four rays are scanned here (playtest of 2026-10-30, T08).
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        let hit = null;
        for (let d = 1; d <= range; d++) {
          const x = u.x + dx * d, y = u.y + dy * d;
          if (!this.inside(x, y) || !ARROW.includes(this.map[y][x])) break;
          const e = this.at(x, y);
          if ((bowGeneral || horsebow) && e?.side === u.side) break;
          if (e && e.side !== u.side) { if (d > 1 && !(skipGen && e.kind === 'gen')) hit = e; break; } // a foe alongside is fought hand to hand
        }
        if (hit) return { unit: hit, ranged: true };
      }
    }
    const axes = this.r(2) ? [[1, 0], [0, 1]] : [[0, 1], [1, 0]], sg = this.r(2) ? 1 : -1;
    for (const [dx, dy] of [[axes[0][0] * sg, axes[0][1] * sg], [-axes[0][0] * sg, -axes[0][1] * sg], [axes[1][0] * sg, axes[1][1] * sg], [-axes[1][0] * sg, -axes[1][1] * sg]]) {
      const e = this.at(u.x + dx, u.y + dy);
      if (e && e.side !== u.side && !(skipGen && e.kind === 'gen') && !(u.kind === 'gen' && e.kind === 'gen')) return { unit: e, ranged: false };
    }
    return null;
  }
  shotRange(u) {
    const s = this.side[u.side], bow = u.kind === 'gen' && s.eq.wgrp === 4;
    const mounted = u.kind === 'cav' && u.special === SPECIAL_TROOPS.horsebow.sprite;
    if (bow) return 2;
    if (mounted) return 3;
    if (u.kind !== 'arc') return 0;
    return (s.fx.xbow > 0 ? 6 : 4) - (this.weather === 'rain' && !s.passive?.weatherproof ? 1 : 0);
  }
  rangedTargets(u) {
    const s = this.side[u.side], bow = u.kind === 'gen' && s.eq.wgrp === 4;
    const mounted = u.kind === 'cav' && u.special === SPECIAL_TROOPS.horsebow.sprite, length = this.shotRange(u);
    if (!length) return [];
    const targets = [];
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) for (let n = 1; n <= length; n++) {
      const x = u.x + n * dx, y = u.y + n * dy;
      if (!this.inside(x, y) || !ARROW.includes(this.map[y][x])) break;
      const t = this.at(x, y);
      if (!t) continue;
      if (t.side === u.side) { if (bow || mounted) break; continue; }
      if (n > 1) targets.push(t);
      break;
    }
    return targets;
  }
  attack(u, t, ranged) {
    const S = this.side[u.side], T = this.side[t.side];
    let F = S.F, atk = u.kind === 'gen' ? S.eq.atk : 0; const fire = u.kind === 'arc' && ranged && S.fx.fire > 0; // 火矢 (S12): the view burns these arrows
    if (u.kind === 'arc') {
      F = Math.floor(((ranged ? 70 : 60) * F) / 100);
      if (fire) F = Math.min(100, F + this.r(this.weather === 'rain' && !S.passive?.weatherproof ? 6 : 10));
    }
    // 骑射每回合两次行动；远射缩至原战力的 42%，射程不享受强弩加成。
    else if (u.kind === 'cav' && ranged && u.special === SPECIAL_TROOPS.horsebow.sprite) F = Math.floor(42 * F / 100);
    // 武将每回合行动两次；弓的两格远射折减战力和武器攻击，避免射程优势叠加完整近战伤害。
    else if (u.kind === 'gen' && ranged && S.eq.wgrp === 4) { F = Math.floor(55 * F / 100); atk = Math.floor(60 * atk / 100); }
    const H = u.kind === 'gen' ? S.hp : u.hp;
    let D = Math.floor(((F + atk) * B(H)) / 100);
    if (t.kind === 'cav') D = Math.floor(D / 2) + Math.floor(D / 4);
    if (t.kind === 'gen') D = Math.max(0, Math.floor(D / 2) - T.eq.def);
    D = troopDamage(D, u, t, ranged);
    if (D > 0 && this.modern && t.kind !== 'gen' && u.kind !== 'gen') {
      const formed = this.live.some(v => v !== u && v.side === u.side && troopGroup(v) === troopGroup(u) && Math.abs(v.x - u.x) + Math.abs(v.y - u.y) <= 2);
      const counter = counterBonus(u, t, ranged);
      const a = S.passive, d = T.passive;
      const bonus = a?.troops && (!a.attackKind || a.attackKind === u.kind) && (!a.attackRounds || this.round <= a.attackRounds)
        && (!a.closeCombat || !ranged) && (!a.rangedCombat || ranged) ? a.troops : 0;
      const guard = d?.guard && (!d.guardKind || d.guardKind === t.kind) && (!d.guardRounds || this.round <= d.guardRounds)
        && (!d.guardOutnumberedCastle || (t.side === 'd' && this.castleDef && T.start < S.start)) ? d.guard : 0;
      D = Math.max(1, Math.floor(D * (100 + (formed ? 4 : 0) + counter + bonus - guard) / 100));
    }
    if (D > 0 && t.kind === 'cav' && T.unique === 'horsebow' && ranged) D = Math.max(1, Math.floor(D * 92 / 100));
    if (D > 0 && T.fortify && t.kind !== 'gen' && u.kind !== 'gen' && !ranged) D = Math.max(1, Math.floor(D * 94 / 100));
    if (D > 0 && t.kind !== 'gen') {
      const extra = S.unique === 'assault' && u.side === 'a' && !ranged ? 5
        : S.unique === 'river' && this.terrain === 3 && u.kind !== 'gen' && !ranged ? 5
        : S.unique === 'cavalry' && u.kind === 'cav' && !ranged ? 5
        : S.massed && u.kind !== 'gen' && !ranged ? 5
        : S.unique === 'horsebow' && u.special === SPECIAL_TROOPS.horsebow.sprite && ranged ? 8 : 0;
      if (extra) D = Math.max(1, Math.floor(D * (100 + extra) / 100));
    }
    const before = t.kind === 'gen' ? T.hp : t.hp, dealt = Math.min(before, D);
    if (t.kind === 'gen') { T.hp -= dealt; t.hp = T.hp; } else t.hp -= dealt;
    addExp(this.g, S.id, Math.floor((t.hp <= 0 && !ranged ? D : dealt) / 2));
    const ev = { type: 'attack', u, t, dmg: dealt, ranged, fire, kill: false };
    if ((t.kind === 'gen' ? T.hp : t.hp) <= 0) {
      t.dead = true; ev.kill = true;
      if (t.kind === 'gen') { const how = this.fell(t.side); if (how !== 'dead') { ev.kill = false; ev.spared = how; } }
    }
    return ev;
  }
  // Axis-greedy step with one alternate try (S07).
  move(u, tx, ty, retreat) {
    const dx = tx - u.x, dy = ty - u.y, rs = () => (this.r(2) ? 1 : -1);
    let horizFirst;
    if (u.kind === 'cav' && Math.abs(dx) >= 2) horizFirst = true;
    else if (u.kind === 'arc' && Math.abs(dy) >= 2) horizFirst = false;
    else horizFirst = Math.abs(dx) === Math.abs(dy) ? !!this.r(2) : Math.abs(dx) > Math.abs(dy);
    const h = [Math.sign(dx) || rs(), 0], v = [0, Math.sign(dy) || rs()];
    for (const [sx, sy] of horizFirst ? [h, v] : [v, h]) {
      if (!sx && !sy) continue;
      const nx = u.x + sx, ny = u.y + sy;
      if (retreat && (nx < 0 || nx >= GW)) {
        u.out = true; const ev = { type: 'exit', u, from: [u.x, u.y] };
        if (u.kind === 'gen') { this.side[u.side].fate = 'retreat'; this.over = { why: 'retreat', side: u.side }; ev.pursuit = this.pursue(u.side); }
        return ev;
      }
      if (this.passable(u, nx, ny)) { const from = [u.x, u.y]; u.x = nx; u.y = ny; if (u.kind === 'gen') u.facing = [sx, sy]; return { type: 'move', u, from, to: [nx, ny] }; }
    }
    if (this.modern && !retreat && !this.isHuman(u.side)) {
      const from = [u.x, u.y], queue = [{ x: u.x, y: u.y, first: null, steps: 0 }];
      const seen = new Set([u.y * GW + u.x]), distance = (x, y) => Math.abs(x - tx) + Math.abs(y - ty);
      let best = distance(...from), to = null;
      for (const { x, y, first, steps } of queue) {
        if (steps === 5) continue;
        for (const [dx, dy] of [[1,0], [-1,0], [0,1], [0,-1]]) {
          const a = x + dx, b = y + dy, key = b * GW + a;
          if (seen.has(key) || !this.passable(u, a, b)) continue;
          seen.add(key);
          const step = first ?? [a, b], d = distance(a, b);
          if (d < best) { best = d; to = step; }
          queue.push({ x: a, y: b, first: step, steps: steps + 1 });
        }
      }
      if (to) {
        [u.x, u.y] = to;
        if (u.kind === 'gen') u.facing = [u.x - from[0], u.y - from[1]];
        return { type: 'move', u, from, to };
      }
    }
    return { type: 'idle', u };
  }

  // ---------- Tactics (S14–S18; AI order 2.8) ----------
  // The original lets no tactic through while one of the side's own runs (AAF0), and aiTactic keeps to that by asking
  // without an id. The player's 爆炎, an instant blow with no duration, may be thrown over a running effect (devblog #131).
  blastCenter(s) {
    const u = this.gen(s); if (!u || u.dead || u.out) return null;
    const [dx, dy] = u.facing ?? [s === 'a' ? 1 : -1, 0], x = u.x + 2 * dx, y = u.y + 2 * dy;
    return this.inside(x, y) ? [x, y] : null;
  }
  canTactic(s, id) { const S = this.side[s]; return (id !== 'blast' || !!this.blastCenter(s)) && (id === 'blast' || !Object.values(S.fx).some((v) => v > 0)) && !S.usedThisRound; }
  tactic(s, id) {
    const S = this.side[s], F = S.foe, T = TACTICS.find((t) => t.id === id), r = this.r;
    if (!T || S.tp < T.cost || !this.canTactic(s, id)) return { type: 'tactic', side: s, id, ok: false, msg: '无法使用' };
    S.tp -= T.cost;
    const ev = { type: 'tactic', side: s, id, name: T.name, ok: true };
    switch (id) {
      case 'bind': ev.ok = !!(r(256) & 1); if (ev.ok) S.fx.bind = 4; break;
      case 'xbow': S.fx.xbow = 3 + S.tacticRounds; break;
      case 'fire': S.fx.fire = 3 + S.tacticRounds; break;
      case 'morale': S.fx.morale = 4 + S.tacticRounds; S.baseF = S.F; S.F += 5 + r(5); break;
      case 'taunt': {
        if (s === 'a' && this.castleDef) { ev.ok = false; break; }
        const p = 32 + 2 * Math.max(0, S.o.level - F.o.level) - Math.floor(F.o.int / 10);
        ev.ok = r(100) < p;
        if (ev.ok) { ev.duel = true; return Object.assign(ev, this.startDuel(s)); }
        break;
      }
      case 'blast': {
        const [cx, cy] = this.blastCenter(s);
        ev.center = [cx, cy]; ev.hits = [];
        for (const e of this.live.filter((e) => e.side !== s && Math.abs(e.x - cx) <= 1 && Math.abs(e.y - cy) <= 1)) {
          const heat = this.weather === 'rain' && !S.passive?.weatherproof ? 0.85 : 1;
          const d = Math.floor((Math.max(0, S.o.int - r(10) - 2) + 1) * heat), dmg = e.kind === 'gen' ? Math.floor(d / 2) : e.kind === 'cav' ? 2 * Math.floor(d / 3) : d;
          if (e.kind === 'gen') { F.hp = Math.max(0, F.hp - dmg); e.hp = F.hp; if (!F.hp) this.fell(e.side); }
          else { e.hp = Math.max(0, e.hp - dmg); if (!e.hp) e.dead = true; }
          addExp(this.g, S.id, Math.floor(dmg / 2)); ev.hits.push({ u: e, dmg });
        }
        break;
      }
    }
    return ev;
  }
  // What works on side s this round, for the views' badges: the foe's 咒缚 on its general (the counter is kept on the caster,
  // act() reads it from there), its own 强弩 / 火矢 on its archers and 士气向上 on every unit. n: rounds left, this one included.
  // An AI cast is settled at the round's end and told later, by its queued event (aiTactic → this.events): until that event has
  // gone out its effect is not listed, so no badge gives a 咒缚's roll away before its banner.
  untold(s, id) { return !!this.events?.some((e) => e.type === 'tactic' && e.side === s && e.id === id); }
  effects(s) {
    const S = this.side[s], F = S.foe, out = [];
    if (F.fx.bind > 0 && !this.untold(F.key, 'bind')) out.push({ id: 'bind', n: F.fx.bind, on: 'gen', bad: true });
    for (const [id, on] of [['xbow', 'arc'], ['fire', 'arc'], ['morale', 'all']]) if (S.fx[id] > 0 && !this.untold(s, id)) out.push({ id, n: S.fx[id], on });
    return out;
  }
  aiTactic(s) {
    const S = this.side[s], F = S.foe, r = this.r, gu = this.gen(s);
    if (!this.canTactic(s) || gu.dead || gu.out) return;
    const foeUnits = this.live.filter((e) => e.side !== s);
    const tryT = (id, p) => {
      const T = TACTICS.find((t) => t.id === id); if (S.tp < T.cost) return false;
      if (r(100) >= p) return false;
      // an AI 挑发 against the player waits for the player's answer (D77F)
      if (id === 'taunt' && this.isHuman(s === 'a' ? 'd' : 'a')) {
        S.tp -= T.cost; const q = 32 + 2 * Math.max(0, S.o.level - F.o.level) - Math.floor(F.o.int / 10);
        const ok = !(s === 'a' && this.castleDef) && r(100) < q;
        (this.events ||= []).push({ type: 'tactic', side: s, id, name: T.name, ok, ask: ok });
        if (ok) this.awaitTaunt = s;
        return true;
      }
      (this.events ||= []).push(this.tactic(s, id)); return true;
    };
    const center = this.blastCenter(s), n = center ? foeUnits.filter((e) => Math.abs(e.x - center[0]) <= 1 && Math.abs(e.y - center[1]) <= 1).length : 0;
    if (n >= 2 && tryT('blast', n === 2 ? 40 : n === 3 ? 70 : 100)) return;
    const archers = this.live.filter((u) => u.side === s && u.kind === 'arc');
    let shots = 0; for (const a of archers) for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0]]) for (let d = 2; d <= 4; d++) if (foeUnits.some((e) => e.x === a.x + dx * d && e.y === a.y + dy * d)) shots++;
    if (shots >= 2 && tryT('fire', shots === 2 ? 40 : shots === 3 ? 70 : 100)) return;
    if (tryT('morale', 20)) return;
    if (archers.length && tryT('xbow', [0, 0, 48, 80, 128][Math.min(archers.length, 4)])) return;
    if (S.eq.atk >= F.eq.atk && S.hp >= F.hp && tryT('taunt', 40)) return;
    if (this.fielded(s === 'a' ? 'd' : 'a') < 200 && this.fielded(s) > this.fielded(s === 'a' ? 'd' : 'a') + 400) tryT('bind', 50);
  }

  // ---------- Duel bridge (CA3F/CD69/CDCF) ----------
  startDuel(starter) {
    const duel = new Duel(this.side, this.r, this.g, this.human);
    this.duel = duel; this.duels = (this.duels || 0) + 1;
    return { type: 'duel', duel, starter };
  }
  // After the UI (or autoDuel) finished: apply the outcome.
  resolveDuel() {
    const d = this.duel; if (!d) return null;
    this.duel = null;
    const res = d.result || {};
    for (const s of ['a', 'd']) this.gen(s).hp = this.side[s].hp;
    if (res.dead != null) {
      const id = res.dead, how = this.fell(this.side.a.id === id ? 'a' : 'd');
      if (how === 'captured') { res.dead = null; res.captured = id; }
      else { const eq = duelLoot(this.g, res.winner, id, this.r); if (eq != null) res.loot = { id: res.winner, eq }; }
    } else if (res.surrendered != null) {
      const s = this.side.a.id === res.surrendered ? 'a' : 'd';
      // 袭扰战的临时山贼、海贼不属于正常势力，继续按袭扰战的俘虏规则结算。
      const defect = res.persuaded && !this.g.raidBattle;
      this.gen(s).dead = true; this.side[s].fate = defect ? 'defected' : 'captured';
      this.over = { why: defect ? 'defection' : 'capture', side: s };
    }
    else if (res.endSkirmish) this.over = { why: 'parley' };
    // A retreat and 说得's 结果 2 both leave result code 1 on the general who goes: his order turns to 退却, and he gets his
    // own next action to fall back before contact with him starts another duel (else the next step re-enters it at once).
    else if ((res.retreated ?? res.withdrew) != null) { const id = res.retreated ?? res.withdrew, s = this.side.a.id === id ? 'a' : 'd'; this.side[s].cmd.gen = 'retreat'; this.side[s].brokeOff = true; }
    return { type: 'duelEnd', res };
  }
  autoDuel() { const d = this.duel; for (let t; (t = d.next()); ) d.act(t, d.aiCommand(t)); return this.resolveDuel(); }

  // 体力归零时结束白兵；不战死时被俘，否则阵亡。
  fell(s) {
    const S = this.side[s], gu = this.gen(s);
    // 守城袭扰中非君主只会受擒并在战后下野；君主仍遵守不战死选项。
    const raidSpared = this.g.raidBattle && !this.g.officers[S.id].raidEnemy && !isRuler(this.g, S.id);
    const how = raidSpared ? 'captured' : spared(this.g) || 'dead';
    gu.dead = true;
    S.fate = how; S.spared = how !== 'dead';
    this.over = { why: how === 'dead' ? 'dead' : 'capture', side: s };
    return how;
  }
  // 追击 (bank14 $A407–$A4F6): once a general has left over his edge, U(100) < 32 lets him get away untouched;
  // otherwise he takes 5+U(10), HP clamped at 0, and at 0 his 退却 becomes a death (武将不战死 as fell() rules).
  // No distance, troop, equipment or side test: both sides, AI or player, run the same draw, once per exit.
  // docs/原版白兵撤退追击逻辑与修复交接_2026-11-07.md.
  pursue(s) {
    const S = this.side[s], gu = this.gen(s);
    if (this.r(100) < 32) return (S.pursuit = { hit: false, dmg: 0 });
    const rolled = 5 + this.r(10), dmg = Math.min(S.hp, rolled);
    S.hp -= dmg; gu.hp = S.hp;
    const p = (S.pursuit = { hit: true, dmg, rolled, from: S.hp + dmg });
    if (S.hp <= 0) p.fell = this.fell(s);
    return p;
  }
  answerTaunt(accept) {
    const s = this.awaitTaunt; if (!s) return null; // already answered
    this.awaitTaunt = null;
    return accept ? this.startDuel(s) : { type: 'refuse', side: s };
  }
  // One standing order for every troop type at once (the console's 全军待机 / 全军包围 / 全军撤退).
  commandAll(s, c) { if (!(c in COMMANDS)) throw new Error(`unknown command ${c}`); for (const k of KINDS) this.side[s].cmd[k] = c; }
  // Withdraw everything (player 撤退).
  withdrawAll(s) { this.commandAll(s, 'retreat'); }

  result() {
    const out = (s) => {
      const S = this.side[s];
      const soldiers = this.units.filter((u) => u.side === s && u.kind !== 'gen' && !u.dead).reduce((a, u) => a + u.hp, 0);
      return { soldiers, hp: S.spared ? Math.max(S.hp, sparedHp(this.g, S.id)) : S.hp, fate: S.fate === 'retreat' ? null : S.fate || null,
        ...(S.spared && isRuler(this.g, S.id) ? { spared: true } : {}) };
    };
    const res = { a: out('a'), d: out('d'), rounds: this.round, why: this.over?.why, duels: this.duels || 0 };
    res.lossA = this.side.a.start - res.a.soldiers; res.lossD = this.side.d.start - res.d.soldiers;
    return res;
  }
  // Run to the end with AI on both sides (AI-only wars and tests).
  runAuto(max = 2000) {
    if (!this.units.length) this.deploy();
    for (const s of ['a', 'd']) { this.aiCommands(s); }
    for (let i = 0; i < max && !this.over; i++) {
      if (this.awaitTaunt) this.answerTaunt(true);
      const ev = this.step();
      if (this.duel) this.autoDuel();
      else if (!ev && !this.over) break;
    }
    if (!this.over) this.over = { why: 'time' };
    return this.result();
  }
}
