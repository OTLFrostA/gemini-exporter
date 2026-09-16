// storageService.ts - Unified multi-account Chrome storage access and key management
import type { Conversation } from "../../types/index.js";
import { normId, isVersionGreater as utilsIsVersionGreater } from "../utils/pathUtils.js";
import { STORAGE_KEYS } from "../utils/constants.js";


export interface StorageKeys {
    slot: string;
    convKey: string;
    expKey: string;
    syncKey: string;
    countKey: string;
}

export interface SyncStatus {
    timestamp: number | null;
    count: number;
}

export interface ReconcileResult {
    kept: number;
    removed: number;
    removedIds: string[];
}

export interface StorageServiceModule {
    normSlot: (slot?: string | null) => string;
    normId: (id?: string | null) => string;
    getStorageKeys: (slot?: string | null) => StorageKeys;
    getConversations: (slot?: string | null) => Promise<Conversation[]>;
    setConversations: (slot: string | null | undefined, list: Conversation[]) => Promise<void>;
    updateConversation: (
        slot: string | null | undefined,
        conversationId: string,
        patchOrUpdater: Partial<Conversation> | ((conv: Conversation) => Partial<Conversation> | null | void)
    ) => Promise<boolean>;
    removeConversation: (slot: string | null | undefined, conversationId: string) => Promise<boolean>;
    reconcileConversations: (slot: string | null | undefined, activeCloudList: any[], options?: any) => Promise<ReconcileResult>;
    getExportedIds: (slot?: string | null) => Promise<Record<string, any>>;
    setExportedIds: (slot: string | null | undefined, map: Record<string, any>) => Promise<void>;
    saveExportRecord: (slot: string | null | undefined, id: string, record: any) => Promise<Record<string, any>>;
    saveExportRecordsBatch: (slot: string | null | undefined, records: Record<string, any>) => Promise<Record<string, any>>;
    removeExportRecords: (slot: string | null | undefined, ids: string[] | null | undefined) => Promise<number>;
    getLastSync: (slot?: string | null) => Promise<SyncStatus>;
    setLastSync: (slot: string | null | undefined, timestamp?: number | null, count?: number) => Promise<void>;
    getAccountSlots: () => Promise<Record<string, any>>;
    setAccountSlots: (map: Record<string, any>) => Promise<void>;
    updateAccountSlot: (slot: string | null | undefined, info: any) => Promise<Record<string, any>>;
    getCredentialsMap: () => Promise<Record<string, any>>;
    setCredentialsMap: (map: Record<string, any>) => Promise<void>;
    clearCredentials: (sid?: string | null) => Promise<void>;
    getDevMode: () => Promise<boolean>;
    setDevMode: (enabled: boolean) => Promise<void>;
    isTourCompleted: () => Promise<boolean>;
    setTourCompleted: (completed?: boolean) => Promise<void>;
    getLastSeenFeatureVersion: () => Promise<string>;
    setLastSeenFeatureVersion: (version: string) => Promise<void>;
    isVersionGreater: (v1: string, v2: string) => boolean;
    isTakeoutPromptCompleted: () => Promise<boolean>;
    setTakeoutPromptCompleted: (completed?: boolean) => Promise<void>;
    hasTakeoutData: (slot?: string | null) => Promise<boolean>;
    setHasImportedTakeout: (imported?: boolean) => Promise<void>;
}

declare global {
    var StorageService: any;
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
            countKey: s === 'u0' ? 'gemini_last_count' : `gemini_last_count_${s}`
        };
    }

    async function getConversations(slot?: string | null): Promise<Conversation[]> {
        const { convKey, slot: s } = getStorageKeys(slot);
        const keys = [convKey];
        if (s === 'u0') {
            keys.push('gemini_conversations_u0');
        }
        const data = await chrome.storage.local.get(keys);
        return ((data[convKey] || (s === 'u0' ? data.gemini_conversations_u0 : null) || []) as Conversation[]);
    }

    let _convChain: Promise<any> = Promise.resolve();
    function withConversationLock<T>(fn: () => Promise<T>): Promise<T> {
        const p = _convChain.then(fn, fn);
        _convChain = p.then(() => {}, () => {});
        return p;
    }

    // P1-048: account-slot read-modify-write gets its own serialization chain so
    // concurrent updateAccountSlot calls cannot silently drop each other's fields.
    // Lock order is always conv -> slot; no path takes slot -> conv.
    let _slotChain: Promise<any> = Promise.resolve();
    function withSlotLock<T>(fn: () => Promise<T>): Promise<T> {
        const p = _slotChain.then(fn, fn);
        _slotChain = p.then(() => {}, () => {});
        return p;
    }

    // P1-047: the raw write, used only inside withConversationLock.
    async function _setConversationsRaw(slot: string | null | undefined, list: Conversation[]): Promise<void> {
        const { convKey } = getStorageKeys(slot);
        await chrome.storage.local.set({ [convKey]: list || [] });
    }

    // P1-047: public setConversations now goes through the conversation lock, so a
    // blind write can no longer interleave with (and clobber) a read-modify-write.
    async function setConversations(slot: string | null | undefined, list: Conversation[]): Promise<void> {
        return withConversationLock(() => _setConversationsRaw(slot, list));
    }

    async function updateConversation(
        slot: string | null | undefined,
        conversationId: string,
        patchOrUpdater: Partial<Conversation> | ((conv: Conversation) => Partial<Conversation> | Conversation | null | void)
    ): Promise<boolean> {
        return withConversationLock(async () => {
            if (!conversationId) return false;
            const targetId = normId(conversationId);
            const list = await getConversations(slot);
            const index = list.findIndex(c => c && c.id && normId(c.id) === targetId);
            if (index === -1) return false;

            const current = list[index];
            let updated: Conversation;
            if (typeof patchOrUpdater === 'function') {
                const res = patchOrUpdater(current);
                if (res === null) return false;
                updated = res ? { ...current, ...res } : { ...current };
            } else {
                updated = { ...current, ...patchOrUpdater };
            }

            const nextList = [...list];
            nextList[index] = updated;
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
                if (!c || !c.id) return false;
                return normId(c.id) !== targetId;
            });
            if (filtered.length !== initialLen) {
                // P1-048: write convKey + countKey in a single set to shrink the
                // window where the two can diverge; the whole body is already
                // serialized by withConversationLock, so the raw write is safe here.
                const { convKey, countKey } = getStorageKeys(slot);
                await chrome.storage.local.set({
                    [convKey]: filtered,
                    [countKey]: filtered.length
                });
                await updateAccountSlot(slot, { count: filtered.length });
                // P1-049: deleting a conversation must also drop its export records
                // (canonical key + historical aliases), otherwise exportedIds grows
                // forever and deleted chats keep showing as "exported".
                await removeExportRecords(slot, [conversationId]);
                return true;
            }
            return false;
        });
    }

    async function reconcileConversations(slot: string | null | undefined, activeCloudList: any[], options: any = {}): Promise<ReconcileResult> {
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

            const kept: Conversation[] = [];
            const removedIds: string[] = [];

            for (const conv of existing) {
                if (!conv || !conv.id) continue;
                const nid = normId(conv.id);
                const isTakeout = keepTakeout && (
                    (conv as any).source === 'takeout' ||
                    conv.titleSource === 'takeout' ||
                    (conv as any).isTakeoutOnly ||
                    (conv.titles && (conv.titles as any).takeout && !(conv.titles as any).rpc && !(conv.titles as any).dom)
                );

                if (activeIdSet.has(nid) || isTakeout) {
                    kept.push(conv);
                } else {
                    removedIds.push(nid);
                }
            }

            if (removedIds.length > 0) {
                // P1-048: single set for convKey + countKey (see removeConversation).
                const { convKey, countKey } = getStorageKeys(slot);
                await chrome.storage.local.set({
                    [convKey]: kept,
                    [countKey]: kept.length
                });
                await updateAccountSlot(slot, { count: kept.length });
                // P1-049: drop export records of the reconciled-away conversations.
                await removeExportRecords(slot, removedIds);
            }

            return {
                kept: kept.length,
                removed: removedIds.length,
                removedIds
            };
        });
    }

    async function getExportedIds(slot?: string | null): Promise<Record<string, any>> {
        const { expKey, slot: s } = getStorageKeys(slot);
        const keys = Array.from(new Set([expKey, 'exportedIds', 'gemini_exported_u0', ...(s !== 'u0' ? [`gemini_exported_${s}`] : [])]));
        const data = await chrome.storage.local.get(keys);
        const merged: Record<string, any> = {};
        for (const k of keys) {
            if (data[k] && typeof data[k] === 'object') {
                Object.assign(merged, data[k]);
            }
        }
        return merged;
    }

    async function setExportedIds(slot: string | null | undefined, map: Record<string, any>): Promise<void> {
        const { expKey, slot: s } = getStorageKeys(slot);
        // P1-045: wholesale writes also go through canonical keys.
        const canonical = normalizeExportRecordKeys(map);
        const updates: Record<string, any> = { [expKey]: canonical || {} };
        if (s === 'u0') {
            updates['exportedIds'] = canonical || {};
        }
        await chrome.storage.local.set(updates);
    }

    // P1-045: one canonical key per conversation — normId(id). Historical writers
    // stored three alias keys (id / normId(id) / 'c_'+normId(id)); readers already
    // look all three up, so writing only the canonical key stays compatible.
    function canonicalExportKey(id: string | number | null | undefined): string {
        return normId(id);
    }

    // Collapse an incoming record map's keys to canonical form.
    function normalizeExportRecordKeys(records: Record<string, any>): Record<string, any> {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(records || {})) {
            const ck = canonicalExportKey(k);
            if (!ck) continue;
            out[ck] = v;
        }
        return out;
    }

    // One-time-per-map cleanup: fold historical alias keys into their canonical key
    // so maps written by older versions shrink back instead of growing forever.
    function collapseExportAliases(map: Record<string, any>): void {
        for (const k of Object.keys(map)) {
            const ck = canonicalExportKey(k);
            if (!ck || ck === k) continue;
            if (!(ck in map)) {
                map[ck] = map[k];
            }
            delete map[k];
        }
    }

    let _saveRecordChain: Promise<any> = Promise.resolve();
    function enqueueSaveRecordChain<T>(fn: () => Promise<T>): Promise<T> {
        const p = _saveRecordChain.then(fn, fn);
        _saveRecordChain = p.then(() => undefined, () => undefined);
        return p;
    }

    async function saveExportRecord(slot: string | null | undefined, id: string, record: any): Promise<Record<string, any>> {
        // P1-045: single canonical key instead of the old 3-alias fan-out.
        const ck = canonicalExportKey(id);
        if (!ck) {
            throw new Error('[StorageService] saveExportRecord: empty conversation id');
        }
        return saveExportRecordsBatch(slot, { [ck]: record });
    }

    async function saveExportRecordsBatch(slot: string | null | undefined, records: Record<string, any>): Promise<Record<string, any>> {
        return enqueueSaveRecordChain(async () => {
            const { expKey, slot: s } = getStorageKeys(slot);
            // Read only this slot's own key(s): for u0 the canonical key plus the
            // legacy 'gemini_exported_u0' copy; never the merged cross-slot view.
            const readKeys = s === 'u0' ? ['exportedIds', 'gemini_exported_u0'] : [expKey];
            const data = await chrome.storage.local.get(readKeys);
            const cur: Record<string, any> = {};
            for (const k of readKeys) {
                const m = (data as any)[k];
                if (m && typeof m === 'object') Object.assign(cur, m);
            }
            // P1-045: fold historical aliases to canonical keys (shrinks old maps).
            collapseExportAliases(cur);
            Object.assign(cur, normalizeExportRecordKeys(records));
            // P1-046: a non-u0 slot writes ONLY its own key. The old code merged the
            // slot's records into the global 'exportedIds' key, so u1's exports showed
            // up in u0's record table (and vice versa) and could be misread as
            // "already exported" under the wrong account. Reads via getExportedIds
            // still merge the global key for backward compatibility.
            const updates: Record<string, any> = { [expKey]: cur };
            if (s === 'u0' && (data as any)['gemini_exported_u0']) {
                // Absorbed the legacy copy above; drop it so it cannot go stale.
                await chrome.storage.local.remove(['gemini_exported_u0']);
            }
            await chrome.storage.local.set(updates);
            return cur;
        });
    }

    // P1-049: delete export records for the given conversation ids (canonical key
    // plus all historical alias forms). Serialized with the save chain so a
    // concurrent save cannot resurrect a deleted record.
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
            // For non-u0 also sweep this slot's historical pollution out of the
            // global key (P1-046), but only for keys this slot actually owns
            // (present in its own map) so u0's legitimate records are untouched.
            const sweepGlobal = s !== 'u0';
            const data = await chrome.storage.local.get(sweepGlobal ? [expKey, 'exportedIds'] : [expKey]);
            const ownMap = ((data as any)[expKey] && typeof (data as any)[expKey] === 'object')
                ? { ...(data as any)[expKey] } as Record<string, any>
                : {};
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
            const updates: Record<string, any> = { [expKey]: ownMap };
            if (sweepGlobal) {
                const g = ((data as any)['exportedIds'] && typeof (data as any)['exportedIds'] === 'object')
                    ? { ...(data as any)['exportedIds'] } as Record<string, any>
                    : null;
                if (g) {
                    let gRemoved = 0;
                    // Sweep this slot's historical pollution out of the global key:
                    // any global entry whose normalized id matches a key this slot
                    // demonstrably owned is this slot's own pollution (P1-046 wrote
                    // identical keys to both). u0's legitimate records have different
                    // normalized ids and are never touched.
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

    async function getLastSync(slot?: string | null): Promise<SyncStatus> {
        const { syncKey, countKey } = getStorageKeys(slot);
        const data = await chrome.storage.local.get([syncKey, countKey]);
        return {
            timestamp: (data[syncKey] as number) || null,
            count: (data[countKey] as number) || 0
        };
    }

    async function setLastSync(slot: string | null | undefined, timestamp?: number | null, count?: number): Promise<void> {
        const { syncKey, countKey } = getStorageKeys(slot);
        await chrome.storage.local.set({
            [syncKey]: timestamp || Date.now(),
            [countKey]: typeof count === 'number' ? count : 0
        });
    }

    async function getAccountSlots(): Promise<Record<string, any>> {
        const data = await chrome.storage.local.get(['gemini_account_slots']);
        return data.gemini_account_slots || {};
    }

    async function setAccountSlots(map: Record<string, any>): Promise<void> {
        await chrome.storage.local.set({ gemini_account_slots: map || {} });
    }

    async function updateAccountSlot(slot: string | null | undefined, info: any): Promise<Record<string, any>> {
        // P1-048: serialize the get-modify-set so concurrent callers cannot drop
        // each other's counter/field updates.
        return withSlotLock(async () => {
            const s = normSlot(slot);
            const map = await getAccountSlots();
            map[s] = { ...(map[s] || {}), ...(info || {}) };
            await setAccountSlots(map);
            return map;
        });
    }

    function getCredStorage(): chrome.storage.StorageArea | null {
        if (typeof chrome !== 'undefined' && chrome.storage) {
            if (chrome.storage.session) return chrome.storage.session;
            return chrome.storage.local;
        }
        return null;
    }

    async function getCredentialsMap(): Promise<Record<string, any>> {
        const storage = getCredStorage();
        if (!storage) return {};
        const data: any = await storage.get([STORAGE_KEYS.CREDENTIALS_MAP]);
        let map: Record<string, any> = data[STORAGE_KEYS.CREDENTIALS_MAP] || {};
        if (Object.keys(map).length === 0 && storage !== chrome.storage.local && chrome.storage.local) {
            try {
                const localData: any = await chrome.storage.local.get([STORAGE_KEYS.CREDENTIALS_MAP]);
                if (localData && localData[STORAGE_KEYS.CREDENTIALS_MAP]) {
                    map = localData[STORAGE_KEYS.CREDENTIALS_MAP];
                    await storage.set({ [STORAGE_KEYS.CREDENTIALS_MAP]: map });
                    await chrome.storage.local.remove([STORAGE_KEYS.CREDENTIALS_MAP, STORAGE_KEYS.CREDENTIALS]);
                }
            } catch { /* intentional: migration fallback */ }
        }
        return map;
    }

    async function setCredentialsMap(map: Record<string, any>): Promise<void> {
        const storage = getCredStorage();
        if (!storage) return;
        await storage.set({ [STORAGE_KEYS.CREDENTIALS_MAP]: map || {} });
        if (storage !== chrome.storage.local && chrome.storage.local) {
            try {
                await chrome.storage.local.remove([STORAGE_KEYS.CREDENTIALS_MAP, STORAGE_KEYS.CREDENTIALS]);
            } catch { /* intentional: local purge */ }
        }
    }

    async function clearCredentials(sid?: string | null): Promise<void> {
        const storage = getCredStorage();
        if (!storage) return;
        if (sid) {
            const map = await getCredentialsMap();
            delete map[sid];
            await setCredentialsMap(map);
        } else {
            await storage.remove([STORAGE_KEYS.CREDENTIALS_MAP, STORAGE_KEYS.CREDENTIALS]);
        }
        if (storage !== chrome.storage.local && chrome.storage.local) {
            try {
                await chrome.storage.local.remove([STORAGE_KEYS.CREDENTIALS_MAP, STORAGE_KEYS.CREDENTIALS]);
            } catch { /* intentional: local purge */ }
        }
    }

    async function getDevMode(): Promise<boolean> {
        const data = await chrome.storage.local.get([STORAGE_KEYS.DEV_MODE]);
        return !!data[STORAGE_KEYS.DEV_MODE];
    }

    async function setDevMode(enabled: boolean): Promise<void> {
        await chrome.storage.local.set({ [STORAGE_KEYS.DEV_MODE]: !!enabled });
    }

    async function isTourCompleted(): Promise<boolean> {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return false;
        try {
            const data = await chrome.storage.local.get(['has_completed_tour']);
            return !!data.has_completed_tour;
        } catch {
            return false;
        }
    }

    async function setTourCompleted(completed: boolean = true): Promise<void> {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
        try {
            await chrome.storage.local.set({ has_completed_tour: !!completed });
        } catch (e) { console.warn("[GemExporter:storage] Storage operation failed:", e); }
    }

    /**
     * Compare two semantic versions: returns true if v1 > v2.
     * E.g. isVersionGreater('1.5.0', '1.4.3') => true
     */
    function isVersionGreater(v1: string, v2: string): boolean {
        return utilsIsVersionGreater(v1, v2);
    }


    async function getLastSeenFeatureVersion(): Promise<string> {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return '0.0.0';
        try {
            const data = await chrome.storage.local.get(['last_seen_feature_version']);
            return String(data.last_seen_feature_version || '0.0.0');
        } catch {
            return '0.0.0';
        }
    }

    async function setLastSeenFeatureVersion(version: string): Promise<void> {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
        try {
            await chrome.storage.local.set({ last_seen_feature_version: version });
        } catch (e) { console.warn("[GemExporter:storage] Storage operation failed:", e); }
    }

    async function isTakeoutPromptCompleted(): Promise<boolean> {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return false;
        try {
            const data = await chrome.storage.local.get(['has_completed_takeout_prompt']);
            return !!data.has_completed_takeout_prompt;
        } catch {
            return false;
        }
    }

    async function setTakeoutPromptCompleted(completed: boolean = true): Promise<void> {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
        try {
            await chrome.storage.local.set({ has_completed_takeout_prompt: !!completed });
        } catch (e) { console.warn("[GemExporter:storage] Storage operation failed:", e); }
    }

    async function setHasImportedTakeout(imported: boolean = true): Promise<void> {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
        try {
            await chrome.storage.local.set({ has_imported_takeout: !!imported });
        } catch (e) { console.warn("[GemExporter:storage] Storage operation failed:", e); }
    }

    async function hasTakeoutData(slot: string | null = 'u0'): Promise<boolean> {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return false;
        try {
            const data = await chrome.storage.local.get(['has_imported_takeout']);
            if (data && data.has_imported_takeout) return true;
            const convs = await getConversations(slot);
            return (convs || []).some(c => (
                c && (
                    (c as any).source === 'takeout' ||
                    c.titleSource === 'takeout' ||
                    (c as any).isTakeoutOnly ||
                    (c.titles && (c.titles as any).takeout)
                )
            ));
        } catch {
            return false;
        }
    }

export {
    normSlot,
    normId,
    getStorageKeys,
    getConversations,
    setConversations,
    updateConversation,
    removeConversation,
    reconcileConversations,
    getExportedIds,
    setExportedIds,
    saveExportRecord,
    saveExportRecordsBatch,
    removeExportRecords,
    getLastSync,
    setLastSync,
    getAccountSlots,
    setAccountSlots,
    updateAccountSlot,
    getCredentialsMap,
    setCredentialsMap,
    clearCredentials,
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
    setHasImportedTakeout
};

export const StorageService: StorageServiceModule = {
    normSlot,
    normId,
    getStorageKeys,
    getConversations,
    setConversations,
    updateConversation,
    removeConversation,
    reconcileConversations,
    getExportedIds,
    setExportedIds,
    saveExportRecord,
    saveExportRecordsBatch,
    removeExportRecords,
    getLastSync,
    setLastSync,
    getAccountSlots,
    setAccountSlots,
    updateAccountSlot,
    getCredentialsMap,
    setCredentialsMap,
    clearCredentials,
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
    setHasImportedTakeout
};

if (typeof globalThis !== 'undefined' && !(globalThis as any).StorageService) {
    (globalThis as any).StorageService = StorageService;
}
if (typeof module === 'object' && module.exports) module.exports = StorageService;

export default StorageService;
