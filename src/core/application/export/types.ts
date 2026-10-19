import type { ConversationKey } from '../../domain/conversationKey.js';
export type { ExportFormat, ExportDelivery } from '../../export/packaging/index.js';
import type { ExportFormat, ExportDelivery } from '../../export/packaging/index.js';

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
