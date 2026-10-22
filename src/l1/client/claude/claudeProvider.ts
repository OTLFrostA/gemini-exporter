import type { Account } from '../../../l2/accountRegistry.js';
import type { DomainAsset } from '../../../l2/conversationDetail.js';
import type { ConversationKey } from '../../../l2/conversationKey.js';
import { readConversationKey } from '../../../l2/conversationKey.js';
import type { ResourceBytes } from '../../../shared/resources/resourceResult.js';
import { getAccount } from '../../../runtime/api/accountRegistry.js';
import { ingestIndexes, ingestDetail } from '../../../l2/ingestion.js';
import { acquireSourceResource, type SourceResourceContext } from '../../resources/sourceResources.js';
import type { AIProvider, ListEnd, ProviderListOptions, ProviderReadiness } from '../aiProvider.js';
import { parseClaudeList } from '../../parsers/claude/parseList.js';
import { parseClaudeConversation } from '../../parsers/claude/parseConversation.js';
import { readClaudeSource } from './claudeAccess.js';

export interface ClaudeProviderDeps {
    apiGet?: (path: string, organizationId?: string) => Promise<unknown>;
    resources?: SourceResourceContext;
}

export class ClaudeProvider implements AIProvider {
    readonly id = 'claude';
    readonly name = 'Claude';
    readonly hostPatterns = ['https://claude.ai/*'];
    private readonly apiGet: NonNullable<ClaudeProviderDeps['apiGet']>;
    private readonly resources?: SourceResourceContext;
    constructor(deps: ClaudeProviderDeps = {}) {
        this.apiGet = deps.apiGet ?? readClaudeSource;
        this.resources = deps.resources;
    }
    matchesUrl(url: string): boolean {
        try { return new URL(url).origin === 'https://claude.ai'; }
        catch { return false; }
    }
    private async account(accountId: string): Promise<Account> {
        const account = await getAccount(accountId);
        if (!account || account.providerId !== this.id || !/^[\da-f-]{36}$/i.test(account.providerAccountId))
            throw new TypeError('Claude account mismatch');
        return account;
    }
    private async get<T>(path: string, account: Account, signal?: AbortSignal): Promise<T> {
        signal?.throwIfAborted();
        const result = await this.apiGet(path, account.providerAccountId);
        signal?.throwIfAborted();
        return result as T;
    }
    async checkReadiness(accountId: string): Promise<ProviderReadiness> {
        try {
            const account = await this.account(accountId);
            const raw = await this.get<unknown>('/api/organizations', account);
            if (!Array.isArray(raw) || !raw.some(o => o && typeof o === 'object' && o.uuid === account.providerAccountId))
                return { ready: false, error: 'Claude organization/account unavailable' };
            return { ready: true, accountName: account.displayName };
        } catch (error) {
            return { ready: false, error: error instanceof Error ? error.message : String(error) };
        }
    }
    async listConversations(options: ProviderListOptions): Promise<ListEnd> {
        if (options.streamId !== 'recent') throw new TypeError('Unknown Claude stream');
        const account = await this.account(options.accountId);
        const path = '/api/organizations/' + account.providerAccountId + '/chat_conversations';
        const requestedAt = Date.now();
        const parsed = parseClaudeList(await this.get(path, account, options.signal));
        // This endpoint returns an array without a total/next-page marker. We can
        // index the observed rows, but cannot prove remote source exhaustion.
        // Do not fabricate a trusted Coverage boundary or full-scan completion.
        void requestedAt;
        await ingestIndexes(account.id, parsed.conversations.map(item => ({ conversationId: item.id, fields: {
            ...(item.title ? { title: item.title, titleSource: 'provider' as const } : {}),
            ...(item.createdAt !== undefined ? { createdAt: item.createdAt } : {}),
            ...(item.updatedAt !== undefined ? { updatedAt: item.updatedAt } : {}),
        } })), undefined);
        options.signal?.throwIfAborted();
        await options.onPageCommitted?.({ page: 1, totalObserved: parsed.conversations.length });
        return 'max_pages';
    }
    async fetchConversationDetail(accountId: string, conversationId: string, signal?: AbortSignal): Promise<void> {
        const account = await this.account(accountId);
        if (!/^[\da-f-]{36}$/i.test(conversationId)) throw new TypeError('Invalid Claude conversation UUID');
        const path = '/api/organizations/' + account.providerAccountId + '/chat_conversations/'
            + conversationId + '?tree=true&rendering_mode=messages&render_all_tools=true';
        const parsed = parseClaudeConversation(await this.get(path, account, signal), conversationId);
        signal?.throwIfAborted();
        const admission = await ingestDetail(account.id, conversationId, parsed.conversation.detail, parsed.conversation.index);
        if (admission.accepted) this.resources?.retainParsed({ accountId, conversationId }, parsed);
    }
    async acquireResource(key: ConversationKey, asset: DomainAsset, signal?: AbortSignal): Promise<ResourceBytes> {
        readConversationKey(key);
        await this.account(key.accountId);
        const remote = () => acquireSourceResource(asset, signal);
        return this.resources ? this.resources.acquire(key, asset, signal, remote) : remote();
    }
}
