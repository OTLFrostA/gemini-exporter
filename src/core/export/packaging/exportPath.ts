import { sanitizeRelativePath } from '../../utils/pathUtils.js';
import { normalizeArchivePath } from '../assets/archivePath.js';

/** Writers accept the planned path verbatim or reject it. */
export function assertExportPath(path: string): void {
    if (!path || normalizeArchivePath(path) !== path || sanitizeRelativePath(path) !== path) {
        throw new Error(`Noncanonical export path: ${path}`);
    }
}
