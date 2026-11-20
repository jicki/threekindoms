import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame } from './game.mjs';

let game;
before(async () => { game = await startGame(); });
after(() => game?.close());

test('手机白兵换装后使用对应动作，松弦才放箭，挥扇时出现风弧', { timeout: 90000 }, async () => {
  const page = await game.open('&flat&phone');
  try {
    await page.setViewportSize({ width: 568, height: 320 });
    const result = await page.evaluate(async () => {
      const { G, debug, tview } = window.__game;
      const { Tactical } = await import('./src/core/tactical.js');
      const { loadGridMotion } = await import('./src/assets.js');
      const g = G.newGame(4, 1, 7), officer = 237, enemy = 38, results = [];
      g.officers[officer].soldiers = g.officers[enemy].soldiers = 600;
      tview.setPlace({ month: 2, city: 12 }); await tview.ready();
      tview.setSpeed(2); debug.show('tview');
      const c = Object.assign(document.createElement('canvas'), { width: 128, height: 128 });
      const ctx = c.getContext('2d');
      const signature = (img) => {
        ctx.clearRect(0, 0, 128, 128);
        ctx.drawImage(img, 0, 0, 128, 128, 0, 0, 128, 128);
        return c.toDataURL();
      };
      const cases = [
        [32, 'bow', 'sun', 1], [34, 'fan', 'action-fan', -1],
        [0, 'sword', 'action-sword', 1], [8, 'blade', 'action-blade', 1],
        [18, 'spear', 'action-spear', 1], [32, 'bow', 'sun', -1],
      ];
      for (const [equip, style, folder, direction] of cases) {
        G.wearEquip(g, officer, equip);
        await debug.loadOfficerSprites([officer, enemy], g);
        const battle = new Tactical(g, officer, enemy, 2, () => 0, { human: 'a' });
        battle.deploy();
        const u = battle.gen('a'), t = battle.units.find(v => v.side === 'd' && v.kind !== 'gen');
        const distance = style === 'bow' ? 2 : 1;
        Object.assign(u, { x: 7, y: 3 });
        Object.assign(t, { x: 7 + direction * distance, y: 3 });
        battle.units = [u, t, battle.gen('d')];
        tview.build(battle, { a: 'attacker', d: 'defender' });
        let rider;
        tview.scene.traverse((node) => {
          if (node.isGroup && node.children.some((o) => o.element?.classList.contains('gen')
            && o.element.classList.contains('attacker'))) rider = node;
        });
        const body = rider.children.find((o) => o.isGroup && o.children.some(holder => holder.children.some(x => x.material?.map)));
        const card = body.children[0].children.find(o => o.material?.map && o.material?.colorWrite !== false);
        const asset = await loadGridMotion(`assets/characters/${folder}/motion.png`, { weapon: style });
        const matches = signature(card.material.map.image) === signature(asset.duel.tex.image);
        const { atlasCols, atlasRows, frames: names } = asset.duel.meta;
        asset.march.tex.dispose(); asset.duel.tex.dispose(); asset.duel.turn.tex.dispose();
        const item = { style, direction, matches };
        if (style === 'bow' || style === 'fan') {
          const target = battle.pickTarget(u, 'advance');
          const event = battle.attack(u, target.unit, target.ranged);
          const frames = new Set(), track = [], sounds = [];
          let effectFrame = null;
          const timer = setInterval(() => {
            const uv = card.material.map.offset;
            const frame = names[Math.round(uv.x * atlasCols) + (atlasRows - 1 - Math.round(uv.y * atlasRows)) * atlasCols];
            frames.add(frame);
            const arc = tview.scene.getObjectByName(style === 'bow' ? 'weapon-arrow' : 'weapon-fan-sweep');
            if (arc) { track.push(arc.position.x); effectFrame ??= frame; }
          }, 12);
          try { await tview.play(event, { sfx: key => sounds.push(key) }); await tview.settle(); }
          finally { clearInterval(timer); }
          Object.assign(item, { ranged: event.ranged, sounds, frames: [...frames], effect: track.length > 1, effectFrame,
            fly: Math.sign(track.at(-1) - track[0]), face: Math.sign(card.scale.x) });
        }
        results.push(item);
      }
      return results;
    });
    for (const item of result) {
      assert.equal(item.matches, true, JSON.stringify(item));
      if (!['bow', 'fan'].includes(item.style)) continue;
      const required = item.style === 'bow' ? ['bow_nock', 'bow_draw', 'bow_release'] : ['fan_ready', 'fan_sweep', 'fan_follow'];
      assert.ok(required.every(frame => item.frames.includes(frame)) && item.effect, JSON.stringify(item));
      if (item.style === 'bow') assert.equal(item.effectFrame, 'bow_release');
      assert.equal(item.face, item.direction);
      assert.equal(item.fly, item.direction);
      assert.equal(item.ranged, item.style === 'bow');
      assert.deepEqual(item.sounds, item.style === 'bow' ? ['sfx-tactic-xbow', 'sfx-volley-land'] : ['sfx-clash']);
    }
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('旧版扩展记录的装备驱动手机单挑的拉弓与挥扇，左右都在正确方向结算一次', { timeout: 90000 }, async () => {
  const page = await game.open('&phone', { clock: true });
  try {
    await page.setViewportSize({ width: 812, height: 375 });
    const result = await page.evaluate(async () => {
      window.__timeScale(3);
      const { G, debug } = window.__game, view = debug.duelView;
      const { Tactical } = await import('./src/core/tactical.js');
      const { tableDraws } = await import('./src/core/origrng.js');
      const legacy = G.newGame(4, 1, 7);
      delete legacy.famousSkills; delete legacy.famousRoster; legacy.officers.length = 262;
      const bow = 38, fan = 237;
      G.wearEquip(legacy, bow, 32); G.wearEquip(legacy, fan, 34);
      G.saveQuick(legacy);
      const g = G.loadQuick(), cases = [];
      await debug.loadOfficerSprites([bow, fan], g);
      for (const swapped of [false, true]) {
        const battle = new Tactical(g, swapped ? fan : bow, swapped ? bow : fan, 2, () => 0, { human: 'a' });
        battle.deploy(); const { duel } = battle.startDuel('a');
        view.setPlace({ month: 2, city: 12, siege: null }); debug.show('dview');
        await view.enter(battle, { a: 'attacker', d: 'defender' });
        for (const s of ['a', 'd']) {
          const fighter = duel.side[s], style = fighter.id === bow ? 'bow' : 'fan';
          const target = duel.side[s === 'a' ? 'd' : 'a'];
          fighter.F = 25; fighter.hp = target.hp = 99;
          const wantHit = !swapped, threshold = duel.threshold(s, 'attack');
          const cursor = Array.from({ length: 256 }, (_, i) => i).find(i => (tableDraws(() => i)(100) < threshold) === wantHit);
          duel.r = () => cursor;
          const before = view.probe(fighter.id).x, action = duel.act(s, 'attack');
          const effect = style === 'bow' ? 'weapon-arrow' : 'weapon-fan-sweep';
          const poses = new Set(), track = [], hits = [];
          const timer = setInterval(() => {
            poses.add(view.probe(fighter.id).frame);
            const object = view.scene.getObjectByName(effect);
            if (object) track.push(object.position.x);
          }, 10);
          try { await view.act(action, { hp: { [target.id]: target.hp }, onHit: (id, dmg) => hits.push({ id, dmg }) }); }
          finally { clearInterval(timer); }
          cases.push({ style, side: s, hit: action.hit, wantHit, hp: target.hp, damage: action.dmg, target: target.id, hits, poses: [...poses],
            start: Math.sign(before), end: Math.sign(view.probe(fighter.id).x), fly: Math.sign(track.at(-1) - track[0]) });
        }
      }
      return cases;
    });
    for (const item of result) {
      assert.equal(item.hit, item.wantHit, JSON.stringify(item));
      assert.deepEqual(item.hits, item.hit ? [{ id: item.target, dmg: item.damage }] : []);
      assert.equal(item.hp, 99 - item.damage);
      assert.equal(item.start, item.side === 'a' ? -1 : 1);
      assert.equal(item.end, item.start);
      assert.equal(item.fly, -item.start, JSON.stringify(item));
      const expected = item.style === 'bow' ? ['bow_nock', 'bow_draw', 'bow_release'] : ['fan_ready', 'fan_sweep', 'fan_follow'];
      assert.ok(expected.every(pose => item.poses.includes(pose)), JSON.stringify(item));
    }
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('原版换装继续使用原有单挑素材和音效', { timeout: 60000 }, async () => {
  const page = await game.open('&flat', { clock: true, setup: (context) => context.addInitScript(() => {
    sessionStorage.setItem('haou-hd2d-scenario', 'original');
  }) });
  const requests = [];
  page.on('request', (request) => { if (request.url().includes('/characters/action-')) requests.push(request.url()); });
  try {
    const result = await page.evaluate(async () => {
      const { G, debug, audio } = window.__game, { Tactical } = await import('./src/core/tactical.js');
      const view = debug.duelView, g = G.newGame(4, 1, 7), officer = 38, enemy = 51, textures = [];
      const sounds = [], previous = audio.sfx;
      audio.sfx = (key) => sounds.push(key);
      try {
        for (const equip of [8, 18]) {
          G.wearEquip(g, officer, equip);
          // 素材加载按真实时间计时，只有演出使用加速时钟。
          window.__timeScale(1);
          await debug.loadOfficerSprites([officer, enemy], g);
          window.__timeScale(4);
          const battle = new Tactical(g, officer, enemy, 2, () => 0, { human: 'a' });
          battle.deploy();
          view.setPlace({ month: 2, city: 12, siege: null }); debug.show('dview');
          await view.enter(battle, { a: 'attacker', d: 'defender' });
          const { x } = view.probe(officer);
          const rider = view.scene.children.find(o => o.isGroup && Math.abs(o.position.x - x) < 0.001
            && o.children.some(c => c.geometry?.type === 'RingGeometry'));
          textures.push(rider.children.find(c => c.visible && c.material?.map).material.map.image);
          await view.act({ by: officer, cmd: 'attack', hit: true, dmg: 10, self: 0 });
        }
        return { original: G.currentScenario() === 'original', sameTexture: textures[0] === textures[1], sounds };
      } finally { audio.sfx = previous; }
    });
    assert.equal(result.original, true);
    assert.equal(result.sameTexture, true);
    assert.equal(result.sounds.filter(key => key === 'sfx-duel-blow').length, 2);
    assert.ok(!result.sounds.includes('sfx-tactic-xbow'));
    assert.deepEqual(requests, []);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});
