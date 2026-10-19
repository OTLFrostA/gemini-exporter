import type { Account } from '../domain/accountRegistry.js';
import type { StreamCoverage } from '../domain/streamCoverage.js';
import { inStores, readOne, putOne, deleteOne } from './idb.js';

interface CoverageRow { accountId: string; streamId: string; value: StreamCoverage }
export async function getCoverage(accountId: Account['id'], streamId: string): Promise<StreamCoverage | null> {
    return (await readOne<CoverageRow>('coverage', [accountId, streamId]))?.value ?? null;
}
export function putCoverage(accountId: Account['id'], streamId: string, accepted: StreamCoverage): Promise<void> {
    return putOne('coverage', { accountId, streamId, value: accepted });
}
export function deleteCoverage(accountId: Account['id'], streamId: string): Promise<void> {
    return deleteOne('coverage', [accountId, streamId]);
}

/** Serialize Coverage read -> L2 decision -> optional write against account clear. */
export function updateCoverageAtomically<R>(accountId: Account['id'], streamId: string,
    decide: (current: StreamCoverage | null) => { next?: StreamCoverage; result: R }): Promise<R> {
    return inStores<R>(['coverage'], 'readwrite', (tx, done, fail) => {
        const store = tx.objectStore('coverage');
        const request = store.get([accountId, streamId]);
        request.onsuccess = () => {
            try {
                const { next, result } = decide((request.result as CoverageRow | undefined)?.value ?? null);
                if (next !== undefined) store.put({ accountId, streamId, value: next });
                done(result);
            } catch (error) { fail(error); }
        };
    });
}

/** Physical account-prefix deletion, leaving all Index, Detail and ExportRecord facts intact. */
export function clearStoredAccountCoverage(accountId: Account['id']): Promise<void> {
    return inStores<void>(['coverage'], 'readwrite', (tx, done) => {
        const store = tx.objectStore('coverage');
        const range = IDBKeyRange.bound([accountId], [accountId, []]);
        const request = store.openCursor(range);
        request.onsuccess = () => {
            const cursor = request.result;
            if (cursor) { cursor.delete(); cursor.continue(); }
        };
        done(undefined);
    });
}
