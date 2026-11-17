import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, newCampaign, skipIntro } from './game.mjs';

let game;
before(async () => { game = await startGame(); });
after(() => game?.close());

test('多行动作图集按帧保持原始像素和顺序', async () => {
  const page = await game.open();
  try {
    const result = await page.evaluate(async () => {
      const THREE = await import('three'), { packSpriteStrip, spriteFrame } = await import('./src/assets.js');
      const c = document.createElement('canvas'); c.width = 20; c.height = 4;
      const g = c.getContext('2d'), colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff'];
      colors.forEach((color, i) => { g.fillStyle = color; g.fillRect(i * 4, 0, 4, 4); });
      const tex = new THREE.CanvasTexture(c), meta = { cell: [4, 4], frames: colors };
      const atlas = packSpriteStrip({ tex, meta }, 12);
      const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true }); renderer.setSize(8, 8, false);
      const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10); camera.position.z = 2;
      const material = new THREE.MeshBasicMaterial({ map: atlas.tex }), mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material); scene.add(mesh);
      const pixels = [];
      for (let i = 0; i < colors.length; i++) {
        spriteFrame(atlas.tex, atlas.meta, i); renderer.render(scene, camera);
        const out = new Uint8Array(4), gl = renderer.getContext(); gl.readPixels(4, 4, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out); pixels.push([...out]);
      }
      return { cols: atlas.meta.atlasCols, rows: atlas.meta.atlasRows, pixels };
    });
    assert.deepEqual([result.cols, result.rows], [3, 2]);
    assert.deepEqual(result.pixels, [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 0, 255], [255, 0, 255, 255]]);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('内置动作网格产生可用的行军和单挑帧，并限制纹理尺寸', async () => {
  const page = await game.open();
  try {
    const result = await page.evaluate(async () => {
      const { loadGridMotion } = await import('./src/assets.js'), a = await loadGridMotion('assets/characters/sun/motion.png');
      const image = a.march.tex.image, canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, 128, 128).data; let top = 128, bottom = -1;
      for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) if (pixels[(y * 128 + x) * 4 + 3] > 127) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
      return { march: a.march.meta.frames, duel: a.duel.meta.frames, turn: a.duel.turn.meta.frames,
        size: [a.duel.tex.image.width, a.duel.tex.image.height], cols: a.duel.meta.atlasCols,
        height: a.duel.meta.figH, pixels: [top, bottom], walk: a.duel.meta.clips.walk, gallop: a.duel.meta.clips.gallop,
        front: a.duel.turn.meta.clips['front:charge'], back: a.duel.turn.meta.clips['back:charge'] };
    });
    assert.equal(result.march.length, 15); assert.ok(result.duel.includes('strike')); assert.ok(result.duel.includes('downed'));
    assert.ok(result.turn.includes('front_idle')); assert.ok(result.turn.includes('back_idle'));
    assert.ok(result.size.every((n) => n <= 2048)); assert.ok(result.cols > 0);
    assert.equal(result.pixels[1], 127, '透明脚底不会令人物悬浮');
    assert.equal(result.height, result.pixels[1] - result.pixels[0] + 1, '人物尺寸按真实可见高度计算');
    for (const clip of [result.walk, result.gallop, result.front, result.back]) assert.ok(new Set(clip.map(([frame]) => frame)).size > 1, '移动方向均使用行军帧');
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('动作网格首帧为空时仍可加载，其他帧不会越出自己的格子', async () => {
  const page = await game.open();
  try {
    const result = await page.evaluate(async () => {
      const { loadGridMotion } = await import('./src/assets.js'), source = document.createElement('canvas');
      source.width = source.height = 512; const ctx = source.getContext('2d');
      ctx.fillStyle = '#ff0000'; ctx.fillRect(128 + 30, 30, 60, 80);
      const blob = await new Promise((resolve) => source.toBlob(resolve, 'image/png')), url = URL.createObjectURL(blob);
      try {
        const motion = await loadGridMotion(url), canvas = motion.march.tex.image, data = canvas.getContext('2d').getImageData(0, 0, 256, 128).data;
        let first = 0, second = 0;
        for (let y = 0; y < 128; y++) for (let x = 0; x < 256; x++) if (data[(y * 256 + x) * 4 + 3]) { if (x < 128) first++; else second++; }
        return { first, second, height: motion.duel.meta.figH };
      } finally { URL.revokeObjectURL(url); }
    });
    assert.deepEqual(result, { first: 0, second: 4800, height: 112 });
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('七名内置角色的行军帧按同一脚底和角色比例显示', async () => {
  const page = await game.open();
  try {
    const result = await page.evaluate(async () => {
      const { loadGridMotion } = await import('./src/assets.js'), out = [];
      for (const key of ['sun', 'zhen', 'diao', 'cai', 'wang', 'chen', 'gao']) {
        const motion = await loadGridMotion(`assets/characters/${key}/motion.png`), image = motion.march.tex.image;
        const ctx = image.getContext('2d'), pixels = ctx.getImageData(0, 0, 128 * 5, 128).data, boxes = [];
        for (let i = 0; i < 5; i++) {
          let top = 128, bottom = -1;
          for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) if (pixels[(y * 640 + i * 128 + x) * 4 + 3] > 127) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
          boxes.push({ top, bottom });
        }
        out.push({ key, height: motion.march.meta.standHeight, duelHeight: motion.duel.meta.figH, boxes });
        motion.march.tex.dispose(); motion.duel.tex.dispose(); motion.duel.turn.tex.dispose();
      }
      return out;
    });
    for (const item of result) {
      assert.ok(item.boxes.every((box) => box.bottom === 127), `${item.key} 行军脚底不一致`);
      assert.equal(item.height, item.boxes[0].bottom - item.boxes[0].top + 1, `${item.key} 的比例不匹配`);
      assert.equal(item.duelHeight, item.height);
    }
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('新角色进入单挑时实际播放多帧行军动作', async () => {
  const page = await game.open('', { setup: (context) => context.addInitScript(() => sessionStorage.setItem('haou-hd2d-scenario', 'builtin-heroes')) });
  try {
    await page.evaluate(() => { window.__game.debug.quickTactical(237, 38, 2); });
    await page.waitForSelector('.tq-form', { timeout: 60000 });
    await page.locator('.tq-form').first().click(); await page.locator('.tq-deploy:not(.arming)').click();
    await page.waitForSelector('.tq-start button', { timeout: 30000 });
    const frames = await page.evaluate(async () => {
      const { debug } = window.__game, view = debug.duelView, seen = new Set();
      debug.show('dview');
      const timer = setInterval(() => { const frame = view.probe(237)?.frame; if (frame) seen.add(frame); }, 20);
      try { await view.enter(window.__tq, { a: 'attacker', d: 'defender' }); }
      finally { clearInterval(timer); }
      return [...seen];
    });
    assert.ok(frames.filter((frame) => frame.startsWith('gallop_')).length >= 2, `入场未播放多帧: ${frames}`);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('新角色在白兵移动时实际播放侧面和正面行军帧', async () => {
  const page = await game.open('', { setup: (context) => context.addInitScript(() => sessionStorage.setItem('haou-hd2d-scenario', 'builtin-heroes')) });
  try {
    await page.evaluate(() => { window.__game.debug.quickTactical(237, 38, 2); });
    await page.waitForSelector('.tq-form', { timeout: 60000 });
    await page.locator('.tq-form').first().click(); await page.locator('.tq-deploy:not(.arming)').click();
    await page.waitForSelector('.tq-start button', { timeout: 30000 });
    const frames = await page.evaluate(async () => {
      const view = window.__game.tview, unit = window.__tq.gen('a'), label = document.querySelector('.tk.attacker.gen');
      let group; view.scene.traverse((o) => { if (o.isCSS2DObject && o.element === label) group = o.parent; });
      const maps = [];
      group.traverse((o) => { const t = o.material?.map; if (t?.image?.width === 2048 && !maps.includes(t)) maps.push(t); });
      const side = maps.find((t) => t.image.height === 256), turn = maps.find((t) => t.image.height === 128);
      if (!side || !turn) throw new Error('未找到人物白兵动作图');
      const seen = { side: new Set(), front: new Set() }, index = (t) => Math.round(t.offset.x * 16) + (t.offset.y < 0.25 && t.image.height === 256 ? 16 : 0);
      const timer = setInterval(() => { seen.side.add(index(side)); seen.front.add(index(turn)); }, 20);
      view.setSpeed(0.25); const [x, y] = [unit.x, unit.y];
      try {
        for (let i = 0; i < 4; i++) await view.play({ type: 'move', u: unit, from: [x + (i % 2), y], to: [x + (1 - i % 2), y] }, {});
        for (let i = 0; i < 4; i++) await view.play({ type: 'move', u: unit, from: [x, y + (i % 2)], to: [x, y + (1 - i % 2)] }, {});
        await view.settle();
      } finally { clearInterval(timer); }
      return { side: [...seen.side], front: [...seen.front] };
    });
    assert.ok(frames.side.filter((i) => i >= 2 && i <= 5).length >= 2, `侧面未行军: ${frames.side}`);
    assert.ok(frames.front.filter((i) => i === 1 || i === 2).length >= 2, `正面未行军: ${frames.front}`);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('三名女性角色的立绘、表情与透明动作图均可解码', async () => {
  const page = await game.open();
  try {
    const images = await page.evaluate(async () => {
      const result = [];
      for (const key of ['sun', 'zhen', 'diao']) for (const kind of ['portrait', 'calm', 'joy', 'angry', 'grief', 'motion']) {
        const image = new Image(); image.src = `assets/characters/${key}/${kind}.${kind === 'motion' ? 'png' : 'webp'}`; await image.decode();
        let transparent = true;
        if (kind === 'motion') {
          const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
          const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
          const data = context.getImageData(0, 0, image.width, image.height).data; let clear = false, solid = false;
          for (let i = 3; i < data.length && !(clear && solid); i += 4) { clear ||= data[i] === 0; solid ||= data[i] === 255; }
          transparent = clear && solid;
        }
        result.push({ key, kind, width: image.width, height: image.height, transparent });
      }
      return result;
    });
    assert.equal(images.length, 18);
    for (const image of images) {
      const size = image.kind === 'motion' ? [512, 512] : image.kind === 'portrait' ? [768, 1152] : [384, 512];
      assert.deepEqual([image.width, image.height], size, `${image.key}/${image.kind}`);
      assert.equal(image.transparent, true, `${image.key}/${image.kind}`);
    }
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('弓、扇和女性轻甲图标可在浏览器中读取', async () => {
  const page = await game.open('', { setup: (context) => context.addInitScript(() => sessionStorage.setItem('haou-hd2d-scenario', 'builtin-female')) });
  try {
    const icons = await page.evaluate(async () => {
      const { equipIcon } = await import('./src/assets.js'), data = window.__game.G.data();
      const sun = data.officers[237], zhen = data.officers[238], ids = [sun.weapon, zhen.weapon, 24 + sun.armor];
      return Promise.all(ids.map(async (id) => { const image = new Image(); image.src = equipIcon(id); await image.decode();
        return { source: image.getAttribute('src'), size: [image.naturalWidth, image.naturalHeight] }; }));
    });
    assert.deepEqual(icons.map((icon) => icon.source), ['assets/equipment/bow.webp', 'assets/equipment/fan.webp', 'assets/equipment/armor.webp']);
    assert.ok(icons.every((icon) => icon.size[0] === 128 && icon.size[1] === 128));
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('版本服务暂不可用时仍能选择原版和合并后的内置版本', async () => {
  const page = await game.open();
  try {
    await skipIntro(page);
    await page.route('**/api/versions', (route) => route.abort());
    await page.locator('.sysmenu-btn').click(); await page.locator('.sysmenu-list button', { hasText: '游戏版本' }).click();
    const dialog = page.getByRole('dialog', { name: '选择游戏版本' });
    await dialog.getByText('无法读取服务器版本，仍可选择原版和内置版本。').waitFor();
    assert.equal(await dialog.getByRole('button', { name: /^群英新篇·君主列传\s*(当前版本|选择此版本)$/ }).count(), 1);
    assert.equal(await dialog.getByRole('button', { name: /群英新篇·新阵容/ }).count(), 0);
    assert.equal(await dialog.getByRole('button', { name: /巾帼群英/ }).count(), 0);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('标题可选择合并后的内置版本，原有角色立绘和表情正常加载', async () => {
  const page = await game.open();
  try {
    await skipIntro(page); await page.locator('.sysmenu-btn').click();
    await page.locator('.sysmenu-list button', { hasText: '游戏版本' }).click();
    await page.getByRole('button', { name: /^群英新篇·君主列传\s*(当前版本|选择此版本)$/ }).click();
    await page.waitForFunction(() => window.__game?.G.currentScenario() === 'builtin-sovereigns-expanded-map', null, { timeout: 30000 });
    const result = await page.evaluate(async () => {
      const { G } = window.__game, { face, figure } = await import('./src/ui.js');
      const officer = G.data().officers.find((o) => o.name === '孙尚香');
      const panel = document.createElement('div'); panel.id = 'visual-check';
      panel.append(figure(officer.id), face(officer.id, '', 'angry')); document.body.append(panel);
      await Promise.all([...panel.querySelectorAll('img')].map((img) => img.decode()));
      return { id: officer.id, sources: [...panel.querySelectorAll('img')].map((img) => img.getAttribute('src')) };
    });
    assert.equal(result.id, 237);
    assert.deepEqual(result.sources, ['assets/characters/v2-sun/portrait.webp', 'assets/characters/v2-sun/angry.webp']);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('已配置表情或立绘无法读取时逐级回退', async () => {
  const page = await game.open();
  try {
    for (const path of ['sun/angry.webp', 'zhen/angry.webp', 'zhen/portrait.webp']) {
      await page.route(`**/assets/characters/${path}`, (route) => route.abort());
    }
    await page.evaluate(async () => {
      const { G } = window.__game, data = structuredClone(G.data());
      data.officers[0].visual = { portrait: 'b-sun-portrait', faces: { angry: 'b-sun-angry' } };
      data.officers[1].visual = { portrait: 'b-zhen-portrait', faces: { angry: 'b-zhen-angry' } };
      G.setData(data);
      const { face } = await import('./src/ui.js'), panel = document.createElement('div');
      panel.id = 'visual-fallback-check'; panel.append(face(0, '', 'angry'), face(1, '', 'angry')); document.body.append(panel);
    });
    await page.waitForFunction(() => [...document.querySelectorAll('#visual-fallback-check img')]
      .every((img) => img.complete && img.naturalWidth > 0));
    const sources = await page.locator('#visual-fallback-check img').evaluateAll((images) => images.map((img) => img.getAttribute('src')));
    assert.equal(sources[0], 'assets/characters/sun/portrait.webp');
    assert.doesNotMatch(sources[1], /assets\/characters\/zhen\//);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('模拟桌面离线协议时仍可选择内置版本且不请求版本接口', async () => {
  let versionRequests = 0;
  const page = await game.open('', { setup: async (context) => {
    await context.route('**/api/versions**', (route) => { versionRequests++; return route.abort(); });
    await context.route('**/src/app.js', async (route) => {
      const response = await route.fetch(), source = await response.text();
      const check = "const serverVersions = location.protocol === 'http:' || location.protocol === 'https:';";
      if (!source.includes(check)) throw new Error('无法模拟桌面协议');
      await route.fulfill({ response, body: source.replace(check, 'const serverVersions = false;') });
    });
  } });
  try {
    await skipIntro(page); await page.locator('.sysmenu-btn').click();
    await page.locator('.sysmenu-list button', { hasText: '游戏版本' }).click();
    await page.getByRole('button', { name: /^群英新篇·君主列传\s*(当前版本|选择此版本)$/ }).click();
    await page.waitForFunction(() => window.__game?.G.currentScenario() === 'builtin-sovereigns-expanded-map', null, { timeout: 30000 });
    assert.equal(versionRequests, 0);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('女性角色动作可进入白兵与单挑，并完成一次攻击演出', async () => {
  const page = await game.open('', { setup: (ctx) => ctx.addInitScript(() => sessionStorage.setItem('haou-hd2d-scenario', 'builtin-female')) });
  try {
    await page.evaluate(() => { window.__game.debug.quickTactical(237, 38, 2); });
    await page.waitForSelector('.tq-form', { timeout: 60000 });
    await page.locator('.tq-form').first().click(); await page.locator('.tq-deploy:not(.arming)').click();
    await page.waitForSelector('.tq-start button', { timeout: 30000 });
    const maps = await page.evaluate(() => {
      const dimensions = [];
      window.__game.tview.scene.traverse((o) => { const image = o.material?.map?.image; if (image) dimensions.push([image.width, image.height]); });
      return dimensions;
    });
    assert.ok(maps.some(([w, h]) => w === 2048 && h === 256), '白兵载入多行角色动作');
    const pose = await page.evaluate(async () => {
      const { debug } = window.__game, duel = debug.duelView;
      debug.show('dview'); await duel.enter(window.__tq, { a: 'attacker', d: 'defender' });
      await duel.act({ by: 237, cmd: 'attack', hit: true, dmg: 5 });
      return duel.pose(237, 'strike');
    });
    assert.equal(pose, 'strike');
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('女性角色的行军动作可在战场使用', async () => {
  const page = await game.open('', { setup: (context) => context.addInitScript(() => sessionStorage.setItem('haou-hd2d-scenario', 'builtin-heroes')) });
  try {
    await page.evaluate(async () => (await import('./src/quality.js')).warView.set('3d'));
    await newCampaign(page);
    await page.evaluate(() => {
      const { g, G, debug } = window.__game, home = g.factions[g.player].city;
      const target = G.roads(home).map((id) => g.cities[id]).find((city) => city.faction !== g.player && city.faction !== G.NONE && city.officers.length);
      Object.assign(g.officers[237], { status: G.SERVING, faction: g.player, city: home, soldiers: 500 });
      g.cities[home].officers.push(237);
      const commander = g.cities[home].officers[0];
      for (const id of [commander, ...target.officers]) g.officers[id].soldiers ||= 500;
      debug.fieldWar(debug.setupWar(g, { from: home, to: target.id, ids: [commander, 237], commander, gold: 100, rice: 400 }), 'att');
    });
    await page.waitForFunction(() => window.__game.war?.finishDeploy && document.body.dataset.screen === 'war', null, { timeout: 60000 });
    await page.waitForFunction(() => { const war = window.__game.war, unit = war.field.units.find((u) => u.id === 237); return unit && war.facing(unit).row; });
    const visual = await page.evaluate(() => {
      const war = window.__game.war, unit = war.field.units.find((u) => u.id === 237), sizes = [];
      war.spriteOf(unit).traverse((object) => { const image = object.material?.map?.image; if (image) sizes.push([image.width, image.height]); });
      return { facing: war.facing(unit), sizes };
    });
    assert.ok(visual.sizes.some(([width, height]) => width === 1920 && height === 128));
    assert.match(visual.facing.row, /^(side|front|back)_/);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('持弓女性将领的白兵远射显示箭矢并播放落点音效', async () => {
  const page = await game.open('', { setup: (context) => context.addInitScript(() => sessionStorage.setItem('haou-hd2d-scenario', 'builtin-female')) });
  try {
    await page.evaluate(() => { window.__game.debug.quickTactical(237, 38, 2); });
    await page.waitForSelector('.tq-form', { timeout: 60000 });
    await page.locator('.tq-form').first().click(); await page.locator('.tq-deploy:not(.arming)').click();
    await page.waitForSelector('.tq-start button', { timeout: 30000 });
    const result = await page.evaluate(async () => {
      const battle = window.__tq, view = window.__game.tview, a = battle.gen('a'), d = battle.gen('d'), sounds = [];
      for (const unit of battle.units) if (unit.kind !== 'gen') unit.out = true;
      battle.map = Array.from({ length: 10 }, () => Array(16).fill(0));
      Object.assign(a, { x: 5, y: 4 }); Object.assign(d, { x: 7, y: 4 });
      const event = battle.act(a); let arrow = false;
      const timer = setInterval(() => view.scene.traverse((object) => {
        const p = object.geometry?.parameters; if (p?.width === 0.016 && p?.height === 0.016 && p?.depth === 0.28) arrow = true;
      }), 10);
      try { await view.play(event, { sfx: (name) => sounds.push(name) }); }
      finally { clearInterval(timer); }
      return { type: event.type, ranged: event.ranged, arrow, sounds };
    });
    assert.equal(result.type, 'attack'); assert.equal(result.ranged, true); assert.equal(result.arrow, true);
    assert.ok(result.sounds.includes('sfx-volley-land'));
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('为新增角色选择已有武将动作时加载对应战斗素材', async (t) => {
  const requested = [];
  const page = await game.open('', { setup: async (context) => {
    context.on('request', (request) => requested.push(new URL(request.url()).pathname));
    await context.addInitScript(() => sessionStorage.setItem('haou-hd2d-scenario', 'builtin-female'));
  } });
  try {
    const exists = await page.evaluate(() => fetch('assets/ai/sprites/duel/38.json', { method: 'HEAD' }).then((response) => response.ok));
    if (!exists) { t.skip('未安装可选的原有动作素材包'); return; }
    await page.evaluate(() => {
      window.__game.G.data().officers[237].visual.motion = 'o-38';
      window.__game.debug.quickTactical(237, 51, 2);
    });
    await page.waitForSelector('.tq-form', { timeout: 60000 });
    assert.ok(requested.some((path) => path.endsWith('/assets/ai/sprites/duel/38.png')));
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});
