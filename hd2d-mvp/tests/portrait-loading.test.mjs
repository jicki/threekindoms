import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame } from './game.mjs';

let game;
before(async () => { game = await startGame(); });
after(() => game?.close());

test('刷新后头像首次请求失败时重试原图，不丢失人物表情', async () => {
  let requests = 0;
  const page = await game.open('', { setup: (context) => context.route('**/assets/ai/faces/38-calm.webp*', (route) => {
    requests++; return requests === 1 ? route.abort() : route.continue();
  }) });
  try {
    await page.reload(); await page.waitForFunction(() => window.__game?.debug);
    await page.evaluate(async () => {
      const { avatar } = await import('./src/ui.js'), img = avatar(38);
      img.id = 'portrait-retry'; document.body.append(img);
    });
    await page.waitForFunction(() => {
      const img = document.querySelector('#portrait-retry');
      return img.complete && img.naturalWidth > 0 && img.currentSrc.includes('/faces/38-calm.webp');
    }, null, { timeout: 10000 });
    assert.equal(requests, 2);
    assert.equal(await page.locator('#portrait-retry').getAttribute('alt'), '关羽');
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('表情和立绘永久失败时回退到同一人物的普通头像', async () => {
  const page = await game.open('', { setup: async (context) => {
    for (const path of ['faces/38-calm.webp', 'halfbody/38.webp']) {
      await context.route(`**/assets/ai/${path}*`, (route) => route.abort());
    }
  } });
  try {
    await page.evaluate(async () => {
      const { avatar, figure } = await import('./src/ui.js'), panel = document.createElement('div');
      panel.id = 'portrait-fallback'; panel.append(avatar(38), figure(38)); document.body.append(panel);
    });
    await page.waitForFunction(() => [...document.querySelectorAll('#portrait-fallback img')]
      .every((img) => img.complete && img.naturalWidth > 0 && img.currentSrc.includes('/portraits/38.webp')), null, { timeout: 10000 });
    assert.deepEqual(await page.locator('#portrait-fallback img').evaluateAll((imgs) => imgs.map((img) => img.alt)), ['关羽', '关羽']);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('头像和兜底图片均不可用时显示内置占位图而不是破损图标', async () => {
  const page = await game.open('', { setup: async (context) => {
    for (const path of ['faces/38-calm.webp', 'portraits/38.webp', 'portraits/0.webp']) {
      await context.route(`**/assets/ai/${path}*`, (route) => route.abort());
    }
  } });
  try {
    await page.evaluate(async () => {
      const { avatar } = await import('./src/ui.js'), img = avatar(38);
      img.id = 'portrait-placeholder'; document.body.append(img);
    });
    await page.waitForFunction(() => {
      const img = document.querySelector('#portrait-placeholder');
      return img.complete && img.naturalWidth > 0 && img.currentSrc.startsWith('data:image/svg+xml');
    }, null, { timeout: 10000 });
    assert.equal(await page.locator('#portrait-placeholder').getAttribute('alt'), '关羽');
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('可见头像加载卡住时重试，已经移除的头像不继续请求', { timeout: 30000 }, async () => {
  for (const removed of [false, true]) {
    let release, requests = 0;
    const stalled = new Promise((resolve) => { release = resolve; });
    const page = await game.open('', { clock: true, setup: (context) => context.route('**/assets/ai/faces/38-calm.webp*', async (route) => {
      requests++;
      if (requests === 1) { await stalled; return route.abort().catch(() => {}); }
      return route.continue();
    }) });
    try {
      await page.evaluate(async () => {
        window.__timeScale(4);
        const { avatar } = await import('./src/ui.js'), img = avatar(38);
        Object.assign(img.style, { position: 'fixed', left: '20px', top: '20px', width: '100px', height: '100px', zIndex: '9999' });
        img.id = 'stalled-portrait'; document.body.append(img);
      });
      await page.waitForFunction(() => !!document.querySelector('#stalled-portrait'));
      await page.waitForTimeout(150);
      assert.equal(requests, 1, '可见头像应开始加载');
      if (removed) {
        await page.evaluate(() => document.querySelector('#stalled-portrait').remove());
        await page.waitForTimeout(3500);
        assert.equal(requests, 1, '已移除头像不能触发超时重试');
      } else {
        await page.waitForFunction(() => {
          const img = document.querySelector('#stalled-portrait'); return img.complete && img.naturalWidth > 0;
        }, null, { timeout: 10000 });
        assert.equal(requests, 2);
        assert.match(await page.locator('#stalled-portrait').getAttribute('src'), /faces\/38-calm\.webp/);
      }
      assert.deepEqual(page.errors, []);
    } finally { release(); await page.context().close(); }
  }
});

test('桌面 app 协议和本地文件协议的头像失败后仍会重试', async () => {
  const page = await game.open();
  try {
    const attempts = await page.evaluate(async () => {
      const { avatar } = await import('./src/ui.js'), out = [];
      for (const baseUrl of ['app://game/', 'file:///tmp/threekindoms/']) {
        const base = document.createElement('base'); base.href = baseUrl; document.head.prepend(base);
        const original = Element.prototype.setAttribute, writes = [];
        Element.prototype.setAttribute = function (name, value) {
          if (this instanceof HTMLImageElement && name === 'src' && /^(app|file):/.test(value)) {
            writes.push(value);
            return original.call(this, name, 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/%3E');
          }
          return original.call(this, name, value);
        };
        try {
          const img = avatar(38); document.body.append(img); img.dispatchEvent(new Event('error'));
          await new Promise((resolve) => setTimeout(resolve, 650));
          out.push(writes); img.remove();
        } finally { Element.prototype.setAttribute = original; base.remove(); }
      }
      return out;
    });
    for (const [i, protocol] of ['app:', 'file:'].entries()) {
      assert.equal(attempts[i].length, 1, `${protocol} 未重试`);
      const url = new URL(attempts[i][0]);
      assert.equal(url.protocol, protocol);
      assert.match(url.pathname, /assets\/ai\/faces\/38-calm\.webp$/);
      assert.ok(url.searchParams.has('_image_retry'));
    }
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('离屏懒加载头像不会被误判超时，进入视口后才启动超时恢复', { timeout: 30000 }, async () => {
  let release, requests = 0;
  const stalled = new Promise((resolve) => { release = resolve; });
  const page = await game.open('', { clock: true, setup: (context) => context.route('**/assets/ai/faces/38-calm.webp*', async (route) => {
    requests++;
    if (requests === 1) { await stalled; return route.abort().catch(() => {}); }
    return route.continue();
  }) });
  try {
    await page.evaluate(async () => {
      window.__timeScale(4);
      const { avatar } = await import('./src/ui.js'), img = avatar(38);
      Object.assign(img.style, { position: 'fixed', left: '-2500px', top: '20px', width: '100px', height: '100px' });
      img.id = 'offscreen-portrait'; document.body.append(img);
    });
    await page.waitForTimeout(3500);
    assert.ok(requests <= 1, `离屏图片不应超时重试：${requests}`);
    await page.evaluate(() => { document.querySelector('#offscreen-portrait').style.left = '20px'; });
    await page.waitForFunction(() => {
      const img = document.querySelector('#offscreen-portrait'); return img.complete && img.naturalWidth > 0;
    }, null, { timeout: 10000 });
    assert.equal(requests, 2);
    assert.deepEqual(page.errors, []);
  } finally { release(); await page.context().close(); }
});

test('尚未显示就被移除的头像会解除可见性监听', async () => {
  const page = await game.open();
  try {
    await page.evaluate(async () => {
      const { avatar } = await import('./src/ui.js'), original = IntersectionObserver.prototype.unobserve;
      const img = avatar(38); window.__discardedPortrait = img; window.__portraitUnobserved = false;
      IntersectionObserver.prototype.unobserve = function (target) {
        if (target === img) window.__portraitUnobserved = true;
        return original.call(this, target);
      };
      document.body.append(img); img.remove();
    });
    await page.waitForFunction(() => window.__portraitUnobserved, null, { timeout: 5000 });
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('头像索引临时请求失败后仍能恢复各人物的素材', async () => {
  const requests = {};
  const paths = ['portraits', 'faces', 'halfbody'];
  const page = await game.open('', { setup: async (context) => {
    for (const path of paths) await context.route(`**/assets/ai/${path}/index.json`, (route) => {
      requests[path] = (requests[path] ?? 0) + 1;
      return requests[path] === 1 ? route.abort() : route.continue();
    });
  } });
  try {
    await page.evaluate(async () => {
      const { avatar, figure, face } = await import('./src/ui.js'), panel = document.createElement('div');
      panel.id = 'portrait-indices'; panel.append(avatar(38), figure(38), face(38)); document.body.append(panel);
    });
    await page.waitForFunction(() => [...document.querySelectorAll('#portrait-indices img')].every((img) => img.complete && img.naturalWidth > 0));
    const sources = await page.locator('#portrait-indices img').evaluateAll((imgs) => imgs.map((img) => img.getAttribute('src')));
    assert.match(sources[0], /faces\/38-calm\.webp/);
    assert.match(sources[1], /halfbody\/38\.webp/);
    assert.match(sources[2], /portraits\/38\.webp/);
    assert.deepEqual(requests, { portraits: 2, faces: 2, halfbody: 2 });
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('头像索引请求卡住时会取消并重试，不阻塞进入游戏', { timeout: 30000 }, async () => {
  let release, requests = 0;
  const stalled = new Promise((resolve) => { release = resolve; });
  let page;
  try {
    page = await game.open('', { setup: (context) => context.route('**/assets/ai/faces/index.json', async (route) => {
      requests++;
      if (requests === 1) { await stalled; return route.abort().catch(() => {}); }
      return route.continue();
    }) });
    assert.equal(requests, 2);
    await page.evaluate(async () => {
      const { avatar } = await import('./src/ui.js'), img = avatar(38);
      img.id = 'portrait-after-timeout'; document.body.append(img);
    });
    await page.waitForFunction(() => {
      const img = document.querySelector('#portrait-after-timeout'); return img.complete && img.naturalWidth > 0;
    });
    assert.match(await page.locator('#portrait-after-timeout').getAttribute('src'), /faces\/38-calm\.webp/);
    assert.deepEqual(page.errors, []);
  } finally { release(); await page?.context().close(); }
});
