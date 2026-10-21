import type { ConversationKey } from '../../l2/conversationKey.js';
export type { ExportFormat, ExportDelivery } from '../../l4/packaging/index.js';
import type { ExportFormat, ExportDelivery } from '../../l4/packaging/index.js';

export interface ExportRequest {
    keys: readonly ConversationKey[];
    format: ExportFormat;
    delivery: ExportDelivery;
    includeAssets: boolean;
    skipUnchanged: boolean;
}
export interface ExportAttachmentIssue {
    resourceId: string; name: string; sourceUrl?: string; code: string; httpStatus?: number;
}
export interface ExportRecord {
    exportedAt: number;
    format: ExportFormat;
    status: 'ok' | 'partial';
    chatTime?: number;
    otherContentMissing?: boolean;
    attachmentIssues?: readonly ExportAttachmentIssue[];
}
export interface ExportProgress { current: number; total: number; key: ConversationKey }
export interface ExportResult {
    exported: number;
    skipped: number;
    partial: number;
    attachmentIssues?: readonly ExportAttachmentIssue[];
    expiredConversations?: number;
    otherPartial?: number;
    failed: readonly ConversationKey[];
    aborted: boolean;
}

/** Rendering is not delivery: Browser downloads report prepared items before a final ZIP handoff. */
export type ExportItemUpdate =
    | { key: ConversationKey; status: 'prepared' | 'skipped' | 'failed' }
    | { key: ConversationKey; status: 'exported'; record: ExportRecord };
