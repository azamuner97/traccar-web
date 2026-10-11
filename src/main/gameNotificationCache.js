// Only the new authenticated journal is stored here. No localStorage migration.
export const createGameNotificationCache = (getDatabase = () => window.indexedDB) => {
  const memory = new Map();
  const writes = new Map();
  let opening;
  const database = () => {
    if (!opening)
      opening = new Promise((resolve) => {
        try {
          const request = getDatabase()?.open('traccarToolGameNotifications', 1);
          if (!request) {
            resolve(null);
            return;
          }
          request.onupgradeneeded = () => request.result.createObjectStore('histories');
          request.onsuccess = () => {
            request.result.onversionchange = () => request.result.close();
            resolve(request.result);
          };
          request.onerror = () => resolve(null);
          request.onblocked = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    return opening;
  };
  const load = async (key) => {
    if (memory.has(key)) return structuredClone(memory.get(key));
    const db = await database();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const transaction = db.transaction('histories', 'readonly');
        const request = transaction.objectStore('histories').get(key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => resolve(null);
        transaction.onabort = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  };
  const save = (key, state) => {
    const snapshot = structuredClone(state);
    memory.set(key, snapshot);
    const next = (writes.get(key) || Promise.resolve())
      .then(async () => {
        const db = await database();
        if (!db) return;
        await new Promise((resolve) => {
          try {
            const transaction = db.transaction('histories', 'readwrite');
            transaction.objectStore('histories').put(snapshot, key);
            transaction.oncomplete = resolve;
            transaction.onerror = resolve;
            transaction.onabort = resolve;
          } catch {
            resolve();
          }
        });
      })
      .catch(() => {});
    writes.set(key, next);
    return next;
  };
  const remove = (key) => {
    memory.delete(key);
    const next = (writes.get(key) || Promise.resolve())
      .then(async () => {
        const db = await database();
        if (!db) return;
        await new Promise((resolve) => {
          try {
            const transaction = db.transaction('histories', 'readwrite');
            transaction.objectStore('histories').delete(key);
            transaction.oncomplete = resolve;
            transaction.onerror = resolve;
            transaction.onabort = resolve;
          } catch {
            resolve();
          }
        });
      })
      .catch(() => {});
    writes.set(key, next);
    return next;
  };
  return { load, save, remove, flush: () => Promise.all(writes.values()) };
};
export const gameNotificationCache = createGameNotificationCache();
