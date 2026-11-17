// 特色队复用原有步、弓、骑的命令和行动节奏；射程与倍率为固定规则，不执行版本代码。
export const SPECIAL_TROOPS = {
  infantry: { name: '普通步兵', kind: 'inf', sprite: 'unit-soldier-infantry', level: 1, max: 3, text: '攻防均衡' },
  heavyinfantry: { name: '重甲步兵', kind: 'inf', sprite: 'unit-soldier-heavyinf', level: 3, max: 3, fallback: 'infantry', text: '对兵队伤害＋2%，受到伤害−5%' },
  spear: { name: '普通枪兵', kind: 'inf', sprite: 'unit-soldier-spear', level: 1, max: 3, text: '对骑兵伤害＋8%，对其他兵队−2%' },
  heavyspear: { name: '重甲枪兵', kind: 'inf', sprite: 'unit-soldier-heavyspear', level: 3, max: 3, fallback: 'spear', text: '对骑兵伤害＋10%，受到伤害−4%' },
  hammer: { name: '普通单锤兵', kind: 'inf', sprite: 'unit-soldier-hammer', level: 1, max: 3, text: '对盾兵伤害＋8%，受到伤害＋5%' },
  doublehammer: { name: '重甲双锤兵', kind: 'inf', sprite: 'unit-soldier-doublehammer', level: 4, max: 2, fallback: 'hammer', text: '对盾兵伤害＋12%，受到伤害−3%' },
  lightshield: { name: '普通盾兵', kind: 'inf', sprite: 'unit-soldier-lightshield', level: 1, max: 3, text: '对兵队伤害−3%，受到伤害−5%' },
  shield: { name: '重甲重盾兵', kind: 'inf', sprite: 'special-soldier', level: 3, max: 3, fallback: 'lightshield', text: '对兵队伤害−5%，受到伤害−8%' },
  lightcav: { name: '普通轻骑', kind: 'cav', sprite: 'special-cavalry', level: 1, max: 3, text: '对兵队伤害＋5%，受到远射伤害＋8%' },
  heavycav: { name: '重甲骑兵', kind: 'cav', sprite: 'unit-cavalry-heavy', level: 3, max: 3, fallback: 'lightcav', text: '对兵队伤害＋3%，受到伤害−5%' },
  royalcav: { name: '皇家骑兵', kind: 'cav', sprite: 'unit-cavalry-royal', level: 5, max: 1, fallback: 'heavycav', text: '对兵队伤害＋5%，受到伤害−8%' },
  bow: { name: '普通弓兵', kind: 'arc', sprite: 'unit-archer-bow', level: 1, max: 3, text: '远射2至4格，贴身可近战' },
  crossbow: { name: '弩兵', kind: 'arc', sprite: 'special-archer', level: 3, max: 2, fallback: 'bow', text: '远射对兵队伤害＋8%，近战−15%' },
  horsebow: { name: '骑射兵', kind: 'cav', sprite: 'unit-cavalry-horsebow', level: 4, max: 1, fallback: 'lightcav', text: '远射2至3格且折减伤害，近战−10%，受到远射伤害＋8%' },
};
const BY_SPRITE = new Map(Object.entries(SPECIAL_TROOPS).map(([key, troop]) => [troop.sprite, key]));
export const troopBySprite = (sprite) => SPECIAL_TROOPS[BY_SPRITE.get(sprite)] ?? null;

// 依据历史及演义中的人物形象作游戏适配；名称和属性不代表史实编制。
export const FAMOUS_TROOPS = {
  infantry: ['刘备', '关平', '关兴', '张苞'],
  heavyinfantry: ['徐晃', '魏延', '夏侯霸', '李严', '张嶷'],
  spear: ['凌统', '田楷', '曹真'],
  heavyspear: ['关羽', '张飞', '姜维'],
  hammer: ['孟获', '王双', '周仓'],
  doublehammer: ['典韦', '许褚'],
  lightshield: ['周泰', '曹仁', '王异', '于禁'],
  shield: ['高顺', '陈到', '王平', '黄盖', '文聘'],
  lightcav: ['马腾', '庞德', '田豫', '牵招', '文丑', '曹休', '曹彰', '夏侯惇'],
  heavycav: ['张辽', '吕布', '张郃', '颜良'],
  royalcav: ['曹操', '孙策', '董卓', '袁绍'],
  bow: ['孙尚香', '甘宁', '黄祖', '韩当', '祝融夫人', '朱然', '孙权'],
  crossbow: ['黄忠', '太史慈', '张任', '诸葛亮', '周瑜', '陆逊', '吕蒙', '徐盛', '朱桓', '司马懿'],
  horsebow: ['公孙瓒', '赵云', '马超', '夏侯渊'],
};
const LEADERS = new Set(['刘备', '关羽', '张飞', '徐晃', '魏延', '高顺', '陈到', '王平', '周泰', '马腾', '张辽', '吕布', '孙尚香']);

export function famousAssignments(officers) {
  const byName = new Map(Object.entries(FAMOUS_TROOPS).flatMap(([type, names]) => names.map((name) => [name, type])));
  return officers.flatMap((o) => byName.has(o.name) ? [{ officer: o.id, type: byName.get(o.name), maxSquads: LEADERS.has(o.name) ? 3 : 2 }] : []);
}

// 低级武将使用该兵种的下一级；升级后在下一场白兵重新计算。
export function officerSpecialty(data, game, id) {
  if (game.eliteTroops !== true) return null;
  const type = data.officers[id]?.troopType;
  let troop = typeof type === 'string' && Object.hasOwn(SPECIAL_TROOPS, type) ? SPECIAL_TROOPS[type] : null;
  const level = game.officers[id]?.level ?? 0;
  while (troop && level < troop.level) troop = SPECIAL_TROOPS[troop.fallback] ?? null;
  return troop;
}

export function officerSquadLimit(data, game, id, troop = officerSpecialty(data, game, id)) {
  if (!troop) return 0;
  const level = game.officers[id]?.level ?? 0, rankLimit = level >= 6 ? 3 : level >= 3 ? 2 : 1;
  const target = SPECIAL_TROOPS[data.officers[id]?.troopType];
  return Math.min(troop.max, target?.max ?? troop.max, data.officers[id]?.troopLimit ?? 2, rankLimit);
}

// 小部队不强行转换兵类；足够兵力的野战可补充一队，守城保持原版步转弓规则。
export function makeSquads(comp, count, castle, special, limit = special?.max ?? 0, limitForcedCavalry = false) {
  const squads = Array.from({ length: count }, (_, i) => {
    let kind = i < comp.inf ? 'inf' : i < comp.inf + comp.arc ? 'arc' : 'cav';
    if (castle && kind === 'inf') kind = 'arc';
    return { kind };
  });
  if (!special || !count || !limit) return squads;
  let candidates = squads.filter((s) => s.kind === special.kind);
  if (!candidates.length && !castle && count >= 6 && !(limitForcedCavalry && special.kind === 'cav')) {
    squads[count - 1].kind = special.kind;
    candidates = [squads[count - 1]];
  }
  for (const squad of candidates.slice(0, Math.min(limit, special.max, Math.ceil(count / 4)))) squad.special = special.sprite;
  return squads;
}

// 属性只影响兵队之间的普通攻击；不修改武将单挑或额外抽取随机数。
export function troopDamage(damage, attacker, target, ranged) {
  if (damage <= 0 || target.kind === 'gen') return damage;
  const a = BY_SPRITE.get(attacker.special), t = BY_SPRITE.get(target.special);
  const shield = t === 'lightshield' || t === 'shield';
  let attack = 100, defend = 100;
  if (a === 'heavyinfantry') attack = 102;
  else if (a === 'spear') attack = target.kind === 'cav' ? 108 : 98;
  else if (a === 'heavyspear') attack = target.kind === 'cav' ? 110 : 100;
  else if (a === 'hammer') attack = shield ? 108 : 100;
  else if (a === 'doublehammer') attack = shield ? 112 : 100;
  else if (a === 'lightshield') attack = 97;
  else if (a === 'shield') attack = 95;
  else if (a === 'lightcav' || a === 'royalcav') attack = 105;
  else if (a === 'heavycav') attack = 103;
  else if (a === 'crossbow') attack = ranged ? 108 : 85;
  else if (a === 'horsebow' && !ranged) attack = 90;
  if (t === 'heavyinfantry' || t === 'lightshield' || t === 'heavycav') defend = 95;
  else if (t === 'heavyspear') defend = 96;
  else if (t === 'hammer') defend = 105;
  else if (t === 'doublehammer') defend = 97;
  else if (t === 'shield' || t === 'royalcav') defend = 92;
  else if ((t === 'lightcav' || t === 'horsebow') && ranged) defend = 108;
  return attack === 100 && defend === 100 ? damage : Math.max(1, Math.floor(damage * attack * defend / 10000));
}
