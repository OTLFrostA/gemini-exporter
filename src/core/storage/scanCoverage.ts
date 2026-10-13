import type { ScanStatus } from '../../types/ui.js';
import type { StreamCoverage } from '../sync/streamCoverage.js';
export interface ScanCoverageBaseline { headTimestamp: number | null; conversationCount: number }
export interface ScanCoverage {
    version: 3;
    providerId: string;
    revision: number;
    generation: string;
    resetAt: number;
    accountId: string | null;
    initialized: boolean;
    historyComplete: boolean;
    streams: Record<string, StreamCoverage>;
    /** Compatibility diagnostics only; never used as trusted coverage evidence. */
    complete: boolean;
    baseline: ScanCoverageBaseline | null;
    lastStatus: ScanStatus | null;
    activeRunId: string | null;
}
export interface ScanCoverageRun { runId: string; previous: ScanCoverage | null }
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function key(value: unknown): boolean { return object(value) && typeof value.id === 'string' && value.id.length >= 3
    && typeof value.time === 'number' && Number.isFinite(value.time) && value.time > 0; }
export function readScanCoverage(value: unknown): ScanCoverage | null {
    // Earlier versions cannot prove per-stream ordering or passive coverage.
    if (!object(value) || value.version !== 3 || !Number.isSafeInteger(value.revision)
        || typeof value.revision !== 'number' || value.revision < 1 || typeof value.providerId !== 'string'
        || typeof value.generation !== 'string' || !value.generation || typeof value.resetAt !== 'number'
        || !Number.isFinite(value.resetAt) || value.resetAt < 0
        || !(value.accountId === null || typeof value.accountId === 'string' && value.accountId.length > 0)
        || !(value.activeRunId === null || typeof value.activeRunId === 'string' && value.activeRunId.length > 0)
        || typeof value.initialized !== 'boolean' || typeof value.historyComplete !== 'boolean'
        || typeof value.complete !== 'boolean' || !object(value.streams)
        || !['complete', 'up_to_date', 'partial_limit', 'aborted', 'error', null].includes(value.lastStatus as string | null)) return null;
    for (const stream of Object.values(value.streams)) {
        if (!object(stream) || typeof stream.initialized !== 'boolean' || typeof stream.historyComplete !== 'boolean'
            || !(stream.range === null || object(stream.range) && key(stream.range.head) && key(stream.range.tail)
                && (stream.range.head as { time: number }).time >= (stream.range.tail as { time: number }).time)
            || !stream.initialized && (stream.historyComplete || stream.range !== null)) return null;
        if (stream.orderingInvalidated !== undefined && stream.orderingInvalidated !== true
            || stream.orderingInvalidated === true && stream.range !== null) return null;
    }
    if (value.complete !== value.historyComplete || value.historyComplete && !value.initialized) return null;
    const baseline = value.baseline;
    if (baseline !== null && (!object(baseline) || typeof baseline.conversationCount !== 'number'
        || !Number.isSafeInteger(baseline.conversationCount) || baseline.conversationCount < 0
        || !(baseline.headTimestamp === null || typeof baseline.headTimestamp === 'number'
            && Number.isFinite(baseline.headTimestamp) && baseline.headTimestamp > 0))) return null;
    return value as unknown as ScanCoverage;
}
