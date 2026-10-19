import { deleteExportRecord, listExportRecords, clearStoredAccountCoverage } from '../storage/storageService.js';

export async function clearLocalExportRecords(accountId: string): Promise<void> {
    for (const conversationId of Object.keys(await listExportRecords(accountId))) {
        await deleteExportRecord({ accountId, conversationId });
    }
}
/** Reset scan progress and export skip history, preserving all archived conversations. */
export async function clearLocalScanRecords(accountId: string): Promise<void> {
    await clearStoredAccountCoverage(accountId);
    await clearLocalExportRecords(accountId);
}
