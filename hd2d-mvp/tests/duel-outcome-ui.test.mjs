import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, skipIntro } from './game.mjs';

let game, page;
before(async () => {
  game = await startGame(); page = await game.open('', { clock: true });
  await skipIntro(page);
  await page.evaluate(() => {
    // 读取场景实际显示的动作帧，而不是从结算参数推断演出结果。
    window.__duelOutcomeTest = async ({ left, right, loser, outcome }) => {
      const { G, debug } = window.__game, { Tactical } = await import('./src/core/tactical.js');
      const g = G.newGame(4, 1, 3);
      // 素材超时使用真实时钟，只加速已经就绪的单挑演出。
      window.__timeScale(1);
      const battle = new Tactical(g, left, right, 2, G.rng(g), { human: 'a' }); battle.deploy();
      await debug.loadOfficerSprites([left, right], g, battle, { a: 'attacker', d: 'defender' });
      await debug.loadOfficerSprites([left, right], g);
      window.__timeScale(4);
      const view = debug.duelView;
      view.setPlace({ month: 2, city: 12, siege: null }); view.setFx(true); debug.show('dview');
      await view.enter(battle, { a: 'attacker', d: 'defender' });
      const x = view.probe(loser).x;
      const rider = view.scene.children.find((object) => object.isGroup && Math.abs(object.position.x - x) < 0.001
        && object.children.some((child) => child.geometry?.type === 'RingGeometry'));
      if (!rider) throw new Error('未找到失败方骑乘图层');
      const before = new Set(view.scene.children), riderFrames = new Set(), footFrames = new Set(), groundFrames = new Set();
      const key = loser === 237 ? null : loser === 38 ? '38' : loser === left ? 'attacker' : 'defender';
      let sideMeta, extraMeta, sideImage, extraImage;
      if (key) {
        sideMeta = await (await fetch(`assets/ai/sprites/duel/${key}.json`)).json();
        extraMeta = await (await fetch(`assets/ai/sprites/duel/${key}-c.json`)).json();
        const imageOf = (meta) => {
          const cols = Math.min(meta.frames.length, Math.floor(2048 / meta.cell[0]));
          const rows = Math.ceil(meta.frames.length / cols);
          return rider.children.find((child) => child.material?.map?.image?.width === cols * meta.cell[0]
            && child.material.map.image.height === rows * meta.cell[1])?.material.map.image;
        };
        sideImage = imageOf(sideMeta); extraImage = imageOf(extraMeta);
        if (!sideImage || !extraImage) throw new Error(`缺少 ${key} 单挑动作图`);
      }
      const frame = (map, meta) => {
        const cols = Math.round(1 / map.repeat.x), rows = Math.round(1 / map.repeat.y);
        const i = Math.round(map.offset.x * cols) + (rows - 1 - Math.round(map.offset.y * rows)) * cols;
        return meta.frames[i];
      };
      const sample = () => {
        const state = view.probe(loser); if (rider.visible && state?.frame) riderFrames.add(state.frame);
        for (const group of view.scene.children) if (!before.has(group) && group.isGroup && group.visible) {
          for (const child of group.children) {
            const map = child.material?.map;
            if (!child.visible || !map) continue;
            if (map.image === extraImage) footFrames.add(frame(map, extraMeta));
            if (map.image === sideImage) groundFrames.add(frame(map, sideMeta));
          }
        }
      };
      const timer = setInterval(sample, 20), winner = loser === left ? right : left;
      try {
        await view.finish(outcome === 'dead' ? { dead: loser, winner }
          : outcome === 'captured' ? { captured: loser, winner } : { retreated: loser, winner });
        sample();
      } finally { clearInterval(timer); }
      const fallen = view.scene.getObjectByName('duel-fallen-rider');
      const fallenImage = fallen?.children.find(child => child.visible && child.material?.map)?.material.map.image;
      return { riderFrames: [...riderFrames], footFrames: [...footFrames], groundFrames: [...groundFrames], visible: rider.visible,
        fallen: !!fallen, matchesMounted: !!fallenImage && rider.children.some(child => child.material?.map?.image === fallenImage),
        guards: view.scene.children.filter(group => group.name === 'duel-capture-guard').length };
    };
  });
});
after(() => game?.close());

for (const side of ['左', '右']) test(`${side}侧阵亡只播放倒地，不出现被俘或骑马离场`, { timeout: 60000 }, async () => {
  const r = await page.evaluate((side) => window.__duelOutcomeTest({ left: side === '左' ? 51 : 38,
    right: side === '右' ? 51 : 38, loser: 51, outcome: 'dead' }), side);
  assert.ok(r.footFrames.includes('man_hit'), `没有落地动作：${r.footFrames}`);
  assert.ok(r.groundFrames.includes('downed'), `没有阵亡倒地帧：${r.groundFrames}`);
  assert.ok(!r.footFrames.includes('man_struggle') && !r.footFrames.includes('man_kneel'), `阵亡不应出现俘虏动作：${r.footFrames}`);
  assert.ok(!r.riderFrames.some((f) => f.startsWith('loose_') || f.startsWith('quarter_flee')), `阵亡不应出现离场动作：${r.riderFrames}`);
  assert.equal(r.visible, false, '落马后骑乘图层应退场');
  assert.equal(r.guards, 0, '阵亡不应出现护卫');
});

test('被俘仍有跪伏与空马离场，撤退仍播放败走动作', { timeout: 60000 }, async () => {
  const capture = await page.evaluate(() => window.__duelOutcomeTest({ left: 38, right: 51, loser: 51, outcome: 'captured' }));
  assert.ok(capture.footFrames.includes('man_kneel'), `被俘应跪伏：${capture.footFrames}`);
  assert.ok(capture.riderFrames.some((f) => f.startsWith('loose_')), `被俘后的空马离场：${capture.riderFrames}`);
  const retreat = await page.evaluate(() => window.__duelOutcomeTest({ left: 38, right: 51, loser: 51, outcome: 'retreated' }));
  assert.ok(retreat.riderFrames.includes('slump'), `退却应先示意败走：${retreat.riderFrames}`);
  assert.ok(!retreat.footFrames.includes('man_kneel') && !retreat.groundFrames.includes('downed'));
});

test('自定义动作没有空马图时阵亡不再出现骑马逃走', { timeout: 60000 }, async () => {
  const r = await page.evaluate(() => window.__duelOutcomeTest({ left: 38, right: 237, loser: 237, outcome: 'dead' }));
  assert.ok(r.fallen && r.matchesMounted, '单张格图的倒地应继续使用同一人物素材');
  assert.ok(!r.riderFrames.includes('idle_a') && !r.riderFrames.includes('loose_1'), `落马后不能继续骑乘：${r.riderFrames}`);
  assert.equal(r.visible, false);
  assert.equal(r.guards, 0);
});

test('黄祖与吕布的坐骑同尺度，蔡瑁被俘时护卫站在倒地人物轮廓之外', { timeout: 90000 }, async () => {
  const phone = await game.open('&phone&flat', { clock: true });
  try {
    await phone.setViewportSize({ width: 844, height: 390 });
    const results = await phone.evaluate(async () => {
      const { G, debug } = window.__game, { Tactical } = await import('./src/core/tactical.js');
      const g = G.newGame(4, 1, 3), view = debug.duelView, looks = { a: 'attacker', d: 'defender' };
      const id = name => G.data().officers.find(o => o.name === name).id;
      const lu = id('吕布'), cases = [[id('黄祖'), true, false], [id('蔡瑁'), false, true]];
      const output = [], canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
      // 从正在显示的纹理单元取像素并换算到场景坐标，包含空白、翻面和接地偏移。
      function extent(group) {
        const mesh = group.children.find(child => child.visible && child.material?.map);
        const map = mesh.material.map, image = map.image;
        const width = canvas.width = Math.round(image.width * map.repeat.x);
        const height = canvas.height = Math.round(image.height * map.repeat.y);
        ctx.drawImage(image, Math.round(image.width * map.offset.x), Math.round(image.height * (1 - map.offset.y - map.repeat.y)),
          width, height, 0, 0, width, height);
        const rgba = ctx.getImageData(0, 0, width, height).data;
        let solidTop = height, feet = -1, left = width, right = -1;
        for (let y = 0; y < height; y++) {
          let run = 0;
          for (let x = 0; x < width; x++) {
            if (rgba[(y * width + x) * 4 + 3] < 128) { run = 0; continue; }
            if (++run >= 9) solidTop = Math.min(solidTop, y);
            if (run >= 4) feet = y;
            left = Math.min(left, x); right = Math.max(right, x);
          }
        }
        const u = mesh.geometry.parameters.height / height, center = group.position.x + mesh.position.x;
        const xs = [left, right + 1].map(x => center + (x - width / 2) * u * Math.sign(mesh.scale.x)).sort((a, b) => a - b);
        return { height: (feet - solidTop + 1) * u, feet: group.position.y + mesh.position.y + (height / 2 - feet - 1) * u,
          x: group.position.x, xs, image, face: Math.sign(mesh.scale.x) };
      }
      for (const [opponent, left, captured] of cases) {
        window.__timeScale(1);
        g.officers[opponent].soldiers = g.officers[lu].soldiers = 600;
        const battle = new Tactical(g, left ? opponent : lu, left ? lu : opponent, 2, G.rng(g), { human: 'a' });
        battle.deploy();
        await debug.loadOfficerSprites([opponent, lu], g, battle, looks);
        window.__timeScale(3);
        view.setPlace({ month: 2, city: 12, siege: null }); debug.show('dview');
        await view.enter(battle, looks);
        const group = id => {
          view.pose(id, 'idle_a');
          const { x } = view.probe(id);
          return view.scene.children.find(node => node.isGroup && node.position.x === x
            && node.children.some(child => child.geometry?.type === 'RingGeometry'));
        };
        const rider = group(opponent), mounted = extent(rider), foe = extent(group(lu));
        await view.finish({ [captured ? 'captured' : 'dead']: opponent, winner: lu });
        const fallen = extent(view.scene.getObjectByName('duel-fallen-rider'));
        const guards = view.scene.children.filter(node => node.name === 'duel-capture-guard').map(node => node.position.x).sort((a, b) => a - b);
        output.push({ mounted: mounted.height, foe: foe.height, feet: mounted.feet, foeFeet: foe.feet, face: mounted.face,
          left, captured, fallen: fallen.height, width: fallen.xs[1] - fallen.xs[0], xs: fallen.xs, guards,
          sameSource: mounted.image === fallen.image, riderVisible: rider.visible });
      }
      return output;
    });
    for (const r of results) {
      assert.ok(Math.abs(r.mounted - r.foe) <= 0.12, JSON.stringify(r));
      assert.ok(Math.abs(r.feet - 0.25) < 0.035 && Math.abs(r.foeFeet - 0.25) < 0.06, JSON.stringify(r));
      assert.equal(r.face, r.left ? 1 : -1);
      assert.ok(r.fallen < r.mounted * 0.7 && r.width <= 2.46, JSON.stringify(r));
      assert.ok(r.sameSource && !r.riderVisible, JSON.stringify(r));
      if (r.captured) {
        assert.equal(r.guards.length, 2);
        assert.ok(r.guards[0] < r.xs[0] - 0.25 && r.guards[1] > r.xs[1] + 0.25, JSON.stringify(r));
      } else assert.deepEqual(r.guards, []);
    }
    assert.deepEqual(phone.errors, []);
  } finally { await phone.context().close(); }
});

test('单挑结算忧容解码期间仍显示上一张头像', { timeout: 90000 }, async () => {
  let unblock;
  const releaseGrief = new Promise(resolve => { unblock = resolve; });
  const griefImage = /\/characters\/(?:v2-)?huangzu\/grief\.webp$/;
  const current = await game.open('&phone&flat', { setup: ctx => ctx.route(griefImage, async route => {
    await releaseGrief;
    await route.continue();
  }) });
  try {
    await current.setViewportSize({ width: 844, height: 390 });
    await current.evaluate(async () => {
      (await import('./src/pace.js')).setPace(4);
      const { G, debug } = window.__game;
      const id = name => G.data().officers.find(o => o.name === name).id;
      void debug.quickTactical(id('吕布'), id('黄祖'), 2);
    });
    await current.locator('.tq-form').first().click();
    await current.locator('.tq-deploy').click();
    const start = current.getByRole('button', { name: /开始交战/ });
    await start.waitFor();
    await current.evaluate(() => {
      const battle = window.__tq, a = battle.gen('a'), d = battle.gen('d');
      for (let y = 1; y < 5; y++) {
        if (battle.units.some(u => u !== a && u !== d && u.y === y && [7, 8].includes(u.x))) continue;
        Object.assign(a, { x: 7, y }); Object.assign(d, { x: 8, y }); break;
      }
      battle.side.a.cmd.gen = 'advance';
      battle.side.d.hp = d.hp = 1; battle.r = () => 0;
      battle.g.noWarDeath = false; battle.queue.unshift(a);
    });
    await start.and(current.locator(':not(.arming)')).click();
    const attack = current.locator('.tq-duel-acts .dcmd', { hasText: '牵制' });
    const portrait = current.locator('.tq-dcard.r .tq-dface img');
    await attack.waitFor();
    await current.waitForFunction(() => document.querySelector('.tq-dcard.r .tq-dface img')?.naturalWidth > 0);
    const initial = await portrait.getAttribute('src');
    assert.match(initial, /huangzu\/calm\.webp$/);
    const grief = current.waitForRequest(griefImage);
    await attack.click();
    await grief;
    assert.equal(await portrait.getAttribute('src'), initial);
    assert.ok(await portrait.evaluate(img => img.complete && img.naturalWidth > 0));
    unblock();
    await current.waitForFunction(() => {
      const img = document.querySelector('.tq-dcard.r .tq-dface img');
      return /(?:v2-)?huangzu\/grief\.webp$/.test(img?.currentSrc) && img.naturalWidth > 0;
    });
    assert.deepEqual(current.errors, []);
  } finally {
    unblock();
    await current.context().close();
  }
});
