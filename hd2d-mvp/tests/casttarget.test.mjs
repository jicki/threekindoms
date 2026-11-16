// Choosing a 计略's target (feedback of 2026-11-09, 张沐镕@bilibili: at 全景 a target was a 28×20 px cell under a 30 px
// figure, five of them in 120 px). Once a 计略 is chosen the 3D camera frames the caster and every legal target, and
// gives the view back when the choice is over; and the targets are listed beside the caster, flat or 3D, so one can be
// taken by name without picking it on the map at all.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, newCampaign, closeMessages } from './game.mjs';

let game;
// A war on the player's turn with the enemy in a knot the player's best mind can 火计, the camera at the opening 全景.
async function knot(query = '') {
  const page = await game.open(query);
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
  const ok = await page.evaluate(async () => {
    const F = await import('./src/core/field.js'), w = window.__game.war, f = w.field;
    const me = f.alive.filter((u) => u.side === f.human).sort((a, b) => f.O(b.id).int - f.O(a.id).int)[0], foes = f.alive.filter((u) => u.side !== f.human);
    const free = (x, y) => { if (!f.inside(x, y) || f.unitAt(x, y) || Math.max(Math.abs(x - me.x), Math.abs(y - me.y)) < 2) return false; const e = foes[0], [hx, hy] = [e.x, e.y]; e.x = x; e.y = y; const r = f.legal(me, 0, e); e.x = hx; e.y = hy; return r; };
    let cells = null;
    for (let y = 0; y < F.H && !cells; y++) for (let x = 0; x < F.W && !cells; x++) {
      const c = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1], [x + 2, y], [x + 2, y + 1]].slice(0, foes.length);
      if (c.every(([cx, cy]) => free(cx, cy))) cells = c;
    }
    if (!cells) return false;
    foes.slice(0, cells.length).forEach((e, i) => { [e.x, e.y] = cells[i]; });
    const top = w.probe().top;
    for (const u of f.alive) w.spriteOf(u)?.position.set(u.x - F.W / 2 + 0.5, top(u.x, u.y), u.y - F.H / 2 + 0.5);
    f.pool[f.human] = 30; w.clickCell(me.x, me.y);
    window.__k = { me, n: foes.filter((e) => f.legal(me, 0, e)).length };
    return true;
  });
  assert.ok(ok, 'a knot of 火计 targets near the player\'s general');
  await page.waitForTimeout(600);
  return page;
}
// Every legal target of the 计略 in hand: its cell on screen (px) and whether it lies in the clear of the window.
const targets = (page) => page.evaluate(() => {
  const w = window.__game.war, f = w.field, st = w.st;
  return f.alive.filter((e) => e.side !== f.human && f.legal(st.sel, st.cast, e)).map((e) => { const c = w.screenOf(e.x, e.y); const l = document.querySelector('.actpanel')?.getBoundingClientRect().right ?? 0; return { id: e.id, cw: c.cw, on: c.x - c.cw / 2 > l && c.x < innerWidth - 20 && c.y > 60 && c.y < innerHeight - 20 }; });
});
const pose = (page) => page.evaluate(() => { const p = window.__game.war.probe(), v = p.view; return { zoom: v.zoom, atFit: v.atFit, dist: v.dist, target: v.target, fit: p.fitDist() }; });

before(async () => { game = await startGame(); });
after(() => game?.close());

test('3D: choosing a 计略 at 全景 brings its targets up to a size that can be clicked, and leaving the choice gives the view back', async () => {
  const page = await knot();
  const before = await pose(page);
  assert.equal(before.zoom, 'whole', 'the war opens at 全景');
  await page.evaluate(() => window.__game.war.chooseStrategy(0));
  await page.waitForTimeout(1500);
  const ts = await targets(page);
  assert.ok(ts.length >= 3, `the knot is in reach: ${ts.length}`);
  for (const t of ts) { assert.ok(t.on, `target ${t.id} is on the screen, clear of the list`); assert.ok(t.cw >= 60, `target ${t.id}'s cell is ${t.cw.toFixed(0)} px wide (≥ 60)`); }
  const me = await page.evaluate(() => { const w = window.__game.war, c = w.screenOf(w.st.sel.x, w.st.sel.y); return c.x > 20 && c.x < innerWidth - 20 && c.y > 60 && c.y < innerHeight - 20; });
  assert.ok(me, 'the caster is on the screen too');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  const back = await pose(page);
  assert.equal(await page.evaluate(() => window.__game.war.st.cast), null, 'Esc left the choice');
  assert.equal(back.zoom, 'whole'); assert.ok(back.atFit, '全景 again');
  assert.ok(Math.abs(back.dist - back.fit) < 0.5, `at 全景's own distance: ${back.dist.toFixed(1)} vs ${back.fit.toFixed(1)}`);
  assert.ok(!(await page.locator('.unitpanel.compare').count()), 'no target\'s card is left up');
  await page.context().close();
});

test('3D: a view the player moved while choosing is kept', async () => {
  const page = await knot();
  await page.evaluate(() => window.__game.war.chooseStrategy(0));
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.__game.war.pan(2, 0));
  await page.waitForTimeout(600);
  const mine = await pose(page);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
  const kept = await pose(page);
  assert.ok(!kept.atFit && Math.abs(kept.dist - mine.dist) < 0.5 && Math.abs(kept.target[0] - mine.target[0]) < 0.1, `the player's own view stays: ${JSON.stringify(kept)}`);
  await page.context().close();
});

for (const [view, query] of [['3D', ''], ['flat', '&flat']]) {
  test(`${view}: the 计略's targets are listed by name with their odds, and one is taken from the list`, async () => {
    const page = await knot(query);
    assert.equal(await page.locator('.actpanel [data-target]').count(), 0, 'no list before a 计略 is chosen');
    await page.evaluate(() => window.__game.war.chooseStrategy(0));
    await page.locator('.actpanel [data-target]').first().waitFor();
    await page.waitForTimeout(view === '3D' ? 1500 : 300);
    const choosing = await page.evaluate(() => ({ id: window.__game.war.st.sel?.id, stage: window.__game.war.st.stage }));
    await page.keyboard.press(']');
    assert.deepEqual(await page.evaluate(() => ({ id: window.__game.war.st.sel?.id, stage: window.__game.war.st.stage })), choosing,
      '快捷键不会在选择计略目标时切换武将');
    const rows = await page.evaluate(() => {
      const w = window.__game.war, f = w.field, G = window.__game.G;
      return { rows: [...document.querySelectorAll('.actpanel [data-target]')].map((b) => ({ id: Number(b.dataset.target), text: b.textContent, shown: b.getClientRects().length > 0 })),
        want: f.alive.filter((e) => e.side !== f.human && f.legal(w.st.sel, 0, e)).map((e) => ({ id: e.id, name: G.name(e.id), p: f.odds(w.st.sel, 0, e) })),
        head: document.querySelector('.actpanel [data-target]')?.closest('.ap-body').getAttribute('aria-label'), acts: [...document.querySelectorAll('.unitpanel:not(.compare) .acts button')].map((b) => b.textContent) };
    });
    assert.equal(rows.rows.length, rows.want.length, 'one row for each legal target');
    assert.match(rows.head, /火计/, 'the list names its 计略');
    for (const t of rows.want) {
      const r = rows.rows.find((x) => x.id === t.id);
      assert.ok(r?.shown && r.text.includes(t.name) && r.text.includes(`${t.p}%`), `${t.name} with ${t.p}%: ${r?.text}`);
    }
    assert.ok(!rows.acts.includes('计略') && !rows.acts.includes('退却'), `the list stands in for his commands while a target is chosen: ${rows.acts}`);
    // Pointing at a row shows who it is on the map (the cell under the cursor, his card on the right).
    const pick = rows.want[rows.want.length - 1];
    await page.locator(`.actpanel [data-target="${pick.id}"]`).hover();
    const hov = await page.evaluate((id) => { const w = window.__game.war, e = w.field.alive.find((u) => u.id === id), h = w.st.hoverCell; return { on: !!h && h.x === e.x && h.y === e.y, card: document.querySelector('.unitpanel.compare h3')?.textContent ?? '' }; }, pick.id);
    assert.ok(hov.on && hov.card.includes(pick.name), `the row points at ${pick.name}: ${JSON.stringify(hov)}`);
    await page.locator(`.actpanel [data-target="${pick.id}"]`).click();
    const ask = page.locator('.actpanel.confirm'); await ask.waitFor();
    const said = await ask.locator('.ap-who').textContent();
    assert.ok(said.includes('火计') && said.includes(pick.name), `the row asks to cast on its target: ${said}`);
    assert.equal(await page.locator(`.actpanel [data-target="${pick.id}"]`).getAttribute('aria-pressed'), 'true', 'its row is marked');
    assert.equal(await page.evaluate(() => window.__game.war.field.pool[window.__game.war.field.human]), 30, 'picking spent nothing');
    await page.locator('.actpanel .ap-back').click();
    await page.locator('.actpanel.targets [data-target]').first().waitFor();
    assert.equal(await page.evaluate(() => window.__game.war.st.cast), 0, '返回 comes back to the choice, the list still up');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset?.target), String(pick.id), 'on the same target');
    // Enter never ends the day in the middle of a choice.
    const day = () => page.evaluate(() => { const f = window.__game.war.field; return `${f.day}/${f.turn}`; });
    const d0 = await day();
    await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
    if (await page.locator('.shade').count()) await page.keyboard.press('Escape');
    assert.equal(await day(), d0, 'Enter does not end the day while a target is being chosen');
    assert.equal(await page.evaluate(() => window.__game.war.field.pool[window.__game.war.field.human]), 30, 'nothing was spent');
    await page.locator('.actpanel .ap-back').click();
    await page.waitForTimeout(300);
    const list = await page.evaluate(() => ({ cast: window.__game.war.st.cast, strats: !!document.querySelector('.actpanel.strats'), focus: document.activeElement?.dataset?.sid }));
    assert.deepEqual(list, { cast: null, strats: true, focus: '0' }, '返回 comes back to the 计略 list, on 火计');
    await page.locator('.actpanel .ap-back').click();
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => ({ cast: window.__game.war.st.cast, list: !!document.querySelector('.actpanel'), acts: [...document.querySelectorAll('.unitpanel:not(.compare) .acts button')].map((b) => b.textContent) }));
    assert.equal(after.cast, null); assert.ok(!after.list, 'the panel goes with the choice'); assert.ok(after.acts.includes('计略'), 'his commands are back');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
}

test('3D: the list takes a target with the keys alone', async () => {
  const page = await knot();
  await page.evaluate(() => window.__game.war.chooseStrategy(0));
  await page.locator('.actpanel [data-target]').first().waitFor(); await page.waitForTimeout(300);
  const first = await page.evaluate(() => ({ focus: document.activeElement?.dataset?.target ?? null, top: document.querySelector('.actpanel [data-target]')?.dataset.target }));
  assert.equal(first.focus, first.top, 'the first target has the focus');
  await page.keyboard.press('ArrowDown');
  const second = await page.evaluate(() => ({ focus: document.activeElement?.dataset?.target, want: document.querySelectorAll('.actpanel [data-target]')[1]?.dataset.target, name: window.__game.G.name(Number(document.activeElement?.dataset?.target)) }));
  assert.equal(second.focus, second.want, '↓ walks to the next');
  await page.keyboard.press('Enter');
  const ask = page.locator('.actpanel.confirm .ap-who'); await ask.waitFor();
  assert.ok((await ask.textContent()).includes(second.name), 'Enter asks about the focused target');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset?.target), second.want, 'the focus stays on the target, not on 施展');
  await page.waitForTimeout(400); await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__game.war.st.busy || window.__game.war.field.pool[window.__game.war.field.human] < 30, null, { timeout: 5000 });
  assert.ok(true, 'a new Enter casts');
  await page.context().close();
});
