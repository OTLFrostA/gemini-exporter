/** Raw Gemini input accepted by the canonical boundary; no runtime coercion implied. */
import type { GeneratedMediaIdentity } from '../../../../types/conversation.js';

export interface GeminiNormalizationAttachment {
    type?: string;
    isImage?: boolean;
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
    token?: unknown;
    isGenerated?: boolean;
    providerRequestId?: string;
    imageOrdinal?: number;
    generation?: GeneratedMediaIdentity;
    dataBuffer?: ArrayBuffer | ArrayBufferView | number[];
    blobBase64?: string;
    dataBase64?: string;
    contentMarkdown?: string;
    failureReason?: string;
}

export interface GeminiNormalizationMessage {
    id?: string;
    role?: string;
    content?: unknown;
    timestamp?: unknown;
    thoughts?: unknown;
    thinking?: unknown;
    attachments?: GeminiNormalizationAttachment[];
    images?: GeminiNormalizationAttachment[];
    documents?: GeminiNormalizationAttachment[];
    citations?: unknown[];
    sources?: unknown[];
    structuredContent?: unknown;
    groundingCitationMarkers?: unknown[];
}

export interface GeminiNormalizationTurn {
    messages?: GeminiNormalizationMessage[];
    timestamp?: unknown;
    userContent?: unknown;
    modelContent?: unknown;
    thoughts?: unknown;
    attachments?: GeminiNormalizationAttachment[];
    images?: GeminiNormalizationAttachment[];
    sources?: unknown[];
    structuredContent?: unknown;
}

export interface GeminiNormalizationInput {
    id?: string;
    title?: string;
    titleSource?: unknown;
    titles?: unknown;
    timestamp?: unknown;
    createdAt?: unknown;
    updatedAt?: unknown;
    chatTime?: unknown;
    lastSeen?: unknown;
    url?: string;
    href?: string;
    messages?: GeminiNormalizationMessage[];
    turns?: GeminiNormalizationTurn[];
}
