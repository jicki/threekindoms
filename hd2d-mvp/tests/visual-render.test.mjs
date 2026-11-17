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
      return { march: a.march.meta.frames, duel: a.duel.meta.frames, turn: a.duel.turn.meta.frames,
        size: [a.duel.tex.image.width, a.duel.tex.image.height], cols: a.duel.meta.atlasCols };
    });
    assert.equal(result.march.length, 15); assert.ok(result.duel.includes('strike')); assert.ok(result.duel.includes('downed'));
    assert.ok(result.turn.includes('front_idle')); assert.ok(result.turn.includes('back_idle'));
    assert.ok(result.size.every((n) => n <= 2048)); assert.ok(result.cols > 0);
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

test('版本服务暂不可用时仍能选择原版和内置女性版本', async () => {
  const page = await game.open();
  try {
    await skipIntro(page);
    await page.route('**/api/versions', (route) => route.abort());
    await page.locator('.sysmenu-btn').click(); await page.locator('.sysmenu-list button', { hasText: '游戏版本' }).click();
    const dialog = page.getByRole('dialog', { name: '选择游戏版本' });
    await dialog.getByText('无法读取服务器版本，仍可选择原版和内置版本。').waitFor();
    assert.equal(await dialog.getByRole('button', { name: /巾帼群英/ }).count(), 1);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('标题可选择内置女性版本，角色立绘和表情正常加载', async () => {
  const page = await game.open();
  try {
    await skipIntro(page); await page.locator('.sysmenu-btn').click();
    await page.locator('.sysmenu-list button', { hasText: '游戏版本' }).click();
    await page.getByRole('button', { name: /巾帼群英/ }).click();
    await page.waitForFunction(() => window.__game?.G.currentScenario() === 'builtin-female', null, { timeout: 30000 });
    const result = await page.evaluate(async () => {
      const { G } = window.__game, { face, figure } = await import('./src/ui.js');
      const officer = G.data().officers.find((o) => o.name === '孙尚香');
      const panel = document.createElement('div'); panel.id = 'visual-check';
      panel.append(figure(officer.id), face(officer.id, '', 'angry')); document.body.append(panel);
      await Promise.all([...panel.querySelectorAll('img')].map((img) => img.decode()));
      return { id: officer.id, sources: [...panel.querySelectorAll('img')].map((img) => img.getAttribute('src')) };
    });
    assert.equal(result.id, 237);
    assert.deepEqual(result.sources, ['assets/characters/sun/portrait.webp', 'assets/characters/sun/angry.webp']);
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
    await page.getByRole('button', { name: /巾帼群英/ }).click();
    await page.waitForFunction(() => window.__game?.G.currentScenario() === 'builtin-female', null, { timeout: 30000 });
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
  const page = await game.open('', { setup: (context) => context.addInitScript(() => sessionStorage.setItem('haou-hd2d-scenario', 'builtin-female')) });
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
