import type { Account } from '../../../l2/accountRegistry.js';
import type { ConversationKey } from '../../../l2/conversationKey.js';
import { CHATGPT_SOURCE_EVENT, chatGPTConversationId, chatGPTRequest, confirmedChatGPTDeletion } from './observation.js';
import { parseChatGPTConversation } from '../../parsers/chatgpt/parseConversation.js';
import { parseChatGPTList } from '../../parsers/chatgpt/parseList.js';
import { decodeChatGPTDetail } from '../../parsers/chatgpt/decodeDetail.js';
import { ingestContentIndexes, ingestContentDetail, ingestContentDeletedConversation } from '../../../runtime/api/contentDomainIngestion.js';

export interface ChatGPTMessageBridgeCallbacks {
    currentAccount: () => Promise<(Account & { id: string }) | null>;
    onSaveRequested: (key: ConversationKey, refreshDetail: boolean) => Promise<unknown>;
    registerCleanup: (cleanup: () => void) => void;
}

export function initChatGPTMessageBridge(deps: ChatGPTMessageBridgeCallbacks): void {
    let queue = Promise.resolve();
    const receive = (event: MessageEvent<unknown>) => {
        if (event.source !== window || event.origin !== location.origin) return;
        const data = event.data;
        if (!data || typeof data !== 'object' || !('type' in data)
            || data.type !== CHATGPT_SOURCE_EVENT || !('payload' in data)) return;
        const raw = data.payload;
        queue = queue.catch(() => {}).then(async () => {
            if (!raw || typeof raw !== 'object' || !('url' in raw) || typeof raw.url !== 'string'
                || !('kind' in raw)
                || !('requestIdentity' in raw) || typeof raw.requestIdentity !== 'string' || !('responseBody' in raw)) return;
            const method = raw.kind === 'detail' || raw.kind === 'list' ? 'GET'
                : raw.kind === 'delete' ? ('method' in raw && raw.method === 'DELETE' ? 'DELETE' : 'PATCH')
                : raw.kind === 'stream' ? 'POST' : '';
            const source = new URL(raw.url);
            const request = raw.kind === 'sidebar' && source.origin === location.origin
                ? { kind: 'sidebar' as const } : chatGPTRequest(raw.url, method);
            if (!request || request.kind !== raw.kind) return;
            const account = await deps.currentAccount();
            if (!account || account.providerAccountId !== raw.requestIdentity) return;
            if (request.kind === 'list' || request.kind === 'sidebar') {
                const parsed = parseChatGPTList(raw.responseBody);
                if (parsed.conversations.some(item => !chatGPTConversationId(item.id))) return;
                // A loaded sidebar page is useful Index evidence, but is not proof
                // that all remote history has been scanned. Do not invent Coverage.
                await ingestContentIndexes(account.id, parsed.conversations.map(item => ({
                    conversationId: item.id,
                    fields: { ...(item.title ? { title: item.title, titleSource: 'provider' as const } : {}),
                        ...(item.createdAt !== undefined ? { createdAt: item.createdAt } : {}),
                        ...(item.updatedAt !== undefined ? { updatedAt: item.updatedAt } : {}) },
                })));
                return;
            }
            if (!('conversationId' in raw) || !chatGPTConversationId(raw.conversationId)
                || request.conversationId && request.conversationId !== raw.conversationId) return;
            const key = { accountId: account.id, conversationId: raw.conversationId };
            if (request.kind === 'delete') {
                if ('requestBody' in raw && confirmedChatGPTDeletion(raw.requestBody, raw.responseBody, method)) {
                    await ingestContentDeletedConversation(account.id, key.conversationId);
                }
                return;
            }
            if (request.kind === 'detail') {
                let conversation;
                try { conversation = decodeChatGPTDetail(raw.responseBody, key.conversationId); }
                catch (error) {
                    if (error instanceof TypeError) return; // Malformed or foreign source evidence.
                    throw error;
                }
                const parsed = parseChatGPTConversation({ account, conversation, assetsByNode: new Map() });
                const admission = await ingestContentDetail(account.id, key.conversationId, parsed.conversation.detail, parsed.conversation.index);
                if (!admission.accepted || !admission.changed) return;
            }
            // The worker rechecks the sending document's current Account. A stream
            // completion refreshes through the production provider before saving.
            await deps.onSaveRequested(key, request.kind === 'stream');
        }).catch(error => console.warn('[ChatGPT capture]', error));
    };
    window.addEventListener('message', receive);
    deps.registerCleanup(() => window.removeEventListener('message', receive));
}
