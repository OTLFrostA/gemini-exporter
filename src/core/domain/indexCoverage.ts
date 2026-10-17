import { CoverageSession, emptyStream, type StreamCoverage } from './streamCoverage.js';
import type { PageObservation } from './pageObservation.js';
import type { ScanCoverage } from './scanCoverage.js';

const pageSessions = new Map<string, CoverageSession>();
const pageSessionKey = (slot: string, coverage: ScanCoverage, streamId: string) =>
    JSON.stringify([slot, coverage.generation, coverage.providerId, coverage.accountId, streamId]);

/** L2 owns trusted list coverage. Storage invokes this only after the page's indexes commit. */
export function advanceIndexCoverage<T>(accountId: string, current: ScanCoverage, page: PageObservation<T>,
    requireOrder: boolean, expectedStreams: readonly string[], runId?: string): ScanCoverage {
    const sessionKey = pageSessionKey(accountId, current, page.streamId);
    let session = pageSessions.get(sessionKey);
    if (!session) {
        session = new CoverageSession(); pageSessions.set(sessionKey, session);
        if (pageSessions.size > 64) pageSessions.delete(pageSessions.keys().next().value!);
    }
    const previous = current.streams[page.streamId] ?? emptyStream();
    const stream = session.observe(previous, page, requireOrder, runId !== undefined || current.activeRunId === null);
    if (stream === previous) return current;
    const streams = { ...current.streams, [page.streamId]: stream };
    const historyComplete = expectedStreams.every(id => streams[id]?.historyComplete === true);
    return { ...current, streams, initialized: Object.values(streams).some(value => value.initialized), historyComplete, complete: historyComplete };
}
export function indexCoverageConnects<T>(accountId: string, current: ScanCoverage, head: PageObservation<T>, previous: StreamCoverage): boolean {
    return pageSessions.get(pageSessionKey(accountId, current, head.streamId))?.connects(previous, head) ?? false;
}
export function indexCoverageExhausted(accountId: string, current: ScanCoverage, streamId: string): boolean {
    return pageSessions.get(pageSessionKey(accountId, current, streamId))?.exhausted() ?? false;
}
