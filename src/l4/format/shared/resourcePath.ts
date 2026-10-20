import { assertExportPath } from '../../packaging/exportPath.js';

/** Only Packaging's already-canonical relative paths are valid resource bindings. */
export function isResourcePath(path: string | undefined): path is string {
    if (!path) return false;
    try {
        assertExportPath(path);
        return true;
    } catch {
        return false;
    }
}
