import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, newCampaign } from './game.mjs';

let game;
before(async () => { game = await startGame(); });
after(async () => { await game?.close(); });

test('手机人物资料显示新增名臣及兼有两种技能的周瑜', { timeout: 180000 }, async () => {
  const page = await game.open('&flat&phone', { setup: (context) => context.addInitScript(() => {
    sessionStorage.setItem('haou-hd2d-scenario', 'builtin-sovereigns');
    localStorage.setItem('hd2d-talent', 'all');
  }) });
  try {
    await page.setViewportSize({ width: 812, height: 375 });
    await newCampaign(page, '孙策');
    await page.keyboard.press('r');
    const search = page.getByLabel('查找武将');
    await search.fill('张昭');
    await page.locator('tr[data-id="262"]').click();
    const card = page.locator('.ocard-info');
    assert.match(await card.textContent(), /名臣.*子布辅政.*机动力9.*损兵60.*限制移动1日/);
    const portrait = page.locator('.shade img').first();
    await portrait.waitFor();
    await page.waitForFunction((img) => img.complete && img.naturalWidth > 0, await portrait.elementHandle());
    await page.keyboard.press('Escape');
    await search.fill('周瑜');
    await page.locator('tr[data-id="93"]').click();
    assert.match(await card.textContent(), /名将名臣/);
    assert.match(await card.textContent(), /赤壁烈谋.*赤壁奋击/);
    assert.deepEqual(page.errors, []);
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
