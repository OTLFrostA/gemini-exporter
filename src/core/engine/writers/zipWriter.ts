// src/core/engine/writers/zipWriter.ts - JSZip Packaging Writer

import type { IExportWriter } from './writerInterface.js';
import { sanitizeRelativePath } from '../../utils/utils.js';

export interface ZipWriterClass {
    new (folderName?: string): ZipWriter;
    ZipWriter: typeof ZipWriter;
}

declare global {
    var ZipWriter: ZipWriterClass;
}

class ZipWriter implements IExportWriter {
    zip: any;
    folder: any;
    totalBytes: number;
    MAX_SAFE_ZIP_BYTES: number;

    static ZipWriter = ZipWriter;

    constructor(folderName: string = 'gemini_export') {
        const JSZipLib = (typeof (globalThis as any).JSZip !== 'undefined' ? (globalThis as any).JSZip : null)
            || (typeof self !== 'undefined' ? (self as any).JSZip : null)
            || (typeof require !== 'undefined' ? (function() { try { return require('jszip'); } catch { return null; } })() : null);
        if (!JSZipLib) {
            throw new Error('JSZip library is not available');
        }
        this.zip = new JSZipLib();
        this.folder = this.zip.folder(folderName);
        this.totalBytes = 0;
        this.MAX_SAFE_ZIP_BYTES = 500 * 1024 * 1024; // 500MB safe memory warning threshold
    }

    sanitizePath(p?: string | null): string {
        if (!p) return '';
        return sanitizeRelativePath(p, 'file');
    }

    writeFile(pathOrSubDir: string, contentOrFileName?: any, optionsOrContent?: any): string {
        let cleanPath: string;
        let content: any;
        let options: any = {};

        if (arguments.length === 3 && typeof contentOrFileName === 'string') {
            const subDir = pathOrSubDir ? `${pathOrSubDir}/` : '';
            cleanPath = this.sanitizePath(`${subDir}${contentOrFileName}`);
            content = optionsOrContent;
        } else {
            cleanPath = this.sanitizePath(pathOrSubDir);
            content = contentOrFileName;
            options = optionsOrContent || {};
        }

        if (content) {
            if (typeof content === 'string') {
                this.totalBytes += content.length * (options && options.base64 ? 0.75 : 1);
            } else if (content.byteLength) {
                this.totalBytes += content.byteLength;
            } else if (content.length) {
                this.totalBytes += content.length;
            }
        }
        // Guard against memory exhaustion when building large ZIP archives
        if (this.totalBytes > this.MAX_SAFE_ZIP_BYTES) {
            throw new Error(`[ZipWriter] 未压缩内容超过 ${(this.MAX_SAFE_ZIP_BYTES / 1024 / 1024).toFixed(0)}MB 上限，已中止导出以防内存溢出。请减少所选会话数量后重试。`);
        }
        this.folder.file(cleanPath, content, options);
        return cleanPath;
    }

    getTotalBytes(): number {
        return this.totalBytes;
    }

    async generateBlob(onUpdate?: (pct: number) => void): Promise<Blob> {
        return await this.zip.generateAsync({
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
        }, (meta: any) => {
            if (onUpdate && typeof onUpdate === 'function') {
                onUpdate(meta.percent);
            }
        });
    }
}

if (typeof globalThis !== 'undefined') (globalThis as any).ZipWriter = ZipWriter;
if (typeof module === 'object' && module.exports) module.exports = ZipWriter;

export { ZipWriter };
export default ZipWriter;

