import { clearStoredAccountExportRecords, clearStoredAccountScanRecords } from '../storage/storageService.js';

/** Reset only export skip history for the selected account. */
export function clearLocalExportRecords(accountId: string): Promise<void> {
    return clearStoredAccountExportRecords(accountId);
}
/** Reset trusted scan boundaries and export skip history together. */
export function clearLocalScanRecords(accountId: string): Promise<void> {
    return clearStoredAccountScanRecords(accountId);
}
