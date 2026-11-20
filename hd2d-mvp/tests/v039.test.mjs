import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { cityIntel, invalidateCityIntel, scoutCityIntel } from '../src/core/strategy-intel.js';
import { startGame, newCampaign, cmd, tapFakePad, saveCampaign } from './game.mjs';

const scenario = 'builtin-sovereigns-expanded-map';
let game;
before(async () => { game = await startGame({ scenario, width: 1350, height: 840 }); });
after(() => game?.close());

function fakePad(ctx) {
  return ctx.addInitScript(() => {
    const pad = { id: 'Xbox Wireless Controller', index: 0, mapping: 'standard', connected: true, timestamp: 0,
      axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad, null, null, null] });
    window.__fakePad = { set(i, on) { pad.buttons[i] = { pressed: on, touched: on, value: on ? 1 : 0 }; pad.timestamp = performance.now(); } };
  });
}

test('新版侦察跨年有效三个月，超过期限或易主后重新侦察，旧档沿用原记录', () => {
  const city = { id: 0, faction: 2 };
  const g = { campaignRevision: 7, player: 0, year: 189, month: 11, cities: [city] };
  assert.equal(cityIntel(g, city, 255), false);
  scoutCityIntel(g, city);
  Object.assign(g, { year: 190, month: 2 });
  assert.equal(cityIntel(g, city, 255), true);
  g.month++;
  assert.equal(cityIntel(g, city, 255), false);
  g.month--;
  city.faction = 3;
  assert.equal(cityIntel(g, city, 255), false);
  assert.equal(cityIntel({ ...g, campaignRevision: 6 }, city, 255), true);
  invalidateCityIntel(g); city.faction = 2;
  assert.equal(cityIntel(g, city, 255), false);
});

for (const [mode, query] of [['3d', ''], ['flat', '&phone&flat']]) {
  test(`${mode} 大地图己方城名在选城时保留势力色，旧城签保持原配色`, async () => {
    const page = await game.open(query);
    try {
      if (mode === 'flat') await page.setViewportSize({ width: 844, height: 390 });
      await newCampaign(page, '刘备');
      await page.waitForFunction(() => {
        const { g, strategy } = window.__game;
        return strategy.tagOf(g.factions[g.player].city)?.isConnected;
      });
      const colors = await page.evaluate(() => {
        const { g, strategy } = window.__game;
        const id = g.factions[g.player].city, tag = strategy.tagOf(id);
        const probe = document.createElement('span');
        document.body.append(probe);
        const base = tag.style.getPropertyValue('--c');
        const read = el => getComputedStyle(el).color;
        probe.style.color = `color-mix(in srgb, ${base} 67%, #fff5d4)`;
        const expected = read(probe), regular = read(tag);
        strategy.pickMode([id]);
        strategy.highlight(id);
        const candidate = read(tag), highlighted = tag.classList.contains('cand') && tag.classList.contains('hl');
        strategy.highlight(null);
        strategy.pickMode(null);
        strategy.refresh({ ...g, campaignRevision: 6 });
        probe.style.color = '#fff3d6';
        const result = { kind: strategy.kind, expected, regular, candidate, highlighted,
          legacy: read(tag), legacyWhite: read(probe), mine: tag.classList.contains('mine') };
        probe.remove();
        strategy.refresh(g);
        return result;
      });
      assert.equal(colors.kind, mode);
      assert.equal(colors.mine, true);
      assert.equal(colors.highlighted, true);
      assert.equal(colors.regular, colors.expected);
      assert.equal(colors.candidate, colors.expected);
      assert.equal(colors.legacy, colors.legacyWhite);
      assert.deepEqual(page.errors, []);
    } finally { await page.context().close(); }
  });
}

test('新版地图遮蔽敌方兵力，鼠标、键盘和手柄均可进入侦察', async () => {
  const page = await game.open('&flat', { setup: fakePad });
  try {
    await page.evaluate(async () => {
      (await import('./src/pace.js')).setPace(4);
      (await import('./src/vignette.js')).setVignettes(false);
    });
    await newCampaign(page);
    const foe = await page.evaluate(() => {
      const { g, G } = window.__game;
      const c = g.cities.find((city) => city.faction !== g.player && city.faction !== G.NONE && city.officers.length);
      return { id: c.id, name: G.cityName(c.id) };
    });
    const tag = () => page.locator('.ctag.compact-city', { hasText: foe.name });
    await tag().waitFor({ state: 'attached' });
    assert.equal(await tag().textContent(), foe.name);
    assert.match(await tag().getAttribute('aria-label'), /未侦察/);
    await page.evaluate((id) => window.__game.strategy.tagOf(id).click(), foe.id);
    assert.match(await page.locator('.citypanel').textContent(), /未侦察/);
    assert.equal(await page.locator('.citypanel .roster .off').count(), 0);
    await page.evaluate(() => { const { g, strategy } = window.__game; strategy.tagOf(g.factions[g.player].city).click(); });
    await cmd(page, '军', '侦察');
    await page.getByRole('dialog', { name: '侦察', exact: true }).getByRole('button', { name: '确定', exact: true }).click();
    const picker = page.getByRole('dialog', { name: '侦察哪座城？' });
    const button = picker.getByRole('button', { name: foe.name, exact: true });
    await picker.getByRole('button', { name: '选择列表' }).waitFor();
    assert.equal(await button.isVisible(), false);
    await page.keyboard.press('Tab');
    assert.equal(await button.isVisible(), true);
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('.mappick')), true);
    await tapFakePad(page, 13);
    assert.equal(await page.evaluate(() => document.body.dataset.input), 'pad');
    assert.match(await picker.locator('.mp-pad-note').textContent(), /方向键选据点/);
    await button.click();
    const seen = page.getByRole('dialog', { name: `侦察：${foe.name}` });
    await seen.locator('[data-k="正规军"] b').waitFor();
    await seen.getByRole('button', { name: '结束侦察' }).click();
    assert.doesNotMatch(await tag().getAttribute('aria-label'), /未侦察/);
    assert.ok(await page.locator('.citypanel [data-k="正规军"]').isVisible());
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('手柄记录快捷键可配置，选目标时保护当前命令，记录编辑可调值及取消', async () => {
  const page = await game.open('&flat', { setup: fakePad });
  try {
    await page.evaluate(async () => {
      (await import('./src/pace.js')).setPace(4);
      (await import('./src/vignette.js')).setVignettes(false);
    });
    await newCampaign(page);
    await page.getByRole('button', { name: '☰ 系统', exact: true }).click();
    await page.getByRole('menuitem', { name: '手柄记录快捷键', exact: true }).click();
    const keys = page.getByRole('dialog', { name: '手柄记录快捷键' });
    await keys.getByLabel('记录进度', { exact: true }).selectOption('lb');
    await keys.getByLabel('快捷存档', { exact: true }).selectOption('lb');
    assert.equal(await keys.getByLabel('记录进度', { exact: true }).inputValue(), '');
    await keys.getByLabel('记录进度', { exact: true }).selectOption('rb');
    await keys.getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.shade, .banner, #fade.on'));
    await tapFakePad(page, 5, 220);
    assert.match(await page.locator('.pad-record-hints').textContent(), /记录.*快存/);
    const slot = page.getByRole('dialog', { name: '记录', exact: true });
    await slot.waitFor();
    await tapFakePad(page, 1, 220);
    await slot.waitFor({ state: 'hidden' });
    await page.evaluate(() => { const { g, strategy } = window.__game; strategy.tagOf(g.factions[g.player].city).click(); });
    await cmd(page, '军', '出阵');
    const picker = page.getByRole('dialog', { name: '进攻哪座城？' });
    await picker.waitFor();
    await tapFakePad(page, 4, 220);
    assert.equal(await page.evaluate(() => !!window.__game.G.loadQuick({ preview: true })), false);
    await picker.getByRole('button', { name: /取消/ }).click();
    await cmd(page, '外交', '离间');
    const diplomacy = page.getByRole('dialog', { name: '离间：选择对象' });
    const faction = diplomacy.locator('.otree .tf').first();
    const summary = faction.locator(':scope > summary');
    await diplomacy.waitFor();
    await summary.focus();
    await tapFakePad(page, 14);
    assert.equal(await faction.getAttribute('open'), null);
    await tapFakePad(page, 15);
    assert.notEqual(await faction.getAttribute('open'), null);
    await tapFakePad(page, 1);
    assert.equal(await faction.getAttribute('open'), null);
    await tapFakePad(page, 1);
    await diplomacy.waitFor({ state: 'hidden' });
    await saveCampaign(page);
    await page.goto(new URL('save-editor.html', page.url()).href);
    await page.waitForFunction(() => !!window.__editor?.g);
    const field = page.getByLabel('武力数值', { exact: true });
    const value = Number(await field.inputValue());
    await field.focus();
    await tapFakePad(page, value === 99 ? 14 : 15);
    assert.equal(Number(await field.inputValue()), value + (value === 99 ? -1 : 1));
    await tapFakePad(page, 1);
    const back = page.getByRole('dialog', { name: '返回游戏' });
    await back.waitFor();
    await tapFakePad(page, 1);
    await back.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.__editor.changes().length), 1);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});
