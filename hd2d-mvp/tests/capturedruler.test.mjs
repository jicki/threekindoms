// D49 (smdqj@devblog, 2026-11-13): a ruler whose loyalty was edited below 100 can be taken prisoner. His house then
// crowns an heir at once and its 自动出仕 queue goes on in the heir's city; with no city left the house falls, and
// the queue follows the old ruler into the city he now serves in. Rule layer only: constructed settlements.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { setupWar, resolveWar } from '../src/core/warcore.js';
G.setData(JSON.parse(readFileSync(new URL('../data/game-data.json', import.meta.url))));

const CAO = 131, MAO = 32, F = 2, LIU = 4; // 曹操, 夏侯楙 (head of 曹操's queue, 196), their house, 刘备's house

// 刘备 takes 曹操's city with every defender a prisoner. settle: false leaves the state as the war wrote it.
async function capture({ otherCity, player = LIU, settle = true } = {}) {
  const events = [], g = G.newGame(player, 0, 17);
  g.year = 196; g.ageless = true;
  const target = G.officerCity(g, CAO), source = g.cities.find((c) => c.faction === LIU), attacker = source.officers[0];
  if (!otherCity) for (const c of [...G.citiesOf(g, F)]) if (c.id !== target.id) for (const id of [...c.officers]) G.toRonin(g, id);
  g.officers[CAO].loyalty = 10;
  const war = setupWar(g, { from: source.id, to: target.id, ids: [attacker], commander: attacker, gold: 0, rice: 0 });
  resolveWar(g, war, {
    loser: 'def', survivors: { att: [attacker], def: [] }, dead: [],
    captured: { byAtt: [...war.def.ids], byDef: [] }, retreated: [], chests: { att: war.att, def: war.def }, skipCut: true,
  });
  const io = { event: async (e) => events.push(e), chooseHeir: async (_f, ids, why) => { events.push({ type: 'choose', why }); return ids[0]; } };
  if (settle) await G.checkFactions(g, io);
  return { g, events, io, target, attacker };
}
// One pass of the turn order from where the game stands, the AI doing nothing; returns the events of it.
async function month(g) {
  const events = [];
  const io = { event: async (e) => events.push(e), chooseHeir: async (_f, ids) => ids[0], aiTurn: async () => {}, playerTurn: async () => { g.endTurn = true; if (++turns > 1) g.over = { type: 'stop' }; } };
  let turns = 0; g.current = null; g.books = 0;
  await G.run(g, io);
  g.over = null;
  return events;
}

test('a captured ruler does not head his captor\'s city', async () => {
  const { g, target } = await capture({ otherCity: true, settle: false });
  assert.equal(target.faction, LIU);
  assert.notEqual(target.officers[0], CAO, 'the captor leads his own city');
  assert.equal(g.factions[LIU].ruler === target.officers[0] || !target.officers.includes(g.factions[LIU].ruler), true);
});

test('with cities left, the house crowns an heir when its ruler is taken', async () => {
  const { g, events, target } = await capture({ otherCity: true });
  const heir = g.factions[F].ruler, e = events.find((x) => x.type === 'heir');
  assert.ok(heir != null && heir !== CAO);
  assert.equal(G.factionOf(g, heir), F);
  assert.equal(g.cities[g.factions[F].city].faction, F);
  assert.equal(g.cities[g.factions[F].city].officers[0], heir);
  assert.deepEqual([e.faction, e.old, e.heir, e.captured], [F, CAO, heir, true]);
  assert.equal(g.officers[CAO].status, G.SERVING, 'the old ruler lives on as his captor\'s officer');
  assert.equal(G.factionOf(g, CAO), LIU);
  assert.ok(!G.isRuler(g, CAO));
  assert.ok(target.officers.includes(CAO));
  assert.ok(!events.some((x) => x.type === 'fall'));
});

test('the queue then goes on in the heir\'s city', async () => {
  const { g } = await capture({ otherCity: true });
  const joined = G.autoJoin(g, F);
  assert.deepEqual(joined, { id: MAO, city: g.factions[F].city });
  assert.equal(G.factionOf(g, MAO), F);
});

test('a player whose ruler is taken is told so when asked for an heir', async () => {
  const { events } = await capture({ otherCity: true, player: F });
  assert.deepEqual(events.find((x) => x.type === 'choose'), { type: 'choose', why: 'captured' });
});

test('with no city left the house falls under the ruler who was taken', async () => {
  const { g, events } = await capture({ otherCity: false });
  assert.equal(g.factions[F].ruler, null);
  assert.equal(g.factions[F].fallen, CAO);
  assert.deepEqual(events.filter((x) => x.type !== 'choose').map((x) => x.type), ['fall']);
  assert.equal(G.followJoin(g, F)?.id, MAO, 'ready to follow');
});

test('the fallen house\'s queue follows its old ruler: one a turn, into the city he serves in', async () => {
  const { g, target } = await capture({ otherCity: false });
  const first = (await month(g)).filter((e) => e.type === 'join' && e.lord === CAO);
  assert.deepEqual(first, [{ type: 'join', faction: LIU, id: MAO, city: target.id, lord: CAO }]);
  assert.equal(g.officers[MAO].status, G.SERVING);
  assert.ok(target.officers.includes(MAO));
  assert.equal(g.factions[F].ruler, null, 'the house stays fallen');
  // The next in line (曹真, 200) waits for his year.
  assert.equal((await month(g)).filter((e) => e.lord === CAO).length, 0);
  g.year = 200;
  const next = (await month(g)).filter((e) => e.lord === CAO);
  assert.equal(next.length, 1);
  assert.equal(next[0].id, G.joinQueue(F)[1]);
});

test('a full city makes the follower wait, and he comes once there is room', async () => {
  const { g, target } = await capture({ otherCity: false });
  const spare = g.officers.filter((o) => o.status === G.UNAPPEARED && !G.joinQueue(F).includes(o.id)).map((o) => o.id);
  while (target.officers.length < 10) { const id = spare.pop(); g.officers[id].status = G.SERVING; target.officers.push(id); }
  assert.equal(G.followJoin(g, F), null);
  assert.equal(g.officers[MAO].status, G.UNAPPEARED);
  G.kill(g, target.officers.at(-1));
  assert.equal(G.followJoin(g, F)?.city, target.id);
});

test('nobody follows a ruler who is dead or out of office, nor a house that fell the usual way', async () => {
  const a = await capture({ otherCity: false });
  G.toRonin(a.g, CAO);
  assert.equal(G.followJoin(a.g, F), null, 'out of office');
  const b = await capture({ otherCity: false });
  G.kill(b.g, CAO);
  assert.equal(G.followJoin(b.g, F), null, 'dead');
  const c = G.newGame(LIU, 0, 17); c.year = 196;
  G.kill(c, CAO); G.destroyFaction(c, F);
  assert.equal(G.followJoin(c, F), null, 'fell with its ruler dead');
  assert.equal((await month(c)).filter((e) => e.type === 'join' && e.id === MAO).length, 0);
});

// As 0.3.4 left it: the prisoner is still his house's ruler, the house sits in his captor's city, and he heads its
// list over the captor's own ruler.
function stuck(g, target) {
  assert.ok(target.officers.includes(g.factions[LIU].ruler), 'the fixture has 刘备 in the city he took');
  g.factions[F].ruler = CAO; g.factions[F].city = target.id;
  target.officers = [CAO, ...target.officers.filter((x) => x !== CAO)];
}

test('a house that had already fallen in 0.3.4 with its ruler a prisoner: the captor leads again, and the queue follows', async () => {
  const { g, target } = await capture({ otherCity: false, settle: false });
  stuck(g, target);
  G.destroyFaction(g, F); // what 0.3.4's checkFactions did: no city, so the house fell under its prisoner
  assert.equal(target.officers[0], CAO);
  const events = await month(g);
  assert.equal(target.officers[0], g.factions[LIU].ruler);
  assert.ok(events.some((e) => e.type === 'join' && e.id === MAO && e.lord === CAO));
});

test('a record saved in the stuck state mends itself on the house\'s next turn', async () => {
  const { g, target } = await capture({ otherCity: true, settle: false });
  stuck(g, target);
  const events = await month(g);
  assert.equal(target.officers[0], g.factions[LIU].ruler, 'the captor leads his city again');
  const heir = events.find((e) => e.type === 'heir');
  assert.deepEqual([heir.faction, heir.old, heir.captured], [F, CAO, true]);
  assert.notEqual(g.factions[F].ruler, CAO);
  assert.equal(G.factionOf(g, MAO), F, 'and the queue moves again');
});

test('a record saved before a protected ronin ruler\'s succession is repaired on the next turn', async () => {
  const g = G.newGame(LIU, 0, 17), old = g.factions[F].ruler;
  g.ageless = true; G.toRonin(g, old); g.officers[old].warRulerRonin = true;
  g.noWarDeath = false;
  const restored = JSON.parse(JSON.stringify(g)), events = await month(restored);
  const heir = events.find((e) => e.type === 'heir' && e.faction === F);
  assert.equal(heir?.ronin, true);
  assert.notEqual(restored.factions[F].ruler, old);
  assert.equal(restored.officers[old].status, G.RONIN);
  assert.equal(restored.officers[old].warRulerRonin, undefined);
});

test('a stuck record whose house has since lost every city falls, and the queue follows', async () => {
  const { g, target } = await capture({ otherCity: false, settle: false });
  stuck(g, target);
  const events = await month(g);
  assert.ok(events.some((e) => e.type === 'fall' && e.faction === F));
  assert.equal(target.officers[0], g.factions[LIU].ruler);
  assert.equal(g.factions[F].fallen, CAO);
  await month(g);
  assert.equal(G.factionOf(g, MAO), LIU);
});
