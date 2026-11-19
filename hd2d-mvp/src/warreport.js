// Battle report presentation, after resolveWar has placed every officer.
import { cityName, officerCity, isRuler, DEAD, RONIN } from './core/game.js';

export function warFate(g, war, res, id) {
  const o = g.officers[id];
  if (war.raid && war.def.ids.includes(id) && o.status === RONIN) return [`下野（${cityName(o.loc)}）`, 'bad'];
  if (war.raid && war.att.ids.includes(id)) return res.captured.byDef.includes(id) ? ['被擒后释放', 'bad'] : ['退散', 'bad', res.dead.includes(id)];
  if (res.dead.includes(id)) return ['阵亡', 'bad', true];
  // checkFactions runs after the report (and may ask the player to choose an heir).
  // 原版无路可退的君主会身亡；受不战死保护的君主保持下野。
  if (o.status === DEAD || (o.status === RONIN && isRuler(g, id) && !o.warRulerRonin)) return ['无路可退，身亡', 'bad', true];
  if (o.status === RONIN) return [`下野（${cityName(o.loc)}）`, 'bad'];
  const city = officerCity(g, id), captured = res.captured.byAtt.includes(id) || res.captured.byDef.includes(id);
  if (captured) return [`被俘归顺${city ? `（${cityName(city.id)}）` : ''}`, 'bad'];
  if (war.support?.ids.includes(id) && city?.faction === war.support.faction) return [`归队（${cityName(city.id)}）`, 'good'];
  if (city && (city.id !== war.city || res.retreated.some((x) => x.id === id))) {
    const retreat = res.survivors[res.loser].includes(id) || res.retreated.some((x) => x.id === id);
    return [`${retreat ? '退往' : '前往'}${cityName(city.id)}`, ''];
  }
  return ['生还', 'good'];
}
