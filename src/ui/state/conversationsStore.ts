// src/ui/state/conversationsStore.ts - State layer, no DOM rendering, only data + storage
import type { Conversation } from '../../types/conversation.js';
import type { ExportRecord, IConversationsStore } from '../../types/ui.js';

let conversations: Conversation[] = [];
let exportedIds: Record<string, ExportRecord> = {};
let currentSlot: string = 'u0';
let accountSlots: Record<string, any> = {};

const getStorage = () => (typeof StorageService !== 'undefined' ? StorageService : (typeof window !== 'undefined' && (window as any).StorageService) || null);
const getUtils = () => (typeof GeminiUtils !== 'undefined' ? GeminiUtils : (typeof window !== 'undefined' && (window as any).GeminiUtils) || null);

export const normId = (id?: string | null): string => {
    const utils = getUtils();
    if (utils && typeof utils.normId === 'function') return utils.normId(id);
    return String(id || '').replace(/^c_/, '');
};

export function getConversations(): Conversation[] { return conversations; }
export function setConversations(list: Conversation[]): void { conversations = list || []; }
export function getExportedIds(): Record<string, ExportRecord> { return exportedIds; }
export function setExportedIds(map: Record<string, ExportRecord>): void { exportedIds = map || {}; }
export function getCurrentSlot(): string { return currentSlot; }
export function setCurrentSlot(slot: string): void { currentSlot = slot || 'u0'; }
export function getAccountSlots(): Record<string, any> { return accountSlots; }
export function setAccountSlots(map: Record<string, any>): void { accountSlots = map || {}; }

export function getExportedRecord(id?: string | null): ExportRecord | null {
    if (!id || !exportedIds) return null;
    const nid = normId(id);
    return exportedIds[id] || exportedIds['c_' + nid] || exportedIds[nid] || null;
}

export function getSignature(list?: Conversation[]): string {
    const l = list || conversations;
    if (!l || !l.length) return 'empty';
    try {
        const items = l.map(c => `${c.id}:${(c.title || '').slice(0, 15)}`);
        if (items.length <= 6) return items.join('|') + '|' + items.length;
        const titleSum = l.reduce((acc, c) => acc + (c.title ? c.title.charCodeAt(0) : 0), 0);
        return items.slice(0, 3).join(',') + '|' + items.slice(-3).join(',') + '|len=' + items.length + '|ts=' + titleSum;
    } catch {
        return 'err-' + (l.length || 0);
    }
}

export async function loadStore(slotOverride?: string): Promise<{
    conversations: Conversation[];
    exportedIds: Record<string, ExportRecord>;
    slot: string;
    accountSlots: Record<string, any>;
}> {
    let slot = slotOverride || currentSlot || 'u0';
    const storage = getStorage();
    const slots = storage ? await storage.getAccountSlots() : ((await chrome.storage.local.get(['gemini_account_slots'])).gemini_account_slots || {});
    setAccountSlots(slots);

    let incoming = storage ? await storage.getConversations(slot) : [];
    // If the requested slot is empty, check all candidate slots for conversations
    if (!incoming || !incoming.length) {
        const candidates = ['u0', ...Object.keys(slots || {})].filter(s => s !== slot);
        for (const cand of candidates) {
            const candConvs = storage ? await storage.getConversations(cand) : [];
            if (candConvs && candConvs.length > 0) {
                slot = cand;
                incoming = candConvs;
                break;
            }
        }
    }
    setCurrentSlot(slot);

    const expIds = storage ? await storage.getExportedIds(slot) : {};
    setExportedIds(expIds);
    setConversations(incoming);
    return { conversations: incoming, exportedIds: expIds, slot, accountSlots: slots };
}

export async function getLastSync(slot?: string): Promise<{ timestamp: number | null; count: number }> {
    const s = slot || currentSlot || 'u0';
    const storage = getStorage();
    if (storage && storage.getLastSync) return await storage.getLastSync(s);
    const syncKey = s === 'u0' ? 'gemini_last_sync' : `gemini_last_sync_${s}`;
    const countKey = s === 'u0' ? 'gemini_last_count' : `gemini_last_count_${s}`;
    const countKeyLegacy = s === 'u0' ? 'gemini_last_sync_count' : `gemini_last_sync_count_${s}`;
    const data: any = await chrome.storage.local.get([syncKey, countKey, countKeyLegacy]);
    return { timestamp: data[syncKey] || null, count: (typeof data[countKey] === 'number' ? data[countKey] : data[countKeyLegacy]) || 0 };
}

export async function saveConversations(slot: string, list: Conversation[]): Promise<void> {
    const s = slot || currentSlot;
    const storage = getStorage();
    if (storage) await storage.setConversations(s, list);
    else {
        const convKey = s === 'u0' ? 'gemini_conversations' : `gemini_conversations_${s}`;
        await chrome.storage.local.set({ [convKey]: list || [] });
    }
    if (s === currentSlot) setConversations(list);
}

export async function saveExportedIds(slot: string, map: Record<string, ExportRecord>): Promise<void> {
    const s = slot || currentSlot;
    const storage = getStorage();
    if (storage) await storage.setExportedIds(s, map);
    else {
        const expKey = s === 'u0' ? 'exportedIds' : `gemini_exported_${s}`;
        await chrome.storage.local.set({ [expKey]: map || {} });
    }
    if (s === currentSlot) setExportedIds(map);
}

export async function clearExported(slot: string): Promise<void> {
    const s = slot || currentSlot;
    const storage = getStorage();
    if (storage && storage.setExportedIds) await storage.setExportedIds(s, {});
    else {
        const expKey = s === 'u0' ? 'exportedIds' : `gemini_exported_${s}`;
        await chrome.storage.local.remove([expKey]);
    }
    if (s === currentSlot) setExportedIds({});
}

export async function clearAll(slot: string): Promise<void> {
    const s = slot || currentSlot;
    const storage = getStorage();
    if (storage && storage.setConversations) await storage.setConversations(s, []);
    else {
        const convKey = s === 'u0' ? 'gemini_conversations' : `gemini_conversations_${s}`;
        await chrome.storage.local.remove([convKey]);
    }
    if (s === currentSlot) setConversations([]);
}

export async function getDevMode(): Promise<boolean> {
    const storage = getStorage();
    if (storage && storage.getDevMode) return await storage.getDevMode();
    const d = await chrome.storage.local.get(['gemini_dev_mode']);
    return !!d.gemini_dev_mode;
}

export async function setDevMode(devOn: boolean): Promise<void> {
    const storage = getStorage();
    if (storage && storage.setDevMode) await storage.setDevMode(devOn);
    else await chrome.storage.local.set({ gemini_dev_mode: !!devOn });
}

export async function removeConversation(id: string): Promise<Conversation[]> {
    if (!id) return conversations;
    const nid = normId(id);
    const storage = getStorage();
    conversations = (conversations || []).filter(c => normId(c.id) !== nid);
    if (storage && storage.removeConversation) {
        await storage.removeConversation(currentSlot, nid);
    } else {
        await saveConversations(currentSlot, conversations);
    }
    return conversations;
}

export async function reconcileWithCloud(activeCloudList: any[], options: any = {}): Promise<{ kept: number; removed: number; removedIds: string[] }> {
    const storage = getStorage();
    if (storage && storage.reconcileConversations) {
        const res = await storage.reconcileConversations(currentSlot, activeCloudList, options);
        const activeIdSet = new Set((activeCloudList || []).map(c => normId(c.id)));
        const keepTakeout = options.keepTakeout !== false;
        conversations = (conversations || []).filter(c => {
            const nid = normId(c.id);
            const isTakeout = keepTakeout && (
                c.source === 'takeout' ||
                c.titleSource === 'takeout' ||
                c.isTakeoutOnly ||
                (c.titles && c.titles.takeout && !c.titles.rpc && !c.titles.dom)
            );
            return activeIdSet.has(nid) || isTakeout;
        });
        return res;
    }
    return { kept: conversations.length, removed: 0, removedIds: [] };
}

export function normalizeAndDeduplicate(incoming: Conversation[]): { processed: Conversation[]; hasDirtyTitles: boolean } {
    const utils = getUtils();
    const uResolveTitle = (chat: any) => (utils && typeof utils.resolveTitle === 'function'
        ? utils.resolveTitle(chat)
        : { title: (chat?.title || '').trim() || '未命名对话', source: chat?.titleSource || 'legacy' });
    const uIsRealTitle = (t: any, fallbackId?: string) => (utils && typeof utils.isRealTitle === 'function'
        ? utils.isRealTitle(t, fallbackId)
        : !!(t && typeof t === 'string' && t.trim().length > 1));
    const uCompare = (a: any, b: any) => (utils && typeof utils.compareConversations === 'function'
        ? utils.compareConversations(a, b)
        : 0);

    const dedupMap = new Map<string, Conversation>();
    let hasDirtyTitles = false;
    (incoming || []).forEach(c => {
        if (!c || !c.id) return;
        const nid = normId(c.id);
        const u = ((c as any).url || (c as any).href || '').toString();
        if (/accounts\.google\.com|SignOutOptions/i.test(u)) return;

        const old = dedupMap.get(nid);
        const cleanForBad = (t: any) => String(t || '').replace(/[\u200E\u200B\uFEFF\u00A0]/g, '').trim();
        const isBad = (t: any) => !t || /^(Google\s+)?(Gemini|Bard|Google\s+AI|Google\s+Account)$/i.test(cleanForBad(t));

        if (!old) {
            const resolved = uResolveTitle(c);
            if (isBad(c.title) || c.title !== resolved.title) {
                hasDirtyTitles = true;
            }
            dedupMap.set(nid, {
                ...c,
                title: resolved.title,
                titleSource: resolved.source,
                titles: c.titles || (uIsRealTitle(c.title, nid) ? { [c.titleSource || 'legacy']: c.title } : {})
            });
        } else {
            const mergedTitles = { ...(old.titles || {}), ...(c.titles || {}) };
            if (uIsRealTitle(c.title, nid) && c.titleSource) {
                mergedTitles[c.titleSource] = c.title;
            }
            if (uIsRealTitle(old.title, nid) && old.titleSource) {
                mergedTitles[old.titleSource] = old.title;
            }
            const resolved = uResolveTitle({ id: nid, titles: mergedTitles, title: old.title, titleSource: old.titleSource });
            if (isBad(old.title) || old.title !== resolved.title) {
                hasDirtyTitles = true;
            }
            let cUpdated: any = c.updatedAt || c.timestamp || null;
            if (typeof cUpdated === 'string') cUpdated = new Date(cUpdated).getTime();
            let oldUpdated: any = old.updatedAt || old.timestamp || null;
            if (typeof oldUpdated === 'string') oldUpdated = new Date(oldUpdated).getTime();

            let isRpcSource = c.titleSource === 'rpc' || c.source === 'network-list';
            let bestUpdatedAt = oldUpdated;
            if (cUpdated && (isRpcSource || !bestUpdatedAt || cUpdated > bestUpdatedAt)) {
                bestUpdatedAt = cUpdated;
            }

            let cCreated: any = (c as any).createdAt || null;
            if (typeof cCreated === 'string') cCreated = new Date(cCreated).getTime();
            let oldCreated: any = (old as any).createdAt || null;
            if (typeof oldCreated === 'string') oldCreated = new Date(oldCreated).getTime();
            let bestCreatedAt = oldCreated || cCreated || null;
            if (cCreated && oldCreated && cCreated < oldCreated) {
                bestCreatedAt = cCreated;
            }

            let bestTimestamp = isRpcSource ? (cUpdated || bestUpdatedAt) : (bestUpdatedAt || old.timestamp || c.timestamp || null);

            dedupMap.set(nid, {
                ...old,
                ...c,
                titles: mergedTitles,
                title: resolved.title,
                titleSource: resolved.source,
                timestamp: bestTimestamp,
                updatedAt: bestUpdatedAt || bestTimestamp,
                createdAt: bestCreatedAt,
                sidebarIndex: typeof c.sidebarIndex === 'number' ? c.sidebarIndex : old.sidebarIndex
            });
        }
    });

    const processed = Array.from(dedupMap.values());
    processed.sort(uCompare);
    return { processed, hasDirtyTitles };
}

export function hasTakeoutData(): boolean {
    return (conversations || []).some(c => (
        c && (
            c.source === 'takeout' ||
            c.titleSource === 'takeout' ||
            c.isTakeoutOnly ||
            (c.titles && c.titles.takeout)
        )
    ));
}

export const ConversationsStore: IConversationsStore = {
    getConversations,
    setConversations,
    removeConversation,
    reconcileWithCloud,
    getExportedIds,
    setExportedIds,
    getCurrentSlot,
    setCurrentSlot,
    getAccountSlots,
    setAccountSlots,
    getExportedRecord,
    getSignature,
    loadStore,
    getLastSync,
    saveConversations,
    saveExportedIds,
    clearExported,
    clearAll,
    getDevMode,
    setDevMode,
    normalizeAndDeduplicate,
    hasTakeoutData,
    normId
};

if (typeof module === 'object' && module.exports) {
    module.exports = ConversationsStore;
}
if (typeof globalThis !== 'undefined') {
    (globalThis as any).ConversationsStore = ConversationsStore;
}
