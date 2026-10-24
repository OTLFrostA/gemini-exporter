import { DEFAULT_ACCOUNT_KEY, readAccount, type Account } from './accountRegistry.js';
import type { ConversationKey } from './conversationKey.js';
import type { DomainConversationDetail, ConversationDetail } from './conversationDetail.js';
import { selectConversationDetail } from './conversationDetail.js';
import { acceptDetailFacts, restoreDomainDetail } from './runtimeValidation.js';
import CoverageAdmission from './coverageAdmission.js';
import type { PageObservationHead } from './pageObservation.js';
import { restoreConversationIndex, type DomainConversationIndex, type ConversationIndex, mergeConversationIndex } from './conversationIndex.js';
import { getAccount, updateIndexesAtomically, updateConversationAtomically, deleteStoredConversation } from '../l3a/storageService.js';
import { conversationKey } from './conversationKey.js';

/** Runtime handles readiness and IPC; L2 reads and validates persisted Account facts directly. */
async function readExistingAccount(accountId: Account['id']): Promise<Account | null> {
    const stored = await getAccount(accountId);
    if (stored === null) return null;
    const account = readAccount(stored);
    if (account.id !== accountId) throw new TypeError('Account registry UUID mismatch');
    return account;
}

/** Domain values are JSON facts: object property insertion order is not a content change. */
function sameStoredFacts(left: unknown, right: unknown): boolean {
    if (left === right) return true;
    if (Array.isArray(left)) return Array.isArray(right) && left.length === right.length
        && left.every((item, i) => sameStoredFacts(item, right[i]));
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(right)) return false;
    const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length
        && keys.every(key => Object.hasOwn(b, key) && sameStoredFacts(a[key], b[key]));
}

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
            if (merged && !sameStoredFacts(merged, previous[i])) changed.push(merged);
        });
        return changed;
    });
}

export async function ingestIndexes(accountId: Account['id'],
    items: ReadonlyArray<{ conversationId: ConversationKey['conversationId']; fields: Omit<ConversationIndex, 'key'> }>,
    page?: PageObservationHead): Promise<void> {
    const account = await readExistingAccount(accountId);
    if (!account) throw new TypeError('Index account does not exist');
    const indexes = items.map(item => restoreConversationIndex({ ...item.fields, key: { accountId, conversationId: item.conversationId } }));
    await mergeIndexes(indexes);
    if (page && account.providerAccountId !== DEFAULT_ACCOUNT_KEY) await CoverageAdmission.recordPageCoverage(accountId, {
        ...page, providerId: account.providerId, accountId, items: indexes,
        valid: page.valid && page.keys.length === indexes.length
            && page.keys.every(key => indexes.some(index => index.key.conversationId === key.id)),
    });
}

/** Committed admission result; temporary resource ownership is decided by accepted. */
export interface DetailIngestResult {
    accepted: boolean;
    changed: boolean;
}

export async function ingestDetail(accountId: Account['id'], conversationId: ConversationKey['conversationId'],
    detail: Omit<ConversationDetail, 'key'>, indexFields: Omit<ConversationIndex, 'key'> = {}): Promise<DetailIngestResult> {
    const account = await readExistingAccount(accountId);
    if (!account) throw new TypeError('Detail account does not exist');
    const key = { accountId, conversationId };
    const incoming = acceptDetailFacts(key, detail);
    const index = restoreConversationIndex({ ...indexFields, key });
    return updateConversationAtomically(key, (oldIndex, oldDetail) => {
        const existingIndex = oldIndex ? restoreConversationIndex(oldIndex) : undefined;
        const acceptedIndex = mergeConversationIndex(existingIndex, index);
        const existing = oldDetail ? restoreDomainDetail(oldDetail) : null;
        const selected = selectConversationDetail(existing ? { detail: existing } : undefined, { detail: incoming }).detail;
        const sameFacts = (a: DomainConversationDetail, b: DomainConversationDetail): boolean =>
            sameStoredFacts(a.messages, b.messages) && sameStoredFacts(a.assets, b.assets)
            && a.quality.status === b.quality.status;
        const accepted = selected === incoming || (existing !== null && sameFacts(existing, incoming));
        const changed = !existing || (selected !== existing && !sameFacts(existing, selected));
        return {
            ...(!sameStoredFacts(acceptedIndex, existingIndex) ? { index: acceptedIndex } : {}),
            ...(!sameStoredFacts(selected, existing) ? { detail: selected } : {}),
            result: { accepted, changed },
        };
    });
}

/** Invoked only after L1 verifies a specific remotely deleted/nonexistent conversation. */
export async function ingestDeletedConversation(accountId: Account['id'], conversationId: ConversationKey['conversationId']): Promise<void> {
    const key = conversationKey(accountId, conversationId);
    const account = await readExistingAccount(accountId);
    if (!account) throw new TypeError('Deletion account does not exist');
    await deleteStoredConversation(key);
}
