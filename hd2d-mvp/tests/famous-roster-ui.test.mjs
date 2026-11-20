import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, resumeCampaign, skipIntro, closeMessages } from './game.mjs';

let game;
before(async () => { game = await startGame(); });
after(async () => { await game?.close(); });

async function openPlayerTurn(page) {
  await page.evaluate(() => {
    const { G } = window.__game, g = G.newGame(4, 1, 7);
    g.current = g.player;
    g.turnIdx = G.data().rules.turn_orders[g.order].indexOf(g.player);
    g.books = G.books(g, g.player);
    G.save(g, 1);
  });
  // 先等游戏壳就绪，再开始等待标题动画。远程素材可能在导航完成后仍在初始化。
  await page.reload({ waitUntil: 'commit' });
  await page.waitForFunction(() => Boolean(window.__game?.debug), null, { timeout: 60000 });
  await resumeCampaign(page);
}

test('手机可取消或确认战役升级，另存并重新读取后保留新版规则和原记录', async () => {
  const page = await game.open('&flat&phone&fixedseed');
  try {
    await page.setViewportSize({ width: 812, height: 375 });
    const old = await page.evaluate(() => {
      const { G } = window.__game, g = G.newGame(4, 1, 7);
      for (const key of ['campaignRevision', 'famousRoster', 'siegeTactics']) delete g[key];
      g.famousSkills = true;
      g.battlefields = 1;
      g.officers.length = 262;
      g.year = 196; g.month = 6;
      g.current = g.player;
      g.turnIdx = G.data().rules.turn_orders[g.order].indexOf(g.player);
      g.books = G.books(g, g.player);
      g.freeSave = true;
      g.cities[2].gold = 1789;
      if (!G.save(g, 1)) throw new Error('写入旧记录失败');
      return G.slotToken(1);
    });
    await page.reload();
    await resumeCampaign(page);
    await page.waitForFunction(() => document.querySelector('.citypanel') && !document.querySelector('.banner, .shade, #fade.on'));
    const recordMenu = async () => {
      await page.locator('.sysmenu-btn').click();
      await page.getByRole('tab', { name: '记录', exact: true }).click();
    };
    const upgrade = page.getByRole('menuitem', { name: '升级当前战役' });
    const dialog = page.getByRole('dialog', { name: '升级当前战役' });
    await recordMenu();
    await upgrade.click();
    assert.equal(await dialog.count(), 1, await page.locator('body > .toast').allTextContents());
    assert.match(await dialog.textContent(), /新版城防与布阵/);
    await dialog.getByRole('button', { name: '取消' }).click();
    assert.equal(await page.evaluate(() => window.__game.g.famousSkills), true);
    await recordMenu();
    await upgrade.click();
    await dialog.getByRole('button', { name: '确定' }).click();
    await page.getByText(/战役已升级/).waitFor();
    assert.deepEqual(await page.evaluate(() => {
      const { G, g } = window.__game;
      return [g.famousSkills, g.battlefields, g.cities[2].gold, G.name(262), G.slotToken(1)];
    }), [2, 2, 1789, '张昭', old]);

    await recordMenu();
    assert.equal(await upgrade.count(), 0);
    await page.getByRole('menuitem', { name: '记录进度' }).click();
    await page.getByRole('button', { name: /记录二/ }).click();
    await page.waitForFunction(() => window.__game.G.load(2, { preview: true })?.siegeTactics === true);
    await page.reload();
    await skipIntro(page);
    await page.getByRole('button', { name: '读取记录', exact: true }).click();
    await page.getByRole('button', { name: /记录二/ }).click();
    await page.waitForFunction(() => document.body.dataset.screen === 'strategy' && window.__game.g?.slot === 2);
    assert.deepEqual(await page.evaluate(() => {
      const { G, g } = window.__game;
      return [g.slot, g.famousSkills, g.campaignRevision, g.year, g.month, g.cities[2].gold, g.freeSave, G.name(264), G.slotToken(1)];
    }), [2, 2, 11, 196, 6, 1789, true, '张绣', old]);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('三人各自的四种表情、透明动作和技能分镜均可解码且各帧有内容', async () => {
  const page = await game.open('&flat');
  try {
    const summary = await page.evaluate(async () => {
      const { face } = await import('./src/ui.js');
      const { storyAt } = await import('./src/vignette.js');
      const index = await (await fetch('assets/ai/vignettes/index.json')).json(), result = [];
      const data = (img, x, y, w, h) => {
        const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
        return ctx.getImageData(0, 0, w, h).data;
      };
      const bitmap = async (url) => createImageBitmap(await (await fetch(url)).blob());
      const checksum = (bytes) => bytes.reduce((h, b) => Math.imul(h ^ b, 16777619), 2166136261);
      for (const [id, key] of [[262, 'zhangzhao'], [263, 'zhanghong'], [264, 'zhangxiu']]) {
        const moods = [];
        for (const mood of ['calm', 'joy', 'angry', 'grief']) {
          const image = face(id, '', mood);
          await image.decode();
          moods.push({ own: image.src.endsWith(`/characters/${key}/${mood}.webp`), checksum: checksum(data(image, 0, 0, 360, 480)) });
        }
        const motion = await bitmap(`assets/characters/${key}/motion.png`), motionFrames = [];
        for (let i = 0; i < 16; i++) {
          const pixels = data(motion, i % 4 * 128, Math.floor(i / 4) * 128, 128, 128);
          const hasLeftMargin = [0, 127].every(x => Array.from({ length: 128 }, (_, y) => pixels[(y * 128 + x) * 4 + 3]).every(a => a === 0));
          const opaque = pixels.filter((a, n) => n % 4 === 3 && a > 127).length;
          motionFrames.push({ hasLeftMargin, opaque, checksum: checksum(pixels) });
        }
        const { w, h, story } = index['skill-' + key], image = await bitmap('assets/ai/vignettes/' + story.src);
        const storyFrames = Array.from({ length: 9 }, (_, i) => checksum(data(image, i % story.cols * w, Math.floor(i / story.cols) * h, w, h)));
        result.push({
          key, moods, motionFrames, motionSize: [motion.width, motion.height],
          storyFrames, storySize: [image.width, image.height],
          endings: [storyAt(story, 5, 1, 'attempt').frame, storyAt(story, 5, 1).frame],
        });
        image.close(); motion.close();
      }
      return result;
    });
    for (const item of summary) {
      assert.deepEqual(item.motionSize, [512, 512]);
      assert.deepEqual(item.storySize, [1536, 864]);
      assert.deepEqual(item.endings, [2, 8]);
      assert.ok(item.moods.every(mood => mood.own), item.key);
      assert.equal(new Set(item.moods.map(mood => mood.checksum)).size, 4, item.key);
      assert.ok(item.motionFrames.every(frame => frame.hasLeftMargin && frame.opaque > 800 && frame.opaque < 13000), item.key);
      assert.equal(new Set(item.motionFrames.map(frame => frame.checksum)).size, 16, item.key);
      assert.equal(new Set(item.storyFrames).size, 9, item.key);
    }
    assert.equal(new Set(summary.map(item => item.motionFrames[0].checksum)).size, 3);
    assert.equal(new Set(summary.map(item => item.storyFrames[0])).size, 3);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('手机旧战役人物资料仍显示新增名臣及兼有两种技能的周瑜', { timeout: 180000 }, async () => {
  const page = await game.open('&flat&phone', { setup: (context) => context.addInitScript(() => {
    sessionStorage.setItem('haou-hd2d-scenario', 'builtin-sovereigns');
    localStorage.setItem('hd2d-talent', 'all');
  }) });
  try {
    await page.setViewportSize({ width: 812, height: 375 });
    await openPlayerTurn(page);
    await page.evaluate(() => { window.__game.g.campaignRevision = 1; });
    await page.keyboard.press('r');
    const search = page.getByLabel('查找武将');
    const card = page.locator('.ocard-info');
    for (const [id, name, folder, ability] of [
      [262, '张昭', 'zhangzhao', /名臣.*子布辅政.*机动力9.*损兵60.*限制移动1日/],
      [263, '张纮', 'zhanghong', /名臣.*子纲筹略.*机动力9.*损兵70/],
      [264, '张绣', 'zhangxiu', /名将.*宛城突袭.*伤害110%/],
    ]) {
      await search.fill(name);
      await page.locator(`tr[data-id="${id}"]`).click();
      assert.match(await card.textContent(), ability);
      const portrait = page.locator('.shade .ocard > img');
      await portrait.waitFor();
      await page.waitForFunction((img) => img.complete && img.naturalWidth > 0, await portrait.elementHandle());
      assert.match(await portrait.getAttribute('src'), new RegExp(`/characters/${folder}/portrait\\.webp$`));
      await page.keyboard.press('Escape');
    }
    await search.fill('周瑜');
    await page.locator('tr[data-id="93"]').click();
    assert.match(await card.textContent(), /名将名臣/);
    assert.match(await card.textContent(), /赤壁烈谋.*赤壁奋击/);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('张昭、张纮在手机战场播放各自的计策分镜与特效', { timeout: 120000 }, async () => {
  const page = await game.open('&flat&phone');
  try {
    await page.setViewportSize({ width: 812, height: 375 });
    await openPlayerTurn(page);
    await page.evaluate(() => { window.__game.g.campaignRevision = 1; });
    await page.evaluate(async () => {
      (await import('./src/pace.js')).setPace(4);
      (await import('./src/vignette.js')).setVignettes(true);
      const { g, debug } = window.__game;
      const from = 0, to = 1, ids = [262, 263];
      g.cities[from].officers.push(...ids);
      for (const id of ids) Object.assign(g.officers[id], { soldiers: 600, status: 2 });
      for (const id of g.cities[to].officers) g.officers[id].soldiers = 800;
      debug.fieldWar(debug.setupWar(g, { from, to, ids, commander: ids[0], gold: 100, rice: 400 }), 'att');
    });
    const stop = closeMessages(page);
    try {
      await page.waitForFunction(() => window.__game.war?.finishDeploy && document.body.dataset.screen === 'war', null, { timeout: 60000 });
      await page.evaluate(() => window.__game.war.finishDeploy());
      await page.waitForFunction(() => window.__game.war.field.turn === 'att' && !document.querySelector('.panel.msg,.banner'));
      for (const [id, key, color, sfx] of [[262, 'zhangzhao', '#e2aa60', 'sfx-tactic-bind'], [263, 'zhanghong', '#91ccff', 'sfx-strategy-lure']]) {
        const outcome = await page.evaluate(async ({ id, key }) => {
          const { warmVignette } = await import('./src/vignette.js');
          // 直接调用施计演出会跳过选择计策时的预取，先等当前分镜就绪再检查画面。
          if (!(await warmVignette(`skill-${key}`))) throw new Error(`计策分镜无法加载：${key}`);
          const { war, audio } = window.__game, f = war.field;
          const u = f.side('att').find(x => x.id === id), target = f.side('def')[0];
          Object.assign(u, { x: 3, y: 3 });
          Object.assign(target, { x: 4, y: 3 });
          f.pool.att = 100; f.r = () => 0;
          const skill = f.strategies(u).find(s => s.visualEffect === key);
          const res = f.cast(u, skill.id, target);
          const sounds = [], oldSfx = audio.sfx;
          audio.sfx = (name) => sounds.push(name);
          const start = war.flatState().fx.length;
          window.__visitSkill = war.playStrategy(u, target, skill.id, res).then(() => ({
            sounds, colors: war.flatState().fx.slice(start).map(fx => fx.color),
          })).finally(() => { audio.sfx = oldSfx; });
          return res.hit;
        }, { id, key });
        assert.equal(outcome, true);
        const scene = page.locator(`.vig[data-scene="skill-${key}"]`);
        await scene.waitFor();
        const box = await scene.boundingBox();
        assert.ok(box.width > 100 && box.x >= -1 && box.x + box.width <= 813 && box.y >= -1 && box.y + box.height <= 376, JSON.stringify(box));
        await scene.click();
        const effect = await page.evaluate(() => window.__visitSkill);
        assert.ok(effect.colors.includes(color), JSON.stringify(effect));
        assert.ok(effect.sounds.includes(sfx), JSON.stringify(effect));
      }
      assert.deepEqual(page.errors, []);
    } finally { stop(); }
  } finally { await page.context().close(); }
});

test('记录编辑器可切换人物编号重叠的新旧记录', async () => {
  const page = await game.open('&flat');
  try {
    assert.deepEqual(await page.evaluate(() => {
      const { G } = window.__game, current = G.newGame(4, 1, 7);
      const legacy = structuredClone(current), id = 262;
      delete legacy.famousRoster;
      delete legacy.famousSkills;
      legacy.campaignRevision = 9;
      legacy.officers.length = id;
      legacy.clones = [id];
      legacy.officers.push({ ...legacy.officers[0], id, status: G.SERVING });
      for (const record of [current, legacy]) {
        const faction = record.factions[record.player];
        faction.ruler = id;
        record.officers[id].status = G.SERVING;
        record.cities[faction.city].officers.unshift(id);
      }
      return [G.save(current, 1), G.saveQuick(legacy)];
    }), [true, true]);
    await page.goto(new URL('save-editor.html?mute', game.url).href);
    const quick = page.locator('#slots .slotc.quick'), numbered = page.locator('#slots .slotc').nth(1);
    await numbered.waitFor();
    assert.match(await quick.textContent(), /阿会喃/);
    assert.match(await numbered.textContent(), /张昭/);
    assert.match(await numbered.locator('img').getAttribute('src'), /characters\/zhangzhao\/calm\.webp$/);
    assert.doesNotMatch(await quick.locator('img').getAttribute('src'), /zhangzhao/);
    await numbered.click();
    assert.match(await page.locator('.se-who h2').textContent(), /张昭/);
    await quick.click();
    assert.match(await page.locator('.se-who h2').textContent(), /阿会喃/);
    assert.match(await numbered.textContent(), /张昭/);

    const saved = await page.evaluate(async () => {
      const { scenarioKey } = await import('./src/core/game.js');
      return localStorage.getItem(`${scenarioKey('haou-hd2d-save')}:1`);
    });
    await page.locator('#file').setInputFiles({ name: '君主列传.json', mimeType: 'application/json', buffer: Buffer.from(saved) });
    const importDialog = page.getByRole('dialog', { name: '导入到哪个记录槽' });
    assert.match(await importDialog.locator('p').textContent(), /张昭/);
    await importDialog.getByRole('button', { name: '记录二' }).click();
    await page.locator('#slots .slotc.on', { hasText: '记录二' }).waitFor();
    assert.match(await page.locator('.se-who h2').textContent(), /张昭/);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});
