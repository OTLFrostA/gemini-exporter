// src/core/engine/export/exportWriter.ts - Export output target setup & ZIP packaging.
// Split out of exportOrchestrator.ts (P1: god-file decomposition).
// Responsibility: initialise the ZIP-or-directory writer for a run
// (writeFileDirect), and package + trigger the final download.
// The orchestrator is represented only by a tiny host facade so this module
// never imports the orchestrator (no cycles).

import type { ExportOptions } from './exportTypes.js';
import { ExportPipelineError } from '../../../types/errors.js';
import { ensureSubDir as fsEnsureSubDir } from '../writers/fsWriter.js';
import { sanitizeRelativePath as utilsSanitizeRelativePath } from '../../utils/utils.js';

export interface ExportWriterHost {
    readonly aborted: boolean;
    abort(): void;
}

export interface ExportWriter {
    zip: any;
    folder: any;
    zipWriter: any;
    batchDirHandle: any;
    fsWriter: any;
    writeFileDirect: (localName: string, data: any) => Promise<boolean>;
}

async function ensureSubDir(root: any, subPath: string): Promise<any> {
    const fn = (globalThis as any).FsWriter?.ensureSubDir || fsEnsureSubDir;
    return await fn(root, subPath);
}

const sanitizeZipPathLocal = (p?: string | null): string =>
    ((globalThis as any).GeminiUtils?.sanitizeRelativePath || utilsSanitizeRelativePath)(p, 'file');

const getErrorMessageLocal = (e: unknown): string => {
    if (e instanceof Error) return e.message;
    return String((e as any)?.message || e || 'unknown error');
};

/**
 * Initialise the per-run writer. Throws when the output target cannot be
 * created (P1: no silent fallback to the root dirHandle).
 */
export async function initExportWriter(
    options: ExportOptions,
    host: ExportWriterHost,
    onLog: (msg: string, level?: string) => void
): Promise<ExportWriter> {
    const { useZip = true, dirHandle = null } = options;
    const exportFolderName = 'gemini_export';
    let batchDirHandle: any = null;
    let zip: any = null;
    let folder: any = null;
    let zipWriter: any = null;
    let fsWriter: any = null;

    if (useZip) {
        const ZipWriterModule = (globalThis as any).ZipWriter;
        const ZipWriterClass = (typeof ZipWriterModule !== 'undefined' && ZipWriterModule.ZipWriter)
            ? ZipWriterModule.ZipWriter
            : (typeof ZipWriterModule === 'function' ? ZipWriterModule : null);
        if (ZipWriterClass) {
            zipWriter = new ZipWriterClass(exportFolderName);
            zip = zipWriter.zip;
            folder = zipWriter.folder;
        } else {
            const JSZip = (globalThis as any).JSZip;
            if (typeof JSZip === 'undefined') throw new Error('JSZip library not found');
            zip = new JSZip();
            folder = zip.folder(exportFolderName);
        }
    } else {
        if (!dirHandle) throw new Error('Directory handle not provided');
        try {
            const FsWriterModule = (globalThis as any).FsWriter;
            const FsWriterClass = (typeof FsWriterModule !== 'undefined' && FsWriterModule.FsWriter)
                ? FsWriterModule.FsWriter
                : (typeof FsWriterModule === 'function' ? FsWriterModule : null);
            if (FsWriterClass) {
                fsWriter = new FsWriterClass(dirHandle, exportFolderName);
                batchDirHandle = await fsWriter.init();
            } else {
                if (dirHandle.queryPermission) {
                    const perm = await dirHandle.queryPermission({ mode: 'readwrite' });
                    if (perm !== 'granted') {
                        const req = dirHandle.requestPermission ? await dirHandle.requestPermission({ mode: 'readwrite' }) : perm;
                        if (req !== 'granted') throw new Error('Directory permission not granted: ' + req);
                    }
                }
                if (dirHandle.name === exportFolderName) {
                    batchDirHandle = dirHandle;
                } else {
                    batchDirHandle = await dirHandle.getDirectoryHandle(exportFolderName, { create: true });
                }
            }
        } catch (e: unknown) {
            const errMsg = getErrorMessageLocal(e);
            onLog(`创建子文件夹失败: ${errMsg}`, 'warn');
            const errObj = e as any;
            const isPermissionRevoked = errObj?.name === 'NotAllowedError' || /permission|not\s*allowed/i.test(errMsg);
            if (isPermissionRevoked) {
                onLog('目录句柄权限失效，请重新授权文件夹', 'warn');
            }
            throw new ExportPipelineError(`无法创建导出子目录 "${exportFolderName}": ${errMsg}`, undefined, 'write', isPermissionRevoked);
        }
    }

    const writeFileDirect = async (localName: string, data: any): Promise<boolean> => {
        if (host.aborted) return false;
        try {
            const cleanPath = sanitizeZipPathLocal(localName);
            if (fsWriter) {
                await fsWriter.writeFile(cleanPath, data);
                return true;
            }
            const parts = cleanPath.split('/').filter(Boolean);
            let fileName = parts.pop() || 'file';
            const dirPath = parts.join('/');
            let targetDir = batchDirHandle;
            if (dirPath) {
                targetDir = await ensureSubDir(batchDirHandle, dirPath);
            }
            const fh = await targetDir.getFileHandle(fileName, { create: true });
            const wr = await fh.createWritable();
            await wr.write(data);
            await wr.close();
            return true;
        } catch (e: unknown) {
            const errMsg = getErrorMessageLocal(e);
            const errObj = e as any;
            const isPermissionRevoked = errObj?.name === 'NotAllowedError'
                || /permission|not\s*allowed/i.test(errMsg);
            if (isPermissionRevoked) {
                const I18n = (globalThis as any).I18n;
                const permMsg = typeof I18n !== 'undefined'
                    ? I18n.t('fsPermissionRevoked')
                    : '文件夹访问权限已失效或被撤销，导出已中止';
                onLog(permMsg, 'error');
                host.abort();
                return false;
            }
            onLog(`保存文件失败 (${localName}): ${errMsg}`, 'error');
            return false;
        }
    };

    return { zip, folder, zipWriter, batchDirHandle, fsWriter, writeFileDirect };
}

/**
 * Package the ZIP and trigger the download (or hand the blob to the caller's
 * downloadHandler).
 */
export async function packageAndDownload(
    zipWriterOrZip: any,
    payloadIds: any[],
    downloadedAssets: number,
    totalAssets: number,
    options: ExportOptions,
    onLog: (msg: string, level?: string) => void,
    onProgress: (progress: any) => void
): Promise<void> {
    const zipFileName = `gemini_export_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.zip`;
    const I18n = (globalThis as any).I18n;
    onLog(typeof I18n !== 'undefined' ? I18n.t('logPackagingZip') : '正在打包 ZIP 压缩包…', 'info');
    const onUpdate = (percent: number) => {
        onProgress({
            current: payloadIds.length,
            total: payloadIds.length,
            pct: Math.floor(percent),
            title: typeof I18n !== 'undefined' ? I18n.t('progPackagingZip', Math.floor(percent)) : `打包 ZIP 中 (${Math.floor(percent)}%)`,
            assetsDownloaded: downloadedAssets,
            assetsTotal: totalAssets
        });
    };
    const blob = (zipWriterOrZip && typeof zipWriterOrZip.generateBlob === 'function')
        ? await zipWriterOrZip.generateBlob(onUpdate)
        : await zipWriterOrZip.generateAsync({ type: 'blob' }, (metadata: any) => onUpdate(metadata.percent));

    if (options.downloadHandler && typeof options.downloadHandler === 'function') {
        await options.downloadHandler(blob, zipFileName);
    } else if (typeof document !== 'undefined' && document.createElement && document.body) {
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = zipFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
    }
}

export default { initExportWriter, packageAndDownload };
