/**
 * ChatGPT Detail trust boundary. Only the fields consumed by the current
 * parser are admitted; optional malformed evidence is discarded, not asserted
 * into a trusted shape. Unknown content kinds remain explicitly unsupported.
 */
import type {
    ChatGPTApiConversationWithId,
    ChatGPTConversationNode,
    ChatGPTMessageContent,
    ChatGPTNodeMessage,
} from './chatgptTypes.js';

type Metadata = NonNullable<ChatGPTNodeMessage['metadata']>;
type GalleryResult = {
    componentName?: string;
    status?: string;
    state?: { images?: Array<{ content_url?: string; thumbnail_url?: string; title?: string }> };
    safe_urls?: string[];
};

function record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : null;
}

function unknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

function text(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

function strings(value: unknown): string[] | null {
    if (!unknownArray(value) || !value.every((item): item is string => typeof item === 'string')) return null;
    return value;
}

function timestamp(value: unknown): number | string | undefined {
    return typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' ? value : undefined;
}

function links(value: unknown): Array<{ title?: string; url?: string }> | undefined {
    if (!unknownArray(value)) return undefined;
    return value.flatMap(item => {
        const link = record(item);
        return link ? [{ ...(text(link.title) !== undefined ? { title: text(link.title) } : {}),
            ...(text(link.url) !== undefined ? { url: text(link.url) } : {}) }] : [];
    });
}

function galleryResults(value: unknown): Record<string, GalleryResult> | undefined {
    const source = record(value);
    if (!source) return undefined;
    const results: Record<string, GalleryResult> = {};
    for (const [key, raw] of Object.entries(source)) {
        const entry = record(raw);
        if (!entry) continue;
        const state = record(entry.state);
        const images = unknownArray(state?.images) ? state.images.flatMap(rawImage => {
            const image = record(rawImage);
            return image ? [{
                ...(text(image.content_url) !== undefined ? { content_url: text(image.content_url) } : {}),
                ...(text(image.thumbnail_url) !== undefined ? { thumbnail_url: text(image.thumbnail_url) } : {}),
                ...(text(image.title) !== undefined ? { title: text(image.title) } : {}),
            }] : [];
        }) : undefined;
        const urls = strings(entry.safe_urls);
        Object.defineProperty(results, key, { value: {
            ...(text(entry.componentName) !== undefined ? { componentName: text(entry.componentName) } : {}),
            ...(text(entry.status) !== undefined ? { status: text(entry.status) } : {}),
            ...(images ? { state: { images } } : {}),
            ...(urls ? { safe_urls: urls } : {}),
        }, enumerable: true, configurable: true, writable: true });
    }
    return results;
}

function dilMetadata(value: unknown): Metadata['model_dil_v2'] {
    const source = record(value);
    if (!source) return undefined;
    const rawConstants = record(source.constants);
    const constants: Record<string, string> = {};
    if (rawConstants) {
        for (const [key, value] of Object.entries(rawConstants)) {
            if (typeof value === 'string') Object.defineProperty(constants, key, {
                value, enumerable: true, configurable: true, writable: true,
            });
        }
    }
    const appData = record(source.appData);
    const opGenui = record(appData?.opGenui);
    const results = galleryResults(opGenui?.componentResults);
    return {
        ...(text(source.fallbackMarkdown) !== undefined ? { fallbackMarkdown: text(source.fallbackMarkdown) } : {}),
        ...(text(source.code) !== undefined ? { code: text(source.code) } : {}),
        ...(rawConstants ? { constants } : {}),
        ...(results ? { appData: { opGenui: { componentResults: results } } } : {}),
    };
}

function decodeMetadata(value: unknown): ChatGPTNodeMessage['metadata'] {
    const source = record(value);
    if (!source) return undefined;
    const attachments = unknownArray(source.attachments) ? source.attachments.flatMap(raw => {
        const file = record(raw);
        if (!file || typeof file.id !== 'string' || typeof file.name !== 'string') return [];
        return [{ id: file.id, name: file.name,
            ...(text(file.mime_type) !== undefined ? { mime_type: text(file.mime_type) } : {}),
            ...(typeof file.size === 'number' && Number.isFinite(file.size) ? { size: file.size } : {}),
        }];
    }) : undefined;
    const aggregate = record(source.aggregate_result);
    const aggregateMessages = unknownArray(aggregate?.messages) ? aggregate.messages.flatMap(raw => {
        const item = record(raw);
        if (!item || typeof item.message_type !== 'string') return [];
        return [{ message_type: item.message_type,
            ...(text(item.image_url) !== undefined ? { image_url: text(item.image_url) } : {}),
        }];
    }) : undefined;
    const citations = unknownArray(source.citations) ? source.citations.flatMap(raw => {
        const citation = record(raw);
        if (!citation) return [];
        const meta = record(citation.metadata);
        return [{ ...(meta ? { metadata: {
            ...(text(meta.title) !== undefined ? { title: text(meta.title) } : {}),
            ...(text(meta.url) !== undefined ? { url: text(meta.url) } : {}),
            ...(text(meta.text) !== undefined ? { text: text(meta.text) } : {}),
        } } : {}) }];
    }) : undefined;
    const refs = unknownArray(source.content_references) ? source.content_references.flatMap(raw => {
        const ref = record(raw);
        if (!ref) return [];
        const items = links(ref.items), sources = links(ref.sources), fallback = links(ref.fallback_items);
        return [{
            ...(items ? { items } : {}), ...(sources ? { sources } : {}),
            ...(fallback ? { fallback_items: fallback } : {}),
            ...(text(ref.title) !== undefined ? { title: text(ref.title) } : {}),
            ...(text(ref.url) !== undefined ? { url: text(ref.url) } : {}),
        }];
    }) : undefined;
    const dil = dilMetadata(source.model_dil_v2);
    return {
        ...(text(source.model_slug) !== undefined ? { model_slug: text(source.model_slug) } : {}),
        ...(typeof source.is_visually_hidden_from_conversation === 'boolean'
            ? { is_visually_hidden_from_conversation: source.is_visually_hidden_from_conversation } : {}),
        ...(typeof source.is_thinking_preamble_message === 'boolean'
            ? { is_thinking_preamble_message: source.is_thinking_preamble_message } : {}),
        ...(text(source.reasoning_title) !== undefined ? { reasoning_title: text(source.reasoning_title) } : {}),
        ...(typeof source.finished_duration_sec === 'number' && Number.isFinite(source.finished_duration_sec)
            ? { finished_duration_sec: source.finished_duration_sec } : {}),
        ...(attachments ? { attachments } : {}),
        ...(aggregateMessages ? { aggregate_result: { messages: aggregateMessages } } : {}),
        ...(citations ? { citations } : {}),
        ...(refs ? { content_references: refs } : {}),
        ...(dil ? { model_dil_v2: dil } : {}),
    };
}

function decodeContent(value: unknown): ChatGPTMessageContent {
    const source = record(value);
    if (!source || typeof source.content_type !== 'string') throw new TypeError('Invalid ChatGPT Detail message content');
    const kind = source.content_type;
    if (kind === 'text') {
        const parts = strings(source.parts);
        if (!parts) throw new TypeError('Invalid ChatGPT Detail text parts');
        return { content_type: kind, parts };
    }
    if (kind === 'multimodal_text') {
        if (!unknownArray(source.parts)) throw new TypeError('Invalid ChatGPT Detail multimodal parts');
        const parts = source.parts.map(part => {
            if (typeof part === 'string') return part;
            const entry = record(part);
            if (!entry || typeof entry.content_type !== 'string') throw new TypeError('Invalid ChatGPT Detail multimodal part');
            return { content_type: entry.content_type,
                ...(text(entry.asset_pointer) !== undefined ? { asset_pointer: text(entry.asset_pointer) } : {}) };
        });
        return { content_type: kind, parts };
    }
    if (kind === 'thoughts') {
        if (!unknownArray(source.thoughts)) throw new TypeError('Invalid ChatGPT Detail thoughts');
        const thoughts = source.thoughts.map(raw => {
            const entry = record(raw);
            if (!entry || typeof entry.summary !== 'string' || typeof entry.content !== 'string')
                throw new TypeError('Invalid ChatGPT Detail thought');
            return { summary: entry.summary, content: entry.content };
        });
        return { content_type: kind, thoughts };
    }
    if (kind === 'code') {
        if (typeof source.text !== 'string') throw new TypeError('Invalid ChatGPT Detail code body');
        return { content_type: kind, language: text(source.language) ?? '', text: source.text };
    }
    if (kind === 'execution_output') return { content_type: kind, text: text(source.text) ?? '' };
    if (kind === 'reasoning_recap') return { content_type: kind, content: text(source.content) ?? '' };
    // Unknown provider content kinds remain non-rendered evidence; do not guess.
    const parts = strings(source.parts);
    return { content_type: kind,
        ...(parts ? { parts } : {}),
        ...(text(source.text) !== undefined ? { text: text(source.text) } : {}),
        ...(text(source.content) !== undefined ? { content: text(source.content) } : {}),
    };
}

function decodeMessage(value: unknown): ChatGPTNodeMessage {
    const source = record(value);
    const author = record(source?.author);
    const role = author?.role;
    if (!source || typeof source.id !== 'string' || !author
        || role !== 'user' && role !== 'assistant' && role !== 'system' && role !== 'tool')
        throw new TypeError('Invalid ChatGPT Detail message');
    const metadata = decodeMetadata(source.metadata);
    const time = timestamp(source.create_time), updated = timestamp(source.update_time);
    return {
        id: source.id,
        author: { role, metadata: {}, ...(text(author.name) !== undefined ? { name: text(author.name) } : {}) },
        content: decodeContent(source.content),
        recipient: text(source.recipient) ?? '',
        status: text(source.status) ?? '',
        weight: typeof source.weight === 'number' && Number.isFinite(source.weight) ? source.weight : 0,
        ...(typeof source.end_turn === 'boolean' ? { end_turn: source.end_turn } : {}),
        ...(text(source.channel) !== undefined || source.channel === null
            ? { channel: text(source.channel) ?? null } : {}),
        ...(time !== undefined ? { create_time: time } : {}),
        ...(updated !== undefined ? { update_time: updated } : {}),
        ...(metadata ? { metadata } : {}),
    };
}

function decodeNode(value: unknown, key: string): ChatGPTConversationNode {
    const source = record(value);
    if (!source || source.id !== key) throw new TypeError('Invalid ChatGPT Detail mapping node');
    const children = source.children == null ? [] : strings(source.children);
    if (!children || source.parent != null && typeof source.parent !== 'string')
        throw new TypeError('Invalid ChatGPT Detail mapping links');
    const message = source.message == null ? undefined : decodeMessage(source.message);
    return {
        id: key, children,
        ...(typeof source.parent === 'string' ? { parent: source.parent } : {}),
        ...(message ? { message } : {}),
    };
}

/** Validate one received Detail and bind it to the requested conversation ID. */
export function decodeChatGPTDetail(value: unknown, requestedId: string): ChatGPTApiConversationWithId {
    const source = record(value), rawMapping = record(source?.mapping);
    if (!source || !rawMapping || !requestedId) throw new TypeError('Invalid ChatGPT Detail payload');
    // Both native identifiers must agree. Either may be absent on some endpoints.
    for (const key of ['id', 'conversation_id']) {
        if (source[key] !== undefined && source[key] !== requestedId)
            throw new TypeError('ChatGPT Detail identity mismatch');
    }
    const mapping: Record<string, ChatGPTConversationNode> = {};
    for (const [key, raw] of Object.entries(rawMapping)) {
        Object.defineProperty(mapping, key, {
            value: decodeNode(raw, key), enumerable: true, configurable: true, writable: true,
        });
    }
    if (source.current_node != null && typeof source.current_node !== 'string')
        throw new TypeError('Invalid ChatGPT Detail current_node');
    const created = timestamp(source.create_time), updated = timestamp(source.update_time);
    return {
        id: requestedId, mapping,
        title: text(source.title) ?? '',
        current_node: text(source.current_node) ?? '',
        is_archived: typeof source.is_archived === 'boolean' ? source.is_archived : false,
        ...(created !== undefined ? { create_time: created } : {}),
        ...(updated !== undefined ? { update_time: updated } : {}),
        ...(source.conversation_id === requestedId ? { conversation_id: requestedId } : {}),
    };
}
