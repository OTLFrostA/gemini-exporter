import { abortableSleep, calculateBackoff } from '../../../shared/utils/retryUtils.js';
import { ResourceHttpError, ResourceProcessingError } from '../../../shared/resources/resourceResult.js';
import { acquireSourceResource, type SourceResourceContext } from '../../resources/sourceResources.js';
import { readChatGPTSession } from './accountObservation.js';
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
import { CHATGPT_HOSTS, chatGPTApiBase } from '../../parsers/chatgpt/chatgptTypes.js';
import { parseChatGPTConversation } from '../../parsers/chatgpt/parseConversation.js';
import { decodeChatGPTDetail } from '../../parsers/chatgpt/decodeDetail.js';
import {
    buildFileDownloadPath,
    fileIdFromPointer,
    parseFileDownloadPayload,
} from './imageAssets.js';

import { parseChatGPTList } from '../../parsers/chatgpt/parseList.js';

interface ChatGPTFetch {
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
    private readonly cooldowns = new Map<string, number>();
    private readonly resources?: SourceResourceContext;

    constructor(deps?: ChatGPTProviderDeps) {
        const globalFetch = typeof globalThis.fetch === 'function'
            ? globalThis.fetch.bind(globalThis) : undefined;
        this.fetchFn = deps?.fetchFn ?? globalFetch
            ?? (() => Promise.reject(new Error('fetch unavailable')));
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
    private async authedGet(path: string, account: Account, signal?: AbortSignal): Promise<unknown> {
        for (let attempt = 0; ; attempt++) {
            // Account-scoped cooldown also applies to another request on this
            // provider. A cancelled export must not erase the server deadline.
            let remaining = (this.cooldowns.get(account.id) ?? 0) - Date.now();
            while (remaining > 0) {
                if (await abortableSleep(remaining, signal)) signal?.throwIfAborted();
                remaining = (this.cooldowns.get(account.id) ?? 0) - Date.now();
            }
            signal?.throwIfAborted();
            // Re-observe identity after every cooldown; a browser account can
            // change while the export is waiting.
            const sessionResponse = await this.fetchFn(`${this.origin}/api/auth/session`, { credentials: 'include', signal });
            if (!sessionResponse.ok) throw new Error(`ChatGPT session failed: ${sessionResponse.status}`);
            const rawSession: unknown = await sessionResponse.json();
            const { accessToken: token, observation: observed } = readChatGPTSession(rawSession);
            if (observed ? observed.providerAccountId !== account.providerAccountId : account.providerAccountId !== 'default') throw new TypeError('ChatGPT request account mismatch');
            if (!token) throw new Error('ChatGPT session has no accessToken');
            const res = await this.fetchFn(`${chatGPTApiBase(this.origin)}${path}`, {
                credentials: 'include', signal,
                headers: { Authorization: `Bearer ${token}`, 'X-Authorization': `Bearer ${token}` },
            });
            if (res.status === 429) {
                const header = res.headers.get('Retry-After');
                const seconds = header !== null && /^\d+(?:\.\d+)?$/.test(header.trim()) ? Number(header) * 1000 : NaN;
                const date = header ? Date.parse(header) - Date.now() : NaN;
                const retryAfterMs = Number.isFinite(seconds) ? seconds : Number.isFinite(date) ? Math.max(0, date) : 0;
                const delay = calculateBackoff(attempt, { initialDelayMs: 30000, maxDelayMs: 120000, retryAfterMs });
                this.cooldowns.set(account.id, Math.max(this.cooldowns.get(account.id) ?? 0, Date.now() + delay));
                if (attempt < 3) continue;
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}: ChatGPT API ${path} failed`);
            const raw: unknown = await res.json();
            return raw;
        }
    }

    async checkReadiness(accountId: Account['id']): Promise<ProviderReadiness> {
        try {
            await this.context(accountId);
            const res = await this.fetchFn(`${this.origin}/api/auth/session`, {
                credentials: 'include',
            });
            if (!res.ok) return { ready: false, error: `ChatGPT session HTTP ${res.status}` };
            const rawSession: unknown = await res.json();
            const { accessToken, accountName } = readChatGPTSession(rawSession);
            if (!accessToken) {
                return { ready: false, error: 'ChatGPT 未登录：/api/auth/session 无 accessToken' };
            }
            return { ready: true, ...(accountName ? { accountName } : {}) };
        } catch (e: unknown) {
            return { ready: false, error: e instanceof Error ? e.message : 'ChatGPT readiness 检查失败' };
        }
    }

    async listConversations(options: ProviderListOptions): Promise<ListEnd> {
        if (options.streamId !== 'recent') throw new TypeError('Unknown ChatGPT stream');
        options.signal?.throwIfAborted();
        const account = await this.context(options.accountId);
        let totalObserved = 0;
        let sentHead = false;
        const seen = new Set<string>();
        let lastTime = Infinity;
        for (let page = 1; page <= 20; page++) {
            options.signal?.throwIfAborted();
            const offset = (page - 1) * 100;
            const requestedAt = Date.now();
            const result = parseChatGPTList(await this.authedGet(`/conversations?offset=${offset}&limit=100`, account, options.signal));
            options.signal?.throwIfAborted();
            const count = result.conversations.length;
            const sourceEnd = result.total !== undefined && offset + count === result.total;
            // These are request/response facts, not a second Domain or Coverage model.
            // An absent cursor by itself cannot prove source exhaustion.
            const valid = result.total !== undefined && result.total >= offset + count
                && result.offset === offset && result.limit === 100
                // Current backend responses omit this legacy flag. The total,
                // offset and page size still prove exhaustion; an explicit
                // missing-conversations warning must continue to reject it.
                && result.hasMissingConversations !== true
                && count <= 100 && (sourceEnd || count === 100);
            // ChatGPT can report offset + count + 1 as a lower bound while
            // more rows exist (101, 201, ...), rather than a stable total.
            // Validate each page's metadata; only equality proves source end.
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
        const raw = await this.authedGet(`/conversation/${encodeURIComponent(conversationId)}`, account, signal);
        const conversation = decodeChatGPTDetail(raw, conversationId);
        const parsed = parseChatGPTConversation({ account, conversation, assetsByNode: new Map() });
        signal?.throwIfAborted();
        const index = parsed.conversation.index;
        const admission = await ingestDetail(account.id, conversationId, parsed.conversation.detail, index);
        if (admission.accepted) this.resources?.retainParsed({ accountId, conversationId }, parsed);
    }
    canAcquireResourceDirectly(asset: DomainAsset): boolean {
        return !!fileIdFromPointer(asset.sourceUri ?? '') || /^file-download:[a-zA-Z0-9_-]+$/.test(asset.sourceUri ?? '');
    }
    async acquireResource(key: ConversationKey, asset: DomainAsset, signal?: AbortSignal): Promise<ResourceBytes> {
        signal?.throwIfAborted();
        readConversationKey(key);
        const account = await this.context(key.accountId);
        const remote = async () => {
            const fileId = asset.sourceUri?.startsWith('file-download:') ? asset.sourceUri.slice(14) : fileIdFromPointer(asset.sourceUri ?? '');
            if (!fileId) return acquireSourceResource(asset, signal);
            const exchange = parseFileDownloadPayload(await this.authedGet(buildFileDownloadPath(fileId), account, signal));
            if (!exchange) throw new Error('ChatGPT resource locator unavailable');
            const response = await this.fetchFn(exchange.downloadUrl, { signal });
            if (!response.ok) throw new ResourceHttpError(response.status);
            const bytes = new Uint8Array(await response.arrayBuffer());
            signal?.throwIfAborted();
            if (!bytes.byteLength) throw new ResourceProcessingError('Empty ChatGPT resource');
            const mediaType = asset.mediaType ?? exchange.mimeType ?? response.headers.get('content-type')?.split(';')[0].trim();
            const name = asset.name ?? exchange.fileName;
            return { bytes, ...(mediaType ? { mediaType } : {}), ...(name ? { name } : {}) };
        };
        return this.resources ? this.resources.acquire(key, asset, signal, remote) : remote();
    }
}
