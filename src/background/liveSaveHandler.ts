// src/background/liveSaveHandler.ts - Live Save via File System Handle execution and disk state probing

import { getStoredDirHandle, clearStoredDirHandle } from '../core/storage/idbHandleStore.js';
import { setLiveConfig } from '../core/storage/liveStorageManager.js';
import { createLiveSaveWriter, writeLiveSaveMarkdown, formatLiveSaveMarkdown } from '../core/engine/liveSaveWriter.js';
import { StorageService } from '../core/storage/storageService.js';

export async function markDirDeletedInConfig(): Promise<void> {
    try {
        await setLiveConfig({
            enabledDisk: false,
            dirName: '',
            dirError: 'not_found'
        });
    } catch {
        /* ignore */
    }
}

export interface LiveSaveResult {
    ok: boolean;
    fallback?: 'downloads';
    handleName?: string;
    targetFile?: string;
    error?: string;
    details?: string;
}

export function base64ToUint8Array(base64: string): Uint8Array {
    if (!base64 || typeof base64 !== 'string') return new Uint8Array(0);
    if (typeof Buffer !== 'undefined' && typeof (Buffer as any).from === 'function') {
        const buf = Buffer.from(base64, 'base64');
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

export async function downloadViaDownloadsAPI(filename: string, content: string | Uint8Array, mimeType = 'text/markdown'): Promise<boolean> {
    if (typeof chrome === 'undefined' || !chrome.downloads || typeof chrome.downloads.download !== 'function') {
        return false;
    }
    let base64 = '';
    if (typeof content === 'string') {
        if (typeof Buffer !== 'undefined') {
            base64 = Buffer.from(content, 'utf-8').toString('base64');
        } else {
            base64 = btoa(unescape(encodeURIComponent(content)));
        }
    } else if (content instanceof Uint8Array) {
        if (typeof Buffer !== 'undefined') {
            base64 = Buffer.from(content.buffer, content.byteOffset, content.byteLength).toString('base64');
        } else {
            let binary = '';
            for (let i = 0; i < content.length; i++) {
                binary += String.fromCharCode(content[i]);
            }
            base64 = btoa(binary);
        }
    }
    const dataUrl = `data:${mimeType};base64,${base64}`;
    return new Promise((resolve) => {
        chrome.downloads.download({
            url: dataUrl,
            filename: 'gemini_export/' + filename,
            conflictAction: 'overwrite',
            saveAs: false
        }, (downloadId) => {
            if (chrome.runtime.lastError || !downloadId) {
                console.warn('[Background:liveSave] chrome.downloads.download failed:', chrome.runtime.lastError);
                resolve(false);
            } else {
                resolve(true);
            }
        });
    });
}

export async function saveViaDownloadsFallback(
    chat: any,
    safeTitle: string,
    nid: string,
    fileName: string | undefined,
    assets: any[] | undefined,
    accountSlot: string = 'u0'
): Promise<LiveSaveResult> {
    const { fileName: computedFileName, markdown } = formatLiveSaveMarkdown({ chat, safeTitle, nid });
    const targetFile = fileName || computedFileName;

    // Write markdown to Downloads/gemini_export/<targetFile>
    const mdOk = await downloadViaDownloadsAPI(targetFile, markdown, 'text/markdown;charset=utf-8');
    if (!mdOk) {
        return { ok: false, error: 'downloads_fallback_failed' };
    }

    // Write assets
    if (Array.isArray(assets) && assets.length > 0) {
        for (const asset of assets) {
            if (asset && asset.fileName) {
                let fileData: Uint8Array | null = null;
                if (asset.base64 && typeof asset.base64 === 'string') {
                    try {
                        fileData = base64ToUint8Array(asset.base64);
                    } catch { /* ignore */ }
                } else if (asset.buffer instanceof ArrayBuffer) {
                    fileData = new Uint8Array(asset.buffer);
                } else if (ArrayBuffer.isView(asset.buffer)) {
                    fileData = new Uint8Array(asset.buffer.buffer, asset.buffer.byteOffset, asset.buffer.byteLength);
                }
                if (fileData && fileData.byteLength > 0) {
                    const assetRelPath = `${asset.subDir || 'assets'}/${asset.fileName}`;
                    await downloadViaDownloadsAPI(assetRelPath, fileData, 'application/octet-stream');
                }
            }
        }
    }

    const now = Date.now();
    try {
        await setLiveConfig({
            lastSavedAt: now,
            lastSavedTitle: safeTitle,
            dirError: 'permission_prompt_needed'
        });
    } catch { /* best effort */ }

    try {
        const slot = accountSlot || 'u0';
        if (StorageService?.saveExportRecord) {
            await StorageService.saveExportRecord(slot, nid, {
                exportedAt: new Date(now).toISOString(),
                title: safeTitle,
                format: 'markdown'
            });
        }
    } catch (e) {
        console.warn('[Background:liveSave] Failed to mark conversation as exported:', e);
    }

    return {
        ok: true,
        fallback: 'downloads',
        error: 'permission_prompt_needed',
        targetFile
    };
}

export async function handleLiveSaveViaHandle(payload: any, accountSlot: string = 'u0'): Promise<LiveSaveResult> {
    try {
        const { chat, safeTitle, nid, fileName, assets } = payload || {};
        const handle = await getStoredDirHandle();
        if (!handle) {
            return { ok: false, error: 'no_dir_handle' };
        }

        let needsDownloadsFallback = false;
        if (handle.queryPermission) {
            try {
                const perm = await handle.queryPermission({ mode: 'readwrite' });
                if (perm !== 'granted') {
                    needsDownloadsFallback = true;
                }
            } catch (permErr: any) {
                console.warn('[Background:liveSave] queryPermission threw, fallback to downloads:', permErr);
                needsDownloadsFallback = true;
            }
        }

        if (needsDownloadsFallback) {
            console.info('[Background:liveSave] Handle permission not granted, triggering zero-loss Downloads fallback');
            return await saveViaDownloadsFallback(chat, safeTitle, nid, fileName, assets, accountSlot);
        }

        // Verify the directory physically exists on disk before proceeding
        try {
            for await (const _ of handle.keys()) break;
        } catch (probeErr: any) {
            if (probeErr?.name === 'NotFoundError' || probeErr?.message?.includes('not be found') || probeErr?.message?.includes('NotFoundError')) {
                console.warn('[Background:liveSave] Target directory was deleted on disk:', probeErr);
                await clearStoredDirHandle();
                await markDirDeletedInConfig();
                return { ok: false, error: 'dir_not_found', details: probeErr?.message };
            }
            if (probeErr?.name === 'NotAllowedError' || probeErr?.name === 'SecurityError') {
                console.info('[Background:liveSave] Directory probe threw NotAllowedError, fallback to downloads');
                return await saveViaDownloadsFallback(chat, safeTitle, nid, fileName, assets, accountSlot);
            }
        }

        // Shared live-save writer: filename format + markdown formatting + write.
        // (Permission checks, dir probing, asset loop and export-record
        // bookkeeping stay here - they are background-side orchestration.)
        const writer = await createLiveSaveWriter(handle);

        const targetFile = await writeLiveSaveMarkdown(
            writer,
            { chat, safeTitle, nid },
            {},
            { fileName }
        );

        if (Array.isArray(assets) && assets.length > 0) {
            for (const asset of assets) {
                if (asset && asset.fileName) {
                    let fileData: Uint8Array | null = null;
                    if (asset.base64 && typeof asset.base64 === 'string') {
                        try {
                            fileData = base64ToUint8Array(asset.base64);
                        } catch (b64Err) {
                            console.warn('[Background:liveSave] Failed to decode base64 for asset:', asset.fileName, b64Err);
                        }
                    } else if (asset.buffer instanceof ArrayBuffer) {
                        fileData = new Uint8Array(asset.buffer);
                    } else if (ArrayBuffer.isView(asset.buffer)) {
                        fileData = new Uint8Array(asset.buffer.buffer, asset.buffer.byteOffset, asset.buffer.byteLength);
                    } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(asset.buffer)) {
                        fileData = new Uint8Array(asset.buffer.buffer, asset.buffer.byteOffset, asset.buffer.byteLength);
                    }

                    if (!fileData || fileData.byteLength === 0) {
                        console.warn('[Background:liveSave] Skipping asset with no valid binary data:', asset.fileName);
                        continue;
                    }

                    try {
                        await writer.writeFile(asset.subDir || 'assets', asset.fileName, fileData);
                    } catch (assetErr) {
                        console.warn('[Background:liveSave] Failed to write asset:', asset.fileName, assetErr);
                    }
                }
            }
        }

        const now = Date.now();
        try {
            await setLiveConfig({
                lastSavedAt: now,
                lastSavedTitle: safeTitle,
                dirError: null
            });
        } catch {
            /* best-effort storage update */
        }

        // Mark conversation as exported in exportedIds SSoT
        try {
            const slot = accountSlot || 'u0';
            if (StorageService?.saveExportRecord) {
                await StorageService.saveExportRecord(slot, nid, {
                    exportedAt: new Date(now).toISOString(),
                    title: safeTitle,
                    format: 'markdown'
                });
            }
        } catch (e) {
            console.warn('[Background:liveSave] Failed to mark conversation as exported:', e);
        }

        return { ok: true, handleName: handle.name, targetFile };
    } catch (err: any) {
        console.warn('[Background:liveSave] liveSaveViaHandle error:', err);
        const isNotFound = err?.name === 'NotFoundError' || err?.message?.includes('could not be found') || err?.message?.includes('NotFoundError');
        if (isNotFound) {
            await clearStoredDirHandle();
            await markDirDeletedInConfig();
            return { ok: false, error: 'dir_not_found', details: err?.message };
        }
        if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') {
            console.info('[Background:liveSave] liveSaveViaHandle caught permission error, falling back to downloads');
            const { chat, safeTitle, nid, fileName, assets } = payload || {};
            return await saveViaDownloadsFallback(chat, safeTitle, nid, fileName, assets, accountSlot);
        }
        return { ok: false, error: err?.message || String(err) };
    }
}
