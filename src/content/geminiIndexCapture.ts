import { listIndexes as getConversations } from '../core/storage/storageService.js';
import { ingestIndexes } from '../core/domain/ingestion.js';
import { getAccount } from '../core/api/accountRegistry.js';
import { parseGeminiIndexObservation, type GeminiIndexObservationSource } from '../core/parsers/gemini/parseIndexObservation.js';
import type { GeminiProviderConversationItem } from '../core/provider/gemini/geminiContracts.js';
import type { PageObservation } from '../core/domain/pageObservation.js';
import { resolveCurrentAccount, isCurrentAccount } from './accountContext.js';

export interface RpcListIngestResult { count: number; accepted: number; rejected: number; persisted: number }

/** DOM/source input only. Domain selection, transactions and Coverage stay in L2. */
export async function persistConversationBatch(incomingItems: readonly unknown[], source: string, _forceWrite = false,
    targetAccountId: string | null = null, _requestedAt = 0, _localTouches: readonly string[] = [],
    canCommit?: () => boolean, page?: PageObservation<unknown>): Promise<RpcListIngestResult> {
    const captured = targetAccountId ? null : await resolveCurrentAccount();
    const accountId = targetAccountId ?? captured?.accountId;
    if (!accountId) throw new TypeError('Source input requires an account UUID');
    const account = await getAccount(accountId);
    if (!account || account.providerId !== 'gemini') throw new TypeError('Provider account mismatch');
    const kind: GeminiIndexObservationSource = source === 'network-list' || source === 'batchexecute' ? 'rpc-list'
        : source.includes('detail') ? 'detail' : 'dom';
    const indexes = incomingItems.flatMap(item => {
        try {
            const { conversationId, fields } = parseGeminiIndexObservation(item, kind);
            return [{ conversationId, fields }];
        } catch (error) { if (error instanceof TypeError) return []; throw error; }
    });
    if (canCommit?.() === false || (captured && !isCurrentAccount(captured))) throw new DOMException('Source input cancelled or account changed', 'AbortError');
    await ingestIndexes(accountId, indexes, page && account.providerAccountId !== 'default'
        ? { ...page, valid: page.valid && indexes.length === incomingItems.length } : undefined);
    const list = await getConversations(accountId);
    return { count: list.length, accepted: indexes.length, rejected: incomingItems.length - indexes.length, persisted: indexes.length };
}
export async function upsertConversations(items: readonly unknown[], source: string, forceWrite = false, accountId: string | null = null): Promise<number> {
    return (await persistConversationBatch(items, source, forceWrite, accountId)).count;
}
export async function ingestRpcList(items: GeminiProviderConversationItem[], accountId: string, requestedAt = 0,
    canCommit?: () => boolean): Promise<RpcListIngestResult> {
    return persistConversationBatch(items, 'network-list', false, accountId, requestedAt, [], canCommit);
}
export async function ingestPageObservation(page: PageObservation<GeminiProviderConversationItem>, accountId: string): Promise<RpcListIngestResult> {
    if (page.accountId !== accountId || page.providerId !== 'gemini') throw new TypeError('Page account mismatch');
    return persistConversationBatch(page.items, 'network-list', false, accountId, page.requestedAt, [], undefined, page);
}
