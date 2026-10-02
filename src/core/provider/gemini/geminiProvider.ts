import type {
    GeminiProviderClient, GeminiProviderContract, GeminiProviderReadinessContext, GeminiProviderReadiness,
    GeminiProviderListOptions, GeminiProviderPageResult,
    GeminiProviderDetailOptions, GeminiProviderConversationDetail
} from "./geminiContracts.js";
import { ProviderRegistry } from "../providerRegistry.js";
import { GeminiAPIClient } from "../../api/geminiClient.js";
import GeminiClientCredentialManager from "../../api/client/credentialManager.js";

export class GeminiProvider implements GeminiProviderContract {
    readonly id = 'gemini';
    readonly name = 'Google Gemini';
    readonly hostPatterns = ['https://gemini.google.com/*', 'https://bard.google.com/*'];

    private client: GeminiProviderClient | null = null;

    constructor(client?: GeminiProviderClient) {
        if (client) {
            this.client = client;
        }
    }

    private getClient(): GeminiProviderClient {
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

    async checkReadiness(context?: GeminiProviderReadinessContext): Promise<GeminiProviderReadiness> {
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
        } catch (e: unknown) {
            return {
                ready: false,
                // Preserve the existing credential-error message projection without coercion.
                error: (e as { message?: string } | null | undefined)?.message || 'Gemini 凭据解析失败'
            };
        }
    }

    async listConversations(options?: GeminiProviderListOptions): Promise<GeminiProviderPageResult> {
        const client = this.getClient();
        const result = await client.getAllConversations(options);
        // Retain the explicit Gemini companion plus the neutral items alias.
        // stoppedEarly=true means pagination gave up before exhausting, so more may exist.
        return {
            ...result,
            items: result.conversations,
            hasMore: !!result.stoppedEarly,
            nextCursor: null,
        };
    }

    async fetchConversationDetail(conversationId: string, options?: GeminiProviderDetailOptions): Promise<GeminiProviderConversationDetail> {
        const client = this.getClient();
        const targetSid = options?.targetSid || options?.slot || null;
        const detail = await client.getConversationDetail(conversationId, targetSid);
        // The companion contract declares the complete pagination detail evidence.
        return {
            ...detail,
            id: detail.id,
            title: detail.title,
            messages: detail.messages,
        };
    }
}

export const defaultGeminiProvider = new GeminiProvider();
ProviderRegistry.register(defaultGeminiProvider);
ProviderRegistry.setDefaultProviderId('gemini');

export default GeminiProvider;

