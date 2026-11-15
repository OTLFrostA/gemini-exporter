import type { ExportFormat } from '../shared/types/export.js';
import type { SourceTurnStatus } from './quality.js';

export interface ExportAttachmentIssue {
    resourceId: string;
    name: string;
    sourceUrl?: string;
    code: string;
    httpStatus?: number;
}

export interface ExportRecord {
    /** First successful folder document name, without extension; stable across title changes. */
    folderBaseName?: string;
    exportedAt: number;
    format: ExportFormat;
    status: 'ok' | 'partial';
    chatTime?: number;
    otherContentMissing?: boolean;
    sourceTurn?: SourceTurnStatus;
    attachmentIssues?: readonly ExportAttachmentIssue[];
}
