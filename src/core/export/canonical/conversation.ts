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

export type MessageRole =
    | 'user'
    | 'assistant'
    | 'system'
    | 'developer'
    | 'unknown';

export interface MessageAuthor {
    name?: string;
    model?: string;
    rawRole?: string;
}

export interface MessageNode {
    id: string;

    role: MessageRole;
    author?: MessageAuthor;
    createdAt?: string;
    state?: 'complete' | 'partial' | 'error';

    blocks: BlockNode[];
    citationIds?: string[];

    sourceRef?: SourceRef;
    extensions?: ProviderExtensions;
}

export interface Conversation {
    key: ConversationKey;
    title?: string;
    url?: string;

    createdAt?: string;
    updatedAt?: string;
    observedAt?: string;

    /** The array order is the authoritative message order. */
    messages: MessageNode[];

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
