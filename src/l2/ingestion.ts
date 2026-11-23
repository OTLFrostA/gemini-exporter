import { DEFAULT_ACCOUNT_KEY, readAccount, type Account } from './accountRegistry.js';
import type { ConversationKey } from './conversationKey.js';
import type { DomainConversationDetail, ConversationDetail } from './conversationDetail.js';
import { selectConversationDetail } from './conversationDetail.js';
import { acceptDetailFacts, restoreDomainDetail } from './runtimeValidation.js';
import CoverageAdmission from './coverageAdmission.js';
import type { PageObservationHead } from './pageObservation.js';
import { restoreConversationIndex, type DomainConversationIndex, type ConversationIndex, mergeConversationIndex } from './conversationIndex.js';
import { domainStorage } from './storagePort.js';
import { conversationKey } from './conversationKey.js';
import * as sameStoredFacts from './domainEquality.js';

/** Runtime handles readiness and IPC; L2 reads and validates persisted Account facts directly. */
async function readExistingAccount(accountId: Account['id']): Promise<Account | null> {
    const stored = await domainStorage().getAccount(accountId);
    if (stored === null) return null;
    const account = readAccount(stored);
    if (account.id !== accountId) throw new TypeError('Account registry UUID mismatch');
    return account;
}

import type { IndexIngestResult, IndexAdmissionResult, DetailIngestResult } from './contracts/ingestionTypes.js';
export type { IndexIngestResult, DetailIngestResult } from './contracts/ingestionTypes.js';

function emitCommittedKeys(keys: readonly ConversationKey[]): void {
    if (keys.length === 0) return;
    domainStorage().onCommittedKeys?.(keys);
}

/** An input is accepted if its supplied facts survive, or it contributes to the final stored row. */
function acceptsIndexFacts(
    incoming: DomainConversationIndex, merged: DomainConversationIndex, previous: DomainConversationIndex | null,
): boolean {
    const titleMatches = incoming.title === merged.title && incoming.titleSource === merged.titleSource;
    let all = incoming.title === undefined || titleMatches;
    let changed = titleMatches && incoming.title !== undefined
        && (incoming.title !== previous?.title || incoming.titleSource !== previous?.titleSource);
    const timestamps = ['createdAt', 'updatedAt', 'activityAt'] satisfies (keyof DomainConversationIndex)[];
    for (const field of timestamps) {
        const value = incoming[field];
        if (value === undefined) continue;
        const matches = value === merged[field];
        all &&= matches;
        changed ||= matches && value !== previous?.[field];
    }
    return all || changed;
}

/** Duplicate source rows merge in input order; Storage reads their current values under one transaction. */
async function mergeIndexes(indexes: readonly DomainConversationIndex[]): Promise<IndexAdmissionResult> {
    const groups = new Map<string, DomainConversationIndex[]>();
    for (const index of indexes) {
        const key = JSON.stringify([index.key.accountId, index.key.conversationId]);
        const group = groups.get(key);
        if (group) group.push(index);
        else groups.set(key, [index]);
    }
    const entries = [...groups.values()];
    const changes: IndexAdmissionResult = { added: 0, updated: 0, accepted: 0, rejected: 0 };
    let committedKeys: ConversationKey[] = [];
    await domainStorage().updateIndexesAtomically(entries.map(group => group[0].key), previous => {
        const changed: DomainConversationIndex[] = [];
        entries.forEach((group, i) => {
            const stored = previous[i];
            let merged = stored ? restoreConversationIndex(stored) : undefined;
            for (const incoming of group) merged = mergeConversationIndex(merged, incoming);
            if (!merged) return;
            for (const incoming of group) {
                if (acceptsIndexFacts(incoming, merged, stored)) changes.accepted++;
                else changes.rejected++;
            }
            if (!sameStoredFacts.index(merged, stored)) {
                changed.push(merged);
                if (stored) changes.updated++;
                else changes.added++;
            }
        });
        committedKeys = changed.map(row => row.key);
        return changed;
    });
    emitCommittedKeys(committedKeys);
    return changes;
}

export async function ingestIndexes(accountId: Account['id'],
    items: ReadonlyArray<{ conversationId: ConversationKey['conversationId']; fields: Omit<ConversationIndex, 'key'> }>,
    page?: PageObservationHead): Promise<IndexAdmissionResult> {
    const account = await readExistingAccount(accountId);
    if (!account) throw new TypeError('Index account does not exist');
    const indexes = items.map(item => restoreConversationIndex({ ...item.fields, key: { accountId, conversationId: item.conversationId } }));
    const changes = await mergeIndexes(indexes);
    if (page && account.providerAccountId !== DEFAULT_ACCOUNT_KEY) await CoverageAdmission.recordPageCoverage(accountId, {
        ...page, providerId: account.providerId, accountId,
        valid: page.valid && page.keys.length === indexes.length
            && page.keys.every(key => indexes.some(index => index.key.conversationId === key.id)),
    });
    return changes;
}

function buildConversationDecision(
    key: ConversationKey,
    detail: Omit<ConversationDetail, 'key'>,
    indexFields: Omit<ConversationIndex, 'key'> = {},
) {
    const incoming = acceptDetailFacts(key, detail);
    const index = restoreConversationIndex({ ...indexFields, key });
    return (oldIndex: DomainConversationIndex | null, oldDetail: DomainConversationDetail | null) => {
        const existingIndex = oldIndex ? restoreConversationIndex(oldIndex) : undefined;
        const acceptedIndex = mergeConversationIndex(existingIndex, index);
        const existing = oldDetail ? restoreDomainDetail(oldDetail) : null;
        const selected = selectConversationDetail(existing, incoming);
        const sameFacts = sameStoredFacts.material;
        const accepted = selected === incoming || (existing !== null && sameFacts(existing, incoming));
        const changed = !existing || (selected !== existing && !sameFacts(existing, selected));
        const result: DetailIngestResult = { accepted, changed };
        if (!existingIndex) result.indexAdded = true;
        return {
            ...(!sameStoredFacts.index(acceptedIndex, existingIndex) ? { index: acceptedIndex } : {}),
            ...(!sameStoredFacts.detail(selected, existing) ? { detail: selected } : {}),
            result,
        };
    };
}

export interface DetailBatchIngestEntry {
    readonly conversationId: ConversationKey['conversationId'];
    readonly detail: Omit<ConversationDetail, 'key'>;
    readonly indexFields?: Omit<ConversationIndex, 'key'>;
}

export async function ingestDetail(accountId: Account['id'], conversationId: ConversationKey['conversationId'],
    detail: Omit<ConversationDetail, 'key'>, indexFields: Omit<ConversationIndex, 'key'> = {}): Promise<DetailIngestResult> {
    const account = await readExistingAccount(accountId);
    if (!account) throw new TypeError('Detail account does not exist');
    const key = { accountId, conversationId };
    let wroteFacts = false;
    const baseDecision = buildConversationDecision(key, detail, indexFields);
    const outcome = await domainStorage().updateConversationAtomically(key, (oldIndex, oldDetail) => {
        const decided = baseDecision(oldIndex, oldDetail);
        wroteFacts = Boolean(decided.index || decided.detail);
        return decided;
    });
    if (wroteFacts) emitCommittedKeys([key]);
    return outcome;
}

export async function ingestDetailsBatch(
    accountId: Account['id'],
    entries: readonly DetailBatchIngestEntry[],
): Promise<DetailIngestResult[]> {
    const account = await readExistingAccount(accountId);
    if (!account) throw new TypeError('Detail account does not exist');
    if (entries.length === 0) return [];
    const committedKeys = new Map<ConversationKey['conversationId'], ConversationKey>();
    const prepared = entries.map(entry => {
        const key = { accountId, conversationId: entry.conversationId };
        const baseDecision = buildConversationDecision(key, entry.detail, entry.indexFields);
        return {
            key,
            decide: (oldIndex: DomainConversationIndex | null, oldDetail: DomainConversationDetail | null) => {
                const decided = baseDecision(oldIndex, oldDetail);
                if (decided.index || decided.detail) committedKeys.set(key.conversationId, key);
                return decided;
            },
        };
    });
    const outcomes = await domainStorage().updateConversationsAtomically(prepared);
    emitCommittedKeys([...committedKeys.values()]);
    return outcomes;
}

/** Invoked only after L1 verifies a specific remotely deleted/nonexistent conversation. */
export async function ingestDeletedConversation(accountId: Account['id'], conversationId: ConversationKey['conversationId']): Promise<void> {
    const key = conversationKey(accountId, conversationId);
    const account = await readExistingAccount(accountId);
    if (!account) throw new TypeError('Deletion account does not exist');
    await domainStorage().deleteStoredConversation(key);
}
