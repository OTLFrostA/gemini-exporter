import { clearResourceContext } from './domain/resourceContext.js';
import { getConversationAvailability, setConversationAvailability } from './conversationAvailability.js';
import { getStorageKeys, getConversations, setConversations, transactConversations, writeConversationIndexes, withConversationLock, withCrossTabLock, requireAccountId } from './conversationCatalogStore.js';
export type { StorageKeys, ConversationTransaction } from './conversationCatalogStore.js';
import { getAccount } from '../api/accountRegistry.js';
import { assertSchemaWritable } from './schemaState.js';
import { deleteDetail, storageIdentity, getDetail } from './domain/domainStore.js';
import { createConversationRepository, type ConversationScope, type ConversationRepository } from './conversationRepository.js';
import {
    readStoredValue, type StoredObject, readStoredObject, readStoredExportMap,
    type StoredExportRecordMap,
    type StoredSyncStatus,
} from './storageCompatibility.js';
import type {
    DomainConversationIndex,
    ExportRecord,
    ReconcileOptions
} from "../../types/index.js";
import { normId } from "../utils/pathUtils.js";

import { STORAGE_KEYS } from "../utils/constants.js";

export interface ReconcileResult { kept: number; removed: number; removedIds: string[] }

export interface FinalizeExportOptions<T = ExportRecord> {
    /** Callback invoked after successful write */
    onItemExported?: (id: string, record: T) => void;
}
import {
    getDevMode,
    setDevMode,
    isTourCompleted,
    setTourCompleted,
    getLastSeenFeatureVersion,
    setLastSeenFeatureVersion,
    isVersionGreater,
    isTakeoutPromptCompleted,
    setTakeoutPromptCompleted,
    isDirectWritePromptSuppressed,
    setDirectWritePromptSuppressed,
    getZipPreference,
    setZipPreference,
    getBadgePosition,
    setBadgePosition,
    setLastSyncDiagnostics,
    setPendingTakeoutPrompt,
    setLanguagePreference
} from './userPreferences.js';

function isObjectRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }

// Durable intent outlives list metadata and every partial cleanup. These helpers
// run under the conversation lock; retire IDs only after all stores commit.
function pendingDeletionKey(slot: string | null | undefined): string {
    return `gemini_pending_deletions_${requireAccountId(slot)}`;
}

async function pendingDeletions(slot: string | null | undefined): Promise<string[]> {
    const key = pendingDeletionKey(slot);
    const data = await chrome.storage.local.get<Record<string, unknown>>([key]);
    const value = data[key];
    return Array.isArray(value)
        ? [...new Set(value.filter((id): id is string => typeof id === 'string').map(normId).filter(Boolean))]
        : [];
}

async function finishConversationDeletions(slot: string | null | undefined, ids: string[], pending: string[]): Promise<void> {
    const account = await getAccount(requireAccountId(slot));
    if (!account) throw new Error('Account does not exist');
    for (const id of ids) {
        await deleteDetail(storageIdentity(account.providerId, account.id, id));
        await clearResourceContext(storageIdentity(account.providerId, account.id, id));
    }
    await removeExportRecords(slot, ids);
    const completed = new Set(ids);
    // This cleanup already holds the conversation lock.
    const availability = await getConversationAvailability(account.id);
    for (const id of ids) delete availability[id];
    await chrome.storage.local.set({ [`conversation_availability_${account.id}`]: availability });
    await chrome.storage.local.set({ [pendingDeletionKey(slot)]: pending.filter(id => !completed.has(id)) });
}

async function removeConversation(slot: string | null | undefined, conversationId: string): Promise<boolean> {
    return withConversationLock(async () => {
        const targetId = normId(conversationId);
        if (!targetId) return false;
        await assertSchemaWritable();
        const pending = [...new Set([...await pendingDeletions(slot), targetId])];
        // Persist before removing the last discoverable list entry.
        await chrome.storage.local.set({ [pendingDeletionKey(slot)]: pending });
        const list = await getConversations(slot);
        const filtered = list.filter(c => c.key.conversationId !== targetId);
        const { convKey, countKey } = getStorageKeys(slot);
        await chrome.storage.local.set({ [convKey]: filtered, [countKey]: filtered.length });

        // An absent list entry is not proof that its body or export records are gone.
        await finishConversationDeletions(slot, [targetId], pending);
        return filtered.length !== list.length;
    });
}

async function clearConversations(slot?: string | null): Promise<void> {
    await withConversationLock(async () => {
        const { convKey, countKey, checkpointKey, coverageKey, expKey } = getStorageKeys(slot);
        const existing = await getConversations(slot);
        await assertSchemaWritable();
        const ids = [...new Set([...await pendingDeletions(slot), ...(existing || []).map(c => c.key.conversationId).filter(Boolean)])];
        if (ids.length > 0) {
            await chrome.storage.local.set({ [pendingDeletionKey(slot)]: ids });
            await finishConversationDeletions(slot, ids, ids);
        }
        const toSet: Record<string, unknown> = {
            [convKey]: [],
            [countKey]: 0,
            [expKey]: {},
            [coverageKey]: {}
        };
        await chrome.storage.local.set(toSet);
        await chrome.storage.local.remove([checkpointKey]);

    });
}

async function reconcileConversations(slot: string | null | undefined,
    _activeCloudList: readonly { id?: string | number | null }[], _options: ReconcileOptions = {}): Promise<ReconcileResult> {
    // Absence from a cloud page is never permission to delete a local archive.
    return { kept: (await getConversations(slot)).length, removed: 0, removedIds: [] };
}

async function getExportedIds(slot?: string | null): Promise<StoredExportRecordMap> {
    const { expKey } = getStorageKeys(slot);
    const data = await chrome.storage.local.get<Record<string, unknown>>([expKey]);
    const raw = data[expKey];
    const records: StoredExportRecordMap = (typeof raw === 'object' && raw !== null)
        ? { ...readStoredExportMap(raw) }
        : {};
    collapseExportAliases(records);
    return records;
}

function canonicalExportKey(id: string | number | null | undefined): string {
    return normId(id);
}

function normalizeExportRecordKeys(records: StoredExportRecordMap): StoredExportRecordMap {
    const out: StoredExportRecordMap = {};
    for (const [k, v] of Object.entries(records || {})) {
        const ck = canonicalExportKey(k);
        if (!ck) continue;
        out[ck] = v;
    }
    return out;
}

function collapseExportAliases(map: StoredExportRecordMap): void {
    for (const k of Object.keys(map)) {
        const ck = canonicalExportKey(k);
        if (!ck || ck === k) continue;
        if (!(ck in map)) {
            map[ck] = map[k];
        }
        delete map[k];
    }
}

let _saveRecordChain: Promise<void> = Promise.resolve();
function enqueueSaveRecordChain<T>(fn: () => Promise<T>): Promise<T> {
    const run = () => withCrossTabLock('export-records', fn);
    const result = _saveRecordChain.then(run, run);
    _saveRecordChain = result.then(() => undefined, () => undefined);
    return result;
}

async function saveExportRecord<T = unknown>(
    slot: string | null | undefined,
    id: string,
    record: T
): Promise<StoredExportRecordMap> {
    const ck = canonicalExportKey(id);
    if (!ck) {
        throw new Error('[StorageService] saveExportRecord: empty conversation id');
    }
    return saveExportRecordsBatch(slot, { [ck]: record });
}

interface StorageFinalizeDelegate {
    saveExportRecord?: <T = unknown>(slot: string | null | undefined, id: string, record: T) => Promise<StoredExportRecordMap>;
}

async function finalizeConversationExport<T = ExportRecord>(
    slot: string | null | undefined,
    id: string | number,
    record: T,
    options?: FinalizeExportOptions<T>
): Promise<{ ok: boolean; record: T }> {
    const targetId = normId(id);
    if (!targetId) {
        throw new Error('[StorageService] finalizeConversationExport: empty conversation id');
    }

    const selfDelegate: StorageFinalizeDelegate | null = typeof StorageService !== 'undefined' ? StorageService : null;
    const doSaveRecord = selfDelegate?.saveExportRecord || saveExportRecord;

    // 1. Serialized record write to the account-scoped export records
    await doSaveRecord(slot, targetId, record);

    // 3. Trigger callback if provided
    try {
        options?.onItemExported?.(targetId, record);
    } catch (e) {
        console.debug?.('[StorageService] onItemExported callback error', e);
    }

    return { ok: true, record };
}

async function saveExportRecordsBatch<T = unknown>(
    slot: string | null | undefined,
    records: Record<string, T>
): Promise<StoredExportRecordMap> {
    return enqueueSaveRecordChain(async () => {
        const { expKey } = getStorageKeys(slot);
        const data = await chrome.storage.local.get<Record<string, unknown>>([expKey]);
        const raw = data[expKey];
        const cur: StoredExportRecordMap = (typeof raw === 'object' && raw !== null)
            ? { ...readStoredExportMap(raw) }
            : {};
        collapseExportAliases(cur);
        Object.assign(cur, normalizeExportRecordKeys(readStoredExportMap(records)));
        const updates: Record<string, unknown> = { [expKey]: cur };
        await chrome.storage.local.set(updates);
        return cur;
    });
}

async function removeExportRecords(slot: string | null | undefined, ids: string[] | null | undefined): Promise<number> {
    if (!ids || ids.length === 0) return 0;
    const aliasKeys = new Set<string>();
    for (const id of ids) {
        if (id === null || id === undefined) continue;
        const raw = String(id);
        const nid = normId(raw);
        if (raw) aliasKeys.add(raw);
        if (nid) {
            aliasKeys.add(nid);
            aliasKeys.add('c_' + nid);
        }
    }
    if (aliasKeys.size === 0) return 0;
    const { expKey } = getStorageKeys(slot);
    return enqueueSaveRecordChain(async () => {
        const data = await chrome.storage.local.get<Record<string, unknown>>([expKey]);
        const rawOwn = data[expKey];
        const ownMap: Record<string, unknown> = isObjectRecord(rawOwn) ? { ...rawOwn } : {};
        // Keys this slot owns among the doomed ids — used to conservatively
        // sweep only this slot's historical pollution out of the global key.
        const ownedBefore = new Set<string>();
        for (const mk of Object.keys(ownMap)) {
            if (aliasKeys.has(mk) || (normId(mk) && aliasKeys.has(normId(mk)))) {
                ownedBefore.add(mk);
            }
        }
        let removed = 0;
        for (const mk of ownedBefore) {
            delete ownMap[mk];
            removed++;
        }
        const updates: Record<string, unknown> = { [expKey]: ownMap };
        if (removed > 0) await chrome.storage.local.set(updates);
        return removed;
    });
}

async function getLastSync(slot?: string | null): Promise<StoredSyncStatus> {
    const { syncKey, countKey } = getStorageKeys(slot);
    const data = await chrome.storage.local.get<Record<string, unknown>>([syncKey, countKey]);
    const rawTs = data[syncKey];
    const rawCount = data[countKey];
    return {
        timestamp: readStoredValue(rawTs) || null,
        count: readStoredValue(rawCount) || 0
    };
}

async function setLastSync(slot: string | null | undefined, timestamp?: number | null, count?: number): Promise<void> {
    // Cross-tab: a blind write here could pair a stale count with a newer
    // list (or vice versa) when two tabs upsert concurrently. Serialize it
    // with the conversation lock so timestamp/count stay consistent with
    // the list write they describe. Leaf call — never nested inside another
    // conversation-locked section.
    return withConversationLock(async () => {
        const { syncKey, countKey } = getStorageKeys(slot);
        await chrome.storage.local.set({
            [syncKey]: timestamp || Date.now(),
            [countKey]: typeof count === 'number' ? count : 0
        });
    });
}

async function setHasImportedTakeout(imported: boolean = true): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    try {
        await chrome.storage.local.set({ [STORAGE_KEYS.HAS_IMPORTED_TAKEOUT]: !!imported });
    } catch (e) { console.warn("[GemExporter:storage] Storage operation failed:", e); }
}

async function hasTakeoutData(slot?: string | null): Promise<boolean> {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return false;
    try {
        const data = await chrome.storage.local.get<Record<string, unknown>>([STORAGE_KEYS.HAS_IMPORTED_TAKEOUT]);
        if (data && data[STORAGE_KEYS.HAS_IMPORTED_TAKEOUT]) return true;
        return false;
    } catch {
        return false;
    }
}

function conversationRepository(scope: ConversationScope): ConversationRepository {
    const accountId = requireAccountId(scope.accountId);
    return createConversationRepository({ ...scope, accountId }, {
        readIndexes: () => getConversations(accountId), readBody: getDetail, readConsistently: withConversationLock,
    });
}

export {
    conversationRepository,
    normId,
    getStorageKeys,
    getConversations,
    setConversations,
    transactConversations,
    removeConversation,
    clearConversations,
    reconcileConversations,
    getExportedIds,
    saveExportRecord,
    finalizeConversationExport,
    saveExportRecordsBatch,
    removeExportRecords,
    getLastSync,
    setLastSync,
    getDevMode,
    setDevMode,
    isTourCompleted,
    setTourCompleted,
    getLastSeenFeatureVersion,
    setLastSeenFeatureVersion,
    isVersionGreater,
    isTakeoutPromptCompleted,
    setTakeoutPromptCompleted,
    hasTakeoutData,
    setHasImportedTakeout,
    isDirectWritePromptSuppressed,
    setDirectWritePromptSuppressed,
    getZipPreference,
    setZipPreference,
    getBadgePosition,
    setBadgePosition,
    setLastSyncDiagnostics,
    setPendingTakeoutPrompt,
    setLanguagePreference
};

export const StorageService = {
    getConversationAvailability, setConversationAvailability,
    conversationRepository,
    normId,
    getStorageKeys,
    getConversations,
    setConversations,
    transactConversations,
    removeConversation,
    clearConversations,
    reconcileConversations,
    getExportedIds,
    saveExportRecord,
    finalizeConversationExport,
    saveExportRecordsBatch,
    removeExportRecords,
    getLastSync,
    setLastSync,
    getDevMode,
    setDevMode,
    isTourCompleted,
    setTourCompleted,
    getLastSeenFeatureVersion,
    setLastSeenFeatureVersion,
    isVersionGreater,
    isTakeoutPromptCompleted,
    setTakeoutPromptCompleted,
    hasTakeoutData,
    setHasImportedTakeout,
    isDirectWritePromptSuppressed,
    setDirectWritePromptSuppressed,
    getZipPreference,
    setZipPreference,
    getBadgePosition,
    setBadgePosition,
    setLastSyncDiagnostics,
    setPendingTakeoutPrompt,
    setLanguagePreference
};

export type StorageServiceModule = typeof StorageService;

export default StorageService;
