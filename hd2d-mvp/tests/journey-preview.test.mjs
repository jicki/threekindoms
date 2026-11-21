import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, skipIntro, resumeCampaign, cmd } from './game.mjs';

let game;
before(async () => { game = await startGame({ scenario: 'builtin-sovereigns-expanded-map', width: 844, height: 390, touch: true }); });
after(() => game?.close());

async function openRecord(page, player, home) {
  await page.evaluate(({ player, home }) => {
    const { G } = window.__game, g = G.newGame(player, 1, 7);
    g.current = player;
    g.turnIdx = G.data().rules.turn_orders[g.order].indexOf(player);
    g.books = G.books(g, player);
    if (home != null) {
      const faction = g.factions[player], from = g.cities[faction.city];
      from.officers = from.officers.filter(id => id !== faction.ruler);
      g.cities[home].officers.unshift(faction.ruler);
      faction.city = home;
    }
    G.save(g, 1);
    sessionStorage.setItem('hd2d-title-seen', '1');
  }, { player, home });
  await page.reload({ waitUntil: 'commit' });
  await page.waitForFunction(() => window.__game?.debug, null, { timeout: 60000 });
  await resumeCampaign(page);
  await page.waitForFunction(() => !document.querySelector('#fade.on, .banner'));
}

test('出阵地图与洛阳实战外门一致，援军信息随侦察开放，取消不消耗命令书', { timeout: 90000 }, async () => {
  const page = await game.open('&phone&flat');
  try {
    await openRecord(page, 2, 14);
    const before = await page.evaluate(() => {
      const { g } = window.__game;
      g.factions[0].alliance[1] = g.factions[1].alliance[0] = 4;
      for (const id of g.cities[4].officers) Object.assign(g.officers[id], { hp: 60, soldiers: 600 });
      g.cities[4].rice = 400;
      return { books: g.books, officers: [...g.cities[14].officers] };
    });
    const selectLuoyang = async () => {
      await cmd(page, '军', '出阵');
      await page.locator('.mappick').getByRole('button', { name: /洛阳/ }).tap();
    };
    await selectLuoyang();
    const panel = page.getByRole('region', { name: '出阵预览' });
    assert.match(await panel.innerText(), /洛阳.*外门.*内门/s);
    assert.match(await panel.innerText(), /尚未侦察目标/);
    assert.doesNotMatch(await panel.innerText(), /守军 \d|冀州|援军 \d/);
    await panel.getByRole('button', { name: '查看战场布阵' }).tap();
    assert.match(await panel.innerText(), /土黄色主道.*浅灰色侧道.*前哨/s);
    const canvas = panel.getByRole('img');
    const scheme = await canvas.evaluate(async el => {
      const { g, G } = window.__game;
      const { resolveBattlefield } = await import('./src/core/battlefields.js');
      const { siege } = resolveBattlefield(G.data(), g, 12, 14);
      const ctx = el.getContext('2d');
      return {
        doors: siege.gates.map(({ x, y }) => [...ctx.getImageData(x * 8 + 4, y * 8 + 4, 1, 1).data]),
        size: [el.width, el.height],
        fits: el.getBoundingClientRect().right <= innerWidth,
      };
    });
    assert.ok(scheme.fits);
    assert.deepEqual(scheme.size, [320, 216]);
    assert.ok(scheme.doors.length > 0 && scheme.doors.every(rgb => rgb.join() === '255,227,137,255'));
    await page.keyboard.press('Escape');
    await panel.waitFor({ state: 'hidden' });
    await page.evaluate(async () => {
      const { g } = window.__game, { scoutCityIntel } = await import('./src/core/strategy-intel.js');
      scoutCityIntel(g, g.cities[12]);
    });
    await selectLuoyang();
    assert.match(await panel.innerText(), /守军 \d+ 将.*邻城的出援情况未知/s);
    assert.doesNotMatch(await panel.innerText(), /冀州/);
    await page.keyboard.press('Escape');
    await panel.waitFor({ state: 'hidden' });
    await page.evaluate(async () => {
      const { g } = window.__game, { scoutCityIntel } = await import('./src/core/strategy-intel.js');
      scoutCityIntel(g, g.cities[4]);
    });
    await selectLuoyang();
    assert.match(await panel.innerText(), /已知可能援军 冀州（袁绍，[12]将）/);
    await page.locator('.modal .otable tbody tr').first().click();
    await page.getByRole('button', { name: '确定', exact: true }).click();
    await page.getByRole('dialog', { name: '携带军资' }).getByRole('button', { name: '取消' }).click();
    assert.deepEqual(await page.evaluate(() => {
      const { g } = window.__game;
      return { books: g.books, officers: g.cities[14].officers };
    }), before);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('手机人物志用当前武器播放弓扇动作并能换向，退出预览回到人物卡', { timeout: 90000 }, async () => {
  const page = await game.open('&phone&flat');
  try {
    await page.setViewportSize({ width: 568, height: 320 });
    await openRecord(page, 4);
    const id = await page.evaluate(() => { const { g } = window.__game; return g.factions[g.player].ruler; });
    const row = page.locator(`.wikitable tbody tr[data-id="${id}"]`);
    const setWeapon = (eq) => page.evaluate(eq => {
      const { g, G } = window.__game, id = g.factions[g.player].ruler;
      G.wearEquip(g, id, eq);
    }, eq);
    await setWeapon(32);
    await page.getByRole('button', { name: '人物志' }).click();
    await row.click();
    const card = page.getByRole('dialog', { name: '刘备', exact: true });
    const preview = page.getByRole('dialog', { name: '刘备 · 动作预览', exact: true });
    const play = preview.getByRole('button', { name: '播放动作' });
    const switchTo = async (name) => {
      await preview.getByRole('button', { name, exact: true }).click();
      await preview.getByRole('img', { name: new RegExp(name) }).waitFor();
      await page.waitForFunction(() => !document.querySelector('.motion-preview .btn.primary')?.disabled);
    };
    await card.getByRole('button', { name: '动作预览' }).click();
    await page.waitForFunction(() => !document.querySelector('.motion-preview .btn.primary')?.disabled);
    await preview.getByRole('img', { name: '行军动作，朝右' }).waitFor();
    const bounds = () => preview.getByRole('img').evaluate(el => {
      const ctx = el.getContext('2d'), { width, height } = el, pixels = ctx.getImageData(0, 0, width, height).data;
      let floor = 0, left = width, right = 0;
      for (let y = 0; y < 147; y++) for (let x = 0; x < width; x++) if (pixels[(y * width + x) * 4 + 3] > 128) {
        left = Math.min(left, x); right = Math.max(right, x); floor = y;
      }
      return { left, right, floor, fits: el.getBoundingClientRect().right <= innerWidth };
    });
    await switchTo('白兵');
    const right = await bounds();
    await preview.getByRole('button', { name: /换向/ }).tap();
    const left = await bounds();
    assert.ok(right.fits && left.fits && left.floor > 100 && left.floor === right.floor);
    assert.ok(Math.abs(right.left + left.right - 339) <= 2 && Math.abs(right.right + left.left - 339) <= 2);
    const observeFrames = () => page.evaluate(() => {
      const ctx = document.querySelector('.motion-preview canvas').getContext('2d'), draw = ctx.drawImage, stroke = ctx.stroke;
      window.__previewFrames = new Set();
      window.__previewStrokes = 0;
      ctx.drawImage = function (image, x, y, ...args) { window.__previewFrames.add([x, y].join()); return draw.call(this, image, x, y, ...args); };
      ctx.stroke = function (...args) { window.__previewStrokes++; return stroke.apply(this, args); };
    });
    const assertAnimation = async () => {
      await observeFrames(); await play.click();
      await page.waitForFunction(() => window.__previewFrames.size >= 3 && window.__previewStrokes > 0);
    };
    assert.match(await preview.innerText(), /武器 .*弓/);
    await assertAnimation();
    await preview.getByRole('button', { name: '关闭' }).click();
    await card.getByRole('button', { name: '关闭' }).click();
    await setWeapon(34);
    await row.click();
    await card.getByRole('button', { name: '动作预览' }).click();
    await switchTo('单挑');
    assert.match(await preview.innerText(), /武器 .*扇/);
    await assertAnimation();
    await page.keyboard.press('Escape');
    assert.ok(await card.isVisible());
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('新征程文案与君主列传、原版各自的统一目标一致', { timeout: 90000 }, async () => {
  for (const [scenario, label, count] of [['builtin-sovereigns-expanded-map', '34城', 34], ['original', '三十州', 30]]) {
    const page = await game.open('&flat', { setup: ctx => ctx.addInitScript(id => sessionStorage.setItem('haou-hd2d-scenario', id), scenario) });
    try {
      await skipIntro(page); await page.getByText('新的征程').click();
      const ruler = page.locator('.ruler', { hasText: '刘备' });
      await ruler.click(); await ruler.click();
      await page.getByText(`志在一统${label}`, { exact: false }).waitFor();
      assert.equal(await page.evaluate(() => window.__game.G.cityCount()), count);
    } finally { await page.context().close(); }
  }
});
