// src/minisite/album/albumIdb.js

import { ALBUM_PAGE_ASSET_DB as ASSET_DB, ALBUM_PAGE_ASSET_STORE as ASSET_STORE } from "./meta";

// NOTE: uses IndexedDB globals (browser only)

function openDb() {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(ASSET_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(ASSET_STORE)) db.createObjectStore(ASSET_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("indexedDB open failed"));
    } catch (e) {
      reject(e);
    }
  });
}

export async function idbSetBlob(key, blob) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(ASSET_STORE, "readwrite");
      const store = tx.objectStore(ASSET_STORE);
      store.put(blob, key);
      tx.oncomplete = () => {
        try {
          db.close();
        } catch {}
        resolve(true);
      };
      tx.onerror = () => {
        try {
          db.close();
        } catch {}
        reject(tx.error || new Error("indexedDB write failed"));
      };
    } catch (e) {
      try {
        db.close();
      } catch {}
      reject(e);
    }
  });
}

export async function idbGetBlob(key) {
  const db = await openDb();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(ASSET_STORE, "readonly");
      const store = tx.objectStore(ASSET_STORE);
      const req = store.get(key);
      req.onsuccess = () => {
        try {
          db.close();
        } catch {}
        resolve(req.result || null);
      };
      req.onerror = () => {
        try {
          db.close();
        } catch {}
        resolve(null);
      };
    } catch {
      try {
        db.close();
      } catch {}
      resolve(null);
    }
  });
}

export async function idbDelete(key) {
  const db = await openDb();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(ASSET_STORE, "readwrite");
      const store = tx.objectStore(ASSET_STORE);
      store.delete(key);
      tx.oncomplete = () => {
        try {
          db.close();
        } catch {}
        resolve(true);
      };
      tx.onerror = () => {
        try {
          db.close();
        } catch {}
        resolve(false);
      };
    } catch {
      try {
        db.close();
      } catch {}
      resolve(false);
    }
  });
}
