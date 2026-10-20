import { acquireSourceResource, type SourceResourceContext } from '../../resources/sourceResources.js';
import { chatgptAccountObservation } from './accountObservation.js';
import { readConversationKey, type ConversationKey } from '../../../l2/conversationKey.js';
import type { Account } from '../../../l2/accountRegistry.js';
import type { DomainAsset } from '../../../l2/conversationDetail.js';
import type { ResourceBytes } from '../../../shared/resources/resourceResult.js';
import type { ListEnd, PageEvidence } from '../aiProvider.js';
import { ingestIndexes, ingestDetail } from '../../../l2/ingestion.js';
import { getAccount } from '../../../runtime/api/accountRegistry.js';
/**
 * ChatGPT provider: acquisition only (session/list/detail/downloads).
 * Mapping parsing and Domain branding live in parsers/chatgpt, mirroring the
 * Gemini provider/client/parser split enforced by the trust boundary.
 * @unverified-provider-scaffold Not registered by default; optional hosts only.
 */
import type {
    AIProvider,
    ProviderListOptions,
    ProviderReadiness,
} from '../aiProvider.js';
import type {
    ChatGPTApiConversationWithId,
    ChatGPTApiSession,
} from '../../parsers/chatgpt/chatgptTypes.js';
import { CHATGPT_HOSTS, chatGPTApiBase } from '../../parsers/chatgpt/chatgptTypes.js';
import {
    parseChatGPTConversation,
} from '../../parsers/chatgpt/parseConversation.js';
import {
    buildFileDownloadPath,
    fileIdFromPointer,
    parseFileDownloadPayload,
} from './imageAssets.js';

import { parseChatGPTList } from '../../parsers/chatgpt/parseList.js';

export interface ChatGPTFetch {
    (input: string, init?: RequestInit): Promise<Response>;
}

interface ChatGPTProviderDeps {
    fetchFn?: ChatGPTFetch;
    origin?: string;
    resources?: SourceResourceContext;
}

export class ChatGPTProvider implements AIProvider {
    readonly id = 'chatgpt';
    readonly name = 'ChatGPT';
    readonly hostPatterns = ['https://chatgpt.com/*', 'https://chat.openai.com/*'];

    private fetchFn: ChatGPTFetch;
    private origin: string;
    private readonly resources?: SourceResourceContext;

    constructor(deps?: ChatGPTProviderDeps) {
        const globalFetch = globalThis.fetch as unknown as ChatGPTFetch | undefined;
        this.fetchFn =
            deps?.fetchFn
            ?? (globalFetch ? globalFetch.bind(globalThis) : (() => Promise.reject(new Error('fetch unavailable'))));
        this.origin = deps?.origin ?? 'https://chatgpt.com';
        this.resources = deps?.resources;
    }

    matchesUrl(url: string): boolean {
        if (!url || typeof url !== 'string') return false;
        try {
            const host = new URL(url).hostname;
            return CHATGPT_HOSTS.includes(host);
        } catch {
            return false;
        }
    }

    private async context(accountId: string): Promise<Account> {
        const account = await getAccount(accountId);
        if (!account || account.providerId !== this.id) throw new TypeError('Provider account mismatch');
        return account;
    }
    private async authedGet<T>(path: string, account: Account, signal?: AbortSignal): Promise<T> {
        signal?.throwIfAborted();
        const sessionResponse = await this.fetchFn(`${this.origin}/api/auth/session`, { credentials: 'include', signal });
        if (!sessionResponse.ok) throw new Error(`ChatGPT session failed: ${sessionResponse.status}`);
        const session = await sessionResponse.json() as ChatGPTApiSession;
        const observed = chatgptAccountObservation(session);
        if (observed ? observed.providerAccountId !== account.providerAccountId : account.providerAccountId !== 'default') throw new TypeError('ChatGPT request account mismatch');
        const token = session.accessToken;
        if (!token) throw new Error('ChatGPT session has no accessToken');
        const res = await this.fetchFn(`${chatGPTApiBase(this.origin)}${path}`, {
            credentials: 'include',
            signal,
            headers: {
                Authorization: `Bearer ${token}`,
                'X-Authorization': `Bearer ${token}`,
            },
        });
        if (!res.ok) throw new Error(`ChatGPT API ${path} failed: ${res.status}`);
        return (await res.json()) as T;
    }

    async checkReadiness(accountId: Account['id']): Promise<ProviderReadiness> {
        try {
            await this.context(accountId);
            const res = await this.fetchFn(`${this.origin}/api/auth/session`, {
                credentials: 'include',
            });
            if (!res.ok) return { ready: false, error: `ChatGPT session HTTP ${res.status}` };
            const session = (await res.json()) as ChatGPTApiSession;
            if (!session.accessToken) {
                return { ready: false, error: 'ChatGPT 未登录：/api/auth/session 无 accessToken' };
            }
            return { ready: true, accountName: session.user?.email ?? session.user?.name };
        } catch (e: unknown) {
            return { ready: false, error: e instanceof Error ? e.message : 'ChatGPT readiness 检查失败' };
        }
    }

    async listConversations(options: ProviderListOptions): Promise<ListEnd> {
        if (options.streamId !== 'recent') throw new TypeError('Unknown ChatGPT stream');
        options.signal?.throwIfAborted();
        const account = await this.context(options.accountId);
        let totalObserved = 0;
        let expectedTotal: number | undefined;
        let sentHead = false;
        const seen = new Set<string>();
        let lastTime = Infinity;
        for (let page = 1; page <= 20; page++) {
            options.signal?.throwIfAborted();
            const offset = (page - 1) * 100;
            const requestedAt = Date.now();
            const result = parseChatGPTList(await this.authedGet<unknown>(`/conversations?offset=${offset}&limit=100`, account, options.signal));
            options.signal?.throwIfAborted();
            const count = result.conversations.length;
            const sourceEnd = result.total !== undefined && offset + count === result.total;
            // These are request/response facts, not a second Domain or Coverage model.
            // An absent cursor by itself cannot prove source exhaustion.
            const valid = result.total !== undefined && result.total >= offset + count
                && result.offset === offset && result.limit === 100
                && result.hasMissingConversations === false
                && count <= 100 && (sourceEnd || count === 100)
                && (expectedTotal === undefined || expectedTotal === result.total);
            expectedTotal ??= result.total;
            const keys = result.conversations.flatMap(item => item.updatedAt === undefined
                ? [] : [{ id: item.id, time: item.updatedAt }]);
            // A trustworthy source chain cannot repeat an ID or move forward
            // in source activity time across two consecutive pages.
            const ordered = valid && keys.length === count
                && keys.every((key, i) => Number.isSafeInteger(key.time) && key.time > 0
                    && !seen.has(key.id) && (i === 0 ? key.time <= lastTime : keys[i - 1].time >= key.time))
                && new Set(keys.map(key => key.id)).size === keys.length;
            if (ordered) {
                keys.forEach(key => seen.add(key.id));
                if (keys.length) lastTime = keys[keys.length - 1].time;
            }
            const evidence: PageEvidence = {
                streamId: options.streamId,
                requestCursor: page === 1 ? null : String(offset),
                nextCursor: sourceEnd ? null : String(offset + 100),
                requestedAt, requestKnown: true, valid, ordered, keys,
            };
            // Keep individually parsed Index rows even when source-page evidence is
            // insufficient for trusted Coverage. Never report such a run complete.
            await ingestIndexes(account.id, result.conversations.map(item => ({ conversationId: item.id, fields: {
                ...(item.title ? { title: item.title, titleSource: 'provider' as const } : {}),
                ...(item.createdAt !== undefined ? { createdAt: item.createdAt } : {}),
                ...(item.updatedAt !== undefined ? { updatedAt: item.updatedAt } : {}) } })),
                account.providerAccountId === 'default' ? undefined : evidence);
            options.signal?.throwIfAborted();
            totalObserved += count;
            const trustedHead = !sentHead && page === 1 && valid && ordered && account.providerAccountId !== 'default';
            if (trustedHead) sentHead = true;
            const stop = await options.onPageCommitted?.({ page, totalObserved,
                ...(trustedHead ? { scanHead: evidence } : {}) });
            if (!valid || !ordered || account.providerAccountId === 'default')
                throw new Error('Unverified ChatGPT list page');
            if (sourceEnd) return 'source_end';
            if (stop) return 'stopped';
        }
        return 'max_pages';
    }
    async fetchConversationDetail(accountId: Account['id'], conversationId: ConversationKey['conversationId'], signal?: AbortSignal): Promise<void> {
        const account = await this.context(accountId);
        const raw = await this.authedGet<unknown>(`/conversation/${encodeURIComponent(conversationId)}`, account, signal);
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Invalid ChatGPT Detail payload');
        const sourceId = Reflect.get(raw, 'id');
        // Some endpoint versions omit the ID; an explicit different ID can
        // never be silently relabeled as the requested conversation.
        if (sourceId !== undefined && (typeof sourceId !== 'string' || sourceId !== conversationId))
            throw new TypeError('ChatGPT Detail identity mismatch');
        const conversation = { ...raw, id: conversationId } as ChatGPTApiConversationWithId;
        const parsed = parseChatGPTConversation({ account, conversation, assetsByNode: new Map() });
        signal?.throwIfAborted();
        const index = parsed.conversation.index;
        const admission = await ingestDetail(account.id, conversationId, parsed.conversation.detail, index);
        if (admission.accepted) this.resources?.retainParsed({ accountId, conversationId }, parsed);
    }
    async acquireResource(key: ConversationKey, asset: DomainAsset, signal?: AbortSignal): Promise<ResourceBytes> {
        signal?.throwIfAborted();
        readConversationKey(key);
        const account = await this.context(key.accountId);
        const remote = async () => {
            const fileId = asset.sourceUri?.startsWith('file-download:') ? asset.sourceUri.slice(14) : fileIdFromPointer(asset.sourceUri ?? '');
            if (!fileId) return acquireSourceResource(asset, signal);
            const exchange = parseFileDownloadPayload(await this.authedGet<unknown>(buildFileDownloadPath(fileId), account, signal));
            if (!exchange) throw new Error('ChatGPT resource locator unavailable');
            const response = await this.fetchFn(exchange.downloadUrl, { signal });
            if (!response.ok) throw new Error(`Resource request failed: ${response.status}`);
            const bytes = new Uint8Array(await response.arrayBuffer());
            signal?.throwIfAborted();
            if (!bytes.byteLength) throw new Error('Empty ChatGPT resource');
            return { bytes, ...(asset.mediaType ? { mediaType: asset.mediaType } : {}), ...(asset.name ? { name: asset.name } : {}) };
        };
        return this.resources ? this.resources.acquire(key, asset, signal, remote) : remote();
    }
}
