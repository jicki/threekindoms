import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, newCampaign, closeMessages } from './game.mjs';

let game;
before(async () => { game = await startGame(); });
after(() => game?.close());

for (const [key, file] of [['sfx-clash', 'assets/audio/sfx-clash.mp3'], ['sfx-volley-land', 'assets/audio/original/sfx-volley-land.m4a']]) test(`${key} 首次音效加载较慢时及时回退，素材就绪后不补放过期声音`, async () => {
  const page = await game.open('', { setup: async (context) => {
    await context.route(`**/${file}`, async (route) => {
      if (route.request().method() !== 'HEAD') await new Promise((resolve) => setTimeout(resolve, 700));
      await route.continue();
    });
  } });
  try {
    const result = await page.evaluate(async ({ key, file }) => {
      const { Audio } = await import('./src/audio.js'), a = new Audio({ [key]: file });
      a.ensureCtx(); await a.ctx.resume();
      let fallbacks = 0; const fallback = a.sfxFallback.bind(a);
      a.sfxFallback = (key) => { fallbacks++; fallback(key); };
      const original = a.ctx.createBufferSource.bind(a.ctx), played = [];
      a.ctx.createBufferSource = () => {
        const source = original(), start = source.start.bind(source);
        source.start = (...args) => { played.push(source.buffer); return start(...args); };
        return source;
      };
      a.sfx(key);
      await new Promise((resolve) => setTimeout(resolve, 180));
      const initial = fallbacks, audible = played.length;
      const sample = await a.preload(key);
      await new Promise((resolve) => setTimeout(resolve, 30));
      const stale = played.filter((buffer) => buffer === sample).length;
      a.sfx(key); await new Promise((resolve) => setTimeout(resolve, 30));
      const cached = played.filter((buffer) => buffer === sample).length;
      await a.ctx.close();
      return { initial, audible, stale, cached, fallbacks };
    }, { key, file });
    assert.equal(result.initial, 1, '碰撞加载尚未完成时应播放回退');
    assert.ok(result.audible > 0, '回退应实际启动音频源');
    assert.equal(result.stale, 0, '延迟素材完成后不能补放旧动作');
    assert.equal(result.cached, 1, '下次动作应使用已解码素材');
    assert.equal(result.fallbacks, 1);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

for (const delay of [0, 180]) test(`碰撞素材在${delay ? '超时后' : '超时前'}失败只回退一次并可重试`, async () => {
  let fail = true;
  const page = await game.open('', { setup: async (context) => {
    await context.route('**/assets/audio/sfx-clash.mp3', async (route) => {
      if (route.request().method() !== 'HEAD' && fail) {
        fail = false; if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        return route.fulfill({ status: 503 });
      }
      await route.continue();
    });
  } });
  try {
    const result = await page.evaluate(async () => {
      const { Audio } = await import('./src/audio.js'), a = new Audio({ 'sfx-clash': 'assets/audio/sfx-clash.mp3' });
      a.ensureCtx(); await a.ctx.resume();
      let fallbacks = 0; const fallback = a.sfxFallback.bind(a);
      a.sfxFallback = (key) => { fallbacks++; fallback(key); };
      a.sfx('sfx-clash'); await a.cache['sfx-clash'].catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 120));
      const first = fallbacks, cleared = !a.cache['sfx-clash'];
      const sample = await a.preload('sfx-clash'); a.sfx('sfx-clash');
      await new Promise((resolve) => setTimeout(resolve, 120)); await a.ctx.close();
      return { first, cleared, fallbacks, duration: sample.duration };
    });
    assert.equal(result.first, 1); assert.equal(result.fallbacks, 1);
    assert.equal(result.cleared, true); assert.ok(result.duration > 0);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('马蹄、步伐与弓箭落点回退在中高频仍可听，静音通道保持静音', async () => {
  const page = await game.open();
  try {
    const result = await page.evaluate(async () => {
      const { Audio } = await import('./src/audio.js'), out = {};
      for (const key of ['sfx-step', 'sfx-footstep', 'sfx-volley-land', 'muted']) {
        const ctx = new OfflineAudioContext(1, 12000, 48000), a = new Audio({});
        a.ctx = ctx; a.sfxGain = ctx.createGain(); a.sfxGain.gain.value = key === 'muted' ? 0 : 1;
        const filter = ctx.createBiquadFilter(); filter.type = 'highpass'; filter.frequency.value = 450;
        a.sfxGain.connect(filter).connect(ctx.destination); a.sfx(key === 'muted' ? 'sfx-step' : key);
        const samples = (await ctx.startRendering()).getChannelData(0);
        out[key] = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
      }
      return out;
    });
    for (const key of ['sfx-step', 'sfx-footstep', 'sfx-volley-land']) assert.ok(result[key] > 0.001, `${key} 输出过弱：${result[key]}`);
    assert.equal(result.muted, 0);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('白兵双方不同兵种实际近战命中时都触发碰撞音', { timeout: 120000 }, async () => {
  const page = await game.open();
  try {
    const result = await page.evaluate(async () => {
      const { tview, G, debug } = window.__game, { Tactical } = await import('./src/core/tactical.js');
      const g = G.newGame(4, 1, 3);
      for (const id of [38, 51]) Object.assign(g.officers[id], { soldiers: 1000, level: 8, war: 65 });
      const battle = new Tactical(g, 38, 51, 2, () => 0, { human: 'a' }); battle.deploy();
      tview.setPlace({ month: 2, city: 12 }); await tview.ready(); debug.show('tview');
      tview.build(battle, { a: 'attacker', d: 'defender' }); tview.setSpeed(4);
      const out = [];
      for (const side of ['a', 'd']) for (const kind of ['inf', 'arc', 'cav', 'gen']) {
        const u = battle.units.find((unit) => unit.side === side && unit.kind === kind);
        const t = battle.units.find((unit) => unit.side !== side && unit.kind === 'inf');
        if (!u || !t) throw new Error(`缺少 ${side} 方 ${kind} 单位`);
        Object.assign(u, { x: 7, y: 4 }); Object.assign(t, { x: 8, y: 4, hp: 1000, dead: false });
        const sounds = [], ev = battle.attack(u, t, false);
        await tview.play(ev, { sfx: (key) => sounds.push(key), update() {} }); await tview.settle();
        out.push({ side, kind, type: ev.type, ranged: ev.ranged, sounds });
      }
      return out;
    });
    assert.equal(result.length, 8);
    for (const row of result) {
      assert.equal(row.type, 'attack'); assert.equal(row.ranged, false);
      assert.deepEqual(row.sounds, ['sfx-clash'], `${row.side}/${row.kind}`);
    }
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

for (const [query, view] of [['&flat', '平面'], ['', '三维']]) test(`${view}战场双方计略实际损兵时播放受击声，失败及零损兵不重复播放`, { timeout: 180000 }, async () => {
  const page = await game.open(query);
  try {
    await page.evaluate(async () => { (await import('./src/pace.js')).setPace(4); (await import('./src/vignette.js')).setVignettes(false); });
    await newCampaign(page);
    await page.evaluate(() => {
      const { g, G, debug } = window.__game, home = g.factions[g.player].city;
      const target = G.roads(home).map((id) => g.cities[id]).find((city) => city.faction !== g.player && city.faction !== G.NONE && city.officers.length);
      for (const id of [...g.cities[home].officers, ...target.officers]) g.officers[id].soldiers = 500;
      const ids = g.cities[home].officers.slice(0, 2);
      debug.fieldWar(debug.setupWar(g, { from: home, to: target.id, ids, commander: ids[0], gold: 100, rice: 400 }), 'att');
    });
    const stop = closeMessages(page);
    try {
      await page.waitForFunction(() => window.__game.war?.finishDeploy && document.body.dataset.screen === 'war', null, { timeout: 60000 });
      await page.evaluate(() => window.__game.war.finishDeploy());
      await page.waitForFunction(() => window.__game.war.field.turn === window.__game.war.field.human, null, { timeout: 30000 });
      const results = await page.evaluate(async () => {
        const { FOREST, RIVER } = await import('./src/core/field.js');
        const w = window.__game.war, f = w.field, audio = window.__game.audio, original = audio.sfx, sounds = [], out = [];
        const a = f.side('att')[0], b = f.side('def')[0]; a.x = 10; a.y = 10; b.x = 11; b.y = 10;
        audio.sfx = (key) => sounds.push(key);
        try {
          for (const set of ['original', 'ps']) for (const side of ['att', 'def']) for (const id of [0, 3, 4]) {
            const me = side === 'att' ? a : b, foe = side === 'att' ? b : a;
            audio.setMusicSet(set); f.turn = side; f.pool[side] = 99; f.terr = () => id === 4 ? RIVER : FOREST; f.r = () => 0;
            Object.assign(f.O(me.id), { int: 95, level: 8 }); Object.assign(f.O(foe.id), { soldiers: 500, hp: 90 });
            sounds.length = 0;
            const res = f.cast(me, id, foe);
            await w.playStrategy(me, foe, id, res);
            out.push({ set, side, id, hit: res.hit, loss: res.hits.filter((h) => h.soldiers < 0).length, sounds: sounds.filter((key) => key !== 'sfx-horn') });
          }
          f.turn = 'att'; f.pool.att = 99; f.terr = () => FOREST; f.r = (n) => n === 256 ? 255 : 0;
          sounds.length = 0; const fail = f.cast(a, 0, b); await w.playStrategy(a, b, 0, fail);
          const failure = { hit: fail.hit, sounds: sounds.filter((key) => key !== 'sfx-horn') };
          sounds.length = 0;
          await w.playStrategy(a, b, 0, { ok: true, hit: true, name: '火计', lines: ['没有损兵'], hits: [{ u: b, soldiers: 0 }] });
          return { out, failure, noLoss: sounds.filter((key) => key !== 'sfx-horn') };
        } finally { audio.sfx = original; }
      });
      assert.equal(results.out.length, 12);
      for (const result of results.out) {
        assert.equal(result.hit, true); assert.ok(result.loss > 0, JSON.stringify(result));
        const effect = { 0: 'sfx-tactic-fire', 3: 'sfx-clash', 4: 'sfx-strategy-water' }[result.id];
        assert.deepEqual(result.sounds, effect === 'sfx-clash' ? ['sfx-clash'] : [effect, 'sfx-clash'], JSON.stringify(result));
      }
      assert.deepEqual(results.failure, { hit: false, sounds: [] });
      assert.deepEqual(results.noLoss, ['sfx-tactic-fire']);
      assert.deepEqual(page.errors, []);
    } finally { stop(); }
  } finally { await page.context().close(); }
});
