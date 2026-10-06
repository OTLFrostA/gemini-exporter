import type { BlockNode } from '../content/blocks.js';

/** Provider-neutral description of a complete conversation detail. */
export type DomainMessageRole =
    | 'user'
    | 'assistant'
    | 'system';

/** A file or media reference supplied with a message. */
export interface DomainAttachment {
    type: string;
    url?: string;
    sourceUrl?: string;
    resolvedUrl?: string;
    src?: string;
    localName?: string;
    fileName?: string;
    name?: string;
    title?: string;
    mimeType?: string;
    mime?: string;
    size?: number;
    width?: number;
    height?: number;
    source?: string;
    subDir?: string;
    isGenerated?: boolean;
    providerRequestId?: string;
    imageOrdinal?: number;
    generation?: DomainGeneratedMediaIdentity;
    isImage?: boolean;
    blobBase64?: string;
    dataBase64?: string;
    failureReason?: string;
    /** Document metadata belongs to its resource record. */
    id?: string;
    createdAt?: number | null;
    chipUrl?: string;
    sections?: string[];
    links?: Array<{ title: string; url: string }>;
    contentMarkdown?: string;
    candidates?: string[];
    hasFabricatedText?: boolean;
}

export interface DomainGeneratedMediaIdentity {
    chatId: string;
    providerRequestId?: string;
    time?: number | null;
    prompt?: string;
    generationOrdinal: number;
    imageCount?: number;
    imageOrdinal?: number;
    turnId?: string;
}

export interface DomainCitation {
    url: string;
    title?: string;
}

/** Provider-originated metadata, never a Domain relationship key. */
export interface DomainMessageProvenance {
    /** Opaque provider metadata; preserve case and prefixes, and never infer relationships. */
    providerRequestId?: string;
}

export interface DomainMessage {
    /** Optional stable message identity; never synthesized from array position. */
    id?: string;
    role: DomainMessageRole;
    content: BlockNode[];
    /** Unix epoch milliseconds; omit when missing or unknown. */
    timestamp?: number;
    provenance?: DomainMessageProvenance;
    attachments?: DomainAttachment[];
    reasoning?: string;
    citations?: DomainCitation[];
    groundingCitationMarkers?: string[];
}

export interface DomainConversationDetail {
    id: string;
    title: string;
    timestamp: number | null;
    updatedAt?: number | string | null;
    createdAt?: number | string | null;
    chatTime?: number | string;
    lastSeen?: number | string;
    url?: string;
    href?: string;
    messages: DomainMessage[];
    titleSource?: string;
    titles?: Record<string, string | undefined>;
}
