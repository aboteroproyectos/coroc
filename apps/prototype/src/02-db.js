/* COROC · almacenamiento local cifrable (IndexedDB) */
C.db = (() => {
  const NAME = 'coroc';
  const VERSION = 1;
  const STORES = {
    kv: { keyPath: 'key' },
    users: { keyPath: 'id', indexes: [['username', 'username', { unique: true }]] },
    clients: { keyPath: 'id', indexes: [['code', 'code', { unique: true }]] },
    loans: { keyPath: 'id', indexes: [['clientId', 'clientId'], ['contract', 'contract', { unique: true }]] },
    documents: { keyPath: 'id', indexes: [['clientId', 'clientId'], ['sha256', 'sha256']] },
    blobs: { keyPath: 'id' },
    inbox: { keyPath: 'id', indexes: [['status', 'status']] },
    messages: { keyPath: 'id', indexes: [['clientId', 'clientId'], ['dedupeKey', 'dedupeKey', { unique: true }]] },
    audit: { keyPath: 'id', indexes: [['at', 'at']] },
  };
  let dbp;
  const open = () =>
    (dbp ||= new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const [name, cfg] of Object.entries(STORES)) {
          if (db.objectStoreNames.contains(name)) continue;
          const st = db.createObjectStore(name, { keyPath: cfg.keyPath });
          for (const [iname, path, opts] of cfg.indexes || []) st.createIndex(iname, path, opts || {});
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  const tx = async (store, mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      let out;
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Transacción abortada'));
      out = fn(Array.isArray(store) ? store.map((s) => t.objectStore(s)) : t.objectStore(store));
    });
  };
  const req2p = (r) => new Promise((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));
  return {
    STORES: Object.keys(STORES),
    open,
    get: async (store, key) => {
      const db = await open();
      return req2p(db.transaction(store).objectStore(store).get(key));
    },
    all: async (store) => {
      const db = await open();
      return req2p(db.transaction(store).objectStore(store).getAll());
    },
    byIndex: async (store, index, value) => {
      const db = await open();
      return req2p(db.transaction(store).objectStore(store).index(index).getAll(value));
    },
    put: (store, value) => tx(store, 'readwrite', (s) => s.put(value)),
    del: (store, key) => tx(store, 'readwrite', (s) => s.delete(key)),
    clear: (store) => tx(store, 'readwrite', (s) => s.clear()),
    /** Escritura atómica en varias colecciones: [{store, value}] */
    putMany: (ops) => {
      const stores = [...new Set(ops.map((o) => o.store))];
      return tx(stores, 'readwrite', (sts) => {
        const map = Object.fromEntries(stores.map((s, i) => [s, sts[i]]));
        for (const o of ops) o.delete ? map[o.store].delete(o.key) : map[o.store].put(o.value);
      });
    },
    kvGet: async (key, fallback) => ((await C.db.get('kv', key)) || { value: fallback }).value,
    kvSet: (key, value) => C.db.put('kv', { key, value }),
  };
})();
