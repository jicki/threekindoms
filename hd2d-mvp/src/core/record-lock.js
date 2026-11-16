// IndexedDB 保存写入意图并协调跨页面操作；支持 Web Locks 时也沿用同名锁。
export async function withRecordLock(key, prepare, options) {
  let locks;
  try { locks = globalThis.navigator?.locks; } catch { return 'unavailable'; }
  if (locks?.request) {
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 5000);
    try {
      return await locks.request(key, { signal: abort.signal }, () => {
        clearTimeout(timer);
        return withIndexedDBLock(key, prepare, options);
      });
    }
    catch (err) { return err?.name === 'AbortError' ? 'busy' : 'failed'; }
    finally { clearTimeout(timer); }
  }
  // 安全来源中若浏览器本来支持 Web Locks，不与可能正在使用该锁的旧页面混用两种锁。
  if (globalThis.isSecureContext !== false && globalThis.Navigator?.prototype && 'locks' in globalThis.Navigator.prototype) return 'unavailable';
  return withIndexedDBLock(key, prepare, options);
}

function withIndexedDBLock(key, prepare, { readCurrent = () => undefined, acceptedPending, onPending = () => {} } = {}) {
  let idb;
  try { idb = globalThis.indexedDB; } catch { return 'unavailable'; }
  if (!idb) return 'unavailable';
  return new Promise((resolve) => {
    let db = null, tx = null, done = false, wrote = false, lastPending = null, retryTimer = null;
    const finish = (result) => { if (done) return; done = true; clearTimeout(timer); clearTimeout(retryTimer); db?.close(); resolve(result); };
    const timer = setTimeout(() => {
      try { tx?.abort(); } catch {}
      if (wrote) return finish('saved');
      if (lastPending) { try { onPending(lastPending); } catch {} return finish('pending'); }
      finish('busy');
    }, 5000);
    const abort = (result = 'failed') => { if (!tx) return finish(wrote ? 'saved' : result); try { tx.abort(); } catch { finish(wrote ? 'saved' : result); } };

    function commit(operation, id) {
      if (done) return;
      let result = 'failed';
      try {
        tx = db.transaction('lock', 'readwrite');
        const store = tx.objectStore('lock'), read = store.get(key);
        read.onsuccess = () => {
          if (done) return;
          try {
            const state = read.result;
            if (state?.pending?.id !== id) { result = 'changed'; return; }
            result = operation.commit(state.token);
            if (result && typeof result.then === 'function') return abort();
            if (result === 'saved') wrote = true;
            store.put({ token: result === 'saved' ? operation.token : state.token }, key);
          } catch { abort(); }
        };
        tx.oncomplete = () => finish(result);
        // localStorage 的写入不会随 IndexedDB 回滚；意图保留后可由下一次操作恢复。
        tx.onabort = () => finish(wrote ? 'saved' : 'failed');
      } catch { abort(); }
    }

    function step() {
      if (done) return;
      let action = 'result', result = 'failed', operation, reservation;
      try {
        tx = db.transaction('lock', 'readwrite');
        const store = tx.objectStore('lock'), read = store.get(key);
        read.onsuccess = () => {
          if (done) return;
          try {
            const state = read.result ?? null, pending = state?.pending;
            if (pending) {
              const current = readCurrent();
              if (current === undefined) { result = 'failed'; return; }
              if (current === pending.token || acceptedPending === pending.id) {
                store.put({ token: pending.token }, key); action = 'retry';
              } else { lastPending = pending; action = 'wait'; }
              return;
            }
            lastPending = null;
            operation = prepare(state);
            if (typeof operation === 'string') { result = operation; return; }
            if (!operation || typeof operation.token !== 'string' || typeof operation.commit !== 'function') return;
            reservation = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
            store.put({ token: state ? state.token : operation.before, pending: { id: reservation, token: operation.token } }, key);
            action = 'write';
          } catch { abort(); }
        };
        tx.oncomplete = () => {
          if (done) return;
          tx = null;
          if (action === 'write') return commit(operation, reservation);
          if (action === 'retry') return step();
          if (action === 'wait') { retryTimer = setTimeout(step, 25); return; }
          finish(result);
        };
        tx.onabort = () => finish('failed');
      } catch { abort(); }
    }

    try {
      const request = idb.open('haou-hd2d-record-lock', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('lock');
      request.onerror = () => finish('unavailable');
      request.onsuccess = () => {
        if (done) { request.result.close(); return; }
        db = request.result; step();
      };
    } catch { finish('unavailable'); }
  });
}
