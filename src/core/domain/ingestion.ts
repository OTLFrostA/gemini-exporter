import { DEFAULT_ACCOUNT_KEY } from './accountRegistry.js';
import type { DomainConversationDetail } from './conversationDetail.js';
import { selectConversationDetail } from './conversationDetail.js';
import { acceptDetailFacts } from './runtimeValidation.js';
import CoverageAdmission from './coverageAdmission.js';
import type { PageObservation } from './pageObservation.js';
import { getAccount } from '../api/accountRegistry.js';
import { compareConversationIndexes, restoreConversationIndex, type ConversationIndexPatch, type DomainConversationIndex, mergeConversationIndex } from './conversationIndex.js';
import { getDetail, putDetail } from '../storage/domain/domainStore.js';
import { withConversationLock, getConversations, writeConversationIndexes } from '../storage/conversationCatalogStore.js';

/** The caller holds Storage's serialization lock; only L2 chooses merged facts. */
async function mergeIndexes(accountId: string, indexes: readonly DomainConversationIndex[]): Promise<void> {
    const existing = await getConversations(accountId);
    const map = new Map(existing.map(index => [index.key.conversationId, index]));
    for (const incoming of indexes) map.set(incoming.key.conversationId, mergeConversationIndex(map.get(incoming.key.conversationId), incoming));
    const list = [...map.values()].sort(compareConversationIndexes);
    if (JSON.stringify(list) !== JSON.stringify(existing)) await writeConversationIndexes(accountId, list);
}

export async function ingestIndexes(accountId: string,
    items: ReadonlyArray<{ conversationId: string; fields: Omit<DomainConversationIndex, 'key'> }>,
    page?: Omit<PageObservation<unknown>, 'providerId' | 'accountId' | 'items'>): Promise<void> {
    const account = await getAccount(accountId);
    if (!account) throw new TypeError('Index account does not exist');
    const indexes = items.map(item => restoreConversationIndex({ ...item.fields, key: { accountId, conversationId: item.conversationId } }));
    await withConversationLock(() => mergeIndexes(accountId, indexes));
    if (page && account.providerAccountId !== DEFAULT_ACCOUNT_KEY) await CoverageAdmission.recordPageCoverage(accountId, {
            ...page, providerId: account.providerId, accountId, items: indexes,
            valid: page.valid && page.keys.length === indexes.length
                && page.keys.every(key => indexes.some(index => index.key.conversationId === key.id && index.updatedAt === key.time)),
        });
}

/** Index succeeds independently. A later Detail failure is visible to the caller. */
export async function ingestDetail(accountId: string, conversationId: string,
    detail: Omit<DomainConversationDetail, 'key'>, indexFields: Omit<DomainConversationIndex, 'key'> = {}): Promise<void> {
    const account = await getAccount(accountId);
    if (!account) throw new TypeError('Detail account does not exist');
    const key = { accountId, conversationId };
    const incoming = acceptDetailFacts(key, detail);
    const index = restoreConversationIndex({ ...indexFields, key });
    await withConversationLock(async () => {
        await mergeIndexes(accountId, [index]);
        const existing = await getDetail(key);
        const selected = selectConversationDetail(existing ? { detail: existing } : undefined, { detail: incoming }).detail;
        if (selected !== existing) await putDetail(selected);
    });
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
