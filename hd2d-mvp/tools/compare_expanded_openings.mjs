// 扩展地图开局对照：使用两个冻结的 core 目录，比较相同难度、君主和随机种子。
// 例如：node hd2d-mvp/tools/compare_expanded_openings.mjs --before /tmp/old/core --after hd2d-mvp/src/core --seeds 30
// --policy auto：玩家也由战略 AI 控制，所有战斗使用自动结算；--policy defend：玩家执行固定守备策略，玩家战斗使用真实战场 AI。
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const before = arg('before'), after = arg('after'), policy = arg('policy', 'auto');
const seeds = Number(arg('seeds', 30)), firstSeed = Number(arg('first-seed', 1)), years = Number(arg('years', 5));
const list = (value) => typeof value === 'string' && /^\d+(,\d+)*$/.test(value) ? value.split(',').map(Number) : [];
const players = list(arg('players', '0,1,2,3,4,5,6,7,8,9'));
const levels = list(arg('levels', '1,2,3')).map((n) => n - 1);
assert.ok(before && after, '需要提供 --before 和 --after core 目录');
assert.ok(['auto', 'defend'].includes(policy), 'policy 只能是 auto 或 defend');
assert.ok([seeds, years].every((n) => Number.isSafeInteger(n) && n > 0)
  && Number.isSafeInteger(firstSeed) && firstSeed >= 0 && firstSeed + seeds - 1 <= 0xffffffff,
  '随机种子数和年数须为正整数，起始及结束种子须在 0–4294967295 之间');
assert.ok(players.length && players.every((n) => Number.isInteger(n) && n >= 0 && n < 10), '君主编号须在 0–9 之间');
assert.ok(levels.length && levels.every((n) => Number.isInteger(n) && n >= 0 && n < 3), '难度须在 1–3 之间');

const root = fileURLToPath(new URL('..', import.meta.url));
const base = JSON.parse(readFileSync(resolve(root, 'data/game-data.json'), 'utf8'));
async function engine(directory) {
  const load = (name) => import(pathToFileURL(resolve(directory, `${name}.js`)).href);
  const [G, A, W, F, R, S, Store, Visuals, Map] = await Promise.all([
    load('game'), load('ai'), load('warcore'), load('field'), load('raids'), load('scenario'), load('scenario-store'), load('visuals'), load('expanded-map'),
  ]);
  const standard = S.applyScenario(base, await Store.loadScenario(Visuals.SOVEREIGN_SCENARIO_ID, base));
  G.setData(Map.expandMap(standard), Map.EXPANDED_MAP_ID);
  return { G, A, W, F, R };
}
const engines = { before: await engine(before), after: await engine(after) };
const STOP = Symbol('到达模拟年限');

async function campaign({ G, A, W, F, R }, player, level, seed) {
  const g = G.newGame(player, level, seed), initialYear = g.year;
  let attacks = 0, passAttacks = 0;
  const stopAtLimit = () => { if (g.year >= initialYear + years) throw STOP; };
  const replenish = (c) => {
    for (const id of c.officers) while (c.reserve > 0 && g.officers[id].soldiers < 1000) G.assignTroops(g, c.id, id, 100);
  };
  const defend = (f) => {
    for (const c of G.citiesOf(g, f)) {
      if (!c.officers.length) continue;
      replenish(c);
      if (g.books > 0 && c.gold >= 100 && G.troopsOf(g, c) + c.reserve < c.officers.length * 1000) {
        const result = G.conscript(g, c.id, Math.min(5, G.conscriptMax(c)));
        if (result.ok) { g.books--; replenish(c); }
      }
      if (g.books > 0 && c.officers.length >= 4) {
        const target = G.roads(c.id).find((n) => g.cities[n].faction === G.NONE && !g.cities[n].officers.length);
        const id = c.officers.find((n) => n !== g.factions[f].ruler);
        if (target != null && id != null && G.moveOfficers(g, c.id, target, [id]).ok) g.books--;
      }
      if (g.books > 0 && c.gov < 50 && c.gold >= 50 && G.charity(g, c.id, 50, 0).ok) g.books--;
    }
    g.endTurn = true;
  };
  const io = {
    event: async () => {}, chooseHeir: async (f) => G.autoHeir(g, f), allianceOffer: async () => false,
    war: async (war) => {
      if (war.defender === player) { attacks++; if (G.isPass(war.city)) passAttacks++; }
      if (policy === 'auto') W.autoBattle(g, war);
      else {
        const field = new F.Field(g, war, null);
        let turns = 0;
        while (!field.over && turns++ < 200) {
          for (const event of field.aiActions(field.turn)) if (event.res?.pending) event.res.auto();
          field.endTurn();
        }
        if (!field.over) throw new Error(`战场超过模拟回合上限：君主 ${player}，种子 ${seed}`);
        W.resolveWar(g, war, field.result());
      }
      await G.checkFactions(g, io);
    },
    afterWar: async () => G.checkFactions(g, io),
    aiTurn: async (f) => { stopAtLimit(); await A.aiTurn(g, f, io); },
    playerTurn: async (f) => { stopAtLimit(); if (policy === 'auto') { await A.aiTurn(g, f, io); g.endTurn = true; } else defend(f); },
    // 统计用较弱的电脑袭扰结算，不能视为玩家守城的真人体验。
    raid: async (f) => { const plan = R.chooseRaid(g, f); if (plan) { R.resolveAiRaid(g, plan); await G.checkFactions(g, io); } },
  };
  try { await G.run(g, io); } catch (error) { if (error !== STOP) throw error; }
  const lost = g.factions[player].ruler == null || g.over?.type === 'gameover';
  return { lost, early: lost && g.year < initialYear + 3, attacks, passAttacks,
    cities: G.citiesOf(g, player).length, troops: G.holdingsOf(g, player).reduce((n, c) => n + G.troopsOf(g, c), 0) };
}

const report = { seeds, firstSeed, years, policy,
  scope: '配对随机种子；玩家由 AI 或固定守备策略操作；玩家袭扰使用较弱的电脑结算，不代表真人或实机难度。', rows: [] };
for (const player of players) for (const level of levels) {
  const row = { player, level: level + 1 };
  for (const [label, e] of Object.entries(engines)) {
    const games = [];
    for (let i = 0; i < seeds; i++) games.push(await campaign(e, player, level, firstSeed + i));
    const sum = (key) => games.reduce((n, result) => n + Number(result[key]), 0);
    row[label] = { lost: sum('lost'), early: sum('early'), attacks: sum('attacks'), passAttacks: sum('passAttacks'),
      meanCities: sum('cities') / seeds, meanTroops: sum('troops') / seeds };
    row.ruler = e.G.name(e.G.data().factions[player].ruler);
  }
  report.rows.push(row);
  console.log(JSON.stringify(row));
}
if (arg('out')) writeFileSync(resolve(arg('out')), JSON.stringify(report, null, 2) + '\n');
