import {
    readStoredValue, readStoredObject, isStoredConversationRow,
    readStoredConversationFields, readStoredExportMap, readStoredSlotMap,
    type StoredObject, type StoredConversationRow,
    type StoredConversationFields, type StoredExportRecordMap,
    type StoredAccountSlotMap, type StoredSyncStatus,
} from './storageCompatibility.js';
import type {
    Conversation,
    ExportRecord,
    AccountSlotInfo,
    AccountSlots,
    ReconcileOptions
} from "../../types/index.js";
import { normId } from "../utils/pathUtils.js";
import { isTakeoutConversation, applyExportTitleWriteback, cleanTitle, isRealTitle, resolveTitle, toTimestampMs, getEffectiveTimestamp, normalizeReliableTitleSource } from "../utils/titleUtils.js";
import { STORAGE_KEYS } from "../utils/constants.js";

export interface FinalizeExportOptions<T = ExportRecord> {
    /** Whether to skip updating conversation in gemini_conversations (defaults to false) */
    skipConversationUpdate?: boolean;
    /** Conversation fields to update/merge into gemini_conversations */
    conversationUpdate?: {
        title?: string;
        titleSource?: string;
        titles?: Record<string, string>;
        messageCount?: number;
        updatedAt?: number | string;
        timestamp?: number | string;
        chatTime?: number | string;
    };
    /** Callback invoked after successful write */
    onItemExported?: (id: string, record: T) => void;
}
import {
    saveConversationDetailsBatch,
    removeConversationDetails,
    getConversationDetail,
    clearAllDetails,
    type ConversationDetailRecord
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
}


export interface ReconcileResult {
    kept: number;
    removed: number;
    removedIds: string[];
}

export interface ConversationTransaction {
    /** List to persist. Must be a fresh array; the stored list is replaced wholesale. */
    list: Conversation[];
    /** How many items the merge changed (drives badge / skip-write decisions). */
    changed: number;
}

function fields(raw: unknown): StoredObject {
    if (raw === null || raw === undefined) throw new TypeError('Cannot read null conversation');
    if (isObjectRecord(raw)) return readStoredObject(raw);
    if (typeof raw === 'string') {
        const chars: StoredObject = {};
        for (let i = 0; i < raw.length; i++) chars[String(i)] = raw[i];
        return chars;
    }
    return {};
}
function normalizedConversationId(raw: unknown): string {
    return normId(String(fields(raw).id || ''));
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
        checkpointKey: s === 'u0' ? 'gemini_scan_checkpoint' : `gemini_scan_checkpoint_${s}`
    };
}

async function getConversations(slot?: string | null): Promise<StoredConversationRow[]> {
    const { convKey } = getStorageKeys(slot);
    const data = await chrome.storage.local.get<Record<string, unknown>>([convKey]);
    const raw = data[convKey];
    if (!Array.isArray(raw)) return [];
    if (!raw.every(isStoredConversationRow)) throw new TypeError('Non-serializable stored conversation row');
    return raw;
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

// Typed producer input retains its metadata contract after slimming. Raw
// storage snapshots retain their compatibility type; no container check
// upgrades them to a complete domain record.
function _setConversationsRaw(slot: string | null | undefined, list: Conversation[]): Promise<Conversation[]>;
function _setConversationsRaw(slot: string | null | undefined, list: StoredConversationRow[]): Promise<StoredConversationRow[]>;
function _setConversationsRaw(slot: string | null | undefined, list: Conversation[] | StoredConversationRow[]): Promise<Conversation[] | StoredConversationRow[]>;
function _setConversationsRaw(slot: string | null | undefined, list: unknown[]): Promise<StoredConversationRow[]>;
async function _setConversationsRaw(
    slot: string | null | undefined,
    list: unknown[]
): Promise<Conversation[] | StoredConversationRow[]> {
    const { convKey } = getStorageKeys(slot);
    const detailsToSave: ConversationDetailRecord[] = [];
    const slimList = (list || []).map(value => {
        if (!value) return readStoredValue(value);
        const c = fields(value);
        const hasMessages = Array.isArray(c.messages) && c.messages.length > 0;
        const hasTurns = Array.isArray(c.turns) && c.turns.length > 0;
        if (hasMessages || hasTurns) {
            const detailRec: ConversationDetailRecord = {
                id: normalizedConversationId(c),
                messages: c.messages,
                turns: c.turns,
                updatedAt: c.updatedAt || c.timestamp || Date.now(),
                savedAt: Date.now()
            };
            detailsToSave.push(detailRec);
        }
        const bestCount = Math.max(
            Number(c.messageCount) || 0,
            Array.isArray(c.messages) ? c.messages.length : 0,
            Array.isArray(c.turns) ? c.turns.length : 0
        );
        const copy = { ...c };
        if (bestCount > 0) {
            copy.messageCount = bestCount;
        }
        delete copy.messages;
        delete copy.turns;
        return copy;
    });

    if (detailsToSave.length > 0) {
        try {
            await saveConversationDetailsBatch(detailsToSave);
        } catch (e) {
            console.error('[StorageService] Critical: failed to persist conversation details to IndexedDB, aborting write to prevent data truncation:', e);
            throw e;
        }
    }

    await chrome.storage.local.set({ [convKey]: slimList });
    return slimList;
}

async function setConversations(slot: string | null | undefined, list: Conversation[] | StoredConversationRow[]): Promise<void> {
    await withConversationLock(() => _setConversationsRaw(slot, list));
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
function transactConversations(
    slot: string | null | undefined,
    updater: (existing: StoredConversationRow[]) => ConversationTransaction | null
): Promise<{ list: StoredConversationRow[]; changed: number; written: false } | { list: Conversation[]; changed: number; written: true }>;
function transactConversations(
    slot: string | null | undefined,
    updater: (existing: StoredConversationRow[]) => { list: unknown[]; changed: number } | null
): Promise<{ list: StoredConversationRow[]; changed: number; written: boolean }>;
async function transactConversations(
    slot: string | null | undefined,
    updater: (existing: StoredConversationRow[]) => { list: unknown[]; changed: number } | null
): Promise<{ list: Conversation[] | StoredConversationRow[]; changed: number; written: boolean }> {
    return withConversationLock(async () => {
        const existing = (await getConversations(slot)) || [];
        const res = updater(existing);
        if (!res || !Array.isArray(res.list)) {
            return { list: existing, changed: 0, written: false };
        }
        const writtenList = await _setConversationsRaw(slot, res.list);
        return { list: writtenList, changed: res.changed || 0, written: true };
    });
}

async function updateConversation(
    slot: string | null | undefined,
    conversationId: string,
    patchOrUpdater: Partial<StoredConversationFields> | ((conv: StoredConversationFields) => Partial<StoredConversationFields> | null | void)
): Promise<boolean> {
    return withConversationLock(async () => {
        if (!conversationId) return false;
        const targetId = normId(conversationId);
        const list = await getConversations(slot);
        const index = list.findIndex(c => c && fields(c).id && normalizedConversationId(c) === targetId);
        if (index === -1) return false;

        const current = readStoredConversationFields(fields(list[index]));
        let updated: StoredObject;
        if (typeof patchOrUpdater === 'function') {
            const res = patchOrUpdater(current);
            if (res === null) return false;
            updated = res ? { ...current, ...res } : { ...current };
        } else {
            updated = { ...current, ...patchOrUpdater };
        }

        const nextList = [...list];
        nextList[index] = readStoredConversationFields(updated);
        await _setConversationsRaw(slot, nextList);
        return true;
    });
}

async function removeConversation(slot: string | null | undefined, conversationId: string): Promise<boolean> {
    return withConversationLock(async () => {
        if (!conversationId) return false;
        const targetId = normId(conversationId);
        const list = await getConversations(slot);
        const initialLen = list.length;
        const filtered = list.filter(c => {
            if (!c || !fields(c).id) return false;
            return normalizedConversationId(c) !== targetId;
        });
        if (filtered.length !== initialLen) {
            const { convKey, countKey } = getStorageKeys(slot);
            await chrome.storage.local.set({
                [convKey]: filtered,
                [countKey]: filtered.length
            });
            await updateAccountSlot(slot, { count: filtered.length });
            await removeExportRecords(slot, [conversationId]);
            await removeConversationDetails([conversationId]);
            return true;
        }
        return false;
    });
}

async function clearConversations(slot?: string | null): Promise<void> {
    await withConversationLock(async () => {
        const { convKey, countKey, checkpointKey, expKey } = getStorageKeys(slot);
        const existing = await getConversations(slot);
        const ids = (existing || []).map(c => normalizedConversationId(c)).filter(Boolean);
        if (ids.length > 0) {
            await removeConversationDetails(ids);
        }
        const toSet: Record<string, unknown> = {
            [convKey]: [],
            [countKey]: 0,
            [expKey]: {}
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
        if (!Array.isArray(existing) || existing.length === 0) {
            return { kept: 0, removed: 0, removedIds: [] };
        }

        const activeIdSet = new Set<string>();
        (activeCloudList || []).forEach(c => {
            if (c && c.id) {
                activeIdSet.add(normId(c.id));
            }
        });

        const kept: unknown[] = [];
        const removedIds: string[] = [];

        for (const conv of existing) {
            if (!conv || !fields(conv).id) continue;
            const nid = normalizedConversationId(conv);
            const isTakeout = keepTakeout && isTakeoutConversation(fields(conv));

            if (activeIdSet.has(nid) || isTakeout) {
                kept.push(conv);
            } else {
                removedIds.push(nid);
            }
        }

        if (removedIds.length > 0) {
            const { convKey, countKey } = getStorageKeys(slot);
            await chrome.storage.local.set({
                [convKey]: kept,
                [countKey]: kept.length
            });
            await updateAccountSlot(slot, { count: kept.length });
            await removeExportRecords(slot, removedIds);
            await removeConversationDetails(removedIds);
        }

        return {
            kept: kept.length,
            removed: removedIds.length,
            removedIds
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
    updateConversation?: (
        slot: string | null | undefined,
        conversationId: string,
        patchOrUpdater: Partial<StoredConversationFields> | ((conv: StoredConversationFields) => Partial<StoredConversationFields> | null | void)
    ) => Promise<boolean>;
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
    const doUpdateConv = selfDelegate?.updateConversation || updateConversation;

    // 1. Serialized record write to exportedIds SSoT
    await doSaveRecord(slot, targetId, record);

    // 2. Best-effort metadata and title promotion write-back to gemini_conversations if not skipped
    if (!options?.skipConversationUpdate) {
        try {
            const convUpdate = options?.conversationUpdate || {};
            const recObj = isObjectRecord(record) ? readStoredObject(record) : null;
            const recTitle = typeof recObj?.title === 'string' ? recObj.title : undefined;
            const recMsgCount = recObj?.messageCount;
            const recChatTime = recObj?.chatTime !== undefined ? recObj.chatTime : undefined;
            const candidateTitle = convUpdate.title || recTitle;
            const updated = await doUpdateConv(slot, targetId, (existing: StoredConversationFields) => {
                const incomingTitles: Record<string, string> =
                    convUpdate.titles && typeof convUpdate.titles === 'object' ? { ...convUpdate.titles } : {};
                const candidateSource = convUpdate.titleSource || undefined;

                const incoming: Partial<Pick<Conversation, 'id' | 'title' | 'titleSource' | 'titles'>> = {
                    titles: incomingTitles,
                    title: candidateTitle,
                    titleSource: candidateSource
                };

                const titleTarget: Record<string, unknown> = existing;
                applyExportTitleWriteback(titleTarget, incoming);

                const newMsgCount = convUpdate.messageCount ?? recMsgCount;
                if (typeof newMsgCount === 'number' && newMsgCount > 0) {
                    existing.messageCount = Math.max(Number(existing.messageCount || 0), newMsgCount);
                }

                const rawTime = convUpdate.updatedAt || convUpdate.timestamp || convUpdate.chatTime || recChatTime;
                const timeMs = toTimestampMs(rawTime);
                if (timeMs && timeMs > 0) {
                    const existingTs = getEffectiveTimestamp(titleTarget);
                    if (timeMs > existingTs) {
                        existing.updatedAt = timeMs;
                        if (existing.timestamp) existing.timestamp = timeMs;
                    }
                }

                return existing;
            });

            // If not found in current conversation list, register it fresh with resolved export metadata
            if (!updated && candidateTitle) {
                await withConversationLock(async () => {
                    const list = await getConversations(slot);
                    if (!list.some(c => c && normalizedConversationId(c) === targetId)) {
                        const cleanedTitle = cleanTitle(candidateTitle);
                        const initialSource = normalizeReliableTitleSource(convUpdate.titleSource) || 'legacy';
                        const initialTitles: Record<string, string> = {};
                        if (convUpdate.titles && typeof convUpdate.titles === 'object') {
                            for (const [k, v] of Object.entries(convUpdate.titles)) {
                                const reliableK = normalizeReliableTitleSource(k);
                                if (reliableK && typeof v === 'string' && v) {
                                    initialTitles[reliableK] = v;
                                }
                            }
                        }
                        if (initialSource && initialSource !== 'legacy') {
                            initialTitles[initialSource] = cleanedTitle;
                        } else if (initialSource === 'legacy' && cleanedTitle && isRealTitle(cleanedTitle, targetId)) {
                            initialTitles.legacy = cleanedTitle;
                        }

                        const newConv = {
                            id: targetId,
                            title: cleanedTitle,
                            titleSource: initialSource,
                            titles: initialTitles,
                            messageCount: convUpdate.messageCount ?? recMsgCount ?? 1,
                            updatedAt: toTimestampMs(convUpdate.updatedAt || convUpdate.timestamp || recChatTime) || Date.now()
                        };
                        const resolved = resolveTitle(newConv);
                        newConv.title = resolved.title;
                        newConv.titleSource = resolved.source;
                        const nextList: StoredConversationRow[] = [newConv, ...list];
                        await _setConversationsRaw(slot, nextList);
                    }
                });
            }
        } catch (convUpdateErr) {
            console.warn('[StorageService] finalizeConversationExport updateConversation failed for', targetId, convUpdateErr);
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

async function getScanCheckpoint(slot?: string | null): Promise<number | null> {
    const { checkpointKey } = getStorageKeys(slot);
    const data = await chrome.storage.local.get<Record<string, unknown>>([checkpointKey]);
    const cp = data[checkpointKey];
    return typeof cp === 'number' && cp > 0 ? cp : null;
}

async function setScanCheckpoint(slot: string | null | undefined, timestamp: number | null): Promise<void> {
    return withConversationLock(async () => {
        const { checkpointKey } = getStorageKeys(slot);
        if (timestamp === null || timestamp === undefined || timestamp <= 0) {
            await chrome.storage.local.remove([checkpointKey]);
        } else {
            await chrome.storage.local.set({ [checkpointKey]: timestamp });
        }
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
        const existingSlot = map[s] ? fields(map[s]) : {};
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
        return (convs || []).some(c => c && isTakeoutConversation(fields(c)));
    } catch {
        return false;
    }
}

async function getConversationWithDetail(slot: string | null | undefined, id: string): Promise<StoredConversationFields | null> {
    if (!id) return null;
    const targetId = normId(id);
    const list = await getConversations(slot);
    const rawMeta = list.find(c => c && normalizedConversationId(c) === targetId);
    const meta = rawMeta ? fields(rawMeta) : null;
    if (!meta) return null;
    const detail = await getConversationDetail(targetId);
    return {
        ...meta,
        messages: detail?.messages || meta.messages || [],
        turns: detail?.turns || meta.turns || []
    };
}

export {
    normSlot,
    normId,
    getStorageKeys,
    getConversations,
    setConversations,
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
    getScanCheckpoint,
    setScanCheckpoint,
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
    getScanCheckpoint,
    setScanCheckpoint,
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
