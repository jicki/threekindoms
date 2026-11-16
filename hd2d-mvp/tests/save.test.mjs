// Records (core/game.js save/load): a slot that no longer reads loads the record it held before, an empty slot
// stays empty, and a record from a newer release is refused. Rules only, in Node, over an in-memory localStorage.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/core/game.js';
G.setData(JSON.parse(readFileSync(new URL('../data/game-data.json', import.meta.url))));

const store = new Map();
let failKey = null;
const globals = Object.fromEntries(['navigator', 'indexedDB'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { if (k === failKey) throw new Error('storage full'); store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); },
} });
beforeEach(() => { store.clear(); failKey = null; });
afterEach(() => { for (const [key, descriptor] of Object.entries(globals)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
const KEY = 'haou-hd2d-save';

test('a record saves and loads, stamped with the current layout version', () => {
  const g = G.newGame(4, 1, 1); g.year = 195;
  assert.ok(G.save(g, 3));
  const r = G.load(3);
  assert.equal(r.year, 195); assert.equal(r.slot, 3); assert.equal(r.version, G.SAVE_VERSION);
  assert.equal(G.restored(r), false);
});

test('a slot cut off mid-write loads the record it held before, and says so', () => {
  const g = G.newGame(4, 1, 1); g.year = 190; G.save(g, 2);
  g.year = 191; G.save(g, 2);
  store.set(`${KEY}:2`, store.get(`${KEY}:2`).slice(0, 5000)); // the newest write, truncated
  const r = G.load(2);
  assert.equal(r?.year, 190, 'the record before the last write');
  assert.equal(G.restored(r), true);
});

test('a record that parses but is not a game falls back too; one with no backup reads as empty', () => {
  const g = G.newGame(4, 1, 1); G.save(g, 4); G.save(g, 4);
  store.set(`${KEY}:4`, JSON.stringify({ version: 1, cities: [] }));
  assert.ok(G.load(4), 'the backup');
  store.set(`${KEY}:5`, '{');
  assert.equal(G.load(5), null);
});

test('a broken record never becomes the backup', () => {
  const g = G.newGame(4, 1, 1); g.year = 192; G.save(g, 6);
  g.year = 193; G.save(g, 6);
  store.set(`${KEY}:6`, 'garbage');
  g.year = 194; G.save(g, 6); // writing over the broken 193 keeps 192 as the backup
  store.set(`${KEY}:6`, 'garbage');
  assert.equal(G.load(6).year, 192);
});

test('an empty slot is not brought back from its backup', () => {
  store.set(`${KEY}:7:bak`, JSON.stringify(G.newGame(4, 1, 1)));
  assert.equal(G.load(7), null);
});

test('a record from a newer release is refused, not misread', () => {
  const g = G.newGame(4, 1, 1);
  store.set(`${KEY}:1`, JSON.stringify({ ...g, version: G.SAVE_VERSION + 1 }));
  assert.equal(G.load(1), null);
});

test('a newer record is not replaced by its older backup or by an old-version write', () => {
  const g = G.newGame(4, 1, 1); g.year = 190; G.save(g, 1); G.save(g, 1);
  const future = JSON.stringify({ ...g, version: G.SAVE_VERSION + 1, year: 200 });
  store.set(`${KEY}:1`, future);
  assert.equal(G.load(1), null);
  assert.equal(G.futureSlot(1), true);
  assert.equal(G.save(g, 1), false);
  assert.equal(store.get(`${KEY}:1`), future);
});

test('a failed numbered save leaves the running game and current slot unchanged', () => {
  const g = G.newGame(4, 1, 1); assert.ok(G.save(g, 1));
  const before = { slot: g.slot, savedAt: g.savedAt, version: g.version };
  failKey = `${KEY}:2`;
  assert.equal(G.save(g, 2), false);
  assert.deepEqual({ slot: g.slot, savedAt: g.savedAt, version: g.version }, before);
  assert.equal(store.has(`${KEY}:2`), false);
});

test('checked saves refuse a slot changed since selection and track the saved contents', async () => {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: (_key, _options, fn) => Promise.resolve(fn()) } } });
  const records = new Map();
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { open() {
    const request = {};
    queueMicrotask(() => {
      request.result = { close() {}, transaction() {
        const tx = { abort() { queueMicrotask(() => tx.onabort?.()); }, objectStore() { return {
          get(key) { const read = {}; queueMicrotask(() => { read.result = records.get(key); read.onsuccess(); queueMicrotask(() => tx.oncomplete?.()); }); return read; },
          put(value, key) { records.set(key, value); },
        }; } };
        return tx;
      } };
      request.onsuccess();
    });
    return request;
  } } });
  const g = G.newGame(4, 1, 1), other = G.newGame(2, 1, 2);
  const empty = G.slotToken(2);
  assert.equal(G.save(other, 2), true);
  const otherRecord = G.slotToken(2);
  assert.equal(await G.saveChecked(g, 2, empty), 'changed');
  assert.equal(G.slotToken(2), otherRecord);
  assert.equal(await G.saveChecked(g, 2, otherRecord), 'saved');
  assert.equal(G.currentSlot(g, 2), true);
  assert.equal(G.save(other, 2), true);
  assert.equal(G.currentSlot(g, 2), false);
});

test('a record from before version stamps loads as version 1', () => {
  const g = G.newGame(4, 1, 1); delete g.version;
  store.set(`${KEY}:1`, JSON.stringify(g));
  assert.equal(G.load(1)?.version, G.SAVE_VERSION);
});
