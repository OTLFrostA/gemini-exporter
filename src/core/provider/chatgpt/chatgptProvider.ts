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
    ProviderPageResult,
    ProviderConversationItem,
    ProviderConversationDetail
} from "../aiProvider.js";
import { ProviderRegistry } from "../providerRegistry.js";
import type { ChatMessage, Attachment } from "../../../types/conversation.js";
import { t, initLanguage } from "../../utils/i18n.js";

// P1-087: provider-side i18n. The UI entry points call initLanguage(), but
// provider methods execute in content/background contexts that never do, so
// resolve the extension language once per context instead of defaulting to
// hard-coded (and previously Chinese/English-mixed) literals.
let providerLangReady: Promise<string> | null = null;
function ensureProviderLang(): Promise<string> {
    if (!providerLangReady) {
        try {
            providerLangReady = Promise.resolve(initLanguage()).catch(() => 'en');
        } catch {
            providerLangReady = Promise.resolve('en');
        }
    }
    return providerLangReady;
}

/**
 * Normalizes ChatGPT tree mapping structure into standard DetailParseResult.
 * Traverses from current_node backwards to root (or chronologically) to reconstruct the active conversation branch.
 */
export function flattenChatGPTMapping(raw: any, conversationId?: string): ProviderConversationDetail {
    if (!raw || typeof raw !== 'object') {
        throw new Error('Invalid ChatGPT conversation payload');
    }

    // P1-086: no fabricated 'unknown' id leaking into URLs. The id field keeps
    // an 'unknown' last resort (the neutral contract requires a string), but
    // the url is only built when we actually know the conversation id, so a
    // dirty https://chatgpt.com/c/unknown never lands in exports/_index.json.
    const convId: string | null = conversationId || raw.id || raw.conversation_id || null;
    const title = (raw.title && typeof raw.title === 'string') ? raw.title.trim() : t('chatgptTitleFallback');
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

        // Check for reasoning / thought content (e.g. OpenAI o1/o3 reasoning or metadata thoughts).
        // P1-086: never String(object) -> "[object Object]" polluting exports.
        const thought: unknown = msg.metadata?.thought;
        if (typeof thought === 'string') {
            if (thought) thoughts.push(thought);
        } else if (Array.isArray(thought)) {
            for (const entry of thought) {
                if (typeof entry === 'string' && entry) thoughts.push(entry);
            }
        } else if (thought !== null && typeof thought === 'object') {
            try {
                thoughts.push(JSON.stringify(thought));
            } catch {
                // Unserializable thought object — drop rather than fabricate.
            }
        }
        if (msg.content && msg.content.content_type === 'thought' && textParts.length) {
            thoughts.push(textParts.join('\n'));
            textParts = [];
        }

        const content = textParts.join('\n');
        if (!content && !attachments.length && !thoughts.length) {
            continue;
        }

        // P1-085: a missing message timestamp stays missing (undefined) — never
        // fabricate Date.now(), which poisoned sorting and incremental diffs
        // by marking ancient messages as "just updated".
        const msgTimestamp: number | undefined = msg.create_time ? Math.round(msg.create_time * 1000) : undefined;

        messages.push({
            role,
            content,
            timestamp: msgTimestamp,
            turnId: msg.id || node.id,
            attachments: attachments.length ? attachments : undefined,
            thoughts: thoughts.length ? thoughts : undefined
        });
    }

    // P1-085: missing conversation timestamps stay null (E-group P1-067
    // precedent) instead of Date.now() — a fabricated "now" made stale
    // conversations look freshly updated and triggered duplicate exports.
    const createMs: number | null = raw.create_time ? Math.round(raw.create_time * 1000) : (messages[0]?.timestamp ?? null);
    const updateMs: number | null = raw.update_time ? Math.round(raw.update_time * 1000) : (messages[messages.length - 1]?.timestamp ?? createMs);

    return {
        id: convId ?? 'unknown',
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
        url: convId ? `https://chatgpt.com/c/${convId}` : undefined,
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
        await ensureProviderLang();
        try {
            if (typeof fetch === 'undefined') {
                return { ready: false, error: t('chatgptNetworkUnavailable') };
            }
            // P0-3 fix: session endpoint requires the user's login cookies.
            const res = await fetch('https://chatgpt.com/api/auth/session', { credentials: 'include' });
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
                error: t('chatgptNotLoggedIn')
            };
        } catch (e: any) {
            return {
                ready: false,
                error: e?.message || t('chatgptReadinessCheckFailed')
            };
        }
    }

    async listConversations(options?: any): Promise<ProviderPageResult<ProviderConversationItem>> {
        await ensureProviderLang();
        // P1-043: named pagination constants. 28 matches the page size the
        // ChatGPT web client requests from backend-api/conversations
        // (observed in network traffic); 50 pages is a safety bound so a
        // misbehaving cursor can never spin forever.
        const CHATGPT_LIST_PAGE_SIZE = 28;
        const CHATGPT_LIST_MAX_PAGES = 50;
        const offset = 0;
        const limit = CHATGPT_LIST_PAGE_SIZE;
        const maxPages = options?.maxPages || CHATGPT_LIST_MAX_PAGES;
        const conversations: ProviderConversationItem[] = [];

        let currentOffset = offset;
        let hasMore = true;
        let pageCount = 0;

        while (hasMore && pageCount < maxPages) {
            if (options?.signal && options.signal.aborted) {
                break;
            }
            pageCount++;
            const url = `https://chatgpt.com/backend-api/conversations?offset=${currentOffset}&limit=${limit}`;
            // P1-043: the caller's AbortSignal is passed to fetch so cancelling
            // actually tears down the in-flight request instead of merely
            // skipping the *next* page. P0-3 fix: conversation list requires
            // the user's login cookies.
            let res: Response;
            try {
                res = await fetch(url, { credentials: 'include', signal: options?.signal });
            } catch (e: any) {
                if (options?.signal?.aborted || e?.name === 'AbortError') {
                    // User-cancelled mid-flight: stop quietly, not an error.
                    return {
                        items: conversations,
                        total: conversations.length,
                        hasMore: false,
                        nextCursor: null,
                        stoppedEarly: true
                    };
                }
                throw e;
            }
            // P1-044: never silently swallow HTTP errors with a bare break —
            // mark the partial result so callers can tell "user has 3 chats"
            // apart from "page 2 died with a 429".
            if (!res.ok) {
                const httpError = `ChatGPT conversation list failed: HTTP ${res.status}`;
                console.warn('[ChatGPTProvider]', httpError);
                return {
                    items: conversations,
                    total: conversations.length,
                    hasMore,
                    nextCursor: null,
                    stoppedEarly: true,
                    diagnostics: { error: httpError, httpStatus: res.status, partial: true }
                };
            }

            const data = await res.json();
            const items = data.items || [];
            if (!items.length) break;

            for (const item of items) {
                // P1-085: missing timestamps stay missing (undefined) — a
                // fabricated Date.now() poisoned incremental-sync diffs.
                const updatedMs: number | undefined = item.update_time ? new Date(item.update_time).getTime() : undefined;
                const createdMs: number | undefined = item.create_time ? new Date(item.create_time).getTime() : updatedMs;
                conversations.push({
                    id: item.id,
                    title: item.title || t('chatgptUntitled'),
                    url: `https://chatgpt.com/c/${item.id}`,
                    updatedAt: updatedMs,
                    createdAt: createdMs
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
            items: conversations,
            total: conversations.length,
            hasMore,
            nextCursor: null,
            stoppedEarly: pageCount >= maxPages
        };
    }

    async fetchConversationDetail(conversationId: string, _options?: any): Promise<ProviderConversationDetail> {
        await ensureProviderLang();
        const url = `https://chatgpt.com/backend-api/conversation/${conversationId}`;
        // P0-3 fix: conversation detail requires the user's login cookies.
        const res = await fetch(url, { credentials: 'include' });
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
