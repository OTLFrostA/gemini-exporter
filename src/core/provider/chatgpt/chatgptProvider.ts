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
    imagePointersOfNode,
    processChatGPTMapping,
} from './conversationTree.js';
import type { ChatGPTConversationNode } from './chatgptTypes.js';
import {
    arrayBufferToBase64,
    assetIdForPointer,
    buildFileDownloadPath,
    CHATGPT_MAX_IMAGE_BYTES,
    fileIdFromPointer,
    parseFileDownloadPayload,
} from './imageAssets.js';
import type { DomainAsset } from '../../domain/conversationDetail.js';
import type { BlockNode } from '../../domain/content/blocks.js';
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
        const assets: DomainAsset[] = [];
        const messages = await Promise.all(
            nodes.map((n) => this.toDomainMessage(n, modelSlug, assets)),
        );
        const domain = validateParserDomain({
            providerId: 'chatgpt',
            completeness: 'complete',
            assets,
            id: conversation.id,
            title: conversation.title || 'ChatGPT Conversation',
            createdAt: toEpochMs(conversation.create_time),
            updatedAt: toEpochMs(conversation.update_time),
            url: `https://chatgpt.com/c/${conversation.id}`,
            messages,
        });
        return {
            conversation: domain,
            diagnostics: [],
            resourceHints: {},
            acquisitionHints: {},
        };
    }

    private async toDomainMessage(
        node: ChatGPTConversationNode,
        modelSlug: string,
        assets: DomainAsset[],
    ): Promise<{
        id?: string;
        role: 'user' | 'assistant';
        model?: string;
        content: BlockNode[];
        timestamp?: number;
        attachmentIds?: string[];
    }> {
        const text = chatGPTNodeText(node);
        const content: BlockNode[] = text
            ? [{ type: 'paragraph', children: [{ type: 'text', text }] }]
            : [];
        const pointers = imagePointersOfNode(node);
        const attachmentIds: string[] = [];
        for (const pointer of pointers) {
            const resolved = await this.fetchImageAsset(pointer);
            if (!resolved) continue;
            assets.push({
                id: resolved.assetId,
                kind: 'image',
                name: resolved.fileName,
                mediaType: resolved.mediaType,
                byteLength: resolved.byteLength,
                sourceUri: resolved.sourceUri,
                dataBase64: resolved.dataBase64,
            });
            attachmentIds.push(resolved.assetId);
            content.push({ type: 'image', assetId: resolved.assetId });
        }
        return {
            id: node.id,
            role: chatGPTNodeRole(node),
            model: modelSlug || undefined,
            content,
            timestamp: toEpochMs(node.message?.create_time),
            attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
        };
    }

    /**
     * Resolve one image pointer into bytes. Returns null (keeping the text)
     * when the pointer is foreign, the exchange fails, or the payload is
     * over the in-memory cap — never throws the whole export.
     */
    async fetchImageAsset(
        pointer: string,
    ): Promise<{
        assetId: string;
        sourceUri: string;
        dataBase64: string;
        mediaType?: string;
        fileName?: string;
        byteLength?: number;
    } | null> {
        const fileId = fileIdFromPointer(pointer);
        if (!fileId) return null;
        try {
            const exchange = await this.authedGet<unknown>(buildFileDownloadPath(fileId));
            const parsed = parseFileDownloadPayload(exchange);
            if (!parsed) return null;
            const bytesRes = await this.fetchFn(parsed.downloadUrl);
            if (!bytesRes.ok) return null;
            const buf = await bytesRes.arrayBuffer();
            if (buf.byteLength === 0 || buf.byteLength > CHATGPT_MAX_IMAGE_BYTES) return null;
            const headerType = bytesRes.headers?.get('content-type');
            return {
                assetId: assetIdForPointer(pointer),
                sourceUri: pointer,
                dataBase64: arrayBufferToBase64(buf),
                mediaType:
                    (typeof headerType === 'string' && headerType.split(';')[0]?.trim()) ||
                    parsed.mimeType ||
                    undefined,
                fileName: parsed.fileName,
                byteLength: buf.byteLength,
            };
        } catch {
            return null;
        }
    }
}
