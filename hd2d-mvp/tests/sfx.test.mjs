// Which sounds play, as the original's sound driver calls them (D42–D44, 2026-11-11). Traced on the unmodified ROM in a muted
// FCEUmm (docs/review-assets/2026-11-11/original-audio-trace, duel/ for the 单挑): a 单挑 action plays the same sounds whether it
// lands or misses — 牵制 98, 攻击 97 then 105, 舍身 97 then 104, every gallop 96 — and 骂倒, 说得, a pursuit's strike and the
// entry play none; a 白兵 volley plays 90 as it looses and 93 as the arrows land; no turn of the strategy or war map plays the
// war-start phrase (123, sfx-horn).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, newCampaign, closeMessages, skipIntro } from './game.mjs';

let game, page;
before(async () => { game = await startGame(); page = await game.open(); await skipIntro(page); }); // the title's own arrow is not in the test
after(() => game?.close());

// Every audio.sfx call from here on, in order.
const spy = (p) => p.evaluate(() => { const a = window.__game.audio; window.__sounds = []; a.sfx = (k) => window.__sounds.push(k); });
const heard = (p) => p.evaluate(() => window.__sounds.splice(0));
const RIDE = 'sfx-duel-ride';
const weapon = (list) => list.filter((k) => k !== RIDE);

test('a 单挑 plays the original sound of each action, the same on a hit and a miss', async () => {
  await spy(page);
  const r = await page.evaluate(async () => {
    const { debug, G } = window.__game, dv = debug.duelView, out = {};
    const { Tactical } = await import('./src/core/tactical.js');
    (await import('./src/pace.js')).setPace(4);
    const g = G.newGame(4, 1, 3), battle = new Tactical(g, 38, 51, 2, G.rng(g), { human: 'a' });
    dv.setPlace({ month: 2, city: 12, siege: null }); debug.show('dview');
    const take = () => window.__sounds.splice(0);
    await dv.enter(battle, { a: 'attacker', d: 'defender' }); out.enter = take();
    const A = battle.side.a.id, ctx = { hp: { [A]: 50, [battle.side.d.id]: 50 } };
    const run = async (name, a) => { await dv.act({ by: A, ...a }, ctx); out[name] = take(); };
    await run('feintHit', { cmd: 'feint', hit: true, dmg: 4 });
    await run('feintMiss', { cmd: 'feint', hit: false, dmg: 0 });
    await run('attackHit', { cmd: 'attack', hit: true, dmg: 20 });
    await run('attackMiss', { cmd: 'attack', hit: false, dmg: 0 });
    await run('desperateHit', { cmd: 'desperate', hit: true, dmg: 40 });
    await run('desperateMiss', { cmd: 'desperate', hit: false, dmg: 0, self: 15 });
    await run('taunt', { cmd: 'taunt', hit: true });
    await run('tauntMiss', { cmd: 'taunt', hit: false });
    await run('persuade', { cmd: 'persuade', out: 1 });
    await run('chased', { cmd: 'retreat', hit: true, dmg: 6 });
    (await import('./src/pace.js')).setPace(1);
    return out;
  });
  assert.deepEqual(r.enter, [], `the riders come in under the duel theme alone: ${r.enter}`);
  assert.deepEqual(weapon(r.feintHit), ['sfx-chime'], `牵制: ${r.feintHit}`);
  assert.deepEqual(weapon(r.attackHit), ['sfx-duel-swing', 'sfx-duel-blow'], `攻击: ${r.attackHit}`);
  assert.deepEqual(weapon(r.desperateHit), ['sfx-duel-swing', 'sfx-duel-desperate'], `舍身: ${r.desperateHit}`);
  for (const k of ['feint', 'attack', 'desperate']) {
    assert.deepEqual(weapon(r[`${k}Miss`]), weapon(r[`${k}Hit`]), `${k} sounds the same when it misses`);
    assert.equal(r[`${k}Hit`][0], RIDE, `${k} starts with the horse driving in: ${r[`${k}Hit`]}`);
    assert.ok(r[`${k}Hit`].filter((x) => x === RIDE).length >= 2, `${k}: in and back again: ${r[`${k}Hit`]}`);
  }
  for (const k of ['taunt', 'tauntMiss', 'persuade']) assert.deepEqual(r[k], [], `${k} is silent: ${r[k]}`);
  assert.ok(r.chased.length && r.chased.every((x) => x === RIDE), `a pursuit is gallops only, no blow: ${r.chased}`);
});

test('a 白兵 volley sounds as it looses and again as the arrows land', async () => {
  await spy(page);
  const r = await page.evaluate(async () => {
    const { tview, G, debug } = window.__game;
    const { Tactical } = await import('./src/core/tactical.js');
    const g = G.newGame(4, 1, 3); g.officers[38].soldiers = g.officers[51].soldiers = 900; const b = new Tactical(g, 38, 51, 2, G.rng(g), { human: 'a' }); b.deploy();
    tview.setPlace({ month: 2, city: 12 }); await tview.ready(); debug.show('tview');
    tview.build(b, { a: 'attacker', d: 'defender' });
    await new Promise((f) => setTimeout(f, 300));
    const u = b.units.find((x) => x.kind === 'arc'), t = b.units.find((x) => x.side !== u?.side && x.kind !== 'gen');
    if (!u || !t) return { kinds: b.units.map((x) => x.side + x.kind) };
    const sounds = [], marks = [];
    await tview.play({ type: 'attack', u, t, dmg: 12, ranged: true, fire: false, kill: false }, { sfx: (k) => { sounds.push(k); marks.push(performance.now()); }, update() {} });
    return { sounds, gap: marks[1] - marks[0] };
  });
  assert.ok(r.sounds, `no archers to shoot: ${r.kinds}`);
  assert.deepEqual(r.sounds, ['sfx-select', 'sfx-volley-land']);
  assert.ok(r.gap > 100, `the landing follows the flight (${Math.round(r.gap)} ms)`);
});

test('白兵双方战术在效果出现时播放各自音效，失败静音，爆炎只在爆点发声', { timeout: 60000 }, async () => {
  const r = await page.evaluate(async () => {
    const { tview, G, debug } = window.__game, { Tactical } = await import('./src/core/tactical.js');
    const g = G.newGame(4, 1, 3); g.officers[38].soldiers = g.officers[51].soldiers = 900;
    const b = new Tactical(g, 38, 51, 2, G.rng(g), { human: 'a' }); b.deploy();
    tview.setPlace({ month: 2, city: 12 }); await tview.ready(); debug.show('tview');
    tview.build(b, { a: 'attacker', d: 'defender' }); tview.setSpeed(4);
    const out = {};
    for (const side of ['a', 'd']) for (const id of ['bind', 'taunt', 'xbow', 'morale', 'fire', 'blast']) {
      const sounds = [], gen = b.gen(side), dir = side === 'a' ? 1 : -1;
      const ev = { type: 'tactic', side, id, ok: true, center: [gen.x + dir * 2, gen.y], hits: [] };
      await tview.play(ev, { sfx: (key) => sounds.push(key) });
      await tview.play({ ...ev, ok: false }, { sfx: (key) => sounds.push(`failed:${key}`) });
      out[`${side}:${id}`] = sounds;
    }
    tview.setSpeed(1); return out;
  });
  for (const side of ['a', 'd']) for (const id of ['bind', 'taunt', 'xbow', 'morale', 'fire', 'blast']) {
    assert.deepEqual(r[`${side}:${id}`], [id === 'blast' ? 'sfx-blast' : `sfx-tactic-${id}`]);
  }
});

test('新增战术短音可独立合成，并遵循音效静音', async () => {
  const r = await page.evaluate(async () => {
    const { Audio } = await import('./src/audio.js');
    const out = {};
    for (const key of ['sfx-tactic-bind', 'sfx-tactic-taunt', 'sfx-tactic-xbow', 'sfx-tactic-morale', 'sfx-tactic-fire', 'sfx-strategy-water', 'sfx-strategy-lure', 'muted']) {
      const a = new Audio({}, {}), ctx = new OfflineAudioContext(1, 24000, 48000);
      a.ctx = ctx; a.sfxGain = ctx.createGain(); a.sfxGain.gain.value = key === 'muted' ? 0 : 1; a.sfxGain.connect(ctx.destination);
      a.sfx(key === 'muted' ? 'sfx-tactic-fire' : key);
      const samples = (await ctx.startRendering()).getChannelData(0);
      out[key] = Math.max(...samples.map(Math.abs));
    }
    return out;
  });
  for (const [key, peak] of Object.entries(r)) assert.ok(key === 'muted' ? peak === 0 : peak > 0.001, `${key}: ${peak}`);
});

test('the player\'s month and war day begin without the war-start phrase', async () => {
  const p = await game.open();
  await spy(p);
  await p.evaluate(async () => { (await import('./src/pace.js')).setPace(4); (await import('./src/vignette.js')).setVignettes(false); });
  await newCampaign(p);
  await p.waitForSelector('.banner', { state: 'detached', timeout: 10000 }).catch(() => {});
  assert.ok(!(await heard(p)).includes('sfx-horn'), 'the month banner is silent');
  await p.evaluate(() => {
    const { g, G, debug } = window.__game, home = g.factions[g.player].city;
    const to = G.roads(home).map((c) => g.cities[c]).filter((c) => c.faction !== g.player && c.faction !== G.NONE && c.officers.length)[0];
    for (const id of [...g.cities[home].officers, ...to.officers]) g.officers[id].soldiers ||= 500;
    const ids = g.cities[home].officers.slice(0, 2);
    debug.fieldWar(debug.setupWar(g, { from: home, to: to.id, ids, commander: ids[0], gold: 100, rice: 400 }), 'att');
  });
  await p.waitForFunction(() => window.__game.war?.finishDeploy && document.body.dataset.screen === 'war', null, { timeout: 30000 });
  const stop = closeMessages(p);
  try {
    await p.waitForTimeout(1500);
    await heard(p);
    await p.evaluate(() => window.__game.war.finishDeploy());
    await p.waitForFunction(() => { const f = window.__game.war.field; return f.turn === f.human && f.day === 1; }, null, { timeout: 30000 });
    await p.waitForTimeout(500);
    assert.ok(!(await heard(p)).includes('sfx-horn'), 'day 1 begins without it');
    await p.evaluate(() => { const f = window.__game.war.field; window.__day = f.day; window.__game.war.endTurn(); });
    await p.waitForFunction(() => { const f = window.__game.war.field; return f.turn === f.human && f.day > window.__day; }, null, { timeout: 60000 });
    await p.waitForTimeout(500);
    assert.ok(!(await heard(p)).includes('sfx-horn'), 'nor does day 2');
  } finally { stop(); }
  assert.deepEqual(p.errors, []);
});

test('a 单挑 that ends in a death plays the result phrase whoever fell; a retreat plays nothing', async () => {
  const r = await page.evaluate(async () => {
    const { duelEndSound } = await import('./src/tacticalhud.js');
    return { mineDied: duelEndSound({ dead: 1, winner: 2 }, false), foeDied: duelEndSound({ dead: 2, winner: 1 }, true), captured: duelEndSound({ captured: 1, winner: 2 }, false),
      fled: duelEndSound({ retreated: 1, winner: 2 }, false), foeFled: duelEndSound({ retreated: 2, winner: 1 }, true) };
  });
  assert.deepEqual(r, { mineDied: 'sfx-victory', foeDied: 'sfx-victory', captured: 'sfx-victory', fled: null, foeFled: null });
});

test('every sound with only an original file has a stand-in when the file is missing', async () => {
  const r = await page.evaluate(async () => {
    const { Audio } = await import('./src/audio.js'), m = await (await fetch('assets/manifest.json')).json(), a = new Audio({}, {});
    a.ctx = new AudioContext(); a.sfxGain = a.ctx.createGain();
    const out = {};
    for (const [k, list] of Object.entries(m.audio)) {
      if (!k.startsWith('sfx-') || ![].concat(list).every((f) => f.startsWith('assets/audio/original/'))) continue;
      let n = 0; for (const f of ['tone', 'noise', 'sweep']) a[f] = () => n++;
      a.sfx(k); out[k] = n;
    }
    return out;
  });
  assert.deepEqual(Object.keys(r).sort(), ['sfx-chime', 'sfx-duel-blow', 'sfx-duel-desperate', 'sfx-duel-ride', 'sfx-duel-swing', 'sfx-volley-land']);
  for (const [k, n] of Object.entries(r)) assert.ok(n > 0, `${k} has no stand-in`);
});

// The original plays 98×3 (the chime of the Namcot logo, 牵制's clash) the frame the ruler-select 秘技's twelfth key goes in
// (bank9 $DB30, traced: original-audio-trace/cheat.json); the remake had played the victory phrase.
test('the ruler-select 秘技 rings the original chime', async () => {
  const p = await game.open(); await spy(p);
  await skipIntro(p);
  await p.getByText('新的征程').click();
  await p.waitForSelector('.level'); await heard(p);
  for (let k = 0; k < 3; k++) for (const d of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) await p.keyboard.press(d);
  assert.deepEqual(await heard(p), ['sfx-chime']);
  assert.deepEqual(p.errors, []);
});

test('no page errors', () => assert.deepEqual(page.errors, []));
