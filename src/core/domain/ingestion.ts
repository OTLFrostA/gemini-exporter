import { DEFAULT_ACCOUNT_KEY } from './accountRegistry.js';
import type { DomainConversationDetail } from './conversationDetail.js';
import { saveDomainConversation } from './snapshotAdmission.js';
import CoverageAdmission from './coverageAdmission.js';
import type { PageObservation } from './pageObservation.js';
import { getAccount } from '../api/accountRegistry.js';
import { selectConversationBody, withConversationMetadata, validateParserDomain } from './runtimeValidation.js';
import { compareConversationIndexes, restoreConversationIndex, type ConversationIndexPatch, type DomainConversationIndex, mergeConversationIndex } from './conversationIndex.js';
import type { ResourceConversationParseResult } from '../parsers/parsingResult.js';
import type { StoredDomainResource } from '../storage/domain/contracts.js';
import { storedParseResult } from '../storage/domain/domainStore.js';
import { withConversationLock, getConversations, writeConversationIndexes, transactConversations, requireAccountId } from '../storage/conversationCatalogStore.js';

/** Accept parsed external evidence before any consumer composes or renders it. */
export async function ingestConversation(slot: string, parsed: ResourceConversationParseResult,
    resources: readonly StoredDomainResource[] = [], canCommit?: () => boolean): Promise<ResourceConversationParseResult> {
    return withConversationLock(async () => {
        if (canCommit?.() === false) throw new Error('Account changed before detail ingestion');
        const account = await getAccount(slot);
        if (!account || account.id !== parsed.account.id || account.providerId !== parsed.account.providerId || parsed.conversation.index.key.accountId !== slot) throw new TypeError('Detail account/provider mismatch');
        const stored = await saveDomainConversation(slot, parsed, resources, canCommit);
        const list = await getConversations(slot);
        const incoming = restoreConversationIndex(parsed.conversation.index);
        const position = list.findIndex(row => row.key.conversationId === incoming.key.conversationId);
        const index = mergeConversationIndex(position < 0 ? undefined : list[position], incoming);
        if (position < 0) list.push(index); else list[position] = index;
        if (canCommit?.() === false) throw new Error('Account changed before index ingestion');
        await writeConversationIndexes(slot, list.sort(compareConversationIndexes));
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
    storage?: { transactConversations: typeof transactConversations };
    page?: PageObservation<unknown>;
} = {}) {
    const account = await getAccount(accountId);
    if (!account) throw new TypeError('Index account does not exist');
    const indexes = items.map(restoreConversationIndex);
    if (indexes.some(index => index.key.accountId !== account.id)) throw new TypeError('Index account/provider mismatch');
    const storage = options.storage;
    const page = options.page;
    if (page && (page.accountId !== accountId || page.providerId !== account.providerId || page.items.length !== indexes.length)) throw new TypeError('Page identity/items mismatch');
    let accepted = 0;
    const tx = await (storage?.transactConversations ?? transactConversations)(accountId, existing => {
        if (options.canCommit?.() === false) throw new Error('Account changed before index ingestion');
        const map = new Map(existing.map(index => [index.key.conversationId, index]));
        let changed = 0;
        for (const incoming of indexes) {
            const old = map.get(incoming.key.conversationId);
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
    if (page && accepted === indexes.length && account.providerAccountId !== DEFAULT_ACCOUNT_KEY) await CoverageAdmission.recordPageCoverage(accountId, { ...page,
        valid: page.valid && page.keys.length === indexes.length
            && page.keys.every(key => indexes.some(index => index.key.conversationId === key.id && index.updatedAt === key.time)),
    }, options.canCommit);
    return { ...tx, accepted, persisted: accepted };
}

/** Upsert a partial native import; unrelated indexes and stronger metadata remain intact. */
export async function ingestDetails(slot: string | null | undefined, list: readonly ResourceConversationParseResult[]): Promise<void> {
    for (const parsed of list) await ingestConversation(requireAccountId(slot), parsed);
}

export async function updateConversation(
    slot: string | null | undefined,
    conversationId: string,
    patchOrUpdater: ConversationIndexPatch | ((conv: DomainConversationIndex) => ConversationIndexPatch | null | void)
): Promise<boolean> {
    return withConversationLock(async () => {
        const id = conversationId;
        const list = await getConversations(slot);
        const position = list.findIndex(c => c.key.conversationId === id);
        if (position < 0) return false;
        const old = list[position];
        const current = { ...old };
        const patch = typeof patchOrUpdater === 'function' ? patchOrUpdater(current) : patchOrUpdater;
        if (patch === null) return false;
        const incoming = restoreConversationIndex({ ...current, ...patch });
        const merged = mergeConversationIndex(old, incoming);
        if (JSON.stringify(merged) === JSON.stringify(old)) return false;
        list[position] = merged;
        await writeConversationIndexes(slot, list.sort(compareConversationIndexes));
        return true;
    });
}


/** Frozen L2 body contract; existing L1 acquisition adapters share the same admission below. */
export async function ingestDetail(accountId: string, conversationId: string,
    detail: Omit<DomainConversationDetail, 'key'>, indexFields: Omit<DomainConversationIndex, 'key'> = {}): Promise<void> {
    const account = await getAccount(accountId);
    if (!account) throw new TypeError('Detail account does not exist');
    const key = { accountId, conversationId };
    const conversation = validateParserDomain({ index: { ...indexFields, key }, detail: { ...detail, key } });
    await ingestConversation(accountId, { account, conversation, diagnostics: [], resourceHints: {}, acquisitionHints: {} });
}
