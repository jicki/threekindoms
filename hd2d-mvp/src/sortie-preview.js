import { h } from './ui.js';
import { cityName, factionName, NONE, roads } from './core/game.js';
import { battleEntryDirection, resolveBattlefield } from './core/battlefields.js';
import { advancedBattle, battleWeather, WEATHER_NAMES } from './core/battle-rules.js';
import { cityIntel } from './core/strategy-intel.js';
import { defenseCandidates } from './core/warcore.js';
import { gateNormal, siegeExtent } from './core/siege.js';
import { FOREST, SAND, RIVER, MOUNT } from './core/field.js';
import { POST_MOBILITY } from './core/battle-approaches.js';
import { APPROACH_COLORS, paintApproaches } from './war/approach-display.js';

const DIRECTIONS = { n: '北', e: '东', s: '南', w: '西' };
const TERRAIN = ['#42563f', '#987d51', '#727956', '#3a738d', '#635d57', '#c89258'];
const MARKS = { attack: '#9fdff5', wall: '#b29d7a', gate: '#ffe389', court: '#9b683f' };

function planMap({ map, dep, siege, approaches }) {
  const cell = 8, canvas = h('canvas', { width: map[0].length * cell, height: map.length * cell,
    role: 'img', 'aria-label': '战场俯视图，上北下南' });
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const tile = (x, y, color) => { ctx.fillStyle = color; ctx.fillRect(x * cell, y * cell, cell, cell); };
  map.forEach((row, y) => row.forEach((terrain, x) => tile(x, y, TERRAIN[terrain])));
  paintApproaches(ctx, approaches, cell);
  if (siege) {
    for (const { x, y } of siege.walls) tile(x, y, MARKS.wall);
    for (const { x, y } of siege.gates) tile(x, y, MARKS.gate);
    tile(siege.cx, siege.cy, MARKS.court);
  }
  // 攻方布阵格用轮廓标记，保留格内真实地形颜色。
  ctx.strokeStyle = MARKS.attack;
  ctx.lineWidth = 2;
  if (dep.attackerZones) {
    for (const zone of dep.attackerZones) {
      const keys = new Set(zone.cells.map(([x, y]) => `${x},${y}`));
      ctx.beginPath();
      for (const [x, y] of zone.cells) for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        if (keys.has(`${x + dx},${y + dy}`)) continue;
        const cx = (x + 0.5 + dx * 0.5) * cell, cy = (y + 0.5 + dy * 0.5) * cell;
        ctx.moveTo(cx - dy * cell / 2, cy - dx * cell / 2); ctx.lineTo(cx + dy * cell / 2, cy + dx * cell / 2);
      }
      ctx.stroke();
    }
  } else {
    const [x0, x1, y0, y1] = dep.attacker_rect;
    ctx.strokeRect(x0 * cell + 1, y0 * cell + 1, (x1 - x0 + 1) * cell - 2, (y1 - y0 + 1) * cell - 2);
  }
  return canvas;
}

function outerTerrain(map, siege) {
  const [rx, ry] = siegeExtent(siege, 'moat'), surrounding = new Set();
  for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) {
    if (Math.abs(x) === rx || Math.abs(y) === ry) surrounding.add(map[siege.cy + y]?.[siege.cx + x]);
  }
  return [[RIVER, '护城河或水岸'], [SAND, '旱壕'], [MOUNT, '岩坡'], [FOREST, '外围林地']]
    .filter(([terrain]) => surrounding.has(terrain)).map(([, label]) => label).join('、');
}

function defenseIntel(g, target) {
  if (!advancedBattle(g)) return null;
  if (!cityIntel(g, target, NONE)) return '尚未侦察目标，守军及援军未知。';
  if (target.faction === NONE && !target.officers.length) return null;
  const candidates = target.officers.length ? defenseCandidates(g, g.player, target.faction, target.id) : [];
  const visible = candidates.filter(({ city }) => cityIntel(g, g.cities[city], NONE))
    .sort((a, b) => a.city - b.city).map(({ city, faction, ids }) => `${cityName(city)}（${factionName(g, faction)}，${ids.length}将）`);
  const unknown = target.officers.length > 0 && target.officers.length < 10 && roads(target.id).some(id => {
    const city = g.cities[id], faction = city.faction;
    return faction !== g.player && faction !== target.faction && faction !== NONE && !cityIntel(g, city, NONE);
  });
  return `守军 ${target.officers.length} 将。${visible.length ? `已知可能援军 ${visible.join('、')}。` : ''}${unknown ? '未侦察邻城的出援情况未知。' : !visible.length ? '无可用援军。' : ''}`;
}

export function sortiePreview(data, g, from, to) {
  const target = g.cities[to], route = `${cityName(from)} → ${cityName(to)}`;
  if (target.faction === NONE && !target.officers.length) return h('p', { class: 'hint sortie-preview' }, route, ' · 空城可直接占领');
  const field = resolveBattlefield(data, g, to, from);
  if (!field.map || !field.dep) return null;
  const { map, siege } = field, direction = siege?.direction ?? field.entry ?? battleEntryDirection(data, to, from);
  const weather = advancedBattle(g) ? `预计${WEATHER_NAMES[battleWeather(g, to)]}` : '';
  const gateNames = (ring) => Array.from(new Set(siege.gates.filter(gate => gate.ring === ring).map(gate => {
    const [dx, dy] = gateNormal(siege, gate);
    return dx < 0 ? '西' : dx > 0 ? '东' : dy < 0 ? '北' : '南';
  }))).join('、');
  const fortress = siege ? [`外门 ${gateNames(siege.outer)}`, gateNames(siege.inner) && `内门 ${gateNames(siege.inner)}`].filter(Boolean).join(' · ') : '单城格城防';
  const moat = siege?.moatCells
    ? siege.moatCells.some(cell => cell.wet) ? '临水城壕' : siege.moatCells.length ? '分段旱壕' : ''
    : siege ? outerTerrain(map, siege) : '';
  const regional = field.approaches?.barriers;
  const zones = field.dep.attackerZones ?? [];
  const intel = defenseIntel(g, target);
  const detail = h('div', { class: 'sortie-map', hidden: true });
  const toggle = h('button', { class: 'btn', 'aria-expanded': 'false', onclick: () => {
    detail.hidden = !detail.hidden;
    toggle.setAttribute('aria-expanded', String(!detail.hidden));
    toggle.textContent = detail.hidden ? '查看战场布阵' : '收起战场布阵';
    if (!detail.hidden && !detail.firstChild) detail.append(...[planMap(field), h('p', { class: 'hint' },
      h('span', { style: { color: MARKS.attack } }, '浅蓝框为攻方布阵区。'), siege ? h('span', { style: { color: MARKS.gate } }, '金色格为城门。') : null),
      field.approaches ? h('p', { class: 'hint' }, h('span', { style: { color: APPROACH_COLORS.main } }, '土黄色主道'), '、',
        h('span', { style: { color: APPROACH_COLORS.flank } }, '浅灰色侧道'), `可减少行军消耗。前哨有兵驻守时，次日机动力＋${POST_MOBILITY}。`) : null,
      regional ? h('p', { class: 'hint' }, [
        zones.map(zone => zone.name).join('、'),
        [...new Set(field.approaches.routes.map(r => r.goal.label))].join('、'),
        siege.camp && '攻方夺取前阵后可破门',
      ].filter(Boolean).join(' · ')) : null].filter(Boolean));
  } }, '查看战场布阵');
  return h('section', { class: 'sortie-preview', 'aria-label': '出阵预览' }, h('div', { class: 'sortie-head' }, h('strong', {}, route), toggle),
    h('p', { class: 'hint' }, [field.approaches?.geography ?? field.profile?.label,
      zones[0]?.corner ? [ '城外四角布阵', direction && `主将从${DIRECTIONS[direction]}侧来路入场` ].filter(Boolean).join(' · ')
        : regional && zones.length > 1 ? '两处登陆' : direction && `从${DIRECTIONS[direction]}面入场`,
      weather, fortress, moat].filter(Boolean).join(' · ')),
    intel ? h('p', { class: 'hint' }, intel) : null, detail);
}
