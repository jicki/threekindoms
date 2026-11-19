import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, newCampaign, closeMessages } from './game.mjs';

let game;
before(async () => { game = await startGame(); });
after(() => game?.close());

test('内置朝左素材在单挑两侧均面向对手，其他动作与正背面保持原样', { timeout: 120000 }, async () => {
  const page = await game.open('&flat', { clock: true, setup: (context) => context.addInitScript(() => sessionStorage.setItem('haou-hd2d-scenario', 'builtin-sovereigns')) });
  try {
    await newCampaign(page);
    const results = await page.evaluate(async () => {
      window.__timeScale(4);
      const { loadGridMotion } = await import('./src/assets.js');
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const read = (image, x, y) => { ctx.clearRect(0, 0, 512, 512); ctx.drawImage(image, x, y, 128, 128, 0, 0, 128, 128); return ctx.getImageData(0, 0, 128, 128).data; };
      const compare = (original, output, mirror) => {
        let bottom = -1;
        for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) if (original[(y * 128 + x) * 4 + 3] > 127) bottom = y;
        const shift = bottom < 0 ? 0 : Math.min(16, 127 - bottom); let diff = 0;
        for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
          const expected = y < shift ? false : original[((y - shift) * 128 + (mirror ? 127 - x : x)) * 4 + 3] > 127;
          if ((output[(y * 128 + x) * 4 + 3] > 127) !== expected) diff++;
        }
        return diff;
      };
      const keys = ['tianyu', 'qiaorui', 'huangzu', 'liuqi', 'xunyou', 'qianzhao', 'huangshi', 'zhurong'];
      const cases = [];
      const right = ['sun', 'zhen', 'diao', 'cai', 'wang', 'chen', 'gao', 'gongsun', 'yuanshu', 'liubiao', 'zhangzhao', 'zhanghong', 'zhangxiu'];
      for (const key of [...keys, ...right]) {
        const url = `assets/characters/${key}/motion.png`, img = await createImageBitmap(await (await fetch(url)).blob());
        const source = document.createElement('canvas'); source.width = source.height = 512;
        const sourceCtx = source.getContext('2d'); sourceCtx.imageSmoothingEnabled = false; sourceCtx.drawImage(img, 0, 0, 512, 512);
        const motion = await loadGridMotion(url, { mirrorSide: keys.includes(key), builtinSize: ['gongsun', 'yuanshu', 'liubiao'].includes(key) });
        const sourceSide = read(source, 0, 0), sourceFront = read(source, 0, 128), sourceBack = read(source, 256, 128);
        const outputSide = read(motion.duel.tex.image, 0, 0);
        const sourceStrike = read(source, 128, 256), outputStrike = read(motion.duel.tex.image, 7 * 128, 0);
        const outputFront = read(motion.march.tex.image, 5 * 128, 0), outputBack = read(motion.march.tex.image, 10 * 128, 0);
        const marchSide = read(motion.march.tex.image, 0, 0);
        cases.push({ key, side: compare(sourceSide, outputSide, keys.includes(key)), opposite: compare(sourceSide, outputSide, !keys.includes(key)), march: compare(sourceSide, marchSide, keys.includes(key)),
          strike: compare(sourceStrike, outputStrike, keys.includes(key)), front: compare(sourceFront, outputFront, false), back: compare(sourceBack, outputBack, false) });
        img.close(); motion.march.tex.dispose(); motion.duel.tex.dispose(); motion.duel.turn.tex.dispose();
      }
      const { G, debug } = window.__game, { Tactical } = await import('./src/core/tactical.js');
      const id = G.data().officers.find((o) => o.name === '刘琦').id, g = G.newGame(4, 1, 3);
      await debug.loadOfficerSprites([id, 38], g);
      const view = debug.duelView, placements = [];
      for (const left of [true, false]) {
        const battle = new Tactical(g, left ? id : 38, left ? 38 : id, 2, G.rng(g), { human: 'a' }); battle.deploy();
        view.setPlace({ month: 2, city: 12, siege: null }); debug.show('dview');
        await view.enter(battle, { a: 'attacker', d: 'defender' });
        const x = view.probe(id).x, rider = view.scene.children.find((o) => o.isGroup && Math.abs(o.position.x - x) < 0.001 && o.children.some((c) => c.geometry?.type === 'RingGeometry'));
        const body = rider.children.find((c) => c.material?.map && c.visible);
        const img = await createImageBitmap(await (await fetch('assets/characters/liuqi/motion.png')).blob());
        placements.push({ left, x, scale: body.scale.x, pixels: compare(read(img, 0, 0), read(body.material.map.image, 0, 0), true) });
        img.close();
      }
      return { cases, placements };
    });
    for (const item of results.cases) {
      // 这三张内置大图由不同浏览器解码接口缩放，边缘透明度可有细微差别。
      const tolerance = ['gongsun', 'yuanshu', 'liubiao'].includes(item.key) ? 900 : 0;
      for (const kind of ['side', 'march', 'strike', 'front', 'back']) assert.ok(item[kind] <= tolerance, `${item.key} ${kind} 动作差异 ${item[kind]}`);
      assert.ok(item.side < item.opposite, `${item.key} 侧面朝向错误`);
    }
    for (const item of results.placements) { assert.equal(item.pixels, 0, '实战应加载修正后的动作'); assert.equal(Math.sign(item.scale), item.left ? 1 : -1); assert.equal(Math.sign(item.x), item.left ? -1 : 1); }
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('三位新人物的单挑动作在左右两侧正确翻转，旧记录不会沿用新动作', { timeout: 120000 }, async () => {
  const page = await game.open('&flat', { clock: true });
  try {
    const cases = await page.evaluate(async () => {
      window.__timeScale(4);
      const { G, debug } = window.__game, { Tactical } = await import('./src/core/tactical.js');
      const { loadGridMotion } = await import('./src/assets.js');
      const g = G.newGame(4, 1, 3), view = debug.duelView, out = [];
      const canvas = Object.assign(document.createElement('canvas'), { width: 128, height: 128 });
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const frame = (img) => {
        ctx.clearRect(0, 0, 128, 128);
        ctx.drawImage(img, 0, 0, 128, 128, 0, 0, 128, 128);
        return ctx.getImageData(0, 0, 128, 128).data;
      };
      const sample = async (state, id, left, expected) => {
        await debug.loadOfficerSprites([id, 38], state);
        const b = new Tactical(state, left ? id : 38, left ? 38 : id, 2, G.rng(state), { human: 'a' });
        b.deploy();
        view.setPlace({ month: 2, city: 12, siege: null }); debug.show('dview');
        await view.enter(b, { a: 'attacker', d: 'defender' });
        const { x } = view.probe(id);
        const rider = view.scene.children.find((o) => o.isGroup && Math.abs(o.position.x - x) < 0.001
          && o.children.some((c) => c.geometry?.type === 'RingGeometry'));
        const body = rider.children.find((c) => c.material?.map && c.visible);
        return { left, x, scale: Math.sign(body.scale.x), matches: frame(body.material.map.image).every((v, i) => v === expected[i]) };
      };
      for (const [id, key] of [[262, 'zhangzhao'], [263, 'zhanghong'], [264, 'zhangxiu']]) {
        const asset = await loadGridMotion(`assets/characters/${key}/motion.png`);
        const expected = frame(asset.duel.tex.image);
        asset.march.tex.dispose(); asset.duel.tex.dispose(); asset.duel.turn.tex.dispose();
        const placements = [await sample(g, id, true, expected), await sample(g, id, false, expected)];
        if (id === 262) {
          const legacy = structuredClone(g);
          delete legacy.famousRoster;
          delete legacy.famousSkills;
          legacy.officers.length = id;
          legacy.clones = [id];
          legacy.officers.push({ ...legacy.officers[0], id });
          G.registerClones(legacy);
          const oldFrame = await sample(legacy, id, true, expected);
          G.registerClones(g);
          const restoredFrame = await sample(g, id, true, expected);
          out.push({ key, legacy: oldFrame.matches, restored: restoredFrame.matches });
        }
        out.push({ key, placements });
      }
      return out;
    });
    for (const item of cases) {
      if (!item.placements) {
        assert.equal(item.legacy, false, '旧分身应使用原本的通用动作');
        assert.equal(item.restored, true, '恢复新版之后应重新使用张昭动作');
        continue;
      }
      for (const pose of item.placements) {
        assert.equal(pose.matches, true, `${item.key} 必须使用自己的动作`);
        assert.equal(pose.scale, pose.left ? 1 : -1);
        assert.equal(Math.sign(pose.x), pose.left ? -1 : 1);
      }
    }
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('白兵将领前进、后退和攻击时朝向行动目标', { timeout: 120000 }, async () => {
  const page = await game.open('&flat', { setup: (context) => context.addInitScript(() => sessionStorage.setItem('haou-hd2d-scenario', 'builtin-sovereigns')) });
  try {
    await newCampaign(page);
    const result = await page.evaluate(async () => {
      const { G, debug, tview } = window.__game, { Tactical } = await import('./src/core/tactical.js');
      const id = G.data().officers.find((o) => o.name === '刘琦').id, g = G.newGame(4, 1, 3);
      for (const n of [id, 38]) g.officers[n].soldiers = 500;
      await debug.loadOfficerSprites([id, 38], g);
      const b = new Tactical(g, id, 38, 2, G.rng(g), { human: 'a' }); b.deploy();
      tview.setPlace({ month: 2, city: 12 }); await tview.ready(); debug.show('tview');
      tview.build(b, { a: 'attacker', d: 'defender' }); tview.setSpeed(4);
      const u = b.gen('a'), foe = b.gen('d'); let group;
      tview.scene.traverse((obj) => {
        if (obj.isGroup && obj.children.some((c) => c.element?.classList.contains('gen') && c.element?.classList.contains('attacker'))) group = obj;
      });
      if (!group) throw Error('找不到白兵将领');
      const body = group.children.find((c) => c.isGroup && c.children.some((h) => h.isGroup && h.children.some((p) => p.material?.map)));
      const holder = body.children[0], plane = holder.children.find((o) => o.material?.map && o.material?.colorWrite !== false);
      const sample = () => ({ scale: Math.sign(plane.scale.x), visible: plane.visible });
      const out = [sample()];
      for (const dx of [-1, 1]) {
        const from = [u.x, u.y], to = [u.x + dx, u.y];
        await tview.play({ type: 'move', u, from, to }, {}); await tview.settle(); [u.x, u.y] = to;
        out.push(sample());
      }
      foe.x = u.x - 1; foe.y = u.y;
      await tview.play({ type: 'attack', u, t: foe, dmg: 0, ranged: false, kill: false }, {});
      out.push(sample());
      return out;
    });
    assert.deepEqual(result, [1, -1, 1, -1].map((scale) => ({ scale, visible: true })));
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

for (const [query, label] of [['&flat', '平面'], ['', '三维']]) test(`${label}战场纵向行军时面朝行进方向`, { timeout: 120000 }, async () => {
  const page = await game.open(query);
  try {
    await page.evaluate(async () => { (await import('./src/pace.js')).setPace(4); (await import('./src/vignette.js')).setVignettes(false); });
    await newCampaign(page);
    await page.evaluate(() => {
      const { g, G, debug } = window.__game, home = g.factions[g.player].city;
      const to = G.roads(home).map((id) => g.cities[id]).find((city) => city.faction !== g.player && city.faction !== G.NONE && city.officers.length);
      for (const id of [...g.cities[home].officers, ...to.officers]) g.officers[id].soldiers ||= 500;
      const ids = g.cities[home].officers.slice(0, 2);
      debug.fieldWar(debug.setupWar(g, { from: home, to: to.id, ids, commander: ids[0], gold: 100, rice: 400 }), 'att');
    });
    const stop = closeMessages(page);
    try {
      await page.waitForFunction(() => window.__game.war?.st.deploying && document.body.dataset.screen === 'war', null, { timeout: 60000 });
      await page.evaluate(() => window.__game.war.finishDeploy());
      await page.waitForFunction(() => {
        const w = window.__game.war;
        return w.myTurn && !w.st.deploying && !w.st.busy && !document.querySelector('.banner,.shade,#fade.on');
      }, null, { timeout: 30000 });
      const target = await page.evaluate(() => {
        const w = window.__game.war, f = w.field, u = f.side(f.human)[0];
        w.clickCell(u.x, u.y);
        for (const dy of [1, -1]) if (w.st.reach.dist.has(`${u.x},${u.y + dy}`) && !f.unitAt(u.x, u.y + dy)) return { id: u.id, x: u.x, y: u.y + dy, dy };
        return null;
      });
      assert.ok(target, '需要可沿纵向移动的地格');
      const state = await page.evaluate(async ({ id, x, y, flat }) => {
        const w = window.__game.war;
        await w.clickCell(x, y);
        const v = w.flatState().units.find((item) => item.u.id === id);
        const meta = await (await fetch(`assets/ai/sprites/march/${id}.json`)).json();
        const state = { frame: meta.frames[Math.round(v.sx / v.cw)], flip: v.flip, yaw: w.probe().view.yaw, directions: [] };
        if (flat) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          w.faceToward(v.u, dx, dy); state.directions.push(w.facing(v.u));
        }
        return state;
      }, { ...target, flat: !!query });
      if (query) assert.match(state.frame, target.dy > 0 ? /^front_/ : /^back_/, JSON.stringify(state));
      else {
        // 三维地图可能根据战场朝向选择其他斜向视角；按投影方向判断，而非假设某个固定朝向。
        const right = -target.dy * Math.sin(state.yaw), forward = target.dy * Math.cos(state.yaw);
        const angle = Math.atan2(Math.abs(right), forward);
        const expected = angle < 0.6 ? 'front' : angle > 2.55 ? 'back' : 'side';
        assert.ok(state.frame.startsWith(`${expected}_`), JSON.stringify({ expected, ...state }));
        if (Math.abs(right) > 0.08) assert.equal(state.flip, Math.sign(right));
      }
      if (query) {
        assert.deepEqual(state.directions.map((item) => item.row?.split('_')[0]), ['side', 'side', 'front', 'back']);
        assert.deepEqual(state.directions.slice(0, 2).map((item) => item.flip), [1, -1]);
      }
      assert.deepEqual(page.errors, []);
    } finally { stop(); }
  } finally { await page.context().close(); }
});
