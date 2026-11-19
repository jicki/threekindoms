import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, newCampaign, resumeCampaign } from './game.mjs';

let game;
before(async () => { game = await startGame(); });
after(() => game?.close());

test('君主列传人物志显示女将新属性，旧档保留原有单挑技', { timeout: 120000 }, async () => {
  const page = await game.open('&flat', { setup: (context) => context.addInitScript(() => localStorage.setItem('hd2d-talent', 'all')) });
  try {
    await newCampaign(page);
    const id = await page.evaluate(() => window.__game.G.data().officers.find((o) => o.name === '孙尚香').id);
    const info = page.locator('.ocard-info');
    const openProfile = async () => {
      await page.keyboard.press('r');
      await page.locator(`tr[data-id="${id}"]`).click();
      await info.waitFor();
      const meters = await info.locator('.meter').evaluateAll((items) => Object.fromEntries(items.map((item) => [item.querySelector('span').textContent, item.querySelector('b').textContent])));
      assert.deepEqual([meters['体力'], meters['武力'], meters['智力'], meters['人德']], ['88/88', '89', '76', '80']);
    };
    assert.equal(await page.evaluate(() => window.__game.g.famousSkills), 2);
    await openProfile();
    assert.doesNotMatch(await info.textContent(), /弓腰迅击/);

    assert.equal(await page.evaluate(() => {
      const { G, g } = window.__game;
      const old = structuredClone(g);
      for (const key of ['campaignRevision', 'famousRoster', 'siegeTactics', 'famousSkills']) delete old[key];
      old.battlefields = 1;
      old.officers.length = 262;
      return G.save(old, 1);
    }), true);
    await page.reload();
    await resumeCampaign(page);
    await openProfile();
    assert.match(await info.textContent(), /弓腰迅击/);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});
