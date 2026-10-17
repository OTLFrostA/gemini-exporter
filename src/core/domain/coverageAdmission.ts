import { isAccountId } from './accountRegistry.js';
import type { PageObservation } from './pageObservation.js';
import { emptyStream, type StreamCoverage } from './streamCoverage.js';
import { indexCoverageSession, commitIndexCoverageSession } from './indexCoverage.js';
import { getCoverage, putCoverage } from '../storage/storageService.js';
import { withAdmissionLock } from './admissionLock.js';
export { getCoverage } from '../storage/storageService.js';
export type ScanHead = Omit<PageObservation<unknown>, 'providerId' | 'accountId' | 'items'>;

/** Invoked only after all page Index commits have succeeded. Cursor evidence stays in memory. */
export async function recordPageCoverage<T>(accountId: string, page: PageObservation<T>, canCommit?: () => boolean): Promise<void> {
    if (!isAccountId(accountId) || page.accountId !== accountId) throw new TypeError('Coverage requires its Registry UUID');
    await withAdmissionLock(`coverage:${JSON.stringify([accountId, page.streamId])}`, async () => {
        const current = await getCoverage(accountId, page.streamId);
        if (canCommit?.() === false) throw new Error('Page was cancelled before coverage admission');
        const previous = current ?? emptyStream();
        const session = indexCoverageSession(accountId, page.streamId).fork();
        const next = session.observe(previous, page);
        if (next !== previous || !current) await putCoverage(accountId, page.streamId, next);
        commitIndexCoverageSession(accountId, page.streamId, session);
    });
}
export async function hasTrustedBoundary(accountId: string, frozenBaseline: StreamCoverage, scanHead: ScanHead): Promise<boolean> {
    if (!frozenBaseline.range) return false;
    const session = indexCoverageSession(accountId, scanHead.streamId);
    const head = { ...scanHead, providerId: '', accountId, items: [] };
    if (!session.connects(frozenBaseline, head)) return false;
    return withAdmissionLock(`coverage:${JSON.stringify([accountId, scanHead.streamId])}`, async () => {
        const current = await getCoverage(accountId, scanHead.streamId);
        // A local cleanup can remove the durable boundary while a scan is running.
        if (!current?.range) return false;
        await putCoverage(accountId, scanHead.streamId, session.extend(current));
        return true;
    });
}
const CoverageAdmission = { getCoverage, recordPageCoverage, hasTrustedBoundary };
export default CoverageAdmission;
