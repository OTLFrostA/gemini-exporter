import { sameConversationKey } from './conversationKey.js';
import type { ConversationKey } from './conversationKey.js';
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

export interface DomainDocumentMetadata {
    id?: string;
    contentMarkdown?: string;
}

export interface DomainAsset {
    id: string;
    kind: DomainAssetKind;
    name?: string;
    mediaType?: string;
    byteLength?: number;
    /** Source locator; never inline bytes, a temporary blob URL or an export destination. */
    sourceUri?: string;
    generation?: DomainGeneratedMediaIdentity;
    document?: DomainDocumentMetadata;
}

export interface DomainGeneratedMediaIdentity {
    providerRequestId?: string;
    /** Unix epoch milliseconds; omit when unknown. */
    time?: number;
    prompt?: string;
    generationOrdinal?: number;
    imageCount?: number;
    imageOrdinal?: number;
}

export interface DomainCitation {
    /** Message-local identity referenced by content/reasoning citationRef nodes. */
    id: string;
    url?: string;
    title?: string;
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
    /** Provider-exposed reasoning parsed before Domain; resource nodes use registry IDs. */
    reasoning?: BlockNode[];
    citations?: DomainCitation[];
}

/** Body facts only. All conversation metadata belongs to DomainConversationIndex. */
export interface DomainConversationDetail {
    key: ConversationKey;
    /** Source version captured with this snapshot; never the local write clock. */
    savedAt?: number;
    quality: ContentQuality;
    /** One record per semantic resource; body/reasoning assetId values refer to these IDs. */
    assets: DomainAsset[];
    messages: DomainMessage[];
}

/** Public schema name from the frozen L2 interface contract. */
export type ConversationDetail = DomainConversationDetail;

/** Select a single snapshot; neither message count nor local capture time proves coverage. */
export function selectConversationDetail<T extends { detail: DomainConversationDetail }>(
    existing: T | undefined, incoming: T,
): T {
    if (!existing) return incoming;
    if (!sameConversationKey(existing.detail.key, incoming.detail.key)) throw new TypeError('Detail identity mismatch');
    if (existing.detail.quality.status === 'complete' && incoming.detail.quality.status !== 'complete') return existing;
    // An unversioned archive cannot supersede a snapshot with an online version.
    if (existing.detail.savedAt !== undefined && incoming.detail.savedAt === undefined) return existing;
    if (existing.detail.savedAt !== undefined && incoming.detail.savedAt !== undefined && incoming.detail.savedAt < existing.detail.savedAt) return existing;
    return incoming;
}
