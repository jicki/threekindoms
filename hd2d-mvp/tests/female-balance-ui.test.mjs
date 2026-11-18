import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, newCampaign } from './game.mjs';

let game;
before(async () => { game = await startGame(); });
after(() => game?.close());

test('君主列传人物志显示女将新属性、体力上限及原有专属技能', { timeout: 120000 }, async () => {
  const page = await game.open('&flat', { setup: (context) => context.addInitScript(() => localStorage.setItem('hd2d-talent', 'all')) });
  try {
    await newCampaign(page);
    await page.keyboard.press('r');
    const id = await page.evaluate(() => window.__game.G.data().officers.find((o) => o.name === '孙尚香').id);
    await page.locator(`tr[data-id="${id}"]`).click();
    const info = page.locator('.ocard-info'); await info.waitFor();
    const meters = await info.locator('.meter').evaluateAll((items) => Object.fromEntries(items.map((item) => [item.querySelector('span').textContent, item.querySelector('b').textContent])));
    assert.deepEqual([meters['体力'], meters['武力'], meters['智力'], meters['人德']], ['88/88', '89', '76', '80']);
    assert.match(await info.textContent(), /弓腰迅击/);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});
