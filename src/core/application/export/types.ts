export type ExportFormat = 'markdown' | 'html' | 'json' | 'pdf';

export interface ExportRecord {
    exportedAt: number;
    format: ExportFormat;
    status: 'ok' | 'partial';
    chatTime?: number;
}
