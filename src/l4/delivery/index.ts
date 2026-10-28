import { operationError } from '../../shared/errors/operationError.js';
import type { ExportArtifact } from '../artifacts.js';
import { FsWriter } from './writers/fsWriter.js';
import { assertExportPath } from '../packaging/exportPath.js';

/** Resolves on the anchor action, without tracking browser download completion. */
export async function startBrowserDownload(file: ExportArtifact): Promise<void> {
    assertExportPath(file.fileName);
    if (file.fileName.includes('/')) throw new Error('Browser download requires a root-level final file');
    const blob = file.content instanceof Blob ? file.content : new Blob([typeof file.content === 'string' ? file.content : new Uint8Array(file.content)], { type: file.mimeType });
    const url = URL.createObjectURL(blob);
    let anchor: HTMLAnchorElement | undefined;
    try {
        anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = file.fileName;
        document.body.appendChild(anchor);
        anchor.click();
    } catch (error) {
        throw operationError(error, 'FILE_WRITE_FAILED');
    } finally {
        anchor?.remove();
        // Keep the URL alive through the browser's navigation task.
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }
}

export async function writeToFolder(files: readonly ExportArtifact[], directory: FileSystemDirectoryHandle): Promise<void> {
    for (const file of files) assertExportPath(file.fileName);
    const writer = new FsWriter(directory);
    await writer.init();
    for (const file of files) {
        const path = await writer.writeFile(file.fileName, file.content);
        if (path !== file.fileName) throw new Error('Folder writer changed planned path');
    }
}
