// 继位 (user report, 2026-11-03): a faction is called after its ruler, so when an heir takes over, the city tags,
// the legend and the rest of the screens must carry the heir's name rather than the founder's from the scenario data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { startGame, newCampaign, saveCampaign, resumeCampaign, closeMessages } from './game.mjs';
const D = JSON.parse(readFileSync(new URL('../data/game-data.json', import.meta.url)));
G.setData(D);
// The war view's modules (src/war/, split out of src/warview.js), read with it wherever the sources are searched; none before the split.
const warDir = new URL('../src/war/', import.meta.url);
const WAR = existsSync(warDir) ? readdirSync(warDir).filter((f) => f.endsWith('.js')).map((f) => `src/war/${f}`) : [];

// The faction's ruler dies and a serving officer inherits; returns the two names.
function succeed(g, f) {
  const old = g.factions[f].ruler;
  G.kill(g, old);
  const heir = G.autoHeir(g, f);
  G.crown(g, f, heir, old);
  return { old: G.name(old), heir: G.name(heir) };
}

test('a faction is called after its ruler of the day', () => {
  const g = G.newGame(4, 1, 1), f = 2;
  assert.equal(G.factionName(g, f), '曹操');
  const { old, heir } = succeed(g, f);
  assert.notEqual(old, heir);
  assert.equal(G.factionName(g, f), heir);
  assert.equal(G.factionName(g, 1), '袁绍', 'the other houses keep theirs');
  assert.equal(G.factionName(g, G.NONE), '无主');
  assert.equal(G.factionName(g, null), '无主');
});

test('a fallen house keeps the name of the ruler it fell under', () => {
  const g = G.newGame(4, 1, 1), f = 2, { heir } = succeed(g, f);
  G.destroyFaction(g, f);
  assert.equal(g.factions[f].ruler, null);
  assert.equal(G.factionName(g, f), heir);
  const again = G.newGame(4, 1, 1);
  G.destroyFaction(again, f);
  assert.equal(G.factionName(again, f), '曹操');
});

test('an older record, with no note of who a fallen house fell under, still names every faction', () => {
  const g = G.newGame(4, 1, 1), f = 2, { heir } = succeed(g, f);
  const old = JSON.parse(JSON.stringify(g));
  assert.equal(G.factionName(old, f), heir, 'a living house goes by the ruler the record holds');
  old.factions[f].ruler = null; delete old.factions[f].fallen;
  assert.equal(G.factionName(old, f), '曹操', 'nobody on record: the scenario name');
});

test('every caller hands the game over, and none reads the scenario name', () => {
  const strategy = ['strategy', 'strategyroads', 'strategycities', 'strategysky', 'strategymarks', 'strategywar'].map((n) => `src/${n}.js`);
  for (const file of ['src/app.js', ...strategy, 'src/warview.js', ...WAR, 'save-editor.html', 'tools/sim_core.mjs', 'tools/sim_game.mjs']) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /\bG\.factionName\((?![\w.]+, )/, file);
  }
  for (const file of [...strategy, 'src/warview.js', ...WAR, 'tools/sim_core.mjs']) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /(?<![.\w])factionName\((?![\w.]+, )/, file);
  }
  assert.match(readFileSync(new URL('../src/app.js', import.meta.url), 'utf8'), /const factionName = \(f\) => G\.factionName\(g, f\);/);
});

let game;
before(async () => { game = await startGame({ scenario: 'original' }); });
after(() => game?.close());

// Kills an AI ruler in the running game, through the game's own succession, and repaints the map.
const killRuler = (page, f) => page.evaluate(async (f) => {
  const { g, G, io, strategy } = window.__game, old = g.factions[f].ruler;
  G.kill(g, old);
  await G.checkFactions(g, io);
  strategy.refresh(g);
  return { old: G.name(old), heir: G.name(g.factions[f].ruler) };
}, f);

test('on screen: tags, legend and the 继位 notice carry the new ruler, also after loading the record', async () => {
  const page = await game.open();
  await newCampaign(page, '刘备');
  const f = 2, stop = closeMessages(page);
  let said = '';
  const watching = page.evaluate(() => new Promise((res) => {
    const t = setInterval(() => { const m = document.querySelector('.panel.msg'); if (m?.textContent.includes('继')) { clearInterval(t); res(m.textContent); } }, 20);
    setTimeout(() => { clearInterval(t); res(''); }, 15000);
  })).then((s) => { said = s; });
  let old, heir;
  try { ({ old, heir } = await killRuler(page, f)); await watching; } finally { stop(); }
  assert.ok(said.includes(`${old}去世`) && said.includes(heir), `notice: ${said}`);
  assert.ok(!said.includes(`${heir}的君主`), `the heir is not his own predecessor's lord: ${said}`);

  const tags = async (p) => {
    const rendered = await p.waitForFunction((f) => {
      const { g, G } = window.__game, c = g.cities.find((x) => x.faction === f);
      if (!c) return null;
      const tag = [...document.querySelectorAll('.ctag')].find((el) => el.textContent.startsWith(G.cityName(c.id)))?.querySelector('small');
      // 读取记录后战略视图先就绪，三维地图的城名牌在素材读取完成后才挂载。
      return tag ? { tag: tag.textContent, all: [...document.querySelectorAll('.ctag small')].map((s) => s.textContent).join(' ') } : null;
    }, f);
    try { return await rendered.jsonValue(); } finally { await rendered.dispose(); }
  };
  await page.evaluate(() => window.__game.strategy.refresh(window.__game.g));
  const t = await tags(page);
  assert.ok(t.tag.startsWith(heir), `tag: ${t.tag}`);
  assert.ok(!t.all.includes(old), `an old tag: ${t.all}`);

  const save = await saveCampaign(page);
  const again = await game.open('', { save });
  await resumeCampaign(again);
  await again.evaluate(() => window.__game.strategy.refresh(window.__game.g));
  const r = await tags(again);
  assert.ok(r.tag.startsWith(heir), `after loading: ${r.tag}`);
  assert.deepEqual(page.errors, []); assert.deepEqual(again.errors, []);
});

// D49 (smdqj@devblog, 2026-11-13): a ruler with edited loyalty taken prisoner. Rules in capturedruler.test.mjs; here
// the notices: his house's 继位 says 被俘 rather than 去世, and a follower of a fallen house names the lord he follows.
const said = (page, word) => page.evaluate((word) => new Promise((res) => {
  const t = setInterval(() => { const m = document.querySelector('.panel.msg'); if (m?.textContent.includes(word)) { clearInterval(t); res(m.textContent); } }, 20);
  setTimeout(() => { clearInterval(t); res(''); }, 15000);
}), word);
// Moves an AI ruler into the player's ruler city as a prisoner would be; alone: his house keeps no other city.
const takeRuler = (page, f, alone) => page.evaluate(async ({ f, alone }) => {
  const { g, G, io, strategy } = window.__game, old = g.factions[f].ruler, from = G.officerCity(g, old), to = g.cities[g.factions[g.player].city];
  g.year = 196; g.ageless = true;
  if (alone) for (const c of [...G.citiesOf(g, f)]) for (const id of [...c.officers]) if (id !== old) G.toRonin(g, id);
  from.officers = from.officers.filter((x) => x !== old); if (!from.officers.length) from.faction = G.NONE;
  to.officers.push(old); g.officers[old].loyalty = 30;
  await G.checkFactions(g, io);
  strategy.refresh(g);
  return { old: G.name(old), heir: g.factions[f].ruler == null ? null : G.name(g.factions[f].ruler), next: G.name(G.joinQueue(f)[0]) };
}, { f, alone });

test('on screen: a captured ruler\'s house is told of the capture, not of a death', async () => {
  const page = await game.open();
  await newCampaign(page, '刘备');
  const stop = closeMessages(page), notice = said(page, '继');
  let r, text;
  try { r = await takeRuler(page, 2, false); text = await notice; } finally { stop(); }
  assert.ok(r.heir && r.heir !== r.old);
  assert.ok(text.includes(`${r.old}被俘`) && text.includes(r.heir) && !text.includes('去世'), `notice: ${text}`);
  assert.deepEqual(page.errors, []);
});

test('on screen: a protected ronin ruler is announced as 下野 and the house crowns an heir', async () => {
  const page = await game.open();
  await newCampaign(page, '刘备');
  const stop = closeMessages(page), notice = said(page, '继');
  let r, text;
  try {
    r = await page.evaluate(async () => {
      const { g, G, io } = window.__game, f = 2, old = g.factions[f].ruler;
      G.toRonin(g, old); g.officers[old].warRulerRonin = true; g.noWarDeath = false;
      await G.checkFactions(g, io);
      return { old: G.name(old), heir: G.name(g.factions[f].ruler), status: g.officers[old].status, ronin: G.RONIN };
    });
    text = await notice;
  } finally { stop(); }
  assert.notEqual(r.heir, r.old);
  assert.equal(r.status, r.ronin);
  assert.ok(text.includes(`${r.old}下野`) && text.includes(r.heir) && !text.includes('去世'), `notice: ${text}`);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('on screen: a player whose ruler went 下野 is asked to choose an heir', async () => {
  const page = await game.open();
  await newCampaign(page, '曹操');
  const prompt = said(page, '选出继承者');
  const done = page.evaluate(async () => {
    const { g, G, io } = window.__game, f = g.player, old = g.factions[f].ruler;
    G.toRonin(g, old); g.officers[old].warRulerRonin = true; g.noWarDeath = false;
    await G.checkFactions(g, io);
    return { old: G.name(old), heir: G.name(g.factions[f].ruler), status: g.officers[old].status, ronin: G.RONIN };
  });
  const asked = await prompt;
  assert.ok(asked.includes('君主下野') && asked.includes('请从部下中选出继承者') && !asked.includes('去世'), `prompt: ${asked}`);
  const stop = closeMessages(page), notice = said(page, '继承了大业');
  try {
    await page.locator('.otable-wrap tr[data-id]').first().click({ timeout: 15000 });
    const text = await notice, r = await done;
    assert.ok(text.includes(`${r.old}下野`) && text.includes(r.heir), `notice: ${text}`);
    assert.notEqual(r.old, r.heir); assert.equal(r.status, r.ronin);
  } finally { stop(); }
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('on screen: a player whose ruler is taken is told so, then chooses the heir', async () => {
  const page = await game.open();
  await newCampaign(page, '曹操');
  const prompt = said(page, '选出继承者');
  const done = page.evaluate(async () => {
    const { g, G, io, strategy } = window.__game, f = g.player, old = g.factions[f].ruler, from = G.officerCity(g, old), to = g.cities.find((c) => c.faction === 4);
    from.officers = from.officers.filter((x) => x !== old); if (!from.officers.length) from.faction = G.NONE;
    to.officers.push(old); g.officers[old].loyalty = 30;
    await G.checkFactions(g, io);
    strategy.refresh(g);
    return { old: G.name(old), heir: G.name(g.factions[f].ruler), over: !!g.over };
  });
  const asked = await prompt;
  assert.ok(asked.includes('君主被俘') && asked.includes('请从部下中选出继承者') && !asked.includes('去世'), `prompt: ${asked}`);
  const stop = closeMessages(page), notice = said(page, '继承了大业');
  let r, text;
  try {
    await page.locator('.otable-wrap tr[data-id]').first().click({ timeout: 15000 });
    text = await notice; r = await done;
  } finally { stop(); }
  assert.ok(!r.over && r.heir !== r.old);
  assert.ok(text.includes(`${r.old}被俘`) && text.includes(r.heir), `notice: ${text}`);
  assert.deepEqual(page.errors, []);
});

test('on screen: a fallen house\'s next officer comes to the player naming the lord he follows', async () => {
  const page = await game.open();
  await newCampaign(page, '刘备');
  const stop = closeMessages(page);
  let r, text;
  try {
    r = await takeRuler(page, 2, true);
    assert.equal(r.heir, null, 'the house fell');
    const notice = said(page, '加入我军');
    await page.evaluate(async () => { const { g, G, io } = window.__game; const j = G.followJoin(g, 2); await io.event({ type: 'join', ...j }); });
    text = await notice;
  } finally { stop(); }
  assert.ok(text.includes(`${r.next}追随旧主${r.old}`) && text.includes('加入我军'), `notice: ${text}`);
  assert.deepEqual(page.errors, []);
});

test('on screen: the standard in an AI war bears the new ruler\'s surname', async () => {
  const page = await game.open();
  await newCampaign(page, '刘备');
  const stop = closeMessages(page);
  try {
    await killRuler(page, 2);
  } finally { stop(); }
  const r = await page.evaluate(() => {
    const { g, G, strategy } = window.__game, f = 2, seen = [];
    const fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (s, ...a) { seen.push(s); return fill.call(this, s, ...a); };
    const city = g.cities.find((c) => c.faction === f).id;
    const show = strategy.aiWar({ from: null, to: city, att: f, def: 1, attName: G.factionName(g, f), defName: G.factionName(g, 1) });
    CanvasRenderingContext2D.prototype.fillText = fill;
    show?.dispose?.();
    return { seen, heir: G.factionName(g, f) };
  });
  assert.ok(r.seen.includes(r.heir[0]), `drawn ${r.seen} for ${r.heir}`);
});
