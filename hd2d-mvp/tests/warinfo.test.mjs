// What the war map tells before a decision (第 3 期, docs/战场3D重构与操作优化方案_2026-11-13.md §7): the enemy's threat range, what a
// destination would mean, the next general from the keys, and a general picked by his name tag. All of it is display: the
// first cases hold that the forecast is the rules' own answer and that asking for it changes nothing.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, newCampaign, closeMessages, warRest } from './game.mjs';

let game;
after(async () => { await game?.close(); });

// I02 / I01, on the rules alone: on all 30 battlefields, with the player attacking and defending, the cells field.threat names on
// the player's turn are the cells the enemy's generals can strike once the turn has really passed to him (the pool he then
// holds, less an attack), and working it out leaves the field and the game as they were, with no random number drawn.
test('the threat forecast is what the enemy can strike when the turn passes, on every battlefield, attacking and defending', async () => {
  game ??= await startGame(); const p = await game.open();
  try {
    await newCampaign(p);
    const out = await p.evaluate(async () => {
      const { Field, ATTACK_COST } = await import('./src/core/field.js'), { g: g0, debug } = window.__game, bad = [], DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];
      let n = 0, cells = 0, draws = 0; const rand = Math.random; Math.random = () => { draws++; return rand(); };
      try {
        for (let k = 0; k < 30; k++) for (const human of ['att', 'def']) {
          const g = structuredClone(g0), cs = g.cities, to = cs[k];
          const from = cs.findIndex((c, i) => i !== k && c.officers.length > 2 && c.faction !== to.faction && c.faction !== 0);
          if (!to.officers.length) { const donor = cs.find((c, i) => i !== k && i !== from && c.officers.length > 1 && c.faction !== cs[from].faction && c.faction !== 0); to.faction = donor.faction; to.officers = donor.officers.splice(0, 2); }
          const ids = cs[from].officers.slice(0, 3); for (const id of [...ids, ...to.officers]) g.officers[id].soldiers ||= 500 + 300 * (id % 4);
          const f = new Field(g, debug.setupWar(g, { from, to: k, ids, commander: ids[0], gold: 0, rice: Math.min(cs[from].rice, 600) }), human), foe = human === 'att' ? 'def' : 'att';
          if (human === 'def') f.endTurn(); // the attacker's first turn passes: now it is the player's
          f.pool.att = 3 + (k % 9); f.pool.def = 2 + ((k * 5) % 11); // pools that differ, some too low to strike at all
          const held = f.side(foe)[0]; if (k % 3 === 0 && held) held.stop = 1 + (k % 2); // one of his held by 虚兵: free again or not when the day turns
          const before = JSON.stringify([f.snapshot(), g]), d0 = draws;
          const T = [...f.threat(foe)].sort(), one = [...f.threat(foe, f.side(foe).at(-1))];
          if (JSON.stringify([f.snapshot(), g]) !== before || draws !== d0) bad.push(`${k} ${human}: asking changed the field or drew a random number`);
          if (!one.every((c) => T.includes(c))) bad.push(`${k} ${human}: one general's threat is not within the side's`);
          f.endTurn();
          if (f.over) continue;
          const real = new Set(), budget = f.pool[foe] - ATTACK_COST;
          if (budget >= 0) for (const u of f.side(foe)) for (const key of f.reach(u, budget).dist.keys()) { const [x, y] = key.split(',').map(Number); for (const [dx, dy] of DIRS) if (f.inside(x + dx, y + dy)) real.add(`${x + dx},${y + dy}`); }
          const R = [...real].sort(); n++; cells += R.length;
          if (JSON.stringify(R) !== JSON.stringify(T)) bad.push(`${k} ${human}: forecast ${T.length} cells, real ${R.length} (turn ${f.turn}, pool ${f.pool[foe]})`);
        }
      } finally { Math.random = rand; }
      return { n, cells, bad };
    });
    assert.deepEqual(out.bad, []);
    assert.ok(out.n >= 55 && out.cells > 1000, `judged ${out.n} wars, ${out.cells} threatened cells`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

async function openWar(view) {
  game ??= await startGame(); const p = await game.open();
  await p.evaluate(async (view) => { (await import('./src/quality.js')).warView.set(view); (await import('./src/pace.js')).setPace(4); }, view);
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
    await p.waitForTimeout(2500); await p.evaluate(() => window.__game.war.st.deploying && window.__game.war.finishDeploy());
    await p.waitForFunction(() => { const w = window.__game.war, f = w?.field; return f && f.turn === f.human && !w.st.busy && !w.st.deploying && !document.querySelector('.banner, .panel.msg, .shade, #fade.on'); }, null, { timeout: 60000 });
  } finally { stop(); }
  return p;
}
const idle = (p) => p.waitForFunction(() => { const w = window.__game.war; return !w.st.busy && !document.querySelector('.banner, .panel.msg'); }, null, { timeout: 30000 });

for (const view of ['3d', 'flat']) test(`${view}: the threat view shows the forecast and changes nothing; the landing preview and the keys`, async () => {
  const p = await openWar(view);
  try {
    // I01 / I05: on and off, with the pointer crossing cells, the field is as it was and no random number is drawn.
    const th = await p.evaluate(() => {
      const w = window.__game.war, f = w.field, foe = f.human === 'att' ? 'def' : 'att', before = JSON.stringify(f.snapshot()); let draws = 0; const rand = Math.random; Math.random = () => { draws++; return rand(); };
      const seen = {};
      try {
        w.setThreatView(true); w.update(0.016); seen.all = w.flatState().threat.map((c) => `${c.x},${c.y}`).sort();
        const e = f.side(foe)[0]; w.hoverCell({ x: e.x, y: e.y }); w.update(0.016); seen.one = w.flatState().threat.map((c) => `${c.x},${c.y}`).sort(); seen.wantOne = [...f.threat(foe, e)].sort();
        for (let i = 0; i < 12; i++) { w.hoverCell({ x: (i * 5) % 32, y: (i * 3) % 19 }); w.update(0.016); }
        w.hoverCell(null); w.setThreatView(false); w.update(0.016); seen.off = w.flatState().threat.length;
      } finally { Math.random = rand; }
      return { ...seen, want: [...f.threat(foe)].sort(), same: JSON.stringify(f.snapshot()) === before, draws };
    });
    assert.deepEqual(th.all, th.want, 'the view shows field.threat for the enemy');
    assert.ok(th.all.length > 0);
    assert.deepEqual(th.one, th.wantOne, 'with the pointer on an enemy, his alone');
    assert.equal(th.off, 0, 'put away, nothing of it stays');
    assert.equal(th.same, true, 'the field is as it was');
    assert.equal(th.draws, 0, 'no random number was drawn');
    // R held shows it, let go puts it away (the 威胁 button pins it).
    await p.keyboard.down('r'); await p.waitForFunction(() => window.__game.war.flatState().threat.length > 0, null, { timeout: 5000 });
    await p.keyboard.up('r'); await p.waitForFunction(() => window.__game.war.flatState().threat.length === 0, null, { timeout: 5000 });
    if (view === '3d') { // the 威 button beside the turn pair pins it (the flat map has no pair: R alone)
      await p.locator('.wardock .threatbtn').click(); await p.waitForFunction(() => window.__game.war.flatState().threat.length > 0, null, { timeout: 5000 });
      assert.equal(await p.locator('.wardock .threatbtn').getAttribute('aria-pressed'), 'true');
      await p.locator('.wardock .threatbtn').click(); await p.waitForFunction(() => window.__game.war.flatState().threat.length === 0, null, { timeout: 5000 });
    }
    // I04: ] and [ pick the next and the previous of ours, in the pad's order; while a 计略's target is being chosen they do nothing.
    const order = await p.evaluate(() => { const w = window.__game.war, f = w.field; w.cancel(); const mine = f.alive.filter((u) => u.side === f.human); w.clickCell(mine[0].x, mine[0].y); return mine.map((u) => u.id); });
    await p.keyboard.press(']'); await p.waitForFunction((id) => window.__game.war.st.sel?.id === id, order[1], { timeout: 5000 });
    await p.keyboard.press('['); await p.waitForFunction((id) => window.__game.war.st.sel?.id === id, order[0], { timeout: 5000 });
    await p.keyboard.press('['); await p.waitForFunction((id) => window.__game.war.st.sel?.id === id, order.at(-1), { timeout: 5000 });
    const scenario = await p.evaluate(async () => {
      const { PLAIN, W, H } = await import('./src/core/field.js'), w = window.__game.war, f = w.field;
      const me = f.side(f.human).find(u => !u.commander) ?? f.side(f.human)[0], foe = f.alive.find(u => u.side !== f.human);
      // 开局可能选到多层攻城地图。在同一段空旷平地验证施计与行军预览，不依赖两军随机布阵。
      const free = (x, y) => !f.unitAt(x, y) && f.terr(x, y) === PLAIN;
      for (let y = 0; y < H; y++) for (let x = 0; x < W - 2; x++) {
        if (![x, x + 1, x + 2].every(col => free(col, y))) continue;
        for (const [u, col] of [[me, x], [foe, x + 2]]) {
          Object.assign(u, { x: col, y });
          w.spriteOf(u)?.position.set(col - W / 2 + 0.5, w.probe().top(col, y), y - H / 2 + 0.5);
        }
        f.O(me.id).int = Math.max(f.O(me.id).int, 80);
        f.pool[f.human] = 40;
        w.cancel(); w.clickCell(me.x, me.y); w.chooseStrategy(0);
        return { caster: me.id, target: foe.id, landing: [x + 1, y], stage: w.st.stage };
      }
      throw new Error('战场没有可用于计略和行军测试的连续平地');
    });
    await p.locator(`.actpanel.targets [data-target="${scenario.target}"]`).waitFor();
    await p.keyboard.press(']'); await p.waitForTimeout(300);
    assert.deepEqual(await p.evaluate(() => { const w = window.__game.war; return { id: w.st.sel?.id, stage: w.st.stage }; }), { id: scenario.caster, stage: scenario.stage }, 'the keys leave a target choice alone');
    await p.evaluate(() => { const w = window.__game.war; for (let i = 0; i < 6 && w.cancel(); i++); });
    // I03: the preview names whom he could strike from a cell; walked there, those are the enemies beside him.
    const stop = closeMessages(p);
    try {
      const pre = await p.evaluate(({ caster, landing: [x, y] }) => {
        const w = window.__game.war, f = w.field, me = f.alive.find(u => u.id === caster);
        w.clickCell(me.x, me.y);
        const cost = w.st.reach.dist.get(`${x},${y}`);
        const tip = w.hoverCell({ x, y }).tip, left = f.pool[f.human] - cost;
        w.clickCell(x, y);
        return { cost, tip, left };
      }, scenario);
      assert.ok(pre.cost > 0, 'a cell of his reach beside an enemy');
      await idle(p);
      const post = await p.evaluate((id) => { const f = window.__game.war.field, me = f.alive.find(u => u.id === id); return { at: [me.x, me.y], foes: f.adjacentEnemies(me).map(e => e.id), pool: f.pool[f.human] }; }, scenario.caster);
      assert.deepEqual(post.at, scenario.landing); assert.equal(post.pool, pre.left, 'the pool left is what the preview said');
      assert.ok(post.foes.includes(scenario.target));
      const names = await p.evaluate(async (ids) => { const { name } = await import('./src/core/game.js'); return ids.map((i) => name(i)); }, post.foes);
      assert.match(pre.tip, /到此可攻击/); for (const nm of names) assert.ok(pre.tip.includes(nm), `the preview named ${nm}: ${pre.tip}`);
      assert.match(pre.tip, pre.left >= 2 ? new RegExp(`够攻击 ${Math.floor(pre.left / 2)} 次`) : /不够攻击/);
    } finally { stop(); }
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

// I06 / I08 and the ground view's costs, on the 3D board: a general is picked by his name tag, through the map click's own entry
// (an enemy beside ours is asked about, never struck, by one click or by two), and T writes each reach cell's step cost.
test('3D: a name tag is its general; a double click on an enemy\'s only asks; T tells what each cell of the reach costs', async () => {
  const p = await openWar('3d');
  try {
    await p.evaluate(() => { const w = window.__game.war; w.cancel(); w.zoom(-100); }); await warRest(p); await p.waitForTimeout(400);
    const tagOf = (id) => p.evaluate((id) => { const w = window.__game.war, u = w.field.units.find((x) => x.id === id), s = w.screenOf(u.x, u.y); let best = null, bd = Infinity;
      for (const el of document.querySelectorAll('.tag')) { const r = el.getBoundingClientRect(); if (!r.width) continue; const d = Math.hypot(r.left + r.width / 2 - s.x, r.bottom - (s.y - s.rise * 1.3)); if (d < bd && el.textContent.includes(window.__names[id])) { bd = d; best = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; } } return best; }, id);
    const who = await p.evaluate(async () => { const { name } = await import('./src/core/game.js'); const w = window.__game.war, f = w.field; window.__names = Object.fromEntries(f.units.map((u) => [u.id, name(u.id)])); const mine = f.alive.filter((u) => u.side === f.human); return { a: mine[0].id, b: mine.at(-1).id }; });
    for (const id of [who.b, who.a]) {
      await p.evaluate((id) => { const w = window.__game.war, u = w.field.units.find((x) => x.id === id); w.centreOn(u.x, u.y); }, id); await warRest(p); await p.waitForTimeout(300);
      const at = await tagOf(id); assert.ok(at, `the tag of ${id} is on screen`);
      const hov = await p.evaluate(({ x, y }) => { const c = window.__game.war.hover({ x: x / innerWidth * 2 - 1, y: 1 - y / innerHeight * 2 }); return c && { x: c.x, y: c.y, tag: !!c.tag }; }, at);
      const u = await p.evaluate((id) => { const u = window.__game.war.field.units.find((x) => x.id === id); return { x: u.x, y: u.y, tag: true }; }, id);
      assert.deepEqual(hov, u, 'pointing at his tag is pointing at him');
      await p.mouse.click(at.x, at.y); await p.waitForFunction((id) => window.__game.war.st.sel?.id === id, id, { timeout: 5000 });
    }
    // An enemy beside one of ours: a click on his tag asks (the 攻击 confirmation); a double click does no more.
    const stop = closeMessages(p);
    try {
      const foe = await p.evaluate(() => {
        const w = window.__game.war, f = w.field, me = f.alive.find((u) => u.side === f.human && !u.commander) ?? f.side(f.human)[0]; window.__me = me;
        for (const pool of [20, 40, 80]) { f.pool[f.human] = pool; w.cancel(); w.clickCell(me.x, me.y);
          const hit = [...w.st.reach.dist.keys()].map((k) => k.split(',').map(Number)).find(([x, y]) => (x !== me.x || y !== me.y) && f.adjacentEnemies({ ...me, x, y }).length);
          if (hit) { w.clickCell(hit[0], hit[1]); return f.adjacentEnemies({ ...me, x: hit[0], y: hit[1] })[0].id; } }
        return null;
      });
      assert.ok(foe != null); await idle(p);
      await p.evaluate(() => { const w = window.__game.war, f = w.field, me = window.__me; f.pool[f.human] = 20; w.cancel(); w.clickCell(me.x, me.y); w.centreOn(me.x, me.y); }); await warRest(p); await p.waitForTimeout(400);
      const before = await p.evaluate(() => JSON.stringify(window.__game.war.field.snapshot()));
      const at = await tagOf(foe); assert.ok(at, 'the enemy\'s tag is on screen');
      await p.mouse.dblclick(at.x, at.y); await p.waitForTimeout(700);
      const st = await p.evaluate(() => { const w = window.__game.war; return { stage: w.st.stage, busy: w.st.busy, same: null }; });
      assert.equal(await p.evaluate((b) => JSON.stringify(window.__game.war.field.snapshot()) === b, before), true, 'two clicks on an enemy\'s tag fought nothing');
      assert.equal(st.busy, false); assert.equal(st.stage, 'strike', 'they opened the 攻击 confirmation');
      await p.evaluate(() => { const w = window.__game.war; for (let i = 0; i < 6 && w.cancel(); i++); });
    } finally { stop(); }
    // T: every cell of his reach but the ones that already carry a terrain plaque says its step cost.
    const costs = await p.evaluate(() => { const w = window.__game.war, f = w.field, me = window.__me; f.pool[f.human] = 12; w.cancel(); w.clickCell(me.x, me.y); w.setTerrainView(true); w.update(0.016);
      const keys = w.probe().grounds, c = keys.filter((k) => k.startsWith('c:')), plain = new Set(keys.filter((k) => !k.startsWith('c:')));
      const want = [...w.st.reach.dist.keys()].filter((k) => k !== `${me.x},${me.y}` && !plain.has(k)).length;
      const sample = c[0]?.split(':')[1].split(',').map(Number), text = sample && [...document.querySelectorAll('.gcost')].length;
      const out = { n: c.length, want, cost: sample ? f.cost(me, sample[0], sample[1]) : null, text }; w.setTerrainView(false); w.update(0.016); return { ...out, left: w.probe().grounds.length }; });
    assert.ok(costs.want > 0); assert.equal(costs.n, costs.want, 'a cost on each cell of the reach');
    assert.equal(costs.left, 0, 'and none left when T is let go');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
