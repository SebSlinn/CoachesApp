// LocalResultsRepository.js — offline capture store for the Poolside App.
//
// The documented exception to "results are Supabase-only" (see
// ATHLETE-RECORDS-CONTEXT.md). Poolside writes captured swims here while offline;
// resultsSync flushes them to Supabase when online, deduping by client_uuid.
//
// Uses native IndexedDB — NO dependency to install. Everything degrades safely:
// if IndexedDB is unavailable (private mode, old webview), every method returns
// { data, error } with a clear error instead of throwing, so the caller can fall
// back to keeping records in memory for the session.
//
// Records are append-only and immutable, so two devices never conflict — the
// outbox only ever grows until flushed. A record's `id` is its client UUID and
// its dedup key everywhere.

const DB_NAME = 'swimzone-poolside';
const DB_VERSION = 1;
const STORE = 'outbox'; // keyPath 'id'; index 'flushed'

function hasIndexedDB() {
  try { return typeof indexedDB !== 'undefined' && indexedDB !== null; }
  catch { return false; }
}

/** RFC4122 v4, works without crypto.randomUUID on older webviews. */
export function newClientUuid() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* fall through */ }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (!hasIndexedDB()) return reject(new Error('IndexedDB unavailable'));
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); }
    catch (e) { return reject(e); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' });
        os.createIndex('flushed', 'flushed', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    try { result = fn(store); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error || new Error('IndexedDB tx failed'));
    t.onabort = () => reject(t.error || new Error('IndexedDB tx aborted'));
  });
}

function reqAsync(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const LocalResultsRepository = {
  available: hasIndexedDB(),

  /**
   * Store one captured record (swimzone.result/1 or swimzone.setresult/1) in the
   * outbox. Assigns id/client_uuid if missing. `athleteId` may be null (logged-out
   * capture — attribute later). Returns { data: envelope, error }.
   */
  async capture(record) {
    if (!hasIndexedDB()) return { data: null, error: new Error('offline store unavailable') };
    try {
      const id = record.id || newClientUuid();
      const envelope = {
        id,
        record: { ...record, id },
        athleteId: record.athleteId ?? null,
        flushed: 0,            // 0 = pending, 1 = flushed (IndexedDB can't index booleans reliably)
        capturedAt: new Date().toISOString(),
      };
      const db = await openDb();
      await tx(db, 'readwrite', (store) => store.put(envelope));
      db.close();
      return { data: envelope, error: null };
    } catch (error) { return { data: null, error }; }
  },

  /** All pending (unflushed) envelopes, oldest first. */
  async listPending() {
    if (!hasIndexedDB()) return { data: [], error: new Error('offline store unavailable') };
    try {
      const db = await openDb();
      const all = await tx(db, 'readonly', (store) => reqAsync(store.getAll()));
      db.close();
      const rows = (await all) || [];
      const pending = rows.filter((r) => !r.flushed)
        .sort((a, b) => (a.capturedAt < b.capturedAt ? -1 : 1));
      return { data: pending, error: null };
    } catch (error) { return { data: [], error }; }
  },

  /** Attribute a logged-out capture to a real athlete before flush. */
  async attribute(localId, athleteId) {
    if (!hasIndexedDB()) return { data: null, error: new Error('offline store unavailable') };
    try {
      const db = await openDb();
      const result = await tx(db, 'readwrite', async (store) => {
        const env = await reqAsync(store.get(localId));
        if (!env) throw new Error('capture not found: ' + localId);
        env.athleteId = athleteId;
        env.record = { ...env.record, athleteId };
        store.put(env);
        return env;
      });
      db.close();
      return { data: await result, error: null };
    } catch (error) { return { data: null, error }; }
  },

  /** Mark an envelope flushed (called by resultsSync after a successful post). */
  async markFlushed(localId) {
    if (!hasIndexedDB()) return { data: null, error: new Error('offline store unavailable') };
    try {
      const db = await openDb();
      await tx(db, 'readwrite', async (store) => {
        const env = await reqAsync(store.get(localId));
        if (env) { env.flushed = 1; env.flushedAt = new Date().toISOString(); store.put(env); }
      });
      db.close();
      return { data: true, error: null };
    } catch (error) { return { data: null, error }; }
  },

  /** Drop flushed envelopes older than `keepMs` (default 7 days). Housekeeping only. */
  async purgeFlushed(keepMs = 7 * 24 * 3600 * 1000) {
    if (!hasIndexedDB()) return { data: 0, error: null };
    try {
      const cutoff = Date.now() - keepMs;
      const db = await openDb();
      const n = await tx(db, 'readwrite', async (store) => {
        const rows = (await reqAsync(store.getAll())) || [];
        let removed = 0;
        for (const r of rows) {
          if (r.flushed && r.flushedAt && Date.parse(r.flushedAt) < cutoff) {
            store.delete(r.id); removed++;
          }
        }
        return removed;
      });
      db.close();
      return { data: await n, error: null };
    } catch (error) { return { data: 0, error }; }
  },
};

export default LocalResultsRepository;
