import { DEFAULT_ACCOUNT_KEY, type Account } from './accountRegistry.js';
import type { ConversationKey } from './conversationKey.js';
import type { DomainConversationDetail, ConversationDetail } from './conversationDetail.js';
import { selectConversationDetail } from './conversationDetail.js';
import { acceptDetailFacts, restoreDomainDetail } from './runtimeValidation.js';
import CoverageAdmission from './coverageAdmission.js';
import type { PageObservation } from './pageObservation.js';
import { getAccount } from '../runtime/api/accountRegistry.js';
import { restoreConversationIndex, type DomainConversationIndex, type ConversationIndex, mergeConversationIndex } from './conversationIndex.js';
import { updateIndexesAtomically, updateConversationAtomically, deleteStoredConversation } from '../l3a/storageService.js';
import { conversationKey } from './conversationKey.js';

/** Duplicate source rows merge in input order; Storage reads their current values under one transaction. */
async function mergeIndexes(indexes: readonly DomainConversationIndex[]): Promise<void> {
    const groups = new Map<string, DomainConversationIndex[]>();
    for (const index of indexes) {
        const key = JSON.stringify([index.key.accountId, index.key.conversationId]);
        const group = groups.get(key);
        if (group) group.push(index);
        else groups.set(key, [index]);
    }
    const entries = [...groups.values()];
    await updateIndexesAtomically(entries.map(group => group[0].key), previous => {
        const changed: DomainConversationIndex[] = [];
        entries.forEach((group, i) => {
            let merged = previous[i] ? restoreConversationIndex(previous[i]) : undefined;
            for (const incoming of group) merged = mergeConversationIndex(merged, incoming);
            if (merged && JSON.stringify(merged) !== JSON.stringify(previous[i])) changed.push(merged);
        });
        return changed;
    });
}

export async function ingestIndexes(accountId: Account['id'],
    items: ReadonlyArray<{ conversationId: ConversationKey['conversationId']; fields: Omit<ConversationIndex, 'key'> }>,
    page?: Omit<PageObservation<unknown>, 'providerId' | 'accountId' | 'items'>): Promise<void> {
    const account = await getAccount(accountId);
    if (!account) throw new TypeError('Index account does not exist');
    const indexes = items.map(item => restoreConversationIndex({ ...item.fields, key: { accountId, conversationId: item.conversationId } }));
    await mergeIndexes(indexes);
    if (page && account.providerAccountId !== DEFAULT_ACCOUNT_KEY) await CoverageAdmission.recordPageCoverage(accountId, {
        ...page, providerId: account.providerId, accountId, items: indexes,
        valid: page.valid && page.keys.length === indexes.length
            && page.keys.every(key => indexes.some(index => index.key.conversationId === key.id)),
    });
}

/** Frozen L1 → L2 Detail admission contract. The implementation is migrated separately. */
export interface DetailIngestResult {
    accepted: boolean;
    changed: boolean;
}

export async function ingestDetail(accountId: Account['id'], conversationId: ConversationKey['conversationId'],
    detail: Omit<ConversationDetail, 'key'>, indexFields: Omit<ConversationIndex, 'key'> = {}): Promise<DetailIngestResult> {
    const account = await getAccount(accountId);
    if (!account) throw new TypeError('Detail account does not exist');
    const key = { accountId, conversationId };
    const incoming = acceptDetailFacts(key, detail);
    const index = restoreConversationIndex({ ...indexFields, key });
    return updateConversationAtomically(key, (oldIndex, oldDetail) => {
        const existingIndex = oldIndex ? restoreConversationIndex(oldIndex) : undefined;
        const acceptedIndex = mergeConversationIndex(existingIndex, index);
        const existing = oldDetail ? restoreDomainDetail(oldDetail) : null;
        const selected = selectConversationDetail(existing ? { detail: existing } : undefined, { detail: incoming }).detail;
        const changed = !existing || (selected !== existing
            && (JSON.stringify(existing.messages) !== JSON.stringify(selected.messages)
                || JSON.stringify(existing.assets) !== JSON.stringify(selected.assets)
                || existing.quality.status !== selected.quality.status));
        return {
            ...(JSON.stringify(acceptedIndex) !== JSON.stringify(existingIndex) ? { index: acceptedIndex } : {}),
            ...(JSON.stringify(selected) !== JSON.stringify(existing) ? { detail: selected } : {}),
            result: changed,
        };
    });
}

/** Invoked only after L1 verifies a specific remotely deleted/nonexistent conversation. */
export async function ingestDeletedConversation(accountId: Account['id'], conversationId: ConversationKey['conversationId']): Promise<void> {
    const key = conversationKey(accountId, conversationId);
    const account = await getAccount(accountId);
    if (!account) throw new TypeError('Deletion account does not exist');
    await deleteStoredConversation(key);
}
