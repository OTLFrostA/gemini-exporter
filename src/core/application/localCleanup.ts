import type { ConversationKey } from '../domain/conversationKey.js';
import { deleteExportRecord, deleteDetail, deleteIndex, listExportRecords,
    clearStoredAccountData } from '../storage/storageService.js';

/** Explicit user cleanup only. Keep the Index visible until dependent deletes succeed. */
export async function deleteLocalConversations(keys: readonly ConversationKey[]): Promise<void> {
    for (const key of keys) {
        await deleteExportRecord(key);
        await deleteDetail(key);
        await deleteIndex(key);
    }
}
export async function clearLocalExportRecords(accountId: string): Promise<void> {
    for (const conversationId of Object.keys(await listExportRecords(accountId))) {
        await deleteExportRecord({ accountId, conversationId });
    }
}
export function clearLocalAccountData(accountId: string): Promise<void> {
    return clearStoredAccountData(accountId);
}
