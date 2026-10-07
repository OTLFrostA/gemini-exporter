import type { ImageAttachment, DocLink } from './attachments.js';
import type { Citation, TitleResult } from './extractors.js';
import type { GeminiStructuredDocument } from './structuredContent.js';
import type { DomainGeneratedMediaIdentity } from '../../domain/conversationDetail.js';

/** Source extraction evidence, not the persisted Conversation/Message contract. */
export interface GeminiAttachmentEvidence {
    type: string;
    src?: string;
    localName?: string;
    name?: string;
    title?: string;
    url?: string;
    contentMarkdown?: string;
    alt?: string;
    isBlob?: boolean;
    isImage?: boolean;
    originalUrl?: string;
    token?: string;
    providerRequestId?: string;
    imageOrdinal?: number;
    isGenerated?: boolean;
    generation?: DomainGeneratedMediaIdentity;
}

export interface GeminiDocumentEvidence {
    id: string;
    title: string;
    createdAt?: number | null;
    chipUrl: string;
    sections: string[];
    links: DocLink[];
    contentMarkdown?: string;
    url: string;
    candidates?: string[];
    localName: string;
    type: string;
    hasFabricatedText?: boolean;
}

export interface GeminiMessageEvidence {
    id: string;
    role: 'user' | 'model';
    content: string;
    timestamp: number | null;
    model?: string;
    providerRequestId?: string;
    /** Source-authored token, kept separately from the historical normalized lookup key. */
    rawProviderRequestId?: string;
    turnId?: string;
    thoughts?: string;
    citations?: Citation[];
    images?: Array<ImageAttachment & { type: string; localName: string; resolvedUrl: string; generation?: DomainGeneratedMediaIdentity }>;
    documents?: GeminiDocumentEvidence[];
    attachments?: GeminiAttachmentEvidence[];
    attachmentCount: number;
    messageCount: number;
    structuredContent?: GeminiStructuredDocument;
    groundingCitationMarkers?: string[];
}

export interface GeminiDetailDebugEvidence {
    turnsLen?: number;
    innerKeys?: string[] | null;
    innerPreview?: string;
    topPreview?: string | null;
    schemaDriftWarnings?: string[];
}

/** Decoder-local facts and transport evidence. Both Domain and legacy outputs use this extraction once. */
export interface GeminiDetailEvidence {
    id: string;
    title: string;
    titleSource: TitleResult['source'];
    titles: Partial<Record<TitleResult['source'], string>>;
    messages: GeminiMessageEvidence[];
    metadataConversation?: { id: string; title: string };
    createdAt: number | null;
    chatTime: number | null;
    timestamp: number | null;
    updatedAt: number | null;
    url: string;
    nextPageToken: string | null;
    attachmentCount: number;
    schemaDrift?: string[];
    turnsRejected?: number;
    _raw?: unknown;
    _debug?: GeminiDetailDebugEvidence | null;
}
