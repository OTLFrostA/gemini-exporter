import { isAccountId } from './accountRegistry.js';
import type { PageObservation } from './pageObservation.js';
import { emptyStream, type StreamCoverage } from './streamCoverage.js';
import { indexCoverageSession, commitIndexCoverageSession } from './indexCoverage.js';
import { getCoverage, transactCoverage } from '../storage/scanCoverageStore.js';
export { getCoverage } from '../storage/scanCoverageStore.js';
export type ScanHead = Omit<PageObservation<unknown>, 'providerId' | 'accountId' | 'items'>;

/** Invoked only after all page Index commits have succeeded. Cursor evidence stays in memory. */
export async function recordPageCoverage<T>(accountId: string, page: PageObservation<T>, canCommit?: () => boolean): Promise<void> {
    if (!isAccountId(accountId) || page.accountId !== accountId) throw new TypeError('Coverage requires its Registry UUID');
    const committed = await transactCoverage(accountId, page.streamId, current => {
        if (canCommit?.() === false) throw new Error('Page was cancelled before coverage admission');
        const previous = current ?? emptyStream();
        const session = indexCoverageSession(accountId, page.streamId).fork();
        const next = session.observe(previous, page);
        return { value: session, ...(next === previous && current ? {} : { coverage: next }) };
    });
    commitIndexCoverageSession(accountId, page.streamId, committed);
}
export async function hasTrustedBoundary(accountId: string, frozenBaseline: StreamCoverage, scanHead: ScanHead): Promise<boolean> {
    if (!frozenBaseline.range) return false;
    const session = indexCoverageSession(accountId, scanHead.streamId);
    const head = { ...scanHead, providerId: '', accountId, items: [] };
    if (!session.connects(frozenBaseline, head)) return false;
    return transactCoverage(accountId, scanHead.streamId, current => {
        // A local cleanup can remove the durable boundary while a scan is running.
        if (!current?.range) return { value: false };
        return { value: true, coverage: session.extend(current) };
    });
}
const CoverageAdmission = { getCoverage, recordPageCoverage, hasTrustedBoundary };
export default CoverageAdmission;
