import type { Asset } from './assets.js';
import type { BlockNode } from './blocks.js';
import type { Citation } from './citations.js';
import type { Diagnostic } from './diagnostics.js';
import type { ProviderExtensions } from './json.js';
import type { SourceObservation, SourceRef } from './provenance.js';

export interface ConversationKey {
    providerId: string;
    accountId: string;
    conversationId: string;
}

export type CanonicalTitleSource =
    | 'rpc'
    | 'api-detail'
    | 'dom'
    | 'takeout'
    | 'sniff'
    | 'legacy'
    | 'provider'
    | 'user'
    | 'derived'
    | 'default';

export interface TitleCandidate {
    value: string;
    source: CanonicalTitleSource;
    observedAt?: string;
}

export interface ConversationTitle {
    value: string;
    source: CanonicalTitleSource;
    candidates: TitleCandidate[];
}

export type MessageRole =
    | 'user'
    | 'assistant'
    | 'system'
    | 'developer'
    | 'tool'
    | 'unknown';

export interface MessageAuthor {
    name?: string;
    model?: string;
    rawRole?: string;
}

export interface MessageNode {
    id: string;

    parentId?: string | null;
    siblingIndex?: number;

    role: MessageRole;
    author?: MessageAuthor;
    createdAt?: string;
    state?: 'complete' | 'partial' | 'error';

    blocks: BlockNode[];

    /** Message-level asset association index; visual order is determined by blocks, not this list. */
    associatedAssetIds?: string[];

    sourceRef?: SourceRef;
    extensions?: ProviderExtensions;
}

export interface Conversation {
    key: ConversationKey;
    title?: ConversationTitle;

    createdAt?: string;
    updatedAt?: string;
    observedAt?: string;

    messages: MessageNode[];

    selectedLeafMessageId?: string;

    extensions?: ProviderExtensions;
}

export interface CanonicalConversationBundle {
    schemaVersion: 1;
    conversation: Conversation;
    assets: Asset[];
    citations: Citation[];
    observations?: SourceObservation[];
    diagnostics?: Diagnostic[];
}
