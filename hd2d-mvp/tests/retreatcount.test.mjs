// A city's officer count during a war includes those who already retreated to it: they reach it at once in the
// original (`$BC2A`), though here they join its list only when the war is settled. The 退却 map says what the room
// check goes by, on its chips and on the map's city labels.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, newCampaign, closeMessages } from './game.mjs';

let game, page, setup;
const CITY = '豫州', OTHER = '兖州';

before(async () => {
  // 原版的洛阳同时直连豫州和兖州。君主列传从洛阳到兖州需经过虎牢关。
  game = await startGame({ width: 1600, height: 900, scenario: 'original' });
  page = await game.open('&fixedseed');
  await newCampaign(page, '曹操');
  setup = await page.evaluate(() => {
    const { g, G, debug } = window.__game, c = g.cities[14], to = g.cities[12]; // 豫州 sends everyone against 洛阳, next to 兖州 too
    if (![11, 14].every((id) => G.roads(to.id).includes(id))) throw new Error('回归场景需要洛阳直连兖州和豫州');
    for (const id of [...c.officers, ...to.officers]) g.officers[id].soldiers ||= 500;
    const ids = c.officers.slice(0, 4);
    debug.fieldWar(debug.setupWar(g, { from: 14, to: 12, ids, commander: ids[0], gold: 100, rice: 400 }), 'att');
    return { ids };
  });
  await page.waitForFunction(() => window.__game.war?.finishDeploy && document.body.dataset.screen === 'war', null, { timeout: 30000 });
  const stop = closeMessages(page);
  try {
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.__game.war.finishDeploy());
    await page.waitForFunction(() => { const f = window.__game.war.field; return f.turn === f.human && !document.querySelector('.banner, .panel.msg'); }, null, { timeout: 30000 });
  } finally { stop(); } // a timer left running keeps node alive after the test fails
});
after(() => game?.close());

const chip = (name) => page.locator('.mappick .chips .btn', { hasText: name });
const openPicker = async () => {
  await page.evaluate(() => { const w = window.__game.war, f = w.field; w.cancel(); w.cancel(); const u = f.side(f.human).find((x) => !x.gone && !x.commander); w.clickCell(u.x, u.y); });
  await page.getByRole('button', { name: '退却', exact: true }).click();
  await page.waitForSelector('.mappick', { timeout: 15000 });
};
const mapLabel = (name) => page.evaluate((name) => [...document.querySelectorAll('*')].find((e) => e.querySelector?.(':scope > small') && !e.closest('.mappick') && e.firstChild?.textContent === name)?.textContent, name);
const retreatToCity = async () => { await chip(CITY).click(); await page.getByRole('button', { name: '确定', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('.mappick') && !window.__game.war.st.busy); await page.waitForTimeout(800); };

test('each retreat adds one to the city on the 退却 map, chip and label alike, and leaves the others', async () => {
  await openPicker();
  assert.match(await chip(CITY).textContent(), /空城/);
  assert.equal(await mapLabel(CITY), `${CITY}无主`);
  await retreatToCity();
  for (const n of [1, 2]) {
    await openPicker();
    assert.match(await chip(CITY).textContent(), new RegExp(`${n}/10将`));
    assert.equal(await mapLabel(CITY), `${CITY}曹操·${n}将`);
    assert.match(await chip(OTHER).textContent(), /3\/10将/);
    assert.equal(await mapLabel(OTHER), `${OTHER}曹操·3将`);
    if (n === 1) await retreatToCity();
  }
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.mappick') && !window.__game.war.st.busy);
});

test('the count on the map is the one the 10-officer room goes by', async () => {
  const got = await page.evaluate(() => {
    const { g, war } = window.__game, f = war.field, c = g.cities[14], u = f.side(f.human).find((x) => !x.gone && !x.commander);
    const before = { count: f.headcount(14), open: f.retreatTargets(u).includes(14) };
    const kept = c.officers; c.officers = Array(8).fill(0); // with the 2 on their way: full
    const full = { count: f.headcount(14), open: f.retreatTargets(u).includes(14) };
    c.officers = kept;
    return { before, full };
  });
  assert.deepEqual(got, { before: { count: 2, open: true }, full: { count: 10, open: false } });
});

test('settling the war does not count them twice', async () => {
  const stop = closeMessages(page);
  try {
    await page.evaluate(() => { const w = window.__game.war, f = w.field; w.cancel(); w.cancel(); for (const u of f.side(f.human).filter((x) => !x.gone && !x.commander)) w.retreat(14, u); w.retreat(14, f.side(f.human).find((x) => !x.gone && x.commander)); });
    await page.waitForFunction(() => window.__game.g.cities[14].officers.length === 4, null, { timeout: 30000 });
  } finally { stop(); }
  assert.deepEqual(await page.evaluate(() => window.__game.g.cities[14].officers.slice().sort()), [...setup.ids].sort());
  assert.deepEqual(page.errors, []);
});
