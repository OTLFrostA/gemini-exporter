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
export interface ExportRecord {
    exportedAt: number;
    format: ExportFormat;
    status: 'ok' | 'partial';
    chatTime?: number;
}
export interface ExportProgress { current: number; total: number; key: ConversationKey }
export interface ExportResult {
    exported: number;
    skipped: number;
    partial: number;
    failed: readonly ConversationKey[];
    aborted: boolean;
}
