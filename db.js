// IndexedDB store for bug reports (video blob, screenshot, captured events, draft text).
// Shared by the service worker, the offscreen recorder and the preview page (same extension origin).
const DB_NAME = 'digit-bug-reporter';
const STORE = 'reports';
const KEEP = 10;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    Promise.resolve(fn(store)).then((r) => { result = r; });
    t.oncomplete = () => { db.close(); resolve(result); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
}

const wrap = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

export const get = (id) => tx('readonly', (s) => wrap(s.get(id)));

export const put = (report) => tx('readwrite', (s) => wrap(s.put(report)));

export const remove = (id) => tx('readwrite', (s) => wrap(s.delete(id)));

// Merge fields into an existing report inside one transaction.
export const update = (id, patch) => tx('readwrite', async (s) => {
  const current = (await wrap(s.get(id))) || { id };
  await wrap(s.put({ ...current, ...patch }));
});

// Keep only the newest reports so old videos don't pile up.
export const prune = () => tx('readwrite', async (s) => {
  const all = await wrap(s.getAll());
  all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  for (const r of all.slice(KEEP)) await wrap(s.delete(r.id));
});
