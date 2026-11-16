// 升级提示 (research/experience-evidence.md §5): the rules keep each general's level and 武力 from before his first
// level-up until the war view tells it; the war view tells the player's generals only, with the window, the phrase and
// the light on the board, and a 谋士 whose level opens more 计略 is told which. Node part first, then the browser.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { Field, stratCount, STRATS } from '../src/core/field.js';
import { setupWar } from '../src/core/warcore.js';
import { startGame, newCampaign, closeMessages } from './game.mjs';
G.setData(JSON.parse(readFileSync(new URL('../data/game-data.json', import.meta.url))));
const TH = [1000, 2000, 3500, 5000, 7500, 10000, 15000];

test('a level-up is kept until taken, with the level and 武力 before it, and never goes into the save', () => {
  const g = G.newGame(4, 1, 1), id = g.factions[g.player].ruler, o = g.officers[id];
  o.level = 1; o.exp = TH[0] - 1; o.war = 89;
  assert.deepEqual(G.takeLevelUps(g), []);
  assert.equal(G.addExp(g, id, 0), false);
  assert.equal(G.addExp(g, id, 1), true);
  assert.equal(o.level, 2); assert.equal(o.war, 91); // 81–89 gains 2, so 89 goes past 90 (§3)
  assert.ok(!JSON.stringify(g).includes('warFrom'));
  assert.deepEqual(G.takeLevelUps(g), [{ id, from: 1, to: 2, warFrom: 89, war: 91 }]);
  assert.deepEqual(G.takeLevelUps(g), [], 'taken once');
});

test('two levels before the telling make one entry with the whole gain; several generals keep their order', () => {
  const g = G.newGame(4, 1, 1), [a, b] = g.cities.flatMap((c) => c.officers).slice(0, 2);
  Object.assign(g.officers[a], { level: 1, exp: 0, war: 40 }); Object.assign(g.officers[b], { level: 7, exp: TH[6] - 10, war: 95 });
  G.addExp(g, b, 10); G.addExp(g, a, TH[0]); G.addExp(g, a, TH[1] - TH[0]);
  assert.deepEqual(G.takeLevelUps(g), [{ id: b, from: 7, to: 8, warFrom: 95, war: 95 }, { id: a, from: 1, to: 3, warFrom: 40, war: 52 }]);
  G.addExp(g, b, 40000); assert.deepEqual(G.takeLevelUps(g), [], 'level 8 is the last');
});

test('a war starts with nothing left over from fights the player did not see', () => {
  const g = G.newGame(4, 1, 1);
  const c = g.cities.find((c) => c.faction !== G.NONE && c.officers.length && G.roads(c.id).some((n) => g.cities[n].faction !== c.faction && g.cities[n].officers.length));
  const to = G.roads(c.id).find((n) => g.cities[n].faction !== c.faction && g.cities[n].officers.length), id = c.officers[0];
  g.officers[id].level = 1; g.officers[id].exp = 0; G.addExp(g, id, TH[0]);
  new Field(g, setupWar(g, { from: c.id, to, ids: [id], commander: id, gold: 100, rice: 9000 }), 'att');
  assert.deepEqual(G.takeLevelUps(g), []);
});

test('a 谋士 learns 计略 only on the levels of his branch: 诸葛亮 at 4, 5, 6 and 7', () => {
  const o = { level: 1, int: 100 };
  const n = [1, 2, 3, 4, 5, 6, 7, 8].map((level) => stratCount(109, { ...o, level }));
  assert.deepEqual(n, [10, 10, 10, 12, 14, 15, 16, 16]);
  assert.deepEqual([1, 4, 8].map((level) => stratCount(1, { ...o, level })), [10, 10, 10], 'others go by 知力 alone');
  assert.deepEqual(STRATS.slice(10, 12).map((s) => s.name), ['连环', '十面埋伏']);
});

// ---------- In the war view ----------
let game, page;
before(async () => {
  game = await startGame(); page = await game.open();
  await newCampaign(page);
  await page.evaluate(() => {
    const { g, G, debug } = window.__game, home = g.factions[g.player].city;
    const to = G.roads(home).map((c) => g.cities[c]).filter((c) => c.faction !== g.player && c.faction !== G.NONE && c.officers.length).sort((a, b) => b.officers.length - a.officers.length)[0];
    for (const id of [...g.cities[home].officers, ...to.officers]) g.officers[id].soldiers ||= 500;
    const ids = g.cities[home].officers.slice(0, 3);
    debug.fieldWar(debug.setupWar(g, { from: home, to: to.id, ids, commander: ids[0], gold: 100, rice: 400 }), 'att');
  });
  await page.waitForFunction(() => window.__game.war?.finishDeploy && document.body.dataset.screen === 'war', null, { timeout: 30000 });
  const stop = closeMessages(page);
  try {
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.__game.war.finishDeploy());
    await page.waitForFunction(() => { const f = window.__game.war.field; return f.turn === f.human && !document.querySelector('.banner, .panel.msg'); }, null, { timeout: 30000 });
  } finally { stop(); }
});
after(() => game?.close());

// Plays a 计略 by `who` ('me' | 'foe') after setting up the level-ups, and reads every window that opens, closing each
// one as the player would. Also notes the gold level rising over the general and the log.
async function castAfter(who, setup) {
  return page.evaluate(async ({ who, setup }) => {
    const P = await import('./src/pace.js'); P.setPace(4);
    const w = window.__game.war, f = w.field, { g, G, audio } = window.__game;
    const cue = audio.cue, sounds = []; audio.cue = function (key) { sounds.push(key); return cue.call(this, key); };
    const me = f.alive.find((u) => u.side === f.human), foe = f.alive.find((u) => u.side !== f.human);
    new Function('ctx', setup)({ g, G, f, me, foe });
    const seen = [], rise = new Set(), lines = () => [...document.querySelectorAll('.logbox p')].map((n) => n.textContent), log0 = new Set(lines());
    const watch = setInterval(() => {
      for (const n of document.querySelectorAll('.lossnum.gain')) rise.add(n.textContent);
      const m = document.querySelector('.panel.msg');
      if (m && !m.dataset.read) { m.dataset.read = 1; seen.push({ title: m.querySelector('h4')?.textContent, face: !!m.querySelector('img, .face'), text: null, el: m }); }
      for (const s of seen) if (s.el.isConnected) s.text = s.el.querySelector('p').textContent;
    }, 20);
    const closer = setInterval(() => { const m = document.querySelector('.panel.msg'), s = seen.find((x) => x.el === m); if (s && m.querySelector('.more:not([hidden])')) { s.text = m.querySelector('p').textContent; m.click(); } }, 300); // read whole, then closed as the player would
    const [u, t] = who === 'me' ? [me, foe] : [foe, me];
    try { await w.playStrategy(u, t, 2, { ok: true, hit: true, name: '虚兵', lines: ['测试'], hits: [] }); }
    finally { audio.cue = cue; clearInterval(watch); clearInterval(closer); P.setPace(1); }
    const log = lines().filter((x) => !log0.has(x)).join('|');
    return { seen: seen.map(({ title, text, face }) => ({ title, text, face })), rise: [...rise], log, sounds, left: G.takeLevelUps(g), name: G.name(me.id) };
  }, { who, setup });
}

test('the player\'s general who went up is told: 升级 window with the 武力 gained, his new level rising in gold', async () => {
  const r = await castAfter('me', `const { g, G, me } = ctx, o = g.officers[me.id]; o.level = 2; o.exp = 1999; o.war = 70; G.addExp(g, me.id, 1);`);
  assert.ok(r.sounds.includes('cue-levelup'), '升级播放对应短曲');
  const lv = r.seen.filter((s) => s.title === '升级');
  assert.equal(lv.length, 1, JSON.stringify(r.seen));
  assert.match(lv[0].text, new RegExp(`${r.name}升级了\\s*等级 3`));
  assert.match(lv[0].text, /武力提升了 5（70→75）/);
  assert.ok(lv[0].face, 'the window wears his face');
  assert.deepEqual(r.rise, ['等级 3']);
  assert.match(r.log, /升至等级 3，武力 70→75/);
  assert.deepEqual(r.left, []);
});

test('a level-up that brings no 武力 says only 升级了; a 谋士 is then told the 计略 he learnt', async () => {
  const r = await castAfter('me', `const { g, G, me } = ctx; me.id = 109; const o = g.officers[109]; o.level = 3; o.exp = 3499; o.war = 95; G.addExp(g, 109, 1);`);
  const told = r.seen.filter((s) => s.title !== '虚兵');
  assert.deepEqual(told.map((s) => s.title), ['升级', '计略'], JSON.stringify(r.seen));
  assert.ok(!/武力/.test(told[0].text), told[0].text);
  assert.match(told[1].text, /诸葛亮学会了新的计略\s*连环、十面埋伏/);
});

test('the other side\'s generals go up unannounced', async () => {
  const r = await castAfter('foe', `const { g, G, foe } = ctx, o = g.officers[foe.id]; o.level = 1; o.exp = 999; G.addExp(g, foe.id, 1);`);
  assert.deepEqual(r.seen.filter((s) => s.title === '升级' || s.title === '计略'), []);
  assert.deepEqual(r.rise, []);
  assert.deepEqual(r.left, []);
});

test('after a 白兵, back on the war map, the player\'s general who went up in it is told', async () => {
  const r = await page.evaluate(async () => {
    const P = await import('./src/pace.js'); P.setPace(4);
    const w = window.__game.war, f = w.field, { g, G } = window.__game;
    const me = f.alive.find((u) => u.side === f.human && u.id !== 109), foe = f.alive.find((u) => u.side !== f.human), o = g.officers[me.id];
    o.level = 4; o.exp = 4999; o.war = 85; G.addExp(g, me.id, 1);
    Object.assign(g.officers[foe.id], { level: 1, exp: 999 }); G.addExp(g, foe.id, 1);
    const seen = [];
    const closer = setInterval(() => { const m = document.querySelector('.panel.msg'); if (m && m.querySelector('.more:not([hidden])')) { seen.push(m.querySelector('h4').textContent + '|' + m.querySelector('p').textContent); m.click(); } }, 200);
    // a 白兵 already fought: no pending battle, so the cut-in has nothing to play
    await w.playAttack(me, foe, { lossA: 0, lossD: 0, a: { fate: null }, d: { fate: null } });
    clearInterval(closer); P.setPace(1);
    return { seen, name: G.name(me.id) };
  });
  assert.deepEqual(r.seen, [`升级|${r.name}升级了　等级 5武力提升了 2（85→87）`]);
});
