/** Transitional application/provider records. These are not raw RPC, HTML or archive schemas. */
import type { DomainConversationCompleteness } from '../../domain/conversationDetail.js';
import type { GeneratedMediaIdentity } from '../../../types/conversation.js';
import type { LegacyAttachmentInput as ConversationRecordAttachment } from '../legacyAttachmentAdapter.js';
export type { LegacyAttachmentInput as ConversationRecordAttachment } from '../legacyAttachmentAdapter.js';

export interface ConversationRecordMessage {
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
    attachments?: ConversationRecordAttachment[];
    images?: ConversationRecordAttachment[];
    documents?: ConversationRecordAttachment[];
    citations?: unknown[];
    sources?: unknown[];
    structuredContent?: unknown;
    groundingCitationMarkers?: unknown[];
}

export interface ConversationRecordTurn {
    messages?: ConversationRecordMessage[];
    timestamp?: unknown;
    userContent?: unknown;
    modelContent?: unknown;
    model?: unknown;
    author?: { model?: unknown };
    thoughts?: unknown;
    attachments?: ConversationRecordAttachment[];
    images?: ConversationRecordAttachment[];
    sources?: unknown[];
    structuredContent?: unknown;
}

export interface ConversationRecordInput {
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
    messages?: ConversationRecordMessage[];
    turns?: ConversationRecordTurn[];
    /** Explicit source coverage, when the producer knows it. Absence means unknown. */
    completeness?: DomainConversationCompleteness;
    truncated?: boolean;
    isTruncated?: boolean;
    truncateReason?: string;
    /** Acquisition state: used only as evidence of partial coverage, never retained in Domain. */
    nextPageToken?: string | null;
}
