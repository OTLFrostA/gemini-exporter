import { toTimestampMs } from '../utils/titleUtils.js';
import { parseLegacyStorageConversation } from '../parsers/legacyStorage/parseConversation.js';
import { deduplicateConversations } from '../utils/mergeUtils.js';
import { restoreConversationIndex, mergeConversationIndex, compareConversationIndexes, type ConversationIndexPatch } from '../domain/conversationIndex.js';
import { parseIndexObservation, indexFromDetail } from '../compatibility/index/parseIndex.js';
import { CoverageSession, emptyStream, type StreamCoverage } from '../sync/streamCoverage.js';
import type { PageObservation } from '../sync/pageObservation.js';
import { readScanCoverage, type ScanCoverage, type ScanCoverageBaseline, type ScanCoverageRun } from './scanCoverage.js';
import type { ScanStatus } from '../../types/ui.js';
import { assertSchemaWritable } from './schemaState.js';
import { type ResourceConversationParseResult } from '../parsers/parsingResult.js';
import { getDomainConversationResult } from './domain/nativePersistence.js';
import { backupLegacyValue, saveDomainConversation, removeStoredDomain, storageIdentity } from './domain/domainStore.js';
import {
    readStoredValue, type StoredObject, readStoredObject, readStoredExportMap, readStoredSlotMap,
    type StoredExportRecordMap,
    type StoredAccountSlotMap, type StoredSyncStatus,
} from './storageCompatibility.js';
import type {
    DomainConversationIndex,
    ExportRecord,
    AccountSlotInfo,
    AccountSlots,
    ReconcileOptions
} from "../../types/index.js";
import { normId } from "../utils/pathUtils.js";

import { STORAGE_KEYS } from "../utils/constants.js";

export interface FinalizeExportOptions<T = ExportRecord> {
    /** Whether to skip updating conversation in gemini_conversations (defaults to false) */
    skipConversationUpdate?: boolean;
    /** DomainConversationIndex fields to update/merge into gemini_conversations */
    conversationUpdate?: ConversationIndexPatch;
    /** Callback invoked after successful write */
    onItemExported?: (id: string, record: T) => void;
}
import {
    removeConversationDetails,
    getConversationDetail,
    clearAllDetails
} from './conversationDetailStore.js';
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

export interface StorageKeys {
    slot: string;
    convKey: string;
    expKey: string;
    syncKey: string;
    countKey: string;
    checkpointKey: string;
    coverageKey: string;
}


export interface ReconcileResult {
    kept: number;
    removed: number;
    removedIds: string[];
}

export interface ConversationTransaction {
    /** List to persist. Must be a fresh array; the stored list is replaced wholesale. */
    list: DomainConversationIndex[];
    /** How many items the merge changed (drives badge / skip-write decisions). */
    changed: number;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function normSlot(slot?: string | null): string {
    if (!slot || slot === 'default' || slot === 'u0') return 'u0';
    const m = String(slot).match(/u(\d+)/i);
    return m ? ('u' + m[1]) : 'u0';
}

function getStorageKeys(slot?: string | null): StorageKeys {
    const s = normSlot(slot);
    return {
        slot: s,
        convKey: s === 'u0' ? 'gemini_conversations' : `gemini_conversations_${s}`,
        expKey: s === 'u0' ? 'exportedIds' : `gemini_exported_${s}`,
        syncKey: s === 'u0' ? 'gemini_last_sync' : `gemini_last_sync_${s}`,
        countKey: s === 'u0' ? 'gemini_last_count' : `gemini_last_count_${s}`,
        coverageKey: s === 'u0' ? STORAGE_KEYS.SCAN_COVERAGE : `${STORAGE_KEYS.SCAN_COVERAGE}_${s}`,
        checkpointKey: s === 'u0' ? 'gemini_scan_checkpoint' : `gemini_scan_checkpoint_${s}`
    };
}

async function getConversations(slot?: string | null): Promise<DomainConversationIndex[]> {
    const { convKey } = getStorageKeys(slot);
    const data = await chrome.storage.local.get<Record<string, unknown>>([convKey]);
    const raw = data[convKey];
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) throw new TypeError('Invalid conversation index container');
    const indexes = raw.map(restoreConversationIndex);
    const ids = new Set(indexes.map(c => JSON.stringify([c.providerId, c.id])));
    if (ids.size !== indexes.length) throw new TypeError('Duplicate conversation index identity');
    return indexes;
}

/** Startup-only conversion. Backups commit before slimming any legacy metadata. */
export async function migrateConversationIndexes(): Promise<void> {
    await withConversationLock(async () => {
        const all = await chrome.storage.local.get<Record<string, unknown>>(null);
        const containers = Object.entries(all).filter(([key]) => key === 'gemini_conversations' || /^gemini_conversations_u\d+$/.test(key));
        const issues: Array<{ key: string; code: string; message: string }> = [];
        const bySlot = new Map<string, DomainConversationIndex[]>();
        // Preserve malformed containers as well as rejected rows; never lose recovery evidence.
        for (const [key, value] of containers) await backupLegacyValue(`index-v2:${key}`, value);
        for (const [key, value] of containers) {
            const slot = key === 'gemini_conversations' ? 'u0' : normSlot(key.slice('gemini_conversations_'.length));
            const list = bySlot.get(slot) ?? [];
            bySlot.set(slot, list);
            if (!Array.isArray(value)) {
                issues.push({ key, code: 'INVALID_CONTAINER', message: 'Original index container retained in migration backup' });
                continue;
            }
            for (const [position, row] of value.entries()) {
                let index: DomainConversationIndex;
                try {
                    try { index = restoreConversationIndex(row); }
                    catch { index = parseIndexObservation(row, 'legacy'); }
                } catch (error) {
                    if (!(error instanceof TypeError)) throw error;
                    issues.push({ key: `${key}[${position}]`, code: 'INVALID_ROW', message: error.message });
                    continue;
                }
                if (isObjectRecord(row) && (Array.isArray(row.messages) || Array.isArray(row.turns))) {
                    let parsed: ResourceConversationParseResult | undefined;
                    try { parsed = parseLegacyStorageConversation({ metadata: row }, { providerId: index.providerId }); }
                    catch (error) {
                        if (!(error instanceof TypeError)) throw error;
                        issues.push({ key: `${key}[${position}]`, code: 'INVALID_BODY', message: error.message });
                    }
                    if (parsed) await saveDomainConversation(slot, parsed, [], true);
                }
                const body = await getDomainConversationResult(slot, index.id, index.providerId);
                if (body && (body.conversation.messages.length > 0 || body.conversation.completeness === 'complete')) index.messageCount = Math.max(index.messageCount ?? 0, body.conversation.messages.length);
                list.push(index);
            }
        }

        for (const [slot, rows] of bySlot) {
            const { processed } = deduplicateConversations(rows);
            await _setConversationsRaw(slot, processed);
        }
        // Alias removal happens only after the canonical list and report are durable.
        const reportKey = 'gemini_index_migration_v2';
        const oldReport = all[reportKey];
        const previousIssues = isObjectRecord(oldReport) && Array.isArray(oldReport.issues) ? oldReport.issues : [];
        await chrome.storage.local.set({ [reportKey]: { issues: [...new Map([...previousIssues, ...issues].map(issue => [JSON.stringify(issue), issue])).values()] } });
        if ('gemini_conversations_u0' in all) await chrome.storage.local.remove('gemini_conversations_u0');
    });
}

let _convChain: Promise<void> = Promise.resolve();

// Cross-tab write serialization.
//
// Every Gemini tab runs its own content-script JS context, so the in-memory
// promise chains below (_convChain / _slotChain / _saveRecordChain) only
// serialize writes *within* one tab. chrome.storage.local is shared across
// tabs, so two tabs could still interleave read-modify-write cycles: both
// read the same stale snapshot, then the later write silently discards the
// earlier tab's updates (classic lost update).
//
// navigator.locks (Web Locks API) is held per origin across tabs, workers
// and the service worker, so requesting a named lock here upgrades each
// chain to a truly global mutex. The lock is taken *inside* the in-memory
// chain, so a tab only holds the global lock while its own critical section
// runs — never while waiting behind its own queued work. Lock order is
// unchanged (conv -> slot, conv -> save-record; no path takes them in
// reverse), and Web Locks are never nested for the same name.
//
// When Web Locks is unavailable (very old Chrome, non-window test envs)
// the in-memory chain remains as the fallback, preserving the previous
// within-tab guarantee.
const XTAB_LOCK_PREFIX = 'gemini-exporter:write:';

interface WebLockManager {
    request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

function getWebLocks(): WebLockManager | null {
    try {
        if (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function') {
            return navigator.locks;
        }
    } catch { /* non-window contexts: fall through to in-memory chain */ }
    return null;
}

function withCrossTabLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const locks = getWebLocks();
    if (locks) {
        return locks.request(XTAB_LOCK_PREFIX + name, fn);
    }
    return fn();
}

function withConversationLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = () => withCrossTabLock('conversations', fn);
    const p = _convChain.then(run, run);
    _convChain = p.then(() => {}, () => {});
    return p;
}

let _slotChain: Promise<void> = Promise.resolve();
function withSlotLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = () => withCrossTabLock('account-slot', fn);
    const p = _slotChain.then(run, run);
    _slotChain = p.then(() => {}, () => {});
    return p;
}

/** Canonical index writes never inspect or persist conversation bodies. */
async function _setConversationsRaw(slot: string | null | undefined, list: readonly DomainConversationIndex[]): Promise<DomainConversationIndex[]> {
    await assertSchemaWritable();
    const indexes = list.map(restoreConversationIndex);
    if (new Set(indexes.map(c => JSON.stringify([c.providerId, c.id]))).size !== indexes.length) throw new TypeError('Duplicate conversation index identity');
    indexes.sort(compareConversationIndexes);
    await chrome.storage.local.set({ [getStorageKeys(slot).convKey]: indexes });
    return indexes;
}
async function setConversations(slot: string | null | undefined, list: readonly DomainConversationIndex[]): Promise<void> {
    await withConversationLock(() => _setConversationsRaw(slot, list));
}
/** Explicit native import; the list setter cannot hide a second body write. */
async function setNativeConversations(slot: string | null | undefined, list: readonly ResourceConversationParseResult[]): Promise<void> {
    await withConversationLock(async () => {
        const metadata: DomainConversationIndex[] = [];
        for (const parsed of list) {
            const selected = await saveDomainConversation(normSlot(slot), parsed);
            metadata.push(indexFromDetail(selected.conversation, 'snapshot'));
            // Persisting a local native snapshot is not evidence of current cloud availability.
        }
        await _setConversationsRaw(slot, metadata);
    });
}

// Atomic read-merge-write for the conversation list.
//
// The updater runs *inside* the cross-tab conversation lock: it receives the
// freshest stored list and returns the list to persist, or null to skip the
// write. The updater must be pure (no storage I/O, no awaits) so the lock is
// only held across one storage get + one storage set.
//
// Callers must NOT read the list first and merge outside: that is exactly the
// cross-tab lost-update hole this closes (two tabs read the same snapshot,
// the later write discards the earlier tab's merge).
async function transactConversations(
    slot: string | null | undefined,
    updater: (existing: DomainConversationIndex[]) => ConversationTransaction | null
): Promise<{ list: DomainConversationIndex[]; changed: number; written: boolean }> {
    return withConversationLock(async () => {
        const existing = await getConversations(slot);
        const result = updater(existing);
        if (!result) return { list: existing, changed: 0, written: false };
        const list = await _setConversationsRaw(slot, result.list);
        return { list, changed: result.changed, written: true };
    });
}
async function updateConversation(
    slot: string | null | undefined,
    conversationId: string,
    patchOrUpdater: ConversationIndexPatch | ((conv: DomainConversationIndex) => ConversationIndexPatch | null | void)
): Promise<boolean> {
    return withConversationLock(async () => {
        const id = normId(conversationId);
        const list = await getConversations(slot);
        const position = list.findIndex(c => c.id === id);
        if (position < 0) return false;
        const old = list[position];
        const current = { ...old };
        const patch = typeof patchOrUpdater === 'function' ? patchOrUpdater(current) : patchOrUpdater;
        if (patch === null) return false;
        const incoming = restoreConversationIndex({ ...current, ...patch });
        const merged = mergeConversationIndex(old, incoming);
        if (JSON.stringify(merged) === JSON.stringify(old)) return false;
        list[position] = merged;
        await _setConversationsRaw(slot, list);
        return true;
    });
}

// Durable intent outlives list metadata and every partial cleanup. These helpers
// run under the conversation lock; retire IDs only after all stores commit.
function pendingDeletionKey(slot: string | null | undefined): string {
    return `gemini_pending_deletions_${normSlot(slot)}`;
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
    for (const id of ids) await removeStoredDomain(storageIdentity('gemini', normSlot(slot), id));
    await removeConversationDetails(ids);
    await removeExportRecords(slot, ids);
    const completed = new Set(ids);
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
        const filtered = list.filter(c => c.id !== targetId);
        const { convKey, countKey } = getStorageKeys(slot);
        await chrome.storage.local.set({ [convKey]: filtered, [countKey]: filtered.length });
        await updateAccountSlot(slot, { count: filtered.length });
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
        const ids = [...new Set([...await pendingDeletions(slot), ...(existing || []).map(c => c.id).filter(Boolean)])];
        if (ids.length > 0) {
            await chrome.storage.local.set({ [pendingDeletionKey(slot)]: ids });
            await finishConversationDeletions(slot, ids, ids);
        }
        const toSet: Record<string, unknown> = {
            [convKey]: [],
            [countKey]: 0,
            [expKey]: {},
            [coverageKey]: { resetAt: Date.now() }
        };
        await chrome.storage.local.set(toSet);
        await chrome.storage.local.remove([checkpointKey]);
        await updateAccountSlot(slot, { count: 0 });
    });
}

async function reconcileConversations(
    slot: string | null | undefined,
    activeCloudList: readonly { id?: string | number | null }[],
    options: ReconcileOptions = {}
): Promise<ReconcileResult> {
    return withConversationLock(async () => {
        const keepTakeout = options.keepTakeout !== false;
        const existing = await getConversations(slot);
        const pending = await pendingDeletions(slot);

        const activeIdSet = new Set<string>();
        (activeCloudList || []).forEach(c => {
            if (c && c.id) {
                activeIdSet.add(normId(c.id));
            }
        });

        const kept: DomainConversationIndex[] = [];
        const removedIds = new Set(pending);

        for (const conv of existing) {

            const nid = conv.id;
            const isTakeout = keepTakeout && conv.hasTakeoutImport;

            if (!removedIds.has(nid) && (activeIdSet.has(nid) || isTakeout)) {
                kept.push(conv);
            } else {
                removedIds.add(nid);
            }
        }

        const deletionIds = [...removedIds];
        if (deletionIds.length > 0) {
            await assertSchemaWritable();
            await chrome.storage.local.set({ [pendingDeletionKey(slot)]: deletionIds });
            const { convKey, countKey } = getStorageKeys(slot);
            await chrome.storage.local.set({
                [convKey]: kept,
                [countKey]: kept.length
            });
            await updateAccountSlot(slot, { count: kept.length });
            await finishConversationDeletions(slot, deletionIds, deletionIds);
        }

        return {
            kept: kept.length,
            removed: deletionIds.length,
            removedIds: deletionIds
        };
    });
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

async function setExportedIds(slot: string | null | undefined, map: StoredExportRecordMap): Promise<void> {
    const { expKey, slot: s } = getStorageKeys(slot);
    const canonical = normalizeExportRecordKeys(map);
    const updates: Record<string, unknown> = { [expKey]: canonical || {} };
    if (s === 'u0') {
        updates['exportedIds'] = canonical || {};
    }
    await chrome.storage.local.set(updates);
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

async function migrateExportAliases(slot: string | null | undefined): Promise<boolean> {
    return enqueueSaveRecordChain(async () => {
        const { expKey, slot: s } = getStorageKeys(slot);
        const readKeys = s === 'u0' ? ['exportedIds', 'gemini_exported_u0'] : [expKey];
        const data = await chrome.storage.local.get<Record<string, unknown>>(readKeys);
        const merged: StoredExportRecordMap = {};
        for (const k of readKeys) {
            const m = data[k];
            if (isObjectRecord(m)) {
                Object.assign(merged, readStoredExportMap(m));
            }
        }
        const before = Object.keys(merged);
        const hasLegacyU0 = s === 'u0' && Boolean(data['gemini_exported_u0']);
        if (!before.length && !hasLegacyU0) return false;
        const canonical = normalizeExportRecordKeys(merged);
        const after = Object.keys(canonical);
        const changed = after.length !== before.length || !before.every(k => after.includes(k)) || hasLegacyU0;
        if (!changed) return false;
        await setExportedIds(slot, canonical);
        if (hasLegacyU0 && typeof chrome.storage.local.remove === 'function') {
            await chrome.storage.local.remove(['gemini_exported_u0']);
        }
        return true;
    });
}

let _saveRecordChain: Promise<void> = Promise.resolve();
function enqueueSaveRecordChain<T>(fn: () => Promise<T>): Promise<T> {
    const run = () => withCrossTabLock('export-records', fn);
    const p = _saveRecordChain.then(run, run);
    _saveRecordChain = p.then(() => undefined, () => undefined);
    return p;
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

    // 1. Serialized record write to exportedIds SSoT
    await doSaveRecord(slot, targetId, record);

    // Completion is acquisition evidence, normalized once before index rules apply.
    if (!options?.skipConversationUpdate) {
        try {
            const update = options?.conversationUpdate ?? {};
            const rec = isObjectRecord(record) ? readStoredObject(record) : {};
            const incoming = parseIndexObservation({ id: targetId, ...update,
                title: update.title ?? (typeof rec.title === 'string' ? rec.title : undefined),
                titleSource: update.titleSource ?? 'legacy',
                messageCount: update.messageCount ?? rec.messageCount,
                updatedAt: update.updatedAt ?? toTimestampMs(rec.chatTime) }, 'export');
            await withConversationLock(async () => {
                const list = await getConversations(slot);
                const position = list.findIndex(c => c.id === targetId);
                const merged = mergeConversationIndex(position < 0 ? undefined : list[position], incoming);
                if (position < 0) list.push(merged); else list[position] = merged;
                await _setConversationsRaw(slot, list);
            });
        } catch (error) {
            console.warn('[StorageService] finalizeConversationExport index update failed for', targetId, error);
        }
    }

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
        const { expKey, slot: s } = getStorageKeys(slot);
        const data = await chrome.storage.local.get<Record<string, unknown>>([expKey]);
        const raw = data[expKey];
        const cur: StoredExportRecordMap = (typeof raw === 'object' && raw !== null)
            ? { ...readStoredExportMap(raw) }
            : {};
        collapseExportAliases(cur);
        Object.assign(cur, normalizeExportRecordKeys(readStoredExportMap(records)));
        const updates: Record<string, unknown> = { [expKey]: cur };
        if (s === 'u0') {
            updates['exportedIds'] = cur;
        }
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
    const { expKey, slot: s } = getStorageKeys(slot);
    return enqueueSaveRecordChain(async () => {
        const sweepGlobal = s !== 'u0';
        const readKeys = sweepGlobal ? [expKey, 'exportedIds'] : [expKey];
        const data = await chrome.storage.local.get<Record<string, unknown>>(readKeys);
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
        if (sweepGlobal) {
            const rawGlobal = data['exportedIds'];
            const g: Record<string, unknown> | null = isObjectRecord(rawGlobal) ? { ...rawGlobal } : null;
            if (g) {
                let gRemoved = 0;
                const ownedNids = new Set<string>();
                for (const k of ownedBefore) {
                    const nk = normId(k);
                    if (nk) ownedNids.add(nk);
                }
                for (const mk of Object.keys(g)) {
                    const nmk = normId(mk);
                    if ((nmk && ownedNids.has(nmk)) || ownedBefore.has(mk)) {
                        delete g[mk];
                        gRemoved++;
                    }
                }
                if (gRemoved > 0) updates['exportedIds'] = g;
            }
        }
        if (removed > 0 || (sweepGlobal && updates['exportedIds'])) {
            await chrome.storage.local.set(updates);
        }
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

async function getScanCoverage(slot?: string | null): Promise<ScanCoverage | null> {
    const { coverageKey } = getStorageKeys(slot);
    const data = await chrome.storage.local.get<Record<string, unknown>>([coverageKey]);
    return readScanCoverage(data[coverageKey]);
}

const pageSessions = new Map<string, CoverageSession>();
const pageSessionKey = (slot: string, coverage: ScanCoverage, streamId: string) =>
    JSON.stringify([slot, coverage.generation, coverage.providerId, coverage.accountId, streamId]);

async function preparePageCoverage(slot: string, accountId: string | null, providerId = 'gemini', resetUnknown = false): Promise<ScanCoverage> {
    return withConversationLock(async () => {
        await assertSchemaWritable();
        const current = await getScanCoverage(slot);
        if (!resetUnknown && current && current.accountId === accountId && current.providerId === providerId) return current;
        const { coverageKey } = getStorageKeys(slot);
        const raw = (await chrome.storage.local.get<Record<string, unknown>>([coverageKey]))[coverageKey];
        const resetAt = current?.resetAt ?? (isObjectRecord(raw) && typeof raw.resetAt === 'number' ? raw.resetAt : 0);
        const next: ScanCoverage = { version: 3, providerId, revision: current?.revision ?? 1, generation: crypto.randomUUID(),
            resetAt, accountId, initialized: false, historyComplete: false, streams: {}, complete: false,
            baseline: null, lastStatus: null, activeRunId: null };
        await chrome.storage.local.set({ [coverageKey]: next });
        return next;
    });
}

/** Page data must have been fully persisted before entering this transaction. */
async function recordPageCoverage<T>(slot: string, page: PageObservation<T>, context: ScanCoverage,
    requireOrder: boolean, expectedStreams: readonly string[], runId?: string, canCommit?: () => boolean): Promise<boolean> {
    return withConversationLock(async () => {
        await assertSchemaWritable();
        const current = await getScanCoverage(slot);
        if (!current || current.generation !== context.generation || current.providerId !== page.providerId
            || page.accountId === null || current.accountId !== page.accountId || canCommit?.() === false
            || runId !== undefined && current.activeRunId !== runId
            || !Number.isFinite(page.requestedAt) || page.requestedAt <= current.resetAt) return false;
        const sessionKey = pageSessionKey(slot, current, page.streamId);
        let session = pageSessions.get(sessionKey);
        if (!session) {
            session = new CoverageSession(); pageSessions.set(sessionKey, session);
            if (pageSessions.size > 64) pageSessions.delete(pageSessions.keys().next().value!);
        }
        const previous = current.streams[page.streamId] ?? emptyStream();
        const stream = session.observe(previous, page, requireOrder, runId !== undefined || current.activeRunId === null);
        if (stream === previous) return true;
        const streams = { ...current.streams, [page.streamId]: stream };
        const historyComplete = expectedStreams.every(id => streams[id]?.historyComplete === true);
        const next = { ...current, streams, initialized: Object.values(streams).some(value => value.initialized),
            historyComplete, complete: historyComplete };
        if (canCommit?.() === false) return false;
        await chrome.storage.local.set({ [getStorageKeys(slot).coverageKey]: next });
        return true;
    });
}

/** Query the same committed page chain; passive observations alone never complete a scan. */
async function hasScanCoverageOverlap<T>(slot: string, runId: string, head: PageObservation<T>,
    previous: StreamCoverage, canCommit?: () => boolean): Promise<boolean> {
    return withConversationLock(async () => {
        const current = await getScanCoverage(slot);
        if (!current || current.activeRunId !== runId || current.accountId === null
            || current.accountId !== head.accountId || current.providerId !== head.providerId
            || head.requestedAt <= current.resetAt || canCommit?.() === false) return false;
        return pageSessions.get(pageSessionKey(slot, current, head.streamId))?.connects(previous, head) ?? false;
    });
}

/** Freeze the previous coverage and invalidate older active runs under the cross-tab lock. */
async function beginScanCoverage(slot: string, accountId: string | null): Promise<ScanCoverageRun> {
    const prepared = await preparePageCoverage(slot, accountId, 'gemini', accountId === null);
    return withConversationLock(async () => {
        await assertSchemaWritable();
        const previous = await getScanCoverage(slot);
        if (!previous || previous.generation !== prepared.generation) throw new Error('Coverage was cleared or account changed');
        const runId = crypto.randomUUID();
        const coverage = { ...previous, revision: previous.revision + (previous.activeRunId || previous.lastStatus ? 1 : 0), activeRunId: runId };
        await chrome.storage.local.set({ [getStorageKeys(slot).coverageKey]: coverage });
        return { runId, previous: accountId !== null && (previous.initialized || previous.lastStatus !== null) ? previous : null };
    });
}

async function isScanCoverageCurrent(slot: string, runId: string): Promise<boolean> {
    return (await getScanCoverage(slot))?.activeRunId === runId;
}

async function finishScanCoverage(slot: string, runId: string, status: ScanStatus,
    baseline: ScanCoverageBaseline | null = null, _visibleIds?: readonly string[], canCommit?: () => boolean): Promise<boolean> {
    return withConversationLock(async () => {
        await assertSchemaWritable();
        const current = await getScanCoverage(slot);
        if (!current || current.activeRunId !== runId || canCommit?.() === false) return false;
        if (status === 'complete' && (!current.historyComplete || !current.complete
            || !['pinned', 'recent'].every(id => current.streams[id]?.historyComplete === true
                && pageSessions.get(pageSessionKey(slot, current, id))?.exhausted()))) {
            throw new Error('Natural traversal ended without durable complete coverage');
        }
        if (status === 'up_to_date' && (current.streams.recent?.orderingInvalidated || !current.streams.recent?.range)) {
            throw new Error('Incremental completion requires trusted activity coverage');
        }
        const { coverageKey } = getStorageKeys(slot);
        const exhaustive = status === 'complete' && baseline !== null;
        const next: ScanCoverage = { ...current, activeRunId: null, lastStatus: status,
            baseline: exhaustive ? baseline : current.baseline };
        const write: Record<string, unknown> = { [coverageKey]: next };
        if (canCommit?.() === false) return false;
        await chrome.storage.local.set(write);
        return true;
    });
}

async function getAccountSlots(): Promise<StoredAccountSlotMap> {
    const data = await chrome.storage.local.get<Record<string, unknown>>([STORAGE_KEYS.ACCOUNT_SLOTS]);
    const raw = data[STORAGE_KEYS.ACCOUNT_SLOTS];
    return isObjectRecord(raw) ? readStoredSlotMap(raw) : {};
}

async function setAccountSlots(map: AccountSlots | Record<string, unknown>): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEYS.ACCOUNT_SLOTS]: map || {} });
}

async function updateAccountSlot(
    slot: string | null | undefined,
    info: Partial<AccountSlotInfo> | Record<string, unknown> | null | undefined
): Promise<StoredAccountSlotMap> {
    return withSlotLock(async () => {
        const s = normSlot(slot);
        const map: StoredAccountSlotMap = await getAccountSlots();
        const cleanInfo: StoredObject = {};
        if (isObjectRecord(info)) {
            for (const [k, v] of Object.entries(info)) {
                if (v !== undefined) {
                    cleanInfo[k] = readStoredValue(v);
                }
            }
        }
        const existingSlot = isObjectRecord(map[s]) ? readStoredObject(map[s]) : {};
        const nextSlot = { ...existingSlot, ...cleanInfo };
        map[s] = readStoredSlotMap({ [s]: nextSlot })[s];
        await setAccountSlots(map);
        return map;
    });
}

async function setHasImportedTakeout(imported: boolean = true): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    try {
        await chrome.storage.local.set({ [STORAGE_KEYS.HAS_IMPORTED_TAKEOUT]: !!imported });
    } catch (e) { console.warn("[GemExporter:storage] Storage operation failed:", e); }
}

async function hasTakeoutData(slot: string | null = 'u0'): Promise<boolean> {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return false;
    try {
        const data = await chrome.storage.local.get<Record<string, unknown>>([STORAGE_KEYS.HAS_IMPORTED_TAKEOUT]);
        if (data && data[STORAGE_KEYS.HAS_IMPORTED_TAKEOUT]) return true;
        const convs = await getConversations(slot);
        return (convs || []).some(c => c && c.hasTakeoutImport);
    } catch {
        return false;
    }
}

async function getConversationWithDetail(slot: string | null | undefined, id: string): Promise<ResourceConversationParseResult | null> {
    if (!id) return null;
    const targetId = normId(id);
    const list = await getConversations(slot);
    const rawMeta = list.find(c => c && c.id === targetId);
    if (!rawMeta) return null;
    const native = await getDomainConversationResult(normSlot(slot), targetId);
    if (!native) return null;
    return { ...native, conversation: { ...native.conversation, title: rawMeta.title, titleSource: rawMeta.titleSource,
        updatedAt: rawMeta.updatedAt, createdAt: rawMeta.createdAt, url: rawMeta.url } };
}

export {
    normSlot,
    normId,
    getStorageKeys,
    getConversations,
    setConversations,
    setNativeConversations,
    transactConversations,
    updateConversation,
    removeConversation,
    clearConversations,
    clearAllDetails,
    reconcileConversations,
    getConversationDetail,
    getConversationWithDetail,
    getExportedIds,
    // P1-3 follow-up: setExportedIds / setAccountSlots 已从公开 surface 彻底移除
    // （interface + 默认对象都不再声明）。函数本体仍保留在模块闭包内供
    // saveExportRecordsBatch（锁内回写）与内部 slot 更新使用，不得再对外暴露。
    saveExportRecord,
    finalizeConversationExport,
    saveExportRecordsBatch,
    removeExportRecords,
    migrateExportAliases,
    getLastSync,
    setLastSync,
    getScanCoverage,
    preparePageCoverage,
    recordPageCoverage,
    hasScanCoverageOverlap,
    beginScanCoverage,
    isScanCoverageCurrent,
    finishScanCoverage,
    getAccountSlots,
    updateAccountSlot,
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
    normSlot,
    normId,
    getStorageKeys,
    getConversations,
    setConversations,
    setNativeConversations,
    transactConversations,
    updateConversation,
    removeConversation,
    clearConversations,
    clearAllDetails,
    reconcileConversations,
    getConversationDetail,
    getConversationWithDetail,
    getExportedIds,
    saveExportRecord,
    finalizeConversationExport,
    saveExportRecordsBatch,
    removeExportRecords,
    migrateExportAliases,
    getLastSync,
    setLastSync,
    getScanCoverage,
    preparePageCoverage,
    recordPageCoverage,
    hasScanCoverageOverlap,
    beginScanCoverage,
    isScanCoverageCurrent,
    finishScanCoverage,
    getAccountSlots,
    updateAccountSlot,
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
