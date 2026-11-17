// 新版低频内政事件：同一势力至少间隔两年，同月不叠加本势力灾害、战争或袭城。
export function chooseCampaignEvent(g, faction, { rng, isPass }) {
  if (g.campaignRules !== true || g.over || g.raidBattle || g.year < 190 || g.factions[faction]?.ruler == null) return null;
  const now = g.year * 12 + g.month;
  const h = (g.campaignEventHistory ??= { last: null, factions: {}, checked: {} });
  if (h.checked[faction] === now) return null;
  h.checked[faction] = now;
  if (h.last === now || now - (h.factions[faction] ?? -Infinity) < 24 || g.disasterFactions?.[faction] === now
    || g.raidHistory?.factions?.[faction] === now || g.raidWars?.[faction] === now) return null;
  const cities = g.cities.filter((c) => c.faction === faction && !isPass(c.id) && c.officers.length && c.gold >= 80
    && (c.disaster < 100 || c.land < 999 || c.rice < 9999));
  if (!cities.length || rng(g)(100) >= 3) return null;
  const city = cities.sort((a, b) => a.disaster - b.disaster || a.id - b.id)[0];
  h.last = now; h.factions[faction] = now;
  return { faction, city: city.id };
}

// 选择时再次检查归属和资源；重复或过期选择不得扣费或重复领取。
export function applyCampaignEvent(g, event, choice) {
  if (!event || !['works', 'rice'].includes(choice)) return false;
  const city = g.cities[event.city], now = g.year * 12 + g.month, h = g.campaignEventHistory;
  if (!city || city.faction !== event.faction || city.gold < 80 || h?.factions?.[event.faction] !== now || h.applied === now) return false;
  if ((choice === 'works' && city.disaster >= 100 && city.land >= 999) || (choice === 'rice' && city.rice >= 9999)) return false;
  city.gold -= 80;
  if (choice === 'works') {
    if (city.disaster < 100) city.disaster = Math.min(100, city.disaster + 5);
    if (city.land < 999) city.land = Math.min(999, city.land + 3);
  } else city.rice = Math.min(9999, city.rice + 100);
  h.applied = now;
  return true;
}
