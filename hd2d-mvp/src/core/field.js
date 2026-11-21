// War map rules (6.2, 6.7, 6.8, 6.10) without rendering. One Field per war; the renderer drives it.
// Ported: deployment blocks and AI role sub-lists, movement costs (600-troop split), shared daily
// mobility, rice per day, 30-day limit, castle capture, commander loss, retreat thresholds, field
// hospital/rice shop, AI roles 0–4 and battlefield strategies.
import { data, rng, NONE, DEAD, roads, addExp, takeLevelUps, equipmentStock, equipBlock, wearEquip, spared, sparedHp, isRuler, isPass, maxHp, rulerPassive, recruitLoyalty } from './game.js';
import { Tactical } from './tactical.js';
import { roll100, realChance } from './origrng.js';
import { relationshipAffinity, recruitThreshold, recruitLoyaltyWithRelation } from './relationships.js';
import { passiveRiceUse } from './ruler-passives.js';
import { resolveBattlefield } from './battlefields.js';
import { POST_MOBILITY } from './battle-approaches.js';
import { siegeRing, wallAt, gateAt, gateDefense, blockedStrategy, blockedTerrain, strategyTerrainObstacle, restoreGates } from './siege.js';
import { EXPANDED_WARDS_LAYOUT_REVISION, CORNER_LAYOUT_REVISION, REGIONAL_LAYOUT_REVISION } from './regional-battlefields.js';
import { abilityStrategy, abilityStrategyIds, strategySpecs } from './famous-skills.js';
import { advancedBattle, aiBattleBonus, battleWeather, fullStrategyWeather, officerPassive, tacticWeather, WEATHER_NAMES, weatherPenalty } from './battle-rules.js';
import { strategyBonus, strategyWard } from './officer-passives.js';

const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]]; // 上下左右
export const W = 32, H = 19, FOREST = 0, SAND = 1, PLAIN = 2, RIVER = 3, MOUNT = 4, CASTLE = 5;
export const ATTACK_COST = 2, MAX_DAY = 30;
const GATE_STRATEGIES = [0, 4, 9, 13]; // 火计、乱水、落石、连弩皆只作用于一个目标
const PINCER = 16, DISRUPT = 17;
// The terrains by the manual's names (M p34), in the order of the constants above.
export const TERRAIN_NAME = ['林', '沙地', '平地', '河', '山', '城'];

// 16 计略 (6.3): name, player cost, AI cost (AI decides with the player table, then pays its own).
export const STRATS = [
  ['火计', 6, 6], ['陷阱', 5, 5], ['虚兵', 4, 4], ['要击', 6, 6], ['乱水', 7, 7], ['火箭', 8, 8], ['伪击转杀', 8, 8], ['共杀', 8, 12],
  ['笼络', 10, 10], ['落石', 9, 9], ['连环', 9, 9], ['十面埋伏', 10, 15], ['水攻', 10, 14], ['连弩', 8, 15], ['劫火', 12, 25], ['奇门遁甲', 10, 20],
].map(([name, cost, ai], id) => ({ id, name, cost, ai }));
// What each 计略 does and where it can be cast (`legal` below, `cast` for the effect), for the 计略 menu's tips
// (feedback R10, 2026-11-02): `does` is the effect, `where` the condition on the target or on the caster.
export const STRAT_INFO = [
  { does: '火攻敌军，损兵（看智力、等级）', where: '目标在森林或平地' },
  { does: '敌将受伤，体力减少（看武力、智力）', where: '目标在森林或山地' },
  { does: '敌军数日不能移动（我为攻方3日，守方2日）', where: '目标在森林或山地' },
  { does: '伏击敌军，损兵（看武力）', where: '目标在森林或山地' },
  { does: '水淹敌军，损兵（看智力）', where: '目标在河上' },
  { does: '烧毁敌军携带的米', where: '目标是敌总大将' },
  { does: '火攻守城的敌军，损兵（看智力、等级）', where: '目标在城中，与我相邻' },
  { does: '火攻目标及其身边的友军，各自损兵', where: '目标在森林或山地，身边有其友军' },
  { does: '劝敌将倒戈投向我军（看对方忠诚，71以上不会成功）', where: '目标不在城中' },
  { does: '落石砸向敌军：敌将受伤并损兵', where: '自己在山地或城中，目标与我相邻且不在城中' },
  { does: '锁住河上相连的敌军，数日不能移动', where: '目标在河上，身边有同在河上的友军' },
  { does: '在林中设下伏兵（耗兵100），5日内敌军走进两格内的森林时遭伏击', where: '自己在森林，兵数100以上，我军尚无伏兵' },
  { does: '水攻河上相连的敌军，各自损兵', where: '目标在河上，身边有同在河上的友军' },
  { does: '以连弩射击相邻敌军，大量损兵', where: '自己在城中，目标与我相邻' },
  { does: '火烧相连的敌军（城中的除外），各自大量损兵', where: '目标不在城中，身边有不在城中的友军' },
  { does: '困敌于石阵：数日不能移动，诸葛亮在场时每日折兵', where: '目标不在河上和城中' },
];
// 新版本的技能只使用受校验的固定效果，原版计略及其编号保持不变。
export function configureStrategies(g) {
  STRATS.length = 16; STRAT_INFO.length = 16;
  if (advancedBattle(g)) {
    STRATS.push({ id: PINCER, name: '夹攻', cost: 7, ai: 7, soldiers: 115, hp: 0, stop: 0, rice: 0, maxUses: 2, custom: true },
      { id: DISRUPT, name: '破阵', cost: 9, ai: 9, soldiers: 50, hp: 0, stop: 0, rice: 0, maxUses: 2, custom: true });
    STRAT_INFO.push({ does: '敌军损兵115', where: '目标距施计者三格内，且与另一名有兵的友军相邻' },
      { does: '敌军损兵50，下次白兵战力降低10%', where: '目标距施计者三格内、尚未被破阵' });
    return;
  }
  for (const original of strategySpecs(data(),g)) {
    const skill = abilityStrategy(data(), g, original);
    STRATS.push({ ...skill, ai: skill.cost, custom: true });
    const effects = [skill.soldiers ? `损兵 ${skill.soldiers}` : '', skill.hp ? `体力减少 ${skill.hp}` : '',
      skill.stop ? `限制移动 ${skill.stop} 日` : '', skill.rice ? `损失粮草 ${skill.rice}` : ''].filter(Boolean);
    const conditional = g?.campaignRules === true ? {
      fortress: '施术者在城中时额外损兵25', frontier: '目标距己方总大将两格内时额外限制移动1日',
      interdict: '目标兵力至少400时额外损米30',
    }[skill.effectProfile] : null;
    STRAT_INFO.push({ does: `${effects.join('，')}${conditional ? `；${conditional}` : ''}${skill.maxUses ? `，每场最多${skill.maxUses}次` : ''}`, where: '5格内敌军' });
  }
}
const SPECIAL = [ // unlock by level for named strategists (6.3 §1)
  [[161, 99, 167, 22, 196, 219, 234, 107, 206, 235, 183], [[4, 12]]],
  [[24, 55, 112, 213, 110, 103], [[4, 12], [5, 14]]],
  [[197, 86, 93], [[4, 12], [5, 14], [6, 15]]],
  [[109], [[4, 12], [5, 14], [6, 15], [7, 16]]],
];
// AI special-strategy users (file 0x10C75, 21 strategists; later entries unlock more).
const AI_SPECIAL = [161, 99, 167, 22, 196, 219, 234, 107, 206, 235, 24, 55, 112, 213, 110, 103, 197, 86, 93, 109, 183];
export function stratCount(id, o, g = null) {
  if (advancedBattle(g)) {
    if (o.int >= 92 && o.level >= 4) return Math.min(15, o.level + 8);
  } else {
    for (const [ids, steps] of SPECIAL) if (ids.includes(id)) { let n = 0; for (const [lv, k] of steps) if (o.level >= lv) n = k; if (n) return n; }
  }
  return o.int < 40 ? 2 : o.int < 60 ? 4 : o.int < 75 ? 6 : o.int < 85 ? 8 : 10;
}
const ARMY_IDX = { 平: 0, 山: 1, 水: 2 };

// Role counts a/b/c/d for team sizes 2..10 (6.8 §2), by side and faction group.
const ROLE_TABLE = {
  def: [['1000 1100 2100 2110 3110 3210 3211 3221 3222', [0, 3, 6]], ['0010 0110 0120 1120 1121 2121 2131 2132 2133', [1, 5]], ['0100 0110 1110 1210 1220 2220 2221 2222 3231', [2, 4]]],
  att: [['1000 2000 2100 2101 3101 3111 3211 4211 4212', [0, 3, 6]], ['1000 1100 1110 2110 2111 2211 2221 3221 3321', [1, 5]], ['1000 1100 2100 2110 2111 2211 3211 3311 3312', [2, 4]]],
};
const SUBLIST = { def: [1, 4, 6, 10], att: [1, 6, 11, 14] };

export class Field {
  constructor(g, war, humanSide) {
    const D = data();
    configureStrategies(g);
    this.g = g; this.war = war; this.human = humanSide; // 'att' | 'def' | null
    this.weather = battleWeather(g, war.city);
    takeLevelUps(g); // level-ups from fights the player did not see (AI wars, a test 白兵) are not told in this one
    const { map, dep, villages, siege, profile, entry, approaches } = resolveBattlefield(D, g, war.city, war.from);
    Object.assign(this, { map, dep, villages, siege, sceneProfile: profile, entryDirection: entry, approaches });
    if (siege?.camp) this.campSecured = false;
    this.r = rng(g);
    this.units = [];
    for (const side of ['def', 'att']) {
      const ids = war[side].ids;
      const block = side === 'def' ? dep.defender : dep.grouped ? dep.attackerZones[0].cells : dep.attacker;
      const roles = this.assignRoles(side, ids);
      const used = new Set();
      const take = (i) => { while (i < block.length && used.has(block[i] + '')) i++; if (i < block.length) { used.add(block[i] + ''); return block[i]; } return block.find((p) => !used.has(p + '') && used.add(p + '')); };
      const next = [...SUBLIST[side]];
      const distributed = side === 'def' && siege?.revision >= EXPANDED_WARDS_LAYOUT_REVISION
        || side === 'att' && (dep.grouped || dep.attackerZones?.some(zone => zone.corner != null));
      ids.forEach((id, k) => {
        const role = roles[k];
        const pos = k === 0 || distributed ? take(k) : take(next[role - 1]++);
        this.units.push({ id, side, x: pos[0], y: pos[1], role, home: role, commander: k === 0, gone: false });
      });
    }
    this.pool = { att: 0, def: 0 };
    this.day = 1; this.turn = 'att'; this.over = null; this.log = [];
    this.recover();
  }
  // 战场中断 (src/core/suspend.js): the whole field as plain data, taken on the player's own idle turn (nothing pending:
  // no 十面埋伏 still to tell, no 白兵 open). The set ambushes name their general by his place in `units`.
  snapshot() {
    const ambush = this.ambush && Object.fromEntries(Object.entries(this.ambush).map(([s, a]) => [s, a && { ...a, u: this.units.indexOf(a.u) }]));
    return structuredClone({ human: this.human, units: this.units, pool: this.pool, day: this.day, turn: this.turn, over: this.over, log: this.log,
      commanderRetreat: this.commanderRetreat ?? null, ambush: ambush ?? null,
      ...(this.siege?.camp ? { campSecured: this.campSecured } : {}),
      ...(this.siege ? { siegeGates: this.siege.gates, siegeRevision: this.siege.revision } : {}) });
  }
  // The field again from a snapshot, on the game and war it was taken with (both restored from the same record). Nothing is
  // drawn and no role is reassigned, so the battle goes on exactly where it stood. `resumed` tells the war view to skip 布阵.
  static restore(g, war, snap) {
    const D = data(), f = Object.create(Field.prototype), s = structuredClone(snap);
    configureStrategies(g);
    f.g = g; f.war = war; f.human = s.human;
    f.weather = battleWeather(g, war.city);
    const { map, dep, villages, siege, profile, entry, approaches } = resolveBattlefield(D, g, war.city, war.from, s.siegeRevision ?? 1);
    Object.assign(f, { map, dep, villages, siege, sceneProfile: profile, entryDirection: entry, approaches, r: rng(g) });
    if (f.siege && !restoreGates(f.siege, s.siegeGates)) throw new Error('无效的城门中断记录');
    if (f.siege?.camp) {
      if (typeof s.campSecured !== 'boolean') throw new Error('无效的前阵中断记录');
      f.campSecured = s.campSecured;
    }
    Object.assign(f, { units: s.units, pool: s.pool, day: s.day, turn: s.turn, over: s.over, log: s.log ?? [], lastAmbush: null, resumed: true });
    if (s.commanderRetreat) f.commanderRetreat = s.commanderRetreat;
    if (s.ambush) f.ambush = Object.fromEntries(Object.entries(s.ambush).map(([k, a]) => [k, a && { ...a, u: f.units[a.u] }]));
    return f;
  }
  O(id) { return this.g.officers[id]; }
  get alive() { return this.units.filter((u) => !u.gone); }
  side(s) { return this.alive.filter((u) => u.side === s); }
  get width() { return this.map[0].length; }
  get height() { return this.map.length; }
  terr(x, y) { return this.map[y][x]; }
  unitTerrain(x, y) { return this.approaches?.roads.get(`${x},${y}`)?.kind === 'bridge' ? PLAIN : this.terr(x, y); }
  inside(x, y) { return x >= 0 && y >= 0 && x < this.width && y < this.height; }
  unitAt(x, y) { return this.alive.find((u) => u.x === x && u.y === y); }
  castle() { return this.siege?.camp ? [this.siege.cx, this.siege.cy] : this.dep.defender[0]; }
  assaultTarget() { return this.siege?.camp && !this.campSecured ? this.siege.camp : { x: this.castle()[0], y: this.castle()[1] }; }
  deploymentZones(side) {
    const attacker = side === 'att';
    return (attacker ? this.dep.attackerZones : this.dep.defenderZones)
      ?? [{ rect: attacker ? this.dep.attacker_rect : this.dep.defender_rect }];
  }
  faction(s) { return s === 'att' ? this.war.attacker : this.war.defender; }
  isSupporting(u) {
    return !!this.war.support && u.side === 'def' && (u.supporting ?? this.war.support.ids.includes(u.id));
  }
  unitFaction(u) { return this.isSupporting(u) ? this.war.support.faction : this.faction(u.side); }
  controls(u) { return !!u && u.side === this.human && (!this.war.support || this.unitFaction(u) === this.g.player); }
  chest(s) { return this.war[s]; }
  combatPassive(s) {
    const faction = this.faction(s), ruler = this.g.factions[faction]?.ruler;
    const deployed = this.units.find((u) => u.side === s && u.id === ruler);
    let passive = deployed?.gone ? null : rulerPassive(this.g, faction)?.combat ?? null;
    if (passive?.unique === 'bonds' && this.side(s).filter((u) => u.id !== ruler && relationshipAffinity(data(), this.g, ruler, u.id) > 0).length >= 2) {
      passive = { ...passive, strategy: passive.strategy + 2 };
    }
    if (passive?.unique === 'garrison' && s === 'def') passive = { ...passive, war: passive.war + 1 };
    if (passive?.unique === 'tactics') passive = { ...passive, tacticRounds: passive.tacticRounds + 1 };
    if (passive?.unique === 'fortify' && s === 'def') passive = { ...passive, fortify: true };
    if (passive?.unique === 'massed' && this.side(s).filter((u) => this.O(u.id)?.hp > 0 && this.O(u.id)?.soldiers > 0).length >= 3) passive = { ...passive, massed: true };
    // 关隘的守方获得轻微地形优势，与君主是否参战无关。
    return this.g.campaignRules === true && s === 'def' && isPass(this.war.city)
      ? { int: 0, strategy: 0, mobility: 0, tacticRounds: 0, ...passive, war: (passive?.war ?? 0) + 1 } : passive;
  }

  assignRoles(side, ids) {
    const n = ids.length;
    if (n < 2) return [0];
    const faction = this.faction(side), f = this.war.raid && side === 'att' ? 0 : data().factions[faction]?.aiProfile ?? faction;
    const row = ROLE_TABLE[side].find(([, fs]) => fs.includes(f))[0].split(' ')[n - 2];
    const counts = [...row].map(Number);
    // sort non-commanders by war descending (bubble with swap on ≥, kept as an approximation)
    const rest = ids.slice(1).sort((a, b) => this.O(b).war - this.O(a).war);
    ids.splice(1, ids.length - 1, ...rest);
    const roles = [0];
    counts.forEach((c, i) => { for (let k = 0; k < c; k++) roles.push(i + 1); });
    while (roles.length < n) roles.push(4);
    return roles;
  }

  troops(s) { return this.side(s).reduce((a, u) => a + this.O(u.id).soldiers, 0); }
  mobilityBonus(s) {
    const passive = this.combatPassive(s);
    const post = this.postHolder();
    return (passive?.mobility ?? 0) + (passive?.unique === 'muster' && this.side(s).length >= 4 ? 1 : 0)
      + (post?.side === s ? POST_MOBILITY : 0);
  }
  postHolder() {
    const post = this.approaches?.post;
    const unit = post && this.unitAt(post.x, post.y);
    return unit && this.O(unit.id).soldiers > 0 ? unit : null;
  }
  recover() {
    const D = data();
    for (const s of ['att', 'def']) {
      const q = Math.min(9, Math.floor(this.troops(s) / 1000));
      const bonus = this.mobilityBonus(s);
      this.pool[s] = Math.min(this.pool[s] + D.rules.mobility_recover[q] + bonus, D.rules.mobility_cap[q] + bonus);
    }
  }
  cost(u, x, y) {
    if (!this.deployable(x,y)) return Infinity;
    const o = this.O(u.id), D = data();
    const road = this.approaches?.roads.get(`${x},${y}`);
    const t = road?.kind === 'bridge' || this.villages.some((v) => v.x === x && v.y === y) ? PLAIN : this.terr(x, y);
    const gate = gateAt(this.siege, x, y);
    if (u.side === 'att' && gate?.requiresCamp && !this.campSecured) return Infinity;
    const base = D.rules.move_cost[o.soldiers >= 600 ? 'large' : 'small'][o.army][t], passive = this.passive(u);
    const ground = t === passive?.terrainMarch || (t === PLAIN && passive?.march && o.soldiers >= 600) ? 1 : t === MOUNT ? passive?.mountains ?? 0 : 0;
    const crossing = road?.kind === 'ford' ? 1 : road?.kind === 'plank' && o.soldiers >= 600 ? 1 : 0;
    return Math.max(1, base + weatherPenalty(this.weather, t, passive, o.army) - ground - Number(!!road) + crossing)
      + (u.side === 'att' && gate && !gate.open ? 2 : 0);
  }
  reach(u, budget = this.pool[u.side], allows = () => true) {
    const dist = new Map([[u.x + ',' + u.y, 0]]), prev = new Map(), open = u.stop || u.qimen ? [] : [[0, u.x, u.y]];
    while (open.length) {
      open.sort((a, b) => a[0] - b[0]);
      const [d, x, y] = open.shift();
      if (d > dist.get(x + ',' + y)) continue;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
        if (!this.inside(nx, ny) || !allows(nx, ny) || this.unitAt(nx, ny)) continue;
        const nd = d + this.cost(u, nx, ny);
        if (nd > budget || nd >= (dist.get(k) ?? Infinity)) continue;
        dist.set(k, nd); prev.set(k, x + ',' + y); open.push([nd, nx, ny]);
      }
    }
    return { dist, prev };
  }
  path(reach, x, y) { const p = []; for (let k = x + ',' + y; reach.prev.has(k); k = reach.prev.get(k)) p.unshift(k.split(',').map(Number)); return p; }
  adjacentEnemies(u) { return DIRS.map(([dx, dy]) => this.unitAt(u.x + dx, u.y + dy)).filter((e) => e && e.side !== u.side); }
  // --- Read-only forecasts for the war map's display (第 3 期, docs/战场3D重构与操作优化方案_2026-11-13.md §7). They change nothing
  // and roll nothing: reach() and cost() are pure, and a held general is read through a copy.
  // The pool a side will hold when it next acts, seen from the other side's turn: the defender acts later the same day with what
  // he has now; the attacker acts after the day turns, when both pools recover and are capped (recover(), endTurn()).
  poolWhenNext(side) {
    if (side === this.turn || side === 'def') return this.pool[side];
    const D = data(), q = Math.min(9, Math.floor(this.troops(side) / 1000));
    const bonus = this.mobilityBonus(side);
    return Math.min(this.pool[side] + D.rules.mobility_recover[q] + bonus, D.rules.mobility_cap[q] + bonus);
  }
  // The cells a side's generals could strike when it next acts: every cell beside one a general can walk to with the pool
  // less the cost of an attack (his own cell counts: he strikes without moving). The pool is shared, so this is how far any one of
  // them could reach alone, not all at once. A general held by 虚兵 / 连环 / 奇门 stays where he is unless the hold runs out with
  // the day that turns before his side acts; held, he is still counted as striking the cells beside him.
  // only: one general of that side. Returns a Set of 'x,y'.
  threat(side, only = null) {
    const out = new Set(), budget = this.poolWhenNext(side) - ATTACK_COST;
    if (budget < 0) return out;
    const dayTurns = side !== this.turn && side === 'att', kong = this.kongmingOn(), regional = !!this.approaches?.barriers;
    for (const u of this.alive) {
      if (u.side !== side || (only && u !== only)) continue;
      const stop = Math.max(0, (u.stop || 0) - (dayTurns && !u.stopSkipTick ? 1 : 0)), qimen = Math.max(0, (u.qimen || 0) - (dayTurns && kong ? 1 : 0));
      const from = stop || qimen ? [`${u.x},${u.y}`] : [...this.reach({ ...u, stop: 0, qimen: 0 }, budget).dist.keys()];
      for (const k of from) {
        const [x, y] = k.split(',').map(Number);
        for (const [dx, dy] of DIRS) {
          const nx = x + dx, ny = y + dy;
          if (regional ? this.deployable(nx, ny) : this.inside(nx, ny)) out.add(`${nx},${ny}`);
        }
      }
    }
    return out;
  }
  village(u) { return this.villages.find((v) => v.x === u.x && v.y === u.y); }
  // What a cell is to the player: a village (moved and judged as 平地) or its terrain's name.
  ground(x, y) {
    const gate = gateAt(this.siege, x, y);
    if (gate) return `${gate.ring === this.siege.outer ? '外' : '内'}城门（${gate.open ? '已突破' : gate.requiresCamp && !this.campSecured ? '攻方须先占守军前阵' : '封闭，攻方突破消耗＋2'}）`;
    if (wallAt(this.siege, x, y)) return '城墙（不可通行）';
    const barrier = this.approaches?.barriers?.get(`${x},${y}`);
    if (barrier) return `${barrier}（不可通行）`;
    const camp = this.siege?.camp;
    if (camp?.x === x && camp.y === y) return this.campSecured ? '守军前阵（已占领）' : '守军前阵（夺取后可攻城）';
    const village = this.villages.find(v => v.x === x && v.y === y);
    if (village) return `村落（${village.kind}）`;
    const post = this.approaches?.post;
    if (post?.x === x && post.y === y) return `前哨（驻军次日机动力＋${POST_MOBILITY}）`;
    const road = this.approaches?.roads.get(`${x},${y}`);
    if (road?.kind === 'ford') return '浅滩（可渡河，受天气影响）';
    if (road?.kind === 'plank') return '栈道（大部队行军较慢）';
    return road ? `${road.bridge ? '桥道' : '行军道'}（移动消耗减1，最低1）` : TERRAIN_NAME[this.terr(x, y)];
  }
  deployable(x,y) { return this.inside(x,y) && !wallAt(this.siege,x,y) && !this.approaches?.barriers?.has(`${x},${y}`); }
  sightBlocked(a, b) { return blockedStrategy(this.siege,a,b) || blockedTerrain(this.approaches?.barriers,a,b); }
  move(u, x, y, spent, path = [[x,y]]) {
    let breached = false;
    if (u.side === 'att') for (const [px,py] of path) { const gate = gateAt(this.siege,px,py); if (gate && !gate.open) { gate.open = true; breached = true; } }
    this.pool[u.side] -= spent; u.x = x; u.y = y;
    this.lastAmbush = this.ambushCheck(u);
    if (u.side === 'att' && !u.gone && this.siege?.camp?.x === x && this.siege.camp.y === y && !this.campSecured) {
      this.campSecured = true; breached = true;
      this.log.push('守军前阵已被攻方夺取，城门可进攻');
    }
    const [cx, cy] = this.castle();
    if (u.side === 'att' && x === cx && y === cy && (!this.siege?.camp || this.campSecured)) this.end('def', 'castle');
    return breached;
  }

  // A duel involving the human side comes back pending; the renderer runs it and calls settle().
  // 白兵 (core/tactical.js). With the human side involved it comes back pending: the renderer runs the
  // battle (player commands one side) and calls settle(); otherwise it is fought out by the AI.
  attack(a, d) {
    this.pool[a.side] -= ATTACK_COST;
    const human = this.controls(a) ? 'a' : this.controls(d) ? 'd' : null;
    const crossing = this.approaches?.roads.get(`${d.x},${d.y}`)?.kind, terrain = crossing === 'bridge' ? PLAIN : this.terr(d.x, d.y);
    const camp = this.siege?.camp;
    const tacticalSite = !this.siege || !this.approaches?.barriers ? null
      : crossing === 'bridge' || crossing === 'ford' || crossing === 'plank' ? crossing
      : camp && this.dist(d, camp) <= 3 ? 'camp'
      : siegeRing(this.siege, d) <= this.siege.outer && this.siege.type !== 'pass' ? 'streets'
      : terrain === SAND && ['island', 'coast'].includes(this.siege.type) ? 'beach' : null;
    const sceneProfile = tacticalSite ? { ...this.sceneProfile, tacticalSite } : this.sceneProfile;
    const battle = new Tactical(this.g, a.id, d.id, terrain, this.r, { human, sceneProfile,
      weather: this.weather, factions: { a: this.unitFaction(a), d: this.unitFaction(d) },
      disrupted: { a: a.disruptedUntil >= this.day, d: d.disruptedUntil >= this.day },
      bonuses: { a: this.combatPassive(a.side), d: this.combatPassive(d.side) } });
    delete a.disruptedUntil; delete d.disruptedUntil;
    const res = { battle };
    res.settle = () => { Object.assign(res, battle.result()); delete res.pending; this.applySkirmish(a, d, res); return res; };
    res.auto = () => { battle.runAuto(); return res.settle(); };
    if (human) res.pending = battle; else res.auto();
    return res;
  }
  applySkirmish(a, d, res) {
    for (const [u, by, info] of [[a, d, res.a], [d, a, res.d]]) {
      const o = this.O(u.id);
      o.soldiers = info.soldiers; o.hp = info.hp;
      if (info.fate === 'dead') { o.status = DEAD; u.gone = true; u.fate = 'dead'; }
      if (info.fate === 'captured') this.captureUnit(u, by, info.spared);
    }
    for (const [u, by, info] of [[a, d, res.a], [d, a, res.d]]) if (info.fate === 'defected') {
      const oldSide = u.side, wasCommander = u.commander;
      const faction = this.joinUnitSide(u, by, true), ruler = this.g.factions[faction]?.ruler;
      const o = this.O(u.id);
      if (ruler != null) o.loyalty = recruitLoyaltyWithRelation(data(), this.g, faction, u.id, recruitLoyalty(this.O(ruler).virtue, o.loyalty));
      if (wasCommander) this.end(oldSide, 'commander');
    }
    this.checkCommanders();
  }
  joinUnitSide(u, by, resetRole = false) {
    const modern = this.war.support || fullStrategyWeather(this.g);
    if (modern && this.ambush?.[u.side]?.u === u) this.ambush[u.side] = null;
    if (modern || resetRole) {
      u.home = 4;
      delete u.mission; delete u.aiDetour;
    }
    u.side = by.side; u.role = 4; u.commander = false;
    if (this.war.support && u.side === 'def') u.supporting = this.isSupporting(by);
    else delete u.supporting;
    return this.unitFaction(u);
  }
  captureUnit(u, by, protectedRuler) {
    u.gone = true; u.fate = 'captured'; u.capturedBy = by.side;
    if (this.isSupporting(by)) u.capturedForSupport = true;
    if (protectedRuler) u.spared = true;
  }
  // 武将不战死 keeps a ruler from being lost to an overflow after the war: an AI ruler 退却s only to a city with room,
  // the AI's own 退却 city first, else any own or empty neighbour.
  roomTargets(u) {
    const g = this.g, f = this.faction(u.side);
    const ok = (c) => (g.cities[c].faction === f || g.cities[c].faction === NONE) && this.headcount(c) < 10;
    return [...new Set([...this.retreatTargets(u), ...roads(this.war.city)])].filter(ok);
  }
  // A city's officers as the war stands: those who retreated to it have reached it (`$BC2A`), though they join its
  // list only when the war is settled. The room check and the 退却 map both go by this.
  headcount(c) { return this.g.cities[c].officers.length + this.units.filter((x) => x.fate === 'retreat' && x.to === c).length; }
  checkCommanders() {
    if (this.over) return;
    const lost = (s) => !this.units.some((u) => u.side === s && u.commander && !u.gone);
    if (lost('def')) this.end('def', 'commander');
    else if (lost('att')) this.end('att', 'commander');
  }

  // Retreat destinations. The player's 退却 menu (`bank12:$BB84`, M p37/48) offers every city on a road from
  // the battlefield that is the side's own or empty, attacker or defender alike — an attacker need not go
  // home. The AI (6.8 §4) is narrower: an attacker always heads for its source city; a defender takes its
  // own neighbour with room, else the last neutral one. The original moves a retreating unit into its city
  // at once (`$BC2A`), so units that already left for a city during this war count against its 10-officer room.
  // AI (`AF0D`): the attacker's source city is not checked for room; an overflow is settled after the war.
  retreatTargets(u) {
    if (this.war.raid && u.side === 'att') return []; // 临时敌军不能退入、占领任何城市。
    if (this.isSupporting(u)) {
      const { city, faction } = this.war.support;
      return this.g.cities[city].faction === faction && this.headcount(city) < 10 ? [city] : [];
    }
    const g = this.g, f = this.faction(u.side);
    const room = (c) => this.headcount(c) < 10;
    const ok = (c) => (g.cities[c].faction === f || g.cities[c].faction === NONE) && room(c);
    if (this.controls(u)) return roads(this.war.city).filter(ok);
    if (u.side === 'att') return [this.war.from];
    const near = roads(this.war.city), own = near.find((c) => g.cities[c].faction === f && room(c));
    if (own != null) return [own];
    const empty = near.filter((c) => g.cities[c].faction === NONE);
    return empty.length ? [empty[empty.length - 1]] : [];
  }
  retreat(u, city) {
    u.gone = true; u.fate = 'retreat'; u.to = city;
    const c = this.g.cities[city];
    if (c.faction === NONE) c.faction = this.faction(u.side); // empty city is taken at once (6.10 §1)
    if (u.commander) { this.commanderRetreat = { side: u.side, city }; this.end(u.side, 'retreat'); }
    else this.checkCommanders();
  }

  // Field services (6.7 §5–6). Hospital: 50 gold, +35..45 HP up to the template. Rice shop: buy q rice.
  hospital(u) {
    const ch = this.chest(u.side), o = this.O(u.id);
    if (ch.gold < 50) return '军资金不足';
    ch.gold -= 50; const before = o.hp; o.hp = Math.min(maxHp(o), o.hp + 35 + this.r(11));
    return `体力 +${o.hp - before}`;
  }
  // Field weapon shop (村落 slot 1, `$9BA4`): the battle city's own field stock (`$C525`, not the city
  // shop), paid from the side's war gold; 狼牙枪/圣者之衣 need 武力/人德 90 on this path.
  shopStock() { return equipmentStock(this.g, this.war.city, 'field_shop').map((e) => data().equipment[e]); }
  buyEquip(u, eq) {
    if (this.village(u)?.kind !== '武器店' || !equipmentStock(this.g, this.war.city, 'field_shop').includes(eq)) return { ok: false, msg: '此处不卖' };
    const block = equipBlock(this.g, u.id, eq, { field: true }), e = data().equipment[eq], ch = this.chest(u.side);
    if (block) return { ok: false, msg: `${e.name}：${block}` };
    if (ch.gold < e.price) return { ok: false, msg: '军资金不足' };
    ch.gold -= e.price;
    return { ok: true, msg: wearEquip(this.g, u.id, eq) };
  }
  buyRice(u, q) {
    const ch = this.chest(u.side), b = data().cities[this.war.city].rice_rate[1];
    if (!b) return '无法买米';
    q = Math.min(q, Math.floor((ch.gold * b) / 100), 9999 - ch.rice);
    if (q <= 0) return '军资金不足';
    ch.gold -= Math.floor((q * 100) / b); ch.rice += q;
    return `买米 ${q}`;
  }
  // 卖米 at the same shop (bank9 `$C0BB` state 2 → `$C2C0`, settled at `$C2F2`): q rice leaves the side's 军粮 and
  // floor(q × s / 100) gold joins its 军资金, capped at 9999 (research/war-maps-movement-evidence.md §5). s is the city's
  // selling rate, the first byte of its pair; buying uses the second.
  sellRice(u, q) {
    const ch = this.chest(u.side), s = data().cities[this.war.city].rice_rate[0];
    if (!s || this.village(u)?.kind !== '米店') return '无法卖米';
    q = Math.min(q, ch.rice);
    if (!(q > 0)) return '军粮不足';
    ch.rice -= q; ch.gold = Math.min(9999, ch.gold + Math.floor((q * s) / 100));
    return `卖米 ${q}`;
  }

  // ---------- 计略 ----------
  dist(a, b) { return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }
  adjacent(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1; }
  enemyNeighbours(t, pred = () => true) { return DIRS.map(([dx, dy]) => this.unitAt(t.x + dx, t.y + dy)).filter((e) => e && e.side === t.side && pred(e)); }
  // 守方行动结束会先换日；比较实际剩余的目标回合，而不是直接比较计数器。
  stopTurnsWhenNext(t) {
    const tick = this.turn === 'def' && t.side === 'att' && !t.stopSkipTick;
    return Math.max(0, (t.stop || 0) - (tick ? 1 : 0));
  }
  strategies(u) {
    const o = this.O(u.id);
    const normal = STRATS.slice(0, stratCount(u.id, o, this.g));
    if (advancedBattle(this.g)) {
      return [...normal, ...(o.int >= 65 ? [STRATS[PINCER]] : []), ...(o.int >= 82 ? [STRATS[DISRUPT]] : [])];
    }
    const custom = abilityStrategyIds(data(), this.g, u.id).map((id) => STRATS[id]).filter((s) => s?.custom);
    return [...normal, ...custom];
  }
  passive(u) { return officerPassive(data(), this.g, u.id); }
  strategyWeather(u, id) {
    const [hit, scale] = tacticWeather(this.g, id, this.weather);
    if (!hit && scale === 100) return '';
    if (this.passive(u)?.weatherproof) return `${WEATHER_NAMES[this.weather]}天 · 观天免疫`;
    const effects = [
      hit ? `命中阈值 ${hit > 0 ? '+' : '−'}${Math.abs(hit)}` : '',
      scale !== 100 ? `${id === 11 ? '伏兵损兵' : id === 5 ? '烧粮量' : '损兵'} ×${scale}%` : '',
    ].filter(Boolean);
    return `${WEATHER_NAMES[this.weather]}天 · ${effects.join('，')}`;
  }
  strategyLimit(u, id) { return advancedBattle(this.g) && [PINCER, DISRUPT].includes(id) ? 4 : 6 + (this.passive(u)?.range ?? 0); }
  get fortifiedDefense() { return this.siege?.revision >= 2 && this.g.siegeTactics === true; }
  defendingFromGate(u, id, t) {
    return this.fortifiedDefense && u.side === 'def' && t?.side === 'att' && GATE_STRATEGIES.includes(id)
      && !!gateDefense(this.siege, u, t);
  }
  strategyWhere(u, id) {
    const where = STRAT_INFO[id].where;
    if (!this.fortifiedDefense || u.side !== 'def' || !GATE_STRATEGIES.includes(id)) return where;
    return `${where}；闭门迎击${id === 9 || id === 13 ? '须站门格，目标紧邻门口' : '须站门格或门后第一格，目标在正前方两格内'}`;
  }
  strategyObstruction(u, t, tower) {
    const obstacle = strategyTerrainObstacle(this.approaches?.barriers, u, t);
    if (obstacle) return `${obstacle}阻隔计略`;
    return !tower && blockedStrategy(this.siege, u, t) ? '城墙或封闭城门阻隔计略' : null;
  }
  // Terrain/adjacency gate `$AD80` plus distance <6; target null for 十面埋伏.
  legal(u, id, t) {
    if (id === 8 && (this.war.raid || this.unitFaction(u) !== this.faction(u.side))) return false;
    const T = (v) => this.unitTerrain(v.x, v.y);
    if (id === 11) return T(u) === FOREST && this.O(u.id).soldiers >= 100 && !this.ambush?.[u.side];
    if (!t || t.gone || t.side === u.side || this.dist(u, t) >= this.strategyLimit(u, id)) return false;
    const tower = this.defendingFromGate(u, id, t);
    if (this.strategyObstruction(u, t, tower)) return false;
    if (advancedBattle(this.g)) {
      if (id === PINCER) return this.adjacentEnemies(t).some(v => v !== u && this.O(v.id).soldiers > 0 && !this.sightBlocked(v, t));
      if (id === DISRUPT) return this.O(t.id).soldiers > 0 && !(t.disruptedUntil >= this.day);
    }
    if (STRATS[id]?.custom) return true;
    switch (id) {
      case 0: return T(t) === FOREST || T(t) === PLAIN;
      case 1: case 2: case 3: return T(t) === FOREST || T(t) === MOUNT;
      case 4: return T(t) === RIVER;
      case 5: return t.commander;
      case 6: return T(t) === CASTLE && this.adjacent(u, t);
      case 7: return (T(t) === FOREST || T(t) === MOUNT) && this.enemyNeighbours(t).length > 0;
      case 8: return T(t) !== CASTLE;
      case 9: return (tower || T(u) === MOUNT || T(u) === CASTLE) && this.adjacent(u, t) && T(t) !== CASTLE;
      case 10: case 12: return T(t) === RIVER && this.enemyNeighbours(t, (e) => T(e) === RIVER).length > 0;
      case 13: return (tower || T(u) === CASTLE) && this.adjacent(u, t);
      case 14: return T(t) !== CASTLE && this.enemyNeighbours(t, (e) => T(e) !== CASTLE).length > 0;
      case 15: return T(t) !== RIVER && T(t) !== CASTLE;
    }
    return false;
  }
  // 选目标时说明这名敌将身上的限制，名单仍只展示可选目标。
  whyNotTarget(u, id, t) {
    if (!t || t.gone || t.side === u.side || id === 11 || this.legal(u, id, t)) return null;
    const distance = this.dist(u, t), limit = this.strategyLimit(u, id) - 1;
    if (distance > limit) return `超出计略范围（距离 ${distance} 格，上限 ${limit} 格）`;
    const obstacle = this.strategyObstruction(u, t, this.defendingFromGate(u, id, t));
    if (obstacle) return obstacle;
    if (advancedBattle(this.g) && id === PINCER) return '夹攻需要另一名有兵友军在目标身旁协同';
    if (advancedBattle(this.g) && id === DISRUPT) return this.O(t.id).soldiers > 0 ? '目标已被破阵' : '目标当前无兵';
    return '当前站位或地形不符合计略条件';
  }
  // Why this unit cannot cast this 计略 now, in words, or null when he can: the mobility, a condition on his own
  // place (十面埋伏, 落石, 连弩), else no foe within reach that meets the 计略's condition.
  whyNot(u, id) {
    const S = STRATS[id], T = this.unitTerrain(u.x, u.y), o = this.O(u.id);
    if (this.war.raid && id === 8) return '守城袭扰中不能收编敌军';
    if (id === 8 && this.unitFaction(u) !== this.faction(u.side)) return '同盟援军无法收编敌军';
    if (S.custom && S.maxUses && (u.skillUses?.[id] ?? 0) >= S.maxUses) return '本场使用次数已用完';
    if (this.pool[u.side] < S.cost) return `机动力不足（需 ${S.cost}，剩 ${this.pool[u.side]}）`;
    if (id === 11) return T !== FOREST ? '需自己位于森林' : o.soldiers < 100 ? '兵数不足100' : this.ambush?.[u.side] ? '我军已设下伏兵' : this.legal(u, 11) ? null : '现在无法施展';
    if (this.side(u.side === 'att' ? 'def' : 'att').some((e) => this.legal(u, id, e))) return null;
    if (this.fortifiedDefense && u.side === 'def' && GATE_STRATEGIES.includes(id) && gateAt(this.siege, u.x, u.y)) return '城门迎击只对门口正前方近敌生效';
    if (id === 9 && T !== MOUNT && T !== CASTLE) return '需自己位于山地或城中';
    if (id === 13 && T !== CASTLE) return '需自己位于城中';
    const near = this.side(u.side === 'att' ? 'def' : 'att').filter(e => this.dist(u,e) < this.strategyLimit(u,id));
    for (const e of near) {
      const obstacle = this.strategyObstruction(u, e, this.defendingFromGate(u, id, e));
      if (obstacle) return `${obstacle}，请调整站位`;
    }
    return `${this.strategyLimit(u,id) - 1}格内没有符合条件的敌军（${STRAT_INFO[id].where.replace(/^自己在[^，]*，/, '')}）`;
  }
  hitChance(u, t, id) {
    const d = this.dist(u, t); if (d >= this.strategyLimit(u, id)) return 0;
    const a = this.O(u.id), b = this.O(t.id);
    const D = advancedBattle(this.g) || this.controls(u) || !this.human ? 10 : [5, 10, 20][this.g.level];
    const passive = this.passive(u), [weather] = tacticWeather(this.g, id, this.weather, passive);
    let s = 15 - 5*d + Math.max(a.int - b.int, 0) + 2 * Math.max(a.level - b.level, 0) + D
      + strategyBonus(passive, id) - strategyWard(this.passive(t), id) + weather + aiBattleBonus(this.g, this.unitFaction(u));
    // 新局按完整数值封顶；没有标记的原版与旧记录保留原作的 8 位判定。
    if (this.g.safeStrategyChance !== true) { s &= 255; if (s & 128) s = 0; }
    const throughGate = this.defendingFromGate(u, id, t);
    const cap = throughGate ? 75 : 95;
    return this.passiveChance(Math.min(cap, Math.max(5, s - (throughGate ? 10 : 0))), u.side, cap);
  }
  // 原版随机表并非均匀分布，按实际概率限制增益而非简单增加判定阈值。
  passiveChance(base, side, limit) {
    const bonus = this.combatPassive(side)?.strategy ?? 0, chance = realChance(base);
    let result = base;
    while (result < limit && realChance(result + 1) - chance <= bonus) result++;
    return result;
  }
  lureChance(u, t) {
    const a = this.O(u.id), b = this.O(t.id);
    if (this.dist(u, t) >= this.strategyLimit(u, 8) || b.loyalty >= 71) return 0;
    let base = (b.loyalty <= 30 ? 60 : b.loyalty <= 50 ? 30 : 10) + Math.floor(((a.int + a.virtue) & 255) / 10) + 2 * Math.max(a.level - b.level, 0);
    if (fullStrategyWeather(this.g)) {
      const passive = this.passive(u), [weather] = tacticWeather(this.g, 8, this.weather, passive);
      base = Math.min(95, Math.max(5, base + weather + strategyBonus(passive, 8)
        - strategyWard(this.passive(t), 8) + aiBattleBonus(this.g, this.unitFaction(u))));
    }
    return recruitThreshold(data(), this.g, this.unitFaction(u), t.id, this.passiveChance(base, u.side, 100), this.unitFaction(t));
  }
  // What the player is told: the chance the cast really has. hitChance / lureChance are the numbers the roll is
  // compared with; the original's roll (core/origrng.js) comes under them more often than that many times in 100.
  odds(u, id, t) { return Math.round(realChance(id === 8 ? this.lureChance(u, t) : this.hitChance(u, t, id))); }
  // Connected enemy component from t (right,left,down,up), castles excluded (`$B8A1`).
  component(t) {
    const out = [t], seen = new Set([t]);
    for (let i = 0; i < out.length; i++) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = this.unitAt(out[i].x + dx, out[i].y + dy);
      if (n && n.side === t.side && !seen.has(n) && this.terr(n.x, n.y) !== CASTLE) { seen.add(n); out.push(n); }
    }
    return out;
  }
  // Whether the side to move may cast this 计略 now: one the unit knows, the mobility it costs still in the pool,
  // a legal target. The original admits a 计略 by its cost before it runs; a menu opened earlier does not count.
  canCast(u, id, t) {
    const skill = STRATS[id];
    return !!skill && !!u && !u.gone && !this.over && u.side === this.turn && this.pool[u.side] >= skill.cost
      && !(skill.custom && skill.maxUses && (u.skillUses?.[id] ?? 0) >= skill.maxUses)
      && this.strategies(u).some((s) => s.id === id) && (id === 11 ? this.legal(u, 11) : this.legal(u, id, t));
  }
  // 每次仍调用原有施计逻辑；中途目标或战场状态变化时立即停止。
  castMany(u, id, t, count) {
    const results = [], max = Math.max(1, Math.min(100, Math.floor(count) || 1));
    for (let i = 0; i < max && this.canCast(u, id, t); i++) {
      if (i && t && this.O(t.id).soldiers <= 0) break;
      const result = this.cast(u, id, t); if (!result.ok) break;
      results.push(result);
      if (result.hit && ([2, 10, 11, 15].includes(id) || (STRATS[id].custom && (STRATS[id].stop > 0 || this.conditionalSkill(STRATS[id], u, t).stop > 0)))) break;
    }
    return results;
  }
  conditionalSkill(skill, caster, target) {
    if (this.g.campaignRules !== true) return { soldiers: 0, stop: 0, rice: 0 };
    const commander = this.side(caster.side).find((unit) => unit.commander);
    return {
      soldiers: skill.effectProfile === 'fortress' && this.terr(caster.x, caster.y) === CASTLE ? 25 : 0,
      stop: skill.effectProfile === 'frontier' && commander && Math.abs(commander.x - target.x) + Math.abs(commander.y - target.y) <= 2 ? 1 : 0,
      rice: skill.effectProfile === 'interdict' && this.O(target.id).soldiers >= 400 ? 30 : 0,
    };
  }
  cast(u, id, t, ai = false) {
    const S = STRATS[id], r = this.r, a = this.O(u.id), U = (n) => r(n), lines = [], hits = [];
    const obstacle = t && strategyTerrainObstacle(this.approaches?.barriers, u, t);
    if (obstacle) return { ok:false, hit:false, name:S.name, lines:[`${obstacle}阻隔计略`], hits };
    if (t && blockedStrategy(this.siege,u,t) && !(this.defendingFromGate(u, id, t) && this.legal(u, id, t))) return { ok:false, hit:false, name:S.name, lines:['城墙阻隔计策'], hits };
    if (S.custom && S.maxUses && (u.skillUses?.[id] ?? 0) >= S.maxUses) return { ok: false, hit: false, name: S.name, lines: ['本场使用次数已用完'], hits };
    if (!ai && !this.canCast(u, id, t)) return { ok: false, hit: false, name: S.name, lines: [this.pool[u.side] < S.cost ? '机动力不足' : `无法施展${S.name}`], hits };
    this.pool[u.side] = Math.max(0, this.pool[u.side] - (ai ? S.ai : S.cost));
    if (S.custom && S.maxUses) (u.skillUses ||= {})[id] = (u.skillUses[id] ?? 0) + 1;
    // Each general hurt pays at once: `$B68B` adds his loss to the cast's running total and hands that total to `$D7FB`, which
    // halves it into the caster's experience and checks his level, one level a call. So a cast on several may raise him more than
    // once, and the effects read his level anew for every target (`$B070`, `$B1E3`: record byte 0B), as L() does.
    let acc = 0;
    const L = () => a.level - 1;
    const passive = this.passive(u), [, effect] = tacticWeather(this.g, id, this.weather, passive);
    const bonus = [0, 6, 7, 14].includes(id) ? passive?.fire ?? 0 : [4, 12].includes(id) ? passive?.water ?? 0 : 0;
    const scale = (100 + bonus) * effect;
    const loss = (v, n) => { const o = this.O(v.id), d = Math.min(o.soldiers, Math.max(0, Math.floor(n * scale / 10000))); o.soldiers -= d; acc += d; addExp(this.g, u.id, Math.floor(acc / 2)); hits.push({ u: v, soldiers: -d }); lines.push(`${nm(v)} 损兵 ${d}`); };
    const hp = (v, n) => { const o = this.O(v.id), d = Math.min(o.hp, Math.max(0, n)); o.hp -= d; hits.push({ u: v, hp: -d }); lines.push(`${nm(v)} 体力 −${d}`); if (o.hp <= 0) fall(v); };
    // 不战死保护的被俘结果记录在单位上，战斗中切换选项或中断后仍然有效。
    const fall = (v) => {
      const o = this.O(v.id);
      const raidSpared = this.war.raid && v.side === 'def' && !isRuler(this.g, v.id);
      if (!spared(this.g) && !raidSpared) { o.status = DEAD; v.gone = true; v.fate = 'dead'; lines.push(`${nm(v)} 阵亡`); return; }
      o.hp = sparedHp(this.g, v.id); this.captureUnit(v, u, isRuler(this.g, v.id)); lines.push(`${nm(v)} 被擒`);
    };
    const nm = (v) => data().officers[v.id].name;
    const fire = (v) => loss(v, ((Math.floor((a.int * (9 + U(5))) / 10) + 10 * L()) & 255) + 30);
    if (id === 11) {
      a.soldiers -= 100; (this.ambush ||= {})[u.side] = { u, x: u.x, y: u.y, days: 5 };
      return { ok: true, hit: true, name: S.name, lines: [`${nm(u)} 在林中设下伏兵`], hits };
    }
    const p = id === 8 ? this.lureChance(u, t) : this.hitChance(u, t, id);
    if (roll100(r) >= p) return { ok: true, hit: false, name: S.name, lines: [`${S.name}失败`], hits };
    if (S.custom) {
      const extra = this.conditionalSkill(S, u, t), stop = Math.min(10, S.stop + extra.stop);
      if (S.soldiers || extra.soldiers) loss(t, S.soldiers + extra.soldiers);
      if (advancedBattle(this.g) && id === DISRUPT) { t.disruptedUntil = this.day + 1; lines.push(`${nm(t)} 阵形被打乱`); }
      if (S.hp) hp(t, S.hp);
      if (stop && !t.gone) {
        if (stop > this.stopTurnsWhenNext(t)) {
          t.stop = stop; t.stopBy = S.name;
          // 守方施放后立即换日，但目标尚未行动，首次换日不消耗限制天数。
          if (u.side === 'def') t.stopSkipTick = true; else delete t.stopSkipTick;
          lines.push(`${nm(t)} 无法移动 ${stop} 日`);
        } else lines.push(`${nm(t)} 保持原有移动限制`);
      }
      if (S.rice || extra.rice) {
        const ch = this.chest(t.side), amount = Math.min(ch.rice, S.rice + extra.rice);
        ch.rice -= amount; hits.push({ u: t, rice: -amount }); lines.push(`烧毁敌军米 ${amount}`);
      }
      this.checkCommanders();
      return { ok: true, hit: true, name: S.name, lines, hits };
    }
    switch (id) {
      case 0: case 6: fire(t); break;
      case 1: hp(t, Math.floor((L() + Math.floor(((a.war + a.int) & 255) / 10)) * (5 + U(3)) / 10)); break;
      case 2: t.stop = u.side === 'def' ? 2 : 3; t.stopBy = '虚兵'; delete t.stopSkipTick; lines.push(`${nm(t)} 中了虚兵之计，无法移动`); break;
      case 3: loss(t, Math.floor((a.war * (14 + U(7))) / 10)); break;
      case 4: loss(t, Math.floor((a.int * (20 + U(7))) / 10) + L() + 7); break;
      case 5: {
        const ch = this.chest(t.side), base = Math.floor((ch.rice * (10 + U(5))) / 100) + Math.floor(a.int / 5);
        const d = Math.min(ch.rice, Math.floor(base * effect / 100));
        ch.rice -= d; hits.push({ u: t, rice: -d }); lines.push(`烧毁敌军米 ${d}`); break;
      }
      case 7: fire(t); for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { const n = this.unitAt(t.x + dx, t.y + dy); if (n && n.side === t.side && !this.sightBlocked(u,n)) fire(n); } break;
      case 8: {
        const faction = this.joinUnitSide(t, u), o = this.O(t.id), ruler = this.g.factions[faction].ruler;
        o.loyalty = recruitLoyaltyWithRelation(data(), this.g, faction, t.id, recruitLoyalty(this.O(ruler).virtue, o.loyalty));
        lines.push(`${nm(t)} 倒戈投向我军`); break;
      }
      case 9: hp(t, Math.floor((L() + Math.floor(((a.war + a.int) & 255) / 10)) * (5 + U(3)) / 10)); if (!t.gone) loss(t, Math.floor((a.war * (14 + U(7))) / 10)); break;
      case 10: for (const v of this.component(t)) if (!this.sightBlocked(u,v) && this.unitTerrain(v.x, v.y) === RIVER) { v.stop = 3 + U(2) + (u.side === 'att' ? 1 : 0); v.stopBy = '连环'; delete v.stopSkipTick; lines.push(`${nm(v)} 被连环锁住`); } break;
      case 12: for (const v of this.component(t)) if (!this.sightBlocked(u,v) && this.unitTerrain(v.x, v.y) === RIVER) loss(v, Math.floor((a.int * (20 + U(7))) / 10) + L() + 7); break;
      case 13: loss(t, 150 + U(200) + Math.floor(((a.war + a.int) & 255) / 2)); break;
      case 14: for (const v of this.component(t)) if (!this.sightBlocked(u,v)) loss(v, Math.floor((a.int * (30 + U(6))) / 10)); break;
      case 15: t.qimen = 5 + (r(256) & 3) + (u.side === 'att' ? 1 : 0); lines.push(`${nm(t)} 陷入奇门遁甲`); break;
    }
    this.checkCommanders();
    return { ok: true, hit: true, name: S.name, lines, hits };
  }
  // 十面埋伏 trigger after a move ends (`$B933`): radius 2 around the ambush, target on forest.
  ambushCheck(mover) {
    const foe = mover.side === 'att' ? 'def' : 'att', am = this.ambush?.[foe];
    if (!am || am.u.gone || this.terr(mover.x, mover.y) !== FOREST || this.dist(mover, am) > 2) return null;
    if (fullStrategyWeather(this.g) && this.sightBlocked(am, mover)) return null;
    const a = this.O(am.u.id), raw = (((a.level - 1) << 4) | (ARMY_IDX[a.army] << 2)) & 255;
    const x = (raw * 8) & 255, b = x + raw, offset = (b + raw + (b >= 256 ? 1 : 0)) & 255;
    this.r(101);
    const base = Math.floor((a.int * (30 + this.r(11))) / 10) + offset;
    const [, scale] = tacticWeather(this.g, 11, this.weather, this.passive(am.u));
    const d = Math.min(this.O(mover.id).soldiers, Math.floor(base * scale / 100));
    this.O(mover.id).soldiers -= d; this.ambush[foe] = null; addExp(this.g, am.u.id, Math.floor(d / 2));
    return { by: am.u, damage: d };
  }

  // End of a side's turn (待机). After the defender: recover, day+1, ≥31 attacker loses, then rice.
  endTurn() {
    if (this.over) return;
    if (this.turn === 'att') { this.turn = 'def'; return; }
    this.recover(); this.day++; this.turn = 'att';
    if (this.day > MAX_DAY) return this.end('att', 'timeout');
    for (const s of ['att', 'def']) {
      const ch = this.chest(s), use = passiveRiceUse(Math.floor((this.troops(s) * 4) / 1000), { combat: this.combatPassive(s) });
      ch.rice = Math.max(0, ch.rice - use);
      if (ch.rice <= 0) return this.end(s, 'rice'); // a zero balance runs out even when the day's use is 0
    }
    // Day tick (bank9 $CE40): 虚兵/连环 counters; 奇门 only while 诸葛亮 (109) is on the field, whichever side he is on.
    // $CE94 adds the low byte of each target's soldiers left into a 16-bit sum; $D7FB halves it into 诸葛亮's experience.
    const kongming = this.kongmingOn(), qimen = [];
    let sum = 0;
    for (const u of this.alive) {
      if (u.stop && !u.stopSkipTick) u.stop--;
      delete u.stopSkipTick;
      if (u.qimen && kongming) {
        u.qimen--; let v; do v = this.r(256); while (v >= 71);
        const o = this.O(u.id), d = Math.min(o.soldiers, 80 + v); o.soldiers -= d;
        qimen.push({ u, loss: d }); sum += o.soldiers & 255;
      }
    }
    if (qimen.length) addExp(this.g, 109, Math.floor(sum / 2));
    for (const s of ['att', 'def']) { const am = this.ambush?.[s]; if (am && --am.days <= 0) this.ambush[s] = null; }
    return { qimen };
  }
  kongmingOn() { return !advancedBattle(this.g) && this.alive.some((u) => u.id === 109); }
  end(loser, why) { if (!this.over) this.over = { loser, why }; }

  // Build the write-back record for warcore.resolveWar.
  result() {
    const surv = { att: [], def: [] }, captured = { byAtt: [], byDef: [] }, dead = [], retreated = [], sparedRulers = [];
    const supportSurvivors = [], supportCaptures = [];
    for (const u of this.units) {
      if (u.fate === 'dead') dead.push(u.id);
      else if (u.fate === 'captured') {
        captured[u.capturedBy === 'att' ? 'byAtt' : 'byDef'].push(u.id);
        if (u.spared) sparedRulers.push(u.id);
        if (u.capturedForSupport) supportCaptures.push(u.id);
      } else {
        if (u.fate === 'retreat') retreated.push({ id: u.id, city: u.to });
        surv[u.side].push(u.id);
        if (this.isSupporting(u)) supportSurvivors.push(u.id);
      }
    }
    // The losing side's units still on the field are not captured here: the settlement queue (`bank8:$BDCD`)
    // takes them back with their own side, and only 白兵/单挑 produce prisoners (`$C766` code 3). The
    // draw100 ≥ loyalty lottery belongs to the auto battle only; using it here turned a day-31 timeout into
    // a mass capture of untouched officers.
    const loser = this.over.loser;
    this.war.day = this.day; // the occupation-loss tier in resolveWar reads the war's elapsed days
    return { loser, survivors: surv, dead, captured, retreated, chests: { att: this.war.att, def: this.war.def },
      ...(sparedRulers.length ? { sparedRulers } : {}), ...(this.war.support ? { supportSurvivors, supportCaptures } : {}) };
  }

  // ---------- War AI (6.8) ----------
  // Returns a list of actions performed so the renderer can animate them: {type:'move',u,path,cost}|{type:'attack',a,d,res}|{type:'retreat',u,city}
  // Role adjustment before acting (6.8 §6). Missions: 5 buy rice, 6 seek the hospital; a finished
  // mission (7) restores the saved role. Gold is only reserved (100 per rice run, 50 per hospital run).
  adjustRoles(s) {
    const foe = s === 'att' ? 'def' : 'att', need = (x) => Math.floor((this.troops(x) * 4) / 1000), left = MAX_DAY - this.day;
    const units = this.side(s), mine = units.filter((u) => !u.commander), ch = this.chest(s);
    for (const u of units) if (u.mission?.done) { u.role = u.mission.home; u.mission = null; }
    const missions = (k) => units.filter((u) => u.mission?.kind === k);
    for (;;) {
      const reserve = missions('rice').length * 100 + missions('heal').length * 50;
      if (reserve <= ch.gold) break;
      const drop = missions('heal')[0] || missions('rice')[0];
      drop.role = drop.mission.home; drop.mission = null;
    }
    const full = (u) => !u.mission && u.role >= 1 && u.role <= 4;
    const myRice = ch.rice, foeRice = this.chest(foe).rice;
    if (myRice >= need(s) * left && foeRice < need(foe) * left && foeRice < need(foe) * 5) { for (const u of mine) if (full(u) && (u.role === 1 || u.role === 2)) u.role = 4; return; }
    const shop = this.villages.find((v) => v.kind === '米店'), hospital = this.villages.find((v) => v.kind === '病院');
    const garrison = s === 'def' && this.fortifiedDefense;
    if (myRice < need(s) * (garrison ? Math.min(left, 4) : left) && shop && ch.gold >= 100) {
      if (!missions('rice').length) {
        const pick = [2, 4, 1, 3].map((role) => mine.find((u) => full(u) && u.role === role)).find(Boolean);
        if (pick) { pick.mission = { kind: 'rice', x: shop.x, y: shop.y, home: pick.role }; pick.role = 5; }
      }
    } else if (myRice < need(s) * 10) { for (const u of mine) if (full(u)) u.role = 1; return; }
    if (!garrison && hospital && ch.gold >= 50 && missions('heal').length < 2) {
      for (const u of mine) {
        if (missions('heal').length >= 2) break;
        if (full(u) && this.O(u.id).hp < Math.floor(maxHp(this.O(u.id)) * 0.6)) { u.mission = { kind: 'heal', x: hospital.x, y: hospital.y, home: u.role }; u.role = 6; }
      }
    }
    if (this.troops(foe) < 1000 && this.troops(s) >= 5000) for (const u of mine) if (full(u)) u.role = 1;
  }
  // Mission arrival (6.8 §7): settled when the planned landing is within ±1 of the facility, before moving.
  missionAct(u) {
    const m = u.mission, ch = this.chest(u.side), r = this.r;
    const arrive = Math.abs(u.x - m.x) <= 1 && Math.abs(u.y - m.y) <= 1;
    if (!arrive) return this.approach(u, m) || null;
    const log = [];
    if (m.kind === 'rice') {
      const price = data().cities[this.war.city].rice_rate[1] || 1, need = Math.floor((this.troops(u.side) * 4) / 1000), left = MAX_DAY - this.day;
      const cap = Math.floor((ch.gold * 7) / 10), gap = (need * left - ch.rice) & 65535, cost = Math.floor((gap * 100) / price);
      if (ch.gold >= cost) { ch.gold -= cost; ch.rice += gap; log.push(`买米 ${gap}`); }
      else { ch.gold -= cap; const got = Math.floor((cap * price) / 100); ch.rice += got; log.push(`买米 ${got}`); }
    } else if (ch.gold >= 50) {
      ch.gold -= 50; let v; do v = r(256) & 15; while (v >= 11);
      const o = this.O(u.id), before = o.hp; o.hp = Math.min(maxHp(o), o.hp + 35 + v); log.push(`治疗 体力+${o.hp - before}`);
    }
    m.done = true; u.role = 7;
    return { type: 'mission', u, kind: m.kind, log };
  }
  // Dispatcher (`bank8:$A02D`, 6.8 §9): roles are adjusted once as the side's day begins (`$BE67`), then
  // the side's slots are scanned in slot order (commander first) and every non-wait decision is one action
  // (a move is a single cell), after which the scan continues from the next slot. A scan that reaches the
  // last slot starts over unless every unit in it waited, which ends the side's day. Units thus take turns
  // one action at a time, so the commander is not left with whatever mobility his officers did not walk off.
  *aiActions(s, only = null) {
    if (!only) this.adjustRoles(s);
    const slots = this.units.filter((u) => u.side === s && (!only || only(u)));
    for (let pass = 0; pass < 400; pass++) {
      let acted = false;
      for (const u of slots) {
        if (this.over || u.gone || u.side !== s) continue;
        const act = this.aiDecide(u);
        if (!act) continue;
        acted = true; yield act;
        if (this.over) return;
      }
      if (!acted) return;
    }
  }
  aiDecide(u) {
    const o = this.O(u.id), s = u.side, foe = s === 'att' ? 'def' : 'att', isRuler = this.g.factions[this.unitFaction(u)]?.ruler === u.id;
    // Retreat check (first matching identity only).
    let flee = false;
    if (isRuler) flee = o.soldiers < 301 && o.hp < 51;
    else if (u.commander) flee = (this.troops(s) < 1757 && this.troops(s) + 3499 < this.troops(foe)) || (o.soldiers < 101 && o.hp < 41);
    else flee = o.soldiers < 201 && o.hp < 100 && this.r(100) < 70;
    // Under 武将不战死 a ruler retreats only where there is room (roomTargets): the AI's own 退却 city is not
    // checked, and an overflow there turns him 下野 after the war.
    if (flee) { const [city] = isRuler && this.g.noWarDeath ? this.roomTargets(u) : this.retreatTargets(u); if (city != null) { this.retreat(u, city); return { type: 'retreat', u, city }; } }
    if (u.mission && !u.mission.done) return this.missionAct(u);
    if (u.role === 7) return null;
    const { siege } = this;
    const guardingCamp = s === 'def' && this.fortifiedDefense && siege.revision >= REGIONAL_LAYOUT_REVISION
      && siege.camp && !this.campSecured && !u.commander && siegeRing(siege, u) > siege.outer;
    if (guardingCamp) {
      const action = this.guardCamp(u);
      if (action) return action;
    }
    const adj = this.adjacentEnemies(u);
    const commanderFoe = this.side(foe).find((e) => e.commander);
    let custom = null;
    for (const skill of this.strategies(u).filter((item) => item.custom)) {
      if (this.pool[s] < skill.cost || (skill.maxUses && (u.skillUses?.[skill.id] ?? 0) >= skill.maxUses)) continue;
      for (const target of this.side(foe).filter((e) => this.legal(u, skill.id, e))) {
        const o = this.O(target.id), extra = this.conditionalSkill(skill, u, target);
        const value = Math.min(skill.soldiers + extra.soldiers, o.soldiers) + 20 * Math.min(skill.hp, o.hp)
          + 40 * Math.max(0, Math.min(10, skill.stop + extra.stop) - this.stopTurnsWhenNext(target)) + Math.min(skill.rice + extra.rice, this.chest(target.side).rice) / 5;
        const score = (value + (advancedBattle(this.g) && skill.id === DISRUPT ? 35 : 0))
          * realChance(this.hitChance(u, target, skill.id)) * (target.commander ? 1.2 : 1);
        if (score > (custom?.score ?? 0)) custom = { skill, target, score };
      }
    }
    // 敌总大将近身且已明显虚弱时，优先尝试白兵，避免先耗尽全军机动力。
    const vulnerableCommander = this.g.campaignRules === true && this.pool[s] >= ATTACK_COST && o.soldiers > 0
      ? adj.find((e) => e.commander && (this.O(e.id).hp <= 20 || this.O(e.id).soldiers <= 150)) : null;
    if (vulnerableCommander) return this.doAttack(u, [vulnerableCommander]);
    // 攻城主将孤立遇敌时优先退到安全格；当日不立即走回原位。
    if (this.siege && this.g.siegeTactics === true && s === 'att' && u.commander) {
      if (u.siegeCautionDay === this.day && !adj.length) return null;
      const allies=this.side(s).filter(v=>v!==u && this.O(v.id).soldiers>0);
      if (adj.some(v=>this.O(v.id).soldiers>=Math.max(100,Math.floor(o.soldiers*0.8)))
          && allies.length && !allies.some(v=>this.adjacent(u,v))) {
        const enemies=this.side(foe), distance=(x,y,v)=>Math.abs(x-v.x)+Math.abs(y-v.y);
        const safe=DIRS.map(([dx,dy])=>[u.x+dx,u.y+dy]).filter(([x,y])=>this.inside(x,y) && !this.unitAt(x,y)
          && enemies.every(v=>distance(x,y,v)>1))
          .map(([x,y])=>({x,y,cost:this.cost(u,x,y),support:Math.min(...allies.map(v=>distance(x,y,v)))}))
          .filter(v=>Number.isFinite(v.cost) && v.cost<=this.pool[s])
          .sort((a,b)=>a.support-b.support || a.cost-b.cost);
        if (safe.length) { const step=safe[0]; this.move(u,step.x,step.y,step.cost); u.siegeCautionDay=this.day;
          return { type:'move',u,path:[[step.x,step.y]],cost:step.cost }; }
      }
    }
    if (custom) return this.doCast(u, custom.skill.id, custom.target);
    const special = this.aiStrategy(u, true);
    if (special) return special;
    if (this.fortifiedDefense && s === 'def') {
      const invader = adj.filter(v => siegeRing(this.siege, v) <= this.siege.outer);
      if (invader.length && this.pool[s] >= ATTACK_COST) return this.doAttack(u, invader);
      const cast = this.aiStrategy(u, false);
      if (cast) return cast;
      if (adj.length && this.pool[s] >= ATTACK_COST) return this.doAttack(u, adj);
      return guardingCamp ? null : this.guardCastle(u);
    }
    if (s === 'att' && this.approaches && !adj.length && this.day <= 10 && !u.commander
      && !u.stop && !u.qimen && o.soldiers >= 300) {
      const allies = this.side(s), { post } = this.approaches, holder = this.postHolder();
      // 主力继续攻城，有余兵时派一支分队驻哨；有敌靠近时照常作战。
      if (allies.length >= 4 && holder === u) return null;
      if (allies.length >= 4 && !this.unitAt(post.x, post.y)) {
        const guard = allies.filter(v => !v.commander && v.role >= 2 && v.role <= 4 && !v.stop && !v.qimen && this.O(v.id).soldiers >= 300)
          .sort((a, b) => this.dist(a, post) - this.dist(b, post) || a.id - b.id)[0];
        if (guard === u) { const move = this.approach(u, post); if (move) return move; }
      }
    }
    if (u.role === 0) {
      if (s === 'def') return this.aiStrategy(u, false);
      if (this.pool[s] >= ATTACK_COST && adj.length) return this.doAttack(u, adj);
      const n = this.aiStrategy(u, false); if (n) return n;
      // 攻城时总大将跟随先锋，避免独自闯入城门后被守军集火。
      if (this.siege) {
        const {x: cx,y: cy}=this.assaultTarget(), distance=(v)=>Math.abs(v.x-cx)+Math.abs(v.y-cy);
        const vanguard=this.side(s).filter(v=>v!==u && (v.role===1 || v.role===2) && this.O(v.id).soldiers>0);
        if (vanguard.length && distance(u)>3 && !vanguard.some(v=>distance(v)<distance(u))) return null;
        if (this.siege.revision >= CORNER_LAYOUT_REVISION && this.siege.camp && !this.campSecured) {
          return this.approach(u, this.siege.camp);
        }
      }
      if ((this.r(256) & 3) === 0) return null;
      return this.approach(u, commanderFoe);
    }
    if (u.role === 1) {
      const c = adj.find((e) => e.commander);
      if (c && this.pool[s] >= ATTACK_COST) return this.doAttack(u, [c]);
      if (this.siege && adj.length && this.pool[s] >= ATTACK_COST) return this.doAttack(u, adj);
      if (s === 'def') return this.approach(u, commanderFoe);
      return this.approach(u, this.assaultTarget());
    }
    if (this.pool[s] >= ATTACK_COST && adj.length) return this.doAttack(u, adj);
    const center = u.role === 3 ? this.side(s).find((x) => x.commander) || u : u, rad = u.role === 4 ? 3 : 2;
    const near = this.side(foe).filter((e) => Math.max(Math.abs(e.x - center.x), Math.abs(e.y - center.y)) <= rad)
      .map((e) => ({ e, sc: Math.abs(e.x - center.x) + Math.abs(e.y - center.y) + (Math.abs(e.y - center.y) === rad ? 1 : 0) }))
      .sort((a, b) => a.sc - b.sc)[0]?.e;
    if (near) {
      if (u.role === 3 && this.side(s).some((x) => !x.commander && x !== u && this.adjacent(x, near))) return this.aiStrategy(u, false);
      return this.approach(u, near);
    }
    // 兵力优势且主将安全时，后援跟随先锋攻城；主将附近有敌人时仍留作护卫。
    if (this.siege && this.g.siegeTactics === true && s === 'att' && u.role === 4) {
      const allies=this.side(s), commander=allies.find(v=>v.commander), enemies=this.side(foe);
      if (commander && allies.length>=3 && allies.some(v=>v.role===1 || v.role===2)
          && this.troops(s)>=this.troops(foe)*1.25 && enemies.every(v=>this.dist(v,commander)>3)) {
        return this.approach(u, this.assaultTarget());
      }
    }
    if (u.role === 2) { if (s === 'def') return this.approach(u, commanderFoe); return this.approach(u, this.assaultTarget()); }
    return this.aiStrategy(u, false) || this.approach(u, this.side(s).find((x) => x.commander));
  }
  guardCamp(u) {
    if (u.stop || u.qimen || this.pool.def <= 0) return null;
    const { siege } = this, { camp } = siege, officer = this.O(u.id);
    const outside = (v) => siegeRing(siege, v) > siege.outer;
    const holder = this.unitAt(camp.x, camp.y);
    const enemies = this.side('att').filter(v => outside(v) && this.dist(v, camp) <= 4);
    const budget = Math.min(5, this.pool.def - ATTACK_COST);
    // 营格有人留守，或只有一个近敌时，才尝试出击。保留同回合发起白兵所需的机动力。
    if (budget >= 0 && enemies.length && (enemies.length === 1 || (holder?.side === 'def' && holder !== u))
        && officer.soldiers >= 300 && officer.hp * 2 >= maxHp(officer)) {
      const reach = this.reach(u, budget, (x,y) => outside({ x,y }) && this.dist({ x,y }, camp) <= 3);
      let best = null;
      for (const target of enemies) {
        const troops = this.O(target.id).soldiers;
        if (troops > officer.soldiers) continue;
        for (const [dx,dy] of DIRS) {
          const [x,y] = [target.x + dx, target.y + dy];
          const cost = reach.dist.get(`${x},${y}`);
          if (cost == null || (best && (cost > best.cost || (cost === best.cost && troops >= best.troops)))) continue;
          best = { x, y, cost, troops, target };
        }
      }
      if (best?.cost === 0) return this.doAttack(u, [best.target]);
      if (best) {
        const [step] = this.path(reach, best.x, best.y), cost = this.cost(u, ...step);
        this.move(u, ...step, cost);
        return { type: 'move', u, path: [step], cost };
      }
    }
    if (holder) return null;
    // 出营后没有接战机会，就回填空出的营格，避免留下无守军的破城入口。
    const limit = Math.max(3, this.dist(u, camp));
    return this.siegeApproach(u, camp, (x,y) => outside({ x,y }) && this.dist({ x,y }, camp) <= limit);
  }
  guardCastle(u) {
    const siege = this.siege, inside = (v) => siegeRing(siege, v) <= siege.outer;
    if (u.stop || u.qimen || this.pool.def <= 0) return null;
    if (siege.camp && !this.campSecured && !u.commander && !inside(u)) {
      const camp = siege.camp, limit = Math.max(5, this.dist(u,camp));
      const foe = this.side('att').filter(v => this.dist(v,camp) <= 5)
        .sort((a,b) => this.dist(u,a) - this.dist(u,b))[0];
      return foe ? this.siegeApproach(u, foe, (x,y) => this.dist({ x,y }, camp) <= limit) : null;
    }
    if (u.commander) {
      return siege.camp && this.campSecured && !inside(u)
        ? this.siegeApproach(u, { x: siege.cx,y: siege.cy }) : null;
    }
    const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    const enemies = this.side('att');
    const gates = siege.gates.filter(g => g.ring === siege.outer);
    // 城内先堵已经进城的敌军。对城外敌军只调往受威胁的门口，不跟到护城河外。
    const threats = enemies.filter(inside);
    const posts = threats.length ? threats : gates.filter(g => enemies.some(e => distance(e, g) <= 5));
    if (!posts.length && inside(u)) return null;
    const goals = posts.length ? posts : gates;
    const stationed = inside(u), canGuard = (x, y) => !stationed || inside({ x, y });
    const reach = this.reach(u, this.pool.def, canGuard);
    const score = (v) => Math.min(...goals.map(g => distance(v, g) + (threats.length ? siegeRing(siege, g) : 0)));
    let best = { x: u.x, y: u.y, score: score(u), cost: 0 };
    for (const [key, cost] of reach.dist) {
      const [x, y] = key.split(',').map(Number);
      const candidate = score({ x, y });
      if (candidate < best.score || (candidate === best.score && cost < best.cost)) best = { x, y, score: candidate, cost };
    }
    const step = this.path(reach, best.x, best.y)[0];
    if (!step) {
      // 偏置门和长方形内墙有时需要先侧移，仍只在墙内寻找去路。
      if (siege.revision < 4 || goals.some(g => distance(u, g) <= Number(threats.length > 0))) return null;
      const goal = [...goals].sort((a,b) => distance(u,a) - distance(u,b))[0];
      return this.siegeApproach(u, goal, canGuard);
    }
    const cost = this.cost(u, ...step);
    this.move(u, ...step, cost);
    return { type: 'move', u, path: [step], cost };
  }
  // AI strategy choice (6.8 §5): normal priority 6→5→8→9→7→random{2,1,3}→4→0; special 10→15 for listed strategists.
  aiStrategy(u, special) {
    const o = this.O(u.id), s = u.side, foe = s === 'att' ? 'def' : 'att';
    const modern = advancedBattle(this.g);
    let order;
    if (special && modern) {
      order = this.strategies(u).filter(v => v.id >= 10 && !v.custom).map(v => v.id);
    } else if (special) {
      const k = AI_SPECIAL.indexOf(u.id);
      if (k < 0 || o.int < 92 || o.level < 4) return null;
      order = [10, 11].concat(o.level >= 5 && k >= 10 ? [12, 13] : [], o.level >= 6 && k >= 16 ? [14] : [], o.level >= 7 && u.id === 109 ? [15] : []);
    } else {
      const n = o.int < 40 ? 2 : o.int < 60 ? 4 : o.int < 75 ? 6 : o.int < 85 ? 8 : 10;
      order = (modern ? [6, 9, 7, 4, 0, 8, 'rnd', 5] : [6, 5, 8, 9, 7, 'rnd', 4, 0]).filter((x) => x === 'rnd' || x < n);
    }
    if (fullStrategyWeather(this.g) && this.weather !== 'clear') {
      const passive = this.passive(u);
      order = order.map((id, i) => {
        const [hit, effect] = tacticWeather(this.g, id, this.weather, passive);
        return { id, priority: i * 5 - hit - (effect - 100) / 3 };
      }).sort((a, b) => a.priority - b.priority).map(({ id }) => id);
    }
    const targets = this.side(foe).filter((e) => this.dist(u, e) < this.strategyLimit(u)).sort((a, b) => this.O(b.id).soldiers - this.O(a.id).soldiers);
    const needTroops = [0, 3, 4, 6, 7, 9, 12, 13, 14];
    for (let id of order) {
      if (id === 11) { if (this.pool[s] >= STRATS[11].cost && this.legal(u, 11)) return this.doCast(u, 11, null); continue; }
      for (const t of targets) {
        let sid = id;
        if (id === 'rnd') {
          const tt = this.terr(t.x, t.y); if (tt !== FOREST && tt !== MOUNT) break;
          const k = this.r(256) & 3; if (!k) break;
          sid = [0, 2, 1, 3][k]; if (sid === 3 && !this.O(t.id).soldiers) break;
          if (sid >= (o.int < 40 ? 2 : o.int < 60 ? 4 : 10)) break;
        }
        if (this.pool[s] < STRATS[sid].cost || !this.legal(u, sid, t)) continue;
        if (needTroops.includes(sid) && !this.O(t.id).soldiers) continue;
        if ((sid === 2 || sid === 10) && t.stop) continue;
        if (sid === 8 && this.O(t.id).loyalty >= 50) continue;
        if (sid === 15 && (t.qimen || !(o.war >= 85 || o.int >= 85) || o.soldiers < 700)) continue;
        return this.doCast(u, sid, t);
      }
    }
    return null;
  }
  doCast(u, id, t) { const res = this.cast(u, id, t, true); return { type: 'strategy', u, t, id, res }; }
  doAttack(u, targets) {
    const d = [...targets].sort((a, b) => this.O(a.id).soldiers - this.O(b.id).soldiers)[0];
    const res = this.attack(u, d);
    return { type: 'attack', a: u, d, res };
  }
  // AI movement (`A60C`, 6.8 §8): no path-finding. Candidates are the axis with the larger gap first
  // (ties: vertical first), sorted by the estimate table (small table when the troop LOW BYTE ≤2 — an
  // original quirk), first affordable free cell wins and the estimate is what gets paid. Role 1 units
  // attack an enemy blocking that first affordable step. One cell per decision; the dispatcher comes back.
  aiEstimate(u, x, y) {
    if (this.siege) return this.cost(u,x,y);
    const o = this.O(u.id), t = this.villages.some((v) => v.x === x && v.y === y) ? PLAIN : this.terr(x, y);
    const big = [[3, 5, 5], [4, 4, 4], [2, 3, 3], [5, 6, 3], [5, 3, 6], [6, 6, 6]], small = [[2, 3, 3], [3, 3, 3], [1, 2, 2], [3, 5, 2], [3, 2, 4], [4, 4, 4]];
    return ((o.soldiers & 255) <= 2 ? small : big)[t][ARMY_IDX[o.army]];
  }
  // 新规则只在原有直行受阻时寻找可达绕路；使用真实移动消耗，并且每次仍只走一格。
  detour(u, target) {
    if (this.g.campaignRules !== true) return null;
    const reach = this.reach(u), start = Math.abs(target.x - u.x) + Math.abs(target.y - u.y);
    let best = null;
    for (const [key, cost] of reach.dist) {
      const [x, y] = key.split(',').map(Number), distance = Math.abs(target.x - x) + Math.abs(target.y - y);
      if (distance >= start || (best && (distance > best.distance || (distance === best.distance && cost >= best.cost)))) continue;
      best = { x, y, cost, distance };
    }
    if (!best) return null;
    const path = this.path(reach, best.x, best.y), step = path.shift();
    if (!step) return null;
    u.aiDetour = path.length ? { target: [target.x, target.y], path } : null;
    const cost = this.cost(u, ...step);
    this.move(u, ...step, cost);
    return { type: 'move', u, path: [step], cost };
  }
  // 城墙需要允许暂时远离目标的绕行；逐格行动，移动消耗与玩家一致。
  siegeApproach(u, target, canEnter = null) {
    const start = `${u.x},${u.y}`, occupied = this.unitAt(target.x,target.y);
    const dist = new Map([[start,0]]), prev = new Map(), open = [[0,u.x,u.y]];
    // 驻门的敌将和可绕行的门同属进攻选择。走到驻门敌将面前可白兵夺门。
    const siege = this.siege;
    const guarded = siege.revision >= 4 && u.side === 'att' && siegeRing(siege, target) <= siege.outer
      ? siege.gates.filter(g => !g.open && this.unitAt(g.x,g.y)?.side === 'def') : [];
    let breach = null;
    let end = null, best = start, bestDistance = Math.abs(u.x-target.x)+Math.abs(u.y-target.y), bestCost = 0;
    while (open.length) {
      open.sort((a,b) => a[0]-b[0]); const [d,x,y] = open.shift(), k = `${x},${y}`;
      if (d !== dist.get(k)) continue;
      if (breach && d > breach.cost) { end = breach.key; break; }
      const remaining=Math.abs(x-target.x)+Math.abs(y-target.y);
      if (remaining<bestDistance || (remaining===bestDistance && d<bestCost)) { best=k; bestDistance=remaining; bestCost=d; }
      if (occupied ? Math.abs(x-target.x)+Math.abs(y-target.y)===1 : x===target.x && y===target.y) { end=k; break; }
      if (k !== start && !breach && guarded.some(g => Math.abs(g.x-x)+Math.abs(g.y-y)===1)) {
        breach = { key:k, cost:d+ATTACK_COST+4 };
      }
      for (const [dx,dy] of DIRS) {
        const nx=x+dx, ny=y+dy, nk=`${nx},${ny}`;
        if (!this.inside(nx,ny) || (canEnter && !canEnter(nx,ny)) || this.unitAt(nx,ny)) continue;
        const nd=d+this.cost(u,nx,ny); if (!Number.isFinite(nd) || nd >= (dist.get(nk) ?? Infinity)) continue;
        dist.set(nk,nd); prev.set(nk,k); open.push([nd,nx,ny]);
      }
    }
    end ||= breach?.key ?? best;
    if (end===start) return null;
    while (prev.get(end)!==start) end=prev.get(end);
    const step=end.split(',').map(Number), cost=this.cost(u,...step);
    if (cost>this.pool[u.side]) return null;
    this.move(u,...step,cost); return { type:'move',u,path:[step],cost };
  }
  approach(u, target) {
    if (!target || this.pool[u.side] <= 0 || u.stop || u.qimen) return null;
    if (this.siege && target.side !== u.side) return this.siegeApproach(u,target);
    // 贴身护卫不抢占主将另一侧；两名护卫堵住前路时，挡路的一人侧移让行。
    if (u.role === 3 && target.commander && target.side === u.side && this.adjacent(u, target)) {
      const guards = this.side(u.side).filter((v) => v.role === 3 && this.adjacent(v, target));
      const foe = this.side(u.side === 'att' ? 'def' : 'att').find((v) => v.commander);
      if (guards.length >= 2 && foe) {
        const dx = foe.x - target.x, dy = foe.y - target.y;
        const forward = Math.abs(dx) >= Math.abs(dy) && dx ? [Math.sign(dx), 0] : [0, Math.sign(dy)];
        if (u.x === target.x + forward[0] && u.y === target.y + forward[1]) {
          for (const [sx, sy] of [[-forward[1], forward[0]], [forward[1], -forward[0]]]) {
            const x = u.x + sx, y = u.y + sy;
            if (!this.inside(x, y) || this.unitAt(x, y) || (u.side === 'att' && x === this.castle()[0] && y === this.castle()[1])) continue;
            const cost = this.cost(u, x, y);
            if (cost <= this.pool[u.side]) { this.move(u, x, y, cost); return { type: 'move', u, path: [[x, y]], cost }; }
          }
        }
      }
      return null;
    }
    // 绕路必须继续到选定的落点，不能下一步又按直线走回刚才的位置。
    const route = u.aiDetour;
    if (this.g.campaignRules === true && route) {
      const step = Array.isArray(route.path) ? route.path[0] : null;
      const sameTarget = Array.isArray(route.target) && route.target.length === 2 && route.target[0] === target.x && route.target[1] === target.y;
      const adjacent = Array.isArray(step) && step.length === 2 && step.every(Number.isInteger)
        && Math.abs(step[0] - u.x) + Math.abs(step[1] - u.y) === 1 && this.inside(...step);
      if (sameTarget && adjacent && !this.unitAt(...step)) {
        const cost = this.cost(u, ...step);
        if (cost > this.pool[u.side]) return null;
        route.path.shift(); if (!route.path.length) u.aiDetour = null;
        this.move(u, ...step, cost);
        return { type: 'move', u, path: [step], cost };
      }
      u.aiDetour = null;
    }
    const dx = target.x - u.x, dy = target.y - u.y;
    // A60C has no "stop beside the target": an occupied target cell blocks (or is attacked) below, an
    // empty one (a vacated castle, a village) is entered. Stop once standing on it.
    if (!dx && !dy) return null;
    const vert = [0, Math.sign(dy) || 1], horz = [Math.sign(dx), 0];
    let cands = Math.abs(dx) > Math.abs(dy) ? [horz, vert] : [vert, horz];
    if (!dx) cands = [vert]; else if (!dy) cands = [horz];
    cands = cands.map(([sx, sy]) => [u.x + sx, u.y + sy]).filter(([x, y]) => this.inside(x, y))
      .map(([x, y]) => ({ x, y, c: this.aiEstimate(u, x, y) })).sort((a, b) => a.c - b.c);
    const avoid = u.aiAvoidReturn;
    if (avoid && (avoid.day !== this.day || !Array.isArray(avoid.target) || avoid.target[0] !== target.x || avoid.target[1] !== target.y)) delete u.aiAvoidReturn;
    let first = cands.find((c) => c.c <= this.pool[u.side]);
    if (!first) return this.detour(u, target);
    if (u.aiAvoidReturn && first.x === u.aiAvoidReturn.x && first.y === u.aiAvoidReturn.y) {
      first = cands.find((c) => c.c <= this.pool[u.side] && (c.x !== avoid.x || c.y !== avoid.y) && !this.unitAt(c.x, c.y));
      if (!first) return this.detour(u, target);
    }
    const occ = this.unitAt(first.x, first.y);
    if (occ && occ.side !== u.side) return u.role === 1 && this.pool[u.side] >= ATTACK_COST ? this.doAttack(u, [occ]) : this.detour(u, target);
    // Remake deviation (player feedback N07): A60C waits when its own officer holds the first step, so two
    // officers queued on one axis (each walking toward the other) stood still until the day-31 timeout.
    // Here the other axis is tried instead; still one greedy step, no path-finding.
    if (occ) {
      if (first.x === target.x && first.y === target.y) return null; // already beside the officer it walks to
      if (!dx || !dy) cands = [[u.x + (dx ? 0 : 1), u.y + (dy ? 0 : 1)], [u.x - (dx ? 0 : 1), u.y - (dy ? 0 : 1)]]
        .filter(([x, y]) => this.inside(x, y)).map(([x, y]) => ({ x, y, c: this.aiEstimate(u, x, y) })).sort((a, b) => a.c - b.c);
      first = cands.find((c) => c !== first && c.c <= this.pool[u.side] && !this.unitAt(c.x, c.y)
        && !(u.aiAvoidReturn && c.x === u.aiAvoidReturn.x && c.y === u.aiAvoidReturn.y));
      if (!first) return this.detour(u, target);
      u.aiAvoidReturn = { x: u.x, y: u.y, target: [target.x, target.y], day: this.day };
    } else {
      delete u.aiAvoidReturn;
    }
    this.move(u, first.x, first.y, first.c);
    return { type: 'move', u, path: [[first.x, first.y]], cost: first.c };
  }
}
