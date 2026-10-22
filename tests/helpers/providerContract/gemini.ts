import { GeminiProvider } from '../../../src/l1/client/gemini/geminiProvider.js';
import { CHATGPT_ACCOUNT, GEMINI_ACCOUNT } from '../l1V2UnitMocks.js';
import { sourceDetail, sourceList } from '../l1SourceFixture.js';
import type { ProviderContractAdapter } from './contract.js';

/** Gemini's native RPC payload stays inside its fixture adapter. */
export const geminiContractAdapter: ProviderContractAdapter = {
    id: 'gemini',
    account: GEMINI_ACCOUNT,
    foreignAccount: CHATGPT_ACCOUNT,
    conversationId: 'source_chat_123',
    createProvider({ invalidList = false, onSourceRequest } = {}) {
        return new GeminiProvider({
            async getConversationList() {
                onSourceRequest?.();
                const page = sourceList(['source_chat_123']);
                if (invalidList) page.pageEvidence.valid = false;
                return page;
            },
            async getConversationDetail() {
                onSourceRequest?.();
                return sourceDetail();
            },
        }, async () => 'u0');
    },
};
