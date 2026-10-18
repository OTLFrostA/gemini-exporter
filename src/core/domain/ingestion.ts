import { DEFAULT_ACCOUNT_KEY } from './accountRegistry.js';
import type { DomainConversationDetail } from './conversationDetail.js';
import { selectConversationDetail } from './conversationDetail.js';
import { acceptDetailFacts, restoreDomainDetail } from './runtimeValidation.js';
import CoverageAdmission from './coverageAdmission.js';
import type { PageObservation } from './pageObservation.js';
import { getAccount } from '../api/accountRegistry.js';
import { restoreConversationIndex, type ConversationIndexPatch, type DomainConversationIndex, mergeConversationIndex } from './conversationIndex.js';
import { getIndex, getDetail, putDetail, listIndexes, putIndexes } from '../storage/storageService.js';
import { withAdmissionLock } from './admissionLock.js';

/** The caller holds L2's serialization lock; only L2 chooses merged facts. */
async function mergeIndexes(indexes: readonly DomainConversationIndex[]): Promise<void> {
    const accepted = new Map<string, DomainConversationIndex>();
    for (const incoming of indexes) {
        const raw = accepted.get(incoming.key.conversationId) ?? await getIndex(incoming.key);
        const existing = raw ? restoreConversationIndex(raw) : undefined;
        const merged = mergeConversationIndex(existing, incoming);
        if (JSON.stringify(merged) !== JSON.stringify(existing)) accepted.set(incoming.key.conversationId, merged);
    }
    await putIndexes([...accepted.values()]);
}

export async function ingestIndexes(accountId: string,
    items: ReadonlyArray<{ conversationId: string; fields: Omit<DomainConversationIndex, 'key'> }>,
    page?: Omit<PageObservation<unknown>, 'providerId' | 'accountId' | 'items'>): Promise<void> {
    const account = await getAccount(accountId);
    if (!account) throw new TypeError('Index account does not exist');
    const indexes = items.map(item => restoreConversationIndex({ ...item.fields, key: { accountId, conversationId: item.conversationId } }));
    await withAdmissionLock(`indexes:${accountId}`, () => mergeIndexes(indexes));
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
    await withAdmissionLock(`indexes:${accountId}`, async () => {
        await mergeIndexes([index]);
        const raw = await getDetail(key);
        const existing = raw ? restoreDomainDetail(raw) : null;
        const selected = selectConversationDetail(existing ? { detail: existing } : undefined, { detail: incoming }).detail;
        if (selected !== existing) await putDetail(selected);
    });
}

export async function updateConversation(
    accountId: string,
    conversationId: string,
    patchOrUpdater: ConversationIndexPatch | ((conv: DomainConversationIndex) => ConversationIndexPatch | null | void)
): Promise<boolean> {
    return withAdmissionLock(`indexes:${accountId}`, async () => {
        const id = conversationId;
        const list = await listIndexes(accountId);
        const position = list.findIndex(c => c.key.conversationId === id);
        if (position < 0) return false;
        const old = list[position];
        const current = { ...old };
        const patch = typeof patchOrUpdater === 'function' ? patchOrUpdater(current) : patchOrUpdater;
        if (patch === null) return false;
        const incoming = restoreConversationIndex({ ...current, ...patch });
        const merged = mergeConversationIndex(old, incoming);
        if (JSON.stringify(merged) === JSON.stringify(old)) return false;
        await putIndexes([merged]);
        return true;
    });
}
