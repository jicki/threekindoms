// Audio: plays the BGM / SFX files found from the manifest through WebAudio (BGM looped seamlessly at
// assets/audio/loops.json points), else a chiptune stand-in so every hook point is audible.
const PENTA = [0, 2, 4, 7, 9];
const THEMES = {
  'bgm-strategy': { root: 57, tempo: 0.28, wave: 'triangle', pattern: [0, 2, 4, 2, 3, 4, 2, 1, 0, 1, 2, 4, 3, 2, 1, 0] },
  'bgm-battle': { root: 52, tempo: 0.17, wave: 'square', pattern: [0, 0, 2, 3, 4, 3, 2, 0, 1, 1, 3, 4, 5, 4, 3, 1] },
  'bgm-skirmish': { root: 50, tempo: 0.12, wave: 'sawtooth', pattern: [0, 3, 0, 4, 0, 3, 5, 4] },
};

// Music sets the player can pick, told apart by folder. The generated score (新编) was dropped on 2026-11-03: the
// manifest no longer lists it, and without any music folder the chiptune stand-ins play.
const SETS = [['ps', 'PS 复刻', /\/audio\/ps\//], ['remix', 'Remix', /\/audio\/remix\//], ['original', '原版', /\/audio\/original\//]];
const LOOPS_WAIT = 2000;  // ms a decoded track waits for loops.json before playing without it
// A slider's 0–1 as gain: squared, so its travel is heard evenly (loudness goes about with the log of the gain;
// a linear slider changes little over most of its range and drops away at the bottom).
const level = (v) => v * v;
// Hits and steps come again and again: each plays a shade higher or lower and louder or softer (±3%, ±1.5 dB)
// so a run of them does not sound like one sample on repeat.
const VARIED = new Set(['sfx-clash', 'sfx-step', 'sfx-war-march', 'sfx-duel-ride', 'sfx-duel-swing', 'sfx-volley-land']);
// 行动的短音必须与动作同步：文件解码太慢时先播放合成回退，不能在动作结束后补响。
const TIMELY_SFX = new Set(['sfx-clash', 'sfx-step', 'sfx-war-march', 'sfx-volley-land']);
const SFX_WAIT_MS = 80;
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch {} return null; };

export class Audio {
  constructor(files, music = {}) {
    this.files = files; this.music = music; this.ctx = null; this.bgm = null; this.bgmKey = null; this.muted = store('hd2d-muted') === 'true'; this.cache = {}; this.bufs = new Map();
    this.loadingTracks = new Map();
    this.sets = SETS.filter(([, , re]) => Object.entries(music).some(([key, urls]) => key.startsWith('bgm-') && urls.some((u) => re.test(u)))).map(([id, label]) => ({ id, label }));
    this.set = this.sets.find((t) => t.id === store('hd2d-music'))?.id ?? this.sets[0]?.id;
    this.volume = Math.min(1, Math.max(0, Number(store('hd2d-music-volume') ?? 1)));
    this.sfxVolume = Math.min(1, Math.max(0, Number(store('hd2d-sfx-volume') ?? 1)));
    // Loop points per file from tools/bgm_loops.py: the songs fade out and the NSF renders stop mid-phrase.
    // Never let this metadata hold the music back: a track that is ready before it plays whole-file looped.
    this.loopData = null;
    this.loops = fetch('assets/audio/loops.json').then((r) => r.json()).catch(() => ({})).then((d) => (this.loopData = d));
  }

  // The context is made as soon as music is asked for: it runs at once where autoplay is allowed (desktop),
  // else it waits suspended (and the music with it) until the first gesture calls unlock.
  ensureCtx() {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.5; this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = 0.9 * level(this.volume); this.musicGain.connect(this.master);
    this.sfxGain = this.ctx.createGain(); this.sfxGain.gain.value = level(this.sfxVolume); this.sfxGain.connect(this.master); // every sound effect, under its own slider
  }

  unlock() {
    this.ensureCtx();
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    if (this.bgmKey && !this.bgm) { const k = this.bgmKey; this.bgmKey = null; this.playBgm(k); }
  }

  setMuted(m, persist = true) { this.muted = m; if (persist) store('hd2d-muted', String(m)); if (this.master) this.master.gain.value = m ? 0 : 0.5; }
  setVolume(v) { this.volume = v; store('hd2d-music-volume', String(v)); if (this.musicGain) this.musicGain.gain.setTargetAtTime(0.9 * level(v), this.ctx.currentTime, 0.03); }
  setSfxVolume(v) { this.sfxVolume = v; store('hd2d-sfx-volume', String(v)); if (this.sfxGain) this.sfxGain.gain.setTargetAtTime(level(v), this.ctx.currentTime, 0.03); }
  setMusicSet(id) {
    this.set = id; store('hd2d-music', id);
    if (this.bgmKey) { const k = this.bgmKey; this.stopBgm(); this.playBgm(k); }  // versions differ in form: start over
  }

  url(key) {
    const re = SETS.find(([id]) => id === this.set)?.[2];
    return (re && (this.music[key] || []).find((u) => re.test(u))) || this.files[key];
  }

  prepareBgm(key) {
    const url = this.url(key);
    if (!url || this.muted || !this.volume) return;
    this.ensureCtx();
    // 只准备当前曲库，真正切换场景时才播放，失败仍走 playBgm 的候选曲目。
    this.loopBuffer(url).catch(() => {});
  }

  playBgm(key) {
    if (this.bgmKey === key && this.bgm) return;
    this.stopCue(); this.stopBgm(); this.bgmKey = key;
    const url = this.url(key);
    if (url) {
      this.ensureCtx();
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      const bgm = this.bgm = { key };
      // The chosen version first, then any other that exists. If none loads, the slot is left empty with the
      // key kept, so the next gesture (unlock) or the next playBgm of this key tries again.
      const tries = [url, ...(this.music[key] || []).filter((u) => u !== url)];
      const load = (n) => this.loopBuffer(tries[n]).catch((e) => {
        console.warn(`BGM ${tries[n]}: ${e?.message || e}`);
        if (this.bgm === bgm && n + 1 < tries.length) return load(n + 1);
        throw e;
      });
      load(0).then((buf) => {
        if (this.bgm !== bgm) return;
        bgm.buf = buf;
        this.startBgm(bgm, 0);
      }).catch(() => { if (this.bgm === bgm) this.bgm = null; });
      return;
    }
    const th = THEMES[key]; if (!th || !this.ctx) return;
    let i = 0;
    const tick = () => {
      const deg = th.pattern[i % th.pattern.length]; i++;
      const midi = th.root + 12 * Math.floor(deg / 5) + PENTA[deg % 5];
      this.tone(midi, th.tempo * 0.9, th.wave, 0.07);
      if (i % 4 === 1) this.tone(th.root - 12, th.tempo * 3.5, 'triangle', 0.09);
    };
    this.bgm = { timer: setInterval(tick, th.tempo * 1000) };
  }

  // Intro, body and the blend that closes the loop, laid out once so the source loops sample-exact:
  // x[0:B] then x[B:B+X] fading out over x[A:A+X] fading in ('head' loops keep the opening at full level),
  // looping [A+X, B+X]. Files without loop points loop whole, as before. A few decoded tracks are kept.
  async loopBuffer(url) {
    if (this.bufs.has(url)) { const b = this.bufs.get(url); this.bufs.delete(url); this.bufs.set(url, b); return b; }
    if (!this.loadingTracks.has(url)) {
      this.loadingTracks.set(url, this.decodeLoop(url).finally(() => this.loadingTracks.delete(url)));
    }
    return this.loadingTracks.get(url);
  }

  async decodeLoop(url) {
    const data = await fetch(url).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); });
    const loops = this.loopData ?? (await Promise.race([this.loops, new Promise((r) => setTimeout(r, LOOPS_WAIT))])) ?? null;
    const x = await this.ctx.decodeAudioData(data), sr = x.sampleRate, L = loops?.[url];
    let out = { buf: x, start: 0, end: x.duration };
    if (L) {
      const A = Math.round(L.start * sr), B = Math.round(L.end * sr), X = Math.round(L.xfade * sr);
      if (B + X <= x.length && A + X <= B) {
        const y = this.ctx.createBuffer(x.numberOfChannels, B + X, sr);
        for (let c = 0; c < x.numberOfChannels; c++) {
          const src = x.getChannelData(c), dst = y.getChannelData(c);
          dst.set(src.subarray(0, B));
          for (let i = 0; i < X; i++) { const t = (i / X) * Math.PI / 2; dst[B + i] = src[B + i] * Math.cos(t) + src[A + i] * (L.head ? 1 : Math.sin(t)); }
        }
        out = { buf: y, start: (A + X) / sr, end: (B + X) / sr };
      }
    }
    if (loops) this.bufs.set(url, out);  // built without loop points: not kept, so a later play picks them up
    while (this.bufs.size > 3) this.bufs.delete(this.bufs.keys().next().value);
    return out;
  }

  startBgm(bgm, at) {
    const { buf, start, end } = bgm.buf, src = this.ctx.createBufferSource(), gain = this.ctx.createGain();
    src.buffer = buf; src.loop = true; src.loopStart = start; src.loopEnd = end;
    src.connect(gain).connect(this.musicGain); src.start(0, Math.min(at, end - 0.01));
    Object.assign(bgm, { src, gain, t0: this.ctx.currentTime, offset: at });
  }

  // Seconds into the track (folded into the loop), or null while it is not sounding yet.
  bgmTime() {
    const b = this.bgm; if (!b?.src) return null;
    const p = b.offset + this.ctx.currentTime - b.t0, { start, end } = b.buf;
    return p < end ? p : start + ((p - start) % (end - start));
  }
  bgmPlaying() { return this.ctx?.state === 'running' && this.bgmTime() != null; }
  // What the music is doing now: 'blocked' (no running context yet: autoplay refused until a gesture),
  // 'loading' (fetching or decoding), 'playing', or 'none' (no file, or every candidate failed to load).
  bgmState() {
    if (this.ctx?.state !== 'running') return 'blocked';
    const b = this.bgm;
    if (!b) return 'none';
    return b.timer || b.src ? 'playing' : 'loading';
  }

  stopBgm() {
    const b = this.bgm;
    if (b?.timer) clearInterval(b.timer);
    if (b?.src) {
      // A short fade, so a scene change never clicks or cuts a chord mid-note.
      const t = this.ctx.currentTime; b.gain.gain.setValueAtTime(1, t); b.gain.gain.linearRampToValueAtTime(0, t + 0.25); b.src.stop(t + 0.26);
    }
    this.bgm = null; this.bgmKey = null;
  }

  // A command's or an event's phrase (the original's $04D6 cues and the 计略 phrases, research/music-cues-evidence.md
  // §5): the theme stops, the phrase plays once, then the theme starts again from its first bar, as the original
  // starts its streams over after every cue rather than resuming (playtest of 2026-10-30, T13). The phrase is the
  // music set's own, else another set's. Returns false, leaving the theme alone, when there is no phrase file.
  cue(key) {
    const url = this.url(key) || this.music[key]?.[0];
    if (!url) return false;
    this.ensureCtx();
    const theme = this.cueing?.theme ?? this.bgmKey;
    this.stopCue(); this.stopBgm();
    const cue = this.cueing = { theme };
    const tries = [url, ...(this.music[key] || []).filter((u) => u !== url)];
    const load = (n) => {
      const u = tries[n];
      const pending = this.cache[u] ||= fetch(u).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      }).then((b) => this.ctx.decodeAudioData(b));
      return pending.catch((e) => {
        if (this.cache[u] === pending) delete this.cache[u];
        if (this.cueing === cue && n + 1 < tries.length) return load(n + 1);
        throw e;
      });
    };
    load(0).then((buf) => {
      if (this.cueing !== cue) return;
      const s = cue.src = this.ctx.createBufferSource(); s.buffer = buf; s.connect(this.musicGain);
      s.onended = () => this.cueEnded(cue); s.start();
    }).catch(() => this.cueEnded(cue));
    return true;
  }
  cueEnded(cue) { if (this.cueing !== cue) return; this.cueing = null; if (cue.theme && !this.bgmKey) this.playBgm(cue.theme); }
  stopCue() { const c = this.cueing; this.cueing = null; if (c?.src) { c.src.onended = null; try { c.src.stop(); } catch {} } }
  // 演出提前结束时只停止它自己启动的短曲，并恢复原场景音乐；不能打断后来启动的短曲。
  finishCue(cue) {
    if (!cue || this.cueing !== cue) return;
    const theme = cue.theme;
    this.stopCue();
    if (theme && !this.bgmKey) this.playBgm(theme);
  }

  sfx(key) {
    if (!this.ctx) return;
    const url = this.files[key];
    if (url) {
      let timedOut = false;
      const timer = TIMELY_SFX.has(key) ? setTimeout(() => {
        timedOut = true; this.sfxFallback(key);
      }, SFX_WAIT_MS) : null;
      this.preload(key).then((b) => {
        if (timedOut) return;
        clearTimeout(timer);
        const s = this.ctx.createBufferSource(); s.buffer = b;
        if (!VARIED.has(key)) {
          s.connect(this.sfxGain); s.start();
          // 两种原版单挑声听感接近；攻击保留原声，并在出手接触时加短促低频冲击。
          if (key === 'sfx-duel-blow') this.sweep(180, 55, 0.18, 'sine', 0.16);
          return;
        }
        const gv = this.ctx.createGain(); gv.gain.value = 10 ** ((Math.random() * 3 - 1.5) / 20); s.playbackRate.value = 0.97 + Math.random() * 0.06;
        s.connect(gv).connect(this.sfxGain); s.start();
      }).catch(() => { if (!timedOut) { clearTimeout(timer); this.sfxFallback(key); } });
      return;
    }
    this.sfxFallback(key);
  }

  sfxFallback(key) {
    // sfx-select is the original's sound 90, which the ROM plays only for the 白兵 archers' volley (and, as sfx-arrow, the
    // title arrow): menu and map clicks are silent, as in the original (feedback F05, 2026-11-02: the 呲呲 on every click).
    const hoofstep = () => { this.noise(0.10, 1500, 0.27); this.sweep(280, 75, 0.13, 'sine', 0.24); };
    const S = {
      'sfx-select': () => this.tone(84, 0.06, 'square', 0.08),
      // 行军素材缺失时仍要能在背景音乐中听见落脚；骑行与步行分别保留低频马蹄和轻脚步。
      'sfx-step': hoofstep,
      'sfx-war-march': hoofstep,
      'sfx-footstep': () => { this.noise(0.08, 1800, 0.17); this.sweep(190, 70, 0.09, 'triangle', 0.14); },
      'sfx-clash': () => { this.noise(0.25, 2500, 0.3); this.tone(40, 0.2, 'sawtooth', 0.1); },
      // 爆炎素材不可用时，爆点仍有低频冲击和短促的爆裂声。
      'sfx-blast': () => { this.noise(0.5, 850, 0.3); this.sweep(180, 45, 0.4, 'sine', 0.3); },
      // 自制战术短音，分别表现束缚、挑衅、上弦、鼓舞和火矢。
      'sfx-tactic-bind': () => { this.sweep(700, 360, 0.24, 'triangle', 0.07); this.tone(77, 0.17, 'sine', 0.06); },
      'sfx-tactic-taunt': () => { this.tone(52, 0.35, 'sawtooth', 0.08); this.tone(59, 0.3, 'sawtooth', 0.04); },
      'sfx-tactic-xbow': () => { this.sweep(1400, 380, 0.14, 'triangle', 0.08); this.noise(0.07, 2600, 0.06); },
      'sfx-tactic-morale': () => { this.tone(64, 0.33, 'triangle', 0.07); this.tone(71, 0.4, 'triangle', 0.06); },
      'sfx-tactic-fire': () => { this.noise(0.28, 1800, 0.08); this.sweep(380, 900, 0.25, 'sawtooth', 0.035); },
      'sfx-strategy-water': () => { this.noise(0.38, 1200, 0.14); this.sweep(850, 240, 0.32, 'sine', 0.06); },
      'sfx-strategy-lure': () => { this.tone(72, 0.35, 'sine', 0.07); this.tone(79, 0.4, 'triangle', 0.05); },
      'sfx-horn': () => { this.tone(50, 0.6, 'sawtooth', 0.08); this.tone(57, 0.6, 'sawtooth', 0.05); },
      'sfx-victory': () => [0, 4, 7, 12].forEach((d, i) => setTimeout(() => this.tone(72 + d, 0.3, 'square', 0.08), i * 140)),
      'sfx-cancel': () => this.tone(60, 0.08, 'square', 0.06),
      // 升级 with no phrase file: a rising major arpeggio that rings out on the octave.
      'sfx-levelup': () => [[69, 0], [73, 110], [76, 220], [81, 330], [85, 520]].forEach(([m, t]) => setTimeout(() => this.tone(m, m === 85 ? 0.9 : 0.22, 'triangle', 0.09), t)),
      'sfx-income': () => [[67, 0], [72, 160], [76, 320], [79, 480], [84, 700]].forEach(([m, t]) => setTimeout(() => this.tone(m, m === 84 ? 0.7 : 0.18, 'triangle', 0.09), t)),
      // The title arrow: a falling whoosh like the original's slot 30, then the thud of the head in stone.
      'sfx-arrow': () => { this.sweep(2600, 420, 0.45, 'square', 0.05); this.noise(0.4, 3000, 0.06); },
      'sfx-arrow-hit': () => { this.sweep(140, 42, 0.3, 'sine', 0.45); this.noise(0.09, 1800, 0.35); },
      // 白兵 and 单挑 sounds with no original file (a build without it, --generated-music): rough stand-ins for the original's
      // 93 (arrows land), 96 (a gallop's hoofbeat), 97 (a swing), 98×3 (牵制's clash, the 秘技 chime), 104 (舍身's strike), 105 (攻击's slash).
      'sfx-volley-land': () => { this.noise(0.08, 1500, 0.2); this.sweep(240, 80, 0.10, 'sine', 0.12); },
      'sfx-duel-ride': () => { this.noise(0.04, 500, 0.16); setTimeout(() => this.noise(0.04, 420, 0.12), 90); },
      'sfx-duel-swing': () => { this.sweep(1800, 520, 0.18, 'square', 0.03); this.noise(0.14, 2600, 0.08); },
      'sfx-chime': () => { this.tone(88, 0.12, 'square', 0.05); this.tone(95, 0.1, 'square', 0.03); this.noise(0.08, 4000, 0.12); },
      'sfx-duel-desperate': () => { this.noise(0.35, 1800, 0.3); this.sweep(300, 60, 0.3, 'sawtooth', 0.1); },
      'sfx-duel-blow': () => { this.noise(0.22, 3000, 0.26); this.sweep(180, 55, 0.18, 'sine', 0.16); },
    };
    S[key]?.();
  }

  // A decoded effect started at a time on the context's clock, for a sound a picture must land on (the boot splash's
  // chime, src/bootsplash.js); returns the source so a skip can stop it before it is heard.
  sfxAt(buf, when) {
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.connect(this.sfxGain); s.start(Math.max(when, this.ctx.currentTime));
    return s;
  }

  // Decoded buffers so rapid repeats (clash, steps) overlap instead of restarting one element; also
  // fetched ahead of a cue that must land on time (the title arrow).
  preload(key) {
    const url = this.files[key];
    if (!this.ctx || !url) return Promise.resolve(null);
    if (this.cache[key]) return this.cache[key];
    const pending = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.arrayBuffer();
    }).then((b) => this.ctx.decodeAudioData(b)).catch((e) => {
      if (this.cache[key] === pending) delete this.cache[key];
      throw e;
    });
    return this.cache[key] = pending;
  }

  sweep(f0, f1, dur, wave, vol) {
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = wave; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfxGain); o.start(t); o.stop(t + dur);
  }

  tone(midi, dur, wave, vol) {
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = wave; o.frequency.value = 440 * 2 ** ((midi - 69) / 12);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfxGain); o.start(t); o.stop(t + dur);
  }

  noise(dur, freq, vol) {
    const t = this.ctx.currentTime, n = this.ctx.sampleRate * dur, b = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    s.buffer = b; f.type = 'bandpass'; f.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.sfxGain); s.start(t);
  }
}
