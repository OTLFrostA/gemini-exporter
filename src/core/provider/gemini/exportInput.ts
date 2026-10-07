/** Raw provider input accepted only at provider parsing/acquisition boundaries. */
import type { GeneratedMediaIdentity } from '../../../types/conversation.js';
import type { LegacyAttachmentInput as GeminiNormalizationAttachment } from '../legacyAttachmentAdapter.js';
export type { LegacyAttachmentInput as GeminiNormalizationAttachment } from '../legacyAttachmentAdapter.js';

export interface GeminiNormalizationMessage {
    id?: string;
    role?: string;
    model?: unknown;
    author?: { model?: unknown };
    turnId?: string;
    providerRequestId?: string;
    generation?: GeneratedMediaIdentity;
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
    model?: unknown;
    author?: { model?: unknown };
    thoughts?: unknown;
    attachments?: GeminiNormalizationAttachment[];
    images?: GeminiNormalizationAttachment[];
    sources?: unknown[];
    structuredContent?: unknown;
}

export interface GeminiNormalizationInput {
    source?: string;
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
