/**
 * src/core/provider/chatgpt/chatgptProvider.ts
 * ChatGPT Provider implementation & Tree Mapping Normalizer.
 * Bridges OpenAI ChatGPT Web REST API endpoints and transforms
 * recursive message node trees into the universal Conversation / Turn model.
 */
import type {
    AIProvider,
    ProviderCapabilities,
    ProviderReadiness,
    ProviderListResult
} from "../aiProvider.js";
import { ProviderRegistry } from "../providerRegistry.js";
import type { DetailParseResult } from "../../api/parser/parseDetail.js";
import type { ConversationListItem } from "../../api/parser/parseList.js";
import type { ChatMessage, Attachment } from "../../../types/conversation.js";
import type { PaginationOptions } from "../../api/client/pagination.js";

/**
 * Normalizes ChatGPT tree mapping structure into standard DetailParseResult.
 * Traverses from current_node backwards to root (or chronologically) to reconstruct the active conversation branch.
 */
export function flattenChatGPTMapping(raw: any, conversationId?: string): DetailParseResult {
    if (!raw || typeof raw !== 'object') {
        throw new Error('Invalid ChatGPT conversation payload');
    }

    const convId = conversationId || raw.id || raw.conversation_id || 'unknown';
    const title = (raw.title && typeof raw.title === 'string') ? raw.title.trim() : 'ChatGPT Conversation';
    const mapping = raw.mapping || {};
    const currentNode = raw.current_node;

    const orderedNodes: any[] = [];

    if (currentNode && mapping[currentNode]) {
        // Backtrack from current_node to root
        let curr: any = mapping[currentNode];
        while (curr) {
            orderedNodes.unshift(curr);
            curr = curr.parent && mapping[curr.parent] ? mapping[curr.parent] : null;
        }
    } else {
        // Fallback: collect all nodes with messages and sort by create_time
        for (const key of Object.keys(mapping)) {
            const node = mapping[key];
            if (node && node.message) {
                orderedNodes.push(node);
            }
        }
        orderedNodes.sort((a, b) => {
            const tA = (a.message && a.message.create_time) || 0;
            const tB = (b.message && b.message.create_time) || 0;
            return tA - tB;
        });
    }

    const messages: ChatMessage[] = [];
    let attachmentCount = 0;

    for (const node of orderedNodes) {
        const msg = node.message;
        if (!msg) continue;

        const rawRole = msg.author?.role || 'assistant';
        // Map roles to standard format ('user' | 'model' | 'system')
        let role: 'user' | 'model' | 'system' = 'model';
        if (rawRole === 'user') role = 'user';
        else if (rawRole === 'system') role = 'system';
        else role = 'model';

        // Extract content parts
        let textParts: string[] = [];
        const attachments: Attachment[] = [];
        const thoughts: string[] = [];

        if (msg.content) {
            if (Array.isArray(msg.content.parts)) {
                for (const part of msg.content.parts) {
                    if (typeof part === 'string') {
                        textParts.push(part);
                    } else if (part && typeof part === 'object') {
                        if (part.content_type === 'image_asset_pointer') {
                            attachmentCount++;
                            attachments.push({
                                type: 'image',
                                src: part.asset_pointer || '',
                                name: `chatgpt_img_${attachmentCount}.png`,
                                localName: `assets/chatgpt_img_${attachmentCount}.png`
                            });
                        } else if (part.text) {
                            textParts.push(part.text);
                        }
                    }
                }
            } else if (typeof msg.content.text === 'string') {
                textParts.push(msg.content.text);
            }
        }

        // Check for reasoning / thought content (e.g. OpenAI o1/o3 reasoning or metadata thoughts)
        if (msg.metadata && msg.metadata.thought) {
            thoughts.push(String(msg.metadata.thought));
        }
        if (msg.content && msg.content.content_type === 'thought' && textParts.length) {
            thoughts.push(textParts.join('\n'));
            textParts = [];
        }

        const content = textParts.join('\n');
        if (!content && !attachments.length && !thoughts.length) {
            continue;
        }

        const msgTimestamp = msg.create_time ? Math.round(msg.create_time * 1000) : Date.now();

        messages.push({
            role,
            content,
            timestamp: msgTimestamp,
            turnId: msg.id || node.id,
            attachments: attachments.length ? attachments : undefined,
            thoughts: thoughts.length ? thoughts : undefined
        });
    }

    const createMs = raw.create_time ? Math.round(raw.create_time * 1000) : (messages[0]?.timestamp || Date.now());
    const updateMs = raw.update_time ? Math.round(raw.update_time * 1000) : (messages[messages.length - 1]?.timestamp || createMs);

    return {
        id: convId,
        title,
        titleSource: 'api-detail',
        titles: {
            rpc: title
        },
        messages,
        createdAt: createMs,
        chatTime: updateMs,
        timestamp: updateMs,
        updatedAt: updateMs,
        url: `https://chatgpt.com/c/${convId}`,
        nextPageToken: null,
        attachmentCount,
        _raw: raw
    };
}

export class ChatGPTProvider implements AIProvider {
    readonly id = 'chatgpt';
    readonly name = 'ChatGPT';
    readonly hostPatterns = [
        'https://chatgpt.com/*',
        'https://chat.openai.com/*'
    ];

    readonly capabilities: ProviderCapabilities = {
        supportsRealtimeSniffing: true,
        supportsTakeoutImport: true,
        supportsThoughtBlocks: true,
        supportsIncrementalSync: true,
        supportsMultiAccount: false
    };

    matchesUrl(url: string): boolean {
        if (!url || typeof url !== 'string') return false;
        try {
            const parsed = new URL(url);
            return parsed.hostname === 'chatgpt.com' || parsed.hostname === 'chat.openai.com';
        } catch {
            return false;
        }
    }

    async checkReadiness(_context?: any): Promise<ProviderReadiness> {
        try {
            if (typeof fetch === 'undefined') {
                return { ready: false, error: 'Network fetch is not available' };
            }
            const res = await fetch('https://chatgpt.com/api/auth/session');
            if (res.ok) {
                const session = await res.json();
                if (session && session.accessToken) {
                    return {
                        ready: true,
                        accountName: session.user?.email || 'ChatGPT User'
                    };
                }
            }
            return {
                ready: false,
                error: '未登录 ChatGPT，请先登录 chatgpt.com'
            };
        } catch (e: any) {
            return {
                ready: false,
                error: e?.message || 'ChatGPT 就绪检查失败'
            };
        }
    }

    async listConversations(options?: PaginationOptions): Promise<ProviderListResult> {
        const offset = 0;
        const limit = 28;
        const maxPages = options?.maxPages || 50;
        const conversations: ConversationListItem[] = [];

        let currentOffset = offset;
        let hasMore = true;
        let pageCount = 0;

        while (hasMore && pageCount < maxPages) {
            if (options?.signal && options.signal.aborted) {
                break;
            }
            pageCount++;
            const url = `https://chatgpt.com/backend-api/conversations?offset=${currentOffset}&limit=${limit}`;
            const res = await fetch(url);
            if (!res.ok) break;

            const data = await res.json();
            const items = data.items || [];
            if (!items.length) break;

            for (const item of items) {
                const updatedMs = item.update_time ? new Date(item.update_time).getTime() : Date.now();
                const createdMs = item.create_time ? new Date(item.create_time).getTime() : updatedMs;
                conversations.push({
                    id: item.id,
                    title: item.title || 'Untitled',
                    titleSource: 'api-list',
                    titles: { rpc: item.title || 'Untitled' },
                    createdAt: createdMs,
                    updatedAt: updatedMs,
                    chatTime: updatedMs,
                    timestamp: updatedMs,
                    messageCount: 0,
                    url: `https://chatgpt.com/c/${item.id}`
                });
            }

            if (options?.onProgress) {
                options.onProgress({
                    page: pageCount,
                    added: items.length,
                    total: conversations.length,
                    hasMore: items.length >= limit
                });
            }

            if (items.length < limit) {
                hasMore = false;
            } else {
                currentOffset += items.length;
            }
        }

        return {
            conversations,
            total: conversations.length,
            hasMore,
            stoppedEarly: pageCount >= maxPages
        };
    }

    async fetchConversationDetail(conversationId: string, _options?: any): Promise<DetailParseResult> {
        const url = `https://chatgpt.com/backend-api/conversation/${conversationId}`;
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`Failed to fetch ChatGPT conversation ${conversationId}: HTTP ${res.status}`);
        }
        const data = await res.json();
        return flattenChatGPTMapping(data, conversationId);
    }
}

// Auto-register ChatGPT provider
export const defaultChatGPTProvider = new ChatGPTProvider();
ProviderRegistry.register(defaultChatGPTProvider);

export default ChatGPTProvider;

declare global {
    var ChatGPTProvider: any;
}
if (typeof globalThis !== 'undefined') {
    (globalThis as any).ChatGPTProvider = ChatGPTProvider;
}
