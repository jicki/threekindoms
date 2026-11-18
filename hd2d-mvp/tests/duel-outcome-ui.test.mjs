import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, skipIntro } from './game.mjs';

let game, page;
before(async () => {
  game = await startGame(); page = await game.open('', { clock: true });
  await skipIntro(page);
  await page.evaluate(() => { window.__timeScale(4); });
  await page.evaluate(() => {
    // 读取场景实际显示的动作帧，而不是从结算参数推断演出结果。
    window.__duelOutcomeTest = async ({ left, right, loser, outcome }) => {
      const { G, debug } = window.__game, { Tactical } = await import('./src/core/tactical.js');
      const g = G.newGame(4, 1, 3);
      await debug.loadOfficerSprites([left, right], g);
      const battle = new Tactical(g, left, right, 2, G.rng(g), { human: 'a' }); battle.deploy();
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
      return { riderFrames: [...riderFrames], footFrames: [...footFrames], groundFrames: [...groundFrames], visible: rider.visible };
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
  assert.ok(r.riderFrames.includes('fall'), `没有落马动作：${r.riderFrames}`);
  assert.ok(!r.riderFrames.includes('idle_a') && !r.riderFrames.includes('loose_1'), `落马后不能继续骑乘：${r.riderFrames}`);
  assert.equal(r.visible, false);
});
