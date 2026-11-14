import type { Diagnostic } from '../../../shared/diagnostics/diagnostic.js';
import { OperationError, operationError } from '../../../shared/errors/operationError.js';
import { PLATFORM_HOSTS, matchesPlatformPageUrl } from '../../../shared/platformHosts.js';
import { claudeFileId, readClaudeFile } from './fileAssets.js';
import type { Account } from '../../../l2/accountRegistry.js';
import type { DomainAsset } from '../../../l2/conversationDetail.js';
import type { ConversationKey } from '../../../l2/conversationKey.js';
import type { ResourceBytes } from '../../../shared/resources/resourceResult.js';
import { ingestIndexes } from '../../../l2/ingestion.js';
import { acquireSourceResource, type SourceResourceContext } from '../../resources/sourceResources.js';
import type { AIProvider, ListEnd, ProviderListOptions, ProviderReadiness } from '../aiProvider.js';
import {
    assertValidResourceKey,
    commitProviderDetail,
    createDescendingPageChain,
    isIdentifiedProviderAccount,
    requireProviderAccount,
    toIndexIngestItems,
} from '../providerShared.js';
import { parseClaudeList } from '../../parsers/claude/parseList.js';
import { parseClaudeConversation } from '../../parsers/claude/parseConversation.js';
import { readClaudeSource } from './claudeSource.js';
import { claudeUuid } from '../../sniffer/claude/observation.js';

interface ClaudeProviderDeps {
    apiGet?: (path: string, organizationId?: string) => Promise<unknown>;
    resources?: SourceResourceContext;
}

export class ClaudeProvider implements AIProvider {
    readonly id = 'claude';
    readonly name = 'Claude';
    readonly hostPatterns = [...PLATFORM_HOSTS.claude.pages];
    private readonly apiGet: NonNullable<ClaudeProviderDeps['apiGet']>;
    private readonly resources?: SourceResourceContext;
    constructor(deps: ClaudeProviderDeps = {}) {
        this.apiGet = deps.apiGet ?? readClaudeSource;
        this.resources = deps.resources;
    }
    matchesUrl(url: string): boolean {
        return matchesPlatformPageUrl('claude', url);
    }
    private async account(accountId: string): Promise<Account> {
        return requireProviderAccount('claude', accountId, claudeUuid);
    }
    private async get(path: string, account: Account, signal?: AbortSignal): Promise<unknown> {
        signal?.throwIfAborted();
        const result = await this.apiGet(path, account.providerAccountId);
        signal?.throwIfAborted();
        return result;
    }
    async checkReadiness(accountId: string): Promise<ProviderReadiness> {
        try {
            const account = await this.account(accountId);
            const raw = await this.get('/api/organizations', account);
            if (!Array.isArray(raw) || !raw.some((org: unknown) => org !== null
                && typeof org === 'object' && 'uuid' in org && org.uuid === account.providerAccountId))
                return { ready: false, error: 'Claude organization/account unavailable' };
            return { ready: true, accountName: account.displayName };
        } catch (error) {
            return { ready: false, error: error instanceof Error ? error.message : String(error) };
        }
    }
    async listConversations(options: ProviderListOptions): Promise<ListEnd> {
        if (options.streamId !== 'recent') throw new TypeError('Unknown Claude stream');
        const account = await this.account(options.accountId);
        const chain = createDescendingPageChain();
        let totalObserved = 0;
        for (let page = 1; page <= 100; page++) {
            const offset = (page - 1) * 100, requestedAt = Date.now();
            const raw = await this.get('/api/organizations/' + account.providerAccountId
                + '/chat_conversations_v2?limit=100&offset=' + offset + '&consistency=strong', account, options.signal);
            if (!raw || typeof raw !== 'object' || !('data' in raw) || !('has_more' in raw)
                || typeof raw.has_more !== 'boolean'
                || ('search_incomplete' in raw && typeof raw.search_incomplete !== 'boolean'))
                throw new OperationError('SOURCE_RESPONSE_INVALID', 'Invalid Claude paginated list');
            const parsed = parseClaudeList(raw.data);
            const count = parsed.conversations.length;
            const sourceEnd = raw.has_more === false;
            const valid = count <= 100 && (sourceEnd || count === 100)
                && !('search_incomplete' in raw && raw.search_incomplete === true);
            const times = parsed.keys;
            const ordered = valid && chain.verifyAndAdvance(times);
            const identified = isIdentifiedProviderAccount(account);
            const evidence = { streamId: options.streamId, requestCursor: page === 1 ? null : String(offset),
                nextCursor: sourceEnd ? null : String(offset + 100), requestedAt,
                requestKnown: true, valid, ordered, keys: times };
            const indexChanges = await ingestIndexes(account.id, toIndexIngestItems(parsed.conversations),
                identified ? evidence : undefined);
            options.signal?.throwIfAborted();
            if (!valid || !ordered || !identified) throw new OperationError('SOURCE_RESPONSE_INVALID', 'Unverified Claude list page');
            totalObserved += count;
            const stop = await options.onPageCommitted?.({ page, totalObserved, indexChanges, ...(page === 1 ? { scanHead: evidence } : {}) });
            if (sourceEnd) return 'source_end';
            if (stop) return 'stopped';
        }
        return 'max_pages';
    }

    async fetchConversationDetail(accountId: string, conversationId: string, signal?: AbortSignal, onDiagnostic?: (diagnostic: Diagnostic) => void): Promise<void> {
        const account = await this.account(accountId);
        if (!claudeUuid(conversationId)) throw new TypeError('Invalid Claude conversation UUID');
        const path = '/api/organizations/' + account.providerAccountId + '/chat_conversations/'
            + conversationId + '?tree=true&rendering_mode=messages&render_all_tools=true';
        const raw = await this.get(path, account, signal);
        let parsed: ReturnType<typeof parseClaudeConversation>;
        try { parsed = parseClaudeConversation(raw, conversationId); }
        catch (error) { throw operationError(error, 'SOURCE_RESPONSE_INVALID'); }
        signal?.throwIfAborted();
        await commitProviderDetail({ accountId: account.id, conversationId, parsed, resources: this.resources, onDiagnostic });
    }
    canAcquireResourceDirectly(asset: DomainAsset): boolean { return claudeFileId(asset.sourceUri) !== null; }
    async acquireResource(key: ConversationKey, asset: DomainAsset, signal?: AbortSignal, onDiagnostic?: (diagnostic: Diagnostic) => void): Promise<ResourceBytes> {
        assertValidResourceKey(key);
        const account = await this.account(key.accountId);
        const id = claudeFileId(asset.sourceUri);
        const remote = async () => {
            const result = id ? await readClaudeFile(account.providerAccountId, id, signal) : await acquireSourceResource(asset, signal, onDiagnostic);
            if (asset.byteLength !== undefined && result.bytes.byteLength !== asset.byteLength) throw new OperationError('RESOURCE_SIZE_MISMATCH', 'Claude attachment byte count mismatch');
            return result;
        };
        return this.resources ? this.resources.acquire(key, asset, signal, remote, onDiagnostic) : remote();
    }
}
