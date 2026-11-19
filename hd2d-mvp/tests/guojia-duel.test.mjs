import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startGame } from './game.mjs';

let game;
before(async () => { game = await startGame({ scenario: 'builtin-sovereigns-expanded-map' }); });
after(() => game?.close());

for (const { side, phone, missing } of [
  { side: 'a', phone: false, missing: false },
  { side: 'd', phone: true, missing: false },
  { side: 'a', phone: false, missing: true },
]) {
  test(`郭嘉单挑 ${side} 方${phone ? '手机' : '桌面'}${missing ? '缺图回退' : '重制动作及攻击近景'}`, { timeout: 90000 }, async () => {
    const setup = missing ? ctx => ctx.route('**/duel/guojia-v2.png', route => route.fulfill({ status: 404, body: '' })) : undefined;
    const page = await game.open(phone ? '&phone&flat' : '&flat', { setup });
    try {
      if (phone) await page.setViewportSize({ width: 844, height: 390 });
      const loaded = new Set();
      page.on('response', response => { if (response.ok()) loaded.add(new URL(response.url()).pathname); });
      await page.evaluate(async (side) => {
        (await import('./src/pace.js')).setPace(4);
        const args = side === 'a' ? [24, 111] : [111, 24];
        void window.__game.debug.quickTactical(...args, 2, { human: side });
      }, side);
      await page.locator('.tq-form').first().click();
      await page.locator('.tq-deploy').click();
      const start = page.getByRole('button', { name: /开始交战/ });
      await start.waitFor();
      await page.evaluate((side) => {
        const battle = window.__tq, a = battle.gen('a'), d = battle.gen('d');
        for (let y = 1; y < 5; y++) if (!battle.units.some(u => u !== a && u !== d && u.y === y && [7, 8].includes(u.x))) {
          Object.assign(a, { x: 7, y }); Object.assign(d, { x: 8, y }); break;
        }
        battle.side[side].cmd.gen = 'advance';
        battle.queue.unshift(battle.gen(side));
      }, side);
      await start.click();
      await page.locator('.tq-duel-acts .dcmd.primary').waitFor({ timeout: 50000 });
      const result = await page.evaluate(async ({ missing }) => {
        const view = window.__game.debug.duelView;
        const pose = view.probe(24), foe = view.probe(111);
        const group = view.scene.children.find(node => node.isGroup && node.position.x === pose.x && node.position.y === pose.y);
        const rider = group.children.find(child => child.visible && child.material?.map && child.geometry?.type === 'PlaneGeometry');
        const image = rider.material.map.image;
        const initial = { x: pose.x, foe: foe.x, face: Math.sign(rider.scale.x), width: image.width, height: image.height };
        if (missing) return { initial };
        view.pose(24, 'idle_a');
        const row = document.createElement('canvas'); row.width = 176; row.height = 128;
        const ctx = row.getContext('2d');
        ctx.drawImage(image, 0, 0);
        const pixels = ctx.getImageData(0, 0, row.width, row.height).data;
        let top = row.height, bottom = -1;
        for (let y = 0; y < row.height; y++) for (let x = 0; x < row.width; x++) if (pixels[(y * row.width + x) * 4 + 3] > 127) {
          top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
        const hits = [], frames = new Set();
        const before = view.camera.position.z;
        let nearest = before;
        const timer = setInterval(() => {
          frames.add(view.probe(24).frame);
          nearest = Math.min(nearest, view.camera.position.z);
        }, 12);
        try {
          await view.act({ by: 24, cmd: 'attack', hit: true, dmg: 12, self: 0 }, { hp: { 111: 80 }, onHit: (id, dmg) => hits.push([id, dmg]) });
          await view.act({ by: 24, cmd: 'desperate', hit: true, dmg: 18, self: 0 }, { hp: { 111: 62 }, onHit: (id, dmg) => hits.push([id, dmg]) });
        } finally { clearInterval(timer); }
        const controls = document.querySelector('.tq-duel-acts').getBoundingClientRect();
        return { initial, top, bottom, hits, frames: [...frames], closer: before - nearest, home: view.probe(24).x,
          bodyHeight: rider.geometry.parameters.height * (bottom - top + 1) / row.height,
          buttonsFit: controls.left >= 0 && controls.right <= innerWidth + 1 && controls.bottom <= innerHeight + 1 };
      }, { missing });
      const has = suffix => [...loaded].some(path => path.endsWith(suffix));
      assert.ok(has('/characters/guojia/motion.png') && has('/duel/24.png') && has('/duel/111.png'));
      assert.equal(has('/duel/guojia-v2.png'), !missing);
      assert.equal(Math.sign(result.initial.x), side === 'a' ? -1 : 1);
      assert.equal(Math.sign(result.initial.foe), -Math.sign(result.initial.x));
      assert.equal(result.initial.face, -Math.sign(result.initial.x));
      if (missing) {
        assert.notEqual(result.initial.width, 1408);
        assert.ok(has('/duel/24-turn.png') && has('/duel/24-wheel.png'));
      } else {
        assert.deepEqual([result.initial.width, result.initial.height], [1408, 512]);
        assert.equal(result.bottom, 127, '待机帧的马蹄落在共同基线');
        assert.ok(result.bodyHeight >= 1.76 && result.bodyHeight <= 1.85, JSON.stringify(result));
        assert.deepEqual(result.hits, [[111, 12], [111, 18]]);
        assert.ok(result.frames.includes('strike') && result.frames.includes('follow'), JSON.stringify(result.frames));
        assert.ok(result.closer > 2 && result.home === result.initial.x, JSON.stringify(result));
        assert.equal(result.buttonsFit, true);
      }
      assert.deepEqual(page.errors, []);
    } finally { await page.context().close(); }
  });
}
