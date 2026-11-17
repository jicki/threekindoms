// 仅对明确含义的内置关系启用效果。自定义名称不推断好恶；双方既有亲近又有敌对关系时抵消。
import { realChance } from './origrng.js';

const FRIENDLY = new Set(['亲属', '夫妻', '朋友', '师徒', '父子', '父女', '母子', '母女', '兄弟', '姐妹', '兄妹', '姐弟', '结义', '君臣', '同僚', '姻亲']);
const HOSTILE = new Set(['对手', '宿敌']);

export function relationDisposition(data, g, a, b) {
  if (g.relationshipEffects !== true || a == null || b == null || a === b) return 0;
  let friendly = false, hostile = false;
  for (const rel of data.relationships ?? []) {
    if (!((rel.from === a && rel.to === b) || (rel.from === b && rel.to === a))) continue;
    friendly ||= FRIENDLY.has(rel.kind); hostile ||= HOSTILE.has(rel.kind);
  }
  return Number(friendly) - Number(hostile);
}

// 招募考虑招募方及原势力君主，但两边和多条关系都不能叠加到超过一个档位。
export function recruitDisposition(data, g, faction, id, otherFaction = null) {
  const own = relationDisposition(data, g, g.factions[faction]?.ruler, id);
  const other = relationDisposition(data, g, g.factions[otherFaction]?.ruler, id);
  return Math.max(-1, Math.min(1, own - other));
}

export function recruitThreshold(data, g, faction, id, base, otherFaction = null, weighted = true) {
  const direction = recruitDisposition(data, g, faction, id, otherFaction);
  if (!direction || base <= 0 || base >= 100) return base;
  if (!weighted) return Math.max(1, Math.min(99, base + direction * 5));
  // 原版随机表不均匀；以实际概率差限制在 5 个百分点内。
  const original = realChance(base);
  let next = base;
  if (direction > 0) while (next < 99 && realChance(next + 1) - original <= 5) next++;
  else while (next > 1 && original - realChance(next - 1) <= 5) next--;
  return next;
}

export function recruitLoyaltyWithRelation(data, g, faction, id, loyalty) {
  const direction = relationDisposition(data, g, g.factions[faction]?.ruler, id);
  // 不降低游戏或管理员已设定的高忠诚，也不改变无关人物的初始值。
  return !direction || loyalty >= 90 ? loyalty : Math.max(0, Math.min(90, loyalty + direction * 5));
}
