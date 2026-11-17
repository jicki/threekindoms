// 君主被动只使用固定效果，不接受版本文件提供的代码或任意数值。
// 每月资源作用于君主所在城；增强规则另提供不修改存档属性的全军战斗增益。
const PROFILES = {
  董卓: ['威镇西凉', [['gold', 'war', 4, 20], ['soldiers', 'war', 2, 25]]],
  袁绍: ['名门资援', [['gold', 'virtue', 5, 20], ['rice', 'virtue', 4, 20]]],
  曹操: ['经略屯田', [['land', 'int', 1, 50], ['gold', 'int', 2, 25]]],
  孙策: ['江东练兵', [['reserve', 'war', 8, 10], ['soldiers', 'war', 2, 25]]],
  刘备: ['仁义安众', [['loyalty', null, 1, 1], ['rice', 'virtue', 5, 20]]],
  刘璋: ['益州沃土', [['rice', 'virtue', 8, 10], ['land', 'virtue', 1, 50]]],
  马腾: ['西凉蓄锐', [['reserve', 'war', 8, 10], ['gold', 'war', 2, 25]]],
  公孙瓒: ['白马备战', [['gold', 'war', 7, 20], ['reserve', 'war', 5, 20]]],
  袁术: ['淮南筹资', [['gold', 'int', 9, 20], ['rice', 'int', 3, 25]]],
  刘表: ['荆襄安民', [['gold', 'int', 5, 20], ['gov', null, 1, 1]]],
};
const DEFAULTS = {
  war: ['将略练兵', [['reserve', 'war', 6, 10], ['soldiers', 'war', 2, 25]]],
  int: ['智略兴业', [['gold', 'int', 5, 20], ['land', 'int', 1, 50]]],
  virtue: ['仁德抚众', [['rice', 'virtue', 6, 10], ['loyalty', null, 1, 1]]],
};
// 战斗武力、战术智力只用于本场判定；机动力按日恢复，计策奖励上限为实际概率百分点。
// 最后一列为己方增益战术延长的回合数，不延长控制敌人的咒缚。
const COMBAT = {
  董卓: [4, 0, 1, 0], 袁绍: [2, 1, 2, 1], 曹操: [2, 2, 3, 1], 孙策: [4, 0, 1, 0], 刘备: [3, 1, 2, 1],
  刘璋: [1, 2, 2, 1], 马腾: [4, 0, 1, 0], 公孙瓒: [3, 1, 2, 1], 袁术: [2, 1, 2, 1], 刘表: [1, 2, 3, 1],
};
const DEFAULT_COMBAT = { war: [3, 0, 1, 0], int: [1, 2, 3, 1], virtue: [2, 1, 2, 1] };
// 新规则使用固定、有限的专属效果；旧记录即使启用增强被动也保留原有数值。
const UNIQUE = {
  董卓: ['assault', '进攻白兵时，近战对兵队伤害＋5%'],
  袁绍: ['muster', '战场己方至少4将时，每日机动力恢复和上限额外＋1'],
  曹操: ['supply', '战场每日粮耗减少约10%（不足10时减少1，最低消耗1）'],
  孙策: ['river', '河地白兵中，近战兵队对兵队伤害＋5%'],
  刘备: ['bonds', '战场至少有2名与君主亲近的己方武将时，计策成功率额外最多＋2个百分点'],
  刘璋: ['harvest', '十月己方各城收米额外＋5%，每城最多50米'],
  马腾: ['cavalry', '骑兵白兵近战对兵队伤害＋5%'],
  公孙瓒: ['horsebow', '己方骑兵受到远射伤害−8%，骑射兵远射对兵队伤害＋8%'],
  袁术: ['tax', '四月己方各城税金额外＋5%，每城最多40金'],
  刘表: ['garrison', '守方战斗武力额外＋1'],
};
// 新开局的基础被动只占一种类别；专属效果仍独立生效。
const FOCUSED = {
  董卓: ['army', { war: 4 }], 袁绍: ['field', { mobility: 1 }], 曹操: ['strategy', { strategy: 3 }],
  孙策: ['army', { war: 4 }], 刘备: ['economy', ['rice']], 刘璋: ['economy', ['rice']],
  马腾: ['army', { war: 4 }], 公孙瓒: ['economy', ['gold']], 袁术: ['economy', ['gold', 'rice']], 刘表: ['economy', ['gold']],
};
// 战场版只使用一种基础类别和一项专属效果；既有精简记录仍保留 FOCUSED 和 UNIQUE。
const BATTLE_PROFILES = {
  董卓: ['威镇西凉', 'army', { war: 4 }, ['assault', UNIQUE.董卓[1]]],
  袁绍: ['四世督军', 'field', { mobility: 1 }, ['muster', UNIQUE.袁绍[1]]],
  曹操: ['魏武奇略', 'strategy', { strategy: 3 }, ['tactics', '己方强弩、火矢和士气向上额外持续1回合']],
  孙策: ['江东奋战', 'army', { war: 3 }, ['river', UNIQUE.孙策[1]]],
  刘备: ['仁义同心', 'army', { war: 3 }, ['bonds', UNIQUE.刘备[1]]],
  刘璋: ['守蜀安民', 'army', { int: 3 }, ['fortify', '作为守方时，己方兵队受近战兵队伤害减少6%']],
  马腾: ['西凉铁骑', 'army', { war: 3 }, ['cavalry', UNIQUE.马腾[1]]],
  公孙瓒: ['白马义从', 'field', { mobility: 1 }, ['horsebow', UNIQUE.公孙瓒[1]]],
  袁术: ['淮南军势', 'army', { war: 3 }, ['massed', '战场己方至少3将时，兵队近战对兵队伤害＋5%']],
  刘表: ['荆襄固守', 'strategy', { strategy: 3 }, ['garrison', UNIQUE.刘表[1]]],
};
const LABELS = { gold: '金', rice: '米', reserve: '后备兵', land: '土地', gov: '统治（至80）', soldiers: '最低兵数武将的兵数', loyalty: '最低忠诚部将的忠诚（至90）' };

export function describeRulerPassive(officer, enhanced = false, campaign = false, focused = false, battle = false) {
  if (!officer) return null;
  const stat = (key) => Math.max(0, Math.min(99, Math.floor(Number(officer[key]) || 0)));
  const strongest = ['war', 'int', 'virtue'].reduce((a, b) => stat(b) > stat(a) ? b : a);
  const named = Object.hasOwn(PROFILES, officer.name), [name, rules] = named ? PROFILES[officer.name] : DEFAULTS[strongest];
  if (enhanced && campaign && focused && battle) {
    const fallback = strongest === 'war' ? ['army', { war: 3 }] : ['strategy', { strategy: strongest === 'int' ? 3 : 2 }];
    const label = { war: '将略', int: '智略', virtue: '仁望' }[strongest];
    const [title, category, value, unique] = named ? BATTLE_PROFILES[officer.name] : [`${officer.name || '君主'}·${label}`, ...fallback, null];
    const combat = { war: 0, int: 0, strategy: 0, mobility: 0, tacticRounds: 0, ...value };
    if (unique) combat.unique = unique[0];
    const baseText = category === 'army' ? `全军${combat.war ? `战斗武力＋${combat.war}` : `白兵智力＋${combat.int}`}`
      : category === 'field' ? `战场每日机动力恢复和上限＋${combat.mobility}` : `全军计策成功率最多＋${combat.strategy}个百分点`;
    return { name: title, category, effects: [], combat, text: `${baseText}${unique ? `；专属：${unique[1]}` : ''}` };
  }
  if (enhanced && campaign && focused) {
    const [category, value] = named ? FOCUSED[officer.name] : strongest === 'war' ? ['army', { war: 3 }]
      : strongest === 'int' ? ['strategy', { strategy: 3 }] : ['economy', ['rice']];
    const effects = category === 'economy' ? rules.filter(([kind]) => value.includes(kind)).map(([kind, key, base, divisor]) => ({
      kind, value: (base + (key ? Math.floor(stat(key) / divisor) : 0)) * 4,
    })) : [];
    const combat = { war: 0, int: 0, strategy: 0, mobility: 0, tacticRounds: 0, ...(category === 'economy' ? {} : value) };
    const unique = named ? UNIQUE[officer.name] : null;
    if (unique) combat.unique = unique[0];
    const baseText = category === 'economy' ? `每月君主所在城：${effects.map(({ kind, value: amount }) => `${LABELS[kind]}＋${amount}`).join('，')}`
      : category === 'army' ? `全军${combat.war ? `战斗武力＋${combat.war}` : `白兵智力＋${combat.int}`}`
        : category === 'field' ? `战场每日机动力恢复和上限＋${combat.mobility}`
          : `全军计策成功率最多＋${combat.strategy}个百分点`;
    return { name: named ? name : `${officer.name || '君主'}·${name}`, category, effects, combat,
      text: `${baseText}${unique ? `；专属：${unique[1]}` : ''}` };
  }
  const effects = rules.map(([kind, key, base, divisor]) => ({ kind, value: (base + (key ? Math.floor(stat(key) / divisor) : 0))
    * (enhanced ? (kind === 'gold' || kind === 'rice' ? 4 : kind === 'reserve' || kind === 'soldiers' ? 5 : 1) : 1) }));
  const [war, intelligence, strategy, tacticRounds] = named ? COMBAT[officer.name] : DEFAULT_COMBAT[strongest];
  const combat = enhanced ? { war, int: intelligence, strategy, mobility: 1, tacticRounds } : null;
  const unique = enhanced && campaign && named ? UNIQUE[officer.name] : null;
  if (unique) combat.unique = unique[0];
  const battleText = combat ? `；全军战斗武力＋${war}${intelligence ? `、战术智力＋${intelligence}` : ''}，计策成功率最多＋${strategy}个百分点，战场每日机动力恢复和上限＋1${tacticRounds ? '，强弩、火矢和士气向上持续回合＋1' : ''}` : '';
  return { name: named ? name : `${officer.name || '君主'}·${name}`, effects, ...(combat ? { combat } : {}), text: `每月君主所在城：${effects.map(({ kind, value }) => `${LABELS[kind]}＋${value}`).join('，')}${battleText}${unique ? `；专属：${unique[1]}` : ''}` };
}

export function passiveRiceUse(amount, passive) {
  return passive?.combat?.unique === 'supply' && amount > 0 ? Math.max(1, amount - Math.max(1, Math.floor(amount / 10))) : amount;
}

export function applyRulerPassive(g, faction, passive, atPass = false) {
  const fac = g.factions[faction], city = fac && g.cities[fac.city], ruler = fac?.ruler;
  if (!passive || ruler == null || !city || city.faction !== faction || !city.officers.includes(ruler) || g.officers[ruler]?.status !== 2) return false;
  for (const { kind, value } of passive.effects) {
    // 驻守关隘时保留军资和部将效果，但据点没有土地、人口、预备兵或城市统治。
    if (atPass && ['reserve', 'land', 'gov'].includes(kind)) continue;
    if (kind === 'gold' || kind === 'rice' || kind === 'reserve') {
      if (city[kind] < 9999) city[kind] = Math.min(9999, city[kind] + value);
    } else if (kind === 'land') {
      // 秘技可使土地超过常规上限，不能因被动而降低已有数值。
      if (city.land < 999) city.land = Math.min(999, city.land + value);
    } else if (kind === 'gov') {
      if (city.gov < 80) city.gov = Math.min(80, city.gov + value);
    } else if (kind === 'soldiers') {
      const target = city.officers.map((id) => g.officers[id]).filter((o) => o.status === 2 && o.soldiers < 1000).sort((a, b) => a.soldiers - b.soldiers)[0];
      if (target) target.soldiers = Math.min(1000, target.soldiers + value);
    } else if (kind === 'loyalty') {
      const target = city.officers.filter((id) => id !== ruler).map((id) => g.officers[id]).filter((o) => o.status === 2 && o.loyalty < 90).sort((a, b) => a.loyalty - b.loyalty)[0];
      if (target) target.loyalty = Math.min(90, target.loyalty + value);
    }
  }
  return true;
}
