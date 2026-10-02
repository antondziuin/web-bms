/* IndexedDB storage for log records (see logformat.js). One object store, indexed by time. */
const DB_NAME = 'web-bms';
const STORE = 'samples';
let dbPromise = null;

export function logStoreSupported(){ return typeof indexedDB !== 'undefined'; }

function openDb(){
  if (!logStoreSupported()) return Promise.reject(new Error('IndexedDB is not available'));
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { autoIncrement: true }).createIndex('t', 't');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

/* Runs fn(store) in a transaction; resolves with the result of the request fn returns (if any). */
async function run(mode, fn){
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function addRecords(records){
  if (!records.length) return Promise.resolve();
  return run('readwrite', store => { for (const r of records) store.add(r); });
}

/* Records with from < t <= to, sorted by time. */
export function getRecords(from, to = Infinity){
  const range = isFinite(to) ? IDBKeyRange.bound(from, to, true, false) : IDBKeyRange.lowerBound(from, true);
  return run('readonly', store => store.index('t').getAll(range));
}

export function countRecords(){ return run('readonly', store => store.count()); }

/* Deletes records older than `before` (ms). */
export function pruneRecords(before){
  return run('readwrite', store => {
    const req = store.index('t').openCursor(IDBKeyRange.upperBound(before));
    req.onsuccess = () => { const c = req.result; if (c){ c.delete(); c.continue(); } };
  });
}

export function clearRecords(){ return run('readwrite', store => store.clear()); }
