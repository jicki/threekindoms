// War-map 计略 as the original plays it (analysis/pacing-original.json, war.per_decision.施计): the cast
// animation with its phrase (state 8/9, 85 frames), then a window telling what it did — 「士兵减少…」 or the
// failure (8/11, a fixed 95 frames), then the board takes over (8/16 and the rest): 209 frames, 3.48 s.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, newCampaign, closeMessages, near, warRest, castGo, CARD_ACTS } from './game.mjs';

let game, page;
// A war on the player's turn: the player attacks the strongest neighbouring AI city, so the AI side waits.
async function toWar(page, { stopAtDeploy = false } = {}) {
  await newCampaign(page);
  await page.evaluate(() => {
    const { g, G, debug } = window.__game, home = g.factions[g.player].city;
    const to = G.roads(home).map((c) => g.cities[c]).filter((c) => c.faction !== g.player && c.faction !== G.NONE && c.officers.length).sort((a, b) => b.officers.length - a.officers.length)[0];
    for (const id of g.cities[home].officers) g.officers[id].soldiers ||= 500;
    for (const id of to.officers) g.officers[id].soldiers ||= 500;
    const ids = g.cities[home].officers.slice(0, 3);
    const w = debug.setupWar(g, { from: home, to: to.id, ids, commander: ids[0], gold: 100, rice: 400 });
    debug.fieldWar(w, 'att');
  });
  const stop = closeMessages(page);
  try {
    await page.waitForFunction(() => window.__game.war?.st.deploying && document.body.dataset.screen === 'war' && !document.querySelector('.banner, .panel.msg, #fade.on'), null, { timeout: 60000 });
    if (stopAtDeploy) return;
    await page.evaluate(() => window.__game.war.finishDeploy());
    await page.waitForFunction(() => { const w = window.__game.war, f = w.field; return f.turn === f.human && !w.st.busy && !document.querySelector('.banner, .panel.msg'); }, null, { timeout: 30000 });
  } finally { stop(); }
}
// Both views: the shared page is the flat map (&flat); the 3D default has its own page, opened on first use.
before(async () => { game = await startGame(); page = await game.open('&flat'); await toWar(page); });
let page3d;
const threeD = async () => { if (!page3d) { page3d = await game.open('', { clock: true }); await toWar(page3d); } return page3d; };
const VIEWS = ['3D', 'flat'], pageOf = (v) => (v === 'flat' ? page : threeD());
after(() => game?.close());

// Plays an enemy 计略 on one of the player's units through the war view and records, every 20 ms, the picture's
// caption and the text of any window on screen.
async function cast(hit, speed = 1) {
  return page.evaluate(async ({ hit, speed }) => {
    const P = await import('./src/pace.js'); P.setPace(speed);
    const w = window.__game.war, f = w.field, G = window.__game.G;
    const foe = f.alive.find((u) => u.side !== f.human), me = f.alive.find((u) => u.side === f.human);
    const res = hit ? { ok: true, hit: true, name: '火计', lines: [`${G.name(me.id)} 损兵 120`], hits: [{ u: me, soldiers: -120 }] }
      : { ok: true, hit: false, name: '火计', lines: ['火计失败'], hits: [] };
    const tl = [], t0 = performance.now();
    const rec = setInterval(() => tl.push({ t: performance.now() - t0, vig: document.querySelector('.vig .vig-cap')?.textContent ?? null, msg: document.querySelector('.panel.msg')?.textContent ?? null }), 20);
    await w.playStrategy(foe, me, 0, res);
    const total = performance.now() - t0;
    clearInterval(rec); P.setPace(1);
    return { total, tl };
  }, { hit, speed });
}
// Where the 3D camera is aimed once a 计略 has played, from a view the player slid at 中 (devblog #96, 2026-11-03): the
// player's own keeps his view, an enemy's still goes to it, as the player is not looking there.
async function aimAfterCast(page, mine) {
  return page.evaluate(async (mine) => {
    const P = await import('./src/pace.js'); P.setPace(4);
    const w = window.__game.war, f = w.field, aim = () => w.probe().view;
    const me = f.alive.find((u) => u.side === f.human), foe = f.alive.find((u) => u.side !== f.human);
    for (let i = 0; i < 40 && aim().zoom === 'whole'; i++) w.zoom(-120);
    w.pan(-3, 2);
    const before = aim().target, zoom = aim().zoom;
    await w.playStrategy(mine ? me : foe, mine ? foe : me, 0, { ok: true, hit: false, name: '火计', lines: ['火计失败'], hits: [] });
    P.setPace(1);
    return { before, after: aim().target, zoom, zoomAfter: aim().zoom };
  }, mine);
}
// How long a predicate held over the timeline, from its first to its last sample.
const span = (tl, p) => { const on = tl.filter(p); return on.length ? on.at(-1).t - on[0].t : 0; };

for (const hit of [true, false]) {
  // The picture runs longer than the original's 1.41 s cast (ORIGINAL.strategyShow, the user's call of 2026-11-07); what follows it keeps the original's 2.07 s.
  test(`an enemy 计略 ${hit ? 'that hits' : 'that fails'}: picture, then a window with the outcome, 4.87 s in all`, async () => {
    const { total, tl } = await cast(hit);
    const pic = span(tl, (s) => s.vig), win = span(tl, (s) => s.msg);
    assert.ok(tl.some((s) => s.vig?.includes('火计')), 'the picture names the 计略');
    assert.ok(!tl.some((s) => /奏效|识破/.test(s.vig ?? '')), 'the outcome is not told in the picture');
    assert.ok(near(pic, 2800, 0.25), `picture held ${Math.round(pic)} ms`);
    const text = tl.find((s) => s.msg)?.msg ?? '';
    if (hit) assert.match(text, /损兵 120/, 'the window tells what it did'); else assert.match(text, /失败|识破/);
    assert.ok(tl.findIndex((s) => s.msg) > tl.findLastIndex((s) => s.vig), 'the window comes after the picture');
    assert.ok(near(win, 1580, 0.25), `window held ${Math.round(win)} ms`);
    assert.ok(near(total, 4870, 0.15), `the whole 计略 took ${Math.round(total)} ms`);
  });
}

// The player's day opens with no one selected (player feedback, 2026-11-03): the commander used to be, so a click
// that missed another general landed on an empty cell in his reach and marched him off. The camera still turns to him.
test('the day opens with no one selected, and a click on an empty cell moves no one', async () => {
  const p = await game.open('&flat'); await toWar(p);
  const click = () => p.evaluate(() => {
    const w = window.__game.war, f = w.field, c = f.alive.find((u) => u.side === f.human && u.commander);
    const at = (u) => `${u.x},${u.y}`, before = f.alive.map(at).join(' '), pool = f.pool[f.human];
    const [x, y] = [...f.reach(c).dist.keys()].map((k) => k.split(',').map(Number)).find(([x, y]) => !f.unitAt(x, y));
    const sel = w.st.sel, bar = !!document.querySelector('.unitpanel:not(.compare) .acts button');
    w.clickCell(x, y);
    return { sel, bar, moved: f.alive.map(at).join(' ') !== before, spent: pool - f.pool[f.human] };
  });
  assert.deepEqual(await click(), { sel: null, bar: false, moved: false, spent: 0 }, 'the first day');
  const day = await p.evaluate(async () => { (await import('./src/pace.js')).setPace(4); const w = window.__game.war, d = w.field.day; w.endTurn(); return d; });
  const stop = closeMessages(p);
  try {
    await p.waitForFunction((d) => { const w = window.__game.war, f = w.field; return f.over || (f.day > d && f.turn === f.human && !w.st.busy); }, day, { timeout: 120000 });
  } finally { stop(); }
  if (!(await p.evaluate(() => window.__game.war.field.over))) assert.deepEqual(await click(), { sel: null, bar: false, moved: false, spent: 0 }, 'the next day');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('at 4× the whole 计略 takes a quarter as long', async () => {
  const { total } = await cast(true, 4);
  assert.ok(near(total, 1218, 0.3), `took ${Math.round(total)} ms`);
});

// Each of the 16 计略 plays its own picture and its own effect on the board (playtest feedback of 2026-10-29:
// several shared one picture). The picture's scene is on the frame as data-scene; the board effect is read from
// the war view's STRAT_FX recipe names.
test('all 16 original 计略 have their own pictures and board effects, and all of them play', async () => {
  const r = await page.evaluate(async () => {
    const P = await import('./src/pace.js'), W = await import('./src/warview.js'), F = await import('./src/core/field.js'); P.setPace(4);
    const w = window.__game.war, f = w.field;
    const foe = f.alive.find((u) => u.side !== f.human), me = f.alive.find((u) => u.side === f.human);
    const index = await fetch('assets/ai/vignettes/index.json').then((x) => x.json());
    const seen = [], audio = window.__game.audio, originalSfx = audio.sfx, sounds = [];
    audio.sfx = (key) => sounds.push(key);
    for (const s of F.STRATS.slice(0, 16)) {
      sounds.length = 0;
      let scene = null; const watch = setInterval(() => { scene ||= document.querySelector('.vig')?.dataset.scene ?? null; }, 10);
      await w.playStrategy(foe, me, s.id, { ok: true, hit: true, name: s.name, lines: ['测试'], hits: [] });
      clearInterval(watch);
      const S = index[W.STRAT_SCENE[s.id]];
      const art = S ? await Promise.all([S.story.src].map((src) => fetch(`assets/ai/vignettes/${src}`).then((x) => x.ok))) : [false];
      seen.push({ name: s.name, scene, art: art.every(Boolean), fx: W.STRAT_FX[s.id], sound: sounds.filter((key) => key !== 'sfx-horn') });
    }
    sounds.length = 0;
    await w.playStrategy(foe, me, 4, { ok: true, hit: false, name: '乱水', lines: ['测试失败'], hits: [] });
    const failureSounds = sounds.filter((key) => key !== 'sfx-horn'); audio.sfx = originalSfx;
    P.setPace(1);
    return { seen, failureSounds };
  });
  assert.equal(r.seen.length, 16);
  for (const s of r.seen) { assert.ok(s.scene, `${s.name} played a picture`); assert.ok(s.art, `${s.name}'s art is published`); }
  const expected = ['sfx-tactic-fire', 'sfx-clash', 'sfx-tactic-bind', 'sfx-clash', 'sfx-strategy-water', 'sfx-tactic-fire', 'sfx-clash', 'sfx-clash',
    'sfx-strategy-lure', 'sfx-clash', 'sfx-tactic-bind', 'sfx-clash', 'sfx-strategy-water', 'sfx-tactic-xbow', 'sfx-tactic-fire', 'sfx-tactic-bind'];
  assert.deepEqual(r.seen.map((s) => s.sound), expected.map((key) => [key]));
  assert.deepEqual(r.failureSounds, []);
  const dup = (k) => r.seen.filter((s, i) => r.seen.findIndex((x) => x[k] === s[k]) !== i).map((s) => s.name);
  assert.deepEqual(dup('scene'), [], '计略 sharing a picture');
  assert.deepEqual(dup('fx'), [], '计略 sharing a board effect');
});

// A 计略 is admitted by the mobility it costs, at every step (feedback T01, 2026-10-30): with exactly enough for
// one 火计, the cast spends it; while it plays the unit panel's commands stay in place, greyed; afterwards neither the war view
// nor the rules let a second one through, whichever menu was open before.
for (const v of VIEWS) test(`with mobility for one 计略, a second cannot be cast, from the panel or the rules (${v})`, async () => {
  const page = await pageOf(v);
  const setup = await page.evaluate(async () => {
    const P = await import('./src/pace.js'); P.setPace(4);
    const w = window.__game.war, f = w.field;
    const me = f.alive.find((u) => u.side === f.human), e = f.alive.find((u) => u.side !== f.human);
    if (!f.legal(me, 0, e)) {
      const home = [e.x, e.y]; let ok = false;
      for (let dy = -3; dy <= 3 && !ok; dy++) for (let dx = -3; dx <= 3 && !ok; dx++) {
        const x = me.x + dx, y = me.y + dy; if ((dx || dy) && f.inside(x, y) && !f.unitAt(x, y)) { e.x = x; e.y = y; ok = f.legal(me, 0, e); }
      }
      if (!ok) { [e.x, e.y] = home; return null; }
    }
    f.pool[f.human] = 6; w.clickCell(me.x, me.y);
    window.__t01 = { me, e };
    return { menu: [...document.querySelectorAll('.unitpanel:not(.compare) .acts button')].map((b) => b.textContent) };
  });
  assert.ok(setup, 'a 火计 target near the player\'s unit');
  assert.ok(setup.menu.includes('计略'), 'the panel offers 计略 with 6 mobility');
  await page.evaluate(() => { const w = window.__game.war, { e } = window.__t01; w.chooseStrategy(0); w.clickCell(e.x, e.y); });
  await page.locator('.actpanel .ap-go:not([disabled])').waitFor();
  const askedFoe = await page.evaluate(() => ({ card: document.querySelector('.unitpanel.compare h3')?.textContent, foe: window.__game.G.name(window.__t01.e.id) }));
  assert.ok(askedFoe.card?.includes(askedFoe.foe), `while the 计略 is asked, the target's card stands on the right: ${askedFoe.card}`);
  await castGo(page);
  const during = await page.evaluate(async () => {
    const w = window.__game.war; while (!w.st.busy) await new Promise((r) => setTimeout(r, 10));
    const menu = [...document.querySelectorAll('.unitpanel:not(.compare) .acts button')].map((b) => ({ text: b.textContent, disabled: b.disabled }));
    w.chooseStrategy(0); // a click on a menu left over from before the cast
    return { menu, cast: w.st.cast };
  });
  assert.ok(during.menu.some((b) => b.text === '计略'), 'the commands stay in place while the 计略 plays');
  assert.ok(during.menu.every((b) => b.disabled), `every command greyed while the 计略 plays: ${JSON.stringify(during.menu)}`);
  assert.equal(during.cast, null, 'choosing a 计略 meanwhile does nothing');
  const after = await page.evaluate(async () => {
    const w = window.__game.war, f = w.field, { me, e } = window.__t01;
    while (w.st.busy) await new Promise((r) => setTimeout(r, 20));
    const pool = f.pool[f.human], soldiers = f.O(e.id).soldiers;
    w.chooseStrategy(0); const cast = w.st.cast;
    const res = f.cast(me, 0, e);
    (await import('./src/pace.js')).setPace(1);
    return { pool, cast, ok: res.ok, line: res.lines[0], spent: pool - f.pool[f.human], lost: soldiers - f.O(e.id).soldiers };
  });
  assert.equal(after.pool, 0, 'the first 火计 spent all 6');
  assert.equal(after.cast, null, 'the view does not pick a target with 0 mobility');
  assert.equal(after.ok, false, 'the rules refuse the cast');
  assert.equal(after.line, '机动力不足');
  assert.equal(after.spent, 0); assert.equal(after.lost, 0, 'nothing happens to the target');
});

// The 计略 list stands in the action panel without a dialog shade, so the map's own keys must not see keys meant for it: Enter
// picks the focused 计略 and does not end the day as well (adversarial review R1).
for (const v of VIEWS) test(`Enter in the 计略 list picks a 计略 and does not end the day (${v})`, async () => {
  const page = await pageOf(v);
  const before = await page.evaluate(() => {
    const w = window.__game.war, f = w.field, { me } = window.__t01;
    f.pool[f.human] = 30; w.clickCell(me.x, me.y);
    return { day: f.day, turn: f.turn };
  });
  await page.locator(CARD_ACTS, { hasText: '计略' }).click();
  await page.waitForSelector('.actpanel.strats');
  await page.keyboard.press('Enter');
  const after = await page.evaluate(() => { const w = window.__game.war, f = w.field; return { day: f.day, turn: f.turn, cast: w.st.cast, pop: !!document.querySelector('.actpanel.strats') }; });
  assert.equal(after.pop, false, 'the menu closed on the pick');
  assert.notEqual(after.cast, null, 'the focused 计略 was chosen');
  assert.deepEqual([after.day, after.turn], [before.day, before.turn], 'the day did not end');
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); // back to the list, then to his commands
});

// The 计略 list tells what each 计略 does and where it can be cast, and greyed, why not now (feedback R10, 2026-11-02):
// a 计略 that needs the caster on certain ground says so instead of "no target within 6 cells".
for (const v of VIEWS) test(`the 计略 list tells each 计略's effect and condition, and the real reason it is greyed (${v})`, async () => {
  const page = await pageOf(v);
  const why = await page.evaluate(async () => {
    const F = await import('./src/core/field.js'), w = window.__game.war, f = w.field, { me } = window.__t01, terr = f.terr;
    f.pool[f.human] = 30; f.terr = () => F.PLAIN;
    const r = { 11: f.whyNot(me, 11), 9: f.whyNot(me, 9), 13: f.whyNot(me, 13) };
    f.pool[f.human] = 0; r.pool = f.whyNot(me, 0);
    f.terr = terr; f.pool[f.human] = 30;
    return r;
  });
  assert.deepEqual([why[11], why[9], why[13]], ['需自己位于森林', '需自己位于山地或城中', '需自己位于城中']);
  assert.match(why.pool, /^机动力不足（需 6，剩 0）$/);
  await page.evaluate(() => { const w = window.__game.war, { me } = window.__t01; if (w.st.sel !== me) w.clickCell(me.x, me.y); });
  await page.locator(CARD_ACTS, { hasText: '计略' }).click();
  await page.waitForSelector('.actpanel.strats');
  const menu = await page.evaluate(() => [...document.querySelectorAll('.actpanel .strats .btn')].map((b) => ({ name: b.querySelector('span').textContent, tip: b.title, off: b.disabled, row: b.querySelector('em')?.textContent ?? null })));
  assert.ok(menu.length > 0 && menu.every((m) => /条件：/.test(m.tip)), `every 计略 tells its condition ${JSON.stringify(menu)}`);
  assert.ok(menu.filter((m) => m.off).every((m) => /现在不能用：/.test(m.tip)), 'a greyed one tells why');
  // D32 §4: the reason stands in the row itself, not only in a tooltip
  assert.ok(menu.filter((m) => m.off).every((m) => m.row), `a greyed row says why in the row: ${JSON.stringify(menu.filter((m) => m.off))}`);
  await page.locator('.actpanel .strats .btn:not([disabled])').first().focus();
  const foot = await page.locator('.actpanel .ap-info').textContent();
  assert.match(foot, new RegExp(`^${menu.find((m) => !m.off).name}.*条件：`), `the foot tells the focused one: ${foot}`);
  await page.keyboard.press('Escape');
});

// What a 计略 did rises over each one it struck (feedback R07, 2026-11-02), as 奇门遁甲's daily loss does.
for (const v of VIEWS) test(`a 计略 that hits raises each target's loss over him (${v})`, async () => {
  const page = await pageOf(v);
  await page.evaluate(async () => {
    (await import('./src/pace.js')).setPace(4);
    const w = window.__game.war, f = w.field, { me, e } = window.__t01;
    window.__t05 = { legal: f.legal, canCast: f.canCast, hit: f.hitChance, before: f.O(e.id).soldiers, seen: [] };
    f.legal = () => true; f.canCast = () => true; f.hitChance = () => 100; f.pool[f.human] = 30;
    const mo = new MutationObserver(() => { for (const n of document.querySelectorAll('.lossnum')) if (!window.__t05.seen.includes(n.textContent)) window.__t05.seen.push(n.textContent); });
    mo.observe(document.body, { subtree: true, childList: true }); window.__t05.mo = mo;
    if (w.st.sel !== me) w.clickCell(me.x, me.y);
    w.chooseStrategy(0); w.clickCell(e.x, e.y);
  });
  await castGo(page);
  const r = await page.evaluate(async () => {
    const w = window.__game.war, f = w.field, { e } = window.__t01, t = window.__t05;
    await new Promise((r) => setTimeout(r, 50)); while (w.st.busy) await new Promise((r) => setTimeout(r, 20));
    t.mo.disconnect(); f.legal = t.legal; f.canCast = t.canCast; f.hitChance = t.hit; (await import('./src/pace.js')).setPace(1);
    return { seen: t.seen, lost: t.before - f.O(e.id).soldiers };
  });
  assert.ok(r.lost > 0, 'the 火计 took soldiers');
  if (v === '3D') assert.ok(r.seen.includes(`−${r.lost}`), `−${r.lost} rose over him: ${JSON.stringify(r.seen)}`);
});

// A click on an enemy only asks (playtest of 2026-10-31, F02; D32 §6: the 攻击 confirmation stands in the action panel), which Esc or a
// right click puts away for nothing; only its answer (the button, Enter, or a new click on him) strikes. While a 计略's target is
// being chosen, a click off the purple cells keeps the choice open instead of dropping it.
for (const v of VIEWS) test(`a click on an adjacent enemy asks before striking; a 计略 target choice survives a stray click (${v})`, async () => {
  const page = await pageOf(v);
  const r = await page.evaluate(async () => {
    const w = window.__game.war, f = w.field, { me, e } = window.__t01;
    const free = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [me.x + dx, me.y + dy]).find(([x, y]) => f.inside(x, y) && !f.unitAt(x, y));
    const home = [e.x, e.y]; [e.x, e.y] = free;
    f.pool[f.human] = 30; w.clickCell(me.x, me.y); w.clickCell(e.x, e.y);
    const asked = { pool: f.pool[f.human], busy: w.st.busy, peek: w.st.strike?.t === e, prompt: !!document.querySelector('.actpanel.strike'), panel: document.querySelector('.unitpanel h3')?.textContent, foeCard: document.querySelector('.unitpanel.compare h3')?.textContent };
    w.cancel();
    const put = { pool: f.pool[f.human], peek: w.st.strike, prompt: !!document.querySelector('.actpanel.strike'), sel: w.st.sel === me };
    // the answer strikes: the rules' attack is called once, for this pair (stubbed, so no 白兵 plays here)
    const calls = [], real = f.attack;
    f.attack = (a, t) => { calls.push([a === me, t === e]); return { lossA: 0, lossD: 0, a: {}, d: {} }; };
    w.clickCell(e.x, e.y);
    window.__t02 = { calls, real, home };
    return { asked, put, name: window.__game.G.name(e.id) };
  });
  assert.equal(r.asked.pool, 30, 'the click spent nothing'); assert.equal(r.asked.busy, false, 'nothing plays');
  assert.ok(r.asked.peek && r.asked.prompt, 'the 攻击 confirmation stands in the panel');
  assert.match(r.asked.foeCard, new RegExp(r.name), 'the target\'s card stands beside ours while the attack is asked');
  assert.doesNotMatch(r.asked.panel, new RegExp(r.name), 'ours stays on the left');
  assert.deepEqual([r.put.pool, r.put.peek, r.put.prompt, r.put.sel], [30, null, false, true], 'cancelled for nothing, ours still selected');
  await page.waitForTimeout(350); // past the confirmation's short guard (src/commitguard.js)
  await page.keyboard.press('Enter');
  const struck = await page.evaluate(async () => {
    const w = window.__game.war, f = w.field, { calls, real, home } = window.__t02, { me, e } = window.__t01;
    while (w.st.busy) await new Promise((r) => setTimeout(r, 20));
    f.attack = real; [e.x, e.y] = home;
    const day = f.day;
    // 火计 chosen, then an empty cell and a unit that is not its target are clicked: still choosing; Esc leaves it
    f.pool[f.human] = 30; w.clickCell(me.x, me.y); w.chooseStrategy(0);
    const empty = [[2, 0], [0, 2], [-2, 0], [0, -2]].map(([dx, dy]) => [me.x + dx, me.y + dy]).find(([x, y]) => f.inside(x, y) && !f.unitAt(x, y) && !(x === e.x && y === e.y));
    w.clickCell(...empty);
    const afterEmpty = w.st.cast;
    return { calls, day, afterEmpty, pool: f.pool[f.human] };
  });
  assert.deepEqual(struck.calls, [[true, true]], 'Enter on the prompt struck that enemy, once');
  assert.equal(struck.afterEmpty, 0, 'an empty cell keeps the 火计 target choice');
  await page.keyboard.press('Escape');
  const left = await page.evaluate(() => { const w = window.__game.war, f = w.field; return { cast: w.st.cast, pool: f.pool[f.human], day: f.day }; });
  assert.equal(left.cast, null, 'Esc leaves the choice'); assert.equal(left.pool, 30, 'for nothing');
  assert.equal(left.day, struck.day, 'Esc did not end the day');
});

// Enter belongs to a focused button of the 攻击 confirmation (adversarial review R1): on 返回 it goes back and strikes
// nothing; only elsewhere does it answer 攻击.
for (const v of VIEWS) test(`Enter on a focused 返回 in the 攻击 confirmation goes back and strikes nothing (${v})`, async () => {
  const page = await pageOf(v);
  await page.evaluate(() => {
    const w = window.__game.war, f = w.field, { me, e } = window.__t01;
    const free = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [me.x + dx, me.y + dy]).find(([x, y]) => f.inside(x, y) && !f.unitAt(x, y));
    window.__t03 = { home: [e.x, e.y], calls: [], real: f.attack }; [e.x, e.y] = free;
    f.attack = (...a) => { window.__t03.calls.push(a.length); return { lossA: 0, lossD: 0, a: {}, d: {} }; };
    f.pool[f.human] = 30; w.clickCell(me.x, me.y); w.clickCell(e.x, e.y);
  });
  await page.waitForTimeout(350);
  await page.locator('.actpanel.strike .ap-back').focus();
  await page.keyboard.press('Enter');
  const r = await page.evaluate(async () => {
    const w = window.__game.war, f = w.field, { e } = window.__t01, t = window.__t03;
    while (w.st.busy) await new Promise((r) => setTimeout(r, 20));
    f.attack = t.real; [e.x, e.y] = t.home;
    return { calls: t.calls.length, pool: f.pool[f.human], prompt: !!document.querySelector('.actpanel.strike'), peek: w.st.strike };
  });
  assert.equal(r.calls, 0, 'no attack'); assert.equal(r.pool, 30, 'nothing spent');
  assert.equal(r.prompt, false, 'the confirmation is put away'); assert.equal(r.peek, null);
});

// The 计略 confirmation casts on 施展 only (feedback R01, 2026-11-02; D32: it stands in the action panel): 返回, Esc and a click
// elsewhere on the map each leave the mobility and the target as they were, for a targeted 计略 and for 十面埋伏, which has none.
for (const v of VIEWS) test(`返回, Esc or a click elsewhere casts nothing (${v})`, async () => {
  const page = await pageOf(v);
  await page.evaluate(() => {
    const w = window.__game.war, f = w.field, { me } = window.__t01;
    window.__t04 = { calls: 0, cast: f.cast, canCast: f.canCast };
    window.__t04.legal = f.legal; f.legal = () => true; // wherever the earlier tests left the target
    f.canCast = () => true; f.cast = () => { window.__t04.calls++; return { ok: true, hit: false, lines: [], hits: [] }; };
    f.pool[f.human] = 30;
  });
  const ways = {
    返回: () => page.locator('.actpanel .ap-back').click(),
    Esc: () => page.keyboard.press('Escape'),
    elsewhere: () => page.evaluate(() => { const w = window.__game.war, f = w.field, { me } = window.__t01; // an empty cell near him
      const c = [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [0, 2]].map(([dx, dy]) => [me.x + dx, me.y + dy]).find(([x, y]) => f.inside(x, y) && !f.unitAt(x, y)); w.clickCell(...c); }),
  };
  const seen = [];
  for (const id of [0, 11]) for (const [how, answer] of Object.entries(ways)) {
    await page.evaluate((id) => { const w = window.__game.war, { me, e } = window.__t01; if (w.st.sel !== me) w.clickCell(me.x, me.y); w.chooseStrategy(id); if (id !== 11) w.clickCell(e.x, e.y); }, id);
    await page.locator('.actpanel.confirm .ap-go:not([disabled])').waitFor();
    await page.waitForTimeout(400); // past the guard: had the answer been 施展, it would cast
    await answer();
    seen.push(await page.evaluate(async ({ id, how }) => {
      const w = window.__game.war, f = w.field, { e } = window.__t01;
      await new Promise((r) => setTimeout(r, 300));
      const r = { id, how, calls: window.__t04.calls, pool: f.pool[f.human], soldiers: f.O(e.id).soldiers, busy: w.st.busy };
      for (let i = 0; i < 3 && (w.st.confirm || w.st.cast != null || w.st.menu); i++) w.cancel(); // back out of whatever step is left
      return r;
    }, { id, how }));
  }
  await page.evaluate(() => { const f = window.__game.war.field, t = window.__t04; f.cast = t.cast; f.canCast = t.canCast; f.legal = t.legal; });
  const soldiers = seen[0].soldiers;
  for (const s of seen) assert.deepEqual([s.calls, s.pool, s.soldiers, s.busy], [0, 30, soldiers, false], `${s.how} on ${s.id === 11 ? '十面埋伏' : '火计'} cast nothing`);
});

// His commands stand in his card (D32; feedback R05, 2026-11-02, they used to ride beside him): sliding the camera, even him off the
// screen, leaves them where they are; the 计略 list opens at the panel's own place; Esc steps back one step at a time and, with
// nothing else to put away, lets go of him.
test('the commands stay in his card whatever the camera does, and Esc steps back one at a time (3D)', async () => {
  const p = await threeD();
  await p.evaluate(() => { const w = window.__game.war, f = w.field; w.cancel(); w.cancel(); w.overview(); f.pool[f.human] = 30; });
  await p.waitForTimeout(1300);
  await p.evaluate(() => window.__game.war.zoom(-150)); await p.waitForTimeout(900); // 远: close enough to slide him off
  await p.evaluate(() => { const w = window.__game.war, { me } = window.__t01; w.clickCell(me.x, me.y); });
  await p.waitForTimeout(1200);
  const place = () => p.evaluate(() => { const r = document.querySelector('.unitpanel:not(.compare) .acts')?.getBoundingClientRect(); return r ? { x: Math.round(r.left), y: Math.round(r.top) } : null; });
  const at = await place();
  assert.ok(at, 'his commands are in his card');
  const ride = await p.evaluate(async () => {
    const w = window.__game.war, out = [];
    for (let i = 0; i < 40; i++) { w.pan(0.05, 0); await new Promise((r) => requestAnimationFrame(r)); const r = document.querySelector('.unitpanel:not(.compare) .acts').getBoundingClientRect(); out.push(`${Math.round(r.left)},${Math.round(r.top)}`); }
    return [...new Set(out)];
  });
  assert.deepEqual(ride, [`${at.x},${at.y}`], 'they do not move while the camera slides');
  await p.evaluate(() => { const w = window.__game.war, { me } = window.__t01, y = w.viewState().yaw, c = Math.cos(y), s = Math.sin(y), sx = me.x < 16 ? 1 : -1;
    w.pan(sx * c * 40, sx * s * 40); });
  await p.waitForTimeout(1800);
  const off = await p.evaluate(() => { const w = window.__game.war, { me } = window.__t01, c = w.screenOf(me.x, me.y);
    return { onScreen: c.x > 0 && c.x < innerWidth && c.y > 0 && c.y < innerHeight, card: [...document.querySelectorAll('.unitpanel:not(.compare) .acts button')].map((b) => b.textContent) }; });
  assert.equal(off.onScreen, false, 'he is off the screen');
  assert.ok(off.card.includes('计略'), `his commands are still in his card: ${off.card}`);
  assert.deepEqual(await place(), at, 'in the same place');
  await p.locator(CARD_ACTS, { hasText: '计略' }).click();
  await p.waitForSelector('.actpanel.strats');
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  assert.ok(!(await p.locator('.actpanel').count()) && (await p.locator(CARD_ACTS, { hasText: '计略' }).count()), 'Esc closed the list, back to his commands');
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  const gone = await p.evaluate(() => ({ sel: window.__game.war.st.sel, acts: !!document.querySelector('.unitpanel:not(.compare) .acts button'), card: !!document.querySelector('.unitpanel:not(.compare)') }));
  assert.deepEqual(gone, { sel: null, acts: false, card: false }, 'Esc put his commands and card away');
  await p.evaluate(() => window.__game.war.overview()); await p.waitForTimeout(1300);
});

// The 计略 list opens at the action panel's own place whoever casts and wherever he stands (D32 U01; it used to open beside his
// commands, which stood beside him, F01): a general at the left or the right edge of the board (flat), or of the screen (3D),
// gets the same panel, on the screen and clear of the cards, the dock and the title.
const panelAt = {};
for (const v of VIEWS) for (const edge of ['right', 'left']) test(`the 计略 list opens at the panel's place for a general at the ${edge} edge (${v})`, async () => {
  const page = await pageOf(v);
  const back = await page.evaluate(({ edge, v }) => {
    const w = window.__game.war, f = w.field, { me } = window.__t01, home = [me.x, me.y];
    for (let i = 0; i < 4; i++) w.cancel();
    if (v === 'flat') { const x = edge === 'right' ? 31 : 0, y = [...Array(19).keys()].find((y) => !f.unitAt(x, y)); me.x = x; me.y = y; }
    f.pool[f.human] = 30; w.clickCell(me.x, me.y);
    return home;
  }, { edge, v });
  if (v === '3D') for (let i = 0, x = 0; i < 40; i++) { // slide the board until he stands at the screen's edge
    await page.waitForTimeout(450);
    x = await page.evaluate(() => { const p = window.__game.war.screenOf(window.__game.war.st.sel.x, window.__game.war.st.sel.y); return p.x / innerWidth; });
    if (edge === 'right' ? x > 0.9 && x < 0.97 : x < 0.1 && x > 0.03) break;
    const step = edge === 'right' ? (x >= 0.97 ? 0.5 : -1) : (x <= 0.03 ? -0.5 : 1);
    await page.evaluate((step) => window.__game.war.pan(step, 0), step);
  }
  await page.waitForTimeout(600);
  await page.locator(CARD_ACTS, { hasText: '计略' }).click();
  await page.waitForSelector('.actpanel.strats');
  await page.waitForTimeout(250); // past its opening animation
  const box = await page.evaluate(() => {
    const r = document.querySelector('.actpanel').getBoundingClientRect(), hit = (s) => [...document.querySelectorAll(s)].some((e) => { const b = e.getBoundingClientRect(); return e.getClientRects().length && r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top; });
    return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), W: innerWidth, H: innerHeight, overHud: hit('.unitpanel, .wardock, .warbar, .sysbtns') };
  });
  await page.keyboard.press('Escape');
  await page.evaluate(({ home, v }) => { const w = window.__game.war, { me } = window.__t01; [me.x, me.y] = home; for (let i = 0; i < 4; i++) w.cancel(); w.clickCell(me.x, me.y); if (v === '3D') w.resetView(); }, { home: back, v });
  assert.ok(box.l >= 0 && box.r <= box.W && box.t >= 0 && box.b <= box.H, `panel ${JSON.stringify(box)}`);
  assert.equal(box.overHud, false, `the panel keeps off the cards, the dock and the title ${JSON.stringify(box)}`);
  assert.equal(box.l, 12, 'at the left edge');
  if (panelAt[v]) assert.deepEqual([box.l, box.r, box.t, box.b], panelAt[v], 'the same place as for the general at the other edge'); else panelAt[v] = [box.l, box.r, box.t, box.b];
});

// Playtest of 2026-10-31, F04: crowded generals hide the ground they stand on and the cells behind them. The tip
// and the panel name the terrain; T held, or the 地形 button, shows the ground view, on the flat map and the 3D one.
for (const q of ['', '&flat']) test(`every cell names its ground in the tip and the panel; T or the 地形 button shows the ground view (${q ? 'flat' : '3D'})`, async () => {
  const page = await game.open(q); await toWar(page);
  const r = await page.evaluate(async () => {
    const w = window.__game.war, f = w.field;
    while (w.st.busy) await new Promise((r) => setTimeout(r, 20));
    w.cancel(); w.cancel();
    const u = f.side(f.human)[0], cells = [];
    for (let y = 0; y < 19; y++) for (let x = 0; x < 32; x++) if (!f.unitAt(x, y)) cells.push([x, y]);
    // one empty cell of every terrain the map has, a village too if there is one
    const kinds = new Map(); for (const [x, y] of cells) { const k = f.ground(x, y); if (!kinds.has(k)) kinds.set(k, [x, y]); }
    const empty = [...kinds].map(([k, [x, y]]) => ({ k, tip: w.hoverCell({ x, y })?.tip }));
    const onUnit = w.hoverCell({ x: u.x, y: u.y })?.tip;
    w.clickCell(u.x, u.y);
    const dl = [...document.querySelectorAll('.unitpanel dt')].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]);
    w.hoverCell(null);
    return { empty, onUnit, ground: f.ground(u.x, u.y), village: !!f.village(u), name: window.__game.G.name(u.id), dl };
  });
  assert.ok(r.empty.length >= 2, 'the map has more than one kind of ground');
  for (const { k, tip } of r.empty) assert.match(tip ?? '', new RegExp(`地形 ${k.replace(/[()（）]/g, '.')}`), `an empty ${k} cell names it`);
  assert.match(r.onUnit, new RegExp(r.name), 'a general\'s cell still names him'); assert.match(r.onUnit, /地形 /, 'and the ground under him');
  assert.deepEqual(r.dl.find(([k]) => k === '地形'), ['地形', r.village ? '村落' : r.ground], 'the panel gives his ground');
  const view = () => page.evaluate(() => [document.body.classList.contains('terrain-view'), document.querySelector('.wardock .terrainbtn')?.getAttribute('aria-pressed')]);
  assert.deepEqual(await view(), [false, 'false']);
  await page.keyboard.down('t'); assert.deepEqual(await view(), [true, 'false'], 'shown while T is held');
  await page.keyboard.up('t'); assert.deepEqual(await view(), [false, 'false'], 'gone on release');
  await page.locator('.wardock .terrainbtn').click(); assert.deepEqual(await view(), [true, 'true'], 'the button pins it');
  await page.keyboard.down('t'); await page.keyboard.up('t'); assert.deepEqual(await view(), [true, 'true'], 'a T press leaves it pinned');
  await page.locator('.wardock .terrainbtn').click(); assert.deepEqual(await view(), [false, 'false'], 'and the button puts it away');
  // The 3D map shows it with its own parts: the figures thin out to 0.18, the name tags go, and a plaque names the ground of every cell
  // a general stands on and the two behind him.
  if (!q) {
    const state = () => page.evaluate(async () => {
      await new Promise((r) => setTimeout(r, 700));
      const w = window.__game.war, p = w.probe();
      return { gtags: [...document.querySelectorAll('.gtag')].map((e) => [e.textContent, e.dataset.terrain]), tags: [...document.querySelectorAll('.tag')].map((e) => getComputedStyle(e).display), a: p.opacity.map((o) => o.a), units: w.field.alive.length };
    });
    const off = await state(); assert.equal(off.gtags.length, 0, 'no plaques while it is off'); assert.ok(off.tags.length && off.tags.every((d) => d !== 'none'), 'the tags show'); assert.ok(off.a.every((a) => a === 1));
    await page.keyboard.down('t'); const on = await state(); await page.keyboard.up('t');
    assert.ok(on.gtags.length >= on.units, `a plaque for each general's cell and those behind: ${on.gtags.length} for ${on.units}`);
    for (const [t, d] of on.gtags) assert.equal(t, d, 'the plaque names the ground');
    assert.ok(on.tags.every((d) => d === 'none'), 'every name tag is away'); assert.ok(on.a.every((a) => Math.abs(a - 0.18) < 0.02), `figures at 0.18: ${on.a}`);
    const gone = await state(); assert.equal(gone.gtags.length, 0, 'the plaques go on release'); assert.ok(gone.tags.every((d) => d !== 'none') && gone.a.every((a) => a === 1), 'tags and figures come back');
    // ... and every cell they name really is that ground
    await page.locator('.wardock .terrainbtn').click(); const pinned = await state(); await page.locator('.wardock .terrainbtn').click();
    const names = await page.evaluate(() => { const f = window.__game.war.field; return [...new Set(f.map.flat().map((t, i) => f.ground(i % 32, (i / 32) | 0)))]; });
    for (const [t] of pinned.gtags) assert.ok(names.includes(t), `${t} is a ground of this field`);
  }
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

// The unit card (war-3d Task 3): every field the original shows, the gear with its bonus, and a chip for each
// state the unit is in; hovering an enemy with one of ours selected puts his card beside ours.
const card = (page) => page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  return { dt: [...document.querySelectorAll('.unitpanel:not(.compare) dt')].map((e) => e.textContent), bars: [...document.querySelectorAll('.unitpanel:not(.compare) .bar')].map((e) => e.textContent), gear: q('.unitpanel:not(.compare) .gear')?.textContent ?? null,
    chips: q('.unitpanel:not(.compare) .chips')?.textContent ?? '', compare: q('.unitpanel.compare h3')?.textContent ?? null, cls: q('.unitpanel')?.className };
});
for (const v of VIEWS) test(`the unit card lists every field, the equipment with its bonus, and the status chips (${v})`, async () => {
  const page = await pageOf(v);
  const want = await page.evaluate(async () => {
    const w = window.__game.war, f = w.field, { g, G } = window.__game, D = G.data();
    w.cancel(); w.cancel(); w.hoverCell(null);
    const u = f.side(f.human)[0], o = g.officers[u.id], wp = D.equipment[o.weapon], ar = D.equipment[24 + o.armor];
    u.qimen = 3; w.clickCell(u.x, u.y);
    return { gear: [wp ? `武器 ${wp.name} 攻+${wp.atk}` : '武器 —', ar ? `防具 ${ar.name} 防+${ar.dfn}` : '防具 —'], name: G.name(u.id), id: u.id };
  });
  const c = await card(page);
  try {
    // 兵 and 体 are the bars' own figures; the list carries the rest (2026-11-13: no pair twice, so four fit a row)
    assert.equal(c.bars.length, 2); assert.match(c.bars[0], /^兵\d+$/); assert.match(c.bars[1], /^体\d+\/\d+$/);
    for (const k of ['武力', '智力', '人德', '忠诚', '等级', '经验', '军属性', '地形']) assert.ok(c.dt.includes(k), `${k} in ${c.dt}`);
    for (const t of want.gear) assert.ok(c.gear.includes(t), `${t} in "${c.gear}"`);
    assert.match(c.chips, /奇门 3日/); assert.match(c.cls, /panel unitpanel/);
    assert.equal(await page.locator('.unitpanel:not(.compare) img[src=""], .unitpanel:not(.compare) .gear img[src*="undefined"]').count(), 0, 'no broken icon');
    // unequipped reads as a dash, and a stopped unit as 受困
    const bare = await page.evaluate(() => { const w = window.__game.war, f = w.field, u = f.side(f.human)[0], o = window.__game.g.officers[u.id], keep = [o.weapon, o.armor, u.qimen]; o.weapon = 255; o.armor = 255; u.qimen = 0; u.stop = 2; w.clickCell(u.x, u.y); const r = { gear: document.querySelector('.unitpanel .gear').textContent, chips: document.querySelector('.unitpanel .chips').textContent }; [o.weapon, o.armor, u.qimen] = keep; u.stop = 0; w.clickCell(u.x, u.y); return r; });
    assert.ok(bare.gear.includes('武器 —') && bare.gear.includes('防具 —'), bare.gear); assert.match(bare.chips, /受困 2日/);
  } finally { await page.evaluate(() => { const f = window.__game.war.field; for (const u of f.alive) { u.qimen = 0; u.stop = 0; } }); }
});
for (const v of VIEWS) test(`hovering an enemy with one of ours selected shows his card on the right; leaving the cell puts it away (${v})`, async () => {
  const page = await pageOf(v);
  const foe = await page.evaluate(() => {
    const w = window.__game.war, f = w.field, { G } = window.__game; w.cancel(); w.cancel(); w.overview();
    const u = f.side(f.human)[0], e = f.alive.find((x) => x.side !== f.human); w.hoverCell(null);
    w.hoverCell({ x: e.x, y: e.y }); const none = !document.querySelector('.unitpanel.compare');   // nothing selected: no card
    w.clickCell(u.x, u.y); w.hoverCell({ x: u.x, y: u.y }); const own = !document.querySelector('.unitpanel.compare');   // his own cell: none
    w.hoverCell({ x: e.x, y: e.y });
    return { none, own, name: G.name(e.id), ex: e.x, ey: e.y };
  });
  assert.ok(foe.none && foe.own, 'no card without a selection or over our own');
  const c = await card(page);
  assert.ok(c.compare?.includes(foe.name), `his card: ${c.compare}`);
  assert.equal(await page.evaluate(() => document.querySelector('.unitpanel.compare .gear') != null && document.querySelector('.unitpanel.compare').matches('.panel.unitpanel')), true, 'same card, with gear');
  await page.evaluate(() => { const f = window.__game.war.field, w = window.__game.war; const e = f.alive.find((x) => x.side !== f.human); const c = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [e.x + dx, e.y + dy]).find(([x, y]) => f.inside(x, y) && !f.unitAt(x, y)); w.hoverCell({ x: c[0], y: c[1] }); });
  assert.equal((await card(page)).compare, null, 'put away when the pointer leaves him');
  await page.evaluate(() => window.__game.war.hoverCell(null));
});
for (const v of VIEWS) for (const [W, H] of [[1920, 1080], [1440, 900], [1366, 768], [1280, 800], [1024, 640]]) test(`at ${W}×${H} (${v}) the two cards, the log and the dock do not overlap${v === 'flat' ? ", and the flat map's cells stay above the strip" : ''}`, async () => {
  const page = await pageOf(v);
  await page.setViewportSize({ width: W, height: H });
  await page.mouse.move(W * 0.55, H * 0.3); // off the cards: a pointer that leaves the map clears the hover
  try {
    await page.evaluate(async () => {
      const w = window.__game.war, f = w.field; w.cancel(); w.cancel();
      const u = f.side(f.human)[0], e = f.alive.find((x) => x.side !== f.human); w.clickCell(u.x, u.y); w.hoverCell({ x: e.x, y: e.y });
      const l = document.querySelector('.logbox'); if (l && !l.children.length) l.append(Object.assign(document.createElement('p'), { textContent: '—— 第1日 ——' }));
      await new Promise((r) => setTimeout(r, 400));
    });
    const r = await page.evaluate(async () => {
      const { FLAT_INSET } = await import('./src/warmap2d.js');
      const box = (s) => { const e = document.querySelector(s), b = e && e.getClientRects().length ? e.getBoundingClientRect() : null; return b && { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
      return { own: box('.unitpanel:not(.compare)'), foe: box('.unitpanel.compare'), dock: box('.wardock'), log: box('.logbox'), bar: box('.warbar'), sys: box('.sysbtns'), W: innerWidth, H: innerHeight, strip: innerHeight - FLAT_INSET.bottom,
        troops: [...document.querySelectorAll('.unitpanel .unit-troop')].filter((el) => el.getClientRects().length).map((el) => el.textContent) };
    });
    const hit = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
    const on = ['own', 'foe', 'dock', 'log'].filter((k) => r[k]);
    if (v === 'flat') assert.ok(r.log.t >= r.strip - 4, `the log stays in the bottom strip: ${JSON.stringify(r.log)} < ${r.strip}`);
    for (const k of ['own', 'foe', 'dock']) assert.ok(r[k], `${k} is on screen`);
    assert.equal(r.troops.length, 2, '双方武将卡均显示兵种');
    assert.ok(r.log, 'the log shows at every width'); assert.ok(r.log.r - r.log.l >= 300, `the log is readable: ${r.log.r - r.log.l}px wide`);
    assert.ok(r.bar && r.sys && !hit(r.bar, r.sys), `系统 clear of the war title ${JSON.stringify([r.bar, r.sys])}`);
    for (const k of on) assert.ok(r[k].l >= 0 && r[k].t >= 0 && r[k].r <= r.W && r[k].b <= r.H, `${k} inside the window ${JSON.stringify(r[k])}`);
    for (const a of on) for (const b of on) if (a < b) assert.ok(!hit(r[a], r[b]), `${a}/${b} ${JSON.stringify(r)}`);
    // the flat map keeps its cells above the strip, so no card may reach into the band the board is drawn in (3D lays its log out elsewhere and frames the board between the cards)
    if (v === 'flat') for (const k of ['own', 'foe']) assert.ok(r[k].t >= r.strip - 4, `${k} stays in the bottom strip: top ${r[k].t} < ${r.strip} ${JSON.stringify(r[k])}`);
  } finally { await page.setViewportSize({ width: 1280, height: 800 }); await page.evaluate(() => { window.__game.war.hoverCell(null); window.__game.war.cancel(); }); }
});

// PERF-04 (2026-11-07): the flat map's board (the picture scaled to the window, its grid or the composed map's shadow and gilt
// edge) is painted once onto a canvas of its own and copied each frame; selecting, the route preview and the ground view draw
// over it and never paint it again; a new window size paints it once more, at the new size.
test('the flat map paints its board once for each window size, not every frame', async () => {
  const dbg = () => page.evaluate(() => window.__game.war.flatDebug());
  const frames = async (n) => { const f0 = (await dbg()).frames; await page.waitForFunction((f) => window.__game.war.flatDebug().frames >= f, f0 + n, { timeout: 10000 }); };
  try {
    await frames(5);
    const a = await dbg();
    assert.deepEqual(a.base, a.canvas, 'the board canvas is the screen canvas\'s size');
    await page.evaluate(() => { const w = window.__game.war, f = w.field, u = f.side(f.human)[0]; w.cancel(); w.clickCell(u.x, u.y); const e = f.alive.find((x) => x.side !== f.human); w.hoverCell({ x: e.x, y: e.y }); document.body.classList.add('terrain-view'); });
    await frames(30);
    await page.evaluate(() => { document.body.classList.remove('terrain-view'); window.__game.war.hoverCell(null); window.__game.war.cancel(); });
    await frames(30);
    const b = await dbg();
    assert.ok(b.frames >= a.frames + 60, `frames drawn: ${a.frames} → ${b.frames}`);
    assert.equal(b.basePaints, a.basePaints, 'selecting, the route preview and the ground view leave the board as it is');
    await page.setViewportSize({ width: 1023, height: 641 }); await frames(10);
    const c = await dbg();
    assert.equal(c.basePaints, b.basePaints + 1, 'a new window size paints the board again, once');
    assert.deepEqual(c.base, c.canvas, 'at the new size');
    assert.deepEqual(c.canvas, [1023, 641]);
  } finally { await page.setViewportSize({ width: 1280, height: 800 }); }
  await frames(10);
  const d = await dbg();
  assert.deepEqual(d.base, [1280, 800], 'and back');
});

// PERF-03 (2026-11-07): the flat map's war builds only what it draws from (the generals, the range and route cells), not the 3D
// board under it: no ground plates or terrain mesh, dressing, woods, water, sky or village signs.
test('the flat map\'s war does not build the 3D board it never shows', async () => {
  const r = await page.evaluate(() => {
    const w = window.__game.war, base = Object.getPrototypeOf(w), kinds = { meshes: 0, water: 0, landmarks: 0, labels: 0 };
    base.scene.traverse((o) => { if (o.isMesh || o.isInstancedMesh) kinds.meshes++; if (o.userData.water) kinds.water++; if (o.userData.landmark) kinds.landmarks++; if (o.isCSS2DObject && o.element.classList.contains('vtag')) kinds.labels++; });
    return { flat: !!w.flat, units: w.field.units.length, ...kinds, sky: !!base.scene.background };
  });
  assert.ok(r.flat, 'the flat map');
  assert.deepEqual([r.water, r.landmarks, r.labels], [0, 0, 0], `no water, set pieces or village signs: ${JSON.stringify(r)}`);
  assert.ok(r.meshes <= r.units * 12 + 40, `only the generals and the cells: ${JSON.stringify(r)}`);
});

// While deploying, the 布阵完成 box clears the selected card; and once the war is over no card row is left behind.
test('the 布阵完成 box clears the card at each size, and the card row is gone when the war ends', async () => {
  const p = await game.open();
  try {
    await toWar(p, { stopAtDeploy: true });
    for (const [W, H] of [[1440, 900], [1280, 800], [1024, 640]]) {
      await p.setViewportSize({ width: W, height: H }); await p.mouse.move(W * 0.55, H * 0.3);
      await p.evaluate(() => { const w = window.__game.war, u = w.field.side(w.field.human)[0]; w.clickCell(u.x, u.y); });
      await p.waitForTimeout(300);
      const r = await p.evaluate(() => { const q = (s) => { const b = document.querySelector(s)?.getBoundingClientRect(); return b && { l: b.left, r: b.right, t: b.top, b: b.bottom }; }; return { own: q('.unitpanel'), btn: q('.deploybtn'), dock: q('.wardock') }; });
      const hit = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
      assert.ok(r.own && r.btn, `${W}: card and box are up`);
      assert.ok(!hit(r.own, r.btn), `${W}: box over the card ${JSON.stringify(r)}`); if (r.dock) assert.ok(!hit(r.btn, r.dock), `${W}: box over the dock ${JSON.stringify(r)}`);
    }
    await p.setViewportSize({ width: 1280, height: 800 });
    await p.locator('.deploybtn .btn', { hasText: '布阵完成' }).click();
    await p.waitForFunction(() => { const f = window.__game.war.field; return f.turn === f.human && !document.querySelector('.banner, .panel.msg'); }, null, { timeout: 30000 });
    await p.evaluate(() => { const w = window.__game.war, u = w.field.side(w.field.human)[0]; w.clickCell(u.x, u.y); }); // the day opens with no one selected
    assert.equal(await p.locator('.warcards').count(), 1, 'the row exists during the war');
    const stop = closeMessages(p);
    try {
      await p.evaluate(() => { const w = window.__game.war, f = w.field; f.end(f.human === 'att' ? 'def' : 'att', 'test'); w.endTurn(); });
      const back = p.locator('#ui-top button', { hasText: '返回大地图' });
      await back.waitFor({ timeout: 30000 });
      await p.evaluate(() => { const w = window.__game.war, u = w.field.side(w.field.human)[0]; if (u) w.clickCell(u.x, u.y); }); // whatever the result left, a card may be up now
      await back.click();
      await p.waitForFunction(() => document.body.dataset.screen !== 'war', null, { timeout: 60000 });
    } finally { stop(); }
    assert.equal(await p.locator('.warcards').count(), 0, 'no card row once the war is over');
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); }
});

test('no page errors', () => assert.deepEqual(page.errors, []));

// The day tick changes soldiers with nothing played on the map (奇门遁甲 takes 80–150 a day from its target while
// 诸葛亮 is on the field): every unit's tag shows the rules' numbers after it, not the day before's (playtest of
// 2026-10-30: 朱治's tag read 兵1000 under a tip of 兵852, on the 3D war map that 0.1.4 shipped; the flat map draws
// its tags from the rules every frame). Here the tick is made to take 123 from one enemy.
for (const q of ['', '&flat']) test(`on the war map${q}, after a day passes every tag shows the soldiers the rules hold`, async () => {
  const page = await game.open(q); await toWar(page);
  const day = await page.evaluate(async () => {
    (await import('./src/pace.js')).setPace(4);
    const { G, war: w } = window.__game, f = w.field, tick = f.endTurn.bind(f);
    const shown = [...document.querySelectorAll('.tag')].filter((t) => t.isConnected).map((t) => t.querySelector('b')?.textContent.replace('★', ''));
    const e = f.alive.find((u) => u.side !== f.human && (!w.flat ? shown.includes(G.name(u.id)) : true)); // the flat map draws its plaques on its canvas
    f.endTurn = function () { const d = this.day; tick(); if (this.day > d) this.O(e.id).soldiers -= 123; }; // the call that opens a new day
    window.__drained = e; const d = f.day; w.endTurn(); return d;
  });
  const stop = closeMessages(page);
  try {
    await page.waitForFunction((d) => { const w = window.__game.war, f = w.field; return f.over || (f.day > d && f.turn === f.human && !w.st.busy); }, day, { timeout: 120000 });
  } finally { stop(); }
  const r = await page.evaluate(async () => {
    (await import('./src/pace.js')).setPace(1);
    const { G, war: w } = window.__game, f = w.field;
    const drained = G.name(window.__drained.id);
    // every tag on the page, read against the unit it names
    return { drained, tags: [...document.querySelectorAll('.tag')].filter((t) => t.isConnected && /兵\d/.test(t.textContent)).map((t) => {
      const who = t.querySelector('b').textContent.replace('★', ''), u = f.alive.find((x) => G.name(x.id) === who);
      return { who, rules: u ? f.O(u.id).soldiers : null, tag: Number(t.textContent.match(/兵(\d+)/)[1]) };
    }) };
  });
  if (q) assert.equal(r.tags.length, 0, 'no DOM tags on the flat map: its plaques read the rules each frame');
  else { assert.ok(r.tags.some((x) => x.who === r.drained), `${r.drained}'s tag is on screen`);
    for (const x of r.tags) assert.equal(x.tag, x.rules, `${x.who}'s tag`); }
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

for (const q of ['', '&flat']) test(`奇门 day beat${q}: a number rises over the target, the log tells it, the tag counts the days`, async () => {
  const page = await game.open(q); await toWar(page);
  const day = await page.evaluate(async () => {
    (await import('./src/pace.js')).setPace(4);
    const { G, war: w } = window.__game, f = w.field;
    const onScreen = w.flatState().units.filter((v) => v.visible).map((v) => v.u);
    const e = f.alive.find((u) => u.side !== f.human && onScreen.includes(u));
    f.O(e.id).soldiers = 999; // enough that three days of the array cannot finish him
    e.qimen = 3; f.kongmingOn = () => true; window.__trapped = e;
    // A number is told when it first appears: a .lossnum on the 3D map, a 'num' effect on the flat one.
    window.__nums = [];
    const seen = new Set();
    const note = () => {
      for (const n of document.querySelectorAll('.lossnum')) if (!seen.has(n)) { seen.add(n); window.__nums.push(n.textContent); }
      if (document.body.classList.contains('flat2d')) for (const x of w.flatState().fx) if (x.kind === 'num' && !seen.has(x)) { seen.add(x); window.__nums.push(x.text); }
    };
    window.__poll = setInterval(note, 10);
    const d = f.day; w.endTurn(); return d;
  });
  const stop = closeMessages(page);
  try { await page.waitForFunction((d) => { const w = window.__game.war, f = w.field; return f.over || (f.day > d && f.turn === f.human && !w.st.busy); }, day, { timeout: 60000 }); } finally { stop(); }
  const r = await page.evaluate(() => {
    clearInterval(window.__poll);
    const { G, war: w } = window.__game, e = window.__trapped, f = w.field;
    const tags = () => {
      if (document.body.classList.contains('flat2d')) return null;
      return [...document.querySelectorAll('.tag')].filter((t) => t.isConnected && t.querySelector('b')?.textContent.replace('★', '') === G.name(e.id)).map((t) => t.textContent);
    };
    return { nums: window.__nums, log: document.querySelector('.logbox')?.textContent ?? '', name: G.name(e.id), qimen: e.qimen, tags: tags(), gone: e.gone || f.over, chip: w.flatState().units.find((v) => v.u === e)?.qimen };
  });
  {
    assert.ok(!r.gone, 'the trapped one is still on the field');
    assert.deepEqual(r.chip, { chip: '奇门 2日', spin: true }, 'the state the flat map draws his chip and ring from');
    assert.equal(r.nums.length, 1, `one number: ${r.nums}`);
    assert.match(r.nums[0], /^−\d+$/);
    assert.ok(r.log.includes(`${r.name}困于石阵，折兵${r.nums[0].slice(1)}`), `the log tells it: ${r.log.slice(-200)}`);
    assert.equal(r.qimen, 2);
    if (r.tags) assert.ok(r.tags.some((t) => t.includes('奇门 2日')), `tag: ${r.tags}`);
    // 诸葛亮 gone: another day takes nothing, the tag says why, and so does the panel.
    const d2 = await page.evaluate(() => {
      const { war: w } = window.__game, f = w.field; f.kongmingOn = () => false;
      const old = new Set(document.querySelectorAll('.lossnum')); window.__nums.length = 0; window.__poll = setInterval(() => {
        for (const n of document.querySelectorAll('.lossnum')) if (!old.has(n)) window.__nums.push(n.textContent);
        if (document.body.classList.contains('flat2d')) for (const x of w.flatState().fx) if (x.kind === 'num' && x.t > window.__t0) window.__nums.push(x.text);
      }, 10);
      window.__t0 = performance.now() / 1000; const d = f.day; w.endTurn(); return d;
    });
    const stop2 = closeMessages(page);
    try { await page.waitForFunction((d) => { const w = window.__game.war, f = w.field; return f.over || (f.day > d && f.turn === f.human && !w.st.busy); }, d2, { timeout: 60000 }); } finally { stop2(); }
    const r2 = await page.evaluate(() => {
      clearInterval(window.__poll);
      const { G, war: w } = window.__game, e = window.__trapped, f = w.field;
      w.clickCell(e.x, e.y);
      return { nums: window.__nums, qimen: e.qimen, gone: e.gone || f.over, chip: w.flatState().units.find((v) => v.u === e)?.qimen,
        tag: [...document.querySelectorAll('.tag')].filter((t) => t.isConnected && t.querySelector('b')?.textContent.replace('★', '') === G.name(e.id)).map((t) => t.textContent),
        panel: document.querySelector(`.unitpanel[data-unit="${e.id}"]`)?.textContent ?? '' }; // his own card (the right one while one of ours is selected)
    });
    {
      assert.ok(!r2.gone);
      assert.deepEqual(r2.chip, { chip: '困·孔明不在', spin: false });
      assert.deepEqual(r2.nums, [], 'no number once 诸葛亮 is gone');
      assert.equal(r2.qimen, 2, 'the days are not counted down either');
      if (r.tags) assert.ok(r2.tag.some((t) => t.includes('困·孔明不在')), `tag: ${r2.tag}`);
      assert.match(r2.panel, /诸葛亮不在场，不再折兵/);
    }
  }
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

// war-3d Task 5: the war map is 3D by default; the flat painted map is ?flat and the 低 preset's.
test('the war map opens in 3D by default; ?flat and the 低 preset give the flat map', async () => {
  assert.ok(!await (await threeD()).evaluate(() => window.__game.war.flat), 'default: 3D');
  assert.ok(await page.evaluate(() => window.__game.war.flat), '?flat');
  const low = await game.open('');
  try {
    await low.evaluate(() => localStorage.setItem('hd2d-quality', 'low')); await low.reload();
    await low.waitForFunction(() => window.__game?.debug, null, { timeout: 60000 });
    await toWar(low);
    assert.ok(await low.evaluate(() => window.__game.war.flat), '低: flat');
    assert.deepEqual(low.errors, []);
  } finally { await low.context().close(); }
});

// 系统 → 战场 (晚风和远方丶@bilibili, 2026-11-13): 平面 at 高 gives the flat war map under a 3D 战略地图, 3D at 低 the 3D one under the flat map;
// the flat war's notice then names the 战场 row, and its button holds the next war 3D.
test('the 战场 setting holds the war map flat at 高 and 3D at 低', async () => {
  const at = async (quality, view) => {
    const p = await game.open('', { setup: (ctx) => ctx.addInitScript(([q, v]) => { localStorage.setItem('hd2d-quality', q); localStorage.setItem('hd2d-war-view', v); }, [quality, view]) });
    await toWar(p);
    return p;
  };
  const hi = await at('high', 'flat');
  try {
    assert.ok(await hi.evaluate(() => window.__game.war.flat), '高 + 平面: flat war');
    assert.equal(await hi.evaluate(() => window.__game.strategy.kind), '3d', 'under a 3D 战略地图');
    await hi.locator('.warbar .viewmode').click();
    const why = await hi.locator('.modal').textContent();
    assert.match(why, /「☰ 系统 → 战场」设为「平面」/);
    await hi.locator('.modal button', { hasText: '战场改为3D' }).click();
    assert.equal(await hi.evaluate(() => localStorage.getItem('hd2d-war-view')), '3d');
    await hi.locator('.sysmenu-btn').click();
    assert.equal(await hi.locator('.sysmenu-list button', { hasText: /^战场 / }).textContent(), '战场 3D　本场平面');
    assert.ok(await hi.evaluate(() => window.__game.war.flat), 'this battle stays flat');
    assert.deepEqual(hi.errors, []);
  } finally { await hi.context().close(); }
  const lo = await at('low', '3d');
  try {
    assert.ok(!await lo.evaluate(() => window.__game.war.flat), '低 + 3D: 3D war');
    assert.equal(await lo.locator('.warbar .viewmode').count(), 0);
    assert.deepEqual(lo.errors, []);
  } finally { await lo.context().close(); }
});

test('generals stand 1.3 cells and no wider than a cell, on a ring in their side colour', async () => {
  const r = await (await threeD()).evaluate(() => { const p = window.__game.war.probe(), f = window.__game.war.field; return { ...p, human: f.human, sides: Object.fromEntries(f.units.map((u) => [u.id, u.side === f.human])) }; });
  assert.equal(r.figure, 1.3);
  assert.ok(r.units.length >= 4);
  for (const u of r.units) { assert.ok(u.h <= 1.3 + 1e-3 && u.h > 0.8, `${u.id} stands ${u.h}`); assert.ok(u.w <= 1 + 1e-3 && u.w > 0.2, `${u.id} is ${u.w} wide`); }
  assert.deepEqual([...new Set(r.bases.map((b) => b.color))].sort(), ['#2f5cc4', '#b8322c']);
  for (const b of r.bases) assert.equal(b.color, r.sides[b.id] ? '#2f5cc4' : '#b8322c', `${b.id}'s ring is his side's`);
});

test('the castle and village houses keep 0.45 of their picture where they cover a general; trees and plain houses are still cut whole', async () => {
  const { l, castle, villages, kept } = await (await threeD()).evaluate(() => {
    const w = window.__game.war, { landmarks: l, kept } = w.probe();
    // 新城防把中央建筑合并到整个城防组，原版仍有单独的城池地标。
    const fort = w.field.siege?.style ? w.scene.getObjectByName('siege-fortification') : null;
    const castle = fort ? l.some((x) => x.kind === fort.userData.landmark) : l.some((x) => x.kind === 'castle');
    return { l, castle, villages: w.field.villages.length, kept };
  });
  assert.ok(castle, 'the castle is a landmark');
  assert.ok(villages > 0, 'this field has villages');
  assert.equal(l.filter((x) => x.kind === 'village').length, villages, 'every village is tagged');
  for (const x of l) assert.equal(x.keep, 0.45);
  assert.deepEqual(kept.landmark, [0.45], 'every mesh of a landmark keeps 0.45');
  assert.deepEqual(kept.other, [0], 'a tree, a rock or a cottage keeps nothing there');
  assert.deepEqual(kept.blended, [true], 'the kept share is a blend, not a screen-door dither of the pictures');
});

// war-3d Task 10: a field shop is its own building, with one tall piece that tells it apart at the far step.
test('each field shop kind builds its own building', async () => {
  const p = await game.open();
  try {
    await newCampaign(p);
    await p.evaluate(() => { // a city with all three shops (city 2): the player marches on it
      const { g, debug } = window.__game, cs = g.cities, k = 2, to = cs[k];
      const from = cs.findIndex((c, i) => i !== k && c.officers.length > 2 && c.faction !== to.faction && c.faction !== 0);
      if (!to.officers.length) { const donor = cs.find((c, i) => i !== k && i !== from && c.officers.length > 1 && c.faction !== cs[from].faction && c.faction !== 0); to.faction = donor.faction; to.officers = donor.officers.splice(0, 2); }
      const ids = cs[from].officers.slice(0, 3);
      debug.fieldWar(debug.setupWar(g, { from, to: k, ids, commander: ids[0], gold: 0, rice: Math.min(cs[from].rice, 600) }), 'att');
    });
    await p.waitForFunction(() => document.body.dataset.screen === 'war' && window.__game.war, null, { timeout: 30000 });
    const r = await p.evaluate(() => { const w = window.__game.war; return { flat: !!w.flat, kinds: w.field.villages.map((v) => v.kind).sort(), lm: w.probe().landmarks.filter((x) => x.kind === 'village') }; });
    assert.ok(!r.flat, '3D');
    assert.deepEqual(r.kinds, ['病院', '武器店', '米店'].sort(), 'this city has all three shops');
    assert.deepEqual(r.lm.map((x) => x.shop).sort(), ['病院', '武器店', '米店'].sort(), 'each village group knows its shop');
    const own = { 武器店: 'chimney', 米店: 'granary', 病院: 'herbRack' };
    for (const x of r.lm) {
      assert.ok(x.parts.includes(own[x.shop]), `${x.shop} has its signature piece ${own[x.shop]}: ${x.parts}`);
      for (const [k, v] of Object.entries(own)) if (k !== x.shop) assert.ok(!x.parts.includes(v), `${x.shop} has no ${v}`);
    }
    assert.ok(r.lm.find((x) => x.shop === '武器店').parts.includes('smoke'), 'the smithy smokes');
    // The smoke moves with the frame update, and a village with no kind is still the farmhouse pair.
    const sm = async () => p.evaluate(() => { const o = []; window.__game.war.scene.traverse((n) => n.name === 'smoke' && o.push([n.position.y, n.material.opacity, n.scale.x])); return o; });
    const s1 = await sm(); await p.waitForTimeout(700); const s2 = await sm();
    assert.ok(s1.length >= 4 && s1.some((a, i) => Math.abs(a[0] - s2[i][0]) > 1e-3 || Math.abs(a[1] - s2[i][1]) > 1e-3), 'smoke sprites move between frames');
    const plain = await p.evaluate(async () => {
      const S = await import('./src/structures.js'), sc = new (window.__game.war.scene.constructor)();
      const a = S.buildVillage(sc, { x: 0, z: 0, h: 0 }, 5), g = sc.children[0], names = []; g.traverse((n) => n.name && names.push(n.name));
      return { shop: g.userData.shop ?? null, lm: g.userData.landmark, names, tick: !!a.tick, y: a.y, meshes: g.children.length };
    });
    assert.equal(plain.shop, null); assert.equal(plain.lm, 'village'); assert.deepEqual(plain.names, []); assert.ok(!plain.tick); assert.ok(plain.meshes >= 6, 'the farmhouse pair is built');
    // every building keeps its eaves inside its cell, on either side of the courtyard wall
    const fit = await p.evaluate(async () => {
      const S = await import('./src/structures.js'), T = window.__game.war.scene.constructor, out = [];
      for (const kind of ['武器店', '米店', '病院']) for (const side of [-1, 1]) for (let seed = 1; seed < 6; seed++) {
        const sc = new T(); S.buildVillage(sc, { x: 0, z: 0, h: 0 }, seed, kind); const g = sc.children[0]; g.rotation.y = 0; g.updateMatrixWorld(true);
        const w = g.getObjectByName('courtyardWall'); w.scale.x = side; g.updateMatrixWorld(true);
        const box = { min: [9, 9], max: [-9, -9] };
        g.traverse((n) => { if (!n.isMesh) return; n.geometry.computeBoundingBox(); const b = n.geometry.boundingBox.clone().applyMatrix4(n.matrixWorld); box.min = [Math.min(box.min[0], b.min.x), Math.min(box.min[1], b.min.z)]; box.max = [Math.max(box.max[0], b.max.x), Math.max(box.max[1], b.max.z)]; });
        out.push({ kind, side, seed, ...box });
      }
      return out;
    });
    for (const f of fit) assert.ok(Math.max(...f.max.map(Math.abs), ...f.min.map(Math.abs)) <= 0.48 + 1e-6, `${f.kind} wall ${f.side} stays in its cell: ${JSON.stringify(f)}`);
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); }
});

// An untouched overview refits when a card opens or closes; once the player has panned it stays where it is, and so
// does the camera on a selected general.
test('the overview refits when a card opens and closes; a view the player panned does not move', async () => {
  const p = await game.open(''); await toWar(p);
  try {
    const st = () => p.evaluate(async () => { await new Promise((r) => setTimeout(r, 1300)); const v = window.__game.war.probe().view; return { ...v, dist: +v.dist.toFixed(2), target: v.target.map((x) => +x.toFixed(2)) }; });
    await p.setViewportSize({ width: 1024, height: 640 });
    await p.evaluate(() => { const w = window.__game.war; w.cancel(); w.cancel(); w.overview(); });
    const a = await st(); assert.ok(a.atFit && !a.moved, 'an untouched overview');
    await p.evaluate(() => { const w = window.__game.war, f = w.field, u = f.side(f.human)[0], e = f.alive.find((x) => x.side !== f.human); w.clickCell(u.x, u.y); w.hoverCell({ x: e.x, y: e.y }); });
    const b = await st(); assert.notDeepEqual([b.dist, b.target], [a.dist, a.target], 'a card opened: 全景 refitted round it');
    // pan first, then open the cards: nothing moves
    await p.evaluate(() => { const w = window.__game.war; w.cancel(); w.cancel(); w.overview(); });
    await st();
    await p.evaluate(() => window.__game.war.pan(3, 2));
    const c = await st(); assert.ok(c.moved && !c.atFit);
    await p.evaluate(() => { const w = window.__game.war, f = w.field, u = f.side(f.human)[0], e = f.alive.find((x) => x.side !== f.human); w.hoverCell({ x: e.x, y: e.y }); w.clickCell(u.x, u.y); });
    await p.evaluate(() => { const w = window.__game.war; w.pan(3, 2); }); // a pan after the click: the view is the player's
    const d = await st(); assert.ok(d.moved);
    const before = d.target;
    await p.evaluate(() => window.__game.war.hoverCell(null));
    await p.setViewportSize({ width: 1440, height: 900 });
    const e = await st(); assert.deepEqual(e.target, before, 'a resize and a card change leave the panned view alone');
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); }
});

test('switching to 低 mid-battle keeps this battle in 3D and raises no error', async () => {
  const p = await game.open(''); await toWar(p);
  await p.locator('.sysmenu-btn').click();
  await p.locator('.sysmenu-list button', { hasText: /^画质 / }).click(); await p.locator('.sysmenu-list button', { hasText: /^画质 / }).click(); // 高 → 中 → 低
  assert.equal(await p.evaluate(() => localStorage.getItem('hd2d-quality')), 'low');
  await p.waitForTimeout(1500);
  assert.ok(!await p.evaluate(() => window.__game.war.flat), 'this battle stays 3D');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

// war-3d Task 6: the camera. Four corner views on Q / E, three wheel steps, Tab for the straight-down overview.
const TAU = Math.PI * 2, angDiff = (a, b) => { const d = (((a - b) % TAU) + TAU * 1.5) % TAU - Math.PI; return Math.abs(d); }; // distance between two angles, mod 2π
const viewOf = (p) => p.evaluate(() => ({ ...window.__game.war.viewState(), ...window.__game.war.probe().view }));

test('Q and E turn the board a quarter at a time and four turns come back; the first view puts the attackers at the bottom left', async () => {
  const p = await threeD();
  const a = await viewOf(p);
  assert.ok(a.yaws.some((y) => angDiff(y, a.yaw) < 1e-6), `opens on one of the four corners (${a.yaw})`);
  assert.ok(Math.abs(a.pitch - 0.663) < 1e-3, `at 38° (${a.pitch})`);
  // Of the four corners, the opening one has the attacking army lowest and leftmost on screen.
  const score = async () => p.evaluate(() => { const w = window.__game.war, f = w.field, us = f.alive.filter((u) => u.side === 'att'); w.camera.updateMatrixWorld(); let sx = 0, sy = 0; for (const u of us) { const n = w.spriteOf(u).position.clone().project(w.camera); sx += n.x; sy += n.y; } return (sx + sy) / us.length; });
  const first = await score(), others = [];
  await p.keyboard.press('q'); await p.waitForTimeout(450);
  const b = await viewOf(p);
  assert.ok(angDiff(b.yaw, a.yaw - Math.PI / 2) < 1e-3, `Q turned a quarter (${a.yaw} → ${b.yaw})`);
  assert.ok(b.yaws.some((y) => angDiff(y, b.yaw) < 1e-6), 'still one of the four');
  // The painted woods turn with the board (each crown faces the eye), or a corner view shows bare ground where the trees are.
  assert.ok(await p.evaluate((yaw) => { let o = null; window.__game.war.scene.traverse((n) => { if (n.userData.woods) o = n; }); return !o || Math.abs(o.userData.aim.yaw.value - yaw) < 1e-3; }, b.yaw), 'the woods face the eye');
  others.push(await score());
  await p.keyboard.press('q'); await p.waitForTimeout(450); others.push(await score());
  await p.keyboard.press('q'); await p.waitForTimeout(450); others.push(await score());
  await p.keyboard.press('q'); await p.waitForTimeout(450);
  const c = await viewOf(p);
  assert.ok(angDiff(c.yaw, a.yaw) < 1e-3, `four turns come back (${c.yaw})`);
  assert.ok(others.every((s) => first <= s + 0.05), `attackers lowest-left at the start: ${first.toFixed(2)} vs ${others.map((s) => s.toFixed(2))}`);
  await p.keyboard.press('e'); await p.waitForTimeout(450);
  assert.ok(angDiff((await viewOf(p)).yaw, a.yaw + Math.PI / 2) < 1e-3, 'E turns the other way');
  // Pressing again mid-turn adds to where the turn is heading.
  await p.keyboard.press('e'); await p.keyboard.press('e'); await p.keyboard.press('e'); await p.waitForTimeout(500);
  assert.ok(angDiff((await viewOf(p)).yaw, a.yaw) < 1e-3, 'three quick E presses make three quarters');
  assert.deepEqual(p.errors, []);
  // The flat map has no turn: the same keys do nothing and raise nothing.
  await page.keyboard.press('q'); await page.keyboard.press('e'); await page.keyboard.press('Tab'); await page.mouse.wheel(0, 300); await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__game.war.viewState), undefined);
  assert.equal(await page.evaluate(() => document.body.dataset.screen), 'war');
});

// The 3D board turns with the right button held, as in 0.1.x (the A2 flat map had made every drag a slide); the left drag still slides.
// Let go and it eases on to the nearest corner. The dock's ⟲ ⟳ turn a quarter like Q / E; the flat map shows neither.
test('a right drag turns the board and lands on the nearest corner; the left drag slides; the dock buttons turn a quarter', async () => {
  const p = await threeD();
  const a = await viewOf(p), cx = 640, cy = 380;
  await p.mouse.move(cx, cy); await p.mouse.down({ button: 'right' });
  for (let i = 1; i <= 10; i++) await p.mouse.move(cx - i * 12, cy);
  await p.waitForTimeout(100);
  const mid = await viewOf(p), fit = await p.evaluate(() => window.__game.war.probe().fitDist());
  await p.mouse.up({ button: 'right' });
  assert.ok(angDiff(mid.yaw, a.yaw + 120 * 0.006) < 1e-3, `turns with the mouse (${a.yaw} → ${mid.yaw})`);
  assert.ok(Math.abs(mid.dist - fit) < 0.05, `the step stays framed mid-turn (${mid.dist} vs ${fit})`);
  await p.waitForTimeout(500);
  let v = await viewOf(p);
  assert.ok(angDiff(v.yaw, a.yaw) < 1e-3, `a small turn eases back to its corner (${v.yaw})`);
  await p.mouse.move(cx, cy); await p.mouse.down({ button: 'right' });
  for (let i = 1; i <= 25; i++) await p.mouse.move(cx - i * 12, cy);
  await p.mouse.up({ button: 'right' }); await p.waitForTimeout(500);
  v = await viewOf(p);
  assert.ok(angDiff(v.yaw, a.yaw + Math.PI / 2) < 1e-3, `past halfway it goes on to the next corner (${v.yaw})`);
  assert.ok(v.yaws.some((y) => angDiff(y, v.yaw) < 1e-6), 'one of the four');
  assert.ok(!await p.evaluate(() => !!document.querySelector('.actpanel.strike')), 'a turn is not a right click');
  // The left drag slides the board and does not turn it.
  await p.mouse.move(cx, cy); await p.mouse.down();
  for (let i = 1; i <= 10; i++) await p.mouse.move(cx - i * 12, cy);
  await p.mouse.up(); await p.waitForTimeout(300);
  const s = await viewOf(p);
  assert.ok(angDiff(s.yaw, v.yaw) < 1e-6, 'the left drag keeps the angle');
  assert.ok(Math.hypot(s.target[0] - v.target[0], s.target[2] - v.target[2]) > 0.3, 'and slides the view');
  // ⟲ / ⟳ on the dock.
  await p.locator('.wardock .turnbtn').first().click(); await p.waitForTimeout(450);
  assert.ok(angDiff((await viewOf(p)).yaw, a.yaw) < 1e-3, '⟲ turns a quarter back');
  await p.locator('.wardock .turnbtn').nth(1).click(); await p.waitForTimeout(450);
  assert.ok(angDiff((await viewOf(p)).yaw, a.yaw + Math.PI / 2) < 1e-3, '⟳ turns a quarter on');
  await p.keyboard.press('q'); await p.waitForTimeout(450);
  await p.evaluate(() => window.__game.war.resetView()); await p.waitForTimeout(600);
  assert.deepEqual(p.errors, []);
  assert.equal(await page.locator('.wardock .turnbtn:visible').count(), 0, 'no turn buttons on the flat map');
});

test('the wheel steps 全景 → far → mid → near and stops at either end', async () => {
  const p = await threeD();
  const wheel = async (dy) => { await p.mouse.move(700, 350); await p.mouse.wheel(0, dy); await p.waitForTimeout(900); return viewOf(p); };
  for (let i = 0; i < 5; i++) await wheel(100); // at least back to 全景
  let v = await viewOf(p); assert.equal(v.zoom, 'whole'); const whole = v.dist; assert.ok(v.atFit, '全景 is the overview fit again');
  v = await wheel(-100); assert.equal(v.zoom, 'far'); const far = v.dist; assert.ok(!v.atFit, 'far is no longer the overview');
  v = await wheel(-100); assert.equal(v.zoom, 'mid'); const mid = v.dist;
  v = await wheel(-100); assert.equal(v.zoom, 'near'); const near = v.dist;
  assert.ok(whole > far + 5 && far > mid + 1 && mid > near + 1, `closer each step: ${whole.toFixed(1)} > ${far.toFixed(1)} > ${mid.toFixed(1)} > ${near.toFixed(1)}`);
  v = await wheel(-100); assert.equal(v.zoom, 'near', 'stops at near'); assert.ok(Math.abs(v.dist - near) < 0.05);
  v = await wheel(100); assert.equal(v.zoom, 'mid'); assert.ok(Math.abs(v.dist - mid) < 0.05);
  v = await wheel(100); assert.equal(v.zoom, 'far');
  v = await wheel(100); assert.equal(v.zoom, 'whole'); assert.ok(v.atFit);
  v = await wheel(100); assert.equal(v.zoom, 'whole', 'stops at 全景'); assert.ok(Math.abs(v.dist - whole) < 0.05);
  // Small notches add up: the step comes with the hundredth.
  await p.mouse.wheel(0, -40); await p.mouse.wheel(0, -40); await p.waitForTimeout(100); assert.equal((await viewOf(p)).zoom, 'whole');
  await p.mouse.wheel(0, -40); await p.waitForTimeout(900); assert.equal((await viewOf(p)).zoom, 'far');
  await wheel(100);
  // The box fits at every angle: the same step keeps its distance within a fraction as the board turns.
  assert.deepEqual(p.errors, []);
});

test('Tab looks straight down and Tab again restores the angle and zoom', async () => {
  const p = await threeD();
  await p.mouse.move(700, 350); await p.mouse.wheel(0, -100); await p.waitForTimeout(900); await p.mouse.wheel(0, -100); await p.waitForTimeout(900); // 全景 → far → mid
  await p.keyboard.press('e'); await p.waitForTimeout(450);
  const before = await viewOf(p), units = await p.evaluate(() => window.__game.war.probe().units.length);
  assert.equal(before.zoom, 'mid');
  await p.keyboard.press('Tab'); await p.waitForTimeout(1500);
  const top = await viewOf(p);
  assert.ok(top.tactical && top.pitch >= 1.5, `looking straight down (${top.pitch})`);
  assert.equal(top.zoom, 'whole');
  const r = await p.evaluate(() => { const w = window.__game.war; return { dof: w.dof(), probe: w.probe() }; });
  assert.equal(r.dof.dof, 0); assert.equal(r.probe.roundels, units, 'every general is a roundel'); assert.equal(r.probe.tags, 0, 'the name tags are away');
  assert.ok(angDiff(top.yaw, 0) < 1e-3 || angDiff(top.yaw, Math.PI) < 1e-3, `square to the screen (${top.yaw})`);
  await p.keyboard.press('q'); await p.mouse.wheel(0, -100); await p.waitForTimeout(500);
  const still = await viewOf(p); assert.ok(angDiff(still.yaw, top.yaw) < 1e-6 && still.zoom === 'whole', 'no turn or zoom step while looking down');
  await p.keyboard.press('Tab'); await p.waitForTimeout(1800);
  const back = await viewOf(p);
  assert.ok(!back.tactical); assert.ok(angDiff(back.yaw, before.yaw) < 1e-3, 'yaw'); assert.ok(Math.abs(back.pitch - before.pitch) < 1e-3, 'pitch'); assert.equal(back.zoom, before.zoom);
  assert.ok(Math.abs(back.dist - before.dist) < 0.05, `distance ${before.dist} → ${back.dist}`); assert.deepEqual(back.target, before.target);
  assert.equal((await p.evaluate(() => window.__game.war.probe())).roundels, 0); assert.equal((await p.evaluate(() => window.__game.war.probe())).tags, units);
  const steps = await p.evaluate(() => window.__game.war.dof());
  assert.equal(steps.dof, 1.4, 'the mid step keeps its own tilt-shift (Task 9)');
  await p.keyboard.press('q'); await p.waitForTimeout(450); await p.keyboard.press('e'); await p.mouse.wheel(0, 100); await p.waitForTimeout(900);
  assert.deepEqual(p.errors, []);
});

test('turning or Tab during an AI march leaves the march whole and no page error', async () => {
  const p = await game.open(''); await toWar(p);
  try {
    await p.evaluate(async () => { (await import('./src/pace.js')).setPace(2); const w = window.__game.war; w.cancel(); w.endTurn(); });
    for (let i = 0; i < 40; i++) {
      if (await p.evaluate(() => { const f = window.__game.war.field; return f.turn === f.human || f.over; })) break;
      await p.keyboard.press(['q', 'Tab', 'e', 'Tab'][i % 4]); await p.waitForTimeout(250);
    }
    await p.waitForFunction(() => { const f = window.__game.war.field; return f.turn === f.human || f.over; }, null, { timeout: 120000 });
    if ((await viewOf(p)).tactical) await p.keyboard.press('Tab');
    await p.waitForTimeout(1500);
    const off = await p.evaluate(async () => {
      const { W, H } = await import('./src/core/field.js'), w = window.__game.war;
      return w.field.alive.map((u) => { const g = w.spriteOf(u); return Math.abs(g.position.x - (u.x - W / 2 + 0.5)) + Math.abs(g.position.z - (u.y - H / 2 + 0.5)); });
    });
    assert.ok(off.length && off.every((d) => d < 1e-3), `every figure stands on his cell: ${off}`);
    const y = await viewOf(p); assert.ok(y.yaws.some((a) => angDiff(a, y.yaw) < 1e-3), `the turn ends on one of the four corners (${y.yaw})`);
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); }
});

test('Tab does nothing while the 计略 list or a dialog is open', async () => {
  const p = await threeD();
  assert.ok(!(await viewOf(p)).tactical);
  await p.evaluate(() => { const w = window.__game.war, f = w.field, u = f.side(f.human)[0]; f.pool[f.human] = 30; w.clickCell(u.x, u.y); });
  const act = p.locator(CARD_ACTS, { hasText: '计略' }); // in his card
  await act.click({ timeout: 5000 }); await p.waitForSelector('.actpanel.strats');
  await p.keyboard.press('Tab'); await p.waitForTimeout(300);
  assert.ok(!(await viewOf(p)).tactical, 'not under the 计略 list');
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  // The 系统 menu keeps Tab for its own buttons.
  await p.locator('.sysmenu-btn').click();
  await p.keyboard.press('Tab'); await p.waitForTimeout(300);
  assert.ok(!(await viewOf(p)).tactical, 'not over the 系统 menu');
  await p.keyboard.press('Escape'); await p.mouse.click(700, 120); await p.waitForTimeout(200);
  await p.evaluate(() => document.activeElement?.blur());
  await p.locator('.sysmenu-btn').click(); await p.locator('.sysmenu-list button', { hasText: '说明' }).click();
  await p.waitForSelector('.help');
  await p.keyboard.press('Tab'); await p.waitForTimeout(300);
  assert.ok(!(await viewOf(p)).tactical, 'not under a dialog');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await p.keyboard.press('Tab'); await p.waitForTimeout(300);
  assert.ok((await viewOf(p)).tactical, 'with the dialog gone it works again');
  await p.keyboard.press('Tab'); await p.waitForTimeout(1500);
  assert.deepEqual(p.errors, []);
});

test('全景 shows every general clear of the HUD and far fills the screen with board at all four angles; a hard pan stops with the screen over the board and brings each corner clear of the HUD', async () => {
  const p = await threeD();
  // ~150 camera moves, each run on to rest by the view's own update (tests/game.mjs warRest jump): the test looks at where the
  // camera lands, not at the ease. The first waits real frames, so the HUD bands are read again (frameWar) once the cards go.
  const rest = (p) => warRest(p, { jump: true });
  await p.evaluate(() => { const w = window.__game.war; w.cancel(); w.cancel(); w.hoverCell(null); w.overview(); });
  await p.waitForTimeout(500); await rest(p);
  const lost = [];
  for (let i = 0; i < 4; i++) {
    let v = await viewOf(p);
    assert.equal(v.zoom, 'whole'); assert.ok(v.atFit, 'the overview');
    // Every general's feet and name tag on the screen, none under the title bar, the cards or the dock (feedback R04, 2026-11-02).
    lost.push(...await p.evaluate((i) => {
      const w = window.__game.war, hud = [...document.querySelectorAll('.warbar, .unitpanel:not(.compare), .wardock, .turnpair, .logbox, .sysbtns')] // the foe's compare card floats, as frameWar counts it.map((e) => e.getBoundingClientRect()).filter((b) => b.width);
      return w.field.alive.flatMap((u) => { const c = w.screenOf(u.x, u.y), pts = [[c.x, c.y], [c.x, c.y - c.rise * 1.5 - 40]];
        return pts.some(([x, y]) => x < 0 || x > innerWidth || y < 0 || y > innerHeight || hud.some((b) => x > b.left && x < b.right && y > b.top && y < b.bottom)) ? [`angle ${i} ${u.id} at ${Math.round(c.x)},${Math.round(c.y)}`] : []; });
    }, i));
    await p.mouse.move(640, 400); await p.mouse.wheel(0, -100); await rest(p);
    v = await viewOf(p); assert.equal(v.zoom, 'far');
    // 7.5, not 6, since the left column is the action panel's (D32): 远 is never closer than 1.25× 中, and 中 fits its 9×6 cells right of the column.
    assert.ok(v.over != null && v.over <= 7.5, `angle ${i}: the screen reaches ${v.over?.toFixed(2)} cells past the board edge ${JSON.stringify(v)}`);
    await p.evaluate(() => window.__game.war.overview()); await p.keyboard.press('q'); await rest(p);
  }
  assert.deepEqual(lost, [], '全景 keeps every general in view');
  await p.evaluate(() => window.__game.war.pan(80, -80)); await rest(p);
  const hard = await viewOf(p);
  assert.ok(Math.abs(hard.target[0]) <= 16 && Math.abs(hard.target[2]) <= 9.5, `a hard pan keeps the middle of the screen over the board ${hard.target}`);
  // Every corner cell can be slid into the clear part of the screen at every angle and zoom step (feedback R04, 2026-11-02).
  const far = [];
  for (let a = 0; a < 4; a++) {
    for (const steps of [1, 2, 3]) for (const [cx, cy, sx, sz] of [[0, 0, -1, -1], [31, 0, 1, -1], [0, 18, -1, 1], [31, 18, 1, 1]]) {
      await p.evaluate(() => window.__game.war.overview()); await rest(p);
      for (let i = 0; i < steps; i++) { await p.mouse.move(640, 400); await p.mouse.wheel(0, -200); await rest(p); }
      await p.evaluate(([sx, sz]) => { const w = window.__game.war, y = w.viewState().yaw, c = Math.cos(y), s = Math.sin(y); w.pan((sx * c - sz * s) * 80, (sx * s + sz * c) * 80); }, [sx, sz]);
      await rest(p);
      const r = await p.evaluate(([cx, cy]) => {
        const c = window.__game.war.screenOf(cx, cy);
        const covered = [...document.querySelectorAll('.warbar, .unitpanel, .wardock, .turnpair, .logbox, .sysbtns')].some((e) => { const b = e.getBoundingClientRect(); return b.width && c.x > b.left && c.x < b.right && c.y > b.top && c.y < b.bottom; });
        return { x: Math.round(c.x), y: Math.round(c.y), ok: c.x > 0 && c.x < innerWidth && c.y > 0 && c.y < innerHeight && !covered, zoom: window.__game.war.viewState().zoom };
      }, [cx, cy]);
      if (!r.ok) far.push(`angle ${a} ${r.zoom} corner ${cx},${cy} at ${r.x},${r.y}`);
    }
    await p.keyboard.press('q'); await rest(p);
  }
  assert.deepEqual(far, [], 'corners out of reach');
  await p.evaluate(() => { const w = window.__game.war; w.overview(); });
  await rest(p);
  assert.deepEqual(p.errors, []);
});

test('a turn or Tab during a close-up is refused and the close-up restores the distance it had', async () => {
  const p = await threeD();
  await p.evaluate(() => { const w = window.__game.war; w.cancel(); w.cancel(); w.overview(); });
  await p.waitForTimeout(1300);
  const before = await viewOf(p);
  const during = await p.evaluate(async () => {
    const w = window.__game.war, f = w.field, a = f.side(f.human)[0], d = f.alive.find((u) => u.side !== f.human);
    const done = w.focusPair(a, d); w.rotate(1); w.tactical(true);
    const mid = w.viewState(); const restore = await done; w.rotate(1); w.tactical(true); w.tactical(false); restore();
    return { mid, goal: w.probe().view.yawGoal };
  });
  assert.ok(!during.mid.tactical, 'no Tab in a close-up');
  assert.ok(Math.abs(during.goal - before.yawGoal) < 1e-9, 'no turn in a close-up');
  await p.waitForTimeout(1500);
  const after = await viewOf(p);
  assert.ok(Math.abs(after.dist - before.dist) < 0.2, `distance ${before.dist} → ${after.dist}`);
  assert.deepEqual(p.errors, []);
});

test('at each of the four angles a figure faces the way he moves: side view mirrored to the screen direction, front toward the eye, back away', async () => {
  const p = await threeD();
  for (let i = 0; i < 4; i++) {
    const r = await p.evaluate(async () => {
      const w = window.__game.war, f = w.field, u = f.side(f.human)[0], y = w.viewState().yaw, out = [];
      for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        w.faceToward(u, dx, dz); await new Promise((r) => setTimeout(r, 120));
        const hx = dx * Math.cos(y) - dz * Math.sin(y), hz = dx * Math.sin(y) + dz * Math.cos(y);
        out.push({ hx, hz, ...w.facing(u) });
      }
      return out;
    });
    for (const o of r) {
      const ang = Math.atan2(Math.abs(o.hx), o.hz), want = ang < 0.6 ? 'front' : ang > 2.55 ? 'back' : 'side';
      assert.ok(o.row?.startsWith(want), `angle ${i}: heading (${o.hx.toFixed(2)}, ${o.hz.toFixed(2)}) shows ${o.row}`);
      if (Math.abs(o.hx) > 0.08) assert.equal(o.flip, Math.sign(o.hx), `angle ${i}: faces ${o.hx > 0 ? 'right' : 'left'}`);
    }
    await p.keyboard.press('q'); await p.waitForTimeout(500);
  }
  assert.deepEqual(p.errors, []);
});

// war-3d Task 7: occlusion. Name tags step aside or fold, hovering fades whoever covers a cell, a general behind another still reads.
// Moves a general to a cell on the board (the rules' cell and his figure), as a march would leave him.
const PUT = () => {
  window.__put = (u, x, y) => { const w = window.__game.war; if (!u || !w.field.inside(x, y)) return; u.x = x; u.y = y; w.spriteOf(u).position.set(x - 16 + 0.5, w.probe().top(x, y), y - 9.5 + 0.5); };
  window.__front = () => { const v = window.__game.war.probe().view; return [Math.round(Math.sin(v.yaw)), Math.round(Math.cos(v.yaw))]; }; // the step toward the camera, in cells
};

test('crowded generals: no two full tags overlap; the rest are dots, never the selected one or a commander, at every angle and zoom step', async () => {
  const p = await threeD();
  await p.evaluate(PUT);
  const aside = { moved: 0, dots: 0 };
  try {
    await p.evaluate(() => { // all of them onto a 3×2 block
      const w = window.__game.war, f = w.field; w.cancel(); w.cancel();
      f.alive.slice(0, 6).forEach((u, i) => window.__put(u, 14 + (i % 3), 8 + ((i / 3) | 0)));
      const me = f.alive.find((u) => u.side === f.human); w.clickCell(me.x, me.y);
    });
    for (let a = 0; a < 4; a++) {
      for (const dist of [32, 15, 8]) {
        await p.evaluate((d) => window.__game.war.frame(15, 8, d), dist);
        await p.waitForTimeout(1100);
        const r = await p.evaluate(() => {
          const w = window.__game.war, sel = window.__game.G.name(w.st.sel.id);
          const rect = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
          const on = (e) => { const b = e.getBoundingClientRect(); return b.right > 0 && b.left < innerWidth && b.bottom > 0 && b.top < innerHeight; };
          const tags = [...document.querySelectorAll('.tag')].filter((e) => getComputedStyle(e).display !== 'none' && on(e)).map((e) => ({ name: e.querySelector('b').textContent, dot: e.classList.contains('dot'), full: e.classList.contains('full'), thin: e.classList.contains('thin'), leader: getComputedStyle(e.querySelector('s')).display !== 'none', ...rect(e) }));
          const signs = [...document.querySelectorAll('.vtag')].filter(on).map(rect);
          return { tags, signs, sel, figs: w.probe().figures(), dpr: devicePixelRatio };
        });
        const signs = r.signs.map((b) => ({ name: '村', ...b })), shown = [...r.tags.filter((t) => !t.dot), ...signs], why = `angle ${a} dist ${dist}: ${JSON.stringify(r.tags.map((t) => [t.name, t.dot ? 'dot' : 'tag', Math.round(t.l), Math.round(t.t)]))}`;
        for (const x of shown) for (const y of shown) if (x !== y && !(x.name === '村' && y.name === '村')) assert.ok(x.r <= y.l + 1 || x.l >= y.r - 1 || x.b <= y.t + 1 || x.t >= y.b - 1, `${x.name} and ${y.name} overlap: ${why}`);
        for (const t of r.tags) if (t.name.includes(r.sel) || t.name.startsWith('★')) assert.ok(!t.dot, `${t.name} is the selected one or a commander and is never a dot: ${why}`);
        // thin only ever on a tag the rules exempt: the commander, the selected or the hovered one
        for (const t of r.tags) if (t.thin) assert.ok(t.name.startsWith('★') || t.name.includes(r.sel) || t.full, `${t.name} is thin but not exempt: ${why}`);
        // no tag hides more than a tenth of any general's picture, unless it is one the rules exempt that found no clear spot (it goes thin)
        for (const t of shown.filter((x) => x.name !== '村')) if (!t.thin) for (const f of r.figs) {
          const ox = Math.min(t.r, f.r) - Math.max(t.l, f.l), oy = Math.min(t.b, f.b) - Math.max(t.t, f.t);
          if (ox > 0 && oy > 0) assert.ok((ox * oy) / ((f.r - f.l) * (f.b - f.t)) <= 0.15, `${t.name} hides ${Math.round(100 * ox * oy / ((f.r - f.l) * (f.b - f.t)))}% of ${f.id}: ${why}`);
        }
        aside.moved += r.tags.filter((t) => t.leader).length; aside.dots += r.tags.filter((t) => t.dot).length;
      }
      await p.keyboard.press('q'); await p.waitForTimeout(500);
    }
    assert.ok(aside.moved + aside.dots > 0, `the crowd made tags step aside or fold: ${JSON.stringify(aside)}`);
    // The hovered general in a forced crowd: his tag is never a dot, and every thin tag is the commander's, the selected one's or his,
    // set by the exempt rule (the probe says why).
    await p.evaluate(() => { const w = window.__game.war; w.field.alive.forEach((u, i) => window.__put(u, 14 + (i % 3), 8 + ((i / 3) | 0))); w.frame(15, 8, 32); }); await p.waitForTimeout(1200);
    const hov = await p.evaluate(async () => {
      const w = window.__game.war, f = w.field, G = window.__game.G, out = [];
      for (const u of f.alive) {
        w.hoverCell({ x: u.x, y: u.y }); await new Promise((r) => setTimeout(r, 700));
        const t = [...document.querySelectorAll('.tag')].find((e) => e.querySelector('b').textContent.replace('★', '') === G.name(u.id));
        out.push({ dot: t.classList.contains('dot'), thin: w.probe().thinTags(), me: u.id });
      }
      w.hoverCell(null); return out;
    });
    for (const h of hov) { assert.ok(!h.dot, 'the hovered one is never a dot'); for (const t of h.thin) assert.ok(t.exempt && t.by === 'exempt', `thin tag ${JSON.stringify(t)} while ${h.me} is hovered`); }
    // A loss number rides its own tag: it still shows on one that has folded into a dot, and the name does not.
    const kept = await p.evaluate(() => {
      const e = document.querySelector('.tag'); e.classList.add('dot'); const n = Object.assign(document.createElement('div'), { className: 'lossnum', textContent: '−99' }); e.append(n);
      const r = { num: getComputedStyle(n).visibility, name: getComputedStyle(e.querySelector('b')).visibility, boxed: getComputedStyle(e).boxShadow }; n.remove(); e.classList.remove('dot'); return r;
    });
    assert.deepEqual([kept.num, kept.name], ['visible', 'hidden'], 'the loss number stays on a dot, the name folds away');
    // A folded tag unfolds when its general is hovered.
    await p.evaluate(() => window.__game.war.frame(15, 8, 32)); await p.waitForTimeout(900);
    const folded = await p.evaluate(() => { const w = window.__game.war, f = w.field; const t = [...document.querySelectorAll('.tag.dot')][0]; return t ? [...f.alive].find((u) => window.__game.G.name(u.id) === t.querySelector('b').textContent.replace('★', '')) && t.querySelector('b').textContent.replace('★', '') : null; });
    if (folded) {
      const open = await p.evaluate(async (nm) => { const w = window.__game.war, u = w.field.alive.find((x) => window.__game.G.name(x.id) === nm); w.hoverCell({ x: u.x, y: u.y }); await new Promise((r) => setTimeout(r, 900)); const t = [...document.querySelectorAll('.tag')].find((e) => e.querySelector('b').textContent.replace('★', '') === nm); w.hoverCell(null); return !t.classList.contains('dot') && t.classList.contains('full'); }, folded);
      assert.ok(open, 'a dot unfolds when hovered');
    }
  } finally { await p.evaluate(() => { const w = window.__game.war; w.cancel(); w.cancel(); w.hoverCell(null); w.overview(); }); await p.waitForTimeout(500); }
  assert.deepEqual(p.errors, []);
});

test('hovering a cell behind a general fades whoever covers it to 0.3, and leaving restores them', async () => {
  const p = await threeD();
  await p.evaluate(PUT);
  try {
    for (let a = 0; a < 4; a++) {
      const found = await p.evaluate(() => {
        const w = window.__game.war, f = w.field, [fx, fy] = window.__front(), [hid, cov, far] = f.alive;
        w.cancel(); w.cancel();
        // a cell and a neighbour nearer the camera whose figure stands over it (one on a lower tier behind a higher one does)
        for (let y = 2; y < 17; y++) for (let x = 2; x < 30; x++) for (const [dx, dy] of [[fx, fy], [fx, 0], [0, fy]]) {
          const bx = x + dx, by = y + dy; if (f.unitAt(bx, by) || f.unitAt(x, y) || !f.inside(bx, by)) continue;
          window.__put(hid, x, y); window.__put(cov, bx, by); window.__put(far, x - dx * 2, y - dy * 2);
          if (w.probe().covering(x, y).includes(cov.id)) return { cell: [x, y], cov: cov.id, hid: hid.id, far: far.id };
        }
        return null;
      });
      assert.ok(found, `angle ${a}: some cell has a general standing over it`);
      const read = () => p.evaluate(() => Object.fromEntries(window.__game.war.probe().opacity.map((o) => [o.id, o.a])));
      // the fade eases toward its target: poll until `want` (id -> opacity) is reached, at most 3 s, and return the last read
      const opa = async (want = {}) => { let r = await read(); for (let t = 0; t < 3000 && !Object.entries(want).every(([k, v]) => Math.abs(r[k] - v) < 0.02); t += 100) { await p.waitForTimeout(100); r = await read(); } return r; };
      const cov = await p.evaluate(({ cell }) => window.__game.war.probe().covering(...cell), found);
      assert.ok(!cov.includes(found.hid) && !cov.includes(found.far), 'not the one standing on it, not one behind it');
      await p.evaluate(({ cell }) => window.__game.war.hoverCell({ x: cell[0], y: cell[1] }), found);
      const faded = await opa({ [found.cov]: 0.3 });
      assert.ok(Math.abs(faded[found.cov] - 0.3) < 0.02, `angle ${a}: the one who covers is at ${faded[found.cov]}`);
      assert.equal(faded[found.hid], 1, 'the one on the cell is whole'); assert.equal(faded[found.far], 1, 'the one behind is whole');
      assert.ok(await p.evaluate((id) => { const u = window.__game.war.field.alive.find((x) => x.id === id), g = window.__game.war.spriteOf(u); return g.children.some((o) => o.visible && o.geometry?.type === 'RingGeometry'); }, found.cov), 'his ring stays');
      // the pointer leaving the map brings him back, as does moving to another cell
      await p.evaluate(() => document.querySelectorAll('canvas').forEach((c) => c.dispatchEvent(new PointerEvent('pointerleave'))));
      assert.ok(Math.abs((await opa({ [found.cov]: 1 }))[found.cov] - 1) < 0.02, 'the pointer left the map: restored');
      await p.evaluate(({ cell }) => window.__game.war.hoverCell({ x: cell[0], y: cell[1] }), found); await opa({ [found.cov]: 0.3 });
      await p.evaluate(({ cell }) => window.__game.war.hoverCell({ x: cell[0] < 15 ? cell[0] + 5 : cell[0] - 5, y: cell[1] }), found);
      assert.ok(Math.abs((await opa({ [found.cov]: 1 }))[found.cov] - 1) < 0.02, 'hovering elsewhere: restored');
      await p.evaluate(({ cell }) => window.__game.war.hoverCell({ x: cell[0], y: cell[1] }), found); await opa({ [found.cov]: 0.3 });
      await p.evaluate(() => window.__game.war.hoverCell(null));
      assert.ok(Math.abs((await opa({ [found.cov]: 1 }))[found.cov] - 1) < 0.02, 'hover cleared: restored');
      await p.keyboard.press('q'); await p.waitForTimeout(500);
    }
  } finally { await p.evaluate(() => { const w = window.__game.war; w.hoverCell(null); w.overview(); }); }
  assert.deepEqual(p.errors, []);
});

// The x-ray ghost shows a general hidden by whatever stands between him and the camera, even one cell in front of him, in his
// side's colour, and never from the ground or the lip of his own tier. Seen as the pixels the ghost changes: the scene is
// drawn twice in a row, as it stands (nothing updated in between, so nothing else moves), with his ghost on and off.
async function ghostOf(p, hidden, cover, { x, y, ox = 0, oz = 0 }) {
  await p.evaluate(({ hidden, cover, x, y, ox, oz }) => {
    const w = window.__game.war, f = w.field, h = f.alive.find((u) => u.id === hidden), c = f.alive.find((u) => u.id === cover);
    f.alive.forEach((u, i) => { if (u !== h && u !== c) window.__put(u, 1 + 3 * i, 18); }); // everyone else out of the picture
    window.__put(h, x, y);
    if (c) { window.__put(c, x, y); const g = w.spriteOf(c); g.position.x += ox; g.position.z += oz; } // a general on the march: not on a cell's middle
    w.frame(x, y, 8);
  }, { hidden, cover, x, y, ox, oz });
  await p.mouse.move(1270, 70);
  // the camera has arrived (target on its goal, no turn left) and two frames have been drawn since
  await p.waitForFunction(() => { const v = window.__game.war.probe().view; return v.now.every((t, i) => Math.abs(t - v.target[i]) < 0.01) && Math.abs(v.yaw - v.yawGoal) < 1e-4; }, null, { timeout: 5000 }).catch(() => {});
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); await p.waitForTimeout(600);
  return p.evaluate(({ hidden }) => {
    const w = window.__game.war, post = window.__game.debug.post, cv = post.composer.renderer.domElement, g = w.spriteOf(w.field.alive.find((u) => u.id === hidden)), ghosts = [];
    g.traverse((o) => { if (o.material?.depthFunc === 6) ghosts.push(o); }); // the x-ray quad (GreaterDepth)
    const shot = (on) => { ghosts.forEach((o) => { o.visible = on; }); post.render(); const c = new OffscreenCanvas(cv.width, cv.height), q = c.getContext('2d'); q.drawImage(cv, 0, 0); return q.getImageData(0, 0, cv.width, cv.height).data; };
    const A = shot(true), B = shot(false); ghosts.forEach((o) => { o.visible = true; });
    let n = 0, red = 0;
    for (let i = 0; i < A.length; i += 4) if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > 30) { n++; red += (A[i] - A[i + 2]) - (B[i] - B[i + 2]); }
    return { n, tint: n ? red / n : 0, ghosts: ghosts.length }; // pixels the ghost changed, and how far toward red (+) or blue (−) it moved them
  }, { hidden });
}
test('a general one step behind another shows through him as a ghost in his side colour; one with nothing in front, or on a cliff top, shows none', async () => {
  const p = await threeD();
  await p.evaluate(PUT);
  try {
    const spot = await p.evaluate(() => {
      const w = window.__game.war, f = w.field, [fx, fy] = window.__front(), top = (x, y) => w.probe().top(x, y), cells = [...Array(19).keys()].flatMap((y) => [...Array(32).keys()].map((x) => [x, y]));
      // an open stretch of plain, level and clear (the widest square this field has), and a cliff top with nothing higher between it and the camera
      let plain = null;
      for (const r of [2, 1]) { for (const [x, y] of cells) {
        if (x < 3 || y < 3 || x > 28 || y > 15) continue; let ok = true;
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (f.map[y + dy][x + dx] !== 2 || top(x + dx, y + dy) !== top(x, y)) ok = false;
        if (ok && (!plain || Math.hypot(x - 16, y - 9) < Math.hypot(plain[0] - 16, plain[1] - 9))) plain = [x, y];
      } if (plain) break; }
      const peak = cells.find(([x, y]) => x > 2 && y > 2 && x < 29 && y < 16 && top(x, y) >= 1 && [[fx, fy], [fx, 0], [0, fy], [fx * 2, fy * 2], [fx * 2, 0], [0, fy * 2], [fx * 2, fy]].every(([dx, dy]) => top(x + dx, y + dy) <= top(x, y)));
      return { plain, peak, fx, fy, foe: f.alive.filter((u) => u.side !== f.human).map((u) => u.id), mine: f.alive.filter((u) => u.side === f.human).map((u) => u.id) };
    });
    assert.ok(spot.plain && spot.peak, `this field has open plain and a cliff top: ${JSON.stringify(spot)}`);
    const [x, y] = spot.plain, step = { ox: spot.fx * 0.6, oz: spot.fy * 0.6 };
    // a defender behind one of ours (his ghost is red), an attacker behind one of theirs (blue)
    const d = await ghostOf(p, spot.foe[0], spot.mine[0], { x, y, ...step });
    assert.equal(d.ghosts, 1); assert.ok(d.n > 150, `a general behind another shows ${d.n} pixels of ghost`); assert.ok(d.tint > 10, `a defender's ghost is red (${d.tint})`);
    const a = await ghostOf(p, spot.mine[0], spot.foe[0], { x, y, ...step });
    assert.ok(a.n > 150, `an attacker behind a defender shows ${a.n} pixels of ghost`); assert.ok(a.tint < -10, `an attacker's ghost is blue (${a.tint})`);
    // exactly one cell in front, straight toward the camera (not the rounded diagonal step, which is 1.4 cells): the pictures still overlap by a sliver at this pitch, and the ghost shows it
    const vw = await p.evaluate(() => window.__game.war.probe().view);
    const cell = await ghostOf(p, spot.foe[0], spot.mine[0], { x, y, ox: Math.sin(vw.yaw), oz: Math.cos(vw.yaw) }); assert.equal(cell.ghosts, 1); assert.ok(cell.n > 100, `a general a full cell behind another shows ${cell.n} pixels of ghost`); assert.ok(cell.tint > 10, `a defender's ghost is red (${cell.tint})`);
    // nothing in front of him: no ghost, however his tier is edged
    const lone = await ghostOf(p, spot.foe[1] ?? spot.foe[0], null, { x, y }); assert.ok(lone.n < 12, `nothing in front: ${lone.n} pixels`);
    const cliff = await ghostOf(p, spot.foe[1] ?? spot.foe[0], null, { x: spot.peak[0], y: spot.peak[1] }); assert.ok(cliff.n < 12, `a general on a cliff top, hidden by nothing but his own tier: ${cliff.n} pixels`);
    // and the cliff's own face is something between him and the camera: lower than it, behind it, he shows through
    const behind = await p.evaluate(({ x, y, fx, fy }) => { const w = window.__game.war; for (let k = 1; k <= 2; k++) { const bx = x - fx * k, by = y - fy * k; if (w.field.inside(bx, by) && w.probe().top(bx, by) < w.probe().top(x, y) - 0.4) return [bx, by]; } return null; }, { x: spot.peak[0], y: spot.peak[1], fx: spot.fx, fy: spot.fy });
    if (behind) { const wall = await ghostOf(p, spot.foe[1] ?? spot.foe[0], null, { x: behind[0], y: behind[1] }); assert.ok(wall.n > 20, `a general behind a cliff shows through it: ${wall.n} pixels`); }
  } finally { await p.evaluate(() => { const w = window.__game.war; w.cancel(); w.overview(); }); }
  assert.deepEqual(p.errors, []);
});

test('a throw in the 白兵 cut-in does not leave the close-up on: Q still turns the board', async () => {
  const p = await threeD();
  const r = await p.evaluate(async () => {
    const w = window.__game.war, f = w.field, a = f.side(f.human)[0], d = f.alive.find((u) => u.side !== f.human); w.cancel(); w.cancel(); w.overview();
    await new Promise((r) => setTimeout(r, 1300));
    const before = w.probe().view.yawGoal; let threw = false;
    try { await window.__game.debug.cutIn(f, a, d, { pending: {} }, 0); } catch { threw = true; }
    document.body.classList.remove('cine'); document.querySelector('#cine').hidden = true;
    w.rotate(1); const turned = w.probe().view.yawGoal !== before; await new Promise((r) => setTimeout(r, 500)); w.rotate(-1);
    return { threw, turned };
  });
  assert.ok(r.threw, 'the cut-in did throw (it had no battle)'); assert.ok(r.turned, 'a turn is not refused once it has');
  await p.waitForTimeout(500);
  assert.equal(await p.evaluate(() => { window.__game.war.overview(); return !!document.querySelector('.cine'); }), false);
});

test('a wheel step taken during a quarter turn lands on its exact fit', async () => {
  const p = await threeD();
  await p.evaluate(() => { const w = window.__game.war; w.cancel(); w.cancel(); w.overview(); }); await p.waitForTimeout(1300);
  await p.mouse.move(700, 400);
  await p.keyboard.press('q'); await p.waitForTimeout(100);
  await p.mouse.wheel(0, -100);                      // 全景 → far while the board is still turning
  await p.waitForTimeout(1800);
  const r = await p.evaluate(() => { const v = window.__game.war.probe(); return { zoom: v.view.zoom, dist: v.view.dist, fit: v.fitDist(), turning: Math.abs(v.view.yaw - v.view.yawGoal) }; });
  assert.equal(r.zoom, 'far'); assert.ok(r.turning < 1e-6, 'the turn landed');
  assert.ok(Math.abs(r.dist - r.fit) < 0.02 * r.fit, `landed at ${r.dist.toFixed(2)}, the exact fit is ${r.fit.toFixed(2)}`);
  await p.keyboard.press('e'); await p.evaluate(() => window.__game.war.overview()); await p.waitForTimeout(900);
});

test('a tag that was bumped aside or up goes back to its own place over the head, with no leader, once the crowd has gone', async () => {
  const p = await threeD();
  await p.evaluate(PUT);
  const shape = () => p.evaluate(() => {
    const on = (e) => { const b = e.getBoundingClientRect(); return b.right > 0 && b.left < innerWidth && b.bottom > 0 && b.top < innerHeight; };
    const signs = [...document.querySelectorAll('.vtag')].map((e) => e.getBoundingClientRect());
    return [...document.querySelectorAll('.tag')].filter((e) => getComputedStyle(e).display !== 'none' && on(e)).map((e) => ({ held: (() => { const b = e.getBoundingClientRect(), x = b.left - parseInt(e.style.marginLeft || '0'), y = b.top - parseInt(e.style.marginTop || '0'); return signs.some((s) => x < s.right + 2 && x + b.width > s.left - 2 && y < s.bottom + 1 && y + b.height > s.top - 1); })(), name: e.querySelector('b').textContent, dot: e.classList.contains('dot'), ml: parseInt(e.style.marginLeft || '0'), mt: parseInt(e.style.marginTop || '0'), leader: getComputedStyle(e.querySelector('s')).display !== 'none' }));
  });
  try {
    await p.evaluate(() => { const w = window.__game.war, f = w.field; w.cancel(); w.cancel(); f.alive.slice(0, 6).forEach((u, i) => window.__put(u, 14 + (i % 3), 8 + ((i / 3) | 0))); w.frame(15, 8, 32); });
    await p.waitForTimeout(1400);
    const crowd = await shape();
    assert.ok(crowd.some((t) => t.dot || t.leader || t.ml || t.mt), `the crowd moved some tag off its place: ${JSON.stringify(crowd)}`);
    // A day tick (or a purchase, an ambush, 奇门) rebuilds the tags' markup: a tag that stood aside still shows its leader to his head.
    const aside = crowd.filter((t) => t.leader).map((t) => t.name);
    assert.ok(aside.length, `some tag stands aside with a leader: ${JSON.stringify(crowd)}`);
    await p.evaluate(() => window.__game.war.refreshTags());
    await p.waitForTimeout(500);
    const rebuilt = await shape();
    for (const n of aside) { const t = rebuilt.find((x) => x.name === n); if (t && !t.dot) assert.ok(t.leader, `${n} keeps his leader line after the tags are rebuilt: ${JSON.stringify(rebuilt)}`); }
    assert.ok(rebuilt.some((t) => aside.includes(t.name) && t.leader), `at least one leader survived the rebuild: ${JSON.stringify(rebuilt)}`);
    const followed = rebuilt.find(t => aside.includes(t.name) && t.leader).name;
    await p.evaluate((followed) => {
      const { war: w, G } = window.__game;
      const u = w.field.alive.find(u => (u.commander ? '★' : '') + G.name(u.id) === followed);
      const others = w.field.alive.filter(v => v !== u);
      // 留出一整个镜头的间隔，让名牌恢复测试与其他武将、店铺的投影分离。
      others.forEach((v, i) => window.__put(v, i < 4 ? i : 31 - i % 4, i < 4 ? 1 : 17));
      window.__put(u, 16, 9);
      w.frame(16, 9, 14);
    }, followed);
    await warRest(p, { jump: true });
    await p.waitForFunction((followed) => {
      const tag = [...document.querySelectorAll('.tag')].find(e => e.querySelector('b')?.textContent === followed);
      if (!tag || !tag.checkVisibility() || tag.classList.contains('dot')) return false;
      const r = tag.getBoundingClientRect();
      return r.x >= 0 && r.right <= innerWidth && r.y >= 0 && r.bottom <= innerHeight
        && Math.abs(parseFloat(tag.style.marginLeft)) <= 1 && Math.abs(parseFloat(tag.style.marginTop)) <= 1
        && getComputedStyle(tag.querySelector('s')).display === 'none';
    }, followed);
  } finally { await p.evaluate(() => { const w = window.__game.war; w.cancel(); w.hoverCell(null); w.overview(); }); await p.waitForTimeout(500); }
  assert.deepEqual(p.errors, []);
});

// war-3d Task 8: the board in tiers. Plain 0.3, a hill's rim 1.05 and its core 1.8 (flat tops, vertical faces between), the castle
// on a 0.5 plinth at 0.8, the river bed below the plain. Terrain codes: 0 forest, 1 sand, 2 plain, 3 river, 4 hill, 5 castle.
test('the board stands in tiers: plain 0.3, hill rim 1.05, hill core 1.8, castle 0.8, river below the plain', async () => {
  const p = await threeD();
  const r = await p.evaluate(() => {
    const w = window.__game.war, f = w.field, top = (x, y) => w.probe().top(x, y), at = (x, y) => (f.inside(x, y) ? f.map[y][x] : null);
    const cells = [...Array(19).keys()].flatMap((y) => [...Array(32).keys()].map((x) => [x, y]));
    const hill = (x, y) => at(x, y) === 4, core = (x, y) => hill(x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => hill(x + dx, y + dy));
    const inner = (x, y) => x > 0 && y > 0 && x < 31 && y < 18;
    const kinds = { plain: (x, y) => at(x, y) === 2, forest: (x, y) => at(x, y) === 0, sand: (x, y) => at(x, y) === 1, river: (x, y) => at(x, y) === 3,
      rim: (x, y) => hill(x, y) && inner(x, y) && !core(x, y), core: (x, y) => inner(x, y) && core(x, y), castle: (x, y) => at(x, y) === 5 };
    const out = { n: {}, vals: {} };
    for (const [k, test] of Object.entries(kinds)) { const l = cells.filter(([x, y]) => test(x, y)); out.n[k] = l.length; out.vals[k] = [...new Set(l.map(([x, y]) => +top(x, y).toFixed(3)))]; }
    return out;
  });
  assert.ok(r.n.plain && r.n.rim && r.n.core && r.n.castle && r.n.river, `this field has one of each: ${JSON.stringify(r.n)}`);
  assert.deepEqual(r.vals.plain, [0.3]); assert.deepEqual(r.vals.forest, [0.3]); if (r.n.sand) assert.deepEqual(r.vals.sand, [0.3]);
  assert.deepEqual(r.vals.rim, [1.05]); assert.deepEqual(r.vals.core, [1.8]); assert.deepEqual(r.vals.castle, [0.8]);
  assert.ok(r.vals.river.every((v) => v < 0.3), `the river bed lies below the plain: ${r.vals.river}`);
});

for (const step of ['whole', 'far']) test(`a click on a cliff face picks the cell on top of it (${step})`, async () => {
  const p = await threeD();
  await p.evaluate(PUT);
  await p.evaluate((step) => { const w = window.__game.war; w.cancel(); w.cancel(); w.overview(); if (step === 'far') setTimeout(() => w.zoom(-150), 400); }, step);
  await p.waitForTimeout(1800);
  try {
    const hit = await p.evaluate(() => {
      const w = window.__game.war, f = w.field, [fx, fy] = window.__front(), top = (x, y) => w.probe().top(x, y), at = (x, y) => (f.inside(x, y) ? f.map[y][x] : null);
      // a hill cell with plain ground for two cells toward the camera on one of its two camera-facing sides (the camera looks along a
      // diagonal), and no general near (his picture would be hit first)
      const low = (x, y) => f.inside(x, y) && top(x, y) <= 0.31 && at(x, y) !== 3;
      const ahead = (x, y) => [[fx, 0], [0, fy]].filter(([dx, dy]) => dx || dy).find(([dx, dy]) => low(x + dx, y + dy) && [0, 1, 2].every((i) => [0, 1, 2].every((j) => (!i && !j) || low(x + fx * i, y + fy * j))));
      let side = null;
      const spot = [...Array(19).keys()].flatMap((y) => [...Array(32).keys()].map((x) => [x, y])).find(([x, y]) => at(x, y) === 4 && top(x, y) > 0.9 && x > 1 && y > 1 && x < 30 && y < 17
        && (side = ahead(x, y)) && f.alive.every((u) => Math.max(Math.abs(u.x - x), Math.abs(u.y - y)) > 3));
      if (!spot) return null;
      const [x, y] = spot, t = top(x, y), res = [], [dx, dy] = side;
      // three points down the face (0.3, 0.45 and 0.6 below the top edge), spread along it
      for (const [drop, along] of [[0.3, 0], [0.45, 0.2], [0.6, -0.2]]) {
        const pt = new w.camera.position.constructor(x - 16 + 0.5 + dx * 0.5 + (dx ? 0 : along), t - drop, y - 9.5 + 0.5 + dy * 0.5 + (dy ? 0 : along)).project(w.camera);
        const c = w.hover({ x: pt.x, y: pt.y }); res.push(c ? { x: c.x, y: c.y } : null);
      }
      w.hoverCell(null);
      return { cell: [x, y], res };
    });
    assert.ok(hit, 'this field has a hill face toward the camera with open ground in front of it');
    for (const c of hit.res) assert.deepEqual(c && [c.x, c.y], hit.cell, `a click on the face of ${hit.cell} picked ${JSON.stringify(c)}`);
  } finally { await p.evaluate(() => { const w = window.__game.war; w.hoverCell(null); }); }
  assert.deepEqual(p.errors, []);
});

test('a tree crown never reaches north past half the next cell (a mesa there would pierce it)', async () => {
  const p = await threeD();
  const r = await p.evaluate(async () => {
    const { woodsOf } = await import('./src/warview.js');
    let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const cells = Array.from({ length: 60 }, (_, i) => ({ x: i, z: i * 0.37, h: 0.3, shade: 0.5 }));
    const out = woodsOf({ forests: cells, plains: cells, wildForests: cells, castle: null }, rnd);
    // each tree belongs to the cell it was planted for: the nearest centre in x, then z
    let worst = Infinity, widest = 0;
    for (const t of out) { const c = cells.reduce((a, b) => (Math.hypot(b.x - t.x, b.z - t.z) < Math.hypot(a.x - t.x, a.z - t.z) ? b : a)); worst = Math.min(worst, (t.z - t.size / 2) - (c.z - 1)); widest = Math.max(widest, t.size); }
    return { n: out.length, worst, widest };
  });
  assert.ok(r.n > 200, `${r.n} trees`); assert.ok(r.worst >= -1e-9, `a crown reaches ${(-r.worst).toFixed(2)} cells past the limit`); assert.ok(r.widest > 1, 'the clamp leaves the ordinary crowns alone');
});

// war-3d Task 9: light and lens. A warm low sun, a tilt-shift that tightens with each zoom step, shop signs hung over the roofs.
test('the lens: PROFILES.war and one tilt-shift per zoom step, none looking straight down', async () => {
  const p = await threeD();
  const r = await p.evaluate(async () => {
    const { PROFILES } = await import('./src/post.js'), w = window.__game.war, out = { war: PROFILES.war, steps: {} };
    w.overview(); await new Promise((r) => setTimeout(r, 600)); out.steps[w.viewState().zoom] = w.dof();
    for (let i = 0; i < 3; i++) { w.zoom(-150); await new Promise((r) => setTimeout(r, 1300)); out.steps[w.viewState().zoom] = w.dof(); }
    return out;
  });
  assert.deepEqual(r.war.bloom, [0.32, 0.5, 0.86]); assert.equal(r.war.warmth, 0.03); assert.equal(r.war.vignette, 0.8); assert.equal(r.war.grain, 0.004);
  const L = (k, keys) => keys.map((n) => r.steps[k]?.[n]);
  assert.deepEqual(L('whole', ['dof', 'band', 'far', 'near']), [1.0, 0.12, 1.2, 1], '全景 the softest');
  assert.deepEqual(L('far', ['dof', 'band', 'far', 'near']), [1.2, 0.09, 1.3, 1]);
  // mid and near: ~2 cells of depth sharp either side of the focus in world units, near-side weight at most 0.8, max blur about HEAD's (~5 px)
  assert.deepEqual(L('mid', ['dof', 'bandWorld', 'far', 'near']), [1.4, 2.2, 1.4, 0.8]); assert.deepEqual(L('near', ['dof', 'bandWorld', 'far', 'near']), [1.4, 2.2, 1.5, 0.8]);
  for (const k of ['whole', 'far', 'mid', 'near']) assert.equal(r.steps[k].strength, r.steps[k].dof, 'the post pass reads strength');
  await p.evaluate(() => window.__game.war.overview()); await p.waitForTimeout(600);
  assert.deepEqual(p.errors, []);
});

test('the key light: a pale warm sun about 30° up on clear days, the month\'s own grey in a rainy, stormy or snowing one', async () => {
  const p = await threeD();
  const r = await p.evaluate(async () => {
    const { keySun, GREY_LIGHTS } = await import('./src/warview.js'), { MONTHS, lookOf } = await import('./src/seasons.js'), w = window.__game.war, lights = [];
    w.scene.traverse((o) => { if (o.isDirectionalLight && o.castShadow) lights.push({ pos: o.position.toArray(), c: o.color.getHexString(), i: o.intensity }); });
    const hsl = {}, months = MONTHS.map((m, i) => { const k = keySun(i), l = lookOf(i); k.color.getHSL(hsl); return { id: m.light, grey: GREY_LIGHTS.includes(m.light), c: k.color.getHexString(), i: k.intensity, preset: l.sun.getHexString(), presetI: l.si, r: k.color.r, g: k.color.g, b: k.color.b, h: hsl.h * 360 }; });
    return { lights, months, ids: [...new Set(MONTHS.map((m) => m.light))], grey: GREY_LIGHTS, now: keySun(w.field.g.month).color.getHexString(), month: w.field.g.month };
  });
  assert.equal(r.lights.length, 1); const [x, y, z] = r.lights[0].pos, elev = Math.atan2(y, Math.hypot(x, z)) * 180 / Math.PI;
  assert.ok(elev > 27 && elev < 33, `elevation ${elev.toFixed(1)}°`);
  for (const g of r.grey) assert.ok(r.ids.includes(g), `'${g}' is a real MONTHS light id (${r.ids})`);
  assert.ok(r.months.some((m) => m.grey) && r.months.some((m) => !m.grey), 'both clear and grey months exist');
  for (const m of r.months) {
    if (m.grey) { assert.equal(m.c, m.preset, `${m.id}: the preset's own colour`); assert.ok(Math.abs(m.i - m.presetI * 0.95) < 1e-9, `${m.id}: the preset's own strength`); }
    else { assert.ok(m.r > m.g && m.g > m.b, `${m.id}: warm (r > g > b)`); assert.ok(m.h > 22 && m.h < 42, `${m.id}: hue ${m.h.toFixed(0)}° is a warm white, not orange`); assert.ok(m.i >= 3.0 && m.i <= 4.0, `${m.id}: strength ${m.i}`); }
  }
  assert.equal(r.lights[0].c, r.now, 'the scene is lit by the month\'s key light');
});

test('the sharp band: at mid and near the selected general and the cells within 1 of him are in focus, the far top softens', async () => {
  const p = await threeD();
  try {
    for (const step of ['mid', 'near']) {
      const r = await p.evaluate(async (step) => {
        const w = window.__game.war, f = w.field; w.cancel(); w.cancel(); w.hoverCell(null);
        const me = f.alive.filter((u) => u.side === f.human)[1] ?? f.alive[0]; w.clickCell(me.x, me.y); w.resetView(); if (step === 'near') w.zoom(-150);
        await new Promise((r) => setTimeout(r, 2200));
        const top = (x, y) => w.probe().top(x, y), at = (x, y, dy = 0.5) => w.blurAt(x - 16 + 0.5, top(x, y) + dy, y - 9.5 + 0.5);
        const cells = []; for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (f.inside(me.x + dx, me.y + dy)) cells.push([me.x + dx, me.y + dy]);
        // the board's far back corner for contrast
        // the same weight worked out by hand from the live shader uniforms
        const u = window.__game.debug.post.dofUniforms(), pt = [me.x - 16 + 0.5, top(me.x, me.y) + 4, me.y - 9.5 + 0.5], cam = w.camera; cam.updateMatrixWorld();
        const z = -new cam.position.constructor(...pt).applyMatrix4(cam.matrixWorldInverse).z, c = (z - u.focus) / u.focus, a = Math.abs(c), t = Math.min(1, Math.max(0, (a - u.range) / u.ramp));
        const drift = Math.abs(t * t * (3 - 2 * t) * (c > 0 ? u.far : u.near) - w.blurAt(...pt));
        return { drift, zoom: w.viewState().zoom, fig: at(me.x, me.y, 0.6), cells: cells.map(([x, y]) => at(x, y, 0)), far: Math.max(...[[0, 0], [31, 0], [15, 0]].map(([x, y]) => at(x, y, 0))), lens: w.dof() };
      }, step);
      assert.equal(r.zoom, step);
      assert.ok(r.drift < 1e-6, `${step}: the probe's weight and the shader's own uniforms agree (${r.drift})`);
      assert.ok(r.fig < 0.02, `${step}: his figure's blur weight ${r.fig}`);
      for (const c of r.cells) assert.ok(c < 0.05, `${step}: a cell within 1 of him has blur weight ${c}`);
      assert.ok(r.lens.near <= 0.8);
    }
    // a zoom step out of mid and back in: the focus follows, and once the camera has settled he is sharp again
    for (const d of [150, -150]) {
      await p.evaluate((d) => window.__game.war.zoom(d), d); await p.waitForTimeout(2200);
      const k = await p.evaluate(() => { const w = window.__game.war, f = w.field, u = w.st.sel; return { z: w.viewState().zoom, fig: w.blurAt(u.x - 16 + 0.5, w.probe().top(u.x, u.y) + 0.6, u.y - 9.5 + 0.5) }; });
      assert.ok(k.fig < 0.02, `after a zoom step to ${k.z} the selected general is sharp (${k.fig})`);
    }
  } finally { await p.evaluate(() => { const w = window.__game.war; w.cancel(); w.overview(); }); await p.waitForTimeout(500); }
  assert.deepEqual(p.errors, []);
});

test('the field 武器店, 米店 and 病院 signs stay on screen from every angle', async () => {
  // 'far' shows the board's middle at a corner angle, so a village is framed (mid step) and its own sign must then be whole on the screen.
  const p = await threeD();
  const per = [];
  for (let a = 0; a < 4; a++) {
    const n = await p.evaluate(() => window.__game.war.field.villages.length);
    for (let i = 0; i < n; i++) {
      await p.evaluate((i) => { const w = window.__game.war, v = w.field.villages[i]; w.cancel(); w.frame(v.x, v.y, 15); }, i); await p.waitForTimeout(1100);
      per.push(await p.evaluate((i) => {
        const w = window.__game.war, v = w.field.villages[i], anchors = [];
        w.scene.traverse((o) => { if (o.isCSS2DObject && o.element.classList.contains('vtag')) anchors.push(o); });
        const o = anchors[i], e = o.element, b = e.getBoundingClientRect(), cs = getComputedStyle(e);
        return { a: Math.round(w.probe().view.yaw * 100) / 100, i, n: anchors.length, nv: w.field.villages.length, l: b.left, r: b.right, t: b.top, b: b.bottom, op: +cs.opacity, wood: cs.backgroundImage !== 'none', txt: e.textContent, lift: o.position.y - w.probe().top(v.x, v.y), vw: innerWidth, vh: innerHeight };
      }, i));
    }
    await p.keyboard.press('q'); await p.waitForTimeout(600);
  }
  // At 'far' every angle: a village whose cell projects inside the viewport has its sign inside it too.
  const farSeen = [];
  for (let a = 0; a < 4; a++) {
    await p.evaluate(() => window.__game.war.overview()); await p.waitForTimeout(1500);
    farSeen.push(await p.evaluate(() => {
      const w = window.__game.war, signs = [];
      w.scene.traverse((o) => { if (o.isCSS2DObject && o.element.classList.contains('vtag')) signs.push(o.element); });
      return w.field.villages.map((v, i) => { const c = w.screenOf(v.x, v.y), b = signs[i].getBoundingClientRect(), cellOn = c.x > 0 && c.x < innerWidth && c.y > 0 && c.y < innerHeight;
        const an = [...signs][i], ea = (() => { let q; w.scene.traverse((o) => { if (o.isCSS2DObject && o.element === signs[i]) q = o; }); const v = q.position.clone().project(w.camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; })();
        return { off: Math.hypot((b.left + b.right) / 2 - ea[0], (b.top + b.bottom) / 2 - ea[1]), yaw: Math.round(w.probe().view.yaw * 100) / 100, i, cellOn, signOn: b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight, c: [Math.round(c.x), Math.round(c.y)], b: [Math.round(b.left), Math.round(b.top)] }; });
    }));
    await p.keyboard.press('q'); await p.waitForTimeout(600);
  }
  assert.ok(farSeen.flat().some((v) => v.cellOn), 'some village is on screen at far');
  for (const v of farSeen.flat()) if (v.cellOn) assert.ok(v.off < 40, `a nudged sign stays attached to its roof (${v.off.toFixed(0)} px): ${JSON.stringify(v)}`);
  for (const v of farSeen.flat()) if (v.cellOn) assert.ok(v.signOn, `far, village ${v.i} on screen but its sign is not: ${JSON.stringify(v)}`);
  assert.equal(new Set(per.map((r) => r.a)).size, 4, 'four different angles');
  for (const r of per) {
    const why = `angle ${r.a} village ${r.i}: ${JSON.stringify(r)}`;
    assert.equal(r.n, r.nv, `a sign for every village: ${why}`);
    assert.ok(r.l >= 0 && r.r <= r.vw && r.t >= 0 && r.b <= r.vh, `on screen: ${why}`);
    assert.ok(r.op >= 0.45, `opaque enough: ${why}`); assert.ok(r.wood, `a wooden plaque, not a plain box: ${why}`);
    assert.ok(Math.abs(r.lift - 0.85) < 0.02, `hangs 0.4 over the ridge (0.45 over the cell top): ${why}`);
  }
  await p.evaluate(() => window.__game.war.overview()); await p.waitForTimeout(500);
  assert.deepEqual(p.errors, []);
});

test('a village sign thins to 0.45 over a general\'s picture and is whole again once he leaves', async () => {
  const p = await threeD();
  await p.evaluate(PUT);
  const sign = () => p.evaluate(() => +getComputedStyle(document.querySelector('.vtag')).opacity);
  try {
    await p.evaluate(() => { const w = window.__game.war, f = w.field, v = f.villages[0]; w.cancel(); w.cancel(); w.frame(v.x, v.y, 12); });
    await p.waitForTimeout(1400);
    assert.equal(await sign(), 1, 'whole with nobody under it');
    // a general stood in the cell below the village's own, toward the camera, so his picture reaches up under its plaque
    const hit = await p.evaluate(async () => {
      const w = window.__game.war, f = w.field, v = f.villages[0], u = f.alive[0], [fx, fy] = window.__front(), res = [];
      for (const [dx, dy] of [[0, 0], [fx, fy], [-fx, -fy]]) { window.__put(u, v.x + dx, v.y + dy); await new Promise((r) => setTimeout(r, 900)); res.push(+getComputedStyle(document.querySelector('.vtag')).opacity); }
      return res;
    });
    assert.ok(hit.some((o) => Math.abs(o - 0.45) < 0.02), `one of the stands put him under the plaque: ${hit}`);
    assert.ok(hit.every((o) => o >= 0.45 - 1e-6), 'never thinner than 0.45');
    await p.evaluate(() => window.__put(window.__game.war.field.alive[0], 1, 1)); await p.waitForTimeout(900);
    assert.equal(await sign(), 1, 'whole again');
  } finally { await p.evaluate(() => { const w = window.__game.war; w.cancel(); w.overview(); }); await p.waitForTimeout(500); }
  assert.deepEqual(p.errors, []);
});

// Review fix I-3: at 1200 px and below the foe's card stacks above ours; it floats over the bottom band and must not
// move the board when the pointer crosses an enemy.
for (const [W, H] of [[1200, 800], [1024, 768]]) test(`at ${W}×${H} the board does not shift when the foe's compare card comes and goes (3D)`, async () => {
  const p = await threeD();
  await p.setViewportSize({ width: W, height: H }); await p.mouse.move(W * 0.55, H * 0.3);
  try {
    const set = await p.evaluate(async () => {
      const w = window.__game.war, f = w.field; w.cancel(); w.cancel();
      const u = f.side(f.human)[0], e = f.alive.find((x) => x.side !== f.human);
      w.clickCell(u.x, u.y); w.hoverCell(null);
      const free = [[2, 0], [-2, 0], [0, 2], [0, -2], [3, 0]].map(([dx, dy]) => [e.x + dx, e.y + dy]).find(([x, y]) => f.inside(x, y) && !f.unitAt(x, y));
      return { e: [e.x, e.y], free };
    });
    const settle = () => p.waitForTimeout(900), off = () => p.evaluate(() => window.__game.war.probe().viewOffset());
    await settle();
    const base = await off();
    await p.evaluate(({ e }) => window.__game.war.hoverCell({ x: e[0], y: e[1] }), set); await settle();
    const stacked = await p.evaluate(() => { const own = document.querySelector('.unitpanel:not(.compare)')?.getBoundingClientRect(), foe = document.querySelector('.unitpanel.compare')?.getBoundingClientRect(); return own && foe ? { own: own.top, foe: foe.top } : null; });
    assert.ok(stacked, 'the foe\'s card is up');
    assert.ok(stacked.foe < stacked.own - 20, `at this width the foe's card stacks above ours: ${JSON.stringify(stacked)}`);
    assert.ok(Math.abs((await off()) - base) <= 1, `the view offset is unchanged while his card is up: ${base} -> ${await off()}`);
    await p.evaluate(({ free }) => window.__game.war.hoverCell({ x: free[0], y: free[1] }), set); await settle();
    assert.equal(await p.evaluate(() => !!document.querySelector('.unitpanel.compare')), false, 'his card is put away');
    assert.ok(Math.abs((await off()) - base) <= 1, `and unchanged after it goes: ${base} -> ${await off()}`);
  } finally { await p.setViewportSize({ width: 1280, height: 800 }); await p.evaluate(() => { window.__game.war.hoverCell(null); window.__game.war.cancel(); }); }
  assert.deepEqual(p.errors, []);
});

// Review fix I-2: the frame-rate watch runs on the player's own idle turn in a war he started, where runCommand holds `busy`.
test('the slow-map frame-rate watch is armed on our idle turn in an attack war, even inside runCommand', async () => {
  const p = await threeD();
  const r = await p.evaluate(() => {
    const gm = window.__game, w = gm.war, f = w.field, out = { mine: f.turn === f.human, mode: gm.mode };
    out.idle = gm.qualityIdle();
    gm.debug.holdCommand(true); try { out.inCommand = gm.qualityIdle(); } finally { gm.debug.holdCommand(false); }
    const busy = w.st.busy; w.st.busy = true; try { out.animating = gm.qualityIdle(); } finally { w.st.busy = busy; }
    return out;
  });
  assert.equal(r.mode, 'war'); assert.ok(r.mine, 'our turn');
  assert.equal(r.idle, true, 'armed on our idle turn');
  assert.equal(r.inCommand, true, 'armed while runCommand holds busy (the war we started)');
  assert.equal(r.animating, false, 'not while the war animates (the opening, a march)');
});

// 奇门遁甲只在旧规则中可用；使用独立的原版战场验证孔明退离后的标记。
test('奇门: when 诸葛亮 leaves the field mid-day the trapped one\'s tag says 困·孔明不在 at once', async () => {
  const p = await game.open('', { setup: (context) => context.addInitScript(() => sessionStorage.setItem('haou-hd2d-scenario', 'original')) });
  try {
    await toWar(p);
    const result = await p.evaluate(() => {
      const w = window.__game.war, f = w.field;
      const e = f.alive.find(x => x.side !== f.human), m = f.side(f.human).find(x => !x.commander && f.retreatTargets(x).length);
      const tags = () => [...document.querySelectorAll('.tag em.qimen')].map(t => t.textContent);
      m.id = 109; e.qimen = 3; w.refreshTags();
      const before = tags();
      w.clickCell(m.x, m.y);
      return { before, ok: w.retreat(f.retreatTargets(m)[0], m), after: tags() };
    });
    assert.ok(result.before.includes('奇门 3日'), `counting: ${result.before}`);
    assert.ok(result.ok, 'he retreats');
    assert.ok(result.after.length && result.after.every(t => t === '困·孔明不在'), `the tag follows him out: ${result.after}`);
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); }
});

test("the player's own 计略 leaves his view where he slid it, an enemy's goes to it", async () => {
  const p = await threeD();
  const mine = await aimAfterCast(p, true);
  assert.notEqual(mine.zoom, 'whole', 'a view that a focus can move');
  assert.deepEqual(mine.after, mine.before, 'the player cast it: the camera stays');
  assert.equal(mine.zoomAfter, mine.zoom);
  const foe = await aimAfterCast(p, false);
  assert.notDeepEqual(foe.after, foe.before, 'the enemy cast it: the camera goes to it');
});

// The river is one flat plane under a low sun: glossy, it mirrors the sun as a blown-out white patch wherever a river lies opposite the eye (汉中之战's right edge).
test('the 3D war map\'s water is matte enough to leave no sun patch on the river', async () => {
  const roughness = await (await threeD()).evaluate(() => { let r; window.__game.war.scene.traverse((o) => { if (o.userData?.water) r = o.material.roughness; }); return r; });
  assert.ok(roughness >= 0.8, `water roughness ${roughness}`);
});
