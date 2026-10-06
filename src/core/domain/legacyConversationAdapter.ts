import type { Conversation, ChatMessage, Attachment, MessageDocument, GeneratedMediaIdentity } from '../../types/conversation.js';
import type {
    DomainAttachment,
    DomainCitation,
    DomainConversationDetail,
    DomainDocument,
    DomainGeneratedMediaIdentity,
    DomainMessage,
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

function copyMessage(value: ChatMessage): DomainMessage {
    const { id, content, timestamp, ...rest } = value;
    if (typeof content !== 'string') {
        throw new TypeError('Domain message content must be a string');
    }
    return {
        ...rest,
        ...(typeof id === 'string' ? { id } : {}),
        content,
        ...copyTimestamp(timestamp),
        role: value.role === 'model' ? 'assistant' : value.role,
        ...(value.generation ? { generation: copyGeneratedMedia(value.generation) } : {}),
        ...(value.attachments ? { attachments: value.attachments.map(copyAttachment) } : {}),
        ...(Array.isArray(value.thoughts) ? { thoughts: [...value.thoughts] } : {}),
        ...(value.citations ? { citations: value.citations.map((citation): DomainCitation => ({ ...citation })) } : {}),
        ...(value.images ? { images: value.images.map(copyAttachment) } : {}),
        ...(value.documents ? { documents: value.documents.map(copyDocument) } : {}),
        ...(value.sources ? { sources: [...value.sources] } : {}),
        ...(value.groundingCitationMarkers ? { groundingCitationMarkers: [...value.groundingCitationMarkers] } : {}),
    };
}

function flattenLegacyTurns(conversation: Conversation): DomainMessage[] {
    const turns = conversation.turns ?? [];
    const messages: DomainMessage[] = [];
    for (const turn of turns) {
        if (!turn || typeof turn !== 'object') continue;
        if (Array.isArray(turn.messages) && turn.messages.length > 0) {
            messages.push(...turn.messages.map(copyMessage));
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
                role: 'assistant',
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

/** Copy export-relevant detail and normalize legacy message cores without mutating the input. */
export function toDomainConversationDetail(conversation: Conversation): DomainConversationDetail {
    const messages = conversation.messages && conversation.messages.length > 0
        ? conversation.messages.map(copyMessage)
        : flattenLegacyTurns(conversation);
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
