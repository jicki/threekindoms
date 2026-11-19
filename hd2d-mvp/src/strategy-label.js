import { NONE, cityName, factionName } from './core/game.js';
import { cityIntel, compactMap } from './core/strategy-intel.js';

export function setCityLabel(el, game, city, officerCount) {
  const compact = compactMap(game);
  el.classList.toggle('compact-city', compact);
  const name = cityName(city.id), faction = factionName(game, city.faction);
  const detail = document.createElement('small');
  if (!compact) {
    const count = officerCount(city);
    detail.textContent = faction + (count ? `·${count}将` : '');
    el.replaceChildren(name, detail);
    el.removeAttribute('aria-label');
    return;
  }
  detail.textContent = '无主';
  el.replaceChildren(name, ...(city.faction === NONE ? [detail] : []));
  const known = cityIntel(game, city, NONE);
  el.setAttribute('aria-label', [name, faction, known ? null : '未侦察'].filter(Boolean).join('，'));
}
