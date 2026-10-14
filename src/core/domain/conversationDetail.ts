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
    /** Original acquisition URI, never an export destination or legacy localName. */
    sourceUri?: string;
    dataBase64?: string;
    failureReason?: string;
    generation?: Partial<DomainGeneratedMediaIdentity>;
    document?: {
        id?: string;
        contentMarkdown?: string;
        hasFabricatedText?: boolean;
    };
}

export interface DomainGeneratedMediaIdentity {
    providerRequestId?: string;
    /** Unix epoch milliseconds; omit when unknown. */
    time?: number;
    prompt?: string;
    generationOrdinal: number;
    imageCount?: number;
    imageOrdinal?: number;
}

export interface DomainCitation {
    /** Message-local identity referenced by content/reasoning citationRef nodes. */
    id: string;
    /** Source-authored citation number, when present (for example a grounding reference). */
    number?: number;
    url?: string;
    title?: string;
}

/** Provider-originated metadata, never a Domain relationship key. */
export interface DomainMessageProvenance {
    /** Source-authored role when it cannot be normalized to a known role. */
    rawRole?: string;
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

/** Canonical conversation facts, independent of acquisition and presentation. */
export interface DomainConversationDetail {
    providerId: string;
    completeness: 'complete' | 'partial' | 'unknown';
    /** One record per semantic resource; body/reasoning assetId values refer to these IDs. */
    assets: DomainAsset[];
    id: string;
    title: string;
    /** Unix epoch milliseconds; omit when unknown. */
    updatedAt?: number;
    /** Unix epoch milliseconds; omit when unknown. */
    createdAt?: number;
    url?: string;
    messages: DomainMessage[];
    titleSource?: string;
}
