// 新开局追加的人物不占用旧记录的动态武将编号；载入时按本局标记重建模板。
import { presetVisual } from './visuals.js';

export const FAMOUS_ROSTER_START = 262;
export const FAMOUS_ROSTER = [
  { name:'张昭', visual:presetVisual('zhangzhao'), hp:70, war:30, int:91, virtue:86, year:195, death:236, birthYear:156, city:15, weapon:0, armor:0, army:'平' },
  { name:'张纮', visual:presetVisual('zhanghong'), hp:68, war:32, int:89, virtue:85, year:195, death:212, birthYear:null, city:15, weapon:0, armor:0, army:'平' },
  { name:'张绣', visual:presetVisual('zhangxiu'), hp:86, war:88, int:68, virtue:64, year:197, death:207, birthYear:null, city:32, weapon:18, armor:2, army:'平' },
];
export const hasFamousRoster = (g) => g?.famousRoster === 1;
export const staticRosterSize = (D,g) => D.officers.filter(o=>o && !o.clone && !o.famousExtra && !o.raidTemp).length + (hasFamousRoster(g) ? FAMOUS_ROSTER.length : 0);
export function activateFamousRoster(D,g) {
  if (!D?.officers) return;
  for (let i=0;i<FAMOUS_ROSTER.length;i++) {
    const id=FAMOUS_ROSTER_START+i, p=FAMOUS_ROSTER[i];
    if (hasFamousRoster(g)) D.officers[id]={...p,id,jp:p.name,loyalty:80,level:1,exp:0,soldiers:0,
      appear:'search_city',faction:null,birthCity:null,skills:[],searchPriority:true,famousExtra:true};
    else if (D.officers[id]?.famousExtra) delete D.officers[id];
  }
  while (D.officers.length && !D.officers[D.officers.length-1]) D.officers.pop();
}
export const extraSearchIds = (g,cid) => hasFamousRoster(g)
  ? FAMOUS_ROSTER.flatMap((o,i)=>o.city===cid ? [FAMOUS_ROSTER_START+i] : []) : [];
const recordExtra = (g, id) => hasFamousRoster(g) ? FAMOUS_ROSTER[id - FAMOUS_ROSTER_START] : undefined;
export function rosterRecordName(D,g,id) {
  if (g?.clones?.includes(id)) return D.officers[0].name;
  return recordExtra(g, id)?.name ?? D.officers[id]?.name;
}
export const recordOfficerVisual = (g, id) => recordExtra(g, id)?.visual;
