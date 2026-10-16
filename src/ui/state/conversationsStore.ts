import { isAccountId, type Account } from '../../core/domain/accountRegistry.js';
import type { DomainConversationIndex } from '../../types/conversation.js';
import type { ReconcileOptions, ExportRecord, IConversationsStore } from '../../types/ui.js';
import { __resolveModule } from '../../core/utils/moduleOverrides.js';

import StorageService from '../../core/storage/storageService.js';
import GeminiUtils, {
    normId as utilsNormId
} from '../../core/utils/utils.js';
import { STORAGE_KEYS } from '../../core/utils/constants.js';

let conversations: DomainConversationIndex[] = [];
let exportedIds: Record<string, ExportRecord> = {};
let accountId: string = '';
let accounts: Account[] = [];
let loadGeneration = 0;

const getStorage = (): any => __resolveModule('StorageService', StorageService);
const getUtils = (): any => __resolveModule('GeminiUtils', GeminiUtils);

export const normId = (id?: string | null): string => {
    const utils = getUtils();
    if (utils && typeof utils.normId === 'function') return utils.normId(id);
    return utilsNormId(id);
};

export function getConversations(): DomainConversationIndex[] { return conversations; }
export function setConversations(list: DomainConversationIndex[]): void { conversations = list || []; }
export function getExportedIds(): Record<string, ExportRecord> { return exportedIds; }

// Fold legacy alias keys ('c_<id>' / raw id) into canonical normId keys for consistent in-memory lookups
function collapseExportAliases(map: Record<string, ExportRecord>): void {
    for (const k of Object.keys(map)) {
        const ck = normId(k);
        if (!ck || ck === k) continue;
        if (!(ck in map)) {
            map[ck] = map[k];
        }
        delete map[k];
    }
}

export function setExportedIds(map: Record<string, ExportRecord>): void {
    const next = map || {};
    collapseExportAliases(next);
    exportedIds = next;
 }
export function getCurrentAccountId(): string { return accountId; }
export function setCurrentAccountId(id: string): void {
    if (id !== '' && !isAccountId(id)) throw new TypeError('Invalid account UUID');
    accountId = id;
    loadGeneration++;
}
export function getAccounts(): Account[] { return accounts; }
export function setAccounts(list: Account[]): void { accounts = list; }

export function getExportedRecord(id?: string | null): ExportRecord | null {
    if (!id || !exportedIds) return null;
    return exportedIds[normId(id)] || null;
}

export function getSignature(list?: DomainConversationIndex[]): string {
    const l = list || conversations;
    if (!l || !l.length) return 'empty';
    // Every canonical metadata change can affect visible status, dates or selection,
    // including message activity on an item whose title and position stay unchanged.
    return JSON.stringify(l);
}

export async function loadStore(accountOverride?: string): Promise<{
    conversations: DomainConversationIndex[]; exportedIds: Record<string, ExportRecord>;
    accountId: string; accounts: Account[];
}> {
    const ticket = ++loadGeneration;
    const snapshot = () => ({ conversations, exportedIds, accountId, accounts });
    const storage = getStorage();
    const available: Account[] = await storage.listAccounts();
    if (ticket !== loadGeneration) return snapshot();
    if (!available.length) {
        if (accountOverride) throw new Error('Selected account does not exist');
        accountId = ''; setAccounts([]); setConversations([]); setExportedIds({});
        return { conversations: [], exportedIds: {}, accountId: '', accounts: [] };
    }
    setAccounts(available);
    const target = accountOverride || accountId || available[0].id;
    if (!available.some(account => account.id === target)) throw new Error('Selected account does not exist');
    const [incoming, expIds] = await Promise.all([storage.getConversations(target), storage.getExportedIds(target)]);
    if (ticket !== loadGeneration) return snapshot();
    accountId = target;
    setExportedIds(expIds); setConversations(incoming);
    return { conversations: incoming, exportedIds: expIds, accountId: target, accounts: available };
}

export async function getLastSync(slot?: string): Promise<{ timestamp: number | null; count: number }> {
    const s = slot || accountId || '';
    const storage = getStorage();
    if (!s) return { timestamp: null, count: 0 };
    if (storage?.getLastSync) return await storage.getLastSync(s);
    return { timestamp: null, count: 0 };
}

export async function saveConversations(slot: string, list: DomainConversationIndex[]): Promise<void> {
    const s = slot || accountId;
    const storage = getStorage();
    if (storage?.setConversations) await storage.setConversations(s, list);
    if (s === accountId) setConversations(list);
}

export async function clearExported(slot: string): Promise<void> {
    const s = slot || accountId;
    const storage = getStorage();
    if (storage?.removeExportRecords) {
        // P1-3: clear via the transactional delete path instead of a bare
        // whole-map overwrite. removeExportRecords re-reads the map inside the
        // storage write chain and deletes only the listed ids, so records
        // written concurrently by saveExportRecord can neither be clobbered
        // (overwrite race) nor resurrected (delete-then-write race).
        const cur = (storage?.getExportedIds ? await storage.getExportedIds(s) : null) || {};
        await storage.removeExportRecords(s, Object.keys(cur));
    }
    if (s === accountId) setExportedIds({});
}

export async function clearAll(slot: string): Promise<void> {
    const s = slot || accountId;
    const storage = getStorage();
    if (storage?.clearConversations) {
        await storage.clearConversations(s);
    } else if (storage?.setConversations) {
        await storage.setConversations(s, []);
    }
    if (s === accountId) {
        setConversations([]);
        setExportedIds({});
    }
}

export async function getDevMode(): Promise<boolean> {
    const storage = getStorage();
    if (storage?.getDevMode) return await storage.getDevMode();
    return false;
}

export async function setDevMode(devOn: boolean): Promise<void> {
    const storage = getStorage();
    if (storage?.setDevMode) await storage.setDevMode(devOn);
}

export async function removeConversation(id: string): Promise<DomainConversationIndex[]> {
    if (!id) return conversations;
    const nid = normId(id);
    const capturedAccountId = accountId;
    const storage = getStorage();
    // Write-through: persist to storage first so a storage failure does not
    // leave the in-memory cache out of sync (item gone from cache but still
    // in chrome.storage). If the await throws, memory stays untouched.
    if (storage?.removeConversation) {
        await storage.removeConversation(capturedAccountId, nid);
    }
    if (accountId === capturedAccountId) conversations = (conversations || []).filter(c => c.id !== nid);
    return conversations;
}

export async function reconcileWithCloud(activeCloudList: Pick<DomainConversationIndex, 'id'>[], options: ReconcileOptions = {}): Promise<{ kept: number; removed: number; removedIds: string[] }> {
    const storage = getStorage();
    if (storage && storage.reconcileConversations) {
        const capturedAccountId = accountId;
        const res = await storage.reconcileConversations(capturedAccountId, activeCloudList, options);
        if (accountId !== capturedAccountId) return res;
        const activeIdSet = new Set((activeCloudList || []).map(c => c.id));
        const keepTakeout = options.keepTakeout !== false;
        conversations = (conversations || []).filter(c => {
            const nid = c.id;
            const isTakeout = keepTakeout && c.hasTakeoutImport;
            return activeIdSet.has(nid) || isTakeout;
        });
        return res;
    }
    return { kept: conversations.length, removed: 0, removedIds: [] };
}


export function hasTakeoutData(): boolean {
    return (conversations || []).some(c => c && c.hasTakeoutImport);
}

export const ConversationsStore: IConversationsStore = {
    getConversations,
    setConversations,
    removeConversation,
    reconcileWithCloud,
    getExportedIds,
    setExportedIds,
    getCurrentAccountId,
    setCurrentAccountId,
    getAccounts,
    setAccounts,
    getExportedRecord,
    getSignature,
    loadStore,
    getLastSync,
    saveConversations,
    clearExported,
    clearAll,
    getDevMode,
    setDevMode,
    hasTakeoutData,
    normId
};

export default ConversationsStore;
