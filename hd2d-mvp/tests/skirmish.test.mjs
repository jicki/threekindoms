// 白兵 screen: the player's card stands over the player's own troops whichever side they fight on (the bug
// that shipped from 2026-10-24 to 2026-10-29 because every check fought as the attacker), and the round pace
// the speed buttons give.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startGame, near } from './game.mjs';

let game;
before(async () => { game = await startGame(); });
after(() => game?.close());

// Opens 张飞 (153) vs 文丑 (191) on open ground with the player on `human`, past the formation picker.
async function open(human) {
  const page = await game.open();
  await page.evaluate((human) => { window.__game.debug.quickTactical(153, 191, 2, { human }); }, human);
  await page.waitForSelector('.tq-form', { timeout: 60000 });
  await page.locator('.tq-form').first().click(); await page.locator('.tq-deploy:not(.arming)').click();
  await page.waitForSelector('.tq-start button', { timeout: 30000 });
  return page;
}
// Which half of the screen an element's centre is on.
const half = (page, sel) => page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return r.left + r.width / 2 < innerWidth / 2 ? 'left' : 'right'; }, sel);

// Nothing may cover a general's head (devblog #94, 2026-11-03; a fixed height over him could not clear every figure):
// his tag lies at his feet like a squad's, under the lower half of his figure at any zoom, with its 将 chip.
test("a general's tag lies at his feet at every zoom", async () => {
  const page = await open('a');
  const gaps = () => page.evaluate(async () => {
    const THREE = await import('three'), v = window.__game.tview, cam = v.camera;
    return [...document.querySelectorAll('.tk.gen')].map((el) => {
      let g = null; v.scene.traverse((o) => { if (o.isCSS2DObject && o.element === el) g = o.parent; });
      const waist = new THREE.Vector3(0, 0.7, 0).applyMatrix4(g.matrixWorld).project(cam), bar = el.querySelector('.sb');
      const chip = parseFloat(getComputedStyle(bar, '::before').height), r = bar.getBoundingClientRect();
      return (r.top + r.height / 2 - chip / 2) - (0.5 - waist.y / 2) * innerHeight;
    });
  });
  for (const zoom of [0, -560, 1300]) {
    if (zoom) await page.evaluate((z) => window.__game.tview.zoom(z), zoom);
    await page.waitForTimeout(800);
    for (const gap of await gaps()) assert.ok(gap >= 0, `the tag starts ${(-gap).toFixed(1)}px above his waist`);
  }
  const chips = await page.evaluate(() => [...document.querySelectorAll('.tk.gen .sb')].map((b) => getComputedStyle(b, '::before').content));
  assert.deepEqual(chips, ['"将"', '"将"']);
  // The chip is no bigger than a squad's, or it covers the horse's hooves (the playtest of 2026-11-07).
  const sizes = await page.evaluate(() => [...document.querySelectorAll('.tk .sb')].map((b) => { const c = getComputedStyle(b, '::before'); return [c.width, c.height, c.fontSize].join(); }));
  assert.ok(sizes.length > 2);
  assert.equal(new Set(sizes).size, 1, sizes.join(' | '));
  await page.context().close();
});

for (const human of ['a', 'd']) {
  test(`the player's card is over the player's troops (player ${human === 'a' ? 'attacks' : 'defends'})`, async () => {
    const page = await open(human);
    // the player's side wears the 'attacker' look (as from the war map); its general's label is .tk.gen.attacker
    const card = await half(page, '.tq-card.me'), troops = await half(page, '.tk.gen.attacker');
    const foeCard = await half(page, '.tq-card.foe'), foeTroops = await half(page, '.tk.gen.defender');
    assert.equal(card, troops, 'player card and player troops');
    assert.equal(foeCard, foeTroops, 'enemy card and enemy troops');
    assert.equal(card, human === 'a' ? 'left' : 'right', 'the attacker stands on the left, as in the original');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
}

// The two top cards are one size, whoever's name or troops are shorter (the right one used to shrink to its text).
test('the two top cards are the same size', async () => {
  const page = await open('a');
  const [l, r] = await page.$$eval('.tq-card', (els) => els.map((e) => { const b = e.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; }));
  assert.deepEqual(l, r);
  await page.context().close();
});

// 爆炎 on the console (devblog #131, 2026-11-04): open under our other tactics, and no second throw until the first has
// done its damage on screen. Points are set past 24 by hand, as an edited 智力 gives them.
const tacticButton = (page, label) => page.locator('.tq-tac', { hasText: label });
const redraw = (page) => page.locator('.tq-speed .tq-btn', { hasText: '1×' }).click();
test('爆炎 stays open while our 咒缚 runs; the other tactics do not', async () => {
  const page = await open('a');
  await page.evaluate(() => { const S = window.__tq.side.a; S.tp = 24; S.fx.bind = 3; });
  await redraw(page);
  assert.equal(await tacticButton(page, '爆炎').isEnabled(), true);
  assert.equal(await tacticButton(page, '火矢').isEnabled(), false);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});
test('a second 爆炎 waits until the first has landed', async () => {
  const page = await open('a');
  await page.evaluate(() => { window.__tq.side.a.tp = 24; });
  await redraw(page);
  const blast = tacticButton(page, '爆炎'), tp = () => page.evaluate(() => window.__tq.side.a.tp);
  await blast.click();
  await page.waitForFunction(() => window.__tq.side.a.tp === 12);
  assert.equal(await blast.isEnabled(), false, 'the console is shut while the throw plays');
  await page.evaluate(() => [...document.querySelectorAll('.tq-tac')].find((b) => b.textContent.includes('爆炎')).click()); // a double click's second half
  await page.waitForFunction(() => [...document.querySelectorAll('.tq-tac')].find((b) => b.textContent.includes('爆炎'))?.disabled === false, null, { timeout: 30000 });
  assert.equal(await tp(), 12, 'the click during the throw cast nothing');
  await blast.click();
  await page.waitForFunction(() => window.__tq.side.a.tp === 0, null, { timeout: 30000 });
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

// An effect is on its mark from its first frame: 火矢's flames and arrows and 爆炎's ball used to be drawn one frame
// at the world origin, a blaze in the middle of the field, before their first animation step placed them.
test('no effect of 火矢 or 爆炎 is ever drawn at the middle of the field', async () => {
  const page = await open('d');
  const drawn = await page.evaluate(async () => {
    const G = window.__game, v = G.tview, r = G.debug.renderer, b = window.__tq, seen = [], render = r.render;
    let frames = 0;
    r.render = function (s, c) {
      if (s === v.scene) {
        frames++;
        s.traverse((o) => {
          const glow = o.isSprite && o.material.blending === 2, fx = o.isMesh && (o.geometry.type === 'BoxGeometry' || o.geometry.type === 'SphereGeometry') && o.parent?.parent === s;
          if ((glow || fx) && o.visible && !o.position.x && !o.position.z) seen.push(frames);
        });
      }
      return render.call(this, s, c);
    };
    const arc = b.live.find((u) => u.side === 'a' && u.kind === 'arc'), foe = b.live.find((u) => u.side === 'd' && u.kind !== 'gen');
    await v.play({ type: 'tactic', side: 'a', id: 'fire', ok: true }, {});
    await v.play({ type: 'attack', u: arc, t: foe, ranged: true, fire: true, dmg: 1 }, {});
    await v.play({ type: 'tactic', side: 'a', id: 'blast', ok: true, center: [8, 2], hits: [] }, {});
    r.render = render;
    return { frames, seen: seen.length };
  });
  assert.ok(drawn.frames > 10, `only ${drawn.frames} frames were watched`);
  assert.equal(drawn.seen, 0);
  await page.context().close();
});

// 白兵在 4× 时一回合的节拍目标为 4 秒，在 1× 为 16 秒。密集交战仍要顺序播完动作。
test('a round at the 4× button targets 4 s and completes its serial animations', async () => {
  const page = await open('a');
  await page.locator('.tq-btn', { hasText: '4×' }).click();
  await page.locator('.tq-btn', { hasText: '自动' }).click();
  await page.evaluate(() => {
    const battle = window.__tq, view = window.__game.tview, play = view.play.bind(view);
    window.__rounds = [];
    document.querySelector('.tq-start button').addEventListener('click', () => {
      window.__rounds.push({ start: performance.now() });
    }, { capture: true, once: true });
    const animationMs = new Map();
    view.play = async (event, hooks) => {
      const round = battle.round, start = performance.now();
      if (event.type === 'round') window.__rounds.push({ start, animations: animationMs.get(round - 1) ?? 0 });
      await play(event, hooks);
      if (event.type !== 'round') animationMs.set(round, (animationMs.get(round) ?? 0) + performance.now() - start);
    };
  });
  await page.locator('.tq-start button:not(.arming)').click();
  await page.waitForFunction(() => window.__rounds.length >= 5 || window.__tq.over, null, { timeout: 60000 });
  const t = await page.evaluate(() => window.__rounds);
  assert.ok(t.length >= 5, 'the battle completed at least four rounds');
  let pacedRounds = 0;
  const budget = 4000;
  for (const [i, { start, animations }] of t.slice(1).entries()) {
    const elapsed = start - t[i].start;
    const detail = `round took ${Math.round(elapsed)} ms with ${Math.round(animations)} ms of serial animations`;
    if (animations <= budget) {
      pacedRounds++;
      assert.ok(near(elapsed, budget, 0.3), detail);
    } else {
      assert.ok(elapsed >= animations && elapsed - animations < budget, detail);
    }
  }
  assert.ok(pacedRounds >= 3, 'the nominal 4-second pace is measured in at least three rounds');
  await page.context().close();
});

// The field is painted as the war map (A2): one baked ground over its relief instead of the tile diorama,
// painted woods, banners planted at both edges, every squad on a base in its side's colour, and on 城战 the
// painted fortress walls.
const parts = (page) => page.evaluate(() => {
  const out = {}, looks = new Set();
  window.__game.tview.scene.traverse((o) => {
    if (o.userData.terrain) out.tiles = (out.tiles ?? 0) + 1;
    const p = o.userData.part; if (!p) return;
    out[p] = (out[p] ?? 0) + 1;
    if (p === 'base') looks.add(o.userData.look);
  });
  out.looks = [...looks].sort();
  return out;
});
for (const [t, name] of [[2, '平原'], [3, '河'], [5, '城']]) {
  test(`the ${name} field is the painted one`, async () => {
    const page = await game.open();
    await page.evaluate((t) => { window.__game.debug.quickTactical(153, 191, t, { human: 'a' }); }, t);
    await page.waitForSelector('.tq-form', { timeout: 60000 });
    await page.locator('.tq-form').first().click(); await page.locator('.tq-deploy:not(.arming)').click();
    await page.waitForSelector('.tq-start button', { timeout: 30000 });
    const p = await parts(page);
    assert.equal(p.ground, 1, 'one painted ground');
    assert.equal(p.tiles, undefined, 'no tile terrain');
    assert.equal(p.woods, 1, 'painted woods');
    assert.equal(p.banner, 4, 'two banners at each edge');
    assert.deepEqual(p.looks, ['attacker', 'defender'], 'squads stand on both sides\' bases');
    if (t === 3) assert.equal(p.water, 1, 'water over the pools');
    if (t === 5) assert.equal(p.walls, 1, 'the fortress walls');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
}

// The 单挑 plates stand over their riders as the 白兵 cards do: the attacker rides in from the left, so the
// player's plate is on the left when attacking and on the right when defending.
for (const human of ['a', 'd']) {
  test(`the player's 单挑 plate is over the player's rider (player ${human === 'a' ? 'attacks' : 'defends'})`, async () => {
    const page = await open(human);
    await page.locator('.tq-start button:not(.arming)').click();
    await page.evaluate(() => window.__tq.startDuel('a'));
    await page.waitForSelector('.tq-dcard.me', { timeout: 30000 });
    const plate = await half(page, '.tq-dcard.me'), foe = await half(page, '.tq-dcard.foe');
    const side = human === 'a' ? 'left' : 'right';
    assert.equal(plate, side, 'player plate');
    assert.notEqual(foe, side, 'enemy plate on the other side');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
}

// A general already hurt in the 白兵 rides into the 单挑 on a short bar: the plate is out of his 体力 cap, not out of
// the 体力 he came in with (feedback: 书悦学英语@小红书, 2026-11-08 — 郭汜 at 24 showed a full bar).
test('a general hurt before the 单挑 enters it on a short HP bar', async () => {
  const page = await open('a');
  await page.locator('.tq-start button:not(.arming)').click();
  const cap = await page.evaluate(() => { const b = window.__tq; b.side.d.hp = 24; b.startDuel('a'); return window.__game.G.data().officers[b.side.d.id].hp; });
  await page.waitForSelector('.tq-dcard.foe', { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('.tq-dcard.foe em')?.textContent === '体力 24');
  const w = await page.evaluate(() => { const c = document.querySelector('.tq-dcard.foe'); return [c.querySelector('.tq-dbar i').style.width, c.querySelector('.tq-dbar').getBoundingClientRect().width, c.querySelector('.tq-dbar i').getBoundingClientRect().width]; });
  const pct = parseFloat(w[0]);
  assert.ok(pct < 50, `foe bar ${w[0]} should be short at 体力 24 (cap ${cap})`);
  assert.ok(Math.abs(pct - (100 * 24) / cap) < 0.5, `bar ${w[0]} = 24/${cap}`);
  const me = await page.evaluate(() => parseFloat(document.querySelector('.tq-dcard.me .tq-dbar i').style.width));
  assert.ok(me > 50, 'the unhurt side stays long');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

// The 单挑's 自动 switch (feedback T09): taking over in the beat before our automatic action gives the player
// that action — the menu shown answers clicks, and the AI's pick is not played under it (adversarial review R2).
test('taking over a 单挑 in the beat before our automatic action lets the player pick it', async () => {
  const page = await open('a');
  await page.locator('.tq-btn', { hasText: '自动' }).click();
  await page.locator('.tq-start button:not(.arming)').click();
  await page.evaluate(() => {
    const b = window.__tq; b.startDuel('a'); const d = b.duel, ai = d.aiCommand.bind(d);
    window.__aiFor = []; window.__took = false;
    d.aiCommand = (s) => { window.__aiFor.push({ s, took: window.__took }); return ai(s); };
    // press T the moment our automatic beat starts (the hint reads 自动应战…)
    const mo = new MutationObserver(() => {
      if (!window.__took && document.querySelector('.tq-hint')?.textContent === '自动应战…') {
        window.__took = true; mo.disconnect(); dispatchEvent(new KeyboardEvent('keydown', { key: 't' }));
      }
    });
    mo.observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await page.waitForSelector('.tq-duel-acts .dcmd:not([disabled])', { timeout: 30000 });
  await page.waitForTimeout(600); // past the beat: the AI must not have answered for us meanwhile
  assert.deepEqual(await page.evaluate(() => window.__aiFor.filter((x) => x.s === 'a' && x.took)), [], 'no AI pick for our side after the takeover');
  assert.ok(await page.locator('.tq-duel-acts .dcmd', { hasText: '牵制' }).isEnabled(), 'the menu is still up');
  await page.locator('.tq-duel-acts .dcmd', { hasText: '牵制' }).click();
  await page.waitForSelector('.tq-dlog p.me', { timeout: 30000 });
  assert.match(await page.locator('.tq-dlog p.me').first().textContent(), /牵制/, 'our general did what the player picked');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

// A 白兵 starts at the speed its buttons read: leaving one at 4× must not leave the next one playing at 4×
// under a 1× button (the shared 白兵 view kept the old rate; feedback T02, 2026-10-30).
test('the next 白兵 plays at the speed its button shows, not the last one\'s', async () => {
  const page = await open('a');
  await page.evaluate(() => { const v = window.__game.tview, set = v.setSpeed; window.__rates = []; v.setSpeed = (s) => { window.__rates.push(s); set.call(v, s); }; });
  await page.locator('.tq-btn', { hasText: '4×' }).click();
  await page.locator('.tq-start button:not(.arming)').click();
  await page.evaluate(() => { window.__tq.over = { why: 'time' }; });
  await page.locator('.tq-result button').click({ timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('.tq-result'));
  await page.evaluate(() => { window.__rates.length = 0; window.__game.debug.quickTactical(153, 191, 2, { human: 'a' }); });
  await page.waitForSelector('.tq-form', { timeout: 60000 });
  await page.locator('.tq-form').first().click(); await page.locator('.tq-deploy:not(.arming)').click();
  await page.waitForSelector('.tq-start button', { timeout: 30000 });
  const shown = await page.locator('.tq-speed .tq-btn.on').textContent(), rates = await page.evaluate(() => window.__rates);
  assert.equal(shown, '1×');
  assert.deepEqual(rates, [0.5], 'the view is set to the 1× button\'s rate (half speed) once, at the start');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

// The capture gate is on screen (devlog comment #29 of 2026-10-31: "看不见敌对武将血量，抓人容易打死"): both
// cards and both generals' plaques carry it, under it the bar reads 可擒 / 可能被擒, and the log tells once
// that 围 stops the squads striking him. A general of loyalty 100 never surrenders and has no gate.
test('the 白兵 shows each general\'s 体力 against the capture gate, and says once when he can be taken', async () => {
  const page = await open('a');
  await page.locator('.tq-btn', { hasText: '4×' }).click();
  await page.locator('.tq-start button:not(.arming)').click();
  const gate = await page.evaluate(() => { const b = window.__tq; b.side.d.hp = b.gen('d').hp = 20; return b.captureGate('d'); });
  assert.equal(gate, [45, 40, 30][await page.evaluate(() => window.__tq.g.level)]);
  await page.waitForFunction(() => document.querySelector('.tq-feed')?.textContent.includes('可能擒获'), null, { timeout: 60000 });
  const r = await page.evaluate(() => ({
    foe: document.querySelector('.tq-card.foe .tq-bar.hp').textContent, low: document.querySelector('.tq-card.foe .tq-bar.hp').classList.contains('low'),
    gates: document.querySelectorAll('.tq-card .tq-bar.hp .gate').length, plaques: [...document.querySelectorAll('.tk.gen i')].map((i) => i.dataset.n),
    told: [...document.querySelectorAll('.tq-feed p')].filter((p) => p.textContent.includes('可能擒获')).length,
    loyal: (() => { const b = window.__tq, o = b.side.d.o, l = o.loyalty; o.loyalty = 100; const v = b.captureGate('d'); o.loyalty = l; return v; })(),
  }));
  assert.match(r.foe, /可擒/); assert.ok(r.low, 'the bar turns gold');
  assert.equal(r.gates, 2, 'both cards mark the gate');
  assert.ok(r.plaques.every((n) => /^\d+/.test(n)), `plaques show 体力: ${r.plaques}`);
  assert.equal(r.told, 1, 'told once');
  assert.equal(r.loyal, null, 'loyalty 100: no gate');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

// The formation picker (暴力倾向@devblog, 2026-11-13): the field is the picture to choose by, so the title keeps to the top and the
// cards to the bottom, and with any formation pointed at every squad of ours and its troop chip stands in the clear gap between
// them, whichever side the player fights on and in the smallest window. The cards draw the squads this general really has, in
// their troop types' marks, the defender's on his own (right) side.
for (const [human, size] of [['a', [1280, 800]], ['d', [1280, 800]], ['d', [1024, 600]]]) {
  test(`the formation picker leaves every squad of ours in sight (${human === 'a' ? 'attacking' : 'defending'}, ${size.join('×')})`, async () => {
    const page = await game.open();
    await page.setViewportSize({ width: size[0], height: size[1] });
    await page.evaluate((human) => { window.__game.debug.quickTactical(153, 191, 2, { human }); }, human);
    await page.waitForSelector('.tq-form', { timeout: 60000 });
    const marks = await page.evaluate((human) => { const b = window.__tq ?? null; // not up yet: read the cards alone
      return [...document.querySelectorAll('.tq-form')].map((c) => ({ inf: c.querySelectorAll('.k-inf').length, arc: c.querySelectorAll('.k-arc').length, cav: c.querySelectorAll('.k-cav').length,
        gen: c.querySelectorAll('.gn').length, genRight: c.querySelector('.gn').getBoundingClientRect().left > c.querySelector('.tq-form-svg').getBoundingClientRect().left + c.querySelector('.tq-form-svg').getBoundingClientRect().width / 2 })); }, human);
    for (let i = 0; i < 4; i++) {
      await page.locator('.tq-form').nth(i).hover();
      await page.waitForTimeout(1600); // the men are made again and the camera settles
      const seen = await page.evaluate(() => {
        const top = document.querySelector('.tq-form-head').getBoundingClientRect().bottom, bottom = document.querySelector('.tq-form-foot').getBoundingClientRect().top;
        const tags = [...document.querySelectorAll('.tk')].filter((e) => e.offsetParent !== null && getComputedStyle(e).display !== 'none').map((e) => { const r = e.querySelector('.sb').getBoundingClientRect(); return { kind: e.className.split(' ')[2], x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
        const plates = [...document.querySelectorAll('.tq-vs-side')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.getBoundingClientRect()); // the overlay takes no pointer: compare rectangles
        const hidden = tags.filter((t) => t.y < top || t.y > bottom || t.x < 24 || t.x > innerWidth - 24 || plates.some((r) => t.x > r.left && t.x < r.right && t.y > r.top && t.y < r.bottom));
        const wash = getComputedStyle(document.querySelector('.tq-formation')).backdropFilter;
        return { n: tags.length, kinds: Object.fromEntries(['inf', 'arc', 'cav', 'gen'].map((k) => [k, tags.filter((t) => t.kind === k).length])), hidden, wash, deploy: document.querySelector('.tq-deploy').getBoundingClientRect().bottom <= innerHeight };
      });
      assert.ok(seen.n >= 2, 'our men are on the field');
      assert.deepEqual(seen.hidden, [], `formation ${i}: every tag between the two bands`);
      assert.ok(seen.wash === 'none' || !seen.wash, 'nothing blurs the field');
      assert.ok(seen.deploy, '部署 is on the screen');
      assert.deepEqual({ inf: marks[i].inf, arc: marks[i].arc, cav: marks[i].cav, gen: marks[i].gen }, seen.kinds, `formation ${i}: the card draws the squads on the field, type by type`);
      assert.equal(marks[i].genRight, human === 'd', 'the general on his own side of the picture');
    }
    // the field under the picker takes the pointer as it does in the fight (the camera only): nothing is picked or deployed by it
    await page.locator('.tq-form').nth(1).click();
    await page.mouse.click(size[0] / 2, size[1] / 2); await page.mouse.wheel(0, 200); await page.waitForTimeout(300);
    assert.deepEqual(await page.evaluate(() => [document.querySelectorAll('.tq-formation').length, [...document.querySelectorAll('.tq-form')].findIndex((b) => b.classList.contains('on'))]), [1, 1], 'a click on the field neither deploys nor changes the pick');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
}

// The tactic badges (暴力倾向@devblog, 2026-11-13): a running effect shows where it works. Our 强弩 on our archers' tags, our card and
// the 强弩 button (with the rounds left); the enemy's 咒缚 on our general's tag and our card, not on the caster's.
test('a running tactic wears its badge on the units, the card and the button it works on', async () => {
  const page = await open('d');
  await page.evaluate(() => { const b = window.__tq; for (const s of ['a', 'd']) b.side[s].tp = 40;
    const evs = [b.tactic('d', 'xbow')]; let e; do { b.side.a.fx = {}; b.side.a.tp = 40; e = b.tactic('a', 'bind'); } while (!e.ok); evs.push(e); b.events = evs; });
  await page.locator('.tq-start button:not(.arming)').click();
  await page.waitForFunction(() => document.querySelectorAll('.tk .fxs b').length >= 2 && document.querySelector('.tq-card.me .tq-fx .fx-bind'), null, { timeout: 30000 });
  await page.locator('.tq-btn', { hasText: '❚❚' }).click();
  const seen = await page.evaluate(() => {
    const b = window.__tq, tags = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null);
    const fx = (card) => [...document.querySelectorAll(`.tq-card.${card} .tq-fx span`)].map((e) => e.textContent);
    const live = document.querySelector('.tq-tac.live');
    return { arc: tags('.tk.attacker.arc').map((e) => e.querySelector('.fxs')?.textContent ?? ''), inf: tags('.tk.attacker.inf').map((e) => e.querySelector('.fxs')?.textContent ?? ''),
      gen: tags('.tk.attacker.gen').map((e) => [e.querySelector('.fxs b')?.textContent, e.querySelector('.fxs b')?.dataset.n]), foe: tags('.tk.defender').map((e) => e.querySelector('.fxs')?.textContent ?? '').join(''),
      me: fx('me'), him: fx('foe'), live: live && [live.querySelector('b').textContent, live.querySelector('.tq-tac-live').textContent], n: [b.side.d.fx.xbow, b.side.a.fx.bind] };
  });
  assert.ok(seen.arc.length && seen.arc.every((t) => t === '弩'), `every archer squad of ours wears 弩: ${seen.arc}`);
  assert.ok(seen.inf.every((t) => t === ''), 'the infantry wears none');
  assert.deepEqual(seen.gen, [['缚', String(seen.n[1])]], 'our bound general wears 缚 with the rounds left');
  assert.equal(seen.foe, '', 'the enemy, who cast the 咒缚, wears nothing');
  assert.deepEqual(seen.me, [`缚被咒缚 ${seen.n[1]}回合`, `弩强弩 ${seen.n[0]}回合`], 'our card: bound, and our 强弩');
  assert.deepEqual(seen.him, [], 'his card: nothing works on him');
  assert.deepEqual(seen.live, ['强弩', `${seen.n[0]}回合`], 'the 强弩 button wears the rounds left');
  // the badges go when the counters run out
  await page.evaluate(() => { const b = window.__tq; b.side.d.fx.xbow = 1; b.side.a.fx.bind = 1; b.side.a.tp = 0; b.queue = []; }); // tp 0: the AI casts nothing new at the round's end
  await page.locator('.tq-btn', { hasText: '继续' }).click();
  await page.waitForFunction(() => window.__tq.round >= 2 && !document.querySelector('.tk .fxs') && !document.querySelector('.tq-fx span') && !document.querySelector('.tq-tac.live'), null, { timeout: 30000 });
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

// 骂倒's badge on the 单挑 plate (暴力倾向@devblog, 2026-11-13) reads the live counter, which drops as the cursed side's action starts.
test('the 单挑 plate wears 被骂倒 with the actions left, and drops it when the counter runs out', async () => {
  const page = await open('a');
  await page.evaluate(() => window.__tq.startDuel('a'));
  await page.locator('.tq-start button:not(.arming)').click();
  await page.waitForSelector('.tq-duel-acts .dcmd', { timeout: 30000 });
  assert.equal(await page.locator('.tq-dcard.me .tq-dfx').textContent(), '', 'none at first');
  const badge = () => page.evaluate(() => ({ text: document.querySelector('.tq-dcard.me .tq-dfx').textContent, foe: document.querySelector('.tq-dcard.foe .tq-dfx').textContent }));
  await page.evaluate(() => { const d = window.__tq.duel; d.curse.a = 3; d.side.a.hp = d.side.d.hp = 100; d.aiCommand = () => 'feint'; });
  for (let left = 2; left >= 0; left--) {
    await page.keyboard.press('2'); // 牵制: our action, then his, then our menu again with the counter one lower
    await page.waitForFunction((left) => document.querySelector('.tq-duel-acts .dcmd') && window.__tq.duel.curse.a === left, left, { timeout: 30000 });
    const b = await badge();
    assert.equal(b.text, left ? `骂被骂倒 ${left}次` : '', `with ${left} left the plate reads ${JSON.stringify(b.text)}`);
    assert.equal(b.foe, '', 'the foe wears none');
  }
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

// 资料 stands as the screen does (暴力倾向@devblog, 2026-11-13): the attacker's sheet on the left and the defender's on the right, under
// their own plates, whichever side the player fights on; "ours first" put a defending player's sheet under the foe's plate.
test('the 资料 sheets stand on the sides their generals do when the player defends', async () => {
  const page = await open('d');
  const sheets = () => page.evaluate(() => [...document.querySelectorAll('.ocard-pair .ocard')].map((c) => ({ name: c.querySelector('.ocard-name').textContent, side: c.querySelector('.ocard-side')?.textContent,
    left: c.getBoundingClientRect().left + c.getBoundingClientRect().width / 2 < innerWidth / 2 })));
  const want = [{ name: '张飞', side: '敌军 · 攻方', left: true }, { name: '文丑', side: '我军 · 守方', left: false }];
  await page.locator('.tq-card.me .tq-face').click();
  await page.waitForSelector('.shade .ocard-pair');
  assert.equal(await half(page, '.tq-card.me'), 'right', 'the defending player\'s card is on the right');
  assert.deepEqual(await sheets(), want, '白兵: each sheet under its own card');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.shade', { state: 'detached' });
  await page.evaluate(() => window.__tq.startDuel('a'));
  await page.locator('.tq-start button:not(.arming)').click();
  await page.waitForSelector('.tq-duel-acts .dcmd', { timeout: 30000 });
  assert.equal(await half(page, '.tq-dcard.me'), 'right', 'and so is his 单挑 plate');
  await page.keyboard.press('8');
  await page.waitForSelector('.shade .ocard-pair');
  assert.deepEqual(await sheets(), want, '单挑: each sheet under its own plate');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

// 资料 (feedback R09, 2026-11-02): a click on either portrait shows both generals' particulars with this battle's numbers,
// the battle holds meanwhile and goes on as it was; in a 单挑, 资料 (or 8) looks without spending the action.
test('the 白兵 portraits and the 单挑 资料 show both generals and spend nothing', async () => {
  const page = await open('a');
  await page.locator('.tq-start button:not(.arming)').click(); // running
  await page.locator('.tq-card.foe .tq-face').click();
  await page.waitForSelector('.shade .ocard-pair');
  const seen = await page.evaluate(() => ({ cards: [...document.querySelectorAll('.ocard-pair .ocard-name')].map((e) => e.textContent), paused: document.body.classList.contains('tq-detail'),
    top: (() => { const r = document.querySelector('.shade .modal').getBoundingClientRect(), el = document.elementFromPoint(r.left + r.width / 2, r.top + 20); return !!el?.closest('.shade'); })() }));
  assert.deepEqual(seen.cards, ['张飞', '文丑'], 'the attacker on the left, the defender on the right');
  assert.ok(seen.paused, 'the battle holds while it is open');
  assert.ok(seen.top, 'the dialog stands above the 白兵 HUD');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.shade', { state: 'detached' });
  assert.equal(await page.evaluate(() => document.body.classList.contains('tq-detail')), false, 'and goes on as it was');
  // a 单挑 with the player at the menu
  await page.locator('.tq-btn', { hasText: '❚❚' }).click();
  await page.evaluate(() => window.__tq.startDuel('a'));
  await page.locator('.tq-btn', { hasText: '继续' }).click();
  await page.waitForSelector('.tq-duel-acts .dcmd', { timeout: 30000 });
  const before = await page.evaluate(() => ({ log: document.querySelectorAll('.tq-dlog p').length, hp: window.__tq.duel.side.a.hp }));
  await page.locator('.tq-duel-acts .dcmd', { hasText: '资料' }).click();
  await page.waitForSelector('.shade .ocard-pair');
  assert.deepEqual(await page.locator('.ocard-pair .ocard-name').allTextContents(), ['张飞', '文丑']);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.shade', { state: 'detached' });
  await page.keyboard.press('8');
  await page.waitForSelector('.shade .ocard-pair');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({ log: document.querySelectorAll('.tq-dlog p').length, hp: window.__tq.duel.side.a.hp, menu: !!document.querySelector('.tq-duel-acts .dcmd:not([disabled])') }));
  assert.deepEqual(after, { ...before, menu: true }, 'no action was taken; the same menu is up');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

// D29 (2026-11-09): the buttons must show the chance the rules really give, on either seat. `bank23:$B8D3` adds 20 to
// the striker's hit roll and 3/10 to his damage while his own 骂倒 counter runs, for 攻击, 牵制 and 舍身 alike, and the
// roll is the original's table roll (2026-11-14: 舍身 lands 36.7%, not 30%). A 骂倒 on the other man changes nothing of ours.
for (const human of ['a', 'd']) test(`the 攻击, 牵制 and 舍身 buttons show the chance each really has (player on ${human})`, async () => {
  const foe = human === 'a' ? 'd' : 'a';
  // Opens the 单挑 with the given 骂倒 counters set before the first action, and reads our menu once it is up.
  const read = async (mine, his) => {
    const page = await open(human);
    await page.locator('.tq-start button:not(.arming)').click();
    await page.evaluate(([human, foe, mine, his]) => { const b = window.__tq; b.startDuel(human); b.duel.curse[human] = mine; b.duel.curse[foe] = his; }, [human, foe, mine, his]);
    await page.waitForSelector('.tq-duel-acts .dcmd', { timeout: 30000 });
    const seen = await page.evaluate(([human, foe]) => {
      const d = window.__tq.duel, btns = [...document.querySelectorAll('.tq-duel-acts .dcmd')], out = {};
      // every place the table cursor can stand, through the rules themselves, on a copy of the two generals
      for (const [i, cmd] of ['attack', 'feint', 'desperate'].entries()) {
        let lands = 0;
        for (let v = 0; v < 256; v++) {
          const side = { a: { ...d.side.a, hp: 99 }, d: { ...d.side.d, hp: 99 } }, c = new d.constructor(side, () => v, d.g, human);
          c.curse = { ...d.curse }; lands += c.act(human, cmd).hit ? 1 : 0;
        }
        out[cmd] = { text: btns[i].querySelector('small').textContent, title: btns[i].title, pct: Math.round(lands / 2.56) };
      }
      return { ...out, base: d.hitChance(human), mine: d.curse[human], his: d.curse[foe],
        schemes: btns.filter((e) => /说得|骂倒/.test(e.textContent)).map((e) => e.disabled) };
    }, [human, foe]);
    assert.deepEqual(page.errors, []);
    await page.context().close();
    return seen;
  };
  const calm = await read(0, 0);
  assert.ok(calm.attack.pct > calm.base, `the table roll lands more often than the matrix ${calm.base}: ${calm.attack.pct}`);
  assert.equal(calm.attack.text, `命中 ${calm.attack.pct}%`);
  assert.equal(calm.feint.pct, 100); assert.equal(calm.feint.text, '必中·1/3伤');
  assert.equal(calm.desperate.pct, human === 'a' ? 44 : 39); // 张飞与文丑的被动给出不同的舍身命中率。
  assert.equal(calm.desperate.text, `${calm.desperate.pct}%·2倍伤`);
  assert.doesNotMatch(calm.desperate.title, /37%/);
  const cursed = await read(3, 0); // our counter drops by one as our action starts
  assert.equal(cursed.mine, 2); assert.deepEqual(cursed.schemes, [true, true]);
  assert.ok(cursed.attack.pct < calm.attack.pct);
  assert.equal(cursed.attack.text, `命中 ${cursed.attack.pct}%伤害 +30%`, 'the button shows what the rules give');
  assert.match(cursed.attack.title, new RegExp(`命中由 ${calm.attack.pct}% 降为 ${cursed.attack.pct}%，命中后伤害加三成，还有 2 次出手`));
  assert.equal(cursed.feint.pct, 84); assert.equal(cursed.feint.text, '84%·1/3伤伤害 +30%');
  assert.ok(cursed.desperate.pct < calm.desperate.pct);
  assert.equal(cursed.desperate.text, `${cursed.desperate.pct}%·2倍伤伤害 +30%`);
  assert.match(cursed.desperate.title, new RegExp(`命中由 ${calm.desperate.pct}% 降为 ${cursed.desperate.pct}%`));
  const worn = await read(1, 0); // the last count runs out as this action starts
  assert.equal(worn.mine, 0); assert.deepEqual([worn.attack.text, worn.feint.text, worn.desperate.text], [calm.attack.text, calm.feint.text, calm.desperate.text]);
  const his = await read(0, 9); // his counter is his own: it weakens his aim and hardens his blows, not ours
  assert.ok(his.his > 0); assert.deepEqual([his.attack, his.feint, his.desperate], [calm.attack, calm.feint, calm.desperate]);
});

test('every 单挑 rider has the strips his horse wheels round through', () => {
  const dir = new URL('../assets/ai/sprites/duel/', import.meta.url), read = (f) => JSON.parse(readFileSync(new URL(f, dir)));
  const keys = read('index.json'), views = ['quarter_front_1', 'quarter_back_1', 'quarter_flee_1', 'loose_quarter_1', 'loose_front_1'];
  assert.ok(keys.length && keys.every((k) => !k.includes('-')), 'the index holds side strips only');
  for (const k of keys) {
    for (const f of views) assert.ok(read(`${k}-wheel.json`).frames.includes(f), `${k}-wheel: ${f}`);
    for (const f of ['front_walk_1', 'back_walk_1']) assert.ok(read(`${k}-turn.json`).frames.includes(f), `${k}-turn: ${f}`);
  }
});

// PERF-05: the chosen formation redeploys the same battle on the ground the picker stood on, so the ground stays and only
// the men are made again; the next 白兵 on that terrain and place lays the kept bake; ten more leave the GPU resources level.
test('a formation pick keeps the ground and makes the men again; the same field again reuses its bake, with no growth', async () => {
  const page = await game.open();
  const probe = () => page.evaluate(() => {
    const v = window.__game.tview; let ground = null; v.scene.traverse((o) => { if (o.userData.part === 'ground') ground = o; });
    const tags = document.querySelectorAll('.tk').length, m = window.__game.debug.renderer.info.memory;
    window.__ids ??= new WeakMap(); window.__n ??= 0;
    const id = (o) => o && (window.__ids.get(o) ?? (window.__ids.set(o, ++window.__n), window.__n));
    return { ground: id(ground), tex: id(ground?.material.map), tags, geometries: m.geometries, textures: m.textures };
  });
  const fight = async (pick) => {
    await page.evaluate(() => { window.__qt = false; window.__game.debug.quickTactical(153, 191, 2, { human: 'a', month: 2, city: 12 }).then(() => { window.__qt = true; }); });
    await page.waitForSelector('.tq-form', { timeout: 60000 });
    const before = await probe();
    await page.locator('.tq-form').nth(pick).click(); await page.locator('.tq-deploy:not(.arming)').click();
    await page.waitForSelector('.tq-start button', { timeout: 30000 });
    const after = { ...(await probe()), ...(await page.evaluate(() => ({ units: window.__tq.units.length, own: window.__tq.units.filter((u) => u.side === 'a').length }))) };
    await page.evaluate(() => { window.__tq.over ||= { why: 'time' }; }); await page.locator('.tq-start button:not(.arming)').click();
    await page.locator('.tq-result .tq-btn', { hasText: '返回战场' }).click({ timeout: 60000 });
    await page.waitForFunction(() => window.__qt, null, { timeout: 30000 });
    return { before, after };
  };
  const first = await fight(2);
  assert.equal(first.after.ground, first.before.ground, 'the ground mesh stays through the pick');
  // while the formation is chosen only our men stand on the field, as in the original (src/tacticalhud.js redeploy)
  assert.equal(first.before.tags, first.after.own, 'only our squads are on the field during the pick');
  assert.equal(first.after.tags, first.after.units, 'every squad of both sides has its tag after the pick, none left over');
  const second = await fight(1);
  assert.notEqual(second.before.ground, first.after.ground, 'a new battle lays its own ground mesh');
  assert.equal(second.before.tex, first.after.tex, 'on the kept bake');
  const level = await probe();
  for (let i = 0; i < 4; i++) await fight(i % 4);
  const end = await probe();
  assert.ok(end.geometries <= level.geometries + 2 && end.textures <= level.textures + 2, `GPU resources level: ${JSON.stringify({ level, end })}`);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

// Shader prewarm (2026-11-07): a 白兵 field compiles its shaders while the cut-in still covers it (app.js prewarm), so its first
// frame no longer stops to compile them (15 programs on a cold field before, a 150–350 ms frame); the loop draws nothing meanwhile.
// 爆炎's bomb, explosion, flash, shockwave and scorch (src/blastfx.js) are compiled with the field: the first throw
// makes no shader program of its own, which would stall the frame it lands on.
test('the first 爆炎 makes no new shader program', async () => {
  const page = await open('a');
  await page.evaluate(() => { window.__tq.side.a.tp = 24; });
  await page.locator('.tq-speed .tq-btn', { hasText: '1×' }).click();
  await page.locator('.tq-tac', { hasText: '爆炎' }).click();
  await page.waitForFunction(() => window.__tq.side.a.tp === 12);
  const before = await page.evaluate(() => window.__game.debug.renderer.info.programs.length);
  // the console opens again once the blast has played; the smoke and the scorch go on a while after
  await page.waitForFunction(() => [...document.querySelectorAll('.tq-tac')].find((b) => b.textContent.includes('爆炎'))?.disabled === false, null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => window.__game.debug.renderer.info.programs.length);
  assert.equal(after, before, `programs ${before} → ${after}`);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('a new 白兵 field has its shaders compiled before its first frame', async () => {
  const page = await game.open();
  await page.evaluate(() => {
    const { post, renderer } = window.__game.debug, render = post.render.bind(post), n = () => renderer.info.programs.length;
    window.__pw = { start: n(), frames: [] };
    post.render = () => { const a = n(); render(); window.__pw.frames.push([a, n()]); };
    window.__game.debug.quickTactical(153, 191, 2, { human: 'a', month: 7, city: 30 });
    window.__pw.armed = window.__pw.frames.length; // frames from here on draw the new field
  });
  await page.waitForSelector('.tq-form', { timeout: 60000 });
  const r = await page.evaluate(() => { const p = window.__pw, first = p.frames[p.armed]; return { start: p.start, first, frames: p.frames.length - p.armed }; });
  assert.ok(r.first, `a frame was drawn: ${JSON.stringify(r)}`);
  assert.ok(r.first[0] > r.start + 5, `the field's programs were made before its first frame: ${JSON.stringify(r)}`);
  assert.ok(r.first[1] - r.first[0] <= 5, `its first frame makes at most a few: ${JSON.stringify(r)}`);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

// D38 (水星记丶@小红书, 2026-11-10): a rider who cuts down the squad in his way spends his second action riding on, as in
// the original. The rules moved him, but the fall back from the blow was still running when the step began and pulled
// his figure onto the cell he had left. Played back to back, as the HUD does when the round's beats are short.
test('a rider who kills with his first action is seen on the cell his second action takes him to', async () => {
  for (const human of ['a', 'd']) {
    const page = await open(human);
    const runs = await page.evaluate(async (side) => {
      const b = window.__tq, v = window.__game.tview, foe = side === 'a' ? 'd' : 'a', sleep = (ms) => new Promise((r) => setTimeout(r, ms)), out = [];
      for (const [speed, kills] of [[2, true], [4, true], [0.5, true], [2, false]]) {
        b.map = Array.from({ length: 10 }, () => Array(16).fill(0)); b.over = null; b.r = () => 0;
        for (const s of ['a', 'd']) { b.side[s].o.army = '平'; b.side[s].F = 78; }
        b.side[side].cmd.cav = 'advance';
        const cav = { side, kind: 'cav', idx: 1, x: side === 'a' ? 7 : 8, y: 5, hp: 100 };
        const target = { side: foe, kind: 'inf', idx: 1, x: side === 'a' ? 8 : 7, y: 5, hp: kills ? 1 : 100 };
        b.units = [{ side: 'a', kind: 'gen', idx: 0, x: 2, y: 5, hp: 99 }, { side: 'd', kind: 'gen', idx: 0, x: 13, y: 5, hp: 99 }, cav, target];
        b.buildQueue(); b.queue = b.queue.slice(b.queue.indexOf(cav));
        v.build(b, { a: 'attacker', d: 'defender' }); v.setSpeed(speed / 2);
        let group; v.scene.traverse((o) => { if (o.isCSS2DObject && o.element.matches(`.tk.${side === 'a' ? 'attacker' : 'defender'}.cav`)) group = o.parent; });
        const e1 = b.step(); await v.play(e1, {});
        const e2 = b.step(); await v.play(e2, {});
        await v.settle(); await sleep(900 / speed);
        out.push({ speed, kills, events: [e1.type + (e1.kill ? ':kill' : ''), e2.type], model: [cav.x, cav.y], seen: [group.position.x + 7.5, group.position.z + 4.5] });
      }
      return out;
    }, human);
    for (const r of runs) {
      assert.deepEqual(r.events, r.kills ? ['attack:kill', 'move'] : ['attack', 'attack'], `${human} ${r.speed}×: the fixture's two actions`);
      assert.ok(near(r.seen[0], r.model[0], 0.02) && near(r.seen[1], r.model[1], 0.02), `${human} ${r.speed}×${r.kills ? '' : ' (no kill)'}: drawn at ${r.seen}, the rules have him at ${r.model}`);
    }
    assert.deepEqual(page.errors, []);
    await page.context().close();
  }
});

// 全军待机 / 全军包围 (2026-11-14): one press orders all four troop types, the segments light to match, and the
// buttons are shut under 自动 like the segments (the computer would overwrite the order at the next round).
test('全军待机 and 全军包围 give every troop type the order, and are shut under 自动', async () => {
  const page = await open('a');
  const orders = () => page.evaluate(() => ({ cmd: Object.values(window.__tq.side.a.cmd), foe: Object.values(window.__tq.side.d.cmd),
    lit: [...document.querySelectorAll('.tq-row:not(.tq-all) .tq-cmd.on')].map((e) => e.getAttribute('aria-label')),
    all: [...document.querySelectorAll('.tq-allcmd.on')].map((e) => e.dataset.all), feed: document.querySelector('.tq-feed')?.firstChild?.textContent }));
  const foe = (await orders()).foe;
  for (const [c, label] of [['surround', '包围'], ['wait', '待机']]) {
    await page.locator(`.tq-allcmd[data-all="${c}"]`).click();
    const o = await orders();
    assert.deepEqual(o.cmd, [c, c, c, c]); assert.deepEqual(o.lit, [label, label, label, label]); assert.deepEqual(o.all, [c]);
    assert.equal(o.feed, `全军${label}！`); assert.deepEqual(o.foe, foe, "the foe's orders are untouched");
  }
  await page.locator('.tq-row:not(.tq-all) .tq-cmd[aria-label="前进"]').first().click();
  assert.deepEqual((await orders()).all, [], 'one type on another order: neither 全军 button is lit');
  await page.locator('.tq-btn', { hasText: '自动' }).click();
  assert.deepEqual(await page.locator('.tq-allcmd').evaluateAll((l) => l.map((b) => b.disabled)), [true, true]);
});
