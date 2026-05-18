/**
 * Cache offline pour previews d'attachments via IndexedDB native (sans dep).
 *
 * Strategie LRU (Last Recently Used) avec cap 100 MB total. Permet de
 * relire un PDF/image deja consulte sans reseau (utile chantier 3G faible).
 *
 * Architecture :
 * - DB: constructo-attachments
 * - Store: previews (keyPath: id)
 * - Index: lastAccessed (pour eviction LRU)
 *
 * Limitation : eviction approximative — on iter sur les entries triees par
 * lastAccessed et on supprime jusqu'a passer sous le seuil. Pas optimal pour
 * tres gros caches mais OK pour usage mobile.
 */

const DB_NAME = 'constructo-attachments';
const DB_VERSION = 1;
const STORE_NAME = 'previews';
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024; // 100 MB

interface CacheEntry {
  id: number;
  mimeType: string;
  sizeBytes: number;
  blob: Blob;
  lastAccessed: number; // epoch ms
  cachedAt: number;
}

let _dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB non supporte'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('lastAccessed', 'lastAccessed');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        const result = fn(store);
        if (result instanceof IDBRequest) {
          result.onsuccess = () => resolve(result.result as T);
          result.onerror = () => reject(result.error);
        } else {
          // Promise (custom logic) — laisser fn gerer
          result.then(resolve, reject);
        }
        tx.onerror = () => reject(tx.error);
      }),
  );
}

export async function getCachedBlob(id: number): Promise<Blob | null> {
  try {
    const entry = await withStore<CacheEntry | undefined>('readonly', (store) =>
      store.get(id) as IDBRequest<CacheEntry | undefined>,
    );
    if (!entry) return null;

    // Update lastAccessed (best effort, sans bloquer le caller)
    void withStore<void>('readwrite', (store) => {
      const updated: CacheEntry = { ...entry, lastAccessed: Date.now() };
      return store.put(updated) as unknown as IDBRequest<void>;
    });

    return entry.blob;
  } catch {
    return null; // Gracieux : cache fail = pas de cache
  }
}

export async function cacheBlob(
  id: number,
  blob: Blob,
  mimeType: string,
  maxBytes: number = DEFAULT_MAX_BYTES,
): Promise<void> {
  try {
    const entry: CacheEntry = {
      id,
      mimeType,
      sizeBytes: blob.size,
      blob,
      lastAccessed: Date.now(),
      cachedAt: Date.now(),
    };
    await withStore<void>('readwrite', (store) => store.put(entry) as unknown as IDBRequest<void>);
    // Eviction LRU asynchrone (ne pas bloquer le caller)
    void evictIfOversize(maxBytes);
  } catch {
    // Ignore (quota exceeded, private mode, etc.)
  }
}

export async function deleteCached(id: number): Promise<void> {
  try {
    await withStore<void>('readwrite', (store) => store.delete(id) as unknown as IDBRequest<void>);
  } catch {
    // ignore
  }
}

async function evictIfOversize(maxBytes: number): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('lastAccessed');

    // Compter le total
    let totalBytes = 0;
    const entries: CacheEntry[] = [];
    await new Promise<void>((resolve, reject) => {
      const req = index.openCursor(); // ordre ASC lastAccessed (LRU first)
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const value = cursor.value as CacheEntry;
          totalBytes += value.sizeBytes;
          entries.push(value);
          cursor.continue();
        } else {
          resolve();
        }
      };
      req.onerror = () => reject(req.error);
    });

    if (totalBytes <= maxBytes) return;

    // Supprimer du plus ancien au plus recent jusqu'a passer sous le seuil
    let target = totalBytes - maxBytes;
    for (const entry of entries) {
      if (target <= 0) break;
      await new Promise<void>((resolve, reject) => {
        const req = store.delete(entry.id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
      target -= entry.sizeBytes;
    }
  } catch {
    // ignore — cache best effort
  }
}

export async function clearCache(): Promise<void> {
  try {
    await withStore<void>('readwrite', (store) => store.clear() as unknown as IDBRequest<void>);
  } catch {
    // ignore
  }
}
