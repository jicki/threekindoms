// 人物被动修订 8。数值均为判定阈值、最终伤害百分比或固定点数。
// 名将以编号和姓名共同匹配，编辑器可另行指定通用模板。
const profile = (name, text, effects) => ({ name, text, ...effects });

export const EXTRA_PASSIVES = {
  infantryDrill: profile('整步', '白兵步兵近战伤害＋5%', { troops: 5, attackKind: 'inf', closeCombat: true }),
  bowDrill: profile('习射', '白兵弓兵远射伤害＋5%', { troops: 5, attackKind: 'arc', rangedCombat: true }),
  horseDrill: profile('驭骑', '白兵骑兵近战伤害＋5%', { troops: 5, attackKind: 'cav', closeCombat: true }),
  shieldLine: profile('固阵', '白兵步兵受到兵队普攻伤害－5%', { guard: 5, guardKind: 'inf' }),
  openingTempo: profile('先阵', '白兵前两回合兵队普攻伤害＋4%', { troops: 4, attackRounds: 2 }),
  feintDrill: profile('持锋', '单挑牵制命中时伤害＋12%，伤害至少多1', { duelAttack: { feint: 12 } }),
  ambushEye: profile('辨险', '敌方对本人施展陷阱、虚兵或要击时，命中阈值－6', { ward: 6, wardIds: [1, 2, 3] }),
  fieldPlanner: profile('料敌', '陷阱、虚兵、要击命中阈值＋6', { strategy: 6, strategyIds: [1, 2, 3] }),
  woodland: profile('涉林', '战场穿过森林每格少耗1点，最低1点', { terrainMarch: 0 }),
  farm: profile('劝农', '开发土地额外＋2', { development: 2, developmentField: 'land' }),
  workshops: profile('督工', '开发产业额外＋2', { development: 2, developmentField: 'industry' }),
  settlement: profile('招徕', '开发人口额外＋2（200人）', { development: 2, developmentField: 'pop' }),
};

const SPECIALISTS = new Map([
  [38, '关羽', profile('武圣', '单挑首记普通攻击命中阈值＋10，之后普通攻击＋3', { duel: 3, firstDuelHit: 7 })],
  [153, '张飞', profile('当阳断喝', '单挑舍身命中阈值＋8', { duelHit: { desperate: 8 } })],
  [144, '赵云', profile('长坂护阵', '白兵前两回合兵队受到普攻伤害－10%', { guard: 10, guardRounds: 2 })],
  [180, '马超', profile('西凉驰突', '白兵骑兵近战伤害＋9%，前两回合生效', { troops: 9, attackKind: 'cav', closeCombat: true, attackRounds: 2 })],
  [75, '黄忠', profile('定军强弓', '白兵弓兵远射伤害＋10%', { troops: 10, attackKind: 'arc', rangedCombat: true })],
  [197, '庞统', profile('连舟设势', '连环命中阈值＋9，火计类损兵＋6%', { strategy: 9, strategyIds: [10], fire: 6 })],
  [55, '姜维', profile('陇右迂回', '战场穿过山地每格少耗1点，夹攻命中阈值＋5', { mountains: 1, strategy: 5, strategyIds: [16] })],
  [196, '法正', profile('汉中定策', '要击、落石和夹攻命中阈值＋9', { strategy: 9, strategyIds: [3, 9, 16] })],
  [156, '张辽', profile('逍遥先登', '白兵首回合兵队普攻伤害＋12%', { troops: 12, attackRounds: 1 })],
  [5, '于禁', profile('持军如律', '白兵步兵受到兵队普攻伤害－10%', { guard: 10, guardKind: 'inf' })],
  [149, '张郃', profile('巧变趋险', '战场穿过森林每格少耗1点，陷阱和要击命中阈值＋4', { terrainMarch: 0, strategy: 4, strategyIds: [1, 3] })],
  [111, '徐晃', profile('长驱整阵', '白兵每逢偶数回合回复2体力，前三回合步兵近战伤害＋5%', { recovery: 2, recoveryPeriod: 2, troops: 5, attackKind: 'inf', closeCombat: true, attackRounds: 3 })],
  [165, '典韦', profile('古恶来', '单挑受到普通攻击的伤害－12%', { duelDefense: { attack: 12 } })],
  [57, '许褚', profile('虎痴', '单挑舍身命中时伤害＋12%，伤害至少多1', { duelAttack: { desperate: 12 } })],
  [198, '庞德', profile('抬榇决死', '单挑体力不高于30时，普通攻击命中阈值＋8、舍身＋5', { lowHpDuelHit: { attack: 8, desperate: 5 } })],
  [169, '邓艾', profile('阴平越岭', '战场山地每格少耗1点，敌方落石命中阈值－8', { mountains: 1, ward: 8, wardIds: [9] })],
  [103, '钟会', profile('剑阁筹军', '白兵第2、4回合各恢复1点战术点，破阵命中阈值＋5', { tacticPeriod: 2, strategy: 5, strategyIds: [17] })],
  [30, '夏侯惇', profile('负创不退', '白兵每回合回复1体力，单挑受到舍身的伤害－10%', { recovery: 1, duelDefense: { desperate: 10 } })],
  [29, '夏侯渊', profile('神行远击', '600兵以上时平地每格少耗1点，白兵首回合弓兵远射伤害＋10%', { march: true, troops: 10, attackKind: 'arc', rangedCombat: true, attackRounds: 1 })],
  [99, '荀彧', profile('王佐筹治', '开发产业额外＋3，任太守时成功施舍额外提高1点统治', { development: 3, developmentField: 'industry', charity: 1 })],
  [258, '荀攸', profile('十二奇策', '陷阱、虚兵、要击、连弩命中阈值＋7', { strategy: 7, strategyIds: [1, 2, 3, 13] })],
  [24, '郭嘉', profile('奉孝料势', '虚兵、要击、破阵命中阈值＋8', { strategy: 8, strategyIds: [2, 3, 17] })],
  [22, '贾诩', profile('文和藏锋', '敌方虚兵、笼络、夹攻、破阵对本人命中阈值－10', { ward: 10, wardIds: [2, 8, 16, 17] })],
  [86, '司马懿', profile('深壁拒谋', '敌方对本人施计命中阈值－9', { ward: 9 })],
  [87, '司马师', profile('镇局持军', '白兵前四回合兵队受到普攻伤害－7%，第4回合恢复1点战术点', { guard: 7, guardRounds: 4, tacticPeriod: 4, tacticLimit: 1 })],
  [88, '司马昭', profile('合军伐蜀', '白兵前两回合兵队普攻伤害＋8%，夹攻命中阈值＋4', { troops: 8, attackRounds: 2, strategy: 4, strategyIds: [16] })],
  [93, '周瑜', profile('赤壁借势', '火计类损兵＋10%，火计和火箭命中阈值＋4，仍受天气削弱', { fire: 10, strategy: 4, strategyIds: [0, 5] })],
  [234, '吕蒙', profile('白衣涉江', '战场涉河每格少耗1点，乱水和连环命中阈值＋5', { terrainMarch: 3, strategy: 5, strategyIds: [4, 10] })],
  [213, '陆逊', profile('夷陵燎阵', '火计类损兵＋12%，白兵前两回合步兵受到普攻伤害－5%', { fire: 12, guard: 5, guardKind: 'inf', guardRounds: 2 })],
  [47, '甘宁', profile('锦帆夜袭', '乱水、水攻损兵＋8%，白兵首回合近战兵队伤害＋8%', { water: 8, troops: 8, closeCombat: true, attackRounds: 1 })],
  [141, '太史慈', profile('神射守势', '白兵弓兵远射伤害＋7%，单挑牵制命中时伤害＋8%（至少＋1）', { troops: 7, attackKind: 'arc', rangedCombat: true, duelAttack: { feint: 8 } })],
  [139, '孙翊', profile('锐气逼人', '单挑首记普通攻击命中阈值＋6，白兵首回合步兵近战伤害＋8%', { firstDuelHit: 6, troops: 8, attackKind: 'inf', closeCombat: true, attackRounds: 1 })],
  [235, '鲁肃', profile('江东盟略', '乱水、水攻损兵＋6%，乱水、水攻及笼络命中阈值＋6', { water: 6, strategy: 6, strategyIds: [4, 8, 12] })],
  [262, '张昭', profile('子布辅政', '开发各项成果＋2，任太守时成功施舍额外提高2点统治', { development: 2, charity: 2 })],
  [263, '张纮', profile('子纲营建', '开发人口额外＋3（300人），防灾成果＋2', { development: 3, developmentField: 'pop', prevention: 2 })],
  [107, '诸葛瑾', profile('江表劝和', '任太守时成功施舍额外提高2点统治，笼络命中阈值＋4', { charity: 2, strategy: 4, strategyIds: [8] })],
  [199, '步骘', profile('南土安边', '开发土地额外＋3、执行防灾成果＋1', { development: 3, developmentField: 'land', prevention: 1 })],
  [218, '吕布', profile('并州飞将', '单挑普通攻击命中阈值＋7，命中伤害＋8%（至少＋1）', { duel: 7, duelAttack: { attack: 8 } })],
  [51, '颜良', profile('白马锋先', '单挑首记普通攻击命中阈值＋8，白兵首回合步兵受到普攻伤害－6%', { firstDuelHit: 8, guard: 6, guardKind: 'inf', guardRounds: 1 })],
  [191, '文丑', profile('河北追锋', '白兵骑兵近战伤害＋7%，单挑舍身命中阈值＋3', { troops: 7, attackKind: 'cav', closeCombat: true, duelHit: { desperate: 3 } })],
  [37, '华雄', profile('汜水据阵', '白兵前两回合步兵受普攻伤害－8%，单挑普通攻击命中阈值＋3', { guard: 8, guardKind: 'inf', guardRounds: 2, duel: 3 })],
  [264, '张绣', profile('宛城骑锋', '白兵首回合骑兵近战伤害＋12%，要击命中阈值＋4', { troops: 12, attackKind: 'cav', closeCombat: true, attackRounds: 1, strategy: 4, strategyIds: [3] })],
  [242, '陈宫', profile('公台远谋', '普通远程计策范围＋1格，笼络命中阈值＋3', { range: 1, strategy: 3, strategyIds: [8] })],
  [206, '杨修', profile('德祖识机', '破阵命中阈值＋8，敌方陷阱对本人命中阈值－5', { strategy: 8, strategyIds: [17], ward: 5, wardIds: [1] })],
  [8, '袁绍', profile('河北列阵', '白兵前三回合兵队受到普攻伤害－6%', { guard: 6, guardRounds: 3 })],
  [112, '徐庶', profile('元直识局', '敌方火计、要击和乱水对本人命中阈值－10', { ward: 10, wardIds: [0, 3, 4] })],
  [131, '曹操', profile('孟德整军', '白兵第3、6回合各恢复1点战术点，破阵命中阈值＋4', { tacticPeriod: 3, strategy: 4, strategyIds: [17] })],
  [138, '孙策', profile('江东先驱', '白兵前两回合兵队近战伤害＋7%，单挑首记普通攻击命中阈值＋4', { troops: 7, attackRounds: 2, closeCombat: true, firstDuelHit: 4 })],
  [173, '董卓', profile('凉州重锋', '白兵骑兵近战伤害＋8%，单挑受到普通攻击的伤害－5%', { troops: 8, attackKind: 'cav', closeCombat: true, duelDefense: { attack: 5 } })],
  [182, '马腾', profile('扶风行军', '600兵以上时平地每格少耗1点，白兵骑兵受到兵队普攻伤害－6%', { march: true, guard: 6, guardKind: 'cav' })],
  [192, '文聘', profile('江夏固守', '白兵步兵受到兵队普攻伤害－7%，连弩命中阈值＋5', { guard: 7, guardKind: 'inf', strategy: 5, strategyIds: [13] })],
  [220, '刘璋', profile('益州安业', '开发土地额外＋2，任太守时成功施舍额外提高2点统治', { development: 2, developmentField: 'land', charity: 2 })],
  [222, '刘备', profile('同袍持阵', '白兵前两回合兵队受到普攻伤害－5%，每回合自身回复1体力', { guard: 5, guardRounds: 2, recovery: 1 })],
  [237, '孙尚香', profile('弓腰逐阵', '白兵前两回合弓兵远射伤害＋12%，单挑牵制命中时伤害＋6%（至少＋1）', { troops: 12, attackKind: 'arc', rangedCombat: true, attackRounds: 2, duelAttack: { feint: 6 } })],
  [241, '王异', profile('冀城御谋', '连弩命中阈值＋8，敌方伪击转杀对本人命中阈值－7', { strategy: 8, strategyIds: [13], ward: 7, wardIds: [6] })],
  [243, '高顺', profile('陷阵厉卒', '白兵前两回合步兵近战伤害＋10%，步兵受到兵队普攻伤害－4%', { troops: 10, attackKind: 'inf', closeCombat: true, attackRounds: 2, guard: 4, guardKind: 'inf' })],
  [244, '陈到', profile('白毦护卫', '白兵步兵受到兵队普攻伤害－8%，单挑受到舍身的伤害－5%', { guard: 8, guardKind: 'inf', duelDefense: { desperate: 5 } })],
  [246, '公孙瓒', profile('白马疾援', '600兵以上时平地每格少耗1点，白兵首回合骑兵受到兵队普攻伤害－10%', { march: true, guard: 10, guardKind: 'cav', guardRounds: 1 })],
  [247, '袁术', profile('淮南聚众', '开发人口额外＋3（300人），白兵首回合兵队近战伤害＋4%', { development: 3, developmentField: 'pop', troops: 4, attackRounds: 1, closeCombat: true })],
  [248, '刘表', profile('荆襄绥民', '任太守时成功施舍额外提高1点统治，执行防灾成果＋2', { charity: 1, prevention: 2 })],
  [254, '田豫', profile('北境善守', '白兵前三回合骑兵受到兵队普攻伤害－8%，执行防灾成果＋1', { guard: 8, guardKind: 'cav', guardRounds: 3, prevention: 1 })],
  [256, '黄祖', profile('江汉扼流', '战场涉河每格少耗1点，乱水和水攻损兵＋9%', { terrainMarch: 3, water: 9 })],
  [259, '牵招', profile('戍边巡林', '战场穿过森林每格少耗1点，白兵骑兵受到兵队普攻伤害－5%', { terrainMarch: 0, guard: 5, guardKind: 'cav' })],
  [261, '祝融夫人', profile('南中飞锋', '战场穿过山地每格少耗1点，单挑牵制命中时伤害＋10%（至少＋1）', { mountains: 1, duelAttack: { feint: 10 } })],
].map(([id, name, ability]) => [id, { name, ability }]));

const MARTIAL = ['infantryDrill', 'bowDrill', 'horseDrill', 'shieldLine', 'openingTempo', 'feintDrill', 'endure', 'woodland'];
const STRATEGIST = ['calculate', 'fieldPlanner', 'ambushEye', 'farm', 'workshops', 'settlement', 'repair', 'goodwill'];
const GENERAL = ['county', 'farm', 'workshops', 'settlement', 'repair', 'goodwill', 'shieldLine', 'openingTempo'];

export function revisedOfficerPassive(officer, templates) {
  const entry = SPECIALISTS.get(officer.id);
  if (!officer.clone) {
    if (officer.name === '诸葛亮' && officer.id === 109) return templates.kongming;
    if (entry?.name === officer.name) return entry.ability;
  }
  const list = officer.war >= 60 && officer.war >= officer.int + 6 ? MARTIAL
    : officer.int >= 65 && officer.int >= officer.war + 6 ? STRATEGIST : GENERAL;
  return templates[list[officer.id % list.length]];
}

export const developmentBonus = (passive, field) => !passive?.developmentField || passive.developmentField === field ? passive?.development ?? 0 : 0;
export const strategyBonus = (passive, id) => !passive?.strategyIds || passive.strategyIds.includes(id) ? passive?.strategy ?? 0 : 0;
export const strategyWard = (passive, id) => !passive?.wardIds || passive.wardIds.includes(id) ? passive?.ward ?? 0 : 0;
