import type { Diagnostic } from '../../../shared/diagnostics/diagnostic.js';
import { OperationError, operationError } from '../../../shared/errors/operationError.js';
import { mapWithConcurrency } from '../../../shared/utils/concurrency.js';
import { PLATFORM_HOSTS, matchesPlatformPageUrl } from '../../../shared/platformHosts.js';
import type { AIProvider, ProviderListOptions, ProviderReadiness, ListEnd } from '../aiProvider.js';
import {
    assertValidResourceKey,
    commitProviderDetail,
    createDescendingPageChain,
    isIdentifiedProviderAccount,
    requireProviderAccount,
    toIndexIngestItems,
} from '../providerShared.js';
import type { DomainAsset } from '../../../l2/conversationDetail.js';
import type { ConversationKey } from '../../../l2/conversationKey.js';
import { ingestIndexes } from '../../../l2/ingestion.js';
import { acquireSourceResource, type SourceResourceContext } from '../../resources/sourceResources.js';
import { parseGrokList } from '../../parsers/grok/parseList.js';
import { parseGrokConversation } from '../../parsers/grok/parseConversation.js';
import { grokAccount, grokObject, grokUuid } from '../../parsers/grok/source.js';
import { readGrokImages } from './grokImages.js';
import { readGrokSource } from './grokSource.js';

export class GrokProvider implements AIProvider {
    readonly id = 'grok';
    readonly name = 'Grok';
    readonly hostPatterns = [...PLATFORM_HOSTS.grok.pages];
    private readonly apiRead: typeof readGrokSource;
    private readonly images: typeof readGrokImages;
    private readonly resources?: SourceResourceContext;
    constructor(deps: { apiRead?: typeof readGrokSource; resources?: SourceResourceContext; images?: typeof readGrokImages } = {}) {
        this.apiRead = deps.apiRead ?? readGrokSource; this.resources = deps.resources; this.images = deps.images ?? readGrokImages;
    }
    matchesUrl(url: string): boolean { return matchesPlatformPageUrl('grok', url); }
    private async account(id: string) {
        return requireProviderAccount('grok', id, grokUuid);
    }
    async checkReadiness(accountId: string): Promise<ProviderReadiness> {
        try {
            const account = await this.account(accountId);
            const user = grokAccount(await this.apiRead('/rest/auth/get-user', account.providerAccountId));
            return { ready: user.providerAccountId === account.providerAccountId, accountName: account.displayName };
        } catch (error) { return { ready: false, error: String(error) }; }
    }
    async listConversations(options: ProviderListOptions): Promise<ListEnd> {
        if (options.streamId !== 'recent') throw new TypeError('Unknown Grok stream');
        const account = await this.account(options.accountId), cursors = new Set<string>();
        const chain = createDescendingPageChain();
        let cursor: string | null = null, totalObserved = 0;
        for (let page = 1; page <= 100; page++) {
            options.signal?.throwIfAborted();
            const requestedAt = Date.now();
            const parsed = parseGrokList(await this.apiRead('/rest/app-chat/conversations?pageSize=60'
                + (cursor ? '&pageToken=' + cursor : ''), account.providerAccountId));
            options.signal?.throwIfAborted();
            const valid = parsed.conversations.length <= 60
                && !(parsed.nextCursor && (cursors.has(parsed.nextCursor) || !parsed.keys.length));
            const ordered = valid && chain.verifyAndAdvance(parsed.keys);
            if (!valid || !ordered || !isIdentifiedProviderAccount(account)) {
                throw new OperationError('SOURCE_RESPONSE_INVALID', 'Unverified Grok list ordering or pagination');
            }
            const evidence = { streamId: options.streamId, requestCursor: cursor, nextCursor: parsed.nextCursor,
                requestedAt, requestKnown: true, valid: true, ordered: true, keys: parsed.keys };
            const indexChanges = await ingestIndexes(account.id, toIndexIngestItems(parsed.conversations), evidence);
            totalObserved += parsed.keys.length;
            const stop = await options.onPageCommitted?.({ page, totalObserved, indexChanges, ...(page === 1 ? { scanHead: evidence } : {}) });
            if (!parsed.nextCursor) return 'source_end';
            if (stop) return 'stopped';
            cursor = parsed.nextCursor; cursors.add(cursor);
        }
        return 'max_pages';
    }
    async fetchConversationDetail(accountId: string, id: string, signal?: AbortSignal, onDiagnostic?: (diagnostic: Diagnostic) => void): Promise<void> {
        const account = await this.account(accountId);
        if (!grokUuid(id)) throw new TypeError('Invalid Grok conversation UUID');
        const read = async (path: string, body?: { responseIds: string[] }) => {
            signal?.throwIfAborted();
            const result = await this.apiRead(path, account.providerAccountId, body);
            signal?.throwIfAborted(); return result;
        };
        const base = '/rest/app-chat/conversations/' + id;
        const [metadata, tree] = await Promise.all([
            read('/rest/app-chat/conversations_v2/' + id + '?includeWorkspaces=true&includeTaskResult=true'),
            read(base + '/response-node?includeThreads=true'),
        ]);
        const nodes = grokObject(tree).responseNodes;
        if (!Array.isArray(nodes)) throw new OperationError('SOURCE_RESPONSE_INVALID', 'Invalid Grok response nodes');
        const ids = nodes.map(value => { const rid = grokObject(value).responseId;
            if (!grokUuid(rid)) throw new TypeError('Invalid Grok response UUID'); return rid; });
        const batchSlices: string[][] = [];
        for (let offset = 0; offset < ids.length; offset += 100) {
            batchSlices.push(ids.slice(offset, offset + 100));
        }
        const [batchPayloads, captured] = await Promise.all([
            mapWithConcurrency(batchSlices, 3, async (slice): Promise<readonly unknown[]> => {
                const batch = grokObject(await read(base + '/load-responses', { responseIds: slice }));
                const batchItems: unknown = batch.responses;
                if (!Array.isArray(batchItems)) throw new OperationError('SOURCE_RESPONSE_INVALID', 'Invalid Grok response batch');
                const typedItems: readonly unknown[] = batchItems;
                return typedItems;
            }, signal),
            this.images(id, account.providerAccountId),
        ]);
        const responses: unknown[] = batchPayloads.flat();
        signal?.throwIfAborted();
        for (const image of captured) {
            const response = responses.find(value => grokObject(value).responseId === image.responseId);
            if (!response) continue;
            const row = grokObject(response);
            const previous: readonly unknown[] = Array.isArray(row.capturedImages) ? (row.capturedImages as readonly unknown[]) : [];
            row.capturedImages = [...previous, image];
        }
        // A changing tree is a mixed snapshot; retry on the next operation.
        const after = await read(base + '/response-node?includeThreads=true');
        if (JSON.stringify(tree) !== JSON.stringify(after)) throw new OperationError('SOURCE_CHANGED', 'Grok conversation changed during acquisition');
        let parsed: ReturnType<typeof parseGrokConversation>;
        try { parsed = parseGrokConversation(metadata, tree, { responses }, id); }
        catch (error) { throw operationError(error, 'SOURCE_RESPONSE_INVALID'); }
        signal?.throwIfAborted();
        await commitProviderDetail({ accountId: account.id, conversationId: id, parsed, resources: this.resources, onDiagnostic });
    }
    async acquireResource(key: ConversationKey, asset: DomainAsset, signal?: AbortSignal, onDiagnostic?: (diagnostic: Diagnostic) => void) {
        assertValidResourceKey(key);
        await this.account(key.accountId);
        return this.resources ? this.resources.acquire(key, asset, signal, undefined, onDiagnostic) : acquireSourceResource(asset, signal, onDiagnostic);
    }
}
