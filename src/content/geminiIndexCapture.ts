import { getConversations } from '../core/storage/conversationCatalogStore.js';
import { ingestIndexes } from '../core/domain/ingestion.js';
import { isAccountId } from '../core/domain/accountRegistry.js';
import { restoreConversationIndex, type DomainConversationIndex } from '../core/domain/conversationIndex.js';
import { parseGeminiIndexObservation, type GeminiIndexObservationSource } from '../core/parsers/gemini/parseIndexObservation.js';
import type { GeminiProviderConversationItem } from '../core/provider/gemini/geminiContracts.js';
import type { PageObservation } from '../core/domain/pageObservation.js';
import { assertSchemaWritable } from '../core/storage/schemaState.js';
import { StorageService } from '../core/storage/storageService.js';
import { __resolveModule } from '../core/utils/moduleOverrides.js';
import { normId, isReservedRoute, detectSlotFromUrl } from '../core/utils/pathUtils.js';
import { contentContext } from './contentContext.js';
import { resolveCurrentAccount, isCurrentAccount, getAccountContext } from './accountContext.js';
import { BadgeView } from './badgeView.js';
const getStorage = () => __resolveModule('StorageService', StorageService);
const updateBadge = (count: number, visible: number) => BadgeView.updateBadge(count, visible, undefined, false,
    { isZh: () => contentContext.isZh(), getAccountSlot: () => detectSlotFromUrl(typeof location === 'undefined' ? undefined : location.href) });

/** L1 browser observations normalize source facts and submit directly to Domain. */
const confirmedDeleted = new Map<string, Map<string, { at: number }>>();
/** A still-open deleted page cannot reintroduce its stale sidebar/title observations. */
export function markConfirmedDeleted(slot: string, id: string): void {
    const ids = confirmedDeleted.get(slot) ?? new Map<string, { at: number }>();
    ids.set(normId(id), { at: Date.now() }); confirmedDeleted.set(slot, ids);
}

export interface RpcListIngestResult {
    count: number;
    accepted: number;
    rejected: number;
    persisted: number;
}

const emptyIngest = (rejected = 0): RpcListIngestResult => ({ count: 0, accepted: 0, rejected, persisted: 0 });
let __storageWriteQueue = Promise.resolve<RpcListIngestResult>(emptyIngest());
let __lastKnownCount = 0;


export function upsertConversations(incomingItems: readonly unknown[], source: string, targetSlot: string | null = null): Promise<number> {
    return persistConversationBatch(incomingItems, source, targetSlot).then(result => result.count);
}

/** Both RPC acquisition paths commit through the same merge and storage transaction. */
export async function ingestRpcList(items: (GeminiProviderConversationItem | DomainConversationIndex)[], slot: string, requestedAt = Date.now(), canCommit?: () => boolean): Promise<RpcListIngestResult> {
    await assertSchemaWritable();
    return persistConversationBatch(items, 'network-list', slot, requestedAt, canCommit);
}

/** Both passive and active pages pass through this trigger-independent boundary. */
export async function ingestPageObservation(page: PageObservation<GeminiProviderConversationItem>, slot: string,
    runId?: string): Promise<RpcListIngestResult> {
    if (!isAccountId(page.accountId) || page.accountId !== slot || page.providerId !== 'gemini') {
        throw new Error('Page observation requires its captured Registry UUID');
    }
    const canCommit = () => (runId !== undefined || page.requestedAt > contentContext.getCancelledAt())
        && (runId === undefined || !contentContext.isAborted());
    if (!canCommit()) throw new Error('Page observation belongs to a stale account or cancelled request');
    return persistConversationBatch(page.items, 'network-list', slot, page.requestedAt, canCommit, page);
}

export async function persistConversationBatch(incomingItems: readonly unknown[], source: string, targetSlot: string | null = null, requestedAt = Date.now(), canCommit?: () => boolean, page?: PageObservation<unknown>): Promise<RpcListIngestResult> {
    if (!incomingItems || (!incomingItems.length && !page)) return Promise.resolve(emptyIngest());

    // Fail-Closed Integrity Gate:
    // If incoming items lack valid IDs or are malformed (e.g. schema drift resulting
    // in 'c_unknown' or missing IDs), filter them out. If no valid items remain,
    // abort storage transaction immediately to protect existing data from corruption.
    const kind: GeminiIndexObservationSource = source === 'network-list' || source === 'batchexecute' ? 'rpc-list'
        : source.includes('detail') ? 'detail' : 'dom';
    const captured = targetSlot ? null : await resolveCurrentAccount();
    const targetAccountId = targetSlot || captured?.accountId;
    if (!isAccountId(targetAccountId)) throw new Error('List ingestion requires an account UUID');
    const validIncoming: DomainConversationIndex[] = [];
    for (const item of incomingItems) {
        try {
            const index: DomainConversationIndex = item && typeof item === 'object' && 'key' in item
                ? restoreConversationIndex(item) : parseGeminiIndexObservation(item, kind, targetAccountId);
            // Validate canonical identity without reparsing or rewriting the Domain fields.
            if (index.key.accountId !== targetAccountId || index.key.conversationId !== normId(index.key.conversationId)
                || index.key.conversationId === 'unknown' || isReservedRoute(index.key.conversationId)) throw new TypeError('Invalid canonical Gemini identity');
            validIncoming.push(index);
        }
        catch (error) { if (!(error instanceof TypeError)) throw error; }
    }

    if (validIncoming.length === 0 && incomingItems.length > 0) {
        console.warn('[Gemini Exporter] Fail-Closed: incoming batch has no valid conversation IDs, aborting storage write to protect existing data.');
        return Promise.resolve(emptyIngest(incomingItems.length));
    }

    const commit = () => canCommit?.() !== false && (!captured || isCurrentAccount(captured));
    __storageWriteQueue = __storageWriteQueue.catch(() => emptyIngest()).then(async () => {
        try {
            const slot = targetAccountId;
            const Storage = getStorage();
            if (!Storage) throw new Error('Conversation storage unavailable');

            // Cross-tab: read + merge + write run atomically inside the storage
            // transaction. The old shape read outside the lock, so two tabs
            // could build on the same stale snapshot and the later write would
            // silently discard the earlier tab's updates (lost update).
            const recovered = new Map<string, { at: number }>();
            const eligible = validIncoming.filter(incoming => {
                const deletion = confirmedDeleted.get(slot)?.get(incoming.key.conversationId);
                if (deletion && (kind !== 'rpc-list' || requestedAt <= deletion.at)) return false;
                if (deletion) recovered.set(incoming.key.conversationId, deletion);
                return true;
            });
            if (!commit()) throw new Error('Account changed before index ingestion');
            const before = await getConversations(slot);
            await ingestIndexes(slot, eligible.map(({ key, ...fields }) => ({ conversationId: key.conversationId, fields })),
                page && eligible.length === incomingItems.length ? page : undefined);
            const list = await getConversations(slot);
            const written = JSON.stringify(before) !== JSON.stringify(list);
            if (kind === 'rpc-list') for (const index of eligible) {
                if (!confirmedDeleted.get(slot)?.has(index.key.conversationId) || recovered.has(index.key.conversationId)) await Storage.setConversationAvailability?.(slot, index.key.conversationId, 'available');
            }
            for (const [id, deletion] of recovered) if (confirmedDeleted.get(slot)?.get(id) === deletion) confirmedDeleted.get(slot)?.delete(id);
            const accepted = eligible.length;
            const mergedLength = list.length;
            const result: RpcListIngestResult = { count: mergedLength, accepted,
                rejected: incomingItems.length - accepted, persisted: accepted };
            if (!written) {
                if (__lastKnownCount !== mergedLength) {
                    if (getAccountContext()?.accountId === slot) updateBadge(mergedLength, incomingItems.length);
                    __lastKnownCount = mergedLength;
                }
                return result;
            }

            await Storage.setLastSync(slot, Date.now(), mergedLength);

            try {
                const p = chrome.runtime.sendMessage({
                    action: 'syncUpdate',
                    accountId: slot,
                    count: mergedLength,
                    from: source
                });
                if (p && p.catch) p.catch(() => {});
            } catch (e) {
                if (contentContext.isDevMode()) console.debug('[GemExporter:syncEngine]', e);
            }

            if (getAccountContext()?.accountId === slot) updateBadge(mergedLength, incomingItems.length);
            __lastKnownCount = mergedLength;
            return result;
        } catch (e: unknown) {
            console.error('[Gemini Exporter] upsertConversations failed', e);
            throw e;
        }
    });
    return __storageWriteQueue;
}
