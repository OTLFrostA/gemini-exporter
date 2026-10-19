import { runExport as execute } from '../../core/application/export/runExport.js';
import type { ExportRequest, ExportResult, ExportProgress } from '../../core/application/export/types.js';

// Packaging decides ZIP automatically. The Application owner still needs to remove its old required useZip field.
export type UIExportRequest = Omit<ExportRequest, 'useZip'>;
export function runExport(request: UIExportRequest, options: {
    signal?: AbortSignal; onProgress?: (progress: ExportProgress) => void;
} = {}): Promise<ExportResult> {
    // @ts-expect-error Pending Application contract migration: v2 has no useZip input.
    return execute(request, options);
}
