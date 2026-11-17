import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyScenario, validateScenario } from '../src/core/scenario.js';
import { loadScenario } from '../src/core/scenario-store.js';
import { FEMALE_SCENARIO_ID, validVisualRef, visualUrl } from '../src/core/visuals.js';
import * as G from '../src/core/game.js';

const base = JSON.parse(readFileSync(new URL('../data/game-data.json', import.meta.url)));

test('内置女性版本保留原版数据，可生成独立游戏和素材配置', async () => {
  const before = JSON.stringify(base), version = await loadScenario(FEMALE_SCENARIO_ID, base);
  assert.deepEqual(version.officers.map((o) => o.name), ['孙尚香', '甄宓', '貂蝉']);
  const data = applyScenario(base, version);
  assert.equal(JSON.stringify(base), before);
  for (const o of version.officers) {
    assert.ok(data.search_table[String(o.city)].includes(o.id));
    assert.ok(visualUrl(o.visual.portrait)); assert.ok(visualUrl(o.visual.motion));
    assert.equal(Object.keys(o.visual.faces).length, 4);
  }
  try { G.setData(data, version.id); assert.equal(G.newGame(4, 1, 1).officers.length, base.officers.length + 3); }
  finally { G.setData(base); }
});

test('素材引用只允许匹配用途的内置素材、有效编号或内容哈希', async () => {
  assert.equal(validVisualRef('b-sun-portrait', 'portrait', 237), true);
  assert.equal(validVisualRef('o-38', 'motion', 237), true);
  assert.equal(validVisualRef(`a-${'a'.repeat(64)}`, 'joy', 237), true);
  for (const bad of ['b-sun-motion', '../asset.png', 'https://example.com/a.png', 'o-237', 'a-not-a-hash']) {
    assert.equal(validVisualRef(bad, 'portrait', 237), false);
  }
  const scenario = await loadScenario(FEMALE_SCENARIO_ID, base);
  scenario.officers[0].visual.faces.angry = 'b-sun-joy';
  assert.throws(() => validateScenario(scenario, base), /素材|表情/);
});
