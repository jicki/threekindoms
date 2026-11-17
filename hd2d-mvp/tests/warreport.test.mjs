// D40: a report must describe settlement, not just survival on the battlefield.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { Field } from '../src/core/field.js';
import { setupWar, resolveWar } from '../src/core/warcore.js';
import { warFate } from '../src/warreport.js';
G.setData(JSON.parse(readFileSync(new URL('../data/game-data.json', import.meta.url))));

function battle(side = 'def', { fire = false } = {}) {
  const g = G.newGame(2, 1, 1), ruler = g.factions[2].ruler;
  const general = g.cities.flatMap(c => c.officers).find(id => id !== ruler && !G.isRuler(g, id));
  const enemy = g.factions[1].ruler;
  for (const c of g.cities) { c.faction = 1; c.officers = []; }
  const from = 12, to = 14;
  g.cities[from].faction = side === 'att' ? 2 : 1;
  g.cities[from].officers = side === 'att' ? [ruler, general] : [enemy];
  g.cities[to].faction = side === 'def' ? 2 : 1;
  g.cities[to].officers = side === 'def' ? [ruler, general] : [enemy];
  g.cities[to].rice = 500;
  for (const id of [ruler, general, enemy]) { g.officers[id].status = G.SERVING; g.officers[id].soldiers = 500; }
  const ids = [...g.cities[from].officers];
  const war = setupWar(g, { from, to, ids, commander: ids[0], gold: 50, rice: 500 });
  // No neutral source city to escape to, even for an attacker.
  g.cities[from].faction = 1;
  const field = new Field(g, war, side);
  field.chest(side).rice = fire ? 5 : 0;
  if (fire) {
    const caster = field.side(side === 'att' ? 'def' : 'att')[0], target = field.side(side)[0];
    caster.x = target.x + 1; caster.y = target.y;
    // Controlled successful 火箭 through the real effect, with the seeded RNG (AI admission skips player menus).
    let hit = false;
    for (let i = 0; i < 100 && !hit; i++) hit = field.cast(caster, 5, target, true).hit;
    assert.ok(hit); assert.equal(field.chest(side).rice, 0);
  }
  field.turn = 'def'; field.endTurn();
  assert.deepEqual(field.over, { loser: side, why: 'rice' });
  return { g, war, res: field.result(), ruler, general, enemy };
}
const settle = (b) => resolveWar(b.g, b.war, b.res);
const fate = (b, id) => warFate(b.g, b.war, b.res, id)[0];

for (const side of ['att', 'def']) test(`${side}: no escape reports the ruler's death and the general's ronin location before faction events`, async () => {
  const b = battle(side); settle(b);
  const before = JSON.stringify(b.g);
  assert.match(fate(b, b.ruler), /无路可退.*身亡/);
  assert.equal(warFate(b.g, b.war, b.res, b.ruler)[2], true, 'the ledger must not show surviving troops for a dead ruler');
  assert.match(fate(b, b.general), /下野.*豫州/);
  assert.equal(JSON.stringify(b.g), before, 'reading the report changes no rules or random draws');
  await G.checkFactions(b.g, { event: async () => {}, chooseHeir: async (_, ids) => ids[0] });
  assert.equal(b.g.officers[b.ruler].status, G.DEAD);
  assert.equal(b.g.officers[b.general].status, G.RONIN);
});

test('an automatic retreat reports the actual destination', () => {
  const b = battle(), dest = G.roads(b.war.city)[0];
  b.g.cities[dest].faction = 2; settle(b);
  assert.equal(fate(b, b.ruler), `退往${G.cityName(dest)}`);
  assert.equal(fate(b, b.general), `退往${G.cityName(dest)}`);
});

test('manual ronin placement overrides the earlier battlefield survival', () => {
  const b = battle(), dest = G.roads(b.war.city)[0];
  b.g.cities[dest].faction = 2;
  b.res.placementSide = 'def'; b.res.placement = { [b.ruler]: dest, [b.general]: 'ronin' }; settle(b);
  assert.match(fate(b, b.general), /下野/);
  assert.ok(fate(b, b.general).includes(G.cityName(b.g.officers[b.general].loc)));
});

test('a captured officer released during placement is reported as ronin, not newly serving', () => {
  const b = battle();
  b.res.survivors.def = [b.ruler]; b.res.captured.byAtt = [b.general];
  b.res.placementSide = 'att'; b.res.placement = { [b.general]: 'ronin' }; settle(b);
  assert.match(fate(b, b.general), /下野/);
});

test('a walked retreat that overflows reports final ronin placement', () => {
  const b = battle(), dest = G.roads(b.war.city)[0];
  b.g.cities[dest].faction = 2; b.g.cities[dest].officers = Array(10).fill(b.enemy);
  b.res.retreated = [{ id: b.general, city: dest }]; settle(b);
  assert.match(fate(b, b.general), /下野/);
});

test('battle death, capture with room and winner survival keep distinct labels', () => {
  const b = battle(); b.res.survivors.def = []; b.res.dead = [b.ruler]; b.res.captured.byAtt = [b.general]; settle(b);
  assert.equal(fate(b, b.ruler), '阵亡');
  assert.match(fate(b, b.general), /被俘归顺/);
  assert.equal(fate(b, b.enemy), '生还');
});

test('a ruler without escape may still have an heir elsewhere; the report does not start succession', async () => {
  const b = battle(), heir = 16;
  b.g.cities[0].faction = 2; b.g.cities[0].officers = [heir]; b.g.officers[heir].status = G.SERVING;
  settle(b);
  assert.match(fate(b, b.ruler), /身亡/);
  assert.equal(b.g.factions[2].ruler, b.ruler);
  const events = [];
  await G.checkFactions(b.g, { event: async e => events.push(e.type), chooseHeir: async (_, ids) => ids[0] });
  assert.equal(b.g.factions[2].ruler, heir);
  assert.ok(events.includes('heir'));
});

test('fire arrows burn the final five rice: the surviving ruler is not reported as alive after settlement', () => {
  const b = battle('def', { fire: true });
  assert.ok(b.res.survivors.def.includes(b.ruler)); assert.deepEqual(b.res.dead, []);
  settle(b); assert.match(fate(b, b.ruler), /无路可退.*身亡/);
});

test('不战死: a stranded ruler is captured if the winning side has room', () => {
  const b = battle(); b.g.noWarDeath = true;
  for (const dest of G.roads(b.war.city)) { b.g.cities[dest].faction = 2; b.g.cities[dest].officers = Array(10).fill(b.enemy); }
  settle(b); assert.match(fate(b, b.ruler), /被俘归顺/); assert.match(fate(b, b.general), /下野/);
});

// 战场所在城和所有邻城均满员；其余城市为空城，不可作为无路可退时俘虏的远方安置地。
function fillCaptors(b, { heir = false } = {}) {
  const winSide = b.res.loser === 'def' ? 'att' : 'def';
  const excluded = new Set([b.ruler, b.general, b.enemy, ...b.g.factions.map((f) => f.ruler)]);
  const pool = b.g.officers.filter((o) => !excluded.has(o.id)).map((o) => o.id);
  const take = () => { const id = pool.pop(); b.g.officers[id].status = G.SERVING; return id; };
  for (const c of b.g.cities) { c.faction = G.NONE; c.officers = []; }
  b.g.cities[b.war.city].faction = 1;
  for (const n of G.roads(b.war.city)) { const c = b.g.cities[n]; c.faction = 1; c.officers = Array.from({ length: 10 }, take); }
  const more = Array.from({ length: 9 }, take);
  b.res.survivors[winSide].push(...more); b.war[winSide].ids.push(...more);
  if (heir) {
    const city = b.g.cities.find((c) => c.id !== b.war.city && !G.roads(b.war.city).includes(c.id));
    const id = take(); city.faction = 2; city.officers = [id];
    return id;
  }
  return null;
}
const ioFor = (events) => ({ event: async (e) => events.push(e), chooseHeir: async (_f, ids, why) => { events.push({ type: 'choose', why }); return ids[0]; } });

for (const side of ['att', 'def']) for (const captured of [false, true]) {
  test(`不战死: ${side} 方${captured ? '被俘' : '无路可退'}君主无安置空间时下野并继位`, async () => {
    const b = battle(side); b.g.noWarDeath = true;
    const heir = fillCaptors(b, { heir: true });
    if (captured) {
      b.res.survivors[side] = b.res.survivors[side].filter((id) => id !== b.ruler);
      (side === 'def' ? b.res.captured.byAtt : b.res.captured.byDef).push(b.ruler);
      b.res.sparedRulers = [b.ruler];
      b.res.placementSide = side === 'def' ? 'att' : 'def'; b.res.placement = { [b.ruler]: 'auto' };
    }
    settle(b);
    assert.equal(b.g.officers[b.ruler].status, G.RONIN);
    assert.match(fate(b, b.ruler), /下野/);
    assert.notEqual(warFate(b.g, b.war, b.res, b.ruler)[2], true);
    // 战后选择前切换开关并经过 JSON 存读，仍保留已经发生的下野结果。
    b.g.noWarDeath = false;
    const g = JSON.parse(JSON.stringify(b.g)), events = [];
    await G.checkFactions(g, ioFor(events));
    assert.equal(g.officers[b.ruler].status, G.RONIN);
    assert.equal(g.officers[b.ruler].warRulerRonin, undefined);
    assert.equal(g.factions[2].ruler, heir);
    assert.equal(events.find((e) => e.type === 'choose')?.why, 'ronin');
    assert.equal(events.find((e) => e.type === 'heir' && e.faction === 2)?.ronin, true);
    await G.checkFactions(g, ioFor(events));
    assert.equal(events.filter((e) => e.type === 'heir' && e.faction === 2).length, 1);
  });
}

test('不战死: 无继承人时玩家势力灭亡，君主仍然下野', async () => {
  const b = battle(); b.g.noWarDeath = true; fillCaptors(b);
  settle(b); const events = [];
  await G.checkFactions(b.g, ioFor(events));
  assert.equal(b.g.officers[b.ruler].status, G.RONIN);
  assert.equal(b.g.factions[2].ruler, null);
  assert.equal(b.g.over.type, 'gameover');
  assert.ok(events.some((e) => e.type === 'fall' && e.faction === 2));
});

test('不战死: 被俘君主优先安置到俘获方其他有空位的城', () => {
  const b = battle(); b.g.noWarDeath = true; fillCaptors(b);
  const remote = b.g.cities.find((c) => c.faction === G.NONE && c.id !== b.war.city && !G.roads(b.war.city).includes(c.id));
  remote.faction = 1;
  b.res.survivors.def = [b.general]; b.res.captured.byAtt = [b.ruler]; b.res.sparedRulers = [b.ruler];
  settle(b);
  assert.equal(b.g.officers[b.ruler].status, G.SERVING);
  assert.equal(G.officerCity(b.g, b.ruler).id, remote.id);
  assert.match(fate(b, b.ruler), /被俘归顺/);
});

test('战斗中保护的君主即使结算前关闭不战死，也不会在无空间时死亡', async () => {
  const b = battle(); b.g.noWarDeath = false; fillCaptors(b, { heir: true });
  b.res.survivors.def = [b.general]; b.res.captured.byAtt = [b.ruler]; b.res.sparedRulers = [b.ruler];
  settle(b); assert.equal(b.g.officers[b.ruler].status, G.RONIN);
  assert.match(fate(b, b.ruler), /下野/);
  await G.checkFactions(b.g, ioFor([]));
  assert.equal(b.g.officers[b.ruler].status, G.RONIN);
});

test('败方携带的君主俘虏优先安置到俘获方的远方城市', () => {
  const b = battle(), replacement = b.g.officers.find((o) => !G.isRuler(b.g, o.id) && o.id !== b.general).id;
  b.g.noWarDeath = true; b.g.officers[replacement].status = G.SERVING;
  b.res.survivors.att = [replacement]; b.war.att.ids.push(replacement);
  b.res.captured.byDef = [b.enemy]; b.res.sparedRulers = [b.enemy];
  const remote = b.g.cities.find((c) => c.id !== b.war.city && !G.roads(b.war.city).includes(c.id));
  remote.faction = 2; remote.officers = [b.g.officers.find((o) => !G.isRuler(b.g, o.id) && ![replacement, b.general].includes(o.id)).id];
  settle(b);
  assert.equal(b.g.officers[b.enemy].status, G.SERVING);
  assert.equal(G.officerCity(b.g, b.enemy).id, remote.id);
  assert.match(fate(b, b.enemy), /被俘归顺/);
});

test('被俘君主在原势力继位前离开俘获方时，仍以活着下野处理', async () => {
  const b = battle(); b.g.noWarDeath = true;
  b.g.cities[0].faction = 2; b.g.cities[0].officers = [16]; b.g.officers[16].status = G.SERVING;
  b.res.survivors.def = [b.general]; b.res.captured.byAtt = [b.ruler]; b.res.sparedRulers = [b.ruler];
  settle(b); assert.equal(G.factionOf(b.g, b.ruler), 1);
  b.g.noWarDeath = false;
  G.toRonin(b.g, b.ruler); // 例如俘获方继位时低忠诚武将离去
  const events = []; await G.checkFactions(b.g, ioFor(events));
  assert.equal(b.g.officers[b.ruler].status, G.RONIN);
  assert.equal(events.find((e) => e.type === 'heir' && e.faction === 2)?.ronin, true);
});

test('双方君主被俘时，先继位的一方令对方君主下野也不会造成死亡', async () => {
  const b = battle(); b.g.noWarDeath = true; b.g.player = 1;
  b.g.factions[1].ai = false; b.g.factions[2].ai = true;
  const preferred = new Set(G.data().succession['1'] || []);
  const replacement = b.g.officers.find((o) => !G.isRuler(b.g, o.id) && o.id !== b.general && !preferred.has(o.id)).id;
  b.g.officers[replacement].status = G.SERVING; b.g.officers[replacement].virtue = 0;
  b.g.officers[b.enemy].virtue = 100;
  b.res.survivors.att = [replacement]; b.war.att.ids.push(replacement);
  b.res.survivors.def = [b.general];
  b.res.captured.byAtt = [b.ruler]; b.res.captured.byDef = [b.enemy]; b.res.sparedRulers = [b.ruler, b.enemy];
  const dest = G.roads(b.war.city)[0]; b.g.cities[dest].faction = 2;
  settle(b);
  assert.equal(G.factionOf(b.g, b.ruler), 1); assert.equal(G.factionOf(b.g, b.enemy), 2);
  b.g.noWarDeath = false;
  b.g.seed = Array.from({ length: 1000 }, (_, n) => n).find((seed) => G.rng({ seed })(100) < 20);
  const events = [];
  await G.checkFactions(b.g, { event: async (e) => events.push(e), chooseHeir: async () => replacement });
  assert.equal(b.g.officers[b.ruler].status, G.RONIN);
  assert.equal(events.find((e) => e.type === 'heir' && e.faction === 2)?.ronin, true);
  assert.notEqual(b.g.factions[2].ruler, b.ruler);
});

test('a winner placed in another city reports that final city', () => {
  const b = battle(), dest = G.roads(b.war.city)[0];
  b.res.survivors.def = [b.ruler]; b.res.survivors.att.push(b.general);
  b.res.placementSide = 'att'; b.res.placement = { [b.enemy]: b.war.city, [b.general]: dest };
  settle(b); assert.equal(fate(b, b.general), `前往${G.cityName(dest)}`);
});

test('a protected ruler redirected from a full walked-retreat city reports his real destination, not death', () => {
  const b = battle(), full = G.roads(b.war.city)[0];
  b.g.noWarDeath = true;
  b.g.cities[full].faction = 2; b.g.cities[full].officers = Array(10).fill(b.enemy);
  b.g.cities[0].faction = 2;
  b.res.retreated = [{ id: b.ruler, city: full }];
  settle(b);
  assert.equal(fate(b, b.ruler), `退往${G.cityName(0)}`);
  assert.notEqual(warFate(b.g, b.war, b.res, b.ruler)[2], true);
});
