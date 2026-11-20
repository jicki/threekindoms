import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startGame } from './game.mjs';

test('单挑特写索引和贴图分别失败后，可在同页后续单挑重试', { timeout: 90000 }, async () => {
  const game = await startGame({ scenario: 'original' });
  try {
    let indexRequests = 0, closeupRequests = 0;
    const page = await game.open('&phone&flat', { setup: async ctx => {
      await ctx.route('**/duel/extra.json', route => ++indexRequests === 1 ? route.abort('failed') : route.continue());
      await ctx.route('**/duel/defender-c.png', route => ++closeupRequests === 1 ? route.abort('failed') : route.continue());
    } });
    const enter = () => page.evaluate(async () => {
      const { G, debug } = window.__game, view = debug.duelView;
      const { Tactical } = await import('./src/core/tactical.js');
      const g = G.newGame(4, 1, 7);
      await debug.loadOfficerSprites([38, 51], g);
      const battle = new Tactical(g, 38, 51, 2, G.rng(g), { human: 'a' });
      battle.deploy();
      view.setPlace({ month: 2, city: 12, siege: null });
      debug.show('dview');
      await view.enter(battle, { a: 'attacker', d: 'defender' });
      const x = view.probe(51).x;
      const rider = view.scene.children.find(node => node.isGroup && Math.abs(node.position.x - x) < 0.001
        && node.children.some(child => child.geometry?.type === 'RingGeometry'));
      const meta = await (await fetch('./assets/ai/sprites/duel/defender-c.json')).json();
      const cols = Math.min(meta.frames.length, Math.floor(2048 / meta.cell[0])), rows = Math.ceil(meta.frames.length / cols);
      const hasCloseup = rider.children.some(child => child.material?.map?.image?.width === cols * meta.cell[0]
        && child.material?.map?.image?.height === rows * meta.cell[1]);
      view.abort();
      return hasCloseup;
    });
    assert.equal(await enter(), false);
    assert.deepEqual([indexRequests, closeupRequests], [1, 0]);
    assert.equal(await enter(), false);
    assert.deepEqual([indexRequests, closeupRequests], [2, 1]);
    assert.equal(await enter(), true);
    assert.deepEqual([indexRequests, closeupRequests], [2, 2]);
    assert.equal(await enter(), true);
    assert.deepEqual([indexRequests, closeupRequests], [2, 2]);
    assert.deepEqual(page.errors, []);
  } finally { await game.close(); }
});
