import type {
    AIProvider,
    ProviderCapabilities,
    ProviderReadiness,
    ProviderPageResult,
    ProviderConversationItem,
    ProviderConversationDetail
} from "../aiProvider.js";
import { ProviderRegistry } from "../providerRegistry.js";
import { GeminiAPIClient } from "../../api/geminiClient.js";
import GeminiClientCredentialManager from "../../api/client/credentialManager.js";

export class GeminiProvider implements AIProvider {
    readonly id = 'gemini';
    readonly name = 'Google Gemini';
    readonly hostPatterns = ['https://gemini.google.com/*', 'https://bard.google.com/*'];

    readonly capabilities: ProviderCapabilities = {
        supportsRealtimeSniffing: true,
        supportsTakeoutImport: true,
        supportsThoughtBlocks: true,
        supportsIncrementalSync: true,
        supportsMultiAccount: true
    };

    private client: GeminiAPIClient | null = null;

    constructor(client?: GeminiAPIClient) {
        if (client) {
            this.client = client;
        }
    }

    private getClient(): GeminiAPIClient {
        if (!this.client) {
            this.client = new GeminiAPIClient();
        }
        return this.client;
    }

    matchesUrl(url: string): boolean {
        if (!url || typeof url !== 'string') return false;
        try {
            const parsed = new URL(url);
            return parsed.hostname === 'gemini.google.com' || parsed.hostname === 'bard.google.com';
        } catch {
            return false;
        }
    }

    async checkReadiness(context?: any): Promise<ProviderReadiness> {
        try {
            const slot = context?.accountSlot || 'u0';
            const cred = await GeminiClientCredentialManager.resolveCred(slot);
            if (cred && cred.at) {
                return {
                    ready: true,
                    accountSlot: slot
                };
            }
            return {
                ready: false,
                accountSlot: slot,
                error: '未获取到有效认证凭据，请刷新 gemini.google.com'
            };
        } catch (e: any) {
            return {
                ready: false,
                error: e?.message || 'Gemini 凭据解析失败'
            };
        }
    }

    async listConversations(options?: any): Promise<ProviderPageResult<ProviderConversationItem>> {
        const client = this.getClient();
        const result = await client.getAllConversations(options);
        // Map the Gemini pagination result into the provider-neutral page shape.
        // stoppedEarly=true means pagination gave up before exhausting, so more may exist.
        return {
            ...result,
            items: result.conversations,
            hasMore: !!result.stoppedEarly,
            nextCursor: null,
        };
    }

    async fetchConversationDetail(conversationId: string, options?: any): Promise<ProviderConversationDetail> {
        const client = this.getClient();
        const targetSid = options?.targetSid || options?.slot || null;
        const detail = await client.getConversationDetail(conversationId, targetSid);
        // Spread keeps every Gemini field; id/title/messages are guaranteed present.
        return {
            ...detail,
            id: detail.id,
            title: detail.title,
            messages: detail.messages,
        };
    }
}

// Auto-register default Gemini provider instance
export const defaultGeminiProvider = new GeminiProvider();
ProviderRegistry.register(defaultGeminiProvider);
ProviderRegistry.setDefaultProviderId('gemini');

export default GeminiProvider;

