/**
 * src/core/export/canonical/conversation.ts
 * Canonical conversation, message tree, title and bundle model.
 *
 * Adapted from gemini-exporter-rendering-contract-v1 (canonical/src/conversation.ts),
 * v1.0.0-draft. See SOURCE.md for the source trace and adaptations.
 *
 * Adaptation notes (integration doc section 3):
 * - Title authority (item 2): the package's 'provider' | 'user' | 'derived'
 *   could not express the repo's rpc/dom/takeout/sniff/api-detail/legacy
 *   upgrade rules, so ConversationTitle now keeps every observed candidate
 *   plus the resolved value. Resolution lives in titleAuthority.ts and mirrors
 *   the repo's TITLE_TIER_RANK, so legacy title upgrade behavior cannot regress.
 * - accountId (F1 dependency): left as the package defined it; the F1
 *   composite-identity migration owns its value. Never synthesize ad-hoc IDs.
 */

import type { Asset } from './assets.js';
import type { BlockNode } from './blocks.js';
import type { Citation } from './citations.js';
import type { Diagnostic } from './diagnostics.js';
import type { ProviderExtensions } from './json.js';
import type { SourceObservation, SourceRef } from './provenance.js';

export interface ConversationKey {
    providerId: string;
    /**
     * TODO(F1): populated by the F1 composite-identity migration. Never
     * synthesize an ad-hoc account id that may collide across accounts.
     */
    accountId: string;
    conversationId: string;
}

/**
 * Title candidate sources. The package's 'provider' | 'user' | 'derived' are
 * kept for compatibility; the repo's title-tier sources ('rpc', 'api-detail',
 * 'dom', 'takeout', 'sniff', 'legacy', 'default') are first-class so the
 * existing title upgrade rules can be expressed without loss.
 */
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
    /**
     * Every observed title candidate stays on the record. The resolved
     * value/source is chosen by authority tier (see titleAuthority.ts); a
     * lower-authority observation can never overwrite a higher-authority one.
     */
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
    /** Original provider role when normalization mapped it. */
    rawRole?: string;
}

export interface MessageNode {
    id: string;

    /** Null/absent parent means a root message. */
    parentId?: string | null;
    /** Stable provider order among siblings when known. */
    siblingIndex?: number;

    role: MessageRole;
    author?: MessageAuthor;
    createdAt?: string;
    state?: 'complete' | 'partial' | 'error';

    /** Visible semantic content, in provider/source order. */
    blocks: BlockNode[];

    /**
     * Message-level association index. Visual/semantic placement is represented
     * by image/file/tool blocks; this list must not be used to invent ordering.
     */
    associatedAssetIds?: string[];

    sourceRef?: SourceRef;
    extensions?: ProviderExtensions;
}

export interface Conversation {
    key: ConversationKey;
    title?: ConversationTitle;

    /** Unknown timestamps stay absent. Never replace them with "now". */
    createdAt?: string;
    updatedAt?: string;
    observedAt?: string;

    messages: MessageNode[];

    /** Provider/UI-selected branch leaf if known. Absence means unknown. */
    selectedLeafMessageId?: string;

    extensions?: ProviderExtensions;
}

/**
 * Unit persisted in the repository/archive content layer.
 */
export interface CanonicalConversationBundle {
    schemaVersion: 1;
    conversation: Conversation;
    assets: Asset[];
    citations: Citation[];
    observations?: SourceObservation[];
    diagnostics?: Diagnostic[];
}
