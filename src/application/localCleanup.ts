import { notifyDomainChanged } from '../runtime/api/domainChanges.js';
import { clearStoredAccountExportRecords, clearStoredAccountScanRecords } from '../l3a/storageService.js';

/** Reset only export skip history for the selected account. */
export async function clearLocalExportRecords(accountId: string): Promise<void> {
    await clearStoredAccountExportRecords(accountId);
    notifyDomainChanged(accountId);
}
/** Explicitly clear the selected account’s local conversations, scan coverage and export history. */
export async function clearLocalScanRecords(accountId: string): Promise<void> {
    await clearStoredAccountScanRecords(accountId);
    notifyDomainChanged(accountId);
}
