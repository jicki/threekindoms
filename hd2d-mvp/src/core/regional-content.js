// 君主列传修订 10 的编号只追加；登场年份与据点为游戏安排，未知出生资料留空。
export const REGIONAL_REVISION = 10;
export const OFFICER_ROSTER_REVISION = 11;
export const hasRegionalContent = (g) => g?.famousRoster === 2 || g?.famousRoster === 3;
export const REGIONAL_OFFICERS = [
  { key: 'qiaozhou', name: '谯周', title: '蜀·名臣', hp: 65, war: 23, int: 88, virtue: 79, year: 238, death: 270,
    city: 26, weapon: 34, armor: 0, army: '平',
    passive: { name: '蜀学传经', text: '开发人口额外＋2（200人），防灾成果＋1', development: 2, developmentField: 'pop', prevention: 1 } },
  { key: 'luoxian', name: '罗宪', title: '蜀·名将', hp: 85, war: 83, int: 80, virtue: 86, year: 250, death: 270,
    city: 31, weapon: 12, armor: 2, army: '平', troopType: 'shield',
    passive: { name: '永安坚垒', text: '白兵前三回合步兵受到普攻伤害－9%，敌方伪击转杀命中阈值－4', guard: 9, guardKind: 'inf', guardRounds: 3, ward: 4, wardIds: [6] } },
  { key: 'manchong', name: '满宠', title: '魏·名臣', hp: 80, war: 71, int: 87, virtue: 76, year: 196, death: 242,
    city: 14, weapon: 9, armor: 2, army: '平',
    passive: { name: '移城固守', text: '防灾成果＋2，连弩命中阈值＋5', prevention: 2, strategy: 5, strategyIds: [13] } },
  { key: 'chentai', name: '陈泰', title: '魏·名将', hp: 85, war: 80, int: 86, virtue: 83, year: 240, death: 260,
    city: 8, weapon: 18, armor: 2, army: '山', troopType: 'spear',
    passive: { name: '陇右却围', text: '战场穿过山地每格少耗1点，白兵第二回合恢复1点战术点', mountains: 1, tacticPeriod: 2, tacticLimit: 1 } },
  { key: 'jiangqin', name: '蒋钦', title: '吴·名将', hp: 84, war: 83, int: 69, virtue: 84, year: 195, death: 219,
    city: 15, weapon: 36, armor: 2, army: '水', troopType: 'bow',
    passive: { name: '濡须应变', text: '白兵首回合弓兵远射伤害＋8%，乱水命中阈值＋5', troops: 8, attackKind: 'arc', rangedCombat: true, attackRounds: 1, strategy: 5, strategyIds: [4] } },
  { key: 'panjun', name: '潘濬', title: '吴·名臣', hp: 75, war: 50, int: 85, virtue: 72, year: 219, death: 239,
    city: 21, weapon: 40, armor: 1, army: '水',
    passive: { name: '督治荆事', text: '开发产业额外＋2，任太守时成功施舍额外提高1点统治', development: 2, developmentField: 'industry', charity: 1 } },
  { key: 'zangba', name: '臧霸', title: '魏·群雄名将', hp: 86, war: 86, int: 70, virtue: 77, year: 198, death: 235,
    city: 3, weapon: 11, armor: 2, army: '山', troopType: 'lightcav',
    passive: { name: '青徐劲骑', text: '白兵前三回合骑兵近战伤害＋7%，单挑牵制命中阈值＋4', troops: 7, attackKind: 'cav', closeCombat: true, attackRounds: 3, duelHit: { feint: 4 } } },
  { key: 'chendeng', name: '陈登', title: '徐州·名臣', hp: 73, war: 50, int: 88, virtue: 81, year: 193, death: 210,
    city: 10, weapon: 34, armor: 1, army: '水',
    passive: { name: '广陵屯田', text: '开发土地额外＋3，要击命中阈值＋4', development: 3, developmentField: 'land', strategy: 4, strategyIds: [3] } },
];

// 修订 11 的人物接在修订 10 名单末尾。城池和登场时间为寻访安排。
export const ADDITIONAL_OFFICERS = [
  { key: 'chenqun', name: '陈群', title: '魏·名臣', hp: 70, war: 32, int: 91, virtue: 85, year: 196, death: 236,
    courtesy: '长文', bio: '曾任刘备别驾，后仕曹魏，制定九品官人法并受遗诏辅政。',
    city: 14, weapon: 34, armor: 0, army: '平', relations: [[268, '父子']],
    passive: { name: '九品举才', text: '有已到登场年份的人才时，寻访落空有1/8机会重试一次；电脑由太守发动', searchRetry: true } },
  { key: 'zhongyao', name: '钟繇', title: '魏·名臣', hp: 75, war: 52, int: 89, virtue: 87, year: 192, death: 230,
    courtesy: '元常', bio: '曾参与护送汉献帝出长安，后督关中诸军。',
    city: 8, weapon: 34, armor: 1, army: '平', relations: [[131, '君臣']],
    passive: { name: '持节镇关', text: '防灾成果＋1，敌方笼络和破阵对本人命中阈值－6', prevention: 1, ward: 6, wardIds: [8, 17] } },
  { key: 'zongyu', name: '宗预', title: '蜀·名臣', hp: 76, war: 56, int: 84, virtue: 83, year: 234, death: 264,
    courtesy: '德艳', bio: '多次奉使东吴维护两国交好，晚年曾督永安。',
    city: 31, weapon: 1, armor: 1, army: '平', relations: [[170, '同僚']],
    passive: { name: '东聘通好', text: '担任使者时，结盟报价减少8%', allianceDiscount: 8 } },
  { key: 'donghe', name: '董和', title: '蜀·名臣', hp: 72, war: 36, int: 85, virtue: 90, year: 200, death: 221,
    courtesy: '幼宰', bio: '任成都令时以俭治民，后与诸葛亮同署大司马府事。',
    city: 26, weapon: 0, armor: 0, army: '平', relations: [[168, '父子']],
    passive: { name: '清约安民', text: '任太守的城市受洪水或旱灾时，人口损失减少15%', disasterPopulation: 15 } },
  { key: 'liuba', name: '刘巴', title: '蜀·名臣', hp: 67, war: 27, int: 90, virtue: 70, year: 210, death: 222,
    courtesy: '子初', bio: '蜀中掌文书与财政，曾建议以新钱平准物价。',
    city: 24, weapon: 40, armor: 0, army: '平',
    passive: { name: '平准理财', text: '任太守时，米市卖米每100米多得5金，卖价最高为买入成本', riceSale: 5 } },
  { key: 'zhangyi', name: '张裔', title: '蜀·名臣', hp: 74, war: 61, int: 85, virtue: 84, year: 214, death: 230,
    courtesy: '君嗣', bio: '曾任巴郡太守、司金中郎将，掌造农具和军器。',
    city: 31, weapon: 2, armor: 1, army: '平', relations: [[109, '同僚']],
    passive: { name: '司金修备', text: '执行防灾成果＋3', prevention: 3 } },
  { key: 'wanglian', name: '王连', title: '蜀·名臣', hp: 69, war: 37, int: 82, virtue: 86, year: 212, death: 225,
    courtesy: '文仪', bio: '任司盐校尉，经营盐铁以助国用，并荐拔属吏。',
    city: 26, weapon: 0, armor: 0, army: '平',
    passive: { name: '盐铁裕用', text: '开发产业成果＋3', development: 3, developmentField: 'industry' } },
  { key: 'lukai', name: '陆凯', title: '吴·名臣', hp: 78, war: 69, int: 88, virtue: 91, year: 222, death: 269,
    courtesy: '敬风', bio: '陆逊族子，曾督巴丘，官至左丞相，多次进谏减轻民负。',
    city: 15, weapon: 2, armor: 2, army: '水', relations: [[213, '亲属']],
    passive: { name: '息役安民', text: '任太守且统治低于60时，成功施舍额外提高2点统治', charity: 2, charityBelow: 60 } },
  { key: 'huojun', name: '霍峻', title: '蜀·名将', hp: 87, war: 84, int: 78, virtue: 85, year: 208, death: 217,
    courtesy: '仲邈', bio: '刘表死后归刘备，曾以数百人守葭萌，久围后出击破敌。',
    city: 30, weapon: 16, armor: 2, army: '山', troopType: 'shield', relations: [[222, '君臣']],
    passive: { name: '葭萌坚守', text: '守城白兵开战兵力少于攻方时，首回合步兵受到的兵队普攻伤害－8%', guard: 8, guardKind: 'inf', guardRounds: 1, guardOutnumberedCastle: true } },
  { key: 'lukang', name: '陆抗', title: '吴·名将', hp: 87, war: 86, int: 91, virtue: 88, year: 245, death: 274, birthYear: 226,
    courtesy: '幼节', bio: '陆逊之子，曾督西陵等地，在西陵之役阻退晋军援兵。',
    city: 15, weapon: 2, armor: 2, army: '水', troopType: 'heavyspear', relations: [[213, '父子']],
    passive: { name: '西陵持重', text: '白兵第5回合结束时恢复1点战术点，每场最多一次', tacticPeriod: 5, tacticLimit: 1 } },
  { key: 'wenyang', name: '文鸯', title: '魏末·名将', hp: 91, war: 93, int: 65, virtue: 78, year: 255, death: 291,
    jp: '文俶', courtesy: '次骞', bio: '本名文俶，文钦之子，曾在乐嘉夜袭司马师军。',
    city: 16, weapon: 18, armor: 2, army: '平', troopType: 'lightcav',
    passive: { name: '乐嘉突阵', text: '白兵首回合骑兵近战伤害＋9%', troops: 9, attackKind: 'cav', closeCombat: true, attackRounds: 1 } },
];

// 保留 0–56 的装备编号，城内、战场与电脑共用同一份售卖配置。
const FIRST_WEAPON = 57;
export const REGIONAL_WEAPONS = [
  { name: '环首刀', cat: '刀', icon: 'ring-saber', grade: 2, atk: 7, weight: 3, price: 130, shops: [30, 32] },
  { name: '飞涛刀', cat: '刀', icon: 'bronze-saber', grade: 3, atk: 12, weight: 5, price: 235, shops: [15, 31], requirements: { war: 65 } },
  { name: '陇锋刀', cat: '刀', icon: 'jade-saber', grade: 4, atk: 16, weight: 7, price: 355, shops: [8, 25], requirements: { war: 83 } },
  { name: '襄水扇', cat: '扇', icon: 'river-fan', grade: 2, atk: 6, weight: 2, price: 125, shops: [13, 30] },
  { name: '青翎扇', cat: '扇', icon: 'feather-fan', grade: 3, atk: 9, weight: 3, price: 190, shops: [20, 21], requirements: { int: 67 } },
  { name: '文竹扇', cat: '扇', icon: 'bamboo-fan', grade: 4, atk: 12, weight: 4, price: 290, shops: [26, 31], requirements: { int: 82 } },
  { name: '藤弦弓', cat: '弓', icon: 'hunt-bow', grade: 2, atk: 5, weight: 3, price: 105, shops: [17, 38] },
  { name: '凉州角弓', cat: '弓', icon: 'horn-bow', grade: 3, atk: 10, weight: 4, price: 205, shops: [6, 8], requirements: { war: 64 } },
  { name: '江潮弓', cat: '弓', icon: 'tide-bow', grade: 4, atk: 13, weight: 5, price: 320, shops: [15, 30], requirements: { war: 78 } },
].map((item, index) => ({ ...item, id: FIRST_WEAPON + index, kind: 'weapon', dfn: 0, regional: true }));

export function addRegionalStock(data) {
  if (data.equipment[FIRST_WEAPON]?.regional) return;
  if (data.equipment.length !== FIRST_WEAPON) throw new Error('内置装备编号与地方货架不匹配');
  for (const item of REGIONAL_WEAPONS) {
    data.equipment.push(structuredClone(item));
    for (const cid of item.shops) {
      const city = data.cities[cid];
      if (!city?.facilities.weapons) continue; // 早期扩展地图数据没有夷洲。
      for (const key of ['shop', 'field_shop', 'ai_shop']) city[key].push(item.id);
    }
  }
}
