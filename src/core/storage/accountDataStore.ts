import type { Account } from '../domain/accountRegistry.js';
import { openStorageDB } from './idb.js';

/** Explicit physical account clear, including orphaned records and every stream. */
export async function clearStoredAccountData(accountId: Account['id']): Promise<void> {
    const db = await openStorageDB();
    const stores = ['indexes', 'details', 'exportRecords', 'coverage'];
    try {
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(stores, 'readwrite');
            tx.oncomplete = () => resolve();
            tx.onabort = () => reject(tx.error ?? new Error('Account clear transaction aborted'));
            for (const name of stores) {
                const request = tx.objectStore(name).openCursor();
                request.onsuccess = () => {
                    const cursor = request.result;
                    if (!cursor) return;
                    if (Array.isArray(cursor.primaryKey) && cursor.primaryKey[0] === accountId) cursor.delete();
                    cursor.continue();
                };
            }
        });
    } finally { db.close(); }
}
