import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, resumeCampaign, cmd, closeMessages } from './game.mjs';

let game;
before(async () => { game = await startGame({ scenario: 'builtin-sovereigns-expanded-map', width: 812, height: 375, touch: true }); });
after(() => game?.close());

test('手机襄阳铁铺显示独立图标和购买门槛，成交后人物志和记录编辑器显示当前装备', { timeout: 90000 }, async () => {
  const page = await game.open('&phone&flat');
  try {
    const id = await page.evaluate(() => {
      const { G } = window.__game, record = G.newGame(4, 1, 7), fac = record.factions[4], town = record.cities[30];
      record.current = 4; record.turnIdx = G.data().rules.turn_orders[record.order].indexOf(4);
      record.books = G.books(record, 4); record.year = 220;
      record.cities[fac.city].officers = record.cities[fac.city].officers.filter(id => id !== fac.ruler);
      Object.assign(town, { officers: [fac.ruler, 272], faction: 4, gold: 900 });
      Object.assign(record.officers[fac.ruler], { weapon: 36, war: 77, loc: 30 });
      Object.assign(record.officers[272], { status: G.SERVING, loc: 30 });
      fac.city = 30;
      if (!G.save(record, 1)) throw new Error('当前记录写入失败');
      const old = structuredClone(record);
      old.cities[30].officers.pop(); old.famousRoster = 1; old.campaignRevision = 9; old.officers.length = 265;
      if (!G.save(old, 2)) throw new Error('旧记录写入失败');
      sessionStorage.setItem('hd2d-title-seen', '1');
      return fac.ruler;
    });
    // 两条记录以写入时间排序，先从标题显式选择新档。
    await page.reload({ waitUntil: 'commit' });
    await page.getByRole('button', { name: '读取记录', exact: true }).click();
    await page.getByRole('button', { name: /^记录一/ }).click();
    await page.waitForFunction(() => window.__game?.g?.current === 4 && !document.querySelector('#fade.on, .banner') && document.querySelector('.dock'));
    await page.evaluate(async () => (await import('./src/vignette.js')).setVignettes(false));
    const shop = page.getByRole('dialog', { name: '武器屋' });
    const bow = shop.getByRole('button', { name: /江潮弓/ });
    const visitShop = async () => {
      await cmd(page, '町', '武器屋');
      await page.locator(`.modal .otable tr[data-id="${id}"]`).tap();
    };
    await visitShop();
    assert.ok(await bow.isDisabled());
    assert.match(await bow.innerText(), /需武力78/);
    const icons = await shop.locator('.shop-row img[src*="assets/regional"]').evaluateAll(async images => {
      await Promise.all(images.map(image => image.decode()));
      return images.map(image => [image.getAttribute('src'), image.naturalWidth]);
    });
    assert.equal(icons.length, 3);
    assert.equal(new Set(icons.map(([src]) => src)).size, 3);
    assert.ok(icons.every(([, width]) => width === 80));
    await shop.getByRole('button', { name: '取消' }).tap();
    await page.waitForFunction(() => !document.querySelector('.modal'));
    await page.evaluate(id => { window.__game.g.officers[id].war = 78; }, id);
    await visitShop();
    const done = closeMessages(page);
    try {
      await bow.tap();
      await shop.getByRole('button', { name: '确定', exact: true }).tap();
      await page.waitForFunction(id => window.__game.g.officers[id].weapon === 65 && !document.querySelector('.panel.msg'), id);
    } finally { done(); }
    await page.getByRole('button', { name: '人物志', exact: true }).click();
    await page.locator('.wikitable tr[data-id="272"]').tap();
    const chen = page.getByRole('dialog', { name: '陈登', exact: true });
    assert.match(await chen.innerText(), /徐州·名臣.*广陵屯田/s);
    assert.ok(await chen.locator('img[src*="regional/chendeng.webp"]').first().evaluate(async image => { await image.decode(); return image.naturalWidth === 216; }));
    await page.evaluate(() => { const { G, g } = window.__game; if (!G.save(g, 1)) throw new Error('成交记录保存失败'); });
    await page.goto(new URL('save-editor.html', game.url).href, { waitUntil: 'commit' });
    const slots = page.locator('#slots .slotc');
    await slots.filter({ hasText: '记录一' }).click();
    const inventory = page.locator('.se-gear');
    const current = inventory.getByRole('button', { name: '江潮弓', exact: true });
    await current.waitFor();
    assert.match(await current.getAttribute('title'), /建业、襄阳/);
    assert.equal(await inventory.locator('img[src*="assets/regional"]').count(), 9);
    const panelFits = await inventory.evaluate(el => el.scrollWidth <= el.clientWidth + 1);
    assert.ok(panelFits);
    await slots.filter({ hasText: '记录二' }).click();
    await current.waitFor({ state: 'detached' });
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('手机版人物志可按本名查新武将并显示独立立绘、兵种、被动与史事', { timeout: 90000 }, async () => {
  const page = await game.open('&phone&flat');
  try {
    await page.evaluate(() => {
      const { G } = window.__game, record = G.newGame(4, 1, 7), city = record.cities[record.factions[4].city];
      record.current = 4; record.turnIdx = G.data().rules.turn_orders[record.order].indexOf(4);
      record.books = G.books(record, 4);
      for (const id of [273, 281, 282, 283]) {
        city.officers.push(id);
        Object.assign(record.officers[id], { status: G.SERVING, loc: city.id, soldiers: 300 });
      }
      if (!G.save(record, 1)) throw new Error('当前记录写入失败');
      sessionStorage.setItem('hd2d-title-seen', '1');
    });
    await page.reload({ waitUntil: 'commit' });
    await resumeCampaign(page);
    await page.getByRole('button', { name: '人物志', exact: true }).tap();
    const listing = page.getByRole('dialog', { name: '人物志', exact: true });
    for (const [query, name, id, key, content] of [
      ['长文', '陈群', 273, 'chenqun', /普通步兵[\s\S]*九品举才[\s\S]*父子 陈泰/],
      ['霍峻', '霍峻', 281, 'huojun', /普通盾兵[\s\S]*重甲重盾兵[\s\S]*葭萌坚守/],
      ['陆抗', '陆抗', 282, 'lukang', /普通枪兵[\s\S]*重甲枪兵[\s\S]*西陵持重[\s\S]*父子 陆逊/],
      ['文俶', '文鸯', 283, 'wenyang', /本名文俶[\s\S]*普通轻骑[\s\S]*乐嘉突阵/],
    ]) {
      await listing.getByRole('searchbox', { name: '查找武将' }).fill(query);
      await listing.locator(`.wikitable tr[data-id="${id}"]`).tap();
      const detail = page.getByRole('dialog', { name, exact: true });
      assert.match(await detail.innerText(), content);
      const portrait = detail.locator(`img[src$="/regional/${key}.webp"]`).first();
      assert.ok(await portrait.evaluate(async image => { await image.decode(); return image.naturalWidth === 216 && image.naturalHeight === 216; }));
      assert.ok(await detail.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      await detail.getByRole('button', { name: '关闭', exact: true }).tap();
    }
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('原版出阵记录与编辑器防具和武器保持原货架', { timeout: 90000 }, async () => {
  const page = await game.open('&phone&flat', { setup: ctx => ctx.addInitScript(() => sessionStorage.setItem('haou-hd2d-scenario', 'original')) });
  try {
    await page.evaluate(() => {
      const { G } = window.__game, state = G.newGame(4, 1, 7);
      state.current = 4; state.turnIdx = G.data().rules.turn_orders[state.order].indexOf(4); state.books = G.books(state, 4);
      G.save(state, 1); sessionStorage.setItem('hd2d-title-seen', '1');
    });
    await page.reload({ waitUntil: 'commit' });
    await resumeCampaign(page);
    await page.goto(new URL('save-editor.html', game.url).href, { waitUntil: 'commit' });
    const inventory = page.locator('.se-gear');
    await inventory.waitFor();
    assert.equal(await inventory.locator('button.eq').count(), 32);
    assert.equal(await inventory.locator('img[src*="assets/regional"]').count(), 0);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});
