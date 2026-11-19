export const compactMap = (g) => g?.campaignRevision >= 7;

export function cityIntel(g, city, neutral) {
  if (city.faction === g.player || city.faction === neutral) return true;
  const seen = g.scouted?.[city.id], month = g.year * 12 + g.month;
  if (!compactMap(g)) return (seen ?? -1) >= month - 3;
  return Number.isInteger(seen) && seen >= month - 3 && seen <= month && g.scoutedOwner?.[city.id] === city.faction;
}

export function scoutCityIntel(g, city) {
  (g.scouted ??= {})[city.id] = g.year * 12 + g.month;
  if (compactMap(g)) (g.scoutedOwner ??= {})[city.id] = city.faction;
}

export function invalidateCityIntel(g) {
  if (!compactMap(g) || !g.scoutedOwner) return;
  for (const [id, owner] of Object.entries(g.scoutedOwner)) if (g.cities[id]?.faction !== owner) {
    delete g.scoutedOwner[id];
    if (g.scouted) delete g.scouted[id];
  }
}
