// 仅内置君主列传的新开局使用这份名单。编号与名称同时核对，避免动态人物或复制角色误领。
// 身份标记用于说明史料及演义依据，不代表技能名称或效果出自史书。
import { DUEL_SKILLS } from './duel-skills.js';

// 第二套名单按用户指定的名将与名臣维护。名称取材事迹，效果为游戏设定。
const ROSTER_V2 = {
  38:['关羽','蜀·名将',null,'青龙斩',-5,120], 153:['张飞','蜀·名将',null,'长坂怒击',-15,130],
  144:['赵云','蜀·名将',null,'龙胆突刺',10,105], 180:['马超','蜀·名将',null,'锦骑破阵',-5,120], 75:['黄忠','蜀·名将',null,'定军奋击',5,110],
  109:['诸葛亮','蜀·名臣',16],197:['庞统','蜀·名臣',35],55:['姜维','蜀·名臣',36],196:['法正','蜀·名臣',37],
  156:['张辽','魏·名将',null,'逍遥突击',5,115],5:['于禁','魏·名将',null,'持军奋击',5,110],149:['张郃','魏·名将',null,'巧变突击',5,110],
  111:['徐晃','魏·名将',null,'长驱破围',0,115],165:['典韦','魏·名将',null,'古恶来击',-10,125],57:['许褚','魏·名将',null,'虎痴猛击',-10,125],
  198:['庞德','魏·名将',null,'抬榇奋击',-5,120],169:['邓艾','魏·名将',null,'阴平奇袭',5,110],103:['钟会','魏·名将',null,'剑阁进击',0,110],
  30:['夏侯惇','魏·名将',null,'刚烈突击',-5,115],29:['夏侯渊','魏·名将',null,'神行袭击',5,110],
  99:['荀彧','魏·名臣',38],258:['荀攸','魏·名臣',32],24:['郭嘉','魏·名臣',21],22:['贾诩','魏·群雄名臣',39],
  86:['司马懿','魏·名臣',22],87:['司马师','魏·名臣',40],88:['司马昭','魏·名臣',41],
  93:['周瑜','吴·名将名臣',17,'赤壁奋击',5,110],234:['吕蒙','吴·名将',null,'白衣突击',5,110],213:['陆逊','吴·名将',null,'夷陵破阵',0,110],
  47:['甘宁','吴·名将',null,'锦帆突袭',5,115],141:['太史慈','吴·名将',null,'神亭奋击',0,115],139:['孙翊','吴·名将',null,'骁勇奋击',-5,115],
  235:['鲁肃','吴·名臣',42],262:['张昭','吴·名臣',43],263:['张纮','吴·名臣',44],107:['诸葛瑾','吴·名臣',45],199:['步骘','吴·名臣',46],
  218:['吕布','群雄·名将',null,'飞将破阵',-10,120],51:['颜良','群雄·名将',null,'河北锐击',-5,120],191:['文丑','群雄·名将',null,'河北猛击',-5,120],
  37:['华雄','群雄·名将',null,'汜水猛击',-5,115],264:['张绣','群雄·名将',null,'宛城突袭',5,110],242:['陈宫','群雄·名臣',18],206:['杨修','群雄·名臣',47],
};
export const ROSTER_V2_STRATEGIES = [
  ['凤雏连策',10,100,0,1,0],['祁山筹谋',10,100,0,1,0],['汉中奇谋',10,110,1,0,0],['王佐筹策',9,60,0,1,30],
  ['文和奇谋',11,90,2,1,0],['持重定乱',10,90,0,1,20],['伐蜀筹谋',10,100,0,1,0],['江东盟谋',9,60,0,1,30],
  ['子布辅政',9,60,0,1,20],['子纲筹略',9,70,0,1,20],['江表谏策',9,60,1,1,0],['南土安边',9,65,0,1,15],['德祖识机',9,70,1,1,0],
].map(([name,cost,soldiers,hp,stop,rice],i)=>({id:35+i,name,cost,soldiers,hp,stop,rice,maxUses:2}));
export const strategySpecs = (D,g) => g?.famousSkills===2 ? [...(D?.customSkills ?? []),...ROSTER_V2_STRATEGIES] : D?.customSkills ?? [];
const entryV2 = (D,g,id) => { const e=ROSTER_V2[id],o=D?.officers?.[id]; return g?.famousSkills===2 && e && o && !o.clone && o.name===e[0] ? e : null; };

const FAMOUS = {
  18: ['蒯越','谋士',29], 24: ['郭嘉','谋士',21], 38: ['关羽','名将',null,'qinglong'],
  57: ['许褚','名将',null,'huchi'], 59: ['纪灵','演义武将',null,'sanjian'], 75: ['黄忠','名将',null,'laojiang'],
  86: ['司马懿','名将',22], 93: ['周瑜','名将',17], 109: ['诸葛亮','谋士',16],
  144: ['赵云','名将',null,'longdan'], 153: ['张飞','名将',null,'yanren'], 156: ['张辽','名将',null,'xiaoyao'],
  192: ['文聘','名将',null,'zhenjiang'], 218: ['吕布','名将',null,'fangtian'],
  237: ['孙尚香','演义武将',null,'gongyao'], 241: ['王异','守城谋士',20], 242: ['陈宫','谋士',18],
  243: ['高顺','名将',null,'xianzhen'], 244: ['陈到','名将',null,'baier'], 246: ['公孙瓒','名将',24,'baima'],
  247: ['袁术','群雄',25], 248: ['刘表','群雄',26], 254: ['田豫','名将',30], 256: ['黄祖','名将',31],
  258: ['荀攸','谋士',32], 259: ['牵招','名将',33], 261: ['祝融夫人','演义武将',null,'zhurong'],
};
const STRATEGY_NAMES = { 17:'赤壁烈谋', 18:'公台断谋', 20:'冀城九策', 21:'奉孝奇谋', 22:'鹰视潜谋',
  24:'白马掩袭', 25:'淮南筹粮', 29:'异度定荆', 31:'江汉扼流', 32:'公达奇谋', 33:'北境镇边' };
const DUEL_NAMES = { sanjian:'三尖破阵', laojiang:'定军奋击', yanren:'长坂怒击', fangtian:'飞将破阵',
  xianzhen:'陷阵破军', baima:'白马冲阵', zhurong:'南中飞刀' };
const entry = (D,g,id) => {
  const e=FAMOUS[id], o=D?.officers?.[id];
  return g?.famousSkills === true && e && o && !o.clone && o.name===e[0] ? e : null;
};
export function famousLabel(D,g,id) { return (g?.famousSkills===2 ? entryV2(D,g,id) : entry(D,g,id))?.[1] ?? null; }
export function abilityStrategyIds(D,g,id) {
  const skills=D?.officers?.[id]?.skills ?? [];
  if (g?.famousSkills===2) { const e=entryV2(D,g,id); return e?.[2] != null ? [e[2]] : []; }
  if (g?.famousSkills !== true) return skills;
  const e=entry(D,g,id); return e?.[2] != null && skills.includes(e[2]) ? [e[2]] : [];
}
export function abilityStrategy(D,g,skill) {
  if (!skill) return null;
  const name=(g?.famousSkills === true || g?.famousSkills===2) ? STRATEGY_NAMES[skill.id] : null;
  return name ? { ...skill, name, legacyName:skill.name } : skill;
}
export function abilityDuel(D,g,id) {
  if (g?.famousSkills===2) { const e=entryV2(D,g,id); return e?.[3] ? {name:e[3],hit:e[4],damage:e[5]} : null; }
  const key=D?.officers?.[id]?.duelSkill;
  if (typeof key !== 'string' || !Object.hasOwn(DUEL_SKILLS,key)) return null;
  if (g?.famousSkills !== true) return DUEL_SKILLS[key];
  if (entry(D,g,id)?.[3] !== key) return null;
  const skill=DUEL_SKILLS[key], name=DUEL_NAMES[key];
  return name ? { ...skill,name } : skill;
}
