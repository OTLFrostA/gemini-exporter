import { isAccountId } from './accountRegistry.js';

export interface ConversationKey { accountId: string; conversationId: string }
export function conversationKey(accountId: string, conversationId: string): ConversationKey {
    if (!isAccountId(accountId) || typeof conversationId !== 'string' || !conversationId || conversationId !== conversationId.trim()) throw new TypeError('Invalid conversation key');
    return { accountId, conversationId };
}
export function readConversationKey(value: unknown): ConversationKey {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => k !== 'accountId' && k !== 'conversationId')) throw new TypeError('Invalid conversation key');
    const { accountId, conversationId } = value as ConversationKey;
    return conversationKey(accountId, conversationId);
}
export function sameConversationKey(a: Readonly<ConversationKey>, b: Readonly<ConversationKey>): boolean {
    return a.accountId === b.accountId && a.conversationId === b.conversationId;
}
