/** Provider-neutral description of a complete conversation detail. */
export type DomainRole = 'user' | 'model' | 'assistant' | 'system';

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
    dataBuffer?: ArrayBuffer | ArrayBufferView;
    blobBase64?: string;
    dataBase64?: string;
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

export interface DomainDocument extends DomainAttachment {
    id?: string;
    createdAt?: number | null;
    chipUrl?: string;
    sections?: string[];
    links?: Array<{ title: string; url: string }>;
    contentMarkdown?: string;
    candidates?: string[];
    hasFabricatedText?: boolean;
}

export interface DomainMessage {
    id?: string;
    role: DomainRole;
    content: string;
    timestamp?: number | null;
    turnId?: string;
    providerRequestId?: string;
    generation?: DomainGeneratedMediaIdentity;
    attachments?: DomainAttachment[];
    thoughts?: string | string[];
    thinking?: string;
    citations?: DomainCitation[];
    images?: DomainAttachment[];
    documents?: DomainDocument[];
    sources?: unknown[];
    structuredContent?: unknown;
    groundingCitationMarkers?: string[];
}

/** Legacy turn fallback retained verbatim in shape for conversations without messages. */
export interface DomainTurn {
    id?: string;
    timestamp?: number | null;
    messages?: DomainMessage[];
    userContent?: string;
    modelContent?: string;
    thoughts?: string | string[];
    thinking?: string;
    attachments?: DomainAttachment[];
    images?: DomainAttachment[];
    documents?: DomainDocument[];
    citations?: DomainCitation[];
    sources?: unknown[];
    structuredContent?: unknown;
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
    messages?: DomainMessage[];
    turns?: DomainTurn[];
    titleSource?: string;
    titles?: Record<string, string | undefined>;
}
