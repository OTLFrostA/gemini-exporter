import type { Account } from '../../../l2/accountRegistry.js';
import type { ConversationKey } from '../../../l2/conversationKey.js';
import type { ProviderConversationItem } from '../../parsers/contracts.js';
import { CHATGPT_SOURCE_EVENT, chatGPTConversationId, chatGPTRequest, confirmedChatGPTDeletion } from './observation.js';
import { parseChatGPTConversation } from '../../parsers/chatgpt/parseConversation.js';
import { parseChatGPTList } from '../../parsers/chatgpt/parseList.js';
import { decodeChatGPTDetail } from '../../parsers/chatgpt/decodeDetail.js';
import { contentRuntimeHost, type ContentIngestionPort } from '../../contentPorts.js';
import { registerSerializedWindowBridge } from '../shared/streamAndBridge.js';

interface ChatGPTMessageBridgeCallbacks {
    isActive: () => boolean;
    currentAccount: () => Promise<(Account & { id: string }) | null>;
    onSaveRequested: (key: ConversationKey, refreshDetail: boolean) => Promise<unknown>;
    registerCleanup: (cleanup: () => void) => void;
    ingestion?: ContentIngestionPort;
}

function mapListItems(items: readonly ProviderConversationItem[]) {
    return items.map(item => ({
        conversationId: item.id,
        fields: {
            ...(item.title ? { title: item.title, titleSource: 'provider' as const } : {}),
            ...(item.createdAt !== undefined ? { createdAt: item.createdAt } : {}),
            ...(item.updatedAt !== undefined ? { updatedAt: item.updatedAt } : {}),
        },
    }));
}

export function initChatGPTMessageBridge(deps: ChatGPTMessageBridgeCallbacks): void {
    registerSerializedWindowBridge({
        eventType: CHATGPT_SOURCE_EVENT,
        label: 'ChatGPT capture',
        registerCleanup: deps.registerCleanup,
        handlePayload: async raw => {
            if (!deps.isActive() || typeof raw.url !== 'string'
                || !('kind' in raw) || typeof raw.requestIdentity !== 'string' || !('responseBody' in raw)) return;
            const method = raw.kind === 'detail' || raw.kind === 'list' ? 'GET'
                : raw.kind === 'delete' ? (raw.method === 'DELETE' ? 'DELETE' : 'PATCH')
                : raw.kind === 'stream' ? 'POST' : '';
            const source = new URL(raw.url);
            const request = raw.kind === 'sidebar' && source.origin === location.origin
                ? { kind: 'sidebar' as const } : chatGPTRequest(raw.url, method);
            if (!request || request.kind !== raw.kind) return;
            const account = await deps.currentAccount();
            if (!deps.isActive() || !account || account.providerAccountId !== raw.requestIdentity) return;
            const ingestion = deps.ingestion ?? contentRuntimeHost().ingestion;
            if (request.kind === 'list' || request.kind === 'sidebar') {
                const parsed = parseChatGPTList(raw.responseBody);
                if (parsed.conversations.some(item => !chatGPTConversationId(item.id))) return;
                await ingestion.ingestIndexes(account.id, mapListItems(parsed.conversations));
                return;
            }
            if (!chatGPTConversationId(raw.conversationId)
                || request.conversationId && request.conversationId !== raw.conversationId) return;
            const key = { accountId: account.id, conversationId: raw.conversationId };
            if (request.kind === 'delete') {
                if ('requestBody' in raw && confirmedChatGPTDeletion(raw.requestBody, raw.responseBody, method)) {
                    await ingestion.ingestDeletedConversation(account.id, key.conversationId);
                }
                return;
            }
            if (request.kind === 'detail') {
                let conversation;
                try { conversation = decodeChatGPTDetail(raw.responseBody, key.conversationId); }
                catch (error) {
                    if (error instanceof TypeError) return;
                    throw error;
                }
                const parsed = parseChatGPTConversation({ account, conversation, assetsByNode: new Map() });
                const admission = await ingestion.ingestDetail(account.id, key.conversationId, parsed.conversation.detail, parsed.conversation.index);
                if (!admission.accepted || !admission.changed) return;
            }
            await deps.onSaveRequested(key, request.kind === 'stream');
        },
    });
}
