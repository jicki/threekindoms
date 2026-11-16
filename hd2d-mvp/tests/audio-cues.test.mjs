// 实际资源、播放与失败恢复：内政和计略短曲随曲库选择，单挑音效通过独立音效通道播放。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, skipIntro, newCampaign, cmd } from './game.mjs';

let game;
before(async () => { game = await startGame(); });
after(() => game?.close());

const cues = ['cue-land', 'cue-industry', 'cue-town', 'cue-st-fire', 'cue-st-ruse', 'cue-st-lure', 'cue-st-trap'];
const effects = ['sfx-volley-land', 'sfx-duel-ride', 'sfx-duel-swing', 'sfx-chime', 'sfx-duel-desperate', 'sfx-duel-blow'];

test('实际短曲可在两个曲库中解码播放，结束后恢复背景音乐', async () => {
  const page = await game.open(); await skipIntro(page);
  const result = await page.evaluate(async ({ cues, effects }) => {
    const a = window.__game.audio;
    const { STRAT_CUE } = await import('./src/war/shared.js');
    if (STRAT_CUE.length !== 16 || STRAT_CUE.some((key) => !cues.includes(key))) throw new Error('地图计略缺少短曲');
    a.unlock();
    const wait = async (f) => { for (let i = 0; i < 200 && !f(); i++) await new Promise((r) => setTimeout(r, 25)); if (!f()) throw new Error('音频等待超时'); };
    const found = [], durations = {};
    for (const set of ['original', 'ps']) {
      a.setMusicSet(set);
      for (const cue of cues) {
        const url = `assets/audio/${set}/${cue}.m4a`;
        if (!a.music[cue]?.includes(url)) throw new Error(`未发现 ${url}`);
        if (!a.cue(cue)) throw new Error(`未播放 ${cue}`);
        await wait(() => !!a.cueing?.src);
        const buf = await a.cache[url];
        if (a.cueing.src.buffer !== buf) throw new Error(`选错版本 ${cue}`);
        found.push(`${set}/${cue}`); durations[`${set}/${cue}`] = buf.duration;
        a.stopCue();
      }
    }
    const played = [];
    for (const key of effects) {
      if (a.files[key] !== `assets/audio/original/${key}.m4a`) throw new Error(`未发现 ${key}`);
      const b = await a.preload(key), make = a.ctx.createBufferSource.bind(a.ctx); let src;
      a.ctx.createBufferSource = () => (src = make());
      try { a.sfx(key); await wait(() => !!src); } finally { a.ctx.createBufferSource = make; }
      if (src.buffer !== b || !b.duration || b.duration > 1.5) throw new Error(`音效异常 ${key}`);
      if (key === 'sfx-chime') {
        const samples = b.getChannelData(0), first = samples.findIndex((x) => Math.abs(x) > 60 / 32768);
        if (first < 0 || Math.abs(first / b.sampleRate - 0.017) > 0.02) throw new Error('开机音效起始位置不匹配');
      }
      played.push(key);
    }
    a.setMusicSet('original'); a.playBgm('bgm-strategy');
    await wait(() => !!a.bgm?.src);
    a.cue('cue-st-fire'); await wait(() => !!a.cueing?.src);
    await wait(() => a.bgmKey === 'bgm-strategy' && !!a.bgm?.src);
    const noFile = a.cue('cue-unavailable');
    return { found, played, durations, noFile, resumed: a.bgmKey };
  }, { cues, effects });
  assert.equal(result.found.length, 14);
  assert.deepEqual(result.played, effects);
  for (const [key, duration] of Object.entries(result.durations)) assert.ok(duration > 1 && duration < 11, `${key}: ${duration}`);
  assert.equal(result.noFile, false);
  assert.equal(result.resumed, 'bgm-strategy');
  assert.deepEqual(page.errors, []); await page.context().close();
});

test('所选短曲损坏时回退，重试已恢复文件，切换场景不会恢复过期短曲', async () => {
  let corrupt = true, corruptOriginal = false, delay = false, release, markStarted;
  const delayed = new Promise((r) => { release = r; });
  const started = new Promise((r) => { markStarted = r; });
  const requests = [];
  const page = await game.open('', { setup: async (ctx) => {
    await ctx.route('**/assets/audio/**/cue-st-fire.m4a', async (route) => {
      const req = route.request();
      if (req.method() === 'HEAD') return route.continue();
      requests.push(new URL(req.url()).pathname);
      if (req.url().includes('/ps/')) {
        if (delay) { markStarted(); await delayed; }
        if (corrupt) return route.fulfill({ status: 200, body: 'invalid audio' });
      }
      if (req.url().includes('/original/') && corruptOriginal) return route.fulfill({ status: 503 });
      return route.continue().catch(() => {});
    });
  } });
  await skipIntro(page);
  await page.evaluate(() => { const a = window.__game.audio; a.unlock(); a.setMusicSet('ps'); a.playBgm('bgm-strategy'); });
  await page.waitForFunction(() => !!window.__game.audio.bgm?.src);
  await page.evaluate(() => window.__game.audio.cue('cue-st-fire'));
  await page.waitForFunction(() => !!window.__game.audio.cueing?.src);
  const fallback = await page.evaluate(async () => {
    const a = window.__game.audio, u = 'assets/audio/original/cue-st-fire.m4a';
    return { original: a.cueing.src.buffer === await a.cache[u], evicted: !a.cache['assets/audio/ps/cue-st-fire.m4a'] };
  });
  assert.deepEqual(fallback, { original: true, evicted: true });
  await page.waitForFunction(() => window.__game.audio.bgmKey === 'bgm-strategy' && !!window.__game.audio.bgm?.src, null, { timeout: 15000 });
  corrupt = false;
  await page.evaluate(() => window.__game.audio.cue('cue-st-fire'));
  await page.waitForFunction(() => !!window.__game.audio.cueing?.src);
  assert.equal(await page.evaluate(async () => window.__game.audio.cueing.src.buffer === await window.__game.audio.cache['assets/audio/ps/cue-st-fire.m4a']), true);

  // 两个版本都不可读时仍恢复背景音乐，失败项不应永久留在缓存中。
  corrupt = corruptOriginal = true;
  await page.evaluate(() => {
    const a = window.__game.audio;
    delete a.cache['assets/audio/ps/cue-st-fire.m4a']; delete a.cache['assets/audio/original/cue-st-fire.m4a'];
    a.cue('cue-st-fire');
  });
  await page.waitForFunction(() => window.__game.audio.bgmKey === 'bgm-strategy' && !!window.__game.audio.bgm?.src, null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => !window.__game.audio.cache['assets/audio/ps/cue-st-fire.m4a'] && !window.__game.audio.cache['assets/audio/original/cue-st-fire.m4a']), true);
  corrupt = corruptOriginal = false;
  // 强制重新请求后，在文件返回前切换到战场，迟到的请求不能再播放短曲或恢复旧曲。
  delay = true;
  const originalsBefore = requests.filter((x) => x.includes('/original/')).length;
  await page.evaluate(() => { const a = window.__game.audio; delete a.cache['assets/audio/ps/cue-st-fire.m4a']; a.cue('cue-st-fire'); a.playBgm('bgm-battle'); });
  await Promise.race([started, new Promise((_, reject) => setTimeout(() => reject(new Error('短曲请求未开始')), 5000).unref())]);
  await page.waitForFunction(() => window.__game.audio.bgmKey === 'bgm-battle' && !!window.__game.audio.bgm?.src, null, { timeout: 15000 });
  release(); await page.waitForTimeout(350);
  assert.deepEqual(await page.evaluate(() => ({ theme: window.__game.audio.bgmKey, cue: !!window.__game.audio.cueing })), { theme: 'bgm-battle', cue: false });
  assert.ok(requests.some((x) => x.includes('/original/')));
  assert.equal(requests.filter((x) => x.includes('/original/')).length, originalsBefore);
  assert.deepEqual(page.errors, []); await page.context().close();
});

test('音效读取失败时播放合成回退，之后能够重试', async () => {
  let fail = true;
  const page = await game.open('', { setup: async (ctx) => {
    await ctx.route('**/assets/audio/original/sfx-duel-blow.m4a', (route) => {
      if (route.request().method() !== 'HEAD' && fail) { fail = false; return route.fulfill({ status: 503 }); }
      return route.continue();
    });
  } });
  await skipIntro(page);
  const result = await page.evaluate(async () => {
    const a = window.__game.audio; a.unlock(); let fallbacks = 0;
    const fallback = a.sfxFallback.bind(a); a.sfxFallback = (k) => { fallbacks++; fallback(k); };
    a.sfx('sfx-duel-blow');
    for (let i = 0; i < 100 && !fallbacks; i++) await new Promise((r) => setTimeout(r, 20));
    const cleared = !a.cache['sfx-duel-blow'];
    const b = await a.preload('sfx-duel-blow'); a.sfx('sfx-duel-blow');
    return { fallbacks, cleared, duration: b.duration };
  });
  assert.equal(result.fallbacks, 1); assert.equal(result.cleared, true); assert.ok(result.duration > 0);
  assert.deepEqual(page.errors, []); await page.context().close();
});

test('实际开发和防灾命令触发对应短曲', async () => {
  const page = await game.open();
  await page.evaluate(async () => { (await import('./src/pace.js')).setPace(4); (await import('./src/vignette.js')).setVignettes(false); });
  await newCampaign(page);
  await page.evaluate(() => {
    const { g, audio } = window.__game, c = g.cities[g.factions[g.player].city];
    Object.assign(c, { gold: 2000, land: 100, industry: 100, pop: 100, disaster: 10 }); g.books = 10;
    const cue = audio.cue.bind(audio); window.__cueLog = [];
    audio.cue = (k) => { window.__cueLog.push(k); return cue(k); };
  });
  for (const [index, field] of ['land', 'industry', 'pop'].entries()) {
    await cmd(page, '城', '开发'); await page.locator(`.modal [data-k="${field}"]`).click();
    await page.locator('.modal tr[data-id]').first().click(); await page.locator('.modal .runok').click();
    await page.waitForFunction((n) => window.__game.g.books === n, 9 - index);
    await page.waitForFunction(() => !document.querySelector('.shade, .vig, .banner'));
  }
  await cmd(page, '城', '防灾'); await page.locator('.modal tr[data-id]').first().click();
  await page.locator('.modal .runok').click(); await page.waitForFunction(() => window.__game.g.books === 6);
  assert.deepEqual(await page.evaluate(() => window.__cueLog), ['cue-land', 'cue-industry', 'cue-town', 'cue-land']);
  assert.deepEqual(page.errors, []); await page.context().close();
});

test('白兵战术按效果选曲，缺失时保留号角；实际施放会触发短曲', async () => {
  const page = await game.open();
  const table = await page.evaluate(async () => {
    const { playTacticCue } = await import('./src/tacticalhud.js');
    const out = [], audio = { cue: (k) => (out.push(k), true), sfx: (k) => out.push(k) };
    for (const id of ['bind', 'taunt', 'xbow', 'morale', 'fire', 'blast']) playTacticCue(audio, id);
    playTacticCue({ cue: () => false, sfx: (k) => out.push(k) }, 'bind');
    return out;
  });
  assert.deepEqual(table, ['cue-st-trap', 'cue-st-lure', 'cue-st-fire', 'cue-st-ruse', 'cue-st-fire', 'cue-st-fire', 'sfx-horn']);
  await page.evaluate(() => {
    const a = window.__game.audio, cue = a.cue.bind(a); window.__cueLog = [];
    a.cue = (k) => { window.__cueLog.push(k); return cue(k); };
    window.__game.debug.quickTactical(153, 191, 2, { human: 'a' });
  });
  await page.waitForSelector('.tq-form', { timeout: 60000 });
  await page.locator('.tq-form').first().click(); await page.locator('.tq-deploy:not(.arming)').click();
  await page.waitForSelector('.tq-start button', { timeout: 30000 });
  await page.evaluate(() => { window.__tq.side.a.tp = 24; });
  await page.locator('.tq-speed .tq-btn', { hasText: '1×' }).click();
  await page.locator('.tq-tac', { hasText: '爆炎' }).click();
  await page.waitForFunction(() => window.__cueLog.includes('cue-st-fire'));
  assert.equal(await page.evaluate(() => window.__tq.side.a.tp), 12);
  assert.deepEqual(page.errors, []); await page.context().close();
});
