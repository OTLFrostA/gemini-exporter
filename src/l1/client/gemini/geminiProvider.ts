import type { Account } from '../../../l2/accountRegistry.js';
import { parseGeminiIndexObservation } from '../../parsers/gemini/parseIndexObservation.js';
import { ingestIndexes, ingestDetail, ingestDeletedConversation } from '../../../l2/ingestion.js';
import { getAccount } from '../../../runtime/api/accountRegistry.js';
import type { GeminiProviderClient, GeminiProviderContract } from './geminiContracts.js';
import type { ProviderListOptions, ListEnd, ProviderReadiness } from '../aiProvider.js';
import { ProviderRegistry } from '../providerRegistry.js';
import { GeminiAPIClient, ConfirmedGeminiConversationNotFound } from './geminiClient.js';
import credentials from './api/credentialManager.js';
import { geminiListObservation } from './listObservation.js';
import { resolveCurrentAccount } from '../../../runtime/content/accountContext.js';
import { acquireSourceResource, type SourceResourceContext } from '../../resources/sourceResources.js';
import type { DomainAsset } from '../../../l2/conversationDetail.js';
import { readConversationKey, type ConversationKey } from '../../../l2/conversationKey.js';
import type { ResourceBytes } from '../../../shared/resources/resourceResult.js';

/** Runtime routing is frozen before acquisition, never inferred from SID or Slot. */
async function resolveRoute(accountId: string): Promise<string> {
    if (typeof document !== 'undefined' && location.hostname === 'gemini.google.com') {
        const context = await resolveCurrentAccount();
        if (context?.accountId === accountId) return context.slot;
    } else if (typeof chrome !== 'undefined' && chrome.tabs) {
        const tabs = await chrome.tabs.query({ url: ['https://gemini.google.com/*'] });
        for (const tab of tabs) {
            if (tab.id === undefined) continue;
            try {
                const response = await chrome.tabs.sendMessage(tab.id, { action: 'getAccountContext' });
                if (response?.ok && response.accountContext?.accountId === accountId
                    && /^u\d+$/.test(response.accountContext.slot)) return response.accountContext.slot;
            } catch { /* A tab without a content script is not a route. */ }
        }
    }
    throw new Error('No verified Gemini account route');
}

export class GeminiProvider implements GeminiProviderContract {
    readonly id = 'gemini';
    readonly name = 'Google Gemini';
    readonly hostPatterns = ['https://gemini.google.com/*', 'https://bard.google.com/*'];
    private client: GeminiProviderClient | null;
    constructor(client?: GeminiProviderClient, private route = resolveRoute, private readonly resources?: SourceResourceContext) { this.client = client ?? null; }
    private getClient(): GeminiProviderClient { return this.client ??= new GeminiAPIClient(); }
    private async context(accountId: string) {
        const account = await getAccount(accountId);
        if (!account || account.providerId !== this.id) throw new TypeError('Provider account mismatch');
        const slot = await this.route(accountId);
        return { account, slot };
    }
    matchesUrl(url: string): boolean {
        try { return ['gemini.google.com', 'bard.google.com'].includes(new URL(url).hostname); }
        catch { return false; }
    }
    async checkReadiness(accountId: Account['id']): Promise<ProviderReadiness> {
        try {
            const { slot } = await this.context(accountId);
            const cred = await credentials.resolveCred(slot);
            return cred.at ? { ready: true } : { ready: false, error: 'Gemini credentials unavailable' };
        } catch (error) { return { ready: false, error: error instanceof Error ? error.message : 'Gemini unavailable' }; }
    }
    async listConversations(options: ProviderListOptions): Promise<ListEnd> {
        if (options.streamId !== 'recent' && options.streamId !== 'pinned') throw new TypeError('Unknown Gemini stream');
        options.signal?.throwIfAborted();
        const { account, slot } = await this.context(options.accountId);
        const client = this.getClient();
        const seen = new Set<string>();
        let cursor: string | null = null, totalObserved = 0, sentHead = false;
        for (let page = 1; page <= 2000; page++) {
            options.signal?.throwIfAborted();
            if (await this.route(account.id) !== slot) throw new Error('Gemini account route changed');
            const requestedAt = Date.now();
            const result = await client.getConversationList(cursor, slot,
                options.streamId === 'pinned' ? [1, null, 1] : undefined, { signal: options.signal });
            options.signal?.throwIfAborted();
            const observation = geminiListObservation(result, { streamId: options.streamId, requestCursor: cursor }, account.id, false, requestedAt);
            if (result.failure && observation.terminal !== 'provider_limit') throw new Error(`Gemini list failed: ${result.failure}`);
            const pageEvidence = account.providerAccountId === 'default' ? undefined : observation;
            await ingestIndexes(account.id, result.conversations.map(item => parseGeminiIndexObservation(item, 'rpc-list')), pageEvidence);
            options.signal?.throwIfAborted();
            totalObserved += result.conversations.length;
            const { providerId: _provider, accountId: _account, items: _items, ...head } = observation;
            const trustedHead = !sentHead && pageEvidence && head.requestCursor === null && head.requestKnown && head.valid && head.ordered;
            if (trustedHead) sentHead = true;
            const stop = await options.onPageCommitted?.({ page, totalObserved, ...(trustedHead ? { scanHead: head } : {}) });
            if (result.failure === 'hit_google_limit') return 'provider_limit';
            // The public ListEnd must not call a source terminal reliable when its
            // committed Recent page lacks trustworthy ordering evidence.
            if (!result.pageEvidence.valid || (options.streamId === 'recent' && !observation.ordered))
                throw new Error('Unverified Gemini list page');
            if (result.nextPageToken === null) return 'source_end';
            if (seen.has(result.nextPageToken)) throw new Error('Gemini list cursor loop');
            if (stop) return 'stopped';
            seen.add(result.nextPageToken);
            cursor = result.nextPageToken;
        }
        return 'max_pages';
    }
    async fetchConversationDetail(accountId: Account['id'], conversationId: ConversationKey['conversationId'], signal?: AbortSignal): Promise<void> {
        signal?.throwIfAborted();
        const { account, slot } = await this.context(accountId);
        let parsed: Awaited<ReturnType<GeminiProviderClient['getConversationDetail']>>;
        try {
            parsed = await this.getClient().getConversationDetail(conversationId, slot, account, signal);
        } catch (error) {
            if (!(error instanceof ConfirmedGeminiConversationNotFound)) throw error;
            signal?.throwIfAborted();
            if (error.sourceConversationId !== `c_${conversationId.replace(/^c_/, '')}`) throw error;
            await ingestDeletedConversation(accountId, conversationId.replace(/^c_/, ''));
            throw new Error('conversation_not_found');
        }
        signal?.throwIfAborted();
        if (parsed.conversationId !== conversationId.replace(/^c_/, '')) throw new TypeError('Detail identity mismatch');
        const index = parsed.conversation.index;
        await ingestDetail(accountId, parsed.conversationId, parsed.conversation.detail, index);
        this.resources?.retainParsed({ accountId, conversationId: parsed.conversationId }, parsed);
    }
    async acquireResource(key: ConversationKey, asset: DomainAsset, signal?: AbortSignal): Promise<ResourceBytes> {
        signal?.throwIfAborted();
        readConversationKey(key);
        const account = await getAccount(key.accountId);
        if (!account || account.providerId !== this.id) throw new TypeError('Provider account mismatch');
        const remote = async () => {
            if (!asset.sourceUri?.startsWith('data:')) await this.context(key.accountId);
            return acquireSourceResource(asset, signal);
        };
        return this.resources ? this.resources.acquire(key, asset, signal, remote) : remote();
    }
}
export const defaultGeminiProvider = new GeminiProvider();
ProviderRegistry.register(defaultGeminiProvider);
ProviderRegistry.setDefaultProviderId('gemini');
export default GeminiProvider;
