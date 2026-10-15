/**
 * ChatGPT detail enrichment: thinking -> reasoning blocks, web citations,
 * uploaded-file records. Pure functions ported from pionxzh/chatgpt-exporter
 * (MIT), shaped into our neutral Domain vocabulary like the Gemini parser.
 * @unverified-provider-scaffold Citations verified present in live payloads;
 * thoughts/reasoning_recap verified present; upload round-trip still open.
 */
import type { DomainCitation } from '../../domain/conversationDetail.js';
import type {
    ChatGPTApiConversationItem,
    ChatGPTConversationNode,
} from './chatgptTypes.js';

export interface ChatGPTThinking {
    thoughts: Array<{ summary: string; content: string }>;
    activities: string[];
    durationSeconds?: number;
}

function emptyThinking(): ChatGPTThinking {
    return { thoughts: [], activities: [] };
}

function hasThinking(t: ChatGPTThinking): boolean {
    return t.thoughts.length > 0 || t.activities.length > 0;
}

/**
 * Walk the raw mapping leaf->root (pionxzh attachThinkingToNodes) and collect
 * hidden reasoning (thoughts / reasoning_recap / preamble / activity titles)
 * onto the assistant node that follows them. Returns nodeId -> thinking.
 */
export function collectChatGPTThinking(
    mapping: Record<string, ChatGPTConversationNode>,
    resultNodeIds: Set<string>,
    startNodeId: string,
): Map<string, ChatGPTThinking> {
    const out = new Map<string, ChatGPTThinking>();
    let currentId: string | undefined = startNodeId;
    let targetId: string | null = null;
    let thinking = emptyThinking();

    const flush = (): void => {
        if (targetId && hasThinking(thinking)) {
            const prev = out.get(targetId);
            if (prev) {
                out.set(targetId, {
                    thoughts: [...prev.thoughts, ...thinking.thoughts],
                    activities: [...prev.activities, ...thinking.activities],
                    durationSeconds: prev.durationSeconds ?? thinking.durationSeconds,
                });
            } else {
                out.set(targetId, thinking);
            }
        }
    };

    while (currentId) {
        const id: string = currentId;
        const node: ChatGPTConversationNode | undefined = mapping[id];
        if (!node || node.parent === undefined) break;
        const message = node.message;
        if (message?.content) {
            const ct = message.content.content_type;
            if (resultNodeIds.has(node.id) && message.author.role !== 'user') {
                flush();
                targetId = node.id;
                thinking = emptyThinking();
            } else if (ct === 'reasoning_recap') {
                const duration = message.metadata?.finished_duration_sec;
                if (typeof duration === 'number') {
                    thinking.durationSeconds = duration;
                } else {
                    const raw = typeof message.content.content === 'string' ? message.content.content : '';
                    const match = raw.match(/(\d+)/);
                    if (match?.[1]) thinking.durationSeconds = Number.parseInt(match[1], 10);
                }
            } else if (ct === 'thoughts' && 'thoughts' in message.content && Array.isArray(message.content.thoughts)) {
                thinking.thoughts.unshift(
                    ...message.content.thoughts
                        .filter((t: { summary: string; content: string }) => t.content || t.summary)
                        .map((t: { summary: string; content: string }) => ({ summary: t.summary, content: t.content })),
                );
            } else if (ct === 'text' && message.metadata?.is_thinking_preamble_message) {
                const parts = Array.isArray(message.content.parts) ? message.content.parts : [];
                const text = parts.join('\n');
                if (text) thinking.thoughts.unshift({ summary: '', content: text });
            } else if (message.metadata?.reasoning_title) {
                const title = message.metadata.reasoning_title;
                const at = thinking.activities.indexOf(title);
                if (at !== -1) thinking.activities.splice(at, 1);
                thinking.activities.unshift(title);
            } else if (message.author.role === 'user' && !message.metadata?.is_visually_hidden_from_conversation) {
                flush();
                targetId = null;
                thinking = emptyThinking();
            }
        }
        currentId = node.parent;
    }
    flush();
    return out;
}

/** Web citations for one node, deduplicated by URL (Gemini citationsOf parity). */
export function citationsOfChatGPTNode(node: ChatGPTConversationNode): DomainCitation[] {
    const citations: DomainCitation[] = [];
    const seen = new Set<string>();
    const push = (url?: string, title?: string): void => {
        const clean = (url ?? '').trim();
        if (!clean || seen.has(clean)) return;
        seen.add(clean);
        citations.push({
            id: `citation-${citations.length}`,
            url: clean,
            ...(title ? { title } : {}),
        });
    };
    const meta = node.message?.metadata;
    for (const cite of meta?.citations ?? []) {
        push(cite.metadata?.url, cite.metadata?.title);
    }
    for (const ref of meta?.content_references ?? []) {
        for (const item of [...(ref.items ?? []), ...(ref.sources ?? []), ...(ref.fallback_items ?? [])]) {
            push(item.url, item.title);
        }
        push(ref.url, ref.title);
    }
    return citations;
}

export interface ChatGPTUploadedFile {
    id: string;
    name: string;
    mediaType?: string;
    byteLength?: number;
}

/** Non-image user uploads recorded on the message (bytes resolved later). */
export function uploadedFilesOfChatGPTNode(node: ChatGPTConversationNode): ChatGPTUploadedFile[] {
    const out: ChatGPTUploadedFile[] = [];
    for (const a of node.message?.metadata?.attachments ?? []) {
        if (!a.name || !a.id) continue;
        if (a.mime_type?.startsWith('image/')) continue;
        out.push({
            id: a.id,
            name: a.name,
            ...(a.mime_type ? { mediaType: a.mime_type } : {}),
            ...(typeof a.size === 'number' && Number.isFinite(a.size) ? { byteLength: Math.round(a.size) } : {}),
        });
    }
    return out;
}

/**
 * Incremental list refresh (mirrors pionxzh refreshConversationList): the API
 * orders by update_time newest-first, so every change since cache sits before
 * the first still-unchanged item; paging stops there.
 */
export function refreshChatGPTList(
    cached: ChatGPTApiConversationItem[],
    pages: ChatGPTApiConversationItem[][],
): { head: ChatGPTApiConversationItem[]; reachedKnown: boolean } {
    const known = new Map(cached.map((c) => [c.id, c.update_time]));
    const head: ChatGPTApiConversationItem[] = [];
    for (const items of pages) {
        const firstUnchanged = items.findIndex(
            (c) => known.has(c.id) && known.get(c.id) === c.update_time,
        );
        if (firstUnchanged !== -1) {
            head.push(...items.slice(0, firstUnchanged));
            return { head, reachedKnown: true };
        }
        head.push(...items);
        if (items.length === 0) break;
    }
    return { head, reachedKnown: false };
}

/** Merge refreshed head on top, dropping stale positions (dedupe by id). */
export function applyChatGPTHead(
    head: ChatGPTApiConversationItem[],
    items: ChatGPTApiConversationItem[],
): ChatGPTApiConversationItem[] {
    if (head.length === 0) return items;
    const headIds = new Set(head.map((c) => c.id));
    return [...head, ...items.filter((c) => !headIds.has(c.id))];
}
