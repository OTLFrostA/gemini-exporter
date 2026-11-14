import { notifyDomainChanged } from '../runtime/api/domainChanges.js';
import CoverageAdmission from '../l2/coverageAdmission.js';
import { clearStoredAccountExportRecords, clearStoredAccountScanRecords } from '../l3a/storageService.js';

export async function clearLocalExportRecords(accountId: string): Promise<void> {
    await clearStoredAccountExportRecords(accountId);
    notifyDomainChanged(accountId);
}
export async function clearLocalScanRecords(accountId: string): Promise<void> {
    await clearStoredAccountScanRecords(accountId);
    CoverageAdmission.resetAccountCoverage(accountId);
    notifyDomainChanged(accountId);
}
