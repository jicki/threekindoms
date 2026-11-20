// Presentation waits (src/pace.js, src/vignette.js): how long they last at each 游戏速度, and that skipping
// them never takes a key the player meant for a window of their own.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, near } from './game.mjs';

let game, page;
before(async () => { game = await startGame(); page = await game.open(); });
after(() => game?.close());

test('游戏速度 divides presentation waits and is remembered', async () => {
  const r = await page.evaluate(async () => {
    const P = await import('./src/pace.js'), out = {};
    for (const v of [1, 2, 4]) { P.setPace(v); out[v] = { paced: P.paced(1000), label: P.paceLabel(), stored: localStorage.getItem('hd2d-pace') }; }
    P.setPace(1);
    return out;
  });
  assert.deepEqual(r, { 1: { paced: 1000, label: '原版', stored: '1' }, 2: { paced: 500, label: '快速', stored: '2' }, 4: { paced: 250, label: '最快', stored: '4' } });
});

test('a hold runs its length, and Enter ends it early', async () => {
  const full = await page.evaluate(async () => { const P = await import('./src/pace.js'); const t = performance.now(); const r = await P.hold(600); return [r, performance.now() - t]; });
  assert.equal(full[0], true); assert.ok(near(full[1], 600, 0.15), `ran ${full[1]} ms`);
  await page.evaluate(async () => { const P = await import('./src/pace.js'); window.__h = null; P.hold(5000).then((v) => (window.__h = v)); });
  await page.keyboard.press('Enter');
  assert.equal(await page.waitForFunction(() => window.__h !== null).then(() => page.evaluate(() => window.__h)), false);
});

test('while a window is open, Enter goes to the window, not to the hold', async () => {
  await page.evaluate(async () => {
    const P = await import('./src/pace.js'), U = await import('./src/ui.js');
    window.__h = null; window.__pressed = 0;
    P.hold(3000).then((v) => (window.__h = v));
    U.modal('人物志', (close) => [U.h('button', { class: 'btn', onclick: () => { window.__pressed++; close(1); } }, '关闭')]);
  });
  await page.locator('.modal button').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.__pressed), 1, 'the window got the Enter');
  assert.equal(await page.evaluate(() => window.__h), null, 'the hold is still running');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__h === false);
});

test('a button left focused by the click that started a hold does not keep Enter from skipping it', async () => {
  await page.evaluate(async () => {
    const P = await import('./src/pace.js'), U = await import('./src/ui.js');
    window.__h = null; window.__pressed = 0;
    const b = U.h('button', { id: 'stray', onclick: () => window.__pressed++ }, '结束回合'); document.body.append(b); b.focus();
    P.hold(3000).then((v) => (window.__h = v));
  });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__h !== null);
  assert.equal(await page.evaluate(() => [window.__h, window.__pressed, document.getElementById('stray').remove()].slice(0, 2)).then((x) => x.join()), 'false,0');
});

for (const speed of [1, 4]) {
  test(`a timed vignette lasts its duration at ${speed}× (AI war 7.09 s at 1×)`, async () => {
    const ms = await page.evaluate(async (speed) => {
      const V = await import('./src/vignette.js');
      if (!(await V.warmVignette('sortie'))) throw new Error('无法加载出阵分镜');
      const t = performance.now();
      await V.playVignette({ scene: 'sortie', caption: '董卓军出阵　进攻袁绍的邺……', result: '攻陷！', duration: 7090 / speed, force: true });
      return performance.now() - t;
    }, speed);
    assert.ok(near(ms, 7090 / speed, 0.1), `ran ${Math.round(ms)} ms`);
  });
}

test('a vignette leaves Enter to an open window', async () => {
  await page.evaluate(async () => {
    const V = await import('./src/vignette.js'), U = await import('./src/ui.js');
    window.__v = null; window.__pressed = 0; const t = performance.now();
    V.playVignette({ scene: 'sortie', caption: 'x', duration: 1500, force: true }).then(() => (window.__v = performance.now() - t));
    U.modal('人物志', (close) => [U.h('button', { class: 'btn', onclick: () => { window.__pressed++; close(1); } }, '关闭')]);
  });
  await page.locator('.modal button').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__v !== null);
  assert.equal(await page.evaluate(() => window.__pressed), 1);
  assert.ok(await page.evaluate(() => window.__v) > 1300, 'the vignette was not skipped');
});

// A 计略 or mission that fails must not show the success first (2026-11-07): the storyboard stops on its attempt frame.
for (const [part, want, wrong] of [['attempt', 3, 8], [undefined, 8, 3], ['after', 8, 3]]) test(`a storyboard's part ${part ?? 'whole'} comes to rest on frame ${want}`, async () => {
  const r = await page.evaluate(async ({ part, want, wrong }) => {
    const V = await import('./src/vignette.js');
    const S = (await fetch('assets/ai/vignettes/index.json').then((x) => x.json()))['st-fire'], { cols } = S.story;
    const a = new Image(); a.src = `assets/ai/vignettes/${S.story.src}`; await a.decode();
    const cell = (i) => { const c = document.createElement('canvas'); c.width = S.w; c.height = S.h; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(a, (i % cols) * S.w, Math.floor(i / cols) * S.h, S.w, S.h, 0, 0, S.w, S.h); return g.getImageData(0, 0, S.w, S.h).data; };
    const off = (x, y) => { let d = 0; for (let i = 0; i < x.length; i += 40) d += Math.abs(x[i] - y[i]); return d / (x.length / 40); };
    const done = V.playVignette({ scene: 'st-fire', caption: 'x', duration: 1200, force: true, part });
    while (!document.querySelector('.vig canvas')) await new Promise((r) => setTimeout(r, 10));
    await new Promise((r) => setTimeout(r, 1140)); // the last frame has eased in, the wipe has the last moments
    const cv = document.querySelector('.vig canvas'), now = cv.getContext('2d').getImageData(0, 0, S.w, S.h).data, res = { want: off(now, cell(want)), wrong: off(now, cell(wrong)) };
    await done; return res;
  }, { part, want, wrong });
  assert.ok(r.want < 0.5, `differs from frame ${want} by ${r.want}`);
  assert.ok(r.wrong > 5, `no different from frame ${wrong}: ${r.wrong}`);
});

test('every command and 计略 scene has a published storyboard', async () => {
  const missing = await page.evaluate(async () => {
    const V = await import('./src/vignette.js'), idx = await fetch('assets/ai/vignettes/index.json').then((x) => x.json());
    const acts = ['防灾', '记录', '征兵', '移动', '运输', '搜索', '侦察', '赏赐', '施舍', '买米', '卖米', '卖宝', '病院', '学问所', '武器屋', '同盟', '诱纳', '离间'];
    const names = [...acts.map((a) => V.sceneFor(a)), ...['land', 'industry', 'pop'].map((f) => V.sceneFor('开发', f))];
    return names.filter((n) => !idx[n]?.story);
  });
  assert.deepEqual(missing, []);
});

// 记录: the date appears on the paper only once the scroll is open.
test('记录 writes the date on the open scroll', async () => {
  const r = await page.evaluate(async () => {
    const V = await import('./src/vignette.js'), text = V.recordText(190, 0, '曹操');
    await document.fonts.load('32px "Ma Shan Zheng"');
    const at = async (t, words) => { const c = document.createElement('canvas'); await V.sceneFrame('record', t, c, words); return c.getContext('2d').getImageData(0, 0, c.width, c.height).data; };
    const off = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) > 30) n++; return n / (a.length / 4); };
    // sceneFrame's span is 3 s
    return { early: off(await at(1, text), await at(1)), writing: off(await at(2.2, text), await at(2.2)), done: off(await at(2.95, text), await at(2.95)) };
  });
  assert.equal(r.early, 0, 'nothing on the paper before it is open');
  assert.ok(r.writing > 0 && r.writing < r.done, `it is written bit by bit: ${r.writing} vs ${r.done}`);
  assert.ok(r.done > 0.005 && r.done < 0.1, `the text and nothing else: ${r.done}`);
});

test('no page errors', () => assert.deepEqual(page.errors, []));

// D36 (2026-11-10): a 计略 that works plays nine frames in 2.8 s (1.4 s at 2×, 0.7 s at 4×). The frames were spread over
// the whole time, wipe included, with a fixed 120 ms cross-fade: at 2× and 4× the frame closed on the last picture before
// it had ever stood whole. Every frame now stands whole for a while, the last one before the wipe begins.
for (const speed of [1, 2, 4]) {
  test(`a 计略's last frame stands whole before the frame closes at ${speed}×; one that fails stops on the attempt`, async () => {
    const r = await page.evaluate(async (speed) => {
      const V = await import('./src/vignette.js'), index = await fetch('assets/ai/vignettes/index.json').then((x) => x.json());
      const draw = CanvasRenderingContext2D.prototype.drawImage, runs = {};
      let samples = [];
      CanvasRenderingContext2D.prototype.drawImage = function (image, ...a) {
        draw.call(this, image, ...a);
        const box = this.canvas.closest?.('.vig'); if (!box || a.length !== 8) return;
        const { w, h, story } = index[box.dataset.scene];
        samples.push({ frame: Math.floor(a[1] / h) * story.cols + Math.floor(a[0] / w), alpha: this.globalAlpha, out: box.classList.contains('out') });
      };
      try {
        for (const part of [undefined, 'attempt']) {
          samples = [];
          const t = performance.now();
          await V.playVignette({ scene: 'st-fire', caption: '程普的火计……', duration: 2800 / speed, force: true, part });
          // a cross-fade draws the frame before at 1 and then this one over it: a frame stands whole when it is the only draw of a paint
          const whole = samples.filter((s, i) => s.alpha === 1 && !(samples[i + 1]?.alpha < 1) && !s.out);
          runs[part ?? 'all'] = { ms: performance.now() - t, last: Math.max(...samples.map((s) => s.frame)), whole: [...new Set(whole.map((s) => s.frame))], lastWhole: whole.filter((s) => s.frame === (part ? index['st-fire'].story.attempt : 8)).length };
        }
      } finally { CanvasRenderingContext2D.prototype.drawImage = draw; }
      return { runs, attempt: index['st-fire'].story.attempt };
    }, speed);
    assert.ok(near(r.runs.all.ms, 2800 / speed, 0.12), `the show keeps its length: ${Math.round(r.runs.all.ms)} ms`);
    assert.equal(r.runs.all.last, 8);
    assert.ok(r.runs.all.lastWhole >= 2, `the last frame was painted whole ${r.runs.all.lastWhole} times before the wipe`);
    assert.deepEqual(r.runs.all.whole, [0, 1, 2, 3, 4, 5, 6, 7, 8], 'every frame stood whole');
    assert.equal(r.runs.attempt.last, r.attempt, 'a failed 计略 never shows the outcome');
    assert.ok(r.runs.attempt.lastWhole >= 2);
  });
}
