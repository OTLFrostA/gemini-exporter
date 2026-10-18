import { listAccounts } from '../../core/api/accountRegistry.js';
import { compareConversationIndexes } from '../../core/domain/conversationIndex.js';
import { getSettings, updateSettings, clearLocalExportRecords, clearLocalAccountData, deleteLocalConversations } from '../../core/application/index.js';
import { isAccountId, type Account } from '../../core/domain/accountRegistry.js';
import type { DomainConversationIndex } from '../../types/conversation.js';
import type { ExportRecord, IConversationsStore } from '../../types/ui.js';
import { __resolveModule } from '../../core/utils/moduleOverrides.js';

import * as Storage from '../../core/storage/storageService.js';

let conversations: DomainConversationIndex[] = [];
let exportedIds: Record<string, ExportRecord> = {};
let accountId: string = '';
let accounts: Account[] = [];
let loadGeneration = 0;

const getStorage = () => __resolveModule('StorageService', Storage);

// Conversation IDs are opaque; the UI must not strip provider-looking prefixes.
export const normId = (id?: string | null): string => id || '';

export function getConversations(): DomainConversationIndex[] { return conversations; }
export function setConversations(list: DomainConversationIndex[]): void { conversations = list || []; }
export function getExportedIds(): Record<string, ExportRecord> { return exportedIds; }

export function setExportedIds(map: Record<string, ExportRecord>): void { exportedIds = map || {}; }
export function getCurrentAccountId(): string { return accountId; }
export function setCurrentAccountId(id: string): void {
    if (id !== '' && !isAccountId(id)) throw new TypeError('Invalid account UUID');
    if (id !== accountId) { conversations = []; exportedIds = {}; }
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
    const available: Account[] = await listAccounts();
    if (ticket !== loadGeneration) return snapshot();
    if (!available.length) {
        if (accountOverride) throw new Error('Selected account does not exist');
        accountId = ''; setAccounts([]); setConversations([]); setExportedIds({});
        return { conversations: [], exportedIds: {}, accountId: '', accounts: [] };
    }
    setAccounts(available);
    const target = accountOverride || accountId || available[0].id;
    if (!available.some(account => account.id === target)) throw new Error('Selected account does not exist');
    const [incoming, expIds] = await Promise.all([storage.listIndexes(target), storage.listExportRecords(target)]);
    if (ticket !== loadGeneration) return snapshot();
    accountId = target;
    incoming.sort(compareConversationIndexes);
    setExportedIds(expIds); setConversations(incoming);
    return { conversations: incoming, exportedIds: expIds, accountId: target, accounts: available };
}

export async function getLastSync(slot?: string): Promise<{ timestamp: number | null; count: number }> {
    const target = slot || accountId;
    return { timestamp: null, count: target ? (await Storage.listIndexes(target)).length : 0 };
}

export async function clearExported(slot: string): Promise<void> {
    const target = slot || accountId;
    await clearLocalExportRecords(target);
    if (target === accountId) setExportedIds({});
}
export async function clearAll(slot: string): Promise<void> {
    const target = slot || accountId;
    await clearLocalAccountData(target);
    if (target === accountId) { setConversations([]); setExportedIds({}); }
}
export async function getDevMode(): Promise<boolean> { return (await getSettings()).developerMode; }
export async function setDevMode(developerMode: boolean): Promise<void> { await updateSettings({ developerMode }); }
export async function removeConversation(id: string): Promise<DomainConversationIndex[]> {
    const target = accountId;
    if (!id) return conversations;
    await deleteLocalConversations([{ accountId: target, conversationId: id }]);
    if (accountId === target) {
        conversations = conversations.filter(c => c.key.conversationId !== id);
        delete exportedIds[id];
    }
    return conversations;
}

export const ConversationsStore: IConversationsStore = {
    getConversations,
    setConversations,
    removeConversation,
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
    clearExported,
    clearAll,
    getDevMode,
    setDevMode,
    normId
};

export default ConversationsStore;
