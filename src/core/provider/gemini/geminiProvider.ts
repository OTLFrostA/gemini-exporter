/**
 * src/core/provider/gemini/geminiProvider.ts
 * Google Gemini Provider implementation.
 * Encapsulates batchexecute RPC communication, JSPB payload parsing,
 * multi-account slot resolution, and Takeout import integration.
 */
import type {
    AIProvider,
    ProviderCapabilities,
    ProviderReadiness
} from "../aiProvider.js";
import { ProviderRegistry } from "../providerRegistry.js";
import { GeminiAPIClient } from "../../api/geminiClient.js";
import GeminiClientCredentialManager from "../../api/client/credentialManager.js";
import type { PaginationOptions, PaginationResult } from "../../api/client/pagination.js";
import type { DetailParseResult } from "../../api/parser/parseDetail.js";

export class GeminiProvider implements AIProvider {
    readonly id = 'gemini';
    readonly name = 'Google Gemini';
    readonly hostPatterns = ['https://gemini.google.com/*'];

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
                    accountSlot: slot,
                    accountName: slot
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

    async listConversations(options?: PaginationOptions): Promise<PaginationResult> {
        const client = this.getClient();
        return client.getAllConversations(options);
    }

    async fetchConversationDetail(conversationId: string, options?: any): Promise<DetailParseResult> {
        const client = this.getClient();
        const targetSid = options?.targetSid || options?.slot || null;
        return client.getConversationDetail(conversationId, targetSid);
    }
}

// Auto-register default Gemini provider instance
export const defaultGeminiProvider = new GeminiProvider();
ProviderRegistry.register(defaultGeminiProvider);
ProviderRegistry.setDefaultProviderId('gemini');

export default GeminiProvider;

declare global {
    var GeminiProvider: any;
}
if (typeof globalThis !== 'undefined') {
    (globalThis as any).GeminiProvider = GeminiProvider;
}
