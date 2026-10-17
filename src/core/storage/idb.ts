export const DATABASE_NAME = 'gemini_exporter_v2';
export const DATABASE_VERSION = 1;

/** Call from an extension-origin context. Browser Runtime owns IPC routing. */
export function openStorageDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            db.createObjectStore('accounts', { keyPath: 'id' })
                .createIndex('providerIdentity', ['providerId', 'providerAccountId'], { unique: true });
            db.createObjectStore('indexes', { keyPath: ['key.accountId', 'key.conversationId'] })
                .createIndex('byAccount', 'key.accountId');
            db.createObjectStore('details', { keyPath: ['key.accountId', 'key.conversationId'] });
            db.createObjectStore('coverage', { keyPath: ['accountId', 'streamId'] });
            db.createObjectStore('exportRecords', { keyPath: ['accountId', 'conversationId'] })
                .createIndex('byAccount', 'accountId');
            db.createObjectStore('directoryHandles');
        };
        request.onsuccess = () => {
            const db = request.result;
            db.onversionchange = () => db.close();
            resolve(db);
        };
        request.onerror = () => reject(request.error);
    });
}

/** Resolve only after commit, including for reads. Request errors abort the transaction. */
export async function inStore<T = void>(name: string, mode: IDBTransactionMode,
    run: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
    const db = await openStorageDB();
    try {
        return await new Promise<T>((resolve, reject) => {
            const tx = db.transaction(name, mode);
            let value: T;
            tx.oncomplete = () => resolve(value);
            tx.onabort = () => reject(tx.error ?? new Error('Storage transaction aborted'));
            try { run(tx.objectStore(name), result => { value = result; }); }
            catch (error) { tx.abort(); reject(error); }
        });
    } finally { db.close(); }
}

export function readOne<T>(store: string, key: IDBValidKey): Promise<T | null> {
    return inStore<T | null>(store, 'readonly', (table, done) => {
        const request = table.get(key);
        request.onsuccess = () => done(request.result ?? null);
    });
}
export function putOne(store: string, value: unknown, key?: IDBValidKey): Promise<void> {
    return inStore(store, 'readwrite', table => { table.put(value, key); });
}
export function deleteOne(store: string, key: IDBValidKey): Promise<void> {
    return inStore(store, 'readwrite', table => { table.delete(key); });
}
