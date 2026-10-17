import { isAccountId } from '../../domain/accountRegistry.js';
import CoverageAdmission from '../../domain/coverageAdmission.js';
import type { StreamCoverage } from '../../domain/streamCoverage.js';
import type { ScanStatus } from '../../../types/ui.js';
export interface ScanRun { runId: string; previous: StreamCoverage | null }
const activeRuns = new Map<string, string>();
/** Scan ownership is runtime state, never a persisted Domain coverage field. */
export async function beginScanCoverage(accountId: string, identity: string | null): Promise<ScanRun> {
    if (!isAccountId(identity) || identity !== accountId) throw new TypeError('Scan requires its Registry UUID');
    const previous = await CoverageAdmission.getCoverage(accountId, 'recent');
    const runId = crypto.randomUUID();
    activeRuns.set(accountId, runId);
    return { runId, previous: previous ? structuredClone(previous) : null };
}
export async function isScanCoverageCurrent(accountId: string, runId: string): Promise<boolean> {
    return activeRuns.get(accountId) === runId;
}
export async function finishScanCoverage(accountId: string, runId: string, _status: ScanStatus,
    canCommit?: () => boolean): Promise<boolean> {
    if (activeRuns.get(accountId) !== runId || canCommit?.() === false) return false;
    activeRuns.delete(accountId);
    return true;
}
const ScanLifecycle = { beginScanCoverage, isScanCoverageCurrent, finishScanCoverage };
export default ScanLifecycle;
