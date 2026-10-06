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

function copyMessage(value: ChatMessage): DomainMessage {
    const { id, content, timestamp } = value;
    if (typeof content !== 'string') {
        throw new TypeError('Domain message content must be a string');
    }
    const provenance = normalizeMessageProvenance(value.providerRequestId);
    return {
        ...(typeof id === 'string' && id.trim().length > 0 ? { id } : {}),
        content,
        ...copyTimestamp(timestamp),
        role: value.role === 'model' ? 'assistant' : value.role,
        ...(provenance ? { provenance } : {}),
        ...(value.attachments ? { attachments: value.attachments.map(copyAttachment) } : {}),
        ...(value.thoughts !== undefined ? { thoughts: Array.isArray(value.thoughts) ? [...value.thoughts] : value.thoughts } : {}),
        ...(value.thinking !== undefined ? { thinking: value.thinking } : {}),
        ...(value.citations ? { citations: value.citations.map((citation): DomainCitation => ({ ...citation })) } : {}),
        ...(value.images ? { images: value.images.map(copyAttachment) } : {}),
        ...(value.documents ? { documents: value.documents.map(copyDocument) } : {}),
        ...(value.sources ? { sources: [...value.sources] } : {}),
        ...(value.structuredContent !== undefined ? { structuredContent: value.structuredContent } : {}),
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
            throw new TypeError('Domain message content must be a string');
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
    const messages = legacyMessages.map(message => {
        if ([...(message.attachments ?? []), ...(message.images ?? [])].some(a => a.isGenerated || a.generation || a.providerRequestId)) {
            message.attachments = reconcileLegacyMediaLists(message.attachments ?? [], message.images ?? []);
            // The resolved attachment list is authoritative; avoid stale duplicate representations.
            if (message.images) message.images = message.attachments.filter(a => a.type === 'image' || a.isImage || a.isGenerated);
        }
        return copyMessage(message);
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
