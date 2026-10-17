import type { Account } from '../domain/accountRegistry.js';
import type { StreamCoverage } from '../domain/streamCoverage.js';
import { readOne, putOne, deleteOne } from './idb.js';

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
