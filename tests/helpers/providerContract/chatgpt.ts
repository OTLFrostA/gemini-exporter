import { ChatGPTProvider } from '../../../src/l1/client/chatgpt/chatgptProvider.js';
import type { ChatGPTApiConversationWithId } from '../../../src/l1/parsers/chatgpt/chatgptTypes.js';
import { CHATGPT_ACCOUNT, GEMINI_ACCOUNT } from '../l1V2UnitMocks.js';
import type { ProviderContractAdapter } from './contract.js';

const conversationId = 'gpt-contract';
const nativeDetail = {
    id: conversationId,
    title: 'Contract source title',
    create_time: 1700000000,
    update_time: 1700000010,
    current_node: 'a1',
    is_archived: false,
    mapping: {
        root: { id: 'root', children: ['u1'] },
        u1: {
            id: 'u1', parent: 'root', children: ['a1'],
            message: {
                id: 'msg-u1', author: { role: 'user', metadata: {} },
                content: { content_type: 'text', parts: ['Contract question'] },
                recipient: 'all', status: 'finished_successfully', weight: 1,
            },
        },
        a1: {
            id: 'a1', parent: 'u1', children: [],
            message: {
                id: 'msg-a1', author: { role: 'assistant', metadata: {} },
                content: { content_type: 'text', parts: ['Contract answer'] },
                recipient: 'all', status: 'finished_successfully', weight: 1,
            },
        },
    },
} satisfies ChatGPTApiConversationWithId;

/** ChatGPT's native REST/session payload stays inside its fixture adapter. */
export const chatgptContractAdapter: ProviderContractAdapter = {
    id: 'chatgpt',
    account: CHATGPT_ACCOUNT,
    foreignAccount: GEMINI_ACCOUNT,
    conversationId,
    createProvider({ invalidList = false, onSourceRequest } = {}) {
        return new ChatGPTProvider({
            fetchFn: async url => {
                onSourceRequest?.();
                if (url.endsWith('/api/auth/session')) {
                    return new Response(JSON.stringify({
                        accessToken: 'contract-token',
                        user: { id: 'user-1' },
                        account: { id: 'workspace-1' },
                    }));
                }
                if (url.includes('/backend-api/conversations?')) {
                    return new Response(JSON.stringify({
                        items: [{
                            id: conversationId, title: 'Contract source title',
                            create_time: 1700000000, update_time: 1700000010,
                        }],
                        total: 1, offset: 0, limit: 100,
                        has_missing_conversations: invalidList,
                    }));
                }
                if (url.includes('/backend-api/conversation/')) {
                    return new Response(JSON.stringify(nativeDetail));
                }
                throw new Error('Unexpected ChatGPT fixture URL: ' + url);
            },
        });
    },
};
