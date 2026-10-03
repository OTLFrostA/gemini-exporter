import type {
    GeminiProviderClient, GeminiProviderContract, GeminiProviderReadiness,
    GeminiProviderListOptions, GeminiProviderPageResult,
    GeminiProviderConversationDetail
} from "./geminiContracts.js";
import { ProviderRegistry } from "../providerRegistry.js";
import { GeminiAPIClient } from "../../api/geminiClient.js";
import GeminiClientCredentialManager from "../../api/client/credentialManager.js";

/** Opaque neutral callers may pass any value; only observed string inputs are used. */
function readStringInput(input: unknown, key: 'accountSlot' | 'targetSid' | 'slot'): string | undefined {
    if (input === null || (typeof input !== 'object' && typeof input !== 'function') || !(key in input)) return undefined;
    const value: unknown = Reflect.get(input, key);
    return typeof value === 'string' ? value : undefined;
}

/** Credential failures are diagnostics; only a nonempty string is a readiness error. */
function readinessErrorMessage(error: unknown): string {
    const message = error instanceof Error
        ? error.message
        : error !== null && (typeof error === 'object' || typeof error === 'function') && 'message' in error
            ? error.message
            : undefined;
    return typeof message === 'string' && message ? message : 'Gemini 凭据解析失败';
}

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

    async checkReadiness(context?: unknown): Promise<GeminiProviderReadiness> {
        try {
            const slot = readStringInput(context, 'accountSlot') || 'u0';
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
                error: readinessErrorMessage(e)
            };
        }
    }

    async listConversations(options?: GeminiProviderListOptions): Promise<GeminiProviderPageResult> {
        const client = this.getClient();
        const result = await client.getAllConversations(options);
        // The companion retains Gemini control evidence; hasMore remains the legacy hint.
        const page: GeminiProviderPageResult = {
            items: result.conversations,
            conversations: result.conversations,
            total: result.total,
            exhaustive: result.exhaustive,
            completionReason: result.completionReason,
            diagnostics: result.diagnostics,
            hitGoogleLimit: result.hitGoogleLimit,
            hasMore: !!result.stoppedEarly,
            nextCursor: null,
        };
        // Preserve absence versus an explicitly present undefined value.
        if (Object.prototype.propertyIsEnumerable.call(result, 'stoppedEarly')) page.stoppedEarly = result.stoppedEarly;
        return page;
    }

    async fetchConversationDetail(conversationId: string, options?: unknown): Promise<GeminiProviderConversationDetail> {
        const client = this.getClient();
        const targetSid = readStringInput(options, 'targetSid') || readStringInput(options, 'slot') || null;
        const detail = await client.getConversationDetail(conversationId, targetSid);
        // Keep the full typed Gemini evidence beside the neutral core without cloning messages.
        const mapped: GeminiProviderConversationDetail = {
            id: detail.id,
            title: detail.title,
            messages: detail.messages,
            url: detail.url,
            createdAt: detail.createdAt,
            updatedAt: detail.updatedAt,
            messageCount: detail.messageCount,
            titleSource: detail.titleSource,
            titles: detail.titles,
            timestamp: detail.timestamp,
            chatTime: detail.chatTime,
            nextPageToken: detail.nextPageToken,
            attachmentCount: detail.attachmentCount,
        };
        // Optional evidence keeps the producer's own enumerable property presence.
        if (Object.prototype.propertyIsEnumerable.call(detail, 'schemaDrift')) mapped.schemaDrift = detail.schemaDrift;
        if (Object.prototype.propertyIsEnumerable.call(detail, 'turnsRejected')) mapped.turnsRejected = detail.turnsRejected;
        if (Object.prototype.propertyIsEnumerable.call(detail, 'truncated')) mapped.truncated = detail.truncated;
        if (Object.prototype.propertyIsEnumerable.call(detail, 'isTruncated')) mapped.isTruncated = detail.isTruncated;
        if (Object.prototype.propertyIsEnumerable.call(detail, 'truncateReason')) mapped.truncateReason = detail.truncateReason;
        if (Object.prototype.propertyIsEnumerable.call(detail, '_raw')) mapped._raw = detail._raw;
        if (Object.prototype.propertyIsEnumerable.call(detail, '_debug')) mapped._debug = detail._debug;
        return mapped;
    }
}

export const defaultGeminiProvider = new GeminiProvider();
ProviderRegistry.register(defaultGeminiProvider);
ProviderRegistry.setDefaultProviderId('gemini');

export default GeminiProvider;

