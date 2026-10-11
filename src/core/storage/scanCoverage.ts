import type { ScanStatus } from '../../types/ui.js';

/** Observed list coverage is independent of the conversation cache and passive captures. */
export interface ScanCoverageBaseline {
    headTimestamp: number | null;
    conversationCount: number;
}
export interface ScanCoverage {
    version: 2;
    revision: number;
    accountId: string | null;
    complete: boolean;
    baseline: ScanCoverageBaseline | null;
    lastStatus: ScanStatus | null;
    activeRunId: string | null;
}
export interface ScanCoverageRun {
    runId: string;
    previous: ScanCoverage | null;
}

function object(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function nullableString(value: unknown): value is string | null {
    return value === null || (typeof value === 'string' && value.length > 0);
}
export function readScanCoverage(value: unknown): ScanCoverage | null {
    // Version 1 only covered the recent chain and cannot certify all cloud chats.
    if (!object(value) || value.version !== 2 || !Number.isSafeInteger(value.revision)
        || typeof value.revision !== 'number' || value.revision < 1
        || !nullableString(value.accountId) || !nullableString(value.activeRunId)
        || typeof value.complete !== 'boolean') return null;
    const statuses: readonly unknown[] = ['complete', 'up_to_date', 'partial_limit', 'aborted', 'error', null];
    if (!statuses.includes(value.lastStatus)) return null;
    const baseline = value.baseline;
    if (baseline !== null && (!object(baseline) || !Number.isSafeInteger(baseline.conversationCount)
        || typeof baseline.conversationCount !== 'number' || baseline.conversationCount < 0
        || !(baseline.headTimestamp === null || (typeof baseline.headTimestamp === 'number'
            && Number.isFinite(baseline.headTimestamp) && baseline.headTimestamp > 0)))) return null;
    if (value.complete && baseline === null) return null;
    return value as unknown as ScanCoverage;
}
