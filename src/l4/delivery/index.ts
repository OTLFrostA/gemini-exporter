import { operationError } from '../../shared/errors/operationError.js';
import type { ExportArtifact } from '../artifacts.js';
import { FsWriter } from './writers/fsWriter.js';
import { assertExportPath } from '../shared/exportPath.js';

const DEFAULT_BLOB_REVOKE_DELAY_MS = 30_000;

/** Resolves on an uncancelled download action, without tracking browser download completion. */
export async function startBrowserDownload(file: ExportArtifact, revokeDelayMs = DEFAULT_BLOB_REVOKE_DELAY_MS): Promise<void> {
    assertExportPath(file.fileName);
    if (file.fileName.includes('/')) throw new Error('Browser download requires a root-level final file');
    const blob = file.content instanceof Blob ? file.content : new Blob([typeof file.content === 'string' ? file.content : new Uint8Array(file.content)], { type: file.mimeType });
    const url = URL.createObjectURL(blob);
    let anchor: HTMLAnchorElement | undefined;
    let downloadStarted = false;
    try {
        anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = file.fileName;
        document.body.appendChild(anchor);
        const started = anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        if (!started) throw new Error('Browser download action was blocked');
        downloadStarted = true;
    } catch (error) {
        throw operationError(error, 'FILE_WRITE_FAILED');
    } finally {
        anchor?.remove();
        if (!downloadStarted) {
            URL.revokeObjectURL(url);
        } else {
            let revoked = false;
            const revoke = (): void => {
                if (revoked) return;
                revoked = true;
                clearTimeout(timer);
                if (typeof globalThis.removeEventListener === 'function') {
                    globalThis.removeEventListener('pagehide', revoke);
                }
                URL.revokeObjectURL(url);
            };
            // Keep the Blob URL alive long enough for Chromium's download manager to open large ZIPs.
            const timer = setTimeout(revoke, revokeDelayMs);
            if (typeof timer === 'object' && timer !== null && 'unref' in timer && typeof timer.unref === 'function') {
                timer.unref();
            }
            if (typeof globalThis.addEventListener === 'function') {
                globalThis.addEventListener('pagehide', revoke, { once: true });
            }
        }
    }
}

export async function writeToFolder(files: readonly ExportArtifact[], directory: FileSystemDirectoryHandle): Promise<void> {
    for (const file of files) assertExportPath(file.fileName);
    const writer = new FsWriter(directory);
    await writer.init();
    const remaining = files.values();
    let stopped = false;
    const writeNext = async (): Promise<void> => {
        try {
            for (const file of remaining) {
                if (stopped) return;
                const path = await writer.writeFile(file.fileName, file.content);
                if (path !== file.fileName) throw new Error('Folder writer changed planned path');
            }
        } catch (error) {
            stopped = true;
            throw error;
        }
    };
    // Files at different paths can progress independently; FsWriter serializes duplicate paths.
    // Wait for every in-flight write before returning an error so no late writes escape delivery.
    const settled = await Promise.allSettled(Array.from({ length: Math.min(3, files.length) }, writeNext));
    for (const outcome of settled) if (outcome.status === 'rejected') throw outcome.reason;
}

/** Read-only lookup inside the selected export root. */
export function folderFileExists(directory: FileSystemDirectoryHandle, relativePath: string): Promise<boolean> {
    return new FsWriter(directory).exists(relativePath);
}
