export const warlikeTier = (g) => g.warlike === true && g.warlikeTiers === true && [0, 1, 2].includes(g.level) ? g.level + 1 : 0;
export const warlikeName = (level) => ['初级', '中级', '上级'][level];
export const WARLIKE_TIP = '初级：更常搜将、每月补兵，沿用原有出兵门槛。中级：提高搜将和补兵，优先选择兵少的敌城。上级：增加战略命令和有限的金米收入，优先以城内补给恢复兵力。战斗规则保持一致。';
