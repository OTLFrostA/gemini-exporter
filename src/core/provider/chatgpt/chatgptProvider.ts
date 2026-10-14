/**
 * ChatGPT provider: acquisition only (session/list/detail/downloads).
 * Mapping parsing and Domain branding live in parsers/chatgpt, mirroring the
 * Gemini provider/client/parser split enforced by the trust boundary.
 * @unverified-provider-scaffold Not registered by default; optional hosts only.
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
} from '../../parsers/chatgpt/chatgptTypes.js';
import { CHATGPT_HOSTS, chatGPTApiBase } from '../../parsers/chatgpt/chatgptTypes.js';
import { imagePointersOfNode, processChatGPTMapping } from '../../parsers/chatgpt/conversationTree.js';
import type { ChatGPTConversationNode } from '../../parsers/chatgpt/chatgptTypes.js';
import {
    parseChatGPTConversation,
} from '../../parsers/chatgpt/parseConversation.js';
import type {
    ChatGPTNodeAssets,
} from '../../parsers/chatgpt/parseConversation.js';
import { uploadedFilesOfChatGPTNode } from '../../parsers/chatgpt/conversationDetail.js';
import {
    arrayBufferToBase64,
    assetIdForPointer,
    buildFileDownloadPath,
    CHATGPT_MAX_IMAGE_BYTES,
    fileIdFromPointer,
    parseFileDownloadPayload,
} from './imageAssets.js';

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
        // Acquisition only: resolve downloads per node, then hand assembled
        // evidence to the parser for Domain branding (trust boundary).
        const linear = this.linearNodes(conversation);        const assetsByNode = new Map<string, ChatGPTNodeAssets>();
        await Promise.all(
            linear.map(async (node) => {
                assetsByNode.set(node.id, await this.resolveNodeAssets(node));
            }),
        );
        return parseChatGPTConversation({ conversation, assetsByNode });
    }

    /** Linear history without branding (used to scope per-node downloads). */
    private linearNodes(
        conversation: ChatGPTApiConversationWithId,
    ): ChatGPTConversationNode[] {
        return processChatGPTMapping(conversation);
    }

    private async resolveNodeAssets(node: ChatGPTConversationNode): Promise<ChatGPTNodeAssets> {
        const images: ChatGPTNodeAssets['images'] = [];
        for (const pointer of imagePointersOfNode(node)) {
            const resolved = await this.fetchImageAsset(pointer);
            if (resolved) {
                images.push({
                    pointer,
                    assetId: resolved.assetId,
                    dataBase64: resolved.dataBase64,
                    mediaType: resolved.mediaType,
                    fileName: resolved.fileName,
                    byteLength: resolved.byteLength,
                });
            }
        }
        const files: ChatGPTNodeAssets['files'] = [];
        for (const file of uploadedFilesOfChatGPTNode(node)) {
            const downloaded = await this.fetchFileAsset(file.id);
            files.push({
                id: file.id,
                name: file.name,
                mediaType: downloaded?.mediaType ?? file.mediaType,
                byteLength: downloaded?.byteLength ?? file.byteLength,
                ...(downloaded ? { dataBase64: downloaded.dataBase64 } : {}),
            });
        }
        return { nodeId: node.id, images, files };
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
