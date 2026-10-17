import { getDomainConversationResult } from '../../storage/domain/nativePersistence.js';
import { cacheAcquiredResources } from '../../storage/domain/resourceContext.js';
import { storageIdentity } from '../../storage/domain/domainStore.js';
import { parseGeminiIndexObservation } from '../../parsers/gemini/parseIndexObservation.js';
import { ingestIndexes, ingestDetail } from '../../domain/ingestion.js';
import { getAccount, getOrCreateAccount } from '../../api/accountRegistry.js';
import type {
    GeminiProviderClient, GeminiProviderContract, GeminiProviderReadiness,
    GeminiProviderListOptions, GeminiProviderPageResult,
    GeminiProviderConversationDetail
} from "./geminiContracts.js";
import { ProviderRegistry } from "../providerRegistry.js";
import { GeminiAPIClient } from "../../api/geminiClient.js";
import GeminiClientCredentialManager from "../../api/client/credentialManager.js";

/** Opaque neutral callers may pass any value; only observed string inputs are used. */
function readStringInput(input: unknown, key: 'accountSlot' | 'targetSid' | 'slot' | 'accountId'): string | undefined {
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
        const accountId = options?.accountId ?? (await getOrCreateAccount(this.id, 'default')).id;
        const account = await getAccount(accountId);
        if (!account || account.providerId !== this.id) throw new TypeError('Provider account mismatch');
        const result = await client.getAllConversations({ ...options,
            onProgress: progress => {
                const { batch: _batch, ...control } = progress;
                options?.onProgress?.(control);
            },
            onPageBatch: async (batch, info) => {
                if (options?.canCommit?.() === false) throw new Error('List request cancelled or account changed');
                const indexes = batch.map(item => parseGeminiIndexObservation(item, 'rpc-list', accountId));
                const observation = info.observation ? { ...info.observation, accountId } : undefined;
                // Unknown-source default data may be retained, but cannot establish trusted coverage.
                const page = account.providerAccountId !== 'default' ? observation : undefined;
                await ingestIndexes(accountId, indexes.map(({ key, ...fields }) => ({ conversationId: key.conversationId, fields })), page);
                const scanHead = page ? (({ providerId: _providerId, accountId: _accountId, items: _items, ...head }) => head)(page) : undefined;
                return options?.onPageBatch?.({ page: info.page, hasMore: info.hasMore, count: batch.length, ...(scanHead ? { scanHead } : {}) });
            },
        });
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
        // The Runtime supplies a captured UUID. Explicitly unknown identity uses the ordinary default account.
        const accountId = readStringInput(options, 'accountId') ?? (await getOrCreateAccount('gemini', 'default')).id;
        const account = await getAccount(accountId);
        if (!account || account.providerId !== this.id) throw new TypeError('Provider account mismatch');
        const detail = await client.getConversationDetail(conversationId, targetSid, account);
        const id = detail.conversation.index.key.conversationId;
        await ingestDetail(accountId, id, detail.conversation.detail, detail.conversation.index);
        await cacheAcquiredResources(storageIdentity(this.id, accountId, id), detail.conversation.detail.assets, detail.acquisitionHints);
        const accepted = await getDomainConversationResult(accountId, id, this.id);
        if (!accepted) throw new Error('Accepted Detail missing');
        return { ...detail, ...accepted, diagnostics: detail.diagnostics };
    }
}

export const defaultGeminiProvider = new GeminiProvider();
ProviderRegistry.register(defaultGeminiProvider);
ProviderRegistry.setDefaultProviderId('gemini');

export default GeminiProvider;

