import type { ContentQuality } from './quality.js';
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
    generation?: Partial<DomainGeneratedMediaIdentity>;
    document?: {
        id?: string;
        contentMarkdown?: string;
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
    url?: string;
    title?: string;
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
    /** Explicit message-owned resources, in source order; every ID belongs to conversation.assets. */
    attachmentIds?: string[];
    /** A source-recorded generation event remains meaningful even when its output files are absent. */
    generation?: DomainGenerationEvent;
    /** Provider-exposed reasoning parsed before Domain; resource nodes use registry IDs. */
    reasoning?: BlockNode[];
    citations?: DomainCitation[];
}

/** Body facts only. All conversation metadata belongs to DomainConversationIndex. */
export interface DomainConversationDetail {
    quality: ContentQuality;
    /** One record per semantic resource; body/reasoning assetId values refer to these IDs. */
    assets: DomainAsset[];
    messages: DomainMessage[];
}
