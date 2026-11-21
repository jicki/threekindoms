// 攻击 and the way into the 白兵 (docs/战场操作与白兵入口优化方案_2026-11-10_D32.md §6, §7, §9; phase 2, asked by the author).
// The 攻击 is asked about in the action panel and entered on a new input of its own, once; the formation is picked, then deployed
// (only the picked one, the last one picked already); the fight starts from the opening pause on a new input only. None of the
// steps is run on into by a double click, a held key, a press from the step before or a burst of clicks.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { startGame, newCampaign, closeMessages, CARD_ACTS } from './game.mjs';

let game;
before(async () => { game = await startGame({ width: 1280, height: 720 }); });
after(() => game?.close());

// A war on the player's turn: his first general with 30 mobility, one enemy beside him on plain ground (a second one beside him
// too when `two`), every call to the rules' attack and to the field's random numbers counted (window.__atk, window.__rolls).
async function war(query = '&flat', { two = false, castle = false, size = null } = {}) {
  const page = await game.open(query);
  if (size) await page.setViewportSize(size);
  await page.evaluate(async () => { (await import('./src/pace.js')).setPace(4); (await import('./src/vignette.js')).setVignettes(false); });
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
    await page.waitForTimeout(2000);
    await page.evaluate(() => window.__game.war.finishDeploy());
    await page.waitForFunction(() => { const f = window.__game.war.field; return f.turn === f.human && !document.querySelector('.banner, .panel.msg'); }, null, { timeout: 30000 });
  } finally { stop(); }
  const ok = await page.evaluate(async ({ two, castle }) => {
    const F = await import('./src/core/field.js'), w = window.__game.war, f = w.field;
    const me = f.alive.find((u) => u.side === f.human && !u.commander) ?? f.alive.find((u) => u.side === f.human);
    const foes = f.alive.filter((u) => u.side !== f.human).sort((a, b) => Number(!!a.commander) - Number(!!b.commander));
    const free = (x, y) => f.deployable(x, y) && !f.unitAt(x, y) && f.terr(x, y) === F.PLAIN;
    let spot = null;
    for (let y = 2; y < f.height - 2 && !spot; y++) for (let x = 2; x < f.width - 3 && !spot; x++) if ([[x, y], [x + 1, y], [x, y + 1]].every(([cx, cy]) => free(cx, cy))) spot = [x, y];
    if (!spot) return false;
    [me.x, me.y] = spot; [foes[0].x, foes[0].y] = [spot[0] + 1, spot[1]];
    if (two) [foes[1].x, foes[1].y] = [spot[0], spot[1] + 1];
    if (castle) { const t = f.terr; f.terr = (x, y) => (x === foes[0].x && y === foes[0].y ? F.CASTLE : t.call(f, x, y)); }
    const top = w.probe().top;
    for (const u of f.alive) w.spriteOf(u)?.position.set(u.x - f.width / 2 + 0.5, top(u.x, u.y), u.y - f.height / 2 + 0.5);
    const r = f.r; window.__rolls = 0; f.r = (...a) => { window.__rolls++; return r(...a); };
    const atk = f.attack; window.__atk = 0; f.attack = function (...a) { window.__atk++; return atk.apply(this, a); };
    f.pool[f.human] = 30; w.clickCell(me.x, me.y); if (!w.flat) w.frame(me.x, me.y, 14);
    window.__k = { me, foe: foes[0], foe2: two ? foes[1] : null };
    return w.field.adjacentEnemies(me).includes(foes[0]);
  }, { two, castle });
  assert.ok(ok, 'an enemy beside the player\'s general');
  await page.waitForTimeout(600);
  await page.waitForFunction(() => window.__game.war.flat || window.__game.war.viewState().still, null, { timeout: 15000 }); // the 3D camera at rest, so a cell's place on screen holds
  return page;
}
const state = (page) => page.evaluate(() => { const w = window.__game.war, f = w?.field; return { atk: window.__atk, pool: f?.pool[f.human], strike: w?.st.strike?.t?.id ?? null, list: !!w?.st.atkList, rolls: window.__rolls, tq: !!document.querySelector('.tq'), screen: document.body.dataset.screen }; });
const cell = (page, who = 'foe') => page.evaluate((who) => { const w = window.__game.war, e = window.__k[who], c = w.screenOf(e.x, e.y); return { x: Math.round(c.x), y: Math.round(c.y - (w.flat ? 0 : c.ch * 0.15)), id: e.id }; }, who);
const clicks = async (page, c, n, gap = 0) => { await page.mouse.move(c.x, c.y); for (let i = 1; i <= n; i++) { if (i > 1 && gap) await page.waitForTimeout(gap); await page.mouse.down({ clickCount: i }); await page.mouse.up({ clickCount: i }); } };
// Through the 白兵 at once: the picker's pick deployed, the fight ended at its start, back on the war map.
async function through(page) {
  await page.locator('.tq-deploy:not(.arming)').click({ timeout: 60000 });
  await page.waitForSelector('.tq-start button:not(.arming)', { timeout: 30000 });
  await page.evaluate(() => { window.__tq.over ||= { why: 'time' }; });
  await page.locator('.tq-start button:not(.arming)').click();
  await page.locator('.tq-result .tq-btn', { hasText: '返回战场' }).click({ timeout: 60000 });
  await page.waitForFunction(() => document.body.dataset.screen === 'war' && !document.querySelector('.tq') && !window.__game.war.st.busy, null, { timeout: 60000 });
}

for (const [v, q] of [['flat', '&flat'], ['3D', '']]) test(`S01 / S10: a double or triple click on the enemy only asks, browsing draws nothing; a new click enters the 白兵 once (${v})`, async () => {
  const page = await war(q);
  const c = await cell(page);
  await clicks(page, c, 2); await page.waitForTimeout(500);
  let s = await state(page);
  assert.deepEqual([s.atk, s.pool, s.strike], [0, 30, c.id], `a double click asks: ${JSON.stringify(s)}`);
  assert.ok(await page.locator('.actpanel.strike').count(), 'the 攻击 confirmation stands in the panel');
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await clicks(page, c, 3); await page.waitForTimeout(400);
  s = await state(page); assert.deepEqual([s.atk, s.strike], [0, c.id], 'nor the later clicks of a triple click');
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await clicks(page, c, 2, 450); await page.waitForTimeout(400);
  s = await state(page); assert.deepEqual([s.atk, s.strike], [0, c.id], 'nor a slow double click (450 ms)');
  assert.deepEqual([s.pool, s.rolls], [30, 0], 'asking, going back and asking again spent and drew nothing');
  // The 攻击 command asks the same.
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await page.evaluate(() => { const w = window.__game.war, { me } = window.__k; w.clickCell(me.x, me.y); });
  await page.locator(CARD_ACTS, { hasText: '攻击' }).click(); await page.waitForTimeout(400);
  s = await state(page); assert.deepEqual([s.atk, s.strike], [0, c.id], 'the 攻击 command, with one enemy beside him, asks about him');
  // A new single click on him enters, once.
  await page.mouse.click(c.x, c.y);
  await page.waitForSelector('.tq-formation', { timeout: 60000 });
  s = await state(page); assert.deepEqual([s.atk, s.pool], [1, 28], 'one 白兵, 2 spent');
  await through(page);
  s = await state(page); assert.deepEqual([s.atk, s.strike, s.list], [1, null, false], 'back on the map with no question left over');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('S02 / S06: a held Enter runs through no step; the fight starts on a new press only, never on the deploy\'s clicks (flat)', async () => {
  const page = await war('&flat');
  const c = await cell(page);
  await page.mouse.click(c.x, c.y); await page.waitForTimeout(400);
  // Enter pressed on the confirmation enters; held, its repeats go on through the cut-in and over the formation picker.
  await page.keyboard.down('Enter');
  for (let i = 0; i < 80 && !(await page.locator('.tq-formation').count()); i++) { await page.waitForTimeout(80); await page.keyboard.down('Enter'); }
  await page.waitForSelector('.tq-form', { timeout: 60000 });
  const before = await page.evaluate(() => [...document.querySelectorAll('.tq-form')].findIndex((b) => b.classList.contains('on')));
  for (let i = 0; i < 12; i++) { await page.waitForTimeout(60); await page.keyboard.down('Enter'); }
  await page.keyboard.up('Enter'); await page.waitForTimeout(300);
  assert.equal(await page.locator('.tq-formation').count(), 1, 'the held Enter did not deploy');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.tq-form')].findIndex((b) => b.classList.contains('on'))), before, 'nor pick another');
  assert.equal((await state(page)).atk, 1, 'one 白兵');
  // Space held down from before 部署 (the focus off the cards, so it presses no button), and 部署 clicked over and over: the
  // clicks run on past the picker onto the opening pause, and the Space goes on repeating there. Neither starts the fight.
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.down(' ');
  const d = await page.locator('.tq-deploy').boundingBox();
  await page.waitForSelector('.tq-deploy:not(.arming)');
  for (let i = 0; i < 25; i++) { await page.mouse.click(d.x + d.width / 2, d.y + d.height / 2); await page.waitForTimeout(90); }
  await page.waitForSelector('.tq-start button', { timeout: 30000 });
  for (let i = 0; i < 10; i++) { await page.mouse.click(d.x + d.width / 2, d.y + d.height / 2); await page.keyboard.down(' '); await page.waitForTimeout(90); }
  await page.waitForTimeout(400);
  assert.ok(await page.locator('.tq-start').count(), 'neither the deploy\'s clicks nor the held Space started the fight');
  // Let go and pressed again, it starts.
  await page.keyboard.up(' '); await page.waitForTimeout(100);
  await page.keyboard.press(' ');
  assert.equal(await page.locator('.tq-start').count(), 0, 'a new Space started it');
  await page.evaluate(() => { window.__tq.over ||= { why: 'time' }; });
  await page.locator('.tq-result .tq-btn', { hasText: '返回战场' }).click({ timeout: 60000 });
  await page.waitForFunction(() => document.body.dataset.screen === 'war' && !document.querySelector('.tq') && !window.__game.war.st.busy, null, { timeout: 60000 });
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('S02 / S06: deployed from the keys alone; ▶ 继续 pressed while the 白兵战 开始 banner plays starts nothing; the opening pause still comes up (flat)', async () => {
  const page = await war('&flat');
  await page.evaluate(() => { const w = window.__game.war, e = window.__k.foe; w.clickCell(e.x, e.y); });
  await page.waitForSelector('.actpanel .ap-go:not(.arming)'); await page.locator('.actpanel .ap-go').click();
  // From the keys alone: the picked card has the focus; a new Enter on it deploys.
  await page.waitForSelector('.tq-deploy:not(.arming)', { timeout: 60000 });
  assert.ok(await page.evaluate(() => document.activeElement?.classList.contains('tq-form') && document.activeElement.classList.contains('on')), 'the picked card has the focus');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.tq-formation', { state: 'detached', timeout: 5000 });
  const go = page.locator('.tq-btn[data-pad="start"]:not(.primary)');
  await go.waitFor(); await page.waitForTimeout(400); // past the deploy's guard, the banner still up
  assert.equal(await page.locator('.tq-start').count(), 0, 'the banner is still up');
  await go.click(); // once: a second press would only pause it again
  await page.waitForSelector('.tq-start', { timeout: 15000 });
  await page.waitForTimeout(500);
  assert.ok(await page.locator('.tq-start').count(), 'the opening pause is still up: nothing started the fight');
  assert.match(await go.textContent(), /继续/, 'still paused');
  await page.evaluate(() => { window.__tq.over ||= { why: 'time' }; });
  await page.locator('.tq-start button:not(.arming)').click();
  await page.locator('.tq-result .tq-btn', { hasText: '返回战场' }).click({ timeout: 60000 });
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('S03 / S04: a press from before the question, let go after it, enters nothing; a burst of answers enters once, spends once (flat)', async () => {
  const page = await war('&flat');
  const c = await cell(page);
  await page.mouse.move(c.x, c.y); await page.mouse.down();
  await page.evaluate(() => { const w = window.__game.war, e = window.__k.foe; w.clickCell(e.x, e.y); }); // the question comes up under the held button
  await page.waitForTimeout(450); await page.mouse.up(); await page.waitForTimeout(300);
  let s = await state(page);
  assert.deepEqual([s.atk, s.strike], [0, c.id], `the release entered nothing: ${JSON.stringify(s)}`);
  // 进入白兵战, Enter and the enemy himself, over and over: one 白兵.
  const go = await page.locator('.actpanel .ap-go').boundingBox();
  for (let i = 0; i < 5; i++) { await page.mouse.click(go.x + go.width / 2, go.y + go.height / 2); await page.keyboard.press('Enter'); await page.mouse.click(c.x, c.y); }
  await page.waitForSelector('.tq-formation', { timeout: 60000 });
  s = await state(page); assert.deepEqual([s.atk, s.pool], [1, 28], `once: ${JSON.stringify(s)}`);
  // S09: the report closed with Enter, held a moment: back on the map, the day goes on, no question, no second 白兵.
  const day = await page.evaluate(() => [window.__game.war.field.day, window.__game.war.field.turn]);
  await page.locator('.tq-deploy:not(.arming)').click({ timeout: 60000 });
  await page.waitForSelector('.tq-start button:not(.arming)', { timeout: 30000 });
  await page.evaluate(() => { window.__tq.over ||= { why: 'time' }; });
  await page.locator('.tq-start button:not(.arming)').click();
  await page.locator('.tq-result .tq-btn', { hasText: '返回战场' }).waitFor({ timeout: 60000 }); await page.waitForTimeout(400);
  await page.locator('.tq-result .tq-btn', { hasText: '返回战场' }).focus();
  await page.keyboard.down('Enter');
  for (let i = 0; i < 10; i++) { await page.waitForTimeout(80); await page.keyboard.down('Enter'); }
  await page.keyboard.up('Enter');
  await page.waitForFunction(() => document.body.dataset.screen === 'war' && !document.querySelector('.tq') && !window.__game.war.st.busy, null, { timeout: 60000 });
  await page.waitForTimeout(500);
  s = await state(page);
  assert.deepEqual([s.atk, s.strike, s.list], [1, null, false], `no second 白兵, no question: ${JSON.stringify(s)}`);
  assert.deepEqual(await page.evaluate(() => [window.__game.war.field.day, window.__game.war.field.turn]), day, 'the Enter that closed the report did not end the day');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('S05: the picked formation is deployed, not one only pointed at; unpicked, the last one is (quick 白兵)', async () => {
  const page = await game.open();
  const fight = async (human) => {
    await page.evaluate((human) => { window.__qt = false; window.__game.debug.quickTactical(153, 191, 2, { human }).then(() => { window.__qt = true; }); }, human);
    await page.waitForSelector('.tq-form', { timeout: 60000 }); await page.waitForTimeout(400);
  };
  const done = async () => {
    await page.waitForSelector('.tq-start button:not(.arming)', { timeout: 30000 });
    await page.evaluate(() => { window.__tq.over ||= { why: 'time' }; }); await page.locator('.tq-start button:not(.arming)').click();
    await page.locator('.tq-result .tq-btn', { hasText: '返回战场' }).click({ timeout: 60000 });
    await page.waitForFunction(() => window.__qt, null, { timeout: 30000 });
  };
  const formed = () => page.evaluate(() => window.__tq.side.a.formation);
  await fight('a');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.tq-form')].findIndex((b) => b.classList.contains('on'))), 0, '长蛇 the first time');
  assert.match(await page.locator('.tq-deploy').textContent(), /部署长蛇阵/);
  await page.locator('.tq-form').nth(2).click(); // 锥行 picked
  await page.locator('.tq-form').nth(3).hover(); // 鱼鳞 pointed at
  assert.match(await page.locator('.tq-peeknote').textContent(), /预览：鱼鳞/, 'the preview is told apart from the pick');
  assert.match(await page.locator('.tq-deploy').textContent(), /部署锥行阵/, 'the button names the picked one');
  await page.locator('.tq-deploy:not(.arming)').click();
  await page.waitForSelector('.tq-start button', { timeout: 30000 });
  assert.equal(await formed(), 2, '锥行 deployed, not the one pointed at');
  await done();
  // The next 白兵 opens on 锥行, picked; 部署 alone deploys it.
  await fight('a');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.tq-form')].findIndex((b) => b.classList.contains('on'))), 2, 'the last one picked');
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('tq-form') && document.activeElement.classList.contains('on')), true, 'the focus on it, not on 部署');
  await page.mouse.move(5, 5);
  await page.locator('.tq-deploy:not(.arming)').click();
  await page.waitForSelector('.tq-start button', { timeout: 30000 });
  assert.equal(await formed(), 2);
  await done();
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('S07 / S11: defending a castle there is no formation to pick and the pause says why; no step offers a way back from the 白兵', async () => {
  const page = await game.open();
  await page.evaluate(() => { window.__game.debug.quickTactical(153, 191, 5, { human: 'd' }); });
  await page.waitForSelector('.tq-start button', { timeout: 60000 });
  assert.equal(await page.locator('.tq-formation').count(), 0, 'no picker in a castle');
  assert.match(await page.locator('.tq-start').textContent(), /守城，用城池阵/);
  assert.equal(await page.locator('.tq-start .tq-btn').count(), 1, 'the pause has 开始交战 only');
  await page.context().close();
  // Defending on open ground the picker comes up as ever, with no way back either.
  const p2 = await game.open();
  await p2.evaluate(() => { window.__game.debug.quickTactical(153, 191, 2, { human: 'd' }); });
  await p2.waitForSelector('.tq-form', { timeout: 60000 });
  assert.deepEqual(await p2.locator('.tq-formation button').evaluateAll((l) => l.map((b) => b.className.split(' ')[0])).then((l) => [...new Set(l)].sort()), ['tq-btn', 'tq-form'], 'cards and 部署 only');
  assert.deepEqual(p2.errors, []);
  await p2.context().close();
});

test('S11 / S12: at 1024×600 in 3D, a 总大将 in a castle — every line that decides it is shown, and 进入白兵战 whole', async () => {
  const page = await war('', { castle: true, size: { width: 1024, height: 600 } });
  await page.evaluate(() => { window.__k.foe.commander = true; });
  await page.locator(CARD_ACTS, { hasText: '攻击' }).click();
  await page.waitForSelector('.actpanel.strike'); await page.waitForTimeout(400); // one beside him: 攻击 asks about him at once
  const shown = await page.locator('.actpanel.strike .ap-sum').innerText(); // innerText leaves out what CSS hides
  for (const re of [/白兵地形：城；\S+在城内，守方用城池阵/, /敌总大将：白兵中斩杀或俘获他即结束战争/, /消耗 2，全军余 28/, /开战后不能撤回/]) assert.match(shown, re, shown);
  const box = await page.locator('.actpanel .ap-go').boundingBox(), vp = page.viewportSize();
  assert.ok(box && box.y >= 0 && box.x >= 0 && box.y + box.height <= vp.height && box.x + box.width <= vp.width, `进入白兵战 inside the window: ${JSON.stringify(box)}`);
  const clipped = await page.evaluate(() => { const b = document.querySelector('.actpanel .ap-go'), r = b.getBoundingClientRect(), top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !b.contains(top); });
  assert.equal(clipped, false, '进入白兵战 is not covered');
  await page.screenshot({ path: fileURLToPath(new URL('../docs/review-assets/2026-11-11/d32-phase2/test-1024x600-3d-commander-castle.png', import.meta.url)) }).catch(() => {}); // beside the test, from any cwd
  assert.deepEqual(page.errors, []);
  await page.context().close();
});
test('S11 / S12 / U05: the confirmation tells the ground, a castle he holds and their 总大将; two beside him are told apart (flat)', async () => {
  const page = await war('&flat', { two: true, castle: true });
  await page.locator(CARD_ACTS, { hasText: '攻击' }).click();
  await page.waitForSelector('.actpanel.attacks');
  const rows = await page.locator('.actpanel.attacks [data-target]').evaluateAll((l) => l.map((b) => Number(b.dataset.target)));
  const k = await page.evaluate(() => ({ foe: window.__k.foe.id, foe2: window.__k.foe2.id }));
  assert.deepEqual(rows.sort(), [k.foe, k.foe2].sort(), 'the two beside him are listed');
  let s = await state(page); assert.deepEqual([s.atk, s.strike, s.list], [0, null, true], 'the list asks nothing yet');
  await page.locator(`.actpanel [data-target="${k.foe}"]`).click(); await page.waitForTimeout(300);
  const text = await page.locator('.actpanel.strike .ap-sum').textContent();
  assert.match(text, /白兵地形：城；\S+在城内，守方用城池阵，你方照常选阵/);
  // Back to the list (it was opened from there), then the other one, a 总大将 for the test.
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  s = await state(page); assert.deepEqual([s.strike, s.list], [null, true], 'Esc goes back to the list');
  await page.evaluate(() => { window.__k.foe2.commander = true; });
  await page.locator(`.actpanel [data-target="${k.foe2}"]`).click(); await page.waitForTimeout(300);
  const t2 = await page.locator('.actpanel.strike .ap-sum').textContent();
  assert.match(t2, /敌总大将：白兵中斩杀或俘获他即结束战争（他撤出且生还则战争继续）/);
  assert.doesNotMatch(t2, /在城内/);
  assert.match(t2, /消耗 2，全军余 28（还够攻击 14 次）/);
  // He walks off before the answer: refused, nothing spent, no one else struck.
  await page.evaluate(() => { window.__k.foe2.commander = false; const e = window.__k.foe2, f = window.__game.war.field; e.y += 3; while (f.unitAt(e.x, e.y) && f.unitAt(e.x, e.y) !== e) e.x++; });
  await page.waitForTimeout(350);
  await page.locator('.actpanel .ap-go').click({ force: true }); await page.waitForTimeout(400);
  s = await state(page); assert.deepEqual([s.atk, s.pool, s.rolls], [0, 30, 0], `refused: ${JSON.stringify(s)}`);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});
