/**
 * Pure ChatGPT mapping-tree helpers, ported from pionxzh/chatgpt-exporter (MIT).
 * No fetch, no DOM — fully unit-testable.
 * @unverified-provider-scaffold Awaiting 9222 live-payload verification.
 */
import type {
    ChatGPTApiConversationWithId,
    ChatGPTConversationNode,
    ChatGPTNodeMessage,
} from './chatgptTypes.js';

function isTextContent(
    message: ChatGPTNodeMessage,
): message is ChatGPTNodeMessage & { content: { content_type: 'text'; parts: string[] } } {
    return message.content.content_type === 'text';
}

/** Tool/image messages that carry renderable images are kept; pure tool chatter is dropped. */
function toolMessageHasImage(message: ChatGPTNodeMessage): boolean {
    const content = message.content;
    if (content.content_type === 'execution_output') {
        const messages = message.metadata?.aggregate_result?.messages;
        return Array.isArray(messages) && messages.some((m) => m.message_type === 'image');
    }
    if (content.content_type === 'multimodal_text') {
        return Array.isArray(content.parts) && content.parts.some(
            (p) => typeof p !== 'string' && p.content_type === 'image_asset_pointer',
        );
    }
    return false;
}

/** Mirrors pionxzh shouldSkipMessageInExport: keep only user-visible turns. */
export function shouldSkipChatGPTMessage(message?: ChatGPTNodeMessage): boolean {
    if (!message || !message.content) return true;
    if (message.recipient !== 'all') return true;
    const ct = message.content.content_type;
    if (ct === 'thoughts' || ct === 'reasoning_recap') return true;
    if (message.metadata?.is_visually_hidden_from_conversation) return true;
    if (message.metadata?.is_thinking_preamble_message) return true;
    if (
        message.author.role === 'assistant'
        && isTextContent(message)
        && !message.content.parts.join('').trim()
    ) {
        return true;
    }
    if (message.author.role === 'tool') {
        // File-search grinding and other tool chatter stays out, but image
        // results (code-execution output, multimodal asset pointers) are kept
        // so generated/uploaded pictures survive the export.
        if (message.author.name === 'file_search') return true;
        if (!toolMessageHasImage(message)) return true;
        return false;
    }
    return false;
}

/** Copy a node so repeat exports never mutate the cached raw mapping. */
function copyChatGPTNode(node: ChatGPTConversationNode): ChatGPTConversationNode {
    const message = node.message;
    if (!message) return { ...node };
    if (isTextContent(message)) {
        const fallback = message.metadata?.model_dil_v2?.fallbackMarkdown;
        const parts =
            typeof fallback === 'string' && fallback.trim()
                ? [fallback]
                : [...message.content.parts];
        return {
            ...node,
            message: { ...message, content: { content_type: 'text', parts }, metadata: message.metadata && { ...message.metadata } },
        };
    }
    return {
        ...node,
        message: { ...message, metadata: message.metadata && { ...message.metadata } },
    };
}

/**
 * Walk from current_node back to root via parent links, skipping system and
 * hidden/tool messages. Returns oldest-first linear history.
 */
export function extractChatGPTLinearNodes(
    mapping: Record<string, ChatGPTConversationNode>,
    startNodeId: string,
): ChatGPTConversationNode[] {
    const result: ChatGPTConversationNode[] = [];
    let currentId: string | undefined = startNodeId;
    while (currentId) {
        const node: ChatGPTConversationNode | undefined = mapping[currentId];
        if (!node || node.parent === undefined) break;
        const role = node.message?.author.role;
        const ct = node.message?.content.content_type;
        if (
            role !== 'system'
            && ct !== 'model_editable_context'
            && ct !== 'user_editable_context'
            && !shouldSkipChatGPTMessage(node.message)
        ) {
            result.unshift(copyChatGPTNode(node));
        }
        currentId = node.parent;
    }
    return result;
}

/** Merge consecutive assistant text turns produced by official continuation. */
export function mergeChatGPTContinuations(
    nodes: ChatGPTConversationNode[],
): ChatGPTConversationNode[] {
    const result: ChatGPTConversationNode[] = [];
    for (const node of nodes) {
        const prev = result[result.length - 1];
        const prevMsg = prev?.message;
        const curMsg = node.message;
        if (
            prevMsg?.author.role === 'assistant'
            && curMsg?.author.role === 'assistant'
            && prevMsg.recipient === 'all'
            && curMsg.recipient === 'all'
            && isTextContent(prevMsg)
            && isTextContent(curMsg)
        ) {
            const sep = prevMsg.channel !== curMsg.channel ? '\n\n' : '';
            const lastIdx = prevMsg.content.parts.length - 1;
            prevMsg.content.parts[lastIdx] += sep + curMsg.content.parts[0];
            prevMsg.content.parts.push(...curMsg.content.parts.slice(1));
        } else {
            result.push(node);
        }
    }
    return result;
}

/** Latest model_slug on the current branch wins (model can change mid-chat). */
export function extractChatGPTModelSlug(
    mapping: Record<string, ChatGPTConversationNode>,
    linearNodes: ChatGPTConversationNode[],
): string {
    for (let i = linearNodes.length - 1; i >= 0; i -= 1) {
        const slug = linearNodes[i]?.message?.metadata?.model_slug;
        if (slug) return slug;
    }
    for (const node of Object.values(mapping)) {
        const slug = node.message?.metadata?.model_slug;
        if (slug) return slug;
    }
    return '';
}

/** Linearize + merge in one call; throws when the tree has no usable leaf. */
export function processChatGPTMapping(
    conversation: ChatGPTApiConversationWithId,
): ChatGPTConversationNode[] {
    const startId =
        conversation.current_node
        || Object.values(conversation.mapping).find((n) => !n.children || n.children.length === 0)?.id;
    if (!startId) throw new Error('Failed to find start node.');
    return mergeChatGPTContinuations(
        extractChatGPTLinearNodes(conversation.mapping, startId),
    );
}

/** Text of a node for Domain conversion; non-text parts become empty. */
export function chatGPTNodeText(node: ChatGPTConversationNode): string {
    const content = node.message?.content;
    if (!content) return '';
    if (content.content_type === 'text') return Array.isArray(content.parts) ? content.parts.join('') : '';
    if (content.content_type === 'code' || content.content_type === 'execution_output') {
        return content.text ?? '';
    }
    if (content.content_type === 'multimodal_text') {
        return (content.parts ?? [])
            .map((p: string | { content_type: string; asset_pointer?: string }) => (typeof p === 'string' ? p : ''))
            .join('');
    }
    if (content.content_type === 'reasoning_recap') return content.content ?? '';
    return '';
}

/** Role mapping into our neutral Domain vocabulary. */
export function chatGPTNodeRole(node: ChatGPTConversationNode): 'user' | 'assistant' {
    return node.message?.author.role === 'user' ? 'user' : 'assistant';
}

/**
 * All image sources a linear history carries: `sediment://` asset pointers in
 * multimodal parts plus code-execution image URLs. Next step resolves each via
 * `GET /backend-api/files/download/:id` into a signed download URL (pionxzh
 * `fetchImageFromPointer`), then stores bytes as Domain assets.
 */
export function collectChatGPTImagePointers(
    nodes: ChatGPTConversationNode[],
): string[] {
    return nodes.flatMap((node) => imagePointersOfNode(node));
}

/** Image sources owned by a single node, in source order. */
export function imagePointersOfNode(node: ChatGPTConversationNode): string[] {
    const out: string[] = [];
    const content = node.message?.content;
    if (!content) return out;
    if (content.content_type === 'multimodal_text' && Array.isArray(content.parts)) {
        for (const p of content.parts) {
            if (typeof p !== 'string' && p.content_type === 'image_asset_pointer' && p.asset_pointer) {
                out.push(p.asset_pointer);
            }
        }
    }
    if (content.content_type === 'execution_output') {
        const messages = node.message?.metadata?.aggregate_result?.messages;
        if (Array.isArray(messages)) {
            for (const m of messages) {
                if (m.message_type === 'image' && m.image_url) out.push(m.image_url);
            }
        }
    }
    return out;
}
