import { getAccount, listAccounts, getOrCreateAccount } from '../api/accountRegistry.js';
import { isAccountId } from '../domain/accountRegistry.js';
import { selectConversationBody, withConversationMetadata } from '../domain/runtimeValidation.js';
import type { StoredDomainResource } from './domain/contracts.js';
import { deduplicateConversations } from '../utils/mergeUtils.js';
import { restoreConversationIndex, mergeConversationIndex, compareConversationIndexes, type ConversationIndexPatch } from '../domain/conversationIndex.js';
import { indexFromParsed } from './conversationIndexFromParsed.js';
import { CoverageSession, emptyStream, type StreamCoverage } from '../sync/streamCoverage.js';
import type { PageObservation } from '../sync/pageObservation.js';
import { readScanCoverage, type ScanCoverage, type ScanCoverageBaseline, type ScanCoverageRun } from './scanCoverage.js';
import type { ScanStatus } from '../../types/ui.js';
import { assertSchemaWritable } from './schemaState.js';
import { type ResourceConversationParseResult } from '../parsers/parsingResult.js';
import { storedParseResult, saveDomainConversation, removeStoredDomain, storageIdentity, getStoredDomain } from './domain/domainStore.js';
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

export interface FinalizeExportOptions<T = ExportRecord> {
    /** Callback invoked after successful write */
    onItemExported?: (id: string, record: T) => void;
}
import {
    removeConversationDetails,
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
    accountId: string;
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

function requireAccountId(accountId?: string | null): string {
    if (!isAccountId(accountId)) throw new TypeError('Storage requires a Registry account UUID');
    return accountId;
}

function getStorageKeys(accountId?: string | null): StorageKeys {
    const id = requireAccountId(accountId);
    return { accountId: id,
        convKey: `conversations_${id}`, expKey: `exported_${id}`,
        syncKey: `last_sync_${id}`, countKey: `last_count_${id}`,
        coverageKey: `scan_coverage_${id}`, checkpointKey: `scan_checkpoint_${id}` };
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

let _convChain: Promise<void> = Promise.resolve();

// Cross-tab write serialization.
//
// Every Gemini tab runs its own content-script JS context, so the in-memory
// promise chains below (_convChain / _saveRecordChain) only
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
// unchanged (conv -> save-record; no path takes them in reverse), and
// Web Locks are never nested for the same name.
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
/** Accept parsed external evidence before any consumer composes or renders it. */
async function ingestConversation(slot: string, parsed: ResourceConversationParseResult,
    resources: readonly StoredDomainResource[] = [], source: 'detail' | 'takeout' | 'snapshot' = 'detail', canCommit?: () => boolean): Promise<ResourceConversationParseResult> {
    return withConversationLock(async () => {
        if (canCommit?.() === false) throw new Error('Account changed before detail ingestion');
        const stored = await saveDomainConversation(requireAccountId(slot), parsed, resources, false, canCommit);
        const list = await getConversations(slot);
        const incoming = indexFromParsed(parsed, source);
        const position = list.findIndex(row => row.providerId === incoming.providerId && row.id === incoming.id);
        const index = mergeConversationIndex(position < 0 ? undefined : list[position], incoming);
        if (position < 0) list.push(index); else list[position] = index;
        if (canCommit?.() === false) throw new Error('Account changed before index ingestion');
        await _setConversationsRaw(slot, list);
        const accepted = storedParseResult(stored);
        return { ...parsed, ...accepted, sourceVersion: accepted.sourceVersion, diagnostics: parsed.diagnostics, resourceHints: parsed.resourceHints,
            acquisitionHints: { ...accepted.acquisitionHints, ...parsed.acquisitionHints },
            conversation: withConversationMetadata(selectConversationBody(accepted.conversation), index) };
    });
}

/** Upsert a partial native import; unrelated indexes and stronger metadata remain intact. */
async function setNativeConversations(slot: string | null | undefined, list: readonly ResourceConversationParseResult[]): Promise<void> {
    for (const parsed of list) await ingestConversation(requireAccountId(slot), parsed, [], 'snapshot');
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
    for (const id of ids) await removeStoredDomain(storageIdentity(account.providerId, account.id, id));
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

async function getScanCoverage(slot?: string | null): Promise<ScanCoverage | null> {
    const { coverageKey } = getStorageKeys(slot);
    const data = await chrome.storage.local.get<Record<string, unknown>>([coverageKey]);
    return readScanCoverage(data[coverageKey]);
}

const pageSessions = new Map<string, CoverageSession>();
const pageSessionKey = (slot: string, coverage: ScanCoverage, streamId: string) =>
    JSON.stringify([slot, coverage.generation, coverage.providerId, coverage.accountId, streamId]);

async function preparePageCoverage(slot: string, accountId: string | null, providerId = 'gemini'): Promise<ScanCoverage> {
    if (!isAccountId(accountId) || slot !== accountId) throw new TypeError('Coverage requires its Registry account UUID');
    return withConversationLock(async () => {
        await assertSchemaWritable();
        const current = await getScanCoverage(slot);
        if (current && current.accountId === accountId && current.providerId === providerId) return current;
        const { coverageKey } = getStorageKeys(slot);
        const raw = (await chrome.storage.local.get<Record<string, unknown>>([coverageKey]))[coverageKey];
        const resetAt = current?.resetAt ?? (isObjectRecord(raw) && typeof raw.resetAt === 'number' ? raw.resetAt : 0);
        const next: ScanCoverage = { version: 4, providerId, revision: current?.revision ?? 1, generation: crypto.randomUUID(),
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
        if (!current || current.activeRunId !== runId
            || current.accountId !== head.accountId || current.providerId !== head.providerId
            || head.requestedAt <= current.resetAt || canCommit?.() === false) return false;
        return pageSessions.get(pageSessionKey(slot, current, head.streamId))?.connects(previous, head) ?? false;
    });
}

/** Freeze the previous coverage and invalidate older active runs under the cross-tab lock. */
async function beginScanCoverage(slot: string, accountId: string | null): Promise<ScanCoverageRun> {
    const prepared = await preparePageCoverage(slot, accountId, 'gemini');
    return withConversationLock(async () => {
        await assertSchemaWritable();
        const previous = await getScanCoverage(slot);
        if (!previous || previous.generation !== prepared.generation) throw new Error('Coverage was cleared or account changed');
        const runId = crypto.randomUUID();
        const coverage = { ...previous, revision: previous.revision + (previous.activeRunId || previous.lastStatus ? 1 : 0), activeRunId: runId };
        await chrome.storage.local.set({ [getStorageKeys(slot).coverageKey]: coverage });
        return { runId, previous: (previous.initialized || previous.lastStatus !== null) ? previous : null };
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
        if (!slot) return false;
        const convs = await getConversations(slot);
        return (convs || []).some(c => c && c.hasTakeoutImport);
    } catch {
        return false;
    }
}

function conversationRepository(scope: ConversationScope): ConversationRepository {
    const accountId = requireAccountId(scope.accountId);
    return createConversationRepository({ ...scope, accountId }, {
        readIndexes: () => getConversations(accountId), readBody: getStoredDomain, readConsistently: withConversationLock,
    });
}

export {
    getAccount, listAccounts, getOrCreateAccount,
    conversationRepository,
    ingestConversation,
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
    getExportedIds,
    saveExportRecord,
    finalizeConversationExport,
    saveExportRecordsBatch,
    removeExportRecords,
    getLastSync,
    setLastSync,
    getScanCoverage,
    preparePageCoverage,
    recordPageCoverage,
    hasScanCoverageOverlap,
    beginScanCoverage,
    isScanCoverageCurrent,
    finishScanCoverage,
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
    getAccount, listAccounts, getOrCreateAccount,
    conversationRepository,
    ingestConversation,
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
    getExportedIds,
    saveExportRecord,
    finalizeConversationExport,
    saveExportRecordsBatch,
    removeExportRecords,
    getLastSync,
    setLastSync,
    getScanCoverage,
    preparePageCoverage,
    recordPageCoverage,
    hasScanCoverageOverlap,
    beginScanCoverage,
    isScanCoverageCurrent,
    finishScanCoverage,
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
