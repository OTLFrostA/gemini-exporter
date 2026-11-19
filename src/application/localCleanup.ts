import { applicationHost } from './host.js';
import CoverageAdmission from '../l2/coverageAdmission.js';
import { clearStoredAccountExportRecords, clearStoredAccountScanRecords } from '../l3a/storageService.js';

export async function clearLocalExportRecords(accountId: string): Promise<void> {
    await clearStoredAccountExportRecords(accountId);
    applicationHost().notifyDomainChanged(accountId);
}
export async function clearLocalScanRecords(accountId: string): Promise<void> {
    await clearStoredAccountScanRecords(accountId);
    CoverageAdmission.resetAccountCoverage(accountId);
    applicationHost().notifyDomainChanged(accountId);
}
