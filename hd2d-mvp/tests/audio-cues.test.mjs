// 实际资源、播放与失败恢复：内政和计略短曲随曲库选择，单挑音效通过独立音效通道播放。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, skipIntro, newCampaign, closeMessages, cmd } from './game.mjs';

let game;
before(async () => { game = await startGame(); });
after(() => game?.close());

const cues = ['cue-land', 'cue-industry', 'cue-town', 'cue-st-fire', 'cue-st-ruse', 'cue-st-lure', 'cue-st-trap',
  'cue-move', 'cue-envoy', 'cue-record', 'cue-sortie', 'cue-conscript', 'cue-study', 'cue-disaster', 'cue-aiwar', 'cue-income', 'cue-levelup'];
const effects = ['sfx-volley-land', 'sfx-duel-ride', 'sfx-duel-swing', 'sfx-chime', 'sfx-duel-desperate', 'sfx-duel-blow'];

test('单挑攻击保留原声并叠加低频冲击，牵制使用独立音效', async () => {
  const page = await game.open();
  try {
    const result = await page.evaluate(async () => {
      const { Audio } = await import('./src/audio.js'), files = window.__game.audio.files;
      const render = async (key) => {
        const ctx = new OfflineAudioContext(1, 44100, 44100), a = new Audio({ [key]: files[key] });
        a.ctx = ctx; a.sfxGain = ctx.createGain(); a.sfxGain.connect(ctx.destination);
        const original = await a.preload(key);
        a.sfx(key); await Promise.resolve();
        const played = (await ctx.startRendering()).getChannelData(0), source = original.getChannelData(0);
        let diff = 0;
        for (let i = 0; i < 8000; i++) diff += (played[i] - source[i]) ** 2;
        return { url: files[key], difference: Math.sqrt(diff / 8000) };
      };
      const fallbackLow = async (key) => {
        const ctx = new OfflineAudioContext(1, 44100, 44100), a = new Audio({});
        a.ctx = ctx; a.sfxGain = ctx.createGain();
        const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 250;
        a.sfxGain.connect(filter).connect(ctx.destination); a.sfx(key);
        const data = (await ctx.startRendering()).getChannelData(0);
        let power = 0; for (let i = 0; i < 8000; i++) power += data[i] ** 2;
        return Math.sqrt(power / 8000);
      };
      return { attack: await render('sfx-duel-blow'), feint: await render('sfx-chime'),
        fallback: { attack: await fallbackLow('sfx-duel-blow'), feint: await fallbackLow('sfx-chime') } };
    });
    assert.notEqual(result.attack.url, result.feint.url);
    assert.ok(result.attack.difference > 0.005, `攻击缺少可辨别的冲击层: ${result.attack.difference}`);
    assert.ok(result.feint.difference < 0.001, `牵制不应附加攻击冲击层: ${result.feint.difference}`);
    assert.ok(result.fallback.attack > result.fallback.feint * 3, '文件缺失时攻击和牵制仍有不同的低频特征');
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('爆炎与碰撞音效能由浏览器解码播放', async () => {
  const page = await game.open(); await skipIntro(page);
  const result = await page.evaluate(async () => {
    const a = window.__game.audio; a.unlock(); const durations = {};
    for (const key of ['sfx-blast', 'sfx-clash']) {
      if (a.files[key] !== `assets/audio/${key}.mp3`) throw new Error(`${key} 文件未被选择`);
      const buffer = await a.preload(key); durations[key] = buffer.duration; a.sfx(key);
    }
    return durations;
  });
  assert.ok(result['sfx-blast'] > 2 && result['sfx-blast'] < 3);
  assert.ok(result['sfx-clash'] > 0.5 && result['sfx-clash'] < 1.5);
  assert.deepEqual(page.errors, []); await page.context().close();
});

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
  assert.equal(result.found.length, cues.length * 2);
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

test('爆炎文件缺失或损坏时能合成声音，文件可用时仍播放文件', async () => {
  const rate = 22050, frames = rate / 5, wav = Buffer.alloc(44 + frames * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) wav.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * 440 * i / rate)), 44 + i * 2);
  const page = await game.open('', { setup: async (ctx) => {
    await ctx.route('**/assets/audio/blast-fixture-*', (route) => {
      const url = route.request().url();
      if (url.endsWith('http')) return route.fulfill({ status: 503 });
      if (url.endsWith('corrupt')) return route.fulfill({ status: 200, body: 'bad audio' });
      return route.fulfill({ status: 200, contentType: 'audio/wav', body: wav });
    });
  } });
  const results = await page.evaluate(async () => {
    const { Audio } = await import('./src/audio.js'), out = {};
    for (const mode of ['missing', 'http', 'corrupt', 'valid', 'muted']) {
      const ctx = new OfflineAudioContext(1, 44100, 44100), files = mode === 'missing' || mode === 'muted' ? {} : { 'sfx-blast': `assets/audio/blast-fixture-${mode}` };
      const a = new Audio(files); a.ctx = ctx; a.sfxGain = ctx.createGain(); a.sfxGain.gain.value = mode === 'muted' ? 0 : 1; a.sfxGain.connect(ctx.destination);
      let fallbacks = 0; const fallback = a.sfxFallback.bind(a);
      a.sfxFallback = (k) => { fallbacks++; fallback(k); };
      a.sfx('sfx-blast');
      if (files['sfx-blast']) { const pending = a.cache['sfx-blast']; await pending.catch(() => {}); await new Promise((r) => setTimeout(r, 30)); }
      const b = await ctx.startRendering(), samples = b.getChannelData(0);
      let peak = 0; for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
      out[mode] = { peak, fallbacks };
    }
    return out;
  });
  for (const mode of ['missing', 'http', 'corrupt']) {
    assert.equal(results[mode].fallbacks, 1, mode); assert.ok(results[mode].peak > 0.01, `${mode} 应有爆炸声`);
  }
  assert.equal(results.valid.fallbacks, 0); assert.ok(results.valid.peak > 0.01);
  assert.equal(results.muted.peak, 0, '音效音量为零时静音');
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

test('洪水、旱灾、暴乱及收入事件触发所选曲库的短曲', async () => {
  const page = await game.open('&flat');
  await page.evaluate(async () => { (await import('./src/pace.js')).setPace(4); (await import('./src/vignette.js')).setVignettes(false); });
  await newCampaign(page);
  const home = await page.evaluate(() => {
    const { g, audio } = window.__game, cue = audio.cue.bind(audio);
    audio.setMusicSet('ps'); window.__eventCues = [];
    audio.cue = (key) => { window.__eventCues.push([key, audio.url(key)]); return cue(key); };
    return g.factions[g.player].city;
  });
  const stop = closeMessages(page);
  try {
    const events = [
      { type: 'disaster', kind: 'flood', list: [[home, 3]] },
      { type: 'disaster', kind: 'drought', list: [[home, 10]] },
      { type: 'riot', list: [[home]] },
      { type: 'income', kind: 'rice', list: [[home, 50]] },
      { type: 'disaster', kind: 'flood', list: [] },
    ];
    for (const [i, event] of events.entries()) {
      await page.evaluate(async (on) => (await import('./src/vignette.js')).setVignettes(on), i === 0);
      await page.evaluate((e) => window.__game.io.event(e), event);
    }
  } finally { stop(); }
  assert.deepEqual(await page.evaluate(() => window.__eventCues), [
    ['cue-disaster', 'assets/audio/ps/cue-disaster.m4a'], ['cue-disaster', 'assets/audio/ps/cue-disaster.m4a'],
    ['cue-disaster', 'assets/audio/ps/cue-disaster.m4a'], ['cue-income', 'assets/audio/ps/cue-income.m4a'],
  ]);
  assert.deepEqual(page.errors, []); await page.context().close();
});

test('跳过计策演出立即结束所属短曲，恢复背景且不打断后续短曲', async () => {
  const page = await game.open('&flat');
  try {
    await skipIntro(page);
    await page.evaluate(async () => {
      const a = window.__game.audio; a.unlock(); a.playBgm('bgm-battle');
      (await import('./src/vignette.js')).setVignettes(true);
    });
    await page.waitForFunction(() => !!window.__game.audio.bgm?.src);
    const start = () => page.evaluate(async () => {
      const { playVignette } = await import('./src/vignette.js'), audio = window.__game.audio;
      window.__vigDone = false;
      window.__vig = playVignette({ scene: 'st-ambush', caption: '要击……', audio, duration: 5000,
        onShow: () => audio.cue('cue-st-ruse') }).then(() => { window.__vigDone = true; });
    });
    await start();
    await page.waitForFunction(() => !!document.querySelector('.vig') && !!window.__game.audio.cueing?.src);
    await page.locator('.vig').click();
    await page.waitForFunction(() => window.__vigDone && window.__game.audio.bgmKey === 'bgm-battle' && !!window.__game.audio.bgm?.src);
    assert.equal(await page.evaluate(() => window.__game.audio.cueing), null);

    await start();
    await page.waitForFunction(() => !!document.querySelector('.vig') && !!window.__game.audio.cueing?.src);
    await page.evaluate(() => { const audio = window.__game.audio; audio.cue('cue-record'); window.__newCue = audio.cueing; });
    await page.locator('.vig').click(); await page.waitForFunction(() => window.__vigDone);
    assert.equal(await page.evaluate(() => window.__game.audio.cueing === window.__newCue), true, '不可停止后来启动的短曲');
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('短曲仍在加载时跳过演出，迟到的音频不会重新播放', async () => {
  let release, markStarted;
  const delayed = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { markStarted = resolve; });
  const page = await game.open('&flat', { setup: async (context) => {
    await context.route('**/assets/audio/ps/cue-st-ruse.m4a', async (route) => {
      if (route.request().method() === 'HEAD') return route.continue();
      markStarted(); await delayed; return route.continue().catch(() => {});
    });
  } });
  try {
    await skipIntro(page);
    await page.evaluate(async () => {
      const audio = window.__game.audio; audio.unlock(); audio.setMusicSet('ps'); audio.playBgm('bgm-battle');
      (await import('./src/vignette.js')).setVignettes(true);
    });
    await page.waitForFunction(() => !!window.__game.audio.bgm?.src);
    await page.evaluate(async () => {
      const { playVignette } = await import('./src/vignette.js'), audio = window.__game.audio;
      delete audio.cache['assets/audio/ps/cue-st-ruse.m4a'];
      window.__vigDone = false;
      window.__vig = playVignette({ scene: 'st-ambush', caption: '要击……', audio, duration: 5000, onShow: () => {
        audio.cue('cue-st-ruse'); window.__delayedCue = audio.cache['assets/audio/ps/cue-st-ruse.m4a'];
      } }).then(() => { window.__vigDone = true; });
    });
    await Promise.race([started, new Promise((_, reject) => setTimeout(() => reject(new Error('短曲请求未开始')), 5000).unref())]);
    assert.equal(await page.evaluate(() => !!window.__game.audio.cueing && !window.__game.audio.cueing.src), true);
    await page.locator('.vig').click();
    await page.waitForFunction(() => window.__vigDone && window.__game.audio.bgmKey === 'bgm-battle');
    release(); await page.evaluate(() => window.__delayedCue);
    assert.equal(await page.evaluate(() => window.__game.audio.cueing), null);
    assert.equal(await page.evaluate(() => window.__game.audio.bgmKey), 'bgm-battle');
    assert.deepEqual(page.errors, []);
  } finally { release(); await page.context().close(); }
});

test('NPC 战斗在跳过或加速结束后恢复背景音乐，不打断后来的短曲', async () => {
  const page = await game.open('&flat');
  await page.evaluate(async () => { (await import('./src/pace.js')).setPace(4); (await import('./src/vignette.js')).setVignettes(false); });
  await newCampaign(page);
  await page.evaluate(() => { const a = window.__game.audio; a.setMusicSet('ps'); a.playBgm('bgm-strategy'); });
  await page.waitForFunction(() => !!window.__game.audio.bgm?.src);
  const start = () => page.evaluate(() => {
    const { g, G, io } = window.__game, fs = g.factions.filter((f) => f.ruler != null && f.id !== g.player);
    const city = g.cities.find((c) => c.faction === fs[1].id).id, from = G.data().cities[city].roads[0];
    window.__warDone = false;
    window.__warEvent = io.event({ type: 'autobattle', war: { attacker: fs[0].id, defender: fs[1].id, city, from, att: { ids: [fs[0].ruler] } }, res: { attWins: false } }).then(() => { window.__warDone = true; });
  });
  await start();
  await page.waitForFunction(() => !!window.__game.audio.cueing?.src && !!document.querySelector('.aiwar'));
  assert.equal(await page.evaluate(async () => window.__game.audio.cueing.src.buffer === await window.__game.audio.cache['assets/audio/ps/cue-aiwar.m4a']), true);
  await page.evaluate(() => document.querySelector('.aiwar').click());
  await page.waitForFunction(() => window.__warDone && window.__game.audio.bgmKey === 'bgm-strategy' && !!window.__game.audio.bgm?.src);

  await page.evaluate(() => window.__game.audio.setMusicSet('original'));
  await page.waitForFunction(() => !!window.__game.audio.bgm?.src);
  await start();
  await page.waitForFunction(() => !!window.__game.audio.cueing?.src && !!document.querySelector('.aiwar'));
  assert.equal(await page.evaluate(async () => window.__game.audio.cueing.src.buffer === await window.__game.audio.cache['assets/audio/original/cue-aiwar.m4a']), true);
  await page.evaluate(() => {
    const a = window.__game.audio; a.cue('cue-record'); window.__newCue = a.cueing;
    document.querySelector('.aiwar').click();
  });
  await page.waitForFunction(() => window.__warDone);
  assert.equal(await page.evaluate(() => window.__game.audio.cueing === window.__newCue), true, '不能停止后来的短曲');
  await page.evaluate(() => window.__game.audio.playBgm('bgm-strategy'));
  await page.waitForFunction(() => !!window.__game.audio.bgm?.src);

  await start();
  await page.waitForFunction(() => window.__warDone && window.__game.audio.bgmKey === 'bgm-strategy' && !!window.__game.audio.bgm?.src, null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => !!window.__game.audio.cueing), false, '加速演出完成后不遗留短曲');
  assert.deepEqual(page.errors, []); await page.context().close();
});

test('玩家出阵进攻敌城时播放所选曲库的短曲', async () => {
  const page = await game.open('&flat');
  await page.evaluate(async () => { (await import('./src/pace.js')).setPace(4); (await import('./src/vignette.js')).setVignettes(false); });
  await newCampaign(page);
  const { target, officers } = await page.evaluate(() => {
    const { g, G, audio } = window.__game, home = g.factions[g.player].city, c = g.cities[home];
    const to = G.roads(home).map((id) => g.cities[id]).find((city) => city.faction !== g.player && city.faction !== G.NONE && city.officers.length && !g.factions[g.player].alliance[city.faction]);
    if (!to) throw new Error('初始城市没有可进攻的敌城');
    c.gold = 500; c.rice = 1000; g.books = 10; audio.setMusicSet('ps');
    const cue = audio.cue.bind(audio); window.__sortieCues = [];
    audio.cue = (key) => { window.__sortieCues.push([key, audio.url(key)]); return cue(key); };
    return { target: G.cityName(to.id), officers: c.officers.length };
  });
  await cmd(page, '军', '出阵'); await page.locator('.mappick .chips .btn', { hasText: target }).click();
  await page.locator('.modal tr[data-id]').first().click();
  if (officers > 1) await page.locator('.modal .foot .btn.primary', { hasText: '确定' }).click();
  await page.locator('.modal .btn.primary', { hasText: '出阵' }).click();
  await page.waitForFunction(() => window.__sortieCues.length && !!document.querySelector('.panel.msg'));
  assert.deepEqual(await page.evaluate(() => window.__sortieCues), [['cue-sortie', 'assets/audio/ps/cue-sortie.m4a']]);
  assert.equal(await page.evaluate(() => window.__game.g.books), 9);
  assert.deepEqual(page.errors, []); await page.context().close();
});

test('其余内政命令与敌军来袭使用对应短曲', async () => {
  const page = await game.open('&flat');
  const mapped = await page.evaluate(async () => {
    const { cueFor } = await import('./src/vignette.js');
    return ['移动', '搜索', '运输', '同盟', '诱纳', '离间', '记录', '征兵', '武器屋', '病院', '学问所'].map((act) => cueFor(act));
  });
  assert.deepEqual(mapped, ['cue-move', 'cue-move', 'cue-move', 'cue-envoy', 'cue-envoy', 'cue-envoy', 'cue-record',
    'cue-conscript', 'cue-conscript', 'cue-study', 'cue-study']);
  await page.evaluate(async () => { (await import('./src/pace.js')).setPace(4); (await import('./src/vignette.js')).setVignettes(false); });
  await newCampaign(page);
  await page.evaluate(() => {
    const { g, G, debug, io, audio } = window.__game, home = g.factions[g.player].city;
    const from = G.roads(home).map((id) => g.cities[id]).find((c) => c.faction !== g.player && c.faction !== G.NONE && c.officers.length);
    const ids = from.officers.slice(0, 1); g.officers[ids[0]].soldiers = 500;
    const w = debug.setupWar(g, { from: from.id, to: home, ids, commander: ids[0], gold: 0, rice: 0 });
    const cue = audio.cue.bind(audio); window.__invasionCues = [];
    audio.cue = (key) => { window.__invasionCues.push(key); return cue(key); };
    window.__invasion = io.war(w);
  });
  await page.waitForFunction(() => window.__invasionCues.includes('cue-sortie') && !!document.querySelector('.panel.msg'));
  assert.deepEqual(await page.evaluate(() => window.__invasionCues), ['cue-sortie']);
  assert.deepEqual(page.errors, []); await page.context().close();
});

test('白兵施放爆炎只在爆点播放爆裂声，不借用地图火计短曲', async () => {
  const page = await game.open();
  await page.evaluate(() => {
    const a = window.__game.audio, cue = a.cue.bind(a), sfx = a.sfx.bind(a); window.__cueLog = []; window.__sfxLog = [];
    a.cue = (k) => { window.__cueLog.push(k); return cue(k); };
    a.sfx = (k) => { window.__sfxLog.push(k); return sfx(k); };
    window.__game.debug.quickTactical(153, 191, 2, { human: 'a' });
  });
  await page.waitForSelector('.tq-form', { timeout: 60000 });
  await page.locator('.tq-form').first().click(); await page.locator('.tq-deploy:not(.arming)').click();
  await page.waitForSelector('.tq-start button', { timeout: 30000 });
  await page.evaluate(() => { window.__tq.side.a.tp = 24; });
  await page.locator('.tq-speed .tq-btn', { hasText: '1×' }).click();
  await page.evaluate(() => { window.__cueLog.length = 0; window.__sfxLog.length = 0; });
  await page.locator('.tq-tac', { hasText: '爆炎' }).click();
  await page.waitForFunction(() => window.__sfxLog.includes('sfx-blast'));
  assert.deepEqual(await page.evaluate(() => window.__cueLog), []);
  assert.deepEqual(await page.evaluate(() => window.__sfxLog.filter((key) => key === 'sfx-blast')), ['sfx-blast']);
  assert.equal(await page.evaluate(() => window.__tq.side.a.tp), 12);
  assert.deepEqual(page.errors, []); await page.context().close();
});
