import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { withRecordLock } from '../src/core/record-lock.js';

const keys = ['navigator', 'Navigator', 'indexedDB', 'isSecureContext'];
const originals = Object.fromEntries(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const set = (key, value) => Object.defineProperty(globalThis, key, { configurable: true, value });
afterEach(() => {
  for (const [key, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  }
});

function fakeIndexedDB(abortOn = [], beforeRead = () => {}) {
  const records = new Map(); let number = 0;
  return { records, open() {
    const request = {};
    queueMicrotask(() => {
      request.result = { close() {}, transaction() {
        const current = ++number, writes = new Map(); let aborted = false;
        const tx = { abort() { aborted = true; queueMicrotask(() => tx.onabort?.()); }, objectStore() { return {
          get(key) {
            const read = {};
            queueMicrotask(() => {
              beforeRead(current, records);
              read.result = records.get(key); read.onsuccess();
              queueMicrotask(() => {
                if (aborted) return;
                if (abortOn.includes(current)) return tx.onabort();
                for (const [k, value] of writes) records.set(k, value);
                tx.oncomplete();
              });
            });
            return read;
          },
          put(value, key) { writes.set(key, value); },
        }; } };
        return tx;
      } };
      request.onsuccess();
    });
    return request;
  } };
}

test('an abort after a localStorage write leaves a recoverable intent and returns the real result', async () => {
  set('navigator', {}); set('isSecureContext', false);
  const db = fakeIndexedDB([2]); set('indexedDB', db);
  let record = null;
  const prepare = () => ({ before: null, token: 'saved', commit: () => { record = 'saved'; return 'saved'; } });
  assert.equal(await withRecordLock('record', prepare, { readCurrent: () => record }), 'saved');
  assert.equal(record, 'saved');
  assert.equal(db.records.get('record').pending.token, 'saved');
  assert.equal(await withRecordLock('record', (state) => state.token === 'saved' ? 'recovered' : 'failed', { readCurrent: () => record }), 'recovered');
  assert.deepEqual(db.records.get('record'), { token: 'saved' });
});

test('a superseded intent cannot write after another operation has recovered it', async () => {
  set('navigator', {}); set('isSecureContext', false);
  const db = fakeIndexedDB([], (number, records) => {
    if (number === 2) records.set('record', { token: 'other' });
  });
  set('indexedDB', db);
  let wrote = false;
  const result = await withRecordLock('record', () => ({
    before: null, token: 'candidate', commit: () => { wrote = true; return 'saved'; },
  }));
  assert.equal(result, 'changed');
  assert.equal(wrote, false);
  assert.deepEqual(db.records.get('record'), { token: 'other' });
});

test('an abandoned intent requires confirmation before its candidate becomes the conflict token', async () => {
  set('navigator', {}); set('isSecureContext', false);
  const db = fakeIndexedDB(); set('indexedDB', db);
  db.records.set('record', { token: 'previous', pending: { id: 'interrupted', token: 'candidate' } });
  let pending, prepared = false;
  assert.equal(await withRecordLock('record', () => { prepared = true; return 'failed'; }, {
    readCurrent: () => 'previous', onPending: (value) => { pending = value; },
  }), 'pending');
  assert.equal(prepared, false);
  assert.deepEqual(pending, { id: 'interrupted', token: 'candidate' });
  assert.ok(db.records.get('record').pending);
  assert.equal(await withRecordLock('record', (state) => state.token === 'candidate' ? 'observed' : 'failed', {
    readCurrent: () => 'previous', acceptedPending: pending.id,
  }), 'observed');
  assert.deepEqual(db.records.get('record'), { token: 'candidate' });
});

test('no available lock leaves the record untouched', async () => {
  set('navigator', {}); set('isSecureContext', false); set('indexedDB', undefined);
  let record = 'original';
  assert.equal(await withRecordLock('record', () => { record = 'changed'; return 'saved'; }), 'unavailable');
  assert.equal(record, 'original');
});

test('Web Locks alone cannot safely compare another page’s stale localStorage cache', async () => {
  set('navigator', { locks: { request: (_key, _options, fn) => Promise.resolve(fn()) } });
  set('indexedDB', undefined);
  let ran = false;
  assert.equal(await withRecordLock('record', () => { ran = true; return 'saved'; }), 'unavailable');
  assert.equal(ran, false);
});

test('a secure tab cannot switch to an unrelated IndexedDB lock when Web Locks was hidden', async () => {
  function BrowserNavigator() {}
  BrowserNavigator.prototype.locks = {};
  set('Navigator', BrowserNavigator); set('navigator', {}); set('isSecureContext', true);
  set('indexedDB', { open() { throw new Error('should not open'); } });
  let ran = false;
  assert.equal(await withRecordLock('record', () => { ran = true; return 'saved'; }), 'unavailable');
  assert.equal(ran, false);
});
