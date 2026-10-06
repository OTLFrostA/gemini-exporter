import type { Conversation, ChatMessage, Attachment, MessageDocument, Turn, GeneratedMediaIdentity } from '../../types/conversation.js';
import type {
    DomainAttachment,
    DomainCitation,
    DomainConversationDetail,
    DomainDocument,
    DomainGeneratedMediaIdentity,
    DomainMessage,
    DomainTurn,
} from './conversationDetail.js';

function copyBuffer(buffer: ArrayBuffer | ArrayBufferView): ArrayBuffer | ArrayBufferView {
    if (buffer instanceof ArrayBuffer) return buffer.slice(0);
    const cloned = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    if (buffer instanceof DataView) return new DataView(cloned);
    const Ctor = buffer.constructor as { new (buffer: ArrayBuffer): ArrayBufferView };
    return new Ctor(cloned);
}

function copyGeneratedMedia(value: GeneratedMediaIdentity): DomainGeneratedMediaIdentity {
    return { ...value };
}

function copyAttachment(value: Attachment): DomainAttachment {
    return {
        ...value,
        ...(value.generation ? { generation: copyGeneratedMedia(value.generation) } : {}),
        ...(value.dataBuffer ? { dataBuffer: copyBuffer(value.dataBuffer) } : {}),
    };
}

function copyDocument(value: MessageDocument): DomainDocument {
    return {
        ...value,
        ...(value.generation ? { generation: copyGeneratedMedia(value.generation) } : {}),
        ...(value.dataBuffer ? { dataBuffer: copyBuffer(value.dataBuffer) } : {}),
        ...(value.sections ? { sections: [...value.sections] } : {}),
        ...(value.links ? { links: value.links.map((link) => ({ ...link })) } : {}),
        ...(value.candidates ? { candidates: [...value.candidates] } : {}),
    };
}

function copyMessage(value: ChatMessage): DomainMessage {
    return {
        ...value,
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

function copyTurn(value: Turn): DomainTurn {
    return {
        ...value,
        ...(value.messages ? { messages: value.messages.map(copyMessage) } : {}),
        ...(Array.isArray(value.thoughts) ? { thoughts: [...value.thoughts] } : {}),
        ...(value.attachments ? { attachments: value.attachments.map(copyAttachment) } : {}),
        ...(value.images ? { images: value.images.map(copyAttachment) } : {}),
        ...(value.documents ? { documents: value.documents.map(copyDocument) } : {}),
        ...(value.citations ? { citations: value.citations.map((citation) => ({ ...citation })) } : {}),
        ...(value.sources ? { sources: [...value.sources] } : {}),
        ...(value.structuredContent !== undefined ? { structuredContent: value.structuredContent } : {}),
        ...(value.groundingCitationMarkers ? { groundingCitationMarkers: [...value.groundingCitationMarkers] } : {}),
    };
}

/** Copy export-relevant detail without coercing, synthesizing, or mutating legacy values. */
export function toDomainConversationDetail(conversation: Conversation): DomainConversationDetail {
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
        ...(conversation.messages ? { messages: conversation.messages.map(copyMessage) } : {}),
        ...(conversation.turns ? { turns: conversation.turns.map(copyTurn) } : {}),
    };
}
