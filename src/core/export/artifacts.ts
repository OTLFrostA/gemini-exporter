import type { DocumentDiagnostic } from '../diagnostics/documentDiagnostic.js';

export interface CompanionResourcePlan {
    resourceIds: string[];
    omitted: Array<{ resourceId: string; reason: string }>;
}

export interface ArtifactWriteReport {
    fileName: string;
    target: 'zip' | 'folder' | string;
    bytesWritten: number;
    writtenAt: string;
}

export interface ExportArtifact {
    fileName: string;
    mimeType: string;
    content: string | Blob | Uint8Array;
    companionResourceIds: string[];
    companionPlan?: CompanionResourcePlan;
    writeReport?: ArtifactWriteReport;
    diagnostics?: DocumentDiagnostic[];
}
