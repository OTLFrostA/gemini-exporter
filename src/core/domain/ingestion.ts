import { DEFAULT_ACCOUNT_KEY } from './accountRegistry.js';
import type { DomainConversationDetail } from './conversationDetail.js';
import { selectConversationDetail } from './conversationDetail.js';
import { acceptDetailFacts, restoreDomainDetail } from './runtimeValidation.js';
import CoverageAdmission from './coverageAdmission.js';
import type { PageObservation } from './pageObservation.js';
import { getAccount } from '../api/accountRegistry.js';
import { restoreConversationIndex, type DomainConversationIndex, mergeConversationIndex } from './conversationIndex.js';
import { updateIndexesAtomically, updateConversationAtomically, deleteStoredConversation } from '../storage/storageService.js';
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
    await updateIndexesAtomically(entries.map(group => group[0].key), previous => entries.map((group, i) => {
        let merged = previous[i] ? restoreConversationIndex(previous[i]) : undefined;
        for (const incoming of group) merged = mergeConversationIndex(merged, incoming);
        return merged!;
    }));
}

export async function ingestIndexes(accountId: string,
    items: ReadonlyArray<{ conversationId: string; fields: Omit<DomainConversationIndex, 'key'> }>,
    page?: Omit<PageObservation<unknown>, 'providerId' | 'accountId' | 'items'>): Promise<void> {
    const account = await getAccount(accountId);
    if (!account) throw new TypeError('Index account does not exist');
    const indexes = items.map(item => restoreConversationIndex({ ...item.fields, key: { accountId, conversationId: item.conversationId } }));
    await mergeIndexes(indexes);
    if (page && account.providerAccountId !== DEFAULT_ACCOUNT_KEY) await CoverageAdmission.recordPageCoverage(accountId, {
        ...page, providerId: account.providerId, accountId, items: indexes,
        valid: page.valid && page.keys.length === indexes.length
            && page.keys.every(key => indexes.some(index => index.key.conversationId === key.id && index.updatedAt === key.time)),
    });
}

/** changed is true only for committed exportable Detail changes, not source-version or Index updates. */
export async function ingestDetail(accountId: string, conversationId: string,
    detail: Omit<DomainConversationDetail, 'key'>, indexFields: Omit<DomainConversationIndex, 'key'> = {}): Promise<boolean> {
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
export async function ingestDeletedConversation(accountId: string, conversationId: string): Promise<void> {
    const key = conversationKey(accountId, conversationId);
    const account = await getAccount(accountId);
    if (!account) throw new TypeError('Deletion account does not exist');
    await deleteStoredConversation(key);
}
