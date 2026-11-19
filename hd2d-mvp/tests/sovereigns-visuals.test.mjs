import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, newCampaign, closeMessages } from './game.mjs';

let game;
before(async () => { game = await startGame(); });
after(() => game?.close());
const setup = (context) => context.addInitScript(() => sessionStorage.setItem('haou-hd2d-scenario', 'builtin-sovereigns'));

test('三位新增君主使用不同动作图，每格可解码并能转换为战场与单挑帧', { timeout: 120000 }, async () => {
  const page = await game.open('&flat', { setup });
  try {
    const result = await page.evaluate(async () => {
      const { visualUrl, validVisualRef } = await import('./src/core/visuals.js'), { loadGridMotion } = await import('./src/assets.js');
      const out = [];
      for (const [key, name] of [['gongsun', '公孙瓒'], ['yuanshu', '袁术'], ['liubiao', '刘表']]) {
        const o = window.__game.G.data().officers.find((item) => item.name === name);
        if (o.visual.motion !== `b-${key}-motion`) throw Error(`${name} 动作没有接入`);
        const url = visualUrl(o.visual.motion), blob = await (await fetch(url)).blob(), img = await createImageBitmap(blob);
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
        const context = canvas.getContext('2d'); context.drawImage(img, 0, 0, 512, 512); img.close();
        const pixels = context.getImageData(0, 0, 512, 512).data, cells = Array.from({ length: 16 }, () => ({ visible: 0, clear: 0 }));
        for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
          const cell = cells[Math.floor(y / 128) * 4 + Math.floor(x / 128)], a = pixels[(y * 512 + x) * 4 + 3];
          if (a > 127) cell.visible++; else if (a === 0) cell.clear++;
        }
        let uploadRejected = false;
        try { await loadGridMotion(url); } catch { uploadRejected = true; }
        const motion = await loadGridMotion(url, { builtinSize: true });
        out.push({ key, hash: [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].join(','), cells,
          uploadRejected, march: motion.march.meta.frames.length, strike: motion.duel.meta.frames.includes('strike'),
          valid: validVisualRef(o.visual.motion, 'motion', window.__game.G.data().officers.length), invalidPortrait: validVisualRef(`b-${key}-portrait`, 'portrait', 1000) });
        motion.march.tex.dispose(); motion.duel.tex.dispose(); motion.duel.turn.tex.dispose();
      }
      return out;
    });
    assert.equal(new Set(result.map((item) => item.hash)).size, 3);
    for (const item of result) {
      assert.ok(item.cells.every((cell) => cell.visible > 100 && cell.clear > 100), item.key);
      assert.equal(item.uploadRejected, true); assert.equal(item.valid, true); assert.equal(item.invalidPortrait, false);
      assert.equal(item.march, 15); assert.equal(item.strike, true);
    }
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('君主列传的新增人物均使用可解码且互不相同的新风格立绘与表情', { timeout: 120000 }, async () => {
  const page = await game.open('&flat', { setup });
  try {
    const results = await page.evaluate(async () => {
      const { OFFICER_PRESETS, visualUrl } = await import('./src/core/visuals.js');
      const out = [];
      for (const preset of OFFICER_PRESETS) {
        const officer = window.__game.G.data().officers.find((o) => o.name === preset.name && o.visual?.portrait === `b-v2-${preset.key}-portrait`);
        if (!officer) throw Error(`${preset.name} 缺少新立绘`);
        const hashes = [], sizes = [];
        for (const ref of [officer.visual.portrait, ...Object.values(officer.visual.faces)]) {
          const response = await fetch(visualUrl(ref)); if (!response.ok) throw Error(`${ref}: ${response.status}`);
          const blob = await response.blob(), img = await createImageBitmap(blob);
          sizes.push([img.width, img.height]); img.close();
          hashes.push(Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))).join(','));
        }
        out.push({ name: preset.name, hashes, sizes });
      }
      return out;
    });
    assert.equal(results.length, 25);
    assert.equal(new Set(results.map((item) => item.hashes[0])).size, 25);
    for (const item of results) {
      assert.deepEqual(item.sizes, [[768, 1152], ...Array.from({ length: 4 }, () => [384, 512])], item.name);
      assert.equal(new Set(item.hashes.slice(1)).size, 4, item.name);
    }
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('八位人物的立绘、四种表情和动作可独立加载，动作每格均有透明背景和内容', { timeout: 120000 }, async () => {
  const page = await game.open('&flat', { setup });
  try {
    const results = await page.evaluate(async () => {
      const { G } = window.__game, { visualUrl } = await import('./src/core/visuals.js');
      const { loadGridMotion } = await import('./src/assets.js'), out = [];
      for (const key of ['tianyu', 'qiaorui', 'huangzu', 'liuqi', 'xunyou', 'qianzhao', 'huangshi', 'zhurong']) {
        const officer = G.data().officers.find((o) => o.visual?.portrait === `b-v2-${key}-portrait`);
        if (!officer) throw Error(`${key} 无独立素材`);
        const refs = [officer.visual.portrait, ...Object.values(officer.visual.faces), officer.visual.motion], sizes = [], hashes = [];
        for (const ref of refs) {
          const response = await fetch(visualUrl(ref)); if (!response.ok) throw Error(`${ref}: ${response.status}`);
          const blob = await response.blob(), bitmap = await createImageBitmap(blob);
          sizes.push([bitmap.width, bitmap.height]); bitmap.close();
          hashes.push([...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map((n) => n.toString(16).padStart(2, '0')).join(''));
        }
        const motion = await loadGridMotion(visualUrl(officer.visual.motion)), img = await createImageBitmap(await (await fetch(visualUrl(officer.visual.motion))).blob());
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
        const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0); img.close();
        const pixels = ctx.getImageData(0, 0, 512, 512).data, cells = Array.from({ length: 16 }, () => ({ visible: 0, clear: 0 }));
        for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
          const cell = cells[Math.floor(y / 128) * 4 + Math.floor(x / 128)], alpha = pixels[(y * 512 + x) * 4 + 3];
          if (alpha > 127) cell.visible++; else if (alpha === 0) cell.clear++;
        }
        out.push({ key, sizes, hashes, cells, march: motion.march.meta.frames.length, strike: motion.duel.meta.frames.includes('strike') });
        motion.march.tex.dispose(); motion.duel.tex.dispose(); motion.duel.turn.tex.dispose();
      }
      return out;
    });
    assert.equal(new Set(results.map((item) => item.hashes[0])).size, 8, '人物立绘不得复用');
    assert.equal(new Set(results.map((item) => item.hashes[5])).size, 8, '人物动作不得复用');
    for (const item of results) {
      assert.deepEqual(item.sizes, [[768, 1152], ...Array.from({ length: 4 }, () => [384, 512]), [512, 512]], item.key);
      assert.equal(new Set(item.hashes.slice(1, 5)).size, 4, `${item.key} 的表情应各不相同`);
      assert.ok(item.cells.every((cell) => cell.visible > 100 && cell.clear > 100), `${item.key} 的动作格无内容或无透明背景`);
      assert.equal(item.march, 15); assert.equal(item.strike, true);
    }
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('七种技能分镜能播放首尾不同画面，失败时停在尝试阶段', async () => {
  const page = await game.open('&flat', { setup });
  try {
    const scenes = await page.evaluate(async () => {
      const { sceneFrame, storyAt } = await import('./src/vignette.js');
      const index = await (await fetch('assets/ai/vignettes/index.json')).json(), out = [];
      for (const key of ['tianyu', 'huangzu', 'xunyou', 'qianzhao', 'huangshi', 'qiaorui', 'zhurong']) {
        const scene = `skill-${key}`, entry = index[scene], canvas = document.createElement('canvas');
        if (!entry || !await sceneFrame(scene, 0, canvas)) throw Error(`${scene} 未加载`);
        const first = canvas.toDataURL(); await sceneFrame(scene, 3, canvas);
        out.push({ key, different: first !== canvas.toDataURL(), attempt: storyAt(entry.story, 3, 3, 'attempt').frame, end: storyAt(entry.story, 3, 3).frame });
      }
      return out;
    });
    for (const scene of scenes) { assert.equal(scene.different, true, scene.key); assert.ok(scene.attempt <= 3); assert.equal(scene.end, 8); }
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

for (const [mode, label] of [['&flat', '平面'], ['', '3D']]) test(`专属计略在${label}战场播放各自动画和战场特效`, { timeout: 180000 }, async () => {
  const page = await game.open(mode, { setup });
  try {
    await page.evaluate(async () => { (await import('./src/pace.js')).setPace(4); (await import('./src/vignette.js')).setVignettes(false); });
    await newCampaign(page, '公孙瓒');
    // 验证旧存档仍保留旧版计策演出；新版名单另有行为测试。
    await page.evaluate(() => { window.__game.g.famousSkills = true; });
    await page.evaluate(() => {
      const { g, debug } = window.__game, from = 0, to = 1;
      const ids = g.cities[from].officers.slice(0, 3);
      for (const id of [...ids, ...g.cities[to].officers]) g.officers[id].soldiers ||= 500;
      debug.fieldWar(debug.setupWar(g, { from, to, ids, commander: ids[0], gold: 100, rice: 400 }), 'att');
    });
    await page.waitForFunction(() => window.__game.war?.finishDeploy && document.body.dataset.screen === 'war', null, { timeout: 60000 });
    const stop = closeMessages(page);
    try {
      await page.evaluate(() => window.__game.war.finishDeploy());
      await page.waitForFunction(() => { const w = window.__game.war; return w.field.turn === w.field.human && !document.querySelector('.banner,.panel.msg'); }, null, { timeout: 60000 });
      const played = await page.evaluate(async () => {
        (await import('./src/vignette.js')).setVignettes(true);
        const { STRATS } = await import('./src/core/field.js'), w = window.__game.war, f = w.field;
        const me = f.alive.find((u) => u.side === f.human), foe = f.alive.find((u) => u.side !== f.human), out = [];
        const audio = window.__game.audio, oldSfx = audio.sfx, sounds = []; audio.sfx = (key) => sounds.push(key);
        for (const [i, skill] of STRATS.filter((item) => item.visualEffect).entries()) {
          sounds.length = 0;
          let scene = null; const from = w.flatState().fx.length;
          const watch = setInterval(() => { scene ||= document.querySelector('.vig')?.dataset.scene ?? null; }, 10);
          try { await w.playStrategy(i % 2 ? foe : me, i % 2 ? me : foe, skill.id, { ok: true, hit: true, name: skill.name, lines: ['奏效'], hits: [] }); }
          finally { clearInterval(watch); }
          out.push({ key: skill.visualEffect, scene, fx: w.flatState().fx.slice(from).map(({ kind, color }) => ({ kind, color })), sound: sounds.filter((key) => key !== 'sfx-horn') });
        }
        audio.sfx = oldSfx;
        return out;
      });
      assert.equal(played.length, 5);
      for (const item of played) {
        assert.deepEqual(item.sound, [{ tianyu: 'sfx-tactic-xbow', huangzu: 'sfx-strategy-water', xunyou: 'sfx-tactic-bind', qianzhao: 'sfx-clash', huangshi: 'sfx-strategy-lure' }[item.key]], item.key);
        assert.equal(item.scene, `skill-${item.key}`);
        assert.ok(item.fx.length, `${item.key} 未播放战场效果`);
      }
      assert.equal(new Set(played.map((item) => item.fx[0].color)).size, 5, '计略特效应有可区分的主色');
      // 较早加入的专属计策没有独立素材，仍应按含义播放相符的画面和音效；
      // 管理员新增计策也要根据效果类型安全回退，而不是全部播放火计。
      const fallback = await page.evaluate(async () => {
        const { STRATS } = await import('./src/core/field.js'), w = window.__game.war, f = w.field;
        const me = f.alive.find((u) => u.side === f.human), foe = f.alive.find((u) => u.side !== f.human);
        const audio = window.__game.audio, oldSfx = audio.sfx, sounds = [], out = [];
        const length = STRATS.length;
        for (const skill of [
          { name: '新制扰阵', stop: 1 }, { name: '新制火攻', soldiers: 40 },
          { name: '新制伤将', hp: 2 }, { name: '__proto__', soldiers: 40 },
        ]) STRATS.push({ ...skill, id: STRATS.length, custom: true });
        audio.sfx = (key) => sounds.push(key);
        try {
          for (const skill of STRATS.filter((item) => item.custom && !item.visualEffect)) {
            sounds.length = 0;
            let scene = null;
            const watch = setInterval(() => { scene ||= document.querySelector('.vig')?.dataset.scene ?? null; }, 10);
            try { await w.playStrategy(me, foe, skill.id, { ok: true, hit: true, name: skill.name, lines: ['奏效'], hits: [] }); }
            finally { clearInterval(watch); }
            out.push({ name: skill.name, scene, sound: sounds.filter((key) => key !== 'sfx-horn') });
          }
          sounds.length = 0;
          const skill = STRATS.find((item) => item.name === '八阵奇谋');
          await w.playStrategy(me, foe, skill.id, { ok: true, hit: false, name: skill.name, lines: ['失败'], hits: [] });
          return { out, failed: sounds.filter((key) => key !== 'sfx-horn') };
        } finally { STRATS.length = length; audio.sfx = oldSfx; }
      });
      const expected = {
        '八阵奇谋': ['st-magic', 'sfx-tactic-bind'], '赤壁烈谋': ['st-firestorm', 'sfx-tactic-fire'],
        '公台断谋': ['st-ambush', 'sfx-clash'], '胡笳扰阵': ['st-ruse', 'sfx-tactic-bind'],
        '冀城九策': ['st-bow', 'sfx-tactic-xbow'], '奉孝奇谋': ['st-ambush', 'sfx-clash'],
        '鹰视潜谋': ['st-magic', 'sfx-tactic-bind'], '宪英明鉴': ['st-ruse', 'sfx-tactic-bind'],
        '白马掩袭': ['st-ambush', 'sfx-clash'], '淮南筹粮': ['st-ambush', 'sfx-clash'],
        '荆襄固阵': ['st-chain', 'sfx-tactic-bind'], '长史守谋': ['st-magic', 'sfx-tactic-bind'],
        '阎象明策': ['st-ruse', 'sfx-tactic-bind'], '异度定荆': ['st-ruse', 'sfx-tactic-bind'],
        '新制扰阵': ['st-ruse', 'sfx-tactic-bind'], '新制火攻': ['st-fire', 'sfx-tactic-fire'],
        '新制伤将': ['st-trap', 'sfx-clash'], ['__proto__']: ['st-ambush', 'sfx-clash'],
      };
      assert.equal(fallback.out.length, Object.keys(expected).length);
      for (const item of fallback.out) {
        const [scene, sound] = expected[item.name];
        assert.equal(item.scene, scene, item.name); assert.deepEqual(item.sound, [sound], item.name);
      }
      assert.deepEqual(fallback.failed, [], '失败的计策不播放命中特效音');
    } finally { stop(); }
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

for (const [id, name, scene, phone] of [[255, '淮军奋击', 'skill-qiaorui', false], [261, '南中飞刀', 'skill-zhurong', true], [264, '宛城突袭', 'skill-zhangxiu', true]]) {
  test(`${name}在${phone ? '手机' : '桌面'}单挑中播放专属演出，仍然只能使用一次`, { timeout: 120000 }, async () => {
    const page = await game.open(phone ? '&phone' : '', { setup });
    try {
      if (phone) await page.setViewportSize({ width: 812, height: 375 });
      await page.evaluate(async () => { (await import('./src/pace.js')).setPace(4); (await import('./src/vignette.js')).setVignettes(true); });
      await page.evaluate((officer) => { window.__game.debug.quickTactical(officer, 38, 2); }, id);
      await page.waitForSelector('.tq-form', { timeout: 60000 });
      await page.evaluate((officer) => {
        if (officer === 255) delete window.__game.g.famousSkills;
        else if (officer === 261) window.__game.g.famousSkills = true;
      }, id); // 旧存档继续使用乔蕤、祝融夫人的演出
      await page.locator('.tq-form').first().click(); await page.locator('.tq-deploy:not(.arming)').click();
      await page.waitForSelector('.tq-start button', { timeout: 30000 });
      await page.evaluate(() => { const b = window.__tq; b.startDuel('a'); b.duel.side.a.hp = b.duel.side.d.hp = 100; b.duel.side.a.F = 10; b.duel.side.a.eq.atk = 0; b.duel.aiCommand = () => 'feint'; });
      await page.locator('.tq-start button:not(.arming)').click();
      const move = page.locator('.tq-duel-acts .tq-special', { hasText: name });
      await move.waitFor({ timeout: 30000 });
      if (phone) {
        const box = await move.boundingBox();
        assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 812 && box.y + box.height <= 375 && box.width >= 70, '手机技能按钮须完整可触及');
      }
      await move.click();
      await page.locator(`.vig[data-scene="${scene}"]`).waitFor({ timeout: 30000 });
      await page.waitForFunction(() => window.__tq.duel?.specialUsed.a === true, null, { timeout: 30000 });
      await move.waitFor({ timeout: 30000 }); assert.equal(await move.isDisabled(), true);
      assert.deepEqual(page.errors, []);
    } finally { await page.context().close(); }
  });
}
