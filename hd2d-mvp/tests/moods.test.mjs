// The faces the original's windows wear ($00A4, research/assets-music.md): each result names who speaks and with
// which expression, 喜 / 怒 / 忧. Played through the real dock, war view and duel HUD; the shown bust is what is checked.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, newCampaign, closeMessages, cmd } from './game.mjs';

let game, page;
before(async () => { game = await startGame(); page = await game.open('&flat'); await newCampaign(page); });
after(() => game?.close());

// Skips any picture until a window with a face is up, and returns it: { text, who, mood }. Leaves it open.
async function nextWindow(p = page) {
  for (let i = 0; i < 200; i++) {
    const seen = await p.evaluate(() => {
      const m = document.querySelector('.panel.msg');
      if (!m) return { vig: !!document.querySelector('.vig') };
      if (m.querySelector('.more')?.hidden) { m.click(); } // finishes the typing
      const src = m.querySelector('img')?.getAttribute('src') ?? '', [, who, mood] = src.match(/faces\/(\d+)-(\w+)\.webp/) ?? [];
      return { text: m.textContent, who: who == null ? null : +who, mood: mood ?? null };
    });
    if (seen.text != null) return seen;
    if (seen.vig) await p.keyboard.press('Escape');
    await p.waitForTimeout(100);
  }
  assert.fail('no window came up');
}
const closeWindow = async (p = page) => {
  await p.evaluate(() => document.querySelector('.panel.msg')?.click());
  await p.waitForFunction(() => !document.querySelector('.panel.msg'));
};
const dock = (tab, act) => cmd(page, tab, act);
const pick = (id) => page.locator(`.shade tr[data-id="${id}"]`).first().click();
const yes = () => page.locator('.shade .btn.primary').last().click();
// The player's home city with gold, rice and books to spare; returns ids to work with.
const stock = () => page.evaluate(() => {
  const { g, G } = window.__game, c = g.cities[g.factions[g.player].city];
  g.books = 99; c.gold = 5000; c.rice = 5000;
  const foe = g.factions.find((f) => f.ruler != null && f.id !== g.player);
  const mark = G.citiesOf(g, foe.id).flatMap((x) => x.officers).find((id) => !G.isRuler(g, id));
  return { home: c.id, me: c.officers[0], foe: foe.id, mark, foeRuler: foe.ruler };
});

test('赏赐: the one rewarded, 喜', async () => {
  const { me } = await stock();
  await page.evaluate((id) => { window.__game.g.officers[id].loyalty = 50; }, me);
  await dock('仓', '赏赐'); await pick(me);
  await page.locator('.shade .btn', { hasText: '赏金' }).click();
  await yes();
  await page.locator('.shade .btn', { hasText: '每人一次' }).click();
  const w = await nextWindow();
  assert.deepEqual([w.who, w.mood], [me, 'joy']); assert.match(w.text, /忠诚/);
  await closeWindow();
});

test('离间: the envoy, 喜 when it takes and 忧 when it fails', async () => {
  for (const [loyalty, mood, said] of [[20, 'joy', /呵呵呵/], [98, 'grief', /策略失败/]]) {
    const { me, mark } = await stock();
    await page.evaluate(({ me, mark, loyalty }) => { const { g } = window.__game; Object.assign(g.officers[me], { int: 100, virtue: 100 }); g.officers[mark].loyalty = loyalty; }, { me, mark, loyalty });
    await dock('外交', '离间'); await page.locator(`.shade tr[data-id="${mark}"]`).first().click({ force: true });
    await pick(me); await yes();
    const w = await nextWindow();
    assert.deepEqual([w.who, w.mood], [me, mood]); assert.match(w.text, said);
    await closeWindow();
  }
});

// The picture must not show the outcome before the game reaches it (2026-11-07): a failed 离间 rests on its attempt frame.
test('a failed 离间 stops the picture before the rumour takes', async () => {
  const { me, mark } = await stock();
  await page.evaluate(({ me, mark }) => { const { g } = window.__game; Object.assign(g.officers[me], { int: 0, virtue: 0 }); g.officers[mark].loyalty = 100; }, { me, mark });
  await dock('外交', '离间'); await page.locator(`.shade tr[data-id="${mark}"]`).first().click({ force: true });
  await pick(me); await yes();
  await page.waitForSelector('.vig .vig-more', { state: 'attached', timeout: 15000 }); // 原版: the picture has played and waits for a key
  const off = await page.evaluate(async () => {
    const S = (await fetch('assets/ai/vignettes/index.json').then((x) => x.json())).discord, { cols, attempt, src } = S.story;
    const a = new Image(); a.src = `assets/ai/vignettes/${src}`; await a.decode();
    const cv = document.querySelector('.vig[data-scene="discord"] canvas'), now = cv.getContext('2d').getImageData(0, 0, S.w, S.h).data;
    const cell = (i) => { const c = document.createElement('canvas'); c.width = S.w; c.height = S.h; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(a, (i % cols) * S.w, Math.floor(i / cols) * S.h, S.w, S.h, 0, 0, S.w, S.h); return g.getImageData(0, 0, S.w, S.h).data; };
    const diff = (x) => { let d = 0; for (let i = 0; i < x.length; i += 40) d += Math.abs(x[i] - now[i]); return d / (x.length / 40); };
    return { attempt: diff(cell(attempt)), end: diff(cell(8)) };
  });
  assert.ok(off.attempt < 0.5 && off.end > 5, JSON.stringify(off));
  const w = await nextWindow();
  assert.match(w.text, /策略失败/);
  await closeWindow();
});

test('同盟: the envoy, 忧 at a refusal and 喜 once it stands', async () => {
  const { me, foe, foeRuler } = await stock();
  await page.evaluate(({ me, foeRuler }) => { const { g } = window.__game; Object.assign(g.officers[me], { int: 0, virtue: 0 }); g.officers[foeRuler].int = 100; }, { me, foeRuler });
  const go = async () => { await dock('外交', '同盟'); await page.locator('.shade .cities .btn').first().click(); await pick(me); await yes(); };
  await go();
  let w = await nextWindow();
  if (w.mood === 'grief') { assert.equal(w.who, me); assert.match(w.text, /拒绝/); await closeWindow(); }
  await page.evaluate(({ me, foeRuler }) => { const { g } = window.__game; g.officers[me].int = g.officers[foeRuler].int + 396; }, { me, foeRuler });
  await go();
  await page.waitForFunction(() => document.querySelector('.vig, .shade .btn.primary'));
  for (let i = 0; i < 60 && !(await page.locator('.shade .btn.primary').count()); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(100); }
  await yes();
  w = await nextWindow();
  assert.deepEqual([w.who, w.mood], [me, 'joy']); assert.match(w.text, /同盟已经成立/);
  await closeWindow();
  await page.evaluate((foe) => { const { g } = window.__game; g.factions[g.player].alliance[foe] = 0; g.factions[foe].alliance[g.player] = 0; }, foe);
});

test('搜索: whoever went out, 喜 at a find and 忧 at nothing', async () => {
  const seen = new Set();
  for (let i = 0; i < 16 && seen.size < 2; i++) {
    const { me } = await stock();
    await dock('城', '搜索'); await pick(me); await yes();
    const w = await nextWindow();
    if (/什么也没找到/.test(w.text)) { assert.deepEqual([w.who, w.mood], [me, 'grief']); seen.add('none'); }
    else if (/发现了/.test(w.text)) { assert.deepEqual([w.who, w.mood], [me, 'joy']); seen.add('found'); }
    await closeWindow();
    // A find may go on to 求仕 / 出仕: back to the map before the next one.
    for (let k = 0; k < 40; k++) {
      if (await page.locator('.shade .btn:not(.primary)').count()) await page.locator('.shade .btn:not(.primary)').first().click();
      if (await page.locator('.panel.msg').count()) await closeWindow();
      if (await page.evaluate(() => !document.querySelector('.shade, .panel.msg, .vig, .toast'))) break;
      await page.waitForTimeout(150);
    }
  }
  assert.ok(seen.size > 0, 'saw at least one outcome of the two');
});

test('灾害 and 暴乱: the struck city\'s governor, 忧, and 喜 where 防灾 held', async () => {
  const { home, me } = await stock();
  const fire = (e) => page.evaluate((e) => { window.__evt = window.__game.io.event(e); }, e);
  await fire({ type: 'disaster', kind: 'flood', list: [[home, 3]] });
  let w = await nextWindow();
  assert.deepEqual([w.who, w.mood], [me, 'grief']); assert.match(w.text, /大事不好/);
  await closeWindow(); await page.evaluate(() => window.__evt);
  await fire({ type: 'disaster', kind: 'drought', list: [[home, 10]] });
  w = await nextWindow();
  assert.deepEqual([w.who, w.mood], [me, 'joy']); assert.match(w.text, /不过请放心/);
  await closeWindow(); await page.evaluate(() => window.__evt);
  await fire({ type: 'riot', list: [[home]] });
  w = await nextWindow();
  assert.deepEqual([w.who, w.mood], [me, 'grief']); assert.match(w.text, /暴乱/);
  await closeWindow(); await page.evaluate(() => window.__evt);
});

test('an envoy\'s offer accepted: the ruler, 喜', async () => {
  const { foe } = await stock();
  await page.evaluate((foe) => { window.__ans = window.__game.io.allianceOffer(foe, 'gold', 100); }, foe);
  await yes();
  const w = await nextWindow();
  assert.equal(w.mood, 'joy'); assert.equal(w.who, await page.evaluate(() => { const { g } = window.__game; return g.factions[g.player].ruler; }));
  await closeWindow();
  assert.equal(await page.evaluate(() => window.__ans), true);
});

test('搜索 turns up someone who names a price: whoever went out, 喜, before the 求仕 question', async () => {
  const { me } = await stock();
  const saved = await page.evaluate(async () => {
    const { g } = window.__game, D = (await import('./src/core/game.js')).data(), home = g.factions[g.player].city;
    const taken = new Set(Object.values(D.rules.search_preference).flat());
    const o = g.officers.find((x) => x.status === 1 && !taken.has(x.id)); // not yet out in the world
    o.status = 0; o.loc = home; window.__ronin = o.id;
    const rows = D.search_outcomes, keep = Object.fromEntries(Object.keys(rows).map((k) => [k, rows[k]]));
    for (const k of Object.keys(rows)) rows[k] = Array(8).fill(6);
    window.__restore = () => { Object.assign(rows, keep); };
    return o.id;
  });
  await dock('城', '搜索'); await pick(me); await yes();
  const w = await nextWindow();
  assert.deepEqual([w.who, w.mood], [me, 'joy']); assert.match(w.text, /颇有可取之处/);
  await closeWindow();
  await page.locator('.shade .btn', { hasText: '取消' }).click();
  await page.waitForFunction(() => !document.querySelector('.shade, .panel.msg, .vig'));
  await page.evaluate((id) => { window.__restore(); window.__game.g.officers[id].status = 1; }, saved);
});

test('统一全国: the sharpest officer, 喜, before the ending', async () => {
  const p = await game.open('&flat'); await newCampaign(p);
  await p.evaluate(() => { window.__game.g.over = { type: 'unify', score: 80 }; });
  await p.locator('.endturn .btn').click();
  await p.locator('.shade .btn.primary').last().click();
  const w = await p.waitForFunction(() => { const m = document.querySelector('.panel.msg'); if (m?.querySelector('.more')?.hidden) m.click(); return m?.textContent.includes('统一全国') ? m.querySelector('img')?.getAttribute('src') : null; }, null, { timeout: 60000 }).then((h) => h.jsonValue());
  assert.match(w, /-joy\.webp$/);
  await p.context().close();
});

// The field, for the war tests below: the player attacks a neighbour and the AI side waits.
async function toWar(p) {
  await newCampaign(p);
  await p.evaluate(() => {
    const { g, G, debug } = window.__game, home = g.factions[g.player].city;
    const to = G.roads(home).map((c) => g.cities[c]).filter((c) => c.faction !== g.player && c.faction !== G.NONE && c.officers.length).sort((a, b) => b.officers.length - a.officers.length)[0];
    for (const id of [...g.cities[home].officers, ...to.officers]) g.officers[id].soldiers ||= 500;
    const ids = g.cities[home].officers.slice(0, 3);
    debug.fieldWar(debug.setupWar(g, { from: home, to: to.id, ids, commander: ids[0], gold: 100, rice: 400 }), 'att');
  });
  await p.waitForFunction(() => window.__game.war?.finishDeploy && document.body.dataset.screen === 'war', null, { timeout: 30000 });
  const stop = closeMessages(p);
  try {
    await p.waitForTimeout(2500);
    await p.evaluate(() => window.__game.war.finishDeploy());
    await p.waitForFunction(() => { const f = window.__game.war.field; return f.turn === f.human && !document.querySelector('.banner, .panel.msg'); }, null, { timeout: 30000 });
  } finally { stop(); }
}

test('计略: the player\'s caster 喜 / 忧, the enemy\'s target 忧 / 喜; 十面埋伏 tells both sides', async () => {
  const p = await game.open('&flat'); await toWar(p);
  for (const [mine, hit, mood] of [[true, true, 'joy'], [true, false, 'grief'], [false, true, 'grief'], [false, false, 'joy']]) {
    await p.evaluate(async ({ mine, hit }) => {
      const P = await import('./src/pace.js'); P.setPace(4);
      const w = window.__game.war, f = w.field, foe = f.alive.find((u) => u.side !== f.human), me = f.alive.find((u) => u.side === f.human);
      window.__who = me.id;
      const res = hit ? { ok: true, hit: true, name: '火计', lines: ['损兵 120'], hits: [{ u: mine ? foe : me, soldiers: -120 }] } : { ok: true, hit: false, name: '火计', lines: [], hits: [] };
      window.__cast = w.playStrategy(mine ? me : foe, mine ? foe : me, 0, res);
    }, { mine, hit });
    const w = await nextWindow(p), who = await p.evaluate(() => window.__who);
    assert.deepEqual([w.who, w.mood], [who, mood], JSON.stringify({ mine, hit }));
    if (!hit) assert.match(w.text, mine ? /非常抱歉/ : /失败了/);
    await p.evaluate(async () => { document.querySelector('.panel.msg')?.click(); await window.__cast; (await import('./src/pace.js')).setPace(1); });
  }
  // The player walks into a hidden ambush on forest beside him: his own face, 忧.
  const at = await p.evaluate(() => {
    const w = window.__game.war, f = w.field, foe = f.alive.find((u) => u.side !== f.human), u = f.alive.find((x) => x.side === f.human && !x.commander) ?? f.alive.find((x) => x.side === f.human);
    w.cancel(); w.cancel(); f.pool[f.human] = 60; w.clickCell(u.x, u.y);
    const [x, y] = [...f.reach(u).dist.keys()].map((k) => k.split(',').map(Number)).find(([x, y]) => (x !== u.x || y !== u.y) && !f.alive.some((a) => a.x === x && a.y === y));
    f.map[y][x] = 0; // forest, as an ambush needs
    f.ambush = { [foe.side]: { u: foe, x, y, days: 5 } };
    w.clickCell(x, y);
    return { id: u.id };
  });
  const w = await nextWindow(p);
  assert.deepEqual([w.who, w.mood], [at.id, 'grief']); assert.match(w.text, /伏兵奇袭/);
  await p.evaluate(() => document.querySelector('.panel.msg')?.click());
  await p.waitForFunction(() => !window.__game.war.st.busy);
  // An enemy walks into the player's: the one who set it, 喜. All forest, so wherever he marches it springs.
  const by = await p.evaluate(() => {
    const w = window.__game.war, f = w.field, me = f.alive.find((x) => x.side === f.human), foe = f.alive.find((x) => x.side !== f.human);
    for (const row of f.map) row.fill(0);
    f.ambush = { [me.side]: { u: me, x: foe.x, y: foe.y, days: 5 } };
    f.dist = () => 0;
    w.cancel(); w.cancel(); w.endTurn();
    return me.id;
  });
  let sprung = await nextWindow(p); // an enemy may cast a 计略 of his own on the way; those windows pass
  for (let i = 0; i < 30 && !/伏兵发动奇袭/.test(sprung.text); i++) { await p.evaluate(() => document.querySelector('.panel.msg')?.click()); await p.waitForTimeout(150); sprung = await nextWindow(p); }
  assert.deepEqual([sprung.who, sprung.mood], [by, 'joy']); assert.match(sprung.text, /伏兵发动奇袭/);
  await p.context().close();
});

test('单挑: the one left standing shouts after a retreat, 怒, and the one who ran wears 忧', async () => {
  const p = await game.open('&flat');
  await newCampaign(p);
  await p.evaluate(() => { window.__run = window.__game.debug.quickTactical(38, 51, 2); });
  await p.waitForSelector('.tq-form'); await p.click('.tq-form'); await p.locator('.tq-deploy:not(.arming)').click();
  await p.waitForFunction(() => window.__tq && !document.querySelector('.tq-formation'));
  await p.waitForTimeout(1500);
  const start = p.locator('.tq-start .tq-btn.primary:not(.arming)');
  if (await start.waitFor({ timeout: 5000 }).then(() => true, () => false)) await start.click();
  await p.evaluate(() => { const t = window.__tq; t.startDuel('a'); });
  await p.waitForSelector('.tq-duel-acts', { timeout: 60000 });
  await p.evaluate(() => { const t = window.__tq; for (const s of ['a', 'd']) t.duel.side[s].hp = 999; });
  await p.locator('.tq-duel-acts .dcmd', { hasText: '退却' }).click();
  await p.waitForFunction(() => document.querySelector('.tq-dlog')?.textContent.includes('临阵脱逃'), null, { timeout: 30000 });
  const faces = await p.evaluate(() => [...document.querySelectorAll('.tq-dcard .tq-dface img')].map((i) => i.getAttribute('src')));
  assert.ok(faces.some((s) => /-angry\.webp$/.test(s)), `someone is angry: ${faces}`);
  assert.ok(faces.some((s) => /-grief\.webp$/.test(s)), `someone is grieved: ${faces}`);
  await p.context().close();
});
