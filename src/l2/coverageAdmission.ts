import { isAccountId } from './accountRegistry.js';
import type { PageObservation, PageObservationEvidence, PageObservationHead } from './pageObservation.js';
import { CoverageSession, emptyStream, type StreamCoverage } from './streamCoverage.js';
import {
    coverageResetEpoch,
    indexCoverageSession,
    commitIndexCoverageSession,
    resetAccountCoverageSessions,
} from './indexCoverage.js';
import { domainStorage } from './storagePort.js';
export type ScanHead = PageObservationHead;

const streamQueues = new Map<string, Promise<unknown>>();

function serializeStream<T>(accountId: string, streamId: string, work: () => Promise<T>): Promise<T> {
    const key = JSON.stringify([accountId, streamId]);
    const previous = streamQueues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(work);
    const tail = next.then(() => undefined, () => undefined).finally(() => {
        if (streamQueues.get(key) === tail) streamQueues.delete(key);
    });
    streamQueues.set(key, tail);
    return next;
}

function sameCoverageRange(a: StreamCoverage['range'], b: StreamCoverage['range']): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.head.id === b.head.id && a.head.time === b.head.time
        && a.tail.id === b.tail.id && a.tail.time === b.tail.time;
}

export function getCoverage(accountId: string, streamId: string): Promise<StreamCoverage | null> {
    return domainStorage().getCoverage(accountId, streamId);
}

/** Evaluate source evidence under Storage's current Coverage, publishing the cursor chain after commit. */
export async function recordPageCoverage(accountId: string, page: PageObservation, canCommit?: () => boolean): Promise<void> {
    if (!isAccountId(accountId) || page.accountId !== accountId) throw new TypeError('Coverage requires its Registry UUID');
    return serializeStream(accountId, page.streamId, async () => {
        const epochBefore = coverageResetEpoch();
        let accepted: CoverageSession | undefined;
        await domainStorage().updateCoverageAtomically(accountId, page.streamId, current => {
            if (canCommit?.() === false) throw new Error('Page was cancelled before coverage admission');
            // A cleared row invalidates all earlier in-memory cursor evidence, even in this Context.
            accepted = current === null ? new CoverageSession() : indexCoverageSession(accountId, page.streamId).fork();
            const previous = current ?? emptyStream();
            const next = accepted.observe(previous, page);
            return { ...(current === null || next !== previous ? { next } : {}), result: undefined };
        });
        if (accepted && coverageResetEpoch() === epochBefore) {
            commitIndexCoverageSession(accountId, page.streamId, accepted);
        }
    });
}
export async function hasTrustedBoundary(accountId: string, frozenBaseline: StreamCoverage, scanHead: ScanHead): Promise<boolean> {
    if (!frozenBaseline.range) return false;
    const head: PageObservationEvidence = { ...scanHead, providerId: '', accountId };
    return serializeStream(accountId, scanHead.streamId, () =>
        domainStorage().updateCoverageAtomically(accountId, scanHead.streamId, current => {
            // A user clear must not resurrect a frozen pre-clear baseline.
            if (!current?.range) return { result: false };
            const session = indexCoverageSession(accountId, scanHead.streamId);
            // Both the frozen baseline and the latest committed range must still connect.
            // A different terminal scan may have replaced the old boundary meanwhile.
            if (!session.connects(frozenBaseline, head) || !session.connects(current, head)) return { result: false };
            const next = session.extend(current);
            return { ...(!sameCoverageRange(next.range, current.range) ? { next } : {}), result: true };
        }),
    );
}
function resetAccountCoverage(accountId: string): void {
    resetAccountCoverageSessions(accountId);
}
const CoverageAdmission = { getCoverage, recordPageCoverage, hasTrustedBoundary, resetAccountCoverage };
export default CoverageAdmission;
