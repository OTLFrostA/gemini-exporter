import type { BlockNode } from '../content/blocks.js';
import { parseImportedBody } from '../provider/importedContentAdapter.js';
import { parseGeminiBody, structuredBodyAttachments } from '../provider/gemini/contentAdapter.js';
import { supplementLegacyGeneratedMedia, reconcileLegacyMediaLists, type LegacyGeneratedMediaEvidence } from './legacyGeneratedMediaReconciliation.js';
import type { Conversation, ChatMessage, Attachment, MessageDocument, GeneratedMediaIdentity } from '../../types/conversation.js';
import type {
    DomainAttachment,
    DomainCitation,
    DomainConversationDetail,
    DomainDocument,
    DomainGeneratedMediaIdentity,
    DomainMessage,
    DomainMessageProvenance,
} from './conversationDetail.js';

function copyGeneratedMedia(value: GeneratedMediaIdentity): DomainGeneratedMediaIdentity {
    return { ...value };
}

function copyAttachment(value: Attachment): DomainAttachment {
    return {
        ...value,
        ...(value.generation ? { generation: copyGeneratedMedia(value.generation) } : {}),
    };
}

function copyDocument(value: MessageDocument): DomainDocument {
    return {
        ...value,
        ...(value.generation ? { generation: copyGeneratedMedia(value.generation) } : {}),
        ...(value.sections ? { sections: [...value.sections] } : {}),
        ...(value.links ? { links: value.links.map((link) => ({ ...link })) } : {}),
        ...(value.candidates ? { candidates: [...value.candidates] } : {}),
    };
}

function copyTimestamp(value: unknown): { timestamp?: number } {
    return typeof value === 'number' && Number.isFinite(value) ? { timestamp: value } : {};
}

function normalizeMessageProvenance(value: unknown): DomainMessageProvenance | undefined {
    if (typeof value !== 'string') return undefined;
    const providerRequestId = value.trim();
    return providerRequestId ? { providerRequestId } : undefined;
}

/** Preserve provider text and the legacy nullish precedence, including empty thoughts. */
function normalizeReasoning(value: ChatMessage): string | undefined {
    const raw = value.thoughts ?? value.thinking;
    const text = Array.isArray(raw) ? raw.join('\n\n') : raw;
    return typeof text === 'string' && text.trim() ? text : undefined;
}

function normalizeCitations(value: ChatMessage): DomainCitation[] | undefined {
    const citations: DomainCitation[] = [];
    const urls = new Set<string>();
    for (const entry of [...(value.citations ?? []), ...(value.sources ?? [])]) {
        const url = typeof entry === 'string' ? entry
            : entry && typeof entry === 'object' && 'url' in entry ? entry.url : undefined;
        if (typeof url !== 'string' || !url.trim() || urls.has(url)) continue;
        const title = entry && typeof entry === 'object' && 'title' in entry ? entry.title : undefined;
        citations.push({ url, ...(typeof title === 'string' ? { title } : {}) });
        urls.add(url);
    }
    return citations.length ? citations : undefined;
}

function copyMessage(value: ChatMessage, parseContent: (body: string, structured?: unknown) => BlockNode[]): DomainMessage {
    const { id, content, timestamp } = value;
    if (typeof content !== 'string') {
        throw new TypeError('Legacy message content must be a string');
    }
    const provenance = normalizeMessageProvenance(value.providerRequestId);
    const reasoning = normalizeReasoning(value);
    const citations = normalizeCitations(value);
    const bodyAttachments = structuredBodyAttachments(value);
    return {
        ...(typeof id === 'string' && id.trim().length > 0 ? { id } : {}),
        content: parseContent(content, value.structuredContent),
        ...copyTimestamp(timestamp),
        role: value.role === 'model' ? 'assistant' : value.role,
        ...(provenance ? { provenance } : {}),
        ...(bodyAttachments.length ? { attachments: bodyAttachments.map(copyAttachment) }
            : value.attachments ? { attachments: value.attachments.map(copyAttachment) } : {}),
        ...(reasoning !== undefined ? { reasoning } : {}),
        ...(citations ? { citations } : {}),
        ...(value.images ? { images: value.images.map(copyAttachment) } : {}),
        ...(value.documents ? { documents: value.documents.map(copyDocument) } : {}),
        ...(value.groundingCitationMarkers ? { groundingCitationMarkers: [...value.groundingCitationMarkers] } : {}),
    };
}

function flattenLegacyTurns(conversation: Conversation): ChatMessage[] {
    const turns = conversation.turns ?? [];
    const messages: ChatMessage[] = [];
    for (const turn of turns) {
        if (!turn || typeof turn !== 'object') continue;
        if (Array.isArray(turn.messages) && turn.messages.length > 0) {
            messages.push(...turn.messages);
            continue;
        }
        if ((turn.userContent !== undefined && typeof turn.userContent !== 'string')
            || (turn.modelContent !== undefined && typeof turn.modelContent !== 'string')) {
            throw new TypeError('Legacy message content must be a string');
        }
        if (typeof turn.userContent === 'string' && turn.userContent) {
            messages.push({
                role: 'user',
                content: turn.userContent,
                ...copyTimestamp(turn.timestamp),
            });
        }
        const hasModel = typeof turn.modelContent === 'string' && turn.modelContent;
        if (hasModel || turn.thoughts || turn.attachments?.length || turn.images?.length || turn.sources?.length || turn.structuredContent) {
            messages.push({
                role: 'model',
                content: typeof turn.modelContent === 'string' && turn.modelContent ? turn.modelContent : '',
                ...copyTimestamp(turn.timestamp),
                ...(turn.thoughts !== undefined ? { thoughts: Array.isArray(turn.thoughts) ? [...turn.thoughts] : turn.thoughts } : {}),
                ...(turn.attachments ? { attachments: turn.attachments.map(copyAttachment) } : {}),
                ...(turn.images ? { images: turn.images.map(copyAttachment) } : {}),
                ...(turn.sources ? { sources: [...turn.sources] } : {}),
                ...(turn.structuredContent !== undefined ? { structuredContent: turn.structuredContent } : {}),
            });
        }
    }
    return messages;
}

/** Provider evidence accepted only while constructing Domain. */
export interface LegacyDomainConstructionOptions {
    /** Detached Takeout/provider generated-media evidence, reconciled before returning Domain. */
    generatedMedia?: readonly LegacyGeneratedMediaEvidence[];
}

/** Resolve provider media and whitelist message fields without mutating legacy input. */
export function toDomainConversationDetail(conversation: Conversation, options: LegacyDomainConstructionOptions = {}): DomainConversationDetail {
    const rawMessages = conversation.messages && conversation.messages.length > 0
        ? conversation.messages
        : flattenLegacyTurns(conversation);
    // Clone provider evidence before reconciliation so legacy input remains untouched.
    const legacyMessages = rawMessages.map(message => ({
        ...message,
        ...(message.generation ? { generation: { ...message.generation } } : {}),
        ...(message.attachments ? { attachments: message.attachments.map(copyAttachment) } : {}),
        ...(message.images ? { images: message.images.map(copyAttachment) } : {}),
    }));
    if (options.generatedMedia) supplementLegacyGeneratedMedia({ id: conversation.id, messages: legacyMessages }, conversation.id, options.generatedMedia, { appendMarkdownRef: false });
    const parseContent = conversation.source?.startsWith('openai')
        ? (body: string): BlockNode[] => parseImportedBody(body)
        : parseGeminiBody;
    const messages = legacyMessages.map(message => {
        if ([...(message.attachments ?? []), ...(message.images ?? [])].some(a => a.isGenerated || a.generation || a.providerRequestId)) {
            message.attachments = reconcileLegacyMediaLists(message.attachments ?? [], message.images ?? []);
            // The resolved attachment list is authoritative; avoid stale duplicate representations.
            if (message.images) message.images = message.attachments.filter(a => a.type === 'image' || a.isImage || a.isGenerated);
        }
        return copyMessage(message, parseContent);
    });
    return {
        id: conversation.id,
        title: conversation.title,
        timestamp: conversation.timestamp,
        ...(conversation.updatedAt !== undefined ? { updatedAt: conversation.updatedAt } : {}),
        ...(conversation.createdAt !== undefined ? { createdAt: conversation.createdAt } : {}),
        ...(conversation.chatTime !== undefined ? { chatTime: conversation.chatTime } : {}),
        ...(conversation.lastSeen !== undefined ? { lastSeen: conversation.lastSeen } : {}),
        ...(conversation.url !== undefined ? { url: conversation.url } : {}),
        ...(conversation.href !== undefined ? { href: conversation.href } : {}),
        ...(conversation.titleSource !== undefined ? { titleSource: conversation.titleSource } : {}),
        ...(conversation.titles !== undefined ? { titles: { ...conversation.titles } } : {}),
        messages,
    };
}
