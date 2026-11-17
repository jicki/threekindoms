import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, newCampaign } from './game.mjs';

let game;
before(async () => { game = await startGame({ width: 812, height: 375 }); });
after(() => game?.close());

test('手机地方建言的选项可见、触控并返回正确选择', { timeout: 120000 }, async () => {
  const page = await game.open('&flat&phone', { setup: (ctx) => ctx.addInitScript(() => sessionStorage.setItem('haou-hd2d-scenario', 'builtin-sovereigns-expanded-map')) });
  try {
    await page.evaluate(async () => { (await import('./src/pace.js')).setPace(4); (await import('./src/vignette.js')).setVignettes(false); });
    await newCampaign(page, '公孙瓒');
    await page.evaluate(() => { window.__eventChoice = null; window.__game.io.campaignEvent({ faction: 7, city: 0 }).then((value) => { window.__eventChoice = value; }); });
    const dialog = page.getByRole('dialog', { name: '地方建言' }); await dialog.waitFor();
    const choices = dialog.locator('.campaign-choices .btn');
    assert.equal(await choices.count(), 2);
    for (const button of await choices.all()) {
      const box = await button.boundingBox(); assert.ok(box && box.x >= 0 && box.x + box.width <= 812 && box.height >= 32);
      assert.equal(await button.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true);
    }
    await choices.nth(1).click();
    await page.waitForFunction(() => window.__eventChoice === 'rice');
    await page.evaluate(() => {
      const { g } = window.__game, city = g.cities.find((c) => c.faction === g.player);
      Object.assign(city, { gov: 49, disaster: 49, rice: 0 }); g.officers[city.officers[0]].soldiers = 1000;
    });
    await page.locator('.sysmenu-btn').click(); await page.getByRole('tab', { name: '画面' }).click();
    await page.getByRole('menuitem', { name: '城池与关隘总览' }).click();
    const own = page.locator('.map-overview-list .btn').filter({ hasText: '辽东' });
    assert.match(await own.innerText(), /军粮不足.*统治偏低.*防灾偏低/);
    const enemy = page.locator('.map-overview-list .btn').filter({ hasText: '新野' });
    assert.equal(await enemy.locator('.overview-warning').count(), 0);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});
