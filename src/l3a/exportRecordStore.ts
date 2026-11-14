import type { Account } from '../l2/accountRegistry.js';
import type { ConversationKey } from '../l2/conversationKey.js';
import type { ExportRecord } from '../l2/exportRecord.js';
import { isRecord } from '../shared/utils/typeGuards.js';
import { inStore, inStores, readOne } from './idb.js';
import { conversationAddress } from './conversationStore.js';

export async function getExportRecord(key: ConversationKey): Promise<ExportRecord | null> {
    return (await readOne('exportRecords', conversationAddress(key)))?.value ?? null;
}
export function listExportRecords(accountId: Account['id']): Promise<Record<string, ExportRecord>> {
    return inStore('exportRecords', 'readonly', (store, done) => {
        const request = store.getAll(IDBKeyRange.bound([accountId], [accountId, []]));
        request.onsuccess = () => {
            done(Object.fromEntries(request.result.map(row => [row.conversationId, row.value])));
        };
    });
}
/** Atomically write ExportRecord while preserving an existing folderBaseName when a browserDownload export omits it. */
export function putExportRecord(key: ConversationKey, record: ExportRecord): Promise<void> {
    return inStores<void>(['exportRecords'], 'readwrite', (tx, done, fail) => {
        const store = tx.objectStore('exportRecords');
        const request = store.get(conversationAddress(key));
        request.onsuccess = () => {
            try {
                const rawRow: unknown = request.result;
                const current: unknown = isRecord(rawRow) ? rawRow.value : undefined;
                const merged: ExportRecord = isRecord(record) && record.folderBaseName === undefined
                    && isRecord(current) && typeof current.folderBaseName === 'string' && current.folderBaseName
                    ? { ...record, folderBaseName: current.folderBaseName }
                    : record;
                store.put({ ...key, value: merged });
                done(undefined);
            } catch (error) { fail(error); }
        };
    });
}
/** Remove only this account's export history in one transaction. */
export function clearStoredAccountExportRecords(accountId: Account['id']): Promise<void> {
    return inStore('exportRecords', 'readwrite', store => {
        store.delete(IDBKeyRange.bound([accountId], [accountId, []]));
    });
}
