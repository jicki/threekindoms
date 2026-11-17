import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, newCampaign, closeMessages } from './game.mjs';

let game;
before(async () => { game = await startGame({ width: 1440, height: 900 }); });
after(() => game?.close());

test('战后安置：多个君主争用最后空位时可以自动安置并完成选择', async () => {
  const page = await game.open('&flat');
  try {
    await newCampaign(page, '曹操');
    for (const enabled of [true, false]) {
      const rulerName = await page.evaluate((enabled) => {
        const { g, G, debug } = window.__game, f = g.player, ownRuler = g.factions[f].ruler;
        const enemyFaction = g.factions.find((fac) => fac.id !== f && fac.ruler != null), prisoner = enemyFaction.ruler;
        const generals = g.officers.filter((o) => !G.isRuler(g, o.id)).slice(0, 9).map((o) => o.id);
        g.noWarDeath = enabled;
        for (const n of G.roads(14)) { g.cities[n].faction = enemyFaction.id; g.cities[n].officers = []; }
        const war = { city: 14, from: 12, attacker: f, defender: enemyFaction.id, att: { ids: [ownRuler, ...generals] }, def: { ids: [prisoner] } };
        const res = { loser: 'def', survivors: { att: [ownRuler, ...generals], def: [] }, captured: { byAtt: [prisoner], byDef: [] }, retreated: [], sparedRulers: [prisoner] };
        window.__settleChoice = null;
        debug.settleMenu(war, res, 'att').then((choice) => { window.__settleChoice = choice; });
        return G.name(prisoner);
      }, enabled);
      const dialog = page.getByRole('dialog', { name: '战后安置' });
      await dialog.waitFor();
      const select = dialog.getByLabel(`${rulerName}的去向`);
      assert.equal(await select.inputValue(), 'auto');
      assert.match(await select.locator('option[value="auto"]').textContent(), /自动安置/);
      const ok = dialog.getByRole('button', { name: '确定' });
      assert.equal(await ok.isEnabled(), true);
      await ok.click();
      await page.waitForFunction(() => window.__settleChoice != null);
      assert.equal(await page.evaluate((name) => {
        const { g, G } = window.__game, id = g.factions.find((f) => f.ruler != null && G.name(f.ruler) === name).ruler;
        return window.__settleChoice[id];
      }, rulerName), 'auto');
    }
    assert.deepEqual(page.errors, []);
  } finally { await page.close(); }
});

test('不战死：玩家君主无路可退时，战报和最终状态均显示被俘', async () => {
  const page = await game.open('&flat'), stop = closeMessages(page);
  try {
    await newCampaign(page, '曹操');
    const ruler = await page.evaluate(() => {
      const { g, G, debug } = window.__game, ruler = g.factions[2].ruler, enemy = g.factions[1].ruler;
      const general = g.officers.find((o) => !G.isRuler(g, o.id)).id;
      g.noWarDeath = true;
      for (const c of g.cities) { c.faction = 1; c.officers = []; }
      g.cities[12].faction = 1; g.cities[12].officers = [enemy];
      g.cities[14].faction = 2; g.cities[14].officers = [ruler, general]; g.cities[14].rice = 500;
      for (const id of [ruler, general, enemy]) Object.assign(g.officers[id], { status: G.SERVING, soldiers: 500 });
      const war = debug.setupWar(g, { from: 12, to: 14, ids: [enemy], commander: enemy, gold: 50, rice: 500 });
      g.cities[12].faction = 1;
      debug.fieldWar(war, 'def');
      return { id: ruler, name: G.name(ruler) };
    });
    await page.waitForFunction(() => window.__game.war?.st.deploying, null, { timeout: 30000 });
    await page.evaluate(() => window.__game.war.finishDeploy());
    await page.waitForFunction(() => { const w = window.__game.war; return w.field.turn === w.field.human && !w.st.busy && !document.querySelector('.banner, .panel.msg'); }, null, { timeout: 30000 });
    await page.evaluate(() => {
      const w = window.__game.war, f = w.field;
      f.chest(f.human).rice = 0; f.turn = 'def'; f.endTurn(); f.turn = f.human; w.endTurn();
    });
    await page.locator('.ledgers').waitFor({ timeout: 30000 });
    const row = page.locator('.lrow').filter({ hasText: ruler.name });
    assert.match(await row.locator('.fate').textContent(), /被俘归顺/);
    assert.match(await row.locator('.tr').textContent(), /500 → 500/);
    await page.getByRole('button', { name: '返回大地图', exact: true }).click();
    await page.waitForFunction(() => window.__game.g.factions[2].ruler == null, null, { timeout: 30000 });
    assert.equal(await page.evaluate((id) => window.__game.g.officers[id].status === window.__game.G.SERVING, ruler.id), true);
    assert.deepEqual(page.errors, []);
  } finally { stop(); await page.close(); }
});
