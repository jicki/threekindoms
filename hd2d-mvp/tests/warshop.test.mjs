// 战场武器店 in every battle city that has one (devlog comment #29 of 2026-10-31: "战场武器店又不能买武器了"):
// a general stands on the shop's cell, its button opens the field stock, and a confirmed purchase puts the
// piece on him and takes its price from the 军资金 — through the same clicks a player makes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startGame, newCampaign, saveCampaign, resumeCampaign, closeMessages } from './game.mjs';

const D = JSON.parse(readFileSync(new URL('../data/game-data.json', import.meta.url), 'utf8'));
const shops = D.cities.filter((c) => (D.villages[c.id] || []).some((v) => v.kind === '武器店'));

// One new campaign, played up to the player's first turn, is saved once; each city starts from that record
// (in a page of its own) instead of replaying the opening and the other factions' turns 21 times.
let game, save;
before(async () => {
  game = await startGame({ scenario: 'original' });
  const page = await game.open();
  try { await newCampaign(page); save = await saveCampaign(page); } finally { await page.context().close(); }
});
after(() => game?.close());

test('every city with a 武器店 cell has a field stock', () => {
  assert.equal(shops.length, 21);
  for (const c of shops) assert.ok((c.field_shop || []).length, `${c.name} has nothing to sell`);
});

test('every piece of equipment has a 64×64 icon with a transparent background', async () => {
  const page = await game.open();
  try {
    const res = await page.evaluate(async (n) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        const r = await fetch(`assets/ai/icon/equip/${i}.webp`);
        if (!r.ok) { out.push({ i, status: r.status }); continue; }
        const bmp = await createImageBitmap(await r.blob()), c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d');
        x.drawImage(bmp, 0, 0); const px = x.getImageData(0, 0, bmp.width, bmp.height).data;
        let clear = 0, solid = 0; for (let k = 3; k < px.length; k += 4) { if (px[k] < 255) clear++; if (px[k] > 200) solid++; }
        out.push({ i, w: bmp.width, h: bmp.height, clear, solid });
      }
      return out;
    }, D.equipment.length);
    assert.equal(res.length, 32);
    for (const e of res) { assert.equal(e.status, undefined, `icon ${e.i} is missing`); assert.deepEqual([e.w, e.h], [64, 64], `icon ${e.i} size`); assert.ok(e.clear > 500 && e.solid > 100, `icon ${e.i} has a transparent background and a piece on it`); }
  } finally { await page.context().close(); }
});

// Every city on the 3D map (the default), and one city again on the flat map (?flat, the 低 preset's war map): same rules, another layout.
const cases = [...shops.map((c) => [c, '']), [shops[0], '&flat']];
for (const [c, q] of cases) test(`the field 武器店 of ${c.name} sells${q ? ' (flat)' : ''}`, async () => {
  const page = await game.open(q, { save });
  try {
    await resumeCampaign(page);
    // The player attacks this city with two generals and 2000 军资金; one general of another faction holds it.
    await page.evaluate((cid) => {
      const { g, debug } = window.__game, home = g.factions[g.player].city;
      const foe = g.cities.find((x) => x.faction !== g.player && x.faction != null && g.factions[x.faction] && x.officers.length);
      const ids = g.cities[home].officers.slice(0, 2), def = [foe.officers[0]];
      for (const id of [...ids, ...def]) g.officers[id].soldiers ||= 500;
      debug.fieldWar({ city: cid, from: home, attacker: g.player, defender: foe.faction, day: 1,
        att: { ids, gold: 2000, rice: 400 }, def: { ids: def, gold: 0, rice: 400 } }, 'att');
    }, c.id);
    await page.waitForFunction(() => window.__game.war?.finishDeploy && document.body.dataset.screen === 'war', null, { timeout: 30000 });
    assert.equal(await page.evaluate(() => document.body.classList.contains('flat2d')), q === '&flat', 'the view under test');
    const stop = closeMessages(page);
    try {
      // 布阵完成 as a player presses it, once the deployment is up (a call before it would be lost)
      await page.locator('.deploybtn .btn', { hasText: '布阵完成' }).click({ timeout: 30000 });
      await page.waitForFunction(() => { const f = window.__game.war.field; return f.turn === f.human && !document.querySelector('.banner, .panel.msg'); }, null, { timeout: 30000 });
    } finally { stop(); }
    // He stands on the shop's cell (anyone there steps aside) and is selected.
    const before = await page.evaluate(() => {
      const { war, g } = window.__game, f = war.field, v = f.villages.find((x) => x.kind === '武器店');
      const me = f.alive.find((u) => u.side === f.human);
      const there = f.unitAt(v.x, v.y);
      if (there && there !== me) { const free = [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [0, 2]].map(([dx, dy]) => [v.x + dx, v.y + dy]).find(([x, y]) => f.inside(x, y) && !f.unitAt(x, y)); [there.x, there.y] = free; }
      [me.x, me.y] = [v.x, v.y]; war.clickCell(me.x, me.y);
      const o = g.officers[me.id];
      return { id: me.id, weapon: o.weapon, armor: o.armor, gold: f.chest(me.side).gold };
    });
    const state = () => page.evaluate(() => { const w = window.__game.war, f = w.field; return JSON.stringify({ deploying: w.st.deploying, sel: w.st.sel?.id, busy: w.st.busy, turn: f.turn, human: f.human, acts: [...document.querySelectorAll('.unitacts')].map((e) => e.textContent), cover: [...document.querySelectorAll('.banner, .panel.msg, .shade, .vig')].map((e) => e.className), cine: document.body.classList.contains('cine') }); });
    await page.locator('.unitacts button, .unitpanel:not(.compare) button', { hasText: '武器店' }).click({ timeout: 15000 }).catch(async (e) => { throw new Error(`${e.message.split('\n')[0]} — ${await state()}`); });
    const row = page.locator('.modal .shop-row:not(.head):not([disabled])').first();
    await row.waitFor({ timeout: 5000 });
    const item = (await row.locator('span').first().textContent()).trim();
    // every row of the shop carries its piece's picture before the name
    const rows = await page.locator('.modal .shop-row:not(.head)').evaluateAll((els) => els.map((e) => ({ name: e.querySelector('span').textContent.trim(), src: e.querySelector('span img')?.getAttribute('src') })));
    assert.ok(rows.length > 0);
    for (const r of rows) { const eq = D.equipment.find((e) => e.name === r.name); assert.ok(r.src?.endsWith(`/equip/${eq.id}.webp`), `${r.name} shows icon ${eq.id}, got ${r.src}`); }
    await row.click();
    await page.locator('.shade .btn.primary', { hasText: '确定' }).click();
    await page.waitForFunction(() => !document.querySelector('.shade'), null, { timeout: 5000 });
    const after = await page.evaluate((id) => {
      const { war, g } = window.__game, o = g.officers[id], f = war.field;
      return { weapon: o.weapon, armor: o.armor, gold: f.chest(f.human).gold };
    }, before.id);
    const eq = D.equipment.find((e) => e.name === item);
    assert.ok(eq, `bought ${item}`);
    assert.equal(after.gold, before.gold - eq.price, `${item}: 军资金 paid`);
    if (eq.kind === 'weapon') assert.equal(after.weapon, eq.id, `${item} is in his hand`);
    else assert.equal(after.armor, eq.id - 24, `${item} is on him`);
    assert.ok((await page.locator('.unitpanel:not(.compare) .gear').textContent()).includes(item), `${item} on the selected card's gear row`);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

// 战场病院 (feedback R03, 2026-11-02): the original takes the 50 gold from a general at full HP too and heals 0;
// the rules keep that, but the button is greyed as 体力已满 and the view spends nothing for him.
const clinic = D.cities.find((c) => (D.villages[c.id] || []).some((v) => v.kind === '病院'));
test(`the field 病院 of ${clinic.name} heals a wounded general; at full HP it is greyed and spends nothing`, async () => {
  const page = await game.open('', { save });
  try {
    await resumeCampaign(page);
    await page.evaluate((cid) => {
      const { g, debug } = window.__game, home = g.factions[g.player].city;
      const foe = g.cities.find((x) => x.faction !== g.player && x.faction != null && g.factions[x.faction] && x.officers.length);
      const ids = g.cities[home].officers.slice(0, 2), def = [foe.officers[0]];
      for (const id of [...ids, ...def]) g.officers[id].soldiers ||= 500;
      debug.fieldWar({ city: cid, from: home, attacker: g.player, defender: foe.faction, day: 1,
        att: { ids, gold: 200, rice: 400 }, def: { ids: def, gold: 0, rice: 400 } }, 'att');
    }, clinic.id);
    await page.waitForFunction(() => window.__game.war?.finishDeploy && document.body.dataset.screen === 'war', null, { timeout: 30000 });
    const stop = closeMessages(page);
    try {
      await page.locator('.deploybtn .btn', { hasText: '布阵完成' }).click({ timeout: 30000 });
      await page.waitForFunction(() => { const f = window.__game.war.field; return f.turn === f.human && !document.querySelector('.banner, .panel.msg'); }, null, { timeout: 30000 });
    } finally { stop(); }
    const id = await page.evaluate(() => {
      const { war, g } = window.__game, f = war.field, v = f.villages.find((x) => x.kind === '病院');
      const me = f.alive.find((u) => u.side === f.human), there = f.unitAt(v.x, v.y);
      if (there && there !== me) { const free = [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [0, 2]].map(([dx, dy]) => [v.x + dx, v.y + dy]).find(([x, y]) => f.inside(x, y) && !f.unitAt(x, y)); [there.x, there.y] = free; }
      [me.x, me.y] = [v.x, v.y];
      g.officers[me.id].hp = window.__game.G.data().officers[me.id].hp - 10;
      war.clickCell(me.x, me.y);
      return me.id;
    });
    const read = () => page.evaluate((id) => {
      const { war, g, G } = window.__game, f = war.field;
      const b = [...document.querySelectorAll('.unitacts button, .unitpanel:not(.compare) button')].find((e) => /治疗|体力已满/.test(e.textContent));
      return { hp: g.officers[id].hp, max: G.data().officers[id].hp, gold: f.chest(f.human).gold, text: b?.textContent, disabled: b?.disabled };
    }, id);
    const wounded = await read();
    assert.deepEqual([wounded.text, wounded.disabled], ['治疗 50金', false], 'a wounded general is offered treatment');
    await page.locator('.unitacts button, .unitpanel:not(.compare) button', { hasText: '治疗 50金' }).click();
    const healed = await read();
    assert.equal(healed.hp, healed.max, 'healed up to his own maximum');
    assert.equal(healed.gold, wounded.gold - 50, '50 gold paid');
    assert.deepEqual([healed.text, healed.disabled], ['体力已满', true], 'at full HP the button is greyed');
    await page.evaluate(() => window.__game.war.service('hospital'));
    assert.equal((await read()).gold, healed.gold, 'the view spends nothing on a general at full HP');
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

// 战场米店 (D30, PepperLoveSalt@devblog #216, 2026-11-10): the original's field shop sells rice as well as buying it. The
// card of a general on the shop carries both; each asks for the amount with the city's rate, and 取消 trades nothing.
const granary = D.cities[2]; // 并州: sells 100 rice for 75 gold, 100 gold buys 86
for (const [side, q] of [['att', ''], ['def', ''], ['att', '&flat']]) test(`the field 米店 of ${granary.name} sells and buys rice for the ${side} side${q ? ' (flat)' : ''}`, async () => {
  const page = await game.open(q, { save });
  try {
    await resumeCampaign(page);
    await page.evaluate(({ cid, side }) => {
      const { g, debug } = window.__game, home = g.factions[g.player].city;
      const foe = g.cities.find((x) => x.faction !== g.player && x.faction != null && g.factions[x.faction] && x.officers.length);
      const mine = g.cities[home].officers.slice(0, 2), theirs = [foe.officers[0]];
      for (const id of [...mine, ...theirs]) g.officers[id].soldiers ||= 500;
      const [att, def] = side === 'att' ? [mine, theirs] : [theirs, mine];
      debug.fieldWar({ city: cid, from: side === 'att' ? home : foe.id, attacker: side === 'att' ? g.player : foe.faction, defender: side === 'att' ? foe.faction : g.player, day: 1,
        att: { ids: att, gold: 50, rice: 400 }, def: { ids: def, gold: 50, rice: 400 } }, side);
    }, { cid: granary.id, side });
    await page.waitForFunction(() => window.__game.war?.finishDeploy && document.body.dataset.screen === 'war', null, { timeout: 30000 });
    const stop = closeMessages(page);
    try {
      await page.waitForTimeout(2500);
      await page.evaluate(() => window.__game.war.st.deploying && window.__game.war.finishDeploy());
      await page.waitForFunction(() => { const w = window.__game.war, f = w.field; return f.turn === f.human && !w.st.busy && !w.st.deploying && !document.querySelector('.banner, .panel.msg'); }, null, { timeout: 60000 });
    } finally { stop(); }
    const stand = () => page.evaluate(() => {
      const { war } = window.__game, f = war.field, v = f.villages.find((x) => x.kind === '米店'), me = f.alive.find((u) => u.side === f.human);
      const there = f.unitAt(v.x, v.y);
      if (there && there !== me) { const free = [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [0, 2]].map(([dx, dy]) => [v.x + dx, v.y + dy]).find(([x, y]) => f.inside(x, y) && !f.unitAt(x, y)); [there.x, there.y] = free; }
      [me.x, me.y] = [v.x, v.y]; if (war.st.sel !== me) war.clickCell(me.x, me.y);
    });
    const chests = () => page.evaluate(() => { const f = window.__game.war.field, o = f.human === 'att' ? 'def' : 'att'; return { gold: f.chest(f.human).gold, rice: f.chest(f.human).rice, theirs: `${f.chest(o).gold}/${f.chest(o).rice}` }; });
    const act = (text) => page.locator('.unitacts button, .unitpanel:not(.compare) button', { hasText: text });
    await stand();
    await act('卖米').waitFor({ timeout: 15000 });
    assert.equal(await act('买米').count(), 1, 'buying is still offered beside it');
    // 取消 leaves both chests as they were
    await act('卖米').click();
    assert.match(await page.locator('.shade').textContent(), /卖100米得金 75/);
    await page.locator('.shade .btn', { hasText: '取消' }).click();
    assert.deepEqual(await chests(), { gold: 50, rice: 400, theirs: '50/400' });
    // 100 rice, the amount it opens on: 75 gold, as in the original for this city
    await act('卖米').click();
    await page.locator('.shade .btn.primary', { hasText: '确定' }).click();
    await page.waitForFunction(() => !document.querySelector('.shade'), null, { timeout: 5000 });
    assert.deepEqual(await chests(), { gold: 125, rice: 300, theirs: '50/400' });
    // and the gold buys rice back at the buying rate: no more than it can pay for
    await act('买米').click();
    assert.match(await page.locator('.shade').textContent(), /100金可买米 86/);
    assert.equal(await page.locator('.shade input[type=range]').getAttribute('max'), String(Math.floor(125 * 86 / 100)));
    await page.locator('.shade .btn.primary', { hasText: '确定' }).click();
    await page.waitForFunction(() => !document.querySelector('.shade'), null, { timeout: 5000 });
    assert.deepEqual(await chests(), { gold: 125 - Math.floor(100 * 100 / 86), rice: 400, theirs: '50/400' });
    // nothing to sell: greyed with the reason, not a dialog that does nothing
    await page.evaluate(() => { const { war } = window.__game, f = war.field; f.chest(f.human).rice = 0; war.clickCell(-1, -1); });
    await stand();
    await act('卖米').waitFor({ timeout: 5000 });
    assert.equal(await act('卖米').isDisabled(), true);
    assert.equal(await act('卖米').getAttribute('title'), '军粮已尽');
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});
