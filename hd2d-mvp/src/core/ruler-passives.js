// 君主被动只使用固定效果，不接受版本文件提供的代码或任意数值。
// 每月仅作用于君主所在城，效果根据当前属性重新计算。
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
const LABELS = { gold: '金', rice: '米', reserve: '后备兵', land: '土地', gov: '统治（至80）', soldiers: '最低兵数武将的兵数', loyalty: '最低忠诚部将的忠诚（至90）' };

export function describeRulerPassive(officer) {
  if (!officer) return null;
  const stat = (key) => Math.max(0, Math.min(99, Math.floor(Number(officer[key]) || 0)));
  const strongest = ['war', 'int', 'virtue'].reduce((a, b) => stat(b) > stat(a) ? b : a);
  const named = Object.hasOwn(PROFILES, officer.name), [name, rules] = named ? PROFILES[officer.name] : DEFAULTS[strongest];
  const effects = rules.map(([kind, key, base, divisor]) => ({ kind, value: base + (key ? Math.floor(stat(key) / divisor) : 0) }));
  return { name: named ? name : `${officer.name || '君主'}·${name}`, effects, text: `每月君主所在城：${effects.map(({ kind, value }) => `${LABELS[kind]}＋${value}`).join('，')}` };
}

export function applyRulerPassive(g, faction, passive) {
  const fac = g.factions[faction], city = fac && g.cities[fac.city], ruler = fac?.ruler;
  if (!passive || ruler == null || !city || city.faction !== faction || !city.officers.includes(ruler) || g.officers[ruler]?.status !== 2) return false;
  for (const { kind, value } of passive.effects) {
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
