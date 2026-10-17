import type { Account } from '../domain/accountRegistry.js';
import type { ConversationKey } from '../domain/conversationKey.js';
import type { ExportRecord } from '../application/export/types.js';
import { inStore, readOne, putOne, deleteOne } from './idb.js';
import { conversationAddress } from './conversationStore.js';

interface ExportRow { accountId: string; conversationId: string; value: ExportRecord }
export async function getExportRecord(key: ConversationKey): Promise<ExportRecord | null> {
    return (await readOne<ExportRow>('exportRecords', conversationAddress(key)))?.value ?? null;
}
export function listExportRecords(accountId: Account['id']): Promise<Record<string, ExportRecord>> {
    return inStore<Record<string, ExportRecord>>('exportRecords', 'readonly', (store, done) => {
        const request = store.index('byAccount').getAll(accountId);
        request.onsuccess = () => {
            const rows: ExportRow[] = request.result;
            done(Object.fromEntries(rows.map(row => [row.conversationId, row.value])));
        };
    });
}
export function putExportRecord(key: ConversationKey, record: ExportRecord): Promise<void> {
    return putOne('exportRecords', { ...key, value: record });
}
export function deleteExportRecord(key: ConversationKey): Promise<void> {
    return deleteOne('exportRecords', conversationAddress(key));
}
