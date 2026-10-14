/**
 * Minimal ChatGPT provider implementing the neutral AIProvider seam.
 * Logic ported from pionxzh/chatgpt-exporter (MIT): session token ->
 * backend-api list/detail, mapping-tree linearize.
 * @unverified-provider-scaffold Live 9222 verification pending; not registered by default.
 */
import type {
    AIProvider,
    ProviderConversationDetail,
    ProviderConversationItem,
    ProviderListOptions,
    ProviderPageResult,
    ProviderReadiness,
} from '../aiProvider.js';
import type {
    ChatGPTApiConversationItem,
    ChatGPTApiConversationWithId,
    ChatGPTApiConversations,
    ChatGPTApiSession,
} from './chatgptTypes.js';
import { CHATGPT_HOSTS, chatGPTApiBase } from './chatgptTypes.js';
import {
    chatGPTNodeRole,
    chatGPTNodeText,
    extractChatGPTModelSlug,
    processChatGPTMapping,
} from './conversationTree.js';
import { validateParserDomain } from '../../domain/runtimeValidation.js';

export interface ChatGPTFetch {
    (input: string, init?: RequestInit): Promise<Response>;
}

interface ChatGPTProviderDeps {
    fetchFn?: ChatGPTFetch;
    origin?: string;
}

function toEpochMs(value: number | string | undefined): number | undefined {
    if (typeof value === 'number') {
        return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
    }
    if (typeof value === 'string' && value) {
        const ms = Date.parse(value);
        return Number.isFinite(ms) ? ms : undefined;
    }
    return undefined;
}

function toProviderItem(item: ChatGPTApiConversationItem): ProviderConversationItem {
    return {
        id: item.id,
        title: item.title || 'ChatGPT Conversation',
        url: `https://chatgpt.com/c/${item.id}`,
        createdAt: toEpochMs(item.create_time) ?? null,
        updatedAt: toEpochMs(item.update_time) ?? null,
    };
}

export class ChatGPTProvider implements AIProvider {
    readonly id = 'chatgpt';
    readonly name = 'ChatGPT';
    readonly hostPatterns = ['https://chatgpt.com/*', 'https://chat.openai.com/*'];

    private fetchFn: ChatGPTFetch;
    private origin: string;

    constructor(deps?: ChatGPTProviderDeps) {
        const globalFetch = globalThis.fetch as unknown as ChatGPTFetch | undefined;
        this.fetchFn =
            deps?.fetchFn
            ?? (globalFetch ? globalFetch.bind(globalThis) : (() => Promise.reject(new Error('fetch unavailable'))));
        this.origin = deps?.origin ?? 'https://chatgpt.com';
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

    private async getAccessToken(): Promise<string> {
        const res = await this.fetchFn(`${this.origin}/api/auth/session`);
        if (!res.ok) throw new Error(`ChatGPT session probe failed: ${res.status}`);
        const session = (await res.json()) as ChatGPTApiSession;
        if (!session.accessToken) throw new Error('ChatGPT session has no accessToken (logged out?)');
        return session.accessToken;
    }

    private async authedGet<T>(path: string): Promise<T> {
        const token = await this.getAccessToken();
        const res = await this.fetchFn(`${chatGPTApiBase(this.origin)}${path}`, {
            headers: {
                Authorization: `Bearer ${token}`,
                'X-Authorization': `Bearer ${token}`,
            },
        });
        if (!res.ok) throw new Error(`ChatGPT API ${path} failed: ${res.status}`);
        return (await res.json()) as T;
    }

    async checkReadiness(): Promise<ProviderReadiness> {
        try {
            const res = await this.fetchFn(`${this.origin}/api/auth/session`);
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

    async listConversations(options?: ProviderListOptions): Promise<ProviderPageResult<ProviderConversationItem>> {
        const limit = 100;
        const result = await this.authedGet<ChatGPTApiConversations>(
            `/conversations?offset=0&limit=${limit}`,
        );
        const items = (result.items ?? []).map(toProviderItem);
        void options;
        const total = typeof result.total === 'number' ? result.total : undefined;
        const exhaustive = total !== undefined ? items.length >= total : result.cursor == null;
        return {
            items,
            total,
            hasMore: !exhaustive,
            nextCursor: result.cursor ?? null,
            exhaustive,
            completionReason: exhaustive ? 'complete' : 'cursor-remaining',
        };
    }

    async fetchConversationDetail(
        conversationId: string,
    ): Promise<ProviderConversationDetail> {
        const raw = await this.authedGet<Omit<ChatGPTApiConversationWithId, 'id'>>(
            `/conversation/${encodeURIComponent(conversationId)}`,
        );
        const conversation: ChatGPTApiConversationWithId = { ...raw, id: conversationId };
        const nodes = processChatGPTMapping(conversation);
        const modelSlug = extractChatGPTModelSlug(conversation.mapping, nodes);
        const domain = validateParserDomain({
            providerId: 'chatgpt',
            completeness: 'complete',
            assets: [],
            id: conversation.id,
            title: conversation.title || 'ChatGPT Conversation',
            createdAt: toEpochMs(conversation.create_time),
            updatedAt: toEpochMs(conversation.update_time),
            url: `https://chatgpt.com/c/${conversation.id}`,
            messages: nodes.map((n) => ({
                id: n.id,
                role: chatGPTNodeRole(n),
                model: modelSlug || undefined,
                content: [
                    { type: 'paragraph', children: [{ type: 'text', text: chatGPTNodeText(n) }] },
                ],
                timestamp: toEpochMs(n.message?.create_time),
            })),
        });
        return {
            conversation: domain,
            diagnostics: [],
            resourceHints: {},
            acquisitionHints: {},
        };
    }
}
