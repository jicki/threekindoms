// 新开局追加的人物不占用旧记录的动态武将编号；载入时按本局标记重建模板。
import { presetVisual } from './visuals.js';
import { ADDITIONAL_OFFICERS, REGIONAL_OFFICERS } from './regional-content.js';

export const FAMOUS_ROSTER_START = 262;
export const FAMOUS_ROSTER = [
  { name:'张昭', visual:presetVisual('zhangzhao'), hp:70, war:30, int:91, virtue:86, year:195, death:236, birthYear:156, city:15, weapon:0, armor:0, army:'平' },
  { name:'张纮', visual:presetVisual('zhanghong'), hp:68, war:32, int:89, virtue:85, year:195, death:212, birthYear:null, city:15, weapon:0, armor:0, army:'平' },
  { name:'张绣', visual:presetVisual('zhangxiu'), hp:86, war:88, int:68, virtue:64, year:197, death:207, birthYear:null, city:32, weapon:18, armor:2, army:'平' },
];
const toTemplate = ({ key, passive, relations, ...officer }) => ({
  ...officer, visual: { portrait: `r-${key}` }, regionalPassive: passive,
});
const REGIONAL_ROSTER = [...FAMOUS_ROSTER, ...REGIONAL_OFFICERS.map(toTemplate)];
const COMPLETE_ROSTER = [...REGIONAL_ROSTER, ...ADDITIONAL_OFFICERS.map(toTemplate)];
const ROSTERS = new Map([[1, FAMOUS_ROSTER], [2, REGIONAL_ROSTER], [3, COMPLETE_ROSTER]]);
export const famousRosterFor = (g) => ROSTERS.get(g?.famousRoster) ?? [];
const ADDITIONAL_RELATIONS = ADDITIONAL_OFFICERS.flatMap(({ relations = [] }, i) =>
  relations.map(([to, kind]) => ({ from: FAMOUS_ROSTER_START + REGIONAL_ROSTER.length + i, to, kind })));
export const rosterRelationships = (g) => g?.famousRoster === 3 ? ADDITIONAL_RELATIONS : [];
export const staticRosterSize = (D,g) => D.officers.filter(o=>o && !o.clone && !o.famousExtra && !o.raidTemp).length + famousRosterFor(g).length;
export function famousRosterTemplate(id) {
  const officer = COMPLETE_ROSTER[id - FAMOUS_ROSTER_START];
  return { birthYear: null, ...officer, id, jp: officer.jp ?? officer.name, loyalty: 80, level: 1, exp: 0, soldiers: 0, appear: 'search_city',
    faction: null, birthCity: null, skills: [], searchPriority: true, famousExtra: true };
}
export function activateFamousRoster(D,g) {
  if (!D?.officers) return;
  const count = famousRosterFor(g).length;
  for (let i=0;i<COMPLETE_ROSTER.length;i++) {
    const id=FAMOUS_ROSTER_START+i;
    if (i < count) D.officers[id]=famousRosterTemplate(id);
    else if (D.officers[id]?.famousExtra) delete D.officers[id];
  }
  while (D.officers.length && !D.officers[D.officers.length-1]) D.officers.pop();
}
export const extraSearchIds = (g,cid) => famousRosterFor(g).flatMap((o,i)=>o.city===cid ? [FAMOUS_ROSTER_START+i] : []);
export const recordExtra = (g, id) => famousRosterFor(g)[id - FAMOUS_ROSTER_START];
export function rosterRecordName(D,g,id) {
  if (g?.clones?.includes(id)) return D.officers[0].name;
  return recordExtra(g, id)?.name ?? D.officers[id]?.name;
}
export const recordOfficerVisual = (g, id) => recordExtra(g, id)?.visual;
