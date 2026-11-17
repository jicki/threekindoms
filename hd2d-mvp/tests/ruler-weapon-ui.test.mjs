import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, newCampaign, cmd, closeMessages } from './game.mjs';

let game;
before(async () => { game = await startGame({ width: 812, height: 375 }); });
after(() => game?.close());

test('手机购买替换武器前提示专属装备消失，取消不更换，确认后无法再购买', { timeout: 180000 }, async () => {
  const page = await game.open('&flat&phone', { setup: (context) => context.addInitScript(() => sessionStorage.setItem('haou-hd2d-scenario', 'builtin-sovereigns-expanded-map')) });
  try {
    await page.evaluate(async () => { (await import('./src/pace.js')).setPace(4); (await import('./src/vignette.js')).setVignettes(false); });
    await newCampaign(page, '袁绍');
    const before = await page.evaluate(() => {
      const { g, G } = window.__game, id = g.factions[g.player].ruler, city = g.factions[g.player].city;
      g.cities[city].gold = 9999; return { id, city, weapon: g.officers[id].weapon, name: G.data().equipment[g.officers[id].weapon].name };
    });
    const chooseWeapon = async () => {
      await cmd(page, '町', '武器屋');
      await page.locator(`.modal .otable tr[data-id="${before.id}"]`).click();
      const row = page.locator('.modal .shop').first().locator('.shop-row:not(.head):not([disabled])').first();
      await row.waitFor(); await row.click();
      await page.getByText('更换后当前专属武器消失，无法再次获得。', { exact: false }).waitFor();
    };
    await chooseWeapon(); await page.locator('.shade .foot .btn', { hasText: '取消' }).click();
    await page.waitForSelector('.shade', { state: 'detached' });
    assert.equal(await page.evaluate((id) => window.__game.g.officers[id].weapon, before.id), before.weapon);
    await chooseWeapon(); await page.locator('.shade .foot .btn.primary', { hasText: '确定' }).click();
    await page.waitForFunction(({ id, weapon }) => window.__game.g.officers[id].weapon !== weapon, before, { timeout: 15000 });
    const after = await page.evaluate(({ id, weapon, city }) => ({ current: window.__game.g.officers[id].weapon,
      available: window.__game.G.data().cities[city].shop.includes(weapon), block: window.__game.G.equipBlock(window.__game.g, id, weapon) }), before);
    assert.notEqual(after.current, before.weapon); assert.equal(after.available, false); assert.match(after.block, /不可购买或转移/);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('手机战场武器店更换专属武器也提示且可取消', { timeout: 180000 }, async () => {
  const page = await game.open('&flat&phone', { setup: (context) => context.addInitScript(() => sessionStorage.setItem('haou-hd2d-scenario', 'builtin-sovereigns-expanded-map')) });
  try {
    await page.evaluate(async () => { (await import('./src/pace.js')).setPace(4); (await import('./src/vignette.js')).setVignettes(false); });
    await newCampaign(page, '公孙瓒');
    const before = await page.evaluate(() => {
      const { g, debug } = window.__game, owner = g.factions[g.player].ruler, foe = g.factions[4].ruler;
      g.officers[owner].soldiers = 800; g.officers[foe].soldiers = 800;
      debug.fieldWar({ city: 15, from: 0, attacker: g.player, defender: 4, day: 1,
        att: { ids: [owner], gold: 2000, rice: 400 }, def: { ids: [foe], gold: 0, rice: 400 } }, 'att');
      return { id: owner, weapon: g.officers[owner].weapon };
    });
    await page.waitForFunction(() => window.__game.war?.finishDeploy && document.body.dataset.screen === 'war');
    const stop = closeMessages(page);
    try {
      await page.locator('.deploybtn .btn', { hasText: '布阵完成' }).click();
      await page.waitForFunction(() => { const f = window.__game.war.field; return f.turn === f.human && !document.querySelector('.banner,.panel.msg'); });
    } finally { stop(); }
    await page.evaluate((id) => {
      const { war } = window.__game, f = war.field, unit = f.alive.find((u) => u.id === id), shop = f.villages.find((v) => v.kind === '武器店');
      const occupied = f.unitAt(shop.x, shop.y);
      if (occupied && occupied !== unit) {
        const free = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [shop.x + dx, shop.y + dy]).find(([x, y]) => f.inside(x, y) && !f.unitAt(x, y));
        [occupied.x, occupied.y] = free;
      }
      [unit.x, unit.y] = [shop.x, shop.y]; war.clickCell(unit.x, unit.y);
    }, before.id);
    await page.locator('.unitacts button, .unitpanel:not(.compare) button', { hasText: '武器店' }).click();
    await page.locator('.modal .shop').first().locator('.shop-row:not(.head):not([disabled])').first().click();
    await page.getByText('更换后当前专属武器消失，无法再次获得。', { exact: false }).waitFor();
    await page.locator('.shade .foot .btn', { hasText: '取消' }).click();
    assert.equal(await page.evaluate((id) => window.__game.g.officers[id].weapon, before.id), before.weapon);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('记录编辑器只可撤销尚未写回的更换，写回后专属武器无法恢复或转移', { timeout: 120000 }, async () => {
  const page = await game.open('&flat&phone', { setup: (context) => context.addInitScript(() => sessionStorage.setItem('haou-hd2d-scenario', 'builtin-sovereigns-expanded-map')) });
  try {
    const before = await page.evaluate(() => {
      const { G } = window.__game, g = G.newGame(1, 1, 10), id = g.factions[1].ruler;
      G.save(g, 1); return { id, weapon: g.officers[id].weapon };
    });
    await page.goto(new URL('save-editor.html?mute&phone', game.url).href);
    await page.waitForFunction(() => window.__editor?.g);
    assert.equal(await page.getByRole('button', { name: '白马银枪' }).isDisabled(), true);
    await page.getByRole('button', { name: '长剑', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: '更换专属武器' });
    await confirm.getByText('更换后当前专属武器消失，无法再次获得。确定更换？').waitFor();
    await confirm.getByRole('button', { name: '更换', exact: true }).click();
    assert.notEqual(await page.evaluate((id) => window.__editor.g.officers[id].weapon, before.id), before.weapon);
    await page.getByRole('button', { name: '还原此人' }).click();
    assert.equal(await page.evaluate((id) => window.__editor.g.officers[id].weapon, before.id), before.weapon);
    await page.getByRole('button', { name: '长剑', exact: true }).click();
    await confirm.getByRole('button', { name: '更换', exact: true }).click();
    const replacement = await page.evaluate((id) => window.__editor.g.officers[id].weapon, before.id);
    await page.click('#write'); await page.locator('.modal button', { hasText: '写回' }).click();
    await page.waitForFunction(() => document.querySelector('#write').disabled);
    await page.getByRole('button', { name: '还原此人' }).click();
    assert.equal(await page.evaluate((id) => window.__editor.g.officers[id].weapon, before.id), replacement);
    assert.equal(await page.getByRole('button', { name: '河北名剑' }).isDisabled(), true);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});
