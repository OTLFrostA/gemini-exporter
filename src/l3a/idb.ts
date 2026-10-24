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
            db.createObjectStore('indexes', { keyPath: ['key.accountId', 'key.conversationId'] });
            db.createObjectStore('details', { keyPath: ['key.accountId', 'key.conversationId'] });
            db.createObjectStore('coverage', { keyPath: ['accountId', 'streamId'] });
            db.createObjectStore('exportRecords', { keyPath: ['accountId', 'conversationId'] });
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

/** Run synchronous IDB requests in one store-scoped transaction, resolving only after commit. */
export async function inStores<T = void>(names: readonly string[], mode: IDBTransactionMode,
    run: (tx: IDBTransaction, result: (value: T) => void, fail: (error: unknown) => void) => void): Promise<T> {
    const db = await openStorageDB();
    try {
        return await new Promise<T>((resolve, reject) => {
            const tx = db.transaction([...names], mode);
            let value: T, failure: unknown;
            const fail = (error: unknown) => {
                failure = error;
                try { tx.abort(); } catch { reject(error); }
            };
            tx.oncomplete = () => resolve(value);
            tx.onabort = () => reject(failure ?? tx.error ?? new Error('Storage transaction aborted'));
            try { run(tx, result => { value = result; }, fail); }
            catch (error) { fail(error); }
        });
    } finally { db.close(); }
}
export function inStore<T = void>(name: string, mode: IDBTransactionMode,
    run: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
    return inStores([name], mode, (tx, done) => run(tx.objectStore(name), done));
}

export function readOne<T>(store: string, key: IDBValidKey): Promise<T | null> {
    return inStore<T | null>(store, 'readonly', (table, done) => {
        const request = table.get(key);
        request.onsuccess = () => done(request.result ?? null);
    });
}
export function putOne(store: string, value: unknown, key?: IDBValidKey): Promise<void> {
    return inStore(store, 'readwrite', table => {
        // In-line keyPath stores require a value-only put; out-of-line stores use an explicit key.
        if (key === undefined) table.put(value);
        else table.put(value, key);
    });
}
