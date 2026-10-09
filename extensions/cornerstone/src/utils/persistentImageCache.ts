/**
 * Persistent (cross-reload) image cache in IndexedDB, so reopening a study or
 * reloading the page serves pixels from disk instead of the network.
 *
 * - Size-limited with least-recently-used eviction (and capped by browser quota).
 * - Entries expire after `maxAgeDays`.
 * - Partitioned by signed-in user: if a different user signs in on the same
 *   device, everything is wiped. Sign-out also clears it (window.clearOhifImageCache).
 * - Any IndexedDB failure (private mode, quota, blocked) disables the cache and
 *   loading falls back to the network transparently.
 */

import { isUnderMemoryPressure } from './memoryPressure';

type PersistentImageCacheConfig = {
  enabled?: boolean;
  maxSizeMB?: number;
  maxAgeDays?: number;
};

type MetaEntry = {
  key: string;
  size: number;
  lastAccess: number;
  createdAt: number;
};

const DB_NAME = 'ohif-image-cache';
const DB_VERSION = 1;
const META_STORE = 'meta';
const DATA_STORE = 'data';
const OWNER_STORAGE_KEY = 'ohif-image-cache-owner';
const DELETED_STORAGE_KEY = 'ohif-image-cache-deleted';
const DEFAULT_MAX_SIZE_MB = 1024;
const DEFAULT_MAX_AGE_DAYS = 7;
/** Max share of the browser's storage quota the cache may use. */
const MAX_QUOTA_FRACTION = 0.5;
/** Evict down to this fraction of the limit so we do not evict on every write. */
const EVICT_TARGET_FRACTION = 0.9;
/** Skip rewriting lastAccess on every read; LRU only needs coarse timestamps. */
const ACCESS_TOUCH_INTERVAL_MS = 60_000;
/**
 * Auth / signed-URL params change per session but never change the pixels.
 * Dropped from the key so the same frame hits the cache after re-login.
 */
const VOLATILE_QUERY_PARAM =
  /^(token|access_token|accesstoken|auth|authorization|jwt|sig|signature|se|st|sp|sv|sr|spr|skoid|sktid|skt|ske|sks|skv|expires|x-amz-.+)$/i;

let enabled = false;
let maxBytes = DEFAULT_MAX_SIZE_MB * 1024 * 1024;
let maxAgeMs = DEFAULT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
let totalBytes = 0;
let dbPromise: Promise<IDBDatabase | null> | null = null;
let readyPromise: Promise<void> = Promise.resolve();
let evicting = false;

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function disable(reason: unknown): void {
  if (enabled) {
    console.warn('[persistentImageCache] disabled:', reason);
  }
  enabled = false;
}

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise(resolve => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: 'key' }).createIndex(
            'lastAccess',
            'lastAccess'
          );
        }
        if (!db.objectStoreNames.contains(DATA_STORE)) {
          db.createObjectStore(DATA_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        disable(request.error);
        resolve(null);
      };
      request.onblocked = () => {
        disable('IndexedDB open blocked');
        resolve(null);
      };
    } catch (error) {
      disable(error);
      resolve(null);
    }
  });

  return dbPromise;
}

function hashString(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

function readCookie(name: string): string | null {
  const match = document.cookie
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(`${name}=`));

  return match ? decodeURIComponent(match.substring(name.length + 1)) : null;
}

function decodeJwtSubject(token: string | null): string | null {
  const payload = token?.split('.')?.[1];

  if (!payload) {
    return null;
  }

  try {
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    const subject =
      json.sub ?? json.email ?? json.preferred_username ?? json.userId ?? json.uid ?? json.nameid;
    return subject != null ? String(subject) : null;
  } catch {
    return null;
  }
}

/** Hashed identity of the signed-in user (doctor or patient), or null if unknown. */
function getCurrentOwner(): string | null {
  const win = window as unknown as { getViewerAccessBearerToken?: () => string | null };
  const tokens = [
    typeof win.getViewerAccessBearerToken === 'function' ? win.getViewerAccessBearerToken() : null,
    readCookie('token'),
    readCookie('patientToken'),
    readCookie('accessToken'),
    readCookie('authToken'),
    readCookie('jwt'),
  ];

  for (const token of tokens) {
    const subject = decodeJwtSubject(token);
    if (subject) {
      return hashString(subject);
    }
  }

  return null;
}

async function clearAllEntries(db: IDBDatabase): Promise<void> {
  const tx = db.transaction([META_STORE, DATA_STORE], 'readwrite');
  tx.objectStore(META_STORE).clear();
  tx.objectStore(DATA_STORE).clear();
  await transactionDone(tx);
  totalBytes = 0;
}

async function deleteEntries(db: IDBDatabase, entries: MetaEntry[]): Promise<void> {
  if (!entries.length) {
    return;
  }

  const tx = db.transaction([META_STORE, DATA_STORE], 'readwrite');
  const meta = tx.objectStore(META_STORE);
  const data = tx.objectStore(DATA_STORE);
  entries.forEach(entry => {
    meta.delete(entry.key);
    data.delete(entry.key);
  });
  await transactionDone(tx);
  entries.forEach(entry => {
    totalBytes = Math.max(0, totalBytes - entry.size);
  });
}

/** Drop expired entries, recompute total size, then evict least-recently-used over the limit. */
async function sweep(db: IDBDatabase): Promise<void> {
  const all = await requestToPromise<MetaEntry[]>(
    db.transaction(META_STORE, 'readonly').objectStore(META_STORE).getAll()
  );
  const cutoff = Date.now() - maxAgeMs;
  const expired = all.filter(entry => entry.createdAt < cutoff);
  const live = all.filter(entry => entry.createdAt >= cutoff);

  totalBytes = all.reduce((sum, entry) => sum + (entry.size || 0), 0);
  await deleteEntries(db, expired);
  await evictIfNeeded(db, live);
}

async function evictIfNeeded(db: IDBDatabase, knownEntries?: MetaEntry[]): Promise<void> {
  if (evicting || totalBytes <= maxBytes) {
    return;
  }

  evicting = true;

  try {
    const entries =
      knownEntries ??
      (await requestToPromise<MetaEntry[]>(
        db.transaction(META_STORE, 'readonly').objectStore(META_STORE).getAll()
      ));
    const target = maxBytes * EVICT_TARGET_FRACTION;
    const oldestFirst = [...entries].sort((a, b) => a.lastAccess - b.lastAccess);
    const toDelete: MetaEntry[] = [];
    let projected = totalBytes;

    for (const entry of oldestFirst) {
      if (projected <= target) {
        break;
      }
      toDelete.push(entry);
      projected -= entry.size || 0;
    }

    await deleteEntries(db, toDelete);
  } finally {
    evicting = false;
  }
}

async function applyQuotaLimit(configuredMaxBytes: number): Promise<void> {
  maxBytes = configuredMaxBytes;

  try {
    const estimate = await navigator.storage?.estimate?.();
    if (estimate?.quota) {
      maxBytes = Math.min(configuredMaxBytes, Math.floor(estimate.quota * MAX_QUOTA_FRACTION));
    }
  } catch {
    // Keep configured limit.
  }
}

/** Caching was switched off: drop what earlier builds stored, once per browser. */
function deleteStoredCacheOnce(): void {
  try {
    if (localStorage.getItem(DELETED_STORAGE_KEY) === '1') {
      return;
    }
    localStorage.setItem(DELETED_STORAGE_KEY, '1');
    localStorage.removeItem(OWNER_STORAGE_KEY);
    indexedDB.deleteDatabase(DB_NAME);
  } catch {
    // Storage unavailable.
  }
}

function initPersistentImageCache(config: PersistentImageCacheConfig = {}): void {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
    enabled = false;
    return;
  }

  if (config.enabled !== true) {
    enabled = false;
    deleteStoredCacheOnce();
    return;
  }

  try {
    localStorage.removeItem(DELETED_STORAGE_KEY);
  } catch {
    // Storage unavailable.
  }

  enabled = true;
  maxAgeMs = Math.max(1, Number(config.maxAgeDays) || DEFAULT_MAX_AGE_DAYS) * 24 * 60 * 60 * 1000;
  const configuredMaxBytes =
    Math.max(64, Number(config.maxSizeMB) || DEFAULT_MAX_SIZE_MB) * 1024 * 1024;

  (window as unknown as { clearOhifImageCache?: () => Promise<void> }).clearOhifImageCache =
    clearPersistentImageCache;

  // Reads/writes wait for this so a new user never sees entries before the owner check wipes them.
  readyPromise = (async () => {
    const db = await openDb();
    if (!db) {
      return;
    }

    try {
      await applyQuotaLimit(configuredMaxBytes);

      const owner = getCurrentOwner();
      const previousOwner = localStorage.getItem(OWNER_STORAGE_KEY);

      if (owner && previousOwner && owner !== previousOwner) {
        await clearAllEntries(db);
      }
      if (owner) {
        localStorage.setItem(OWNER_STORAGE_KEY, owner);
      }

      await sweep(db);
    } catch (error) {
      disable(error);
    }
  })();
}

function isPersistentImageCacheEnabled(): boolean {
  return enabled;
}

function toPersistentImageCacheKey(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') {
    return null;
  }

  try {
    const parsed = new URL(url, window.location.href);
    Array.from(parsed.searchParams.keys()).forEach(name => {
      if (VOLATILE_QUERY_PARAM.test(name)) {
        parsed.searchParams.delete(name);
      }
    });
    parsed.searchParams.sort();
    return `${parsed.origin}${parsed.pathname}?${parsed.searchParams.toString()}`;
  } catch {
    return url;
  }
}

async function getPersistentCachedBlob(key: string | null): Promise<Blob | null> {
  if (!enabled || !key) {
    return null;
  }

  await readyPromise;
  const db = await openDb();
  if (!db || !enabled) {
    return null;
  }

  try {
    const tx = db.transaction([META_STORE, DATA_STORE], 'readonly');
    const [meta, data] = await Promise.all([
      requestToPromise<MetaEntry | undefined>(tx.objectStore(META_STORE).get(key)),
      requestToPromise<Blob | undefined>(tx.objectStore(DATA_STORE).get(key)),
    ]);

    if (!meta || !(data instanceof Blob)) {
      return null;
    }

    const now = Date.now();

    if (meta.createdAt < now - maxAgeMs) {
      void deleteEntries(db, [meta]).catch(() => undefined);
      return null;
    }

    if (now - meta.lastAccess > ACCESS_TOUCH_INTERVAL_MS) {
      const touchTx = db.transaction(META_STORE, 'readwrite');
      touchTx.objectStore(META_STORE).put({ ...meta, lastAccess: now });
      void transactionDone(touchTx).catch(() => undefined);
    }

    return data;
  } catch {
    return null;
  }
}

async function getPersistentCachedArrayBuffer(key: string | null): Promise<ArrayBuffer | null> {
  const blob = await getPersistentCachedBlob(key);

  if (!blob) {
    return null;
  }

  try {
    return await blob.arrayBuffer();
  } catch {
    return null;
  }
}

async function setPersistentCachedImage(
  key: string | null,
  value: Blob | ArrayBuffer | null | undefined
): Promise<void> {
  if (!enabled || !key || !value || isUnderMemoryPressure()) {
    return;
  }

  const blob = value instanceof Blob ? value : new Blob([value]);

  if (!blob.size || blob.size > maxBytes * 0.25) {
    return;
  }

  await readyPromise;
  const db = await openDb();
  if (!db || !enabled) {
    return;
  }

  try {
    const tx = db.transaction([META_STORE, DATA_STORE], 'readwrite');
    const metaStore = tx.objectStore(META_STORE);
    const previous = await requestToPromise<MetaEntry | undefined>(metaStore.get(key));
    const now = Date.now();

    metaStore.put({ key, size: blob.size, lastAccess: now, createdAt: now } as MetaEntry);
    tx.objectStore(DATA_STORE).put(blob, key);
    await transactionDone(tx);

    totalBytes += blob.size - (previous?.size ?? 0);
    await evictIfNeeded(db);
  } catch (error) {
    if ((error as DOMException)?.name === 'QuotaExceededError') {
      // Free a chunk and keep going; a full disk should not break viewing.
      maxBytes = Math.max(64 * 1024 * 1024, Math.floor(totalBytes * 0.8));
      void evictIfNeeded(db).catch(() => undefined);
      return;
    }
    disable(error);
  }
}

async function clearPersistentImageCache(): Promise<void> {
  try {
    localStorage.removeItem(OWNER_STORAGE_KEY);
  } catch {
    // Storage unavailable.
  }

  const db = await openDb();
  if (!db) {
    return;
  }

  try {
    await clearAllEntries(db);
  } catch (error) {
    console.warn('[persistentImageCache] clear failed:', error);
  }
}

export {
  clearPersistentImageCache,
  getPersistentCachedArrayBuffer,
  getPersistentCachedBlob,
  initPersistentImageCache,
  isPersistentImageCacheEnabled,
  setPersistentCachedImage,
  toPersistentImageCacheKey,
};
export type { PersistentImageCacheConfig };
