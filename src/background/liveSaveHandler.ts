// src/background/liveSaveHandler.ts - Live Save via File System Handle execution and disk state probing

import { getStoredDirHandle, clearStoredDirHandle } from '../core/storage/idbHandleStore.js';
import { setLiveConfig } from '../core/storage/liveStorageManager.js';
import { createLiveSaveWriter, writeLiveSaveMarkdown, formatLiveSaveMarkdown } from '../core/engine/liveSaveWriter.js';
import { StorageService } from '../core/storage/storageService.js';
import { getEffectiveTimestamp } from '../core/utils/utils.js';

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
    handleName?: string;
    targetFile?: string;
    error?: string;
    details?: string;
    // Phase A (P1-2): 附件失败明细。ok=false + failedAssets 非空 = 主 md 已落盘、
    // 部分附件失败（partial），调用方应打 badge 警告而非静默标成功。
    failedAssets?: Array<{ file: string; error: string }>;
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

export async function handleLiveSaveViaHandle(payload: any, accountSlot: string = 'u0'): Promise<LiveSaveResult> {
    try {
        const { chat, safeTitle, nid, fileName, assets } = payload || {};
        const handle = await getStoredDirHandle();
        if (!handle) {
            return { ok: false, error: 'no_dir_handle' };
        }

        if (handle.queryPermission) {
            try {
                const perm = await handle.queryPermission({ mode: 'readwrite' });
                if (perm !== 'granted') {
                    console.info('[Background:liveSave] Handle permission not granted (prompt needed)');
                    await setLiveConfig({ dirError: 'permission_prompt_needed' });
                    return { ok: false, error: 'permission_prompt_needed' };
                }
            } catch (permErr: any) {
                console.warn('[Background:liveSave] queryPermission threw, prompt needed:', permErr);
                await setLiveConfig({ dirError: 'permission_prompt_needed' });
                return { ok: false, error: 'permission_prompt_needed' };
            }
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
                console.info('[Background:liveSave] Directory probe threw NotAllowedError, prompt needed');
                await setLiveConfig({ dirError: 'permission_prompt_needed' });
                return { ok: false, error: 'permission_prompt_needed' };
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

        // Phase A (P1-2): 附件失败累积，不再 console.warn 了事。
        // 坏 base64 / 无有效二进制 / 写文件抛错都算失败，决定 ok 与 partial 记录。
        const failedAssets: Array<{ file: string; error: string }> = [];
        if (Array.isArray(assets) && assets.length > 0) {
            for (const asset of assets) {
                if (asset && asset.fileName) {
                    let fileData: Uint8Array | null = null;
                    if (asset.base64 && typeof asset.base64 === 'string') {
                        try {
                            fileData = base64ToUint8Array(asset.base64);
                        } catch (b64Err) {
                            const msg = b64Err instanceof Error ? b64Err.message : String(b64Err);
                            console.warn('[Background:liveSave] Failed to decode base64 for asset:', asset.fileName, b64Err);
                            failedAssets.push({ file: asset.fileName, error: `base64 decode failed: ${msg}` });
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
                        failedAssets.push({ file: asset.fileName, error: 'no valid binary data' });
                        continue;
                    }

                    try {
                        await writer.writeFile(asset.subDir || 'assets', asset.fileName, fileData);
                    } catch (assetErr) {
                        const msg = assetErr instanceof Error ? assetErr.message : String(assetErr);
                        console.warn('[Background:liveSave] Failed to write asset:', asset.fileName, assetErr);
                        failedAssets.push({ file: asset.fileName, error: msg });
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

        // Mark conversation as exported in exportedIds SSoT.
        // Phase A (P1-2): 主 md 成功即写记录；附件有失败则标 partial（与导出管线
        // sessionRecovery 的 partial 惯例对齐），保证下次增量不跳过、可重试。
        try {
            const slot = accountSlot || 'u0';
            if (StorageService?.saveExportRecord) {
                const chatTs = getEffectiveTimestamp(chat);
                await StorageService.saveExportRecord(slot, nid, {
                    exportedAt: new Date(now).toISOString(),
                    title: safeTitle,
                    format: 'markdown',
                    ...(chatTs > 0 ? { chatTime: chatTs } : {}),
                    ...(failedAssets.length > 0 ? { status: 'partial', hasFailedAssets: true } : {})
                });
            }
        } catch (e) {
            console.warn('[Background:liveSave] Failed to mark conversation as exported:', e);
        }

        return { ok: failedAssets.length === 0, failedAssets, handleName: handle.name, targetFile };
    } catch (err: any) {
        console.warn('[Background:liveSave] liveSaveViaHandle error:', err);
        const isNotFound = err?.name === 'NotFoundError' || err?.message?.includes('could not be found') || err?.message?.includes('NotFoundError');
        if (isNotFound) {
            await clearStoredDirHandle();
            await markDirDeletedInConfig();
            return { ok: false, error: 'dir_not_found', details: err?.message };
        }
        if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') {
            console.info('[Background:liveSave] liveSaveViaHandle caught permission error, prompt needed');
            await setLiveConfig({ dirError: 'permission_prompt_needed' });
            return { ok: false, error: 'permission_prompt_needed' };
        }
        return { ok: false, error: err?.message || String(err) };
    }
}
