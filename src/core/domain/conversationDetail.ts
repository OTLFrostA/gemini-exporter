import type { BlockNode } from '../content/blocks.js';

/** Provider-neutral description of a complete conversation detail. */
export type DomainMessageRole =
    | 'user'
    | 'assistant'
    | 'system';

/** Semantic resource identity, shared across the conversation. No export destination or layout. */
export type DomainAssetKind = 'image' | 'file' | 'audio' | 'video' | 'other';

export interface DomainAsset {
    id: string;
    kind: DomainAssetKind;
    name?: string;
    mediaType?: string;
    byteLength?: number;
    dimensions?: { width?: number; height?: number };
    /** Acquisition URI and/or source archive entry, never an export destination. */
    source?: { uri?: string; path?: string };
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
    /** Explicit message-owned resources, in source order; every ID belongs to conversation.assets. */
    attachmentIds?: string[];
    /** Provider-exposed reasoning parsed before Domain; resource nodes use registry IDs. */
    reasoning?: BlockNode[];
    citations?: DomainCitation[];
    groundingCitationMarkers?: string[];
}

export interface DomainConversationDetail {
    providerId: string;
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
