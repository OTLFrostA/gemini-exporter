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
function mergeRecordFolderBaseName(record: ExportRecord, current: unknown): ExportRecord {
    return isRecord(record) && record.folderBaseName === undefined
        && isRecord(current) && typeof current.folderBaseName === 'string' && current.folderBaseName
        ? { ...record, folderBaseName: current.folderBaseName }
        : record;
}

export interface ExportRecordBatchEntry {
    readonly key: ConversationKey;
    readonly record: ExportRecord;
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
                const merged = mergeRecordFolderBaseName(record, current);
                store.put({ ...key, value: merged });
                done(undefined);
            } catch (error) { fail(error); }
        };
    });
}

/** Atomically write multiple ExportRecords in a single IDB transaction while preserving existing folderBaseNames. */
export function putExportRecords(entries: readonly ExportRecordBatchEntry[]): Promise<void> {
    if (entries.length === 0) return Promise.resolve();
    if (entries.length === 1) return putExportRecord(entries[0].key, entries[0].record);
    return inStores<void>(['exportRecords'], 'readwrite', (tx, done, fail) => {
        const store = tx.objectStore('exportRecords');
        const uniqueKeys = new Map<string, ConversationKey>();
        for (const entry of entries) {
            const id = JSON.stringify(conversationAddress(entry.key));
            if (!uniqueKeys.has(id)) uniqueKeys.set(id, entry.key);
        }
        const currentByKey = new Map<string, unknown>();
        let remaining = uniqueKeys.size;
        const settle = () => {
            if (--remaining !== 0) return;
            try {
                const staged = new Map<string, { key: ConversationKey; value: ExportRecord }>();
                for (const entry of entries) {
                    const id = JSON.stringify(conversationAddress(entry.key));
                    const previous = staged.get(id)?.value ?? currentByKey.get(id);
                    const merged = mergeRecordFolderBaseName(entry.record, previous);
                    staged.set(id, { key: entry.key, value: merged });
                }
                for (const { key, value } of staged.values()) {
                    store.put({ ...key, value });
                }
                done(undefined);
            } catch (error) { fail(error); }
        };
        for (const [id, key] of uniqueKeys) {
            const request = store.get(conversationAddress(key));
            request.onsuccess = () => {
                const rawRow: unknown = request.result;
                currentByKey.set(id, isRecord(rawRow) ? rawRow.value : undefined);
                settle();
            };
        }
    });
}
/** Remove only this account's export history in one transaction. */
export function clearStoredAccountExportRecords(accountId: Account['id']): Promise<void> {
    return inStore('exportRecords', 'readwrite', store => {
        store.delete(IDBKeyRange.bound([accountId], [accountId, []]));
    });
}
