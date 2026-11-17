import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { fight, setupWar, autoBattle } from '../src/core/warcore.js';

const data = JSON.parse(readFileSync(new URL('../data/game-data.json', import.meta.url)));
G.setData(data);

// 电脑之间的战斗采用独立的伤亡计算；让君主成为唯一可选的战死者。
function autoFight(side, noWarDeath, loyalty = 100) {
  const g = G.newGame(4, 1, 1);
  g.noWarDeath = noWarDeath;
  const ruler = g.factions.find((f) => f.ruler != null).ruler;
  const others = g.officers.filter((o) => o.status === G.SERVING && !G.isRuler(g, o.id)).slice(0, 5).map((o) => o.id);
  for (const id of [ruler, ...others]) Object.assign(g.officers[id], { loyalty: 100, war: 80, int: 80, hp: 50, soldiers: 500 });
  Object.assign(g.officers[ruler], { war: 1, int: 1, hp: 17, maxHp: 20, loyalty });
  const group = [ruler, ...others.slice(0, 4)], foe = [others[4]];
  const war = { att: { ids: side === 'att' ? group : foe, rice: 9999 }, def: { ids: side === 'def' ? group : foe, rice: 9999 } };
  return { g, ruler, result: fight(g, war) };
}

test('电脑战斗：编辑过忠诚的君主在原版仍可战死，不战死时被俘并恢复体力', () => {
  const original = autoFight('att', false, 10), protectedFight = autoFight('att', true, 10);
  assert.ok(original.result.dead.includes(original.ruler));
  assert.ok(protectedFight.result.captured.byDef.includes(protectedFight.ruler));
  assert.equal(protectedFight.g.officers[protectedFight.ruler].hp, 20);
});

test('不战死不影响病逝，病逝由不老选项单独控制', () => {
  for (const ageless of [false, true]) {
    const g = G.newGame(2, 1, 1), ruler = g.factions[2].ruler;
    g.noWarDeath = true; g.ageless = ageless; g.year = data.officers[ruler].death + 6;
    const dead = G.naturalDeaths(g, 2);
    assert.equal(dead.includes(ruler), !ageless);
    assert.equal(g.officers[ruler].status === G.DEAD, !ageless);
  }
});

for (const side of ['att', 'def']) for (const player of [2, 4]) {
  test(`电脑战斗结算：${side} 方${player === 2 ? '玩家' : 'NPC'}君主被俘后继位`, async () => {
    const g = G.newGame(player, 1, 1); g.noWarDeath = true;
    const ruler = g.factions[2].ruler, enemy = g.factions[1].ruler;
    const other = g.officers.filter((o) => !G.isRuler(g, o.id)).slice(0, 5).map((o) => o.id);
    for (const c of g.cities) { c.faction = G.NONE; c.officers = []; }
    for (const id of [ruler, enemy, ...other]) Object.assign(g.officers[id], { status: G.SERVING, loyalty: 100, war: 80, int: 80, hp: 50, soldiers: 500 });
    Object.assign(g.officers[ruler], { war: 1, int: 1, hp: 17, maxHp: 20 });
    const group = [ruler, ...other.slice(0, 4)], home = g.cities[12], target = g.cities[14], backup = g.cities[0];
    home.faction = side === 'att' ? 2 : 1; home.officers = side === 'att' ? group : [enemy];
    target.faction = side === 'def' ? 2 : 1; target.officers = side === 'def' ? group : [enemy];
    home.rice = target.rice = 9999;
    backup.faction = 2; backup.officers = [other[4]];
    const ids = [...home.officers], war = setupWar(g, { from: home.id, to: target.id, ids, commander: ids[0], gold: 0, rice: 9000 });
    const result = autoBattle(g, war), events = [];
    assert.ok(result.captured.includes(ruler));
    assert.equal(g.officers[ruler].hp, 20);
    assert.equal(G.factionOf(g, ruler), 1);
    await G.checkFactions(g, { event: async (e) => events.push(e), chooseHeir: async (_f, candidates, why) => { events.push({ type: 'choose', why }); return candidates[0]; } });
    assert.notEqual(g.factions[2].ruler, ruler);
    assert.equal(g.officers[ruler].status, G.SERVING);
    assert.equal(events.find((e) => e.type === 'heir' && e.faction === 2)?.captured, true);
    if (player === 2) assert.equal(events.find((e) => e.type === 'choose')?.why, 'captured');
  });
}

for (const side of ['att', 'def']) {
  test(`电脑战斗：${side} 方君主受不战死保护并按体力上限恢复`, () => {
    const { g, ruler, result } = autoFight(side, true);
    assert.ok((side === 'att' ? result.captured.byDef : result.captured.byAtt).includes(ruler));
    assert.ok(!result.dead.includes(ruler));
    assert.ok(!result.surv[side].includes(ruler));
    assert.equal(g.officers[ruler].hp, 20);
  });
  test(`电脑战斗：原版模式保留 ${side} 方忠诚 100 的君主不进入伤亡`, () => {
    const { g, ruler, result } = autoFight(side, false);
    assert.ok(result.surv[side].includes(ruler));
    assert.ok(!result.dead.includes(ruler));
    assert.equal(g.officers[ruler].hp, 17);
  });
}
