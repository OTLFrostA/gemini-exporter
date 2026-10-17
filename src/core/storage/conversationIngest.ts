import type { PageObservation } from '../domain/pageObservation.js';
import { getAccount } from '../api/accountRegistry.js';
import { selectConversationBody, withConversationMetadata } from '../domain/runtimeValidation.js';
import { compareConversationIndexes, restoreConversationIndex, type DomainConversationIndex, mergeConversationIndex } from '../domain/conversationIndex.js';
import type { ResourceConversationParseResult } from '../parsers/parsingResult.js';
import type { StoredDomainResource } from './domain/contracts.js';
import { saveDomainConversation, storedParseResult } from './domain/domainStore.js';
import { indexFromParsed } from './conversationIndexFromParsed.js';
import { withConversationLock, getConversations, writeConversationIndexes, transactConversations } from './conversationCatalogStore.js';
import type { ScanCoverage } from '../domain/scanCoverage.js';

/** Accept parsed external evidence before any consumer composes or renders it. */
export async function ingestConversation(slot: string, parsed: ResourceConversationParseResult,
    resources: readonly StoredDomainResource[] = [], source: 'detail' | 'takeout' | 'snapshot' = 'detail', canCommit?: () => boolean): Promise<ResourceConversationParseResult> {
    return withConversationLock(async () => {
        if (canCommit?.() === false) throw new Error('Account changed before detail ingestion');
        const account = await getAccount(slot);
        if (!account || account.id !== parsed.account.id || account.providerId !== parsed.account.providerId || parsed.conversation.index.key.accountId !== slot) throw new TypeError('Detail account/provider mismatch');
        const stored = await saveDomainConversation(slot, parsed, resources, false, canCommit);
        const list = await getConversations(slot);
        const incoming = indexFromParsed(parsed, source);
        const position = list.findIndex(row => row.key.conversationId === incoming.key.conversationId);
        const index = mergeConversationIndex(position < 0 ? undefined : list[position], incoming);
        if (position < 0) list.push(index); else list[position] = index;
        if (canCommit?.() === false) throw new Error('Account changed before index ingestion');
        await writeConversationIndexes(slot, list);
        const accepted = storedParseResult(stored, account);
        return { ...parsed, ...accepted, sourceVersion: accepted.sourceVersion, diagnostics: parsed.diagnostics, resourceHints: {},
            acquisitionHints: accepted.acquisitionHints,
            conversation: withConversationMetadata(selectConversationBody(accepted.conversation), index) };
    });
}


/** Normalized L1 facts enter once. L2 owns title authority, source times and list identity. */
export async function ingestIndexes(accountId: string, items: readonly DomainConversationIndex[], options: {
    canCommit?: () => boolean;
    forceWrite?: boolean;
    touched?: ReadonlySet<string>;
    accept?: (incoming: DomainConversationIndex, old: DomainConversationIndex | undefined) => boolean;
    storage?: { transactConversations: typeof transactConversations; preparePageCoverage: (accountId: string, identity: string, providerId: string) => Promise<ScanCoverage>; recordPageCoverage: <T>(accountId: string, page: PageObservation<T>, coverage: ScanCoverage, requireOrder: boolean, expectedStreams: readonly string[], runId?: string, canCommit?: () => boolean) => Promise<boolean> };
    page?: PageObservation<unknown>;
    runId?: string;
} = {}) {
    const account = await getAccount(accountId);
    if (!account) throw new TypeError('Index account does not exist');
    const indexes = items.map(restoreConversationIndex);
    if (indexes.some(index => index.key.accountId !== account.id)) throw new TypeError('Index account/provider mismatch');
    const storage = options.storage;
    if (options.page && !storage) throw new TypeError('Page ingestion requires coverage storage ports');
    const page = options.page;
    if (page && (page.accountId !== accountId || page.providerId !== account.providerId || page.items.length !== indexes.length)) throw new TypeError('Page identity/items mismatch');
    const coverage = page ? await storage!.preparePageCoverage(accountId, accountId, account.providerId) : undefined;
    let accepted = 0;
    const tx = await (storage?.transactConversations ?? transactConversations)(accountId, existing => {
        if (options.canCommit?.() === false) throw new Error('Account changed before index ingestion');
        const map = new Map(existing.map(index => [index.key.conversationId, index]));
        let changed = 0;
        for (const incoming of indexes) {
            const old = map.get(incoming.key.conversationId);
            if (options.accept?.(incoming, old) === false) continue;
            accepted++;
            const next = mergeConversationIndex(old, incoming);
            if (JSON.stringify(old) !== JSON.stringify(next)) changed++;
            map.set(incoming.key.conversationId, next);
        }
        const list = [...map.values()].sort((a, b) => compareConversationIndexes(a, b)
            || Number(options.touched?.has(b.key.conversationId) ?? false) - Number(options.touched?.has(a.key.conversationId) ?? false));
        const reordered = list.some((index, position) => index.key.conversationId !== existing[position]?.key.conversationId);
        return options.forceWrite || changed || reordered ? { list, changed } : null;
    });
    if (page && coverage && accepted === indexes.length ) {
        const recorded = await storage!.recordPageCoverage(accountId, page, coverage, page.streamId === 'recent', ['pinned', 'recent'], options.runId, options.canCommit);
        if (!recorded && options.runId !== undefined) throw new Error('Coverage was cleared, cancelled or superseded');
    }
    return { ...tx, accepted, persisted: accepted };
}
