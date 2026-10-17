import type { Account } from '../domain/accountRegistry.js';
import type { ConversationKey } from '../domain/conversationKey.js';
import type { DomainConversationIndex } from '../domain/conversationIndex.js';
import type { DomainConversationDetail } from '../domain/conversationDetail.js';
import { inStore, readOne, putOne, deleteOne } from './idb.js';

export const conversationAddress = (key: ConversationKey): [string, string] => [key.accountId, key.conversationId];
export function getIndex(key: ConversationKey): Promise<DomainConversationIndex | null> {
    return readOne('indexes', conversationAddress(key));
}
export function listIndexes(accountId: Account['id']): Promise<DomainConversationIndex[]> {
    return inStore<DomainConversationIndex[]>('indexes', 'readonly', (store, done) => {
        const request = store.index('byAccount').getAll(accountId);
        request.onsuccess = () => done(request.result);
    });
}
export async function putIndexes(accepted: readonly DomainConversationIndex[]): Promise<void> {
    if (!accepted.length) return;
    await inStore('indexes', 'readwrite', store => { for (const index of accepted) store.put(index); });
}
export function deleteIndex(key: ConversationKey): Promise<void> {
    return deleteOne('indexes', conversationAddress(key));
}
export function getDetail(key: ConversationKey): Promise<DomainConversationDetail | null> {
    return readOne('details', conversationAddress(key));
}
export function putDetail(accepted: DomainConversationDetail): Promise<void> {
    return putOne('details', accepted);
}
export function deleteDetail(key: ConversationKey): Promise<void> {
    return deleteOne('details', conversationAddress(key));
}
