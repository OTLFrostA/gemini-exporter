import type { ConversationKey } from '../../l2/conversationKey.js';
export type { ExportFormat, ExportDelivery } from '../../l4/packaging/index.js';
import type { ExportFormat, ExportDelivery } from '../../l4/packaging/index.js';
import type { JsonValue } from '../../shared/utils/jsonTypes.js';

/** Per-run observations only; never persisted as conversation facts or export receipts. */
export interface ExportDiagnostic {
    key?: ConversationKey;
    stage: string;
    code: string;
    message: string;
    details?: JsonValue;
}

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
    /** First successful folder document name, without extension; stable across title changes. */
    folderBaseName?: string;
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
