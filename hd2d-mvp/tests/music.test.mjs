// 用可解码的短音频模拟不同曲库，检查真实页面的发现、切换与回退。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, newCampaign, skipIntro, closeMessages } from './game.mjs';

const scenes = ['title', 'select', 'strategy', 'battle', 'skirmish', 'duel', 'result', 'gameover', 'ending'];
const psScenes = new Set(['title', 'select', 'strategy', 'battle', 'skirmish', 'duel', 'ending']);
const sampleRate = 22050, frames = sampleRate / 2, wav = Buffer.alloc(44 + frames * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(frames * 2, 40);
for (let i = 0; i < frames; i++) wav.writeInt16LE(Math.round(6000 * Math.sin(2 * Math.PI * 440 * i / sampleRate)), 44 + i * 2);

let game;
before(async () => { game = await startGame(); });
after(() => game?.close());

function fixtures({ onlyPsTitle = false, legacy = false, corruptPsTitle = false, requests = [] } = {}) {
  return async (ctx) => {
    // 模拟静态托管：曲目由下面的 HEAD 拦截动态提供，不使用服务器磁盘的素材清单。
    await ctx.route('**/api/asset-availability', (route) => route.fulfill({ status: 404 }));
    await ctx.route(/\/assets\/audio\/(ps|original|remix)\//, async (route) => {
      const req = route.request(), path = new URL(req.url()).pathname.split('/assets/audio/')[1];
      const [set, file] = path.split('/'), match = /^bgm-(.+)\.(m4a|mp3)$/.exec(file);
      const exists = match && (set === 'original' ? match[2] === 'm4a' && scenes.includes(match[1])
        : set === 'ps' ? match[2] === (match[1] === 'ending' ? 'm4a' : 'mp3') && psScenes.has(match[1]) && (!onlyPsTitle || match[1] === 'title')
          : legacy && match[2] === 'mp3' && ['strategy', 'title'].includes(match[1]));
      if (!exists) return route.fulfill({ status: 404 });
      if (req.method() === 'HEAD') return route.fulfill({ status: 200 });
      requests.push(path);
      const body = corruptPsTitle && path === 'ps/bgm-title.mp3' ? Buffer.from('invalid audio') : wav;
      return route.fulfill({ status: 200, contentType: 'audio/wav', body });
    });
  };
}

async function playing(page, key, url) {
  await page.waitForFunction(({ key, url }) => {
    const a = window.__game.audio;
    return a.bgmKey === key && a.bgm?.src && a.bufs.has(url);
  }, { key, url }, { timeout: 15000 });
}

test('页面切换、保存音乐版本并在进入游戏时切换场景', async () => {
  const page = await game.open('', { setup: fixtures() });
  await skipIntro(page);
  await playing(page, 'bgm-title', 'assets/audio/ps/bgm-title.mp3');
  assert.deepEqual(await page.evaluate(() => window.__game.audio.sets.map(({ id }) => id)), ['ps', 'original']);
  await page.locator('.sysmenu-btn').click();
  await page.locator('.sysmenu-list button', { hasText: '曲目 PS 复刻' }).click();
  await playing(page, 'bgm-title', 'assets/audio/original/bgm-title.m4a');
  assert.equal(await page.evaluate(() => localStorage.getItem('hd2d-music')), 'original');
  await page.locator('.sysmenu-btn').click();

  await page.getByText('新的征程').click();
  await playing(page, 'bgm-select', 'assets/audio/original/bgm-select.m4a');
  await page.reload();
  await page.waitForFunction(() => window.__game?.debug);
  await skipIntro(page);
  assert.equal(await page.evaluate(() => window.__game.audio.set), 'original');
  await playing(page, 'bgm-title', 'assets/audio/original/bgm-title.m4a');
  await newCampaign(page, '曹操');
  await playing(page, 'bgm-strategy', 'assets/audio/original/bgm-strategy.m4a');
  await page.evaluate(() => {
    const { g, debug } = window.__game, c = g.cities[14], to = g.cities[12];
    for (const id of [...c.officers, ...to.officers]) g.officers[id].soldiers ||= 500;
    const ids = c.officers.slice(0, 3);
    debug.fieldWar(debug.setupWar(g, { from: 14, to: 12, ids, commander: ids[0], gold: 100, rice: 400 }), 'att');
  });
  await playing(page, 'bgm-battle', 'assets/audio/original/bgm-battle.m4a');
  await page.waitForFunction(() => window.__game.war?.finishDeploy, null, { timeout: 30000 });
  const stop = closeMessages(page);
  try {
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.__game.war.finishDeploy());
    await page.waitForFunction(() => { const w = window.__game.war; return w.field.turn === w.field.human && !w.st.busy; }, null, { timeout: 30000 });
    await page.evaluate(() => {
      const w = window.__game.war, f = w.field;
      for (const unit of f.side(f.human)) { unit.fate = 'dead'; unit.gone = true; }
      f.end(f.human, 'commander'); w.endTurn();
    });
    await playing(page, 'bgm-result', 'assets/audio/original/bgm-result.m4a');
  } finally { stop(); }
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('每个场景选择本版本曲目，缺少的 PS 曲目回退到对应原版', async () => {
  const page = await game.open('', { setup: fixtures() });
  await skipIntro(page);
  for (const set of ['ps', 'original']) {
    await page.evaluate((id) => window.__game.audio.setMusicSet(id), set);
    for (const scene of scenes) {
      const key = `bgm-${scene}`;
      const expected = set === 'ps' && psScenes.has(scene) ? `assets/audio/ps/${key}.${scene === 'ending' ? 'm4a' : 'mp3'}` : `assets/audio/original/${key}.m4a`;
      await page.evaluate((k) => window.__game.audio.playBgm(k), key);
      await playing(page, key, expected);
    }
  }
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('战斗曲在切换画面前开始读取，慢请求不阻塞布阵也不重复下载', { timeout: 60000 }, async () => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const page = await game.open('&flat', { setup: async ctx => {
    await fixtures()(ctx);
    await ctx.route('**/ps/bgm-battle.mp3', async route => {
      if (route.request().method() === 'HEAD') return route.fallback();
      await held;
      await route.fulfill({ status: 200, contentType: 'audio/wav', body: wav }).catch(() => {});
    });
  } });
  try {
    await newCampaign(page);
    await page.evaluate(() => {
      const { g, audio, debug } = window.__game;
      audio.setMuted(false, false);
      const fetchFile = window.fetch;
      window.battleMusicStarts = [];
      window.fetch = (url, ...args) => {
        if (url === 'assets/audio/ps/bgm-battle.mp3') window.battleMusicStarts.push(audio.bgmKey);
        return fetchFile(url, ...args);
      };
      const chest = id => ({ ids: [id], gold: 100, rice: 500 });
      for (const id of [40, 43]) g.officers[id].soldiers = 700;
      void debug.fieldWar({ city: 11, from: 4, attacker: 4, defender: 0, day: 1, att: chest(40), def: chest(43) }, 'att');
    });
    await page.getByRole('button', { name: '布阵完成' }).click();
    await page.waitForFunction(() => !window.__game.war.st.deploying && window.__game.audio.bgmKey === 'bgm-battle');
    assert.equal(await page.evaluate(() => !!window.__game.audio.bgm?.src), false);
    release();
    await playing(page, 'bgm-battle', 'assets/audio/ps/bgm-battle.mp3');
    assert.deepEqual(await page.evaluate(() => window.battleMusicStarts), ['bgm-strategy']);
    assert.deepEqual(page.errors, []);
  } finally { release(); await page.context().close(); }
});

test('只有标题曲时仍可选 PS；旧 Remix 选择和坏文件回退保持兼容', async () => {
  const requests = [];
  const page = await game.open('', { setup: async (ctx) => {
    await ctx.addInitScript(() => localStorage.setItem('hd2d-music', 'remix'));
    await fixtures({ onlyPsTitle: true, legacy: true, corruptPsTitle: true, requests })(ctx);
  } });
  await skipIntro(page);
  assert.deepEqual(await page.evaluate(() => window.__game.audio.sets.map(({ id, label }) => [id, label])),
    [['ps', 'PS 复刻'], ['remix', 'Remix'], ['original', '原版']]);
  assert.equal(await page.evaluate(() => window.__game.audio.set), 'remix');
  await playing(page, 'bgm-title', 'assets/audio/remix/bgm-title.mp3');
  await page.evaluate(() => window.__game.audio.setMusicSet('ps'));
  await playing(page, 'bgm-title', 'assets/audio/remix/bgm-title.mp3');
  assert.ok(requests.includes('ps/bgm-title.mp3'), '解码失败时先尝试所选版本');
  assert.equal(await page.evaluate(() => window.__game.audio.set), 'ps');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('白兵进入单挑时切换对应音乐', async () => {
  const page = await game.open('', { setup: fixtures() });
  await page.evaluate(() => { window.__game.debug.quickTactical(153, 191, 2, { human: 'a' }); });
  await page.waitForSelector('.tq-form', { timeout: 60000 });
  await playing(page, 'bgm-skirmish', 'assets/audio/ps/bgm-skirmish.mp3');
  await page.locator('.tq-form').first().click();
  await page.locator('.tq-deploy:not(.arming)').click();
  await page.waitForSelector('.tq-start button', { timeout: 30000 });
  await page.locator('.tq-start button:not(.arming)').click();
  await page.evaluate(() => window.__tq.startDuel('a'));
  await playing(page, 'bgm-duel', 'assets/audio/ps/bgm-duel.mp3');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

for (const [type, key, path] of [['gameover', 'gameover', 'original/bgm-gameover.m4a'], ['unify', 'ending', 'ps/bgm-ending.m4a']]) {
  test(`${type} 结局使用对应场景的曲目`, async () => {
    const page = await game.open('', { setup: fixtures() });
    await newCampaign(page, '刘备');
    await page.evaluate((type) => {
      const { g, G } = window.__game;
      g.over = type === 'unify' ? { type, score: G.unificationScore(g) } : { type };
    }, type);
    await page.locator('.endturn button').click();
    await page.locator('.modal .btn.primary').click();
    await playing(page, `bgm-${key}`, `assets/audio/${path}`);
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
}
