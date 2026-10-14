import type { ImageAttachment, DocLink } from './sourceAttachments.js';
import type { Citation, TitleResult } from './extractors.js';
import type { GeminiStructuredDocument } from './structuredContent.js';
import type { GeneratedMediaIdentity as SourceGeneratedMediaIdentity } from '../../../../types/conversation.js';

/** Source extraction evidence, not the persisted Conversation/Message contract. */
export interface GeminiAttachmentEvidence {
    type: string;
    id?: string;
    fileName?: string;
    dataBuffer?: Uint8Array;
    src?: string;
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
    generation?: Omit<SourceGeneratedMediaIdentity, 'time'> & { time?: number };
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
    type: string;
    hasFabricatedText?: boolean;
}

export interface GeminiMessageEvidence {
    id: string;
    role: 'user' | 'model';
    timestamp: number | null;
    content: string;
    model?: string;
    providerRequestId?: string;
    /** Source-authored token, kept separately from the historical normalized lookup key. */
    rawProviderRequestId?: string;
    turnId?: string;
    thoughts?: string;
    citations?: Citation[];
    images?: Array<ImageAttachment & { type: string; isImage?: boolean; generation?: SourceGeneratedMediaIdentity }>;
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

/** Decoder-local source facts and transport evidence for native Domain parsing. */
export interface GeminiDetailEvidence {
    id: string;
    title: string;
    titleSource: TitleResult['source'];
    messages: GeminiMessageEvidence[];
    metadataConversation?: { id: string; title: string };
    updatedAt: number | null;
    url: string;
    nextPageToken: string | null;
    attachmentCount: number;
    schemaDrift?: string[];
    turnsRejected?: number;
    _raw?: unknown;
    _debug?: GeminiDetailDebugEvidence | null;
}
