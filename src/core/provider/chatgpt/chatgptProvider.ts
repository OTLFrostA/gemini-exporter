/**
 * src/core/provider/chatgpt/chatgptProvider.ts
 * ChatGPT Provider (dormant 预留扩展点) & Tree Mapping Normalizer.
 * manifest 未覆盖 chatgpt.com 域名、无 content script 匹配，运行时不可达；
 * 能力声明与列表入口已降级，误调直接抛错。
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

export function flattenChatGPTMapping(raw: any, conversationId?: string): ProviderConversationDetail {
    if (!raw || typeof raw !== 'object') {
        throw new Error('Invalid ChatGPT conversation payload');
    }

    const convId: string | null = conversationId || raw.id || raw.conversation_id || null;
    const title = (raw.title && typeof raw.title === 'string') ? raw.title.trim() : t('chatgptTitleFallback');
    const mapping = raw.mapping || {};
    const currentNode = raw.current_node;

    const orderedNodes: any[] = [];

    if (currentNode && mapping[currentNode]) {
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
        let role: 'user' | 'model' | 'system' = 'model';
        if (rawRole === 'user') role = 'user';
        else if (rawRole === 'system') role = 'system';
        else role = 'model';

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

    const createMs: number | null = raw.create_time ? Math.round(raw.create_time * 1000) : (messages[0]?.timestamp ?? null);
    const updateMs: number | null = raw.update_time ? Math.round(raw.update_time * 1000) : (messages[messages.length - 1]?.timestamp ?? createMs);

    return {
        id: convId ?? 'unknown',
        title,
        titleSource: 'api-detail',
        titles: {
            'api-detail': title
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
        // Dormant: no manifest host permission or content-script match for
        // chatgpt.com, so realtime sniffing can never trigger — never claim it.
        supportsRealtimeSniffing: false,
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

    async listConversations(_options?: any): Promise<ProviderPageResult<ProviderConversationItem>> {
        // Dormant provider: unreachable at runtime (no manifest coverage), so
        // fail loudly instead of pretending to list conversations.
        throw new Error('dormant');
    }

    async fetchConversationDetail(conversationId: string, _options?: any): Promise<ProviderConversationDetail> {
        await ensureProviderLang();
        const url = `https://chatgpt.com/backend-api/conversation/${conversationId}`;
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

