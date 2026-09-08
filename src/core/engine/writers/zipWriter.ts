// src/core/engine/writers/zipWriter.ts - JSZip Packaging Writer

import type { IExportWriter } from './writerInterface.js';

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
        if (typeof GeminiUtils !== 'undefined' && GeminiUtils.sanitizeRelativePath) {
            return GeminiUtils.sanitizeRelativePath(p, 'file');
        }
        if (typeof globalThis !== 'undefined' && (globalThis as any).GeminiUtils?.sanitizeRelativePath) {
            return (globalThis as any).GeminiUtils.sanitizeRelativePath(p, 'file');
        }
        if (typeof require !== 'undefined') {
            try {
                const u = require('../../utils/utils.js');
                if (u && u.sanitizeRelativePath) return u.sanitizeRelativePath(p, 'file');
            } catch { /* intentional: require fallback in browser context */ }
        }
        throw new Error('GeminiUtils.sanitizeRelativePath unavailable — check module load order');
    }

    writeFile(relativePath: string, content: any, options: any = {}): string {
        const cleanPath = this.sanitizePath(relativePath);
        if (content) {
            if (typeof content === 'string') {
                this.totalBytes += content.length * (options && options.base64 ? 0.75 : 1);
            } else if (content.byteLength) {
                this.totalBytes += content.byteLength;
            } else if (content.length) {
                this.totalBytes += content.length;
            }
        }
        if (this.totalBytes > this.MAX_SAFE_ZIP_BYTES) {
            console.warn(`[ZipWriter] Warning: Total uncompressed content exceeds ${(this.MAX_SAFE_ZIP_BYTES / 1024 / 1024).toFixed(0)}MB. May risk tab memory pressure.`);
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

(function(root: any, factory: () => typeof ZipWriter) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ZipWriter = factory();
}(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function(): typeof ZipWriter {
    'use strict';
    return ZipWriter;
}));
