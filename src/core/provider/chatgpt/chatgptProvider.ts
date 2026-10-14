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
import type { DomainAsset, DomainCitation } from '../../domain/conversationDetail.js';
import type { BlockNode } from '../../domain/content/blocks.js';
import type { ChatGPTThinking } from './conversationDetail.js';
import {
    citationsOfChatGPTNode,
    collectChatGPTThinking,
    thinkingToReasoningBlocks,
    uploadedFilesOfChatGPTNode,
} from './conversationDetail.js';
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
        const maxPages = typeof options?.maxPages === 'number' && options.maxPages > 0
            ? Math.floor(options.maxPages)
            : 20;
        const all: ProviderConversationItem[] = [];
        let offset = 0;
        let total: number | undefined;
        let cursor: string | null = null;
        let exhaustive = false;
        for (let page = 0; page < maxPages; page += 1) {
            const result = await this.authedGet<ChatGPTApiConversations>(
                `/conversations?offset=${offset}&limit=${limit}`,
            );
            const batch = (result.items ?? []).map(toProviderItem);
            all.push(...batch);
            if (typeof result.total === 'number') total = result.total;
            cursor = result.cursor ?? null;
            options?.onProgress?.({
                page: page + 1,
                added: batch.length,
                total: all.length,
                hasMore: true,
                batch,
            });
            if (batch.length === 0) {
                exhaustive = true;
                break;
            }
            // pionxzh stop rules: no total and no cursor means one-shot list;
            // reaching the reported total means history is complete.
            if (result.total == null && result.cursor == null) {
                exhaustive = true;
                break;
            }
            if (result.total != null && offset + limit >= result.total) {
                exhaustive = true;
                break;
            }
            offset += limit;
        }
        return {
            items: all,
            total,
            hasMore: !exhaustive,
            nextCursor: cursor,
            exhaustive,
            completionReason: exhaustive ? 'complete' : 'page-budget-reached',
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
        const startId = conversation.current_node || nodes[nodes.length - 1]?.id || '';
        const thinkingByNode = collectChatGPTThinking(
            conversation.mapping,
            new Set(nodes.map((n) => n.id)),
            startId,
        );
        const assets: DomainAsset[] = [];
        const messages = await Promise.all(
            nodes.map((n) => this.toDomainMessage(n, modelSlug, assets, thinkingByNode.get(n.id))),
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
        thinking?: ChatGPTThinking,
    ): Promise<{
        id?: string;
        role: 'user' | 'assistant';
        model?: string;
        content: BlockNode[];
        timestamp?: number;
        attachmentIds?: string[];
        reasoning?: BlockNode[];
        citations?: DomainCitation[];
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
        for (const file of uploadedFilesOfChatGPTNode(node)) {
            const assetId = `file-${file.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
            const downloaded = await this.fetchFileAsset(file.id);
            assets.push({
                id: assetId,
                kind: 'file',
                name: file.name,
                mediaType: downloaded?.mediaType ?? file.mediaType,
                byteLength: downloaded?.byteLength ?? file.byteLength,
                sourceUri: `file-download:${file.id}`,
                ...(downloaded ? { dataBase64: downloaded.dataBase64 } : {}),
            });
            attachmentIds.push(assetId);
            content.push({ type: 'file', assetId, label: file.name });
        }
        const reasoning = thinking ? thinkingToReasoningBlocks(thinking) : [];
        const citations = citationsOfChatGPTNode(node);
        return {
            id: node.id,
            role: chatGPTNodeRole(node),
            model: modelSlug || undefined,
            content,
            timestamp: toEpochMs(node.message?.create_time),
            attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
            ...(reasoning.length > 0 ? { reasoning } : {}),
            ...(citations.length > 0 ? { citations } : {}),
        };
    }

    /** Best-effort bytes for an uploaded (non-image) file; null keeps the stub. */
    private async fetchFileAsset(
        fileId: string,
    ): Promise<{ dataBase64: string; mediaType?: string; byteLength?: number } | null> {
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
                dataBase64: arrayBufferToBase64(buf),
                mediaType:
                    (typeof headerType === 'string' && headerType.split(';')[0]?.trim()) ||
                    parsed.mimeType ||
                    undefined,
                byteLength: buf.byteLength,
            };
        } catch {
            return null;
        }
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
