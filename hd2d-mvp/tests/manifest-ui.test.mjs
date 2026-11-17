import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { startGame } from './game.mjs';

let game;
before(async () => { game = await startGame(); });
after(() => game?.close());

test('素材清单优先批量检查，旧服务器仍按顺序回退并保留音乐选择', async () => {
  const page = await game.open();
  try {
    const results = await page.evaluate(async () => {
      const run = async (bulk) => {
        const requests = [], suffix = bulk ? 'bulk' : 'fallback';
        const first = `assets/test-${suffix}-missing`, second = `assets/test-${suffix}-present`;
        const third = `assets/test-${suffix}-alternative`, portrait = `assets/test-${suffix}-portrait`;
        const manifest = { portraits: { 1: [portrait] }, sprites: {}, audio: { 'bgm-title': [first, second, third] } };
        const actualFetch = window.fetch;
        window.fetch = async (url, options) => {
          requests.push([String(url), options?.method ?? 'GET']);
          if (url === 'assets/manifest.json') return new Response(JSON.stringify(manifest), { status: 200 });
          if (url === '/api/asset-availability') return new Response(bulk ? JSON.stringify({ [first]: false, [second]: true, [third]: true, [portrait]: true }) : '{}', { status: bulk ? 200 : 404 });
          return new Response(null, { status: url === first ? 404 : 200 });
        };
        try {
          const { loadManifest } = await import(`./src/assets.js?test-${suffix}`);
          return { found: await loadManifest(), requests };
        } finally { window.fetch = actualFetch; }
      };
      return [await run(true), await run(false)];
    });
    for (const [i, result] of results.entries()) {
      const suffix = i ? 'fallback' : 'bulk';
      assert.equal(result.found.portraits[1], `assets/test-${suffix}-portrait`);
      assert.equal(result.found.audio['bgm-title'], `assets/test-${suffix}-present`);
      assert.deepEqual(result.found.music['bgm-title'], [`assets/test-${suffix}-present`, `assets/test-${suffix}-alternative`]);
      assert.equal(result.requests.filter(([, method]) => method === 'HEAD').length, i ? 4 : 0);
    }
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});
