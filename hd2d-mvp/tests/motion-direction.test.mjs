import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, newCampaign } from './game.mjs';

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
      for (const key of [...keys, 'sun']) {
        const url = `assets/characters/${key}/motion.png`, img = await createImageBitmap(await (await fetch(url)).blob());
        const motion = await loadGridMotion(url, { mirrorSide: keys.includes(key) });
        const sourceSide = read(img, 0, 0), sourceFront = read(img, 0, 128);
        const outputSide = read(motion.duel.tex.image, 0, 0);
        const sourceStrike = read(img, 128, 256), outputStrike = read(motion.duel.tex.image, 7 * 128, 0);
        // 行军图中第 6 帧为正面站立。
        const outputFront = read(motion.march.tex.image, 5 * 128, 0);
        cases.push({ key, side: compare(sourceSide, outputSide, keys.includes(key)), strike: compare(sourceStrike, outputStrike, keys.includes(key)), front: compare(sourceFront, outputFront, false) });
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
    for (const item of results.cases) { assert.equal(item.side, 0, `${item.key} 侧面朝向`); assert.equal(item.strike, 0, `${item.key} 攻击方向`); assert.equal(item.front, 0, `${item.key} 正面动作`); }
    for (const item of results.placements) { assert.equal(item.pixels, 0, '实战应加载修正后的动作'); assert.equal(Math.sign(item.scale), item.left ? 1 : -1); }
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});
