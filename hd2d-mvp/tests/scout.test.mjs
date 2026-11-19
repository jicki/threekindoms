// 侦察 (虚名如浮云@小红书): one 命令书 opens a session in which any number of cities can be inspected.
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, newCampaign, saveCampaign, resumeCampaign, cmd, tapFakePad } from './game.mjs';

let game, page, cities, record;
before(async () => {
  game = await startGame({ width: 1440, height: 900 });
  const seed = await game.open('&fixedseed');
  await seed.evaluate(async () => { (await import('./src/pace.js')).setPace(4); (await import('./src/vignette.js')).setVignettes(false); });
  await newCampaign(seed);
  record = await saveCampaign(seed);
  await seed.context().close();
});
beforeEach(async () => {
  page = await game.open('&fixedseed', { save: record, setup: (ctx) => ctx.addInitScript(() => {
    const pad = { id: 'Xbox Wireless Controller', index: 0, mapping: 'standard', connected: true, timestamp: 0,
      axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad, null, null, null] });
    window.__fakePad = { set(i, on) { pad.buttons[i] = { pressed: on, touched: on, value: on ? 1 : 0 }; pad.timestamp = performance.now(); } };
  }) });
  await page.evaluate(async () => { (await import('./src/pace.js')).setPace(4); (await import('./src/vignette.js')).setVignettes(false); });
  await resumeCampaign(page);
  // 读档先显示战略画面，己方命令栏和主城城签随后才可交互。
  await page.waitForFunction(() => {
    const { g, strategy } = window.__game;
    return !document.querySelector('#fade.on, .banner') && document.querySelector('.dock [data-tab="军"]')
      && strategy.tagOf(g.factions[g.player].city)?.isConnected;
  });
  cities = await page.evaluate(() => {
    const { g, G } = window.__game, home = g.factions[g.player].city;
    const foes = g.cities.filter((c) => c.faction !== g.player && c.faction !== G.NONE && c.officers.length);
    const near = foes.find((c) => G.roads(home).includes(c.id)) ?? foes[0];
    const far = foes.find((c) => c.id !== near.id && !G.roads(home).includes(c.id));
    const empty = g.cities.find((c) => c.faction === G.NONE);
    return Object.fromEntries(Object.entries({ home: g.cities[home], near, far, empty }).map(([key, c]) => [key, c && { id: c.id, name: G.cityName(c.id) }]));
  });
  assert.ok(cities.near && cities.far && cities.empty, JSON.stringify(cities));
});
afterEach(() => page?.context().close());
after(async () => { await game?.close(); });

const books = () => page.evaluate(() => window.__game.g.books);
const info = (city) => page.getByRole('dialog', { name: `侦察：${city.name}`, exact: true });
const picker = () => page.getByRole('dialog', { name: '侦察哪座城？', exact: true });
const choose = async (city) => {
  const list = picker().locator('.map-list-toggle[aria-expanded=false]');
  if (await list.isVisible()) await list.click();
  await picker().getByRole('button', { name: city.name, exact: true }).click(); await info(city).waitFor();
};
const begin = async () => {
  await cmd(page, '军', '侦察');
  // Wait for either the old picker or the intended confirmation so the red test fails on behavior, not timing.
  await page.locator('.mappick, .modal[aria-label="侦察"]').first().waitFor({ timeout: 10000 });
  assert.equal(await page.locator('.modal[aria-label="侦察"]').count(), 1, 'the command is confirmed before a city is chosen');
};

// The ROM charges before selecting a city. Each city can be inspected, including an unconnected enemy, our own city and an empty one.
test('one scout command can inspect several cities and keeps their details', async () => {
  await page.evaluate(() => { window.__game.g.books = 3; });
  await begin();
  assert.match(await page.locator('.modal[aria-label="侦察"] p').first().textContent(), /消耗一张命令书/);
  await page.locator('.modal[aria-label="侦察"] .btn', { hasText: '取消' }).click();
  assert.equal(await books(), 3, 'cancelling before confirmation costs nothing');
  await begin();
  await page.locator('.modal[aria-label="侦察"] .btn.primary').click();
  await picker().waitFor();
  assert.equal(await books(), 2, 'the one book is spent before the first city');
  assert.equal(await page.locator('body > .toast').count(), 0, 'the payment toast does not cover the city picker');

  for (const [i, city] of [cities.near, cities.far, cities.home, cities.empty].entries()) {
    await choose(city);
    assert.equal(await books(), 2, `${city.name} costs no additional book`);
    assert.ok(await info(city).locator('.stats [data-k="金"]').count(), `${city.name} shows its city stats`);
    if (i === 0) {
      const row = info(city).locator('tr[data-id]').first();
      assert.ok(await row.count(), 'the enemy roster is visible');
      await row.click();
      assert.equal(await page.locator('.shade').count(), 2, 'an officer can be inspected without ending the session');
      await page.keyboard.press('Escape');
      await info(city).waitFor();
    }
    if (city === cities.empty) assert.match(await info(city).textContent(), /没有武将/);
    if (i < 3) { await info(city).getByRole('button', { name: '继续侦察', exact: true }).click(); await picker().waitFor(); }
    else await info(city).getByRole('button', { name: '结束侦察', exact: true }).click();
  }
  await page.waitForFunction(() => !document.querySelector('.shade, .mappick'));
  assert.equal(await books(), 2);
  assert.equal(await page.evaluate(() => window.__game.g.current === window.__game.g.player), true);
  const revealed = await page.evaluate(([a, b]) => [window.__game.g.scouted?.[a], window.__game.g.scouted?.[b]], [cities.near.id, cities.far.id]);
  assert.ok(revealed.every((x) => Number.isInteger(x)), `both enemy cities are remembered: ${revealed}`);
});

test('the city picker isolates the HUD and returns from an overlapping dialog safely', async () => {
  await page.evaluate((name) => {
    window.__game.g.books = 3;
    [...document.querySelectorAll('.ctag')].find((e) => e.textContent.includes(name)).click();
  }, cities.home.name);
  await begin(); await page.locator('.modal[aria-label="侦察"] .btn.primary').click();
  await picker().waitFor();
  const row = await page.locator('.citypanel .roster .off').first().boundingBox();
  assert.ok(row, 'the home city and its officer remain visible');
  await page.mouse.click(row.x + 10, row.y + row.height / 2);
  assert.equal(await page.locator('.shade').count(), 0, 'the underlying officer cannot open while picking a city');
  assert.equal(await picker().count(), 1);
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.querySelector('.mappick')?.contains(document.activeElement)), true,
      'Tab stays inside the picker instead of reaching 系统 or the city panel');
  }
  await page.evaluate(async () => {
    const { h, modal } = await import('./src/ui.js');
    modal('上层窗口', (close) => h('button', { class: 'btn', onclick: () => close() }, '关闭'));
  });
  await page.getByRole('dialog', { name: '上层窗口' }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog', { name: '上层窗口' }).count(), 0, 'Escape closes the topmost dialog');
  assert.equal(await picker().count(), 1, 'the picker remains open underneath');
  assert.equal(await page.getByRole('dialog', { name: '结束侦察' }).count(), 0, 'the picker did not intercept that Escape');
  const mapCity = await page.evaluate(() => {
    const { g, G, strategy } = window.__game;
    const reachable = g.cities.flatMap((c) => {
      const el = strategy.tagOf(c.id);
      if (!el?.classList.contains('cand')) return [];
      const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (!el.contains(document.elementFromPoint(x, y))) return [];
      return [{ id: c.id, name: G.cityName(c.id), x, y }];
    });
    const centreDistance = ({ x, y }) => Math.hypot(x - innerWidth / 2, y - innerHeight / 2);
    return reachable.sort((a, b) => centreDistance(a) - centreDistance(b))[0] ?? null;
  });
  assert.ok(mapCity, 'a highlighted city is reachable on the map');
  // A drag that begins on a highlighted tag moves the map and picks nothing (D52).
  await page.mouse.move(mapCity.x, mapCity.y); await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(mapCity.x + 7 * i, mapCity.y + 4 * i);
  await page.mouse.up(); await page.waitForTimeout(300);
  assert.equal(await info(mapCity).count(), 0, 'a drag from a candidate picks nothing');
  assert.equal(await picker().count(), 1);
  await page.locator('.ctag.cand').filter({ hasText: new RegExp(`^${mapCity.name}`) }).click();
  await info(mapCity).waitFor();
  await info(mapCity).getByRole('button', { name: '结束侦察', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.shade, .mappick'));
  assert.equal(await books(), 2);
  await page.evaluate((name) => [...document.querySelectorAll('.ctag')].find((e) => e.textContent.includes(name)).click(), cities.home.name);
  await page.locator('.citypanel .roster .off').first().click();
  assert.equal(await page.locator('.shade').count(), 1, 'the HUD works again after the picker closes');
  await page.keyboard.press('Escape');
});

test('a gamepad can return to the city picker, select another city and end scouting', async () => {
  await page.evaluate((name) => {
    window.__game.g.books = 3;
    [...document.querySelectorAll('.ctag')].find((e) => e.textContent.includes(name)).click();
  }, cities.home.name);
  await begin(); await page.locator('.modal[aria-label="侦察"] .btn.primary').click();
  await picker().waitFor(); await choose(cities.near);
  const tap = (i) => tapFakePad(page, i, 240);
  await page.waitForTimeout(250); await tap(1); // B returns from the detail to the picker
  await picker().waitFor();
  await page.waitForFunction(() => document.querySelector('.mappick')?.contains(document.activeElement));
  const next = await page.evaluate(() => document.activeElement.textContent.trim());
  await page.waitForTimeout(200); await tap(0); // A selects the focused city
  const view = page.getByRole('dialog', { name: `侦察：${next}`, exact: true });
  await view.waitFor();
  assert.equal(await books(), 2);
  await view.getByRole('button', { name: '结束侦察', exact: true }).focus();
  await page.waitForTimeout(200); await tap(0);
  await page.waitForFunction(() => !document.querySelector('.shade, .mappick'));
  assert.equal(await books(), 2);
});

test('the scout vignette plays once for a session even when several cities are inspected', async () => {
  await page.evaluate(async (name) => {
    (await import('./src/vignette.js')).setVignettes(true);
    window.__game.g.books = 3;
    [...document.querySelectorAll('.ctag')].find((e) => e.textContent.includes(name)).click();
    window.__scoutShows = 0;
    window.__scoutObserver = new MutationObserver((changes) => {
      for (const change of changes) for (const n of change.addedNodes) if (n.matches?.('.vig[data-scene="scout"]')) window.__scoutShows++;
    });
    window.__scoutObserver.observe(document.body, { childList: true });
  }, cities.home.name);
  try {
    await begin(); await page.locator('.modal[aria-label="侦察"] .btn.primary').click();
    await page.waitForSelector('.vig[data-scene="scout"]', { timeout: 10000 });
    await picker().waitFor({ timeout: 10000 });
    await choose(cities.near);
    await info(cities.near).getByRole('button', { name: '继续侦察', exact: true }).click();
    await picker().waitFor(); await choose(cities.far);
    assert.equal(await page.evaluate(() => window.__scoutShows), 1, 'the picture is not replayed for another city');
    assert.equal(await books(), 2);
    await info(cities.far).getByRole('button', { name: '结束侦察', exact: true }).click();
  } finally {
    await page.evaluate(async () => { window.__scoutObserver.disconnect(); (await import('./src/vignette.js')).setVignettes(false); });
  }
});

test('a full city keeps the scout actions visible in a small window', async () => {
  await page.setViewportSize({ width: 800, height: 600 });
  const previous = await page.evaluate(({ home, target }) => {
    const { g } = window.__game, city = g.cities[target], before = city.officers.slice();
    city.officers = [...new Set([...city.officers, ...g.cities.flatMap((c) => c.officers)])].slice(0, 10);
    g.books = 3;
    [...document.querySelectorAll('.ctag')].find((e) => e.textContent.includes(home)).click();
    return before;
  }, { home: cities.home.name, target: cities.near.id });
  try {
    await begin(); await page.locator('.modal[aria-label="侦察"] .btn.primary').click();
    await picker().waitFor(); await choose(cities.near);
    const layout = await info(cities.near).evaluate((dialog) => {
      const box = dialog.getBoundingClientRect(), actions = dialog.querySelector('.foot').getBoundingClientRect(), table = dialog.querySelector('.otable-wrap');
      return { box: { top: box.top, bottom: box.bottom }, actions: { top: actions.top, bottom: actions.bottom },
        tableScroll: table.scrollHeight, tableHeight: table.clientHeight, height: innerHeight };
    });
    assert.ok(layout.actions.top >= layout.box.top && layout.actions.bottom <= layout.box.bottom && layout.actions.bottom <= layout.height,
      `both scout actions remain visible: ${JSON.stringify(layout)}`);
    assert.ok(layout.tableScroll > layout.tableHeight, `the officer list itself scrolls: ${JSON.stringify(layout)}`);
  } finally {
    await page.evaluate(({ id, previous }) => {
      document.querySelector('.modal[aria-label^="侦察："] .foot .btn')?.click();
      window.__game.g.cities[id].officers = previous;
    }, { id: cities.near.id, previous });
    await page.setViewportSize({ width: 1440, height: 900 });
  }
});

// A spent last book must not hand the turn to AI until the player explicitly finishes the scout session.
test('the last book holds the turn throughout scouting and asks before quitting the city picker', async () => {
  await page.evaluate((name) => {
    const { g } = window.__game; g.books = 1;
    [...document.querySelectorAll('.ctag')].find((e) => e.textContent.includes(name)).click();
  }, cities.home.name);
  await begin(); await page.locator('.modal[aria-label="侦察"] .btn.primary').click();
  await picker().waitFor();
  assert.equal(await books(), 0);
  const stillMine = () => page.evaluate(() => window.__game.g.current === window.__game.g.player && !document.body.classList.contains('handoff'));
  assert.equal(await stillMine(), true, 'the player can still choose a city after spending the last book');
  await choose(cities.near);
  await page.keyboard.press('Escape'); // leaving the detail returns to city selection, not to the next faction
  await picker().waitFor();
  assert.equal(await stillMine(), true);
  await page.keyboard.press('Escape');
  const quit = page.getByRole('dialog', { name: '结束侦察', exact: true });
  await quit.waitFor();
  await quit.getByRole('button', { name: '取消', exact: true }).click();
  await picker().waitFor();
  assert.equal(await stillMine(), true, 'cancel keeps the session open');
  await choose(cities.far);
  await info(cities.far).getByRole('button', { name: '结束侦察', exact: true }).click();
  await page.waitForFunction(() => document.body.classList.contains('handoff') || window.__game.g.current !== window.__game.g.player, null, { timeout: 10000 });
  assert.deepEqual(page.errors, []);
});
