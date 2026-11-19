import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
import { expandMap } from '../src/core/expanded-map.js';

const base = JSON.parse(readFileSync(new URL('../data/game-data.json', import.meta.url)));
test('考据地名仅改变显示，扩展据点和记录数据不变，重名时保留原名', () => {
  const data = expandMap(structuredClone(base)); G.setData(data);
  G.setPlaceNames(false); const before = structuredClone(data), game = G.newGame(4, 1, 1), record = JSON.stringify(game);
  G.setPlaceNames(true);
  assert.equal(G.cityName(1), '北平'); assert.equal(G.cityOrigName(1), '幽州');
  assert.equal(G.cityName(21), '南郡'); assert.equal(G.cityName(30), '襄阳');
  assert.deepEqual(data, before); assert.equal(JSON.stringify(game), record);
  data.cities.push({ id: data.cities.length, name: '北平' }); assert.equal(G.cityName(1), '幽州');
  G.setPlaceNames(false); assert.equal(G.cityName(21), '荆州');
});
