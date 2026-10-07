import type { BlockNode } from './content/blocks.js';

/** Provider-neutral description of a complete conversation detail. */
export type DomainMessageRole =
    | 'user'
    | 'assistant'
    | 'system'
    | 'developer'
    | 'unknown';

/** Semantic resource identity, shared across the conversation. No export destination or layout. */
export type DomainAssetKind = 'image' | 'file' | 'audio' | 'video' | 'other';

export interface DomainAsset {
    id: string;
    kind: DomainAssetKind;
    name?: string;
    mediaType?: string;
    byteLength?: number;
    dimensions?: { width?: number; height?: number };
    /** Original acquisition URI, never an export destination or legacy localName. */
    source?: { uri?: string };
    dataBase64?: string;
    failureReason?: string;
    origin?: string;
    generated?: boolean;
    generation?: Partial<DomainGeneratedMediaIdentity>;
    document?: {
        id?: string;
        createdAt?: number | null;
        chipUrl?: string;
        sections?: string[];
        links?: Array<{ title: string; url: string }>;
        contentMarkdown?: string;
        candidates?: string[];
        hasFabricatedText?: boolean;
    };
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
    /** Message-local identity referenced by content/reasoning citationRef nodes. */
    id: string;
    kind?: 'web' | 'attachment' | 'other';
    /** Source-authored citation number, when present (for example a grounding reference). */
    number?: number;
    url?: string;
    title?: string;
}

/** Provider-originated metadata, never a Domain relationship key. */
export interface DomainMessageProvenance {
    /** Source-authored role when it cannot be normalized to a known role. */
    rawRole?: string;
    /** Opaque provider metadata; preserve case and prefixes, and never infer relationships. */
    providerRequestId?: string;
}

/** Authored media-generation event; output files may be absent from the source. */
export interface DomainGenerationEvent {
    mediaKind: 'image' | 'audio' | 'video' | 'other';
    outputCount?: number;
}

export interface DomainMessage {
    /** Optional stable message identity; never synthesized from array position. */
    id?: string;
    role: DomainMessageRole;
    /** Provider-authored model name, when supplied. */
    model?: string;
    content: BlockNode[];
    /** Unix epoch milliseconds; omit when missing or unknown. */
    timestamp?: number;
    provenance?: DomainMessageProvenance;
    /** Explicit message-owned resources, in source order; every ID belongs to conversation.assets. */
    attachmentIds?: string[];
    /** A source-recorded generation event remains meaningful even when its output files are absent. */
    generation?: DomainGenerationEvent;
    /** Provider-exposed reasoning parsed before Domain; resource nodes use registry IDs. */
    reasoning?: BlockNode[];
    citations?: DomainCitation[];
}

/** Source evidence about the conversation, independent of its content provider. */
export interface DomainConversationProvenance {
    /** Opaque producer-authored origin label (for example takeout or openai-import). */
    source?: string;
}

export interface DomainConversationCompleteness {
    /** Missing coverage must not be mistaken for a complete conversation. Absence is also unknown. */
    status: 'complete' | 'partial' | 'unknown';
    /** Source-authored explanation; never a pagination cursor or parser diagnostic. */
    reason?: string;
}

export interface DomainConversationDetail {
    providerId: string;
    provenance?: DomainConversationProvenance;
    completeness?: DomainConversationCompleteness;
    /** One record per semantic resource; body/reasoning assetId values refer to these IDs. */
    assets: DomainAsset[];
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
