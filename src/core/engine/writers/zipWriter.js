// src/core/exporter/zipWriter.js - JSZip Packaging Writer
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ZipWriter = factory();
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    class ZipWriter {
        constructor(folderName = 'gemini_export') {
            const JSZipLib = (typeof JSZip !== 'undefined' ? JSZip : null)
                || (typeof globalThis !== 'undefined' ? globalThis.JSZip : null)
                || (typeof self !== 'undefined' ? self.JSZip : null)
                || (typeof require !== 'undefined' ? (function() { try { return require('jszip'); } catch { return null; } })() : null);
            if (!JSZipLib) {
                throw new Error('JSZip library is not available');
            }
            this.zip = new JSZipLib();
            this.folder = this.zip.folder(folderName);
            this.totalBytes = 0;
            this.MAX_SAFE_ZIP_BYTES = 500 * 1024 * 1024; // 500MB safe memory warning threshold
        }

        sanitizePath(p) {
            if (!p) return p;
            if (typeof GeminiUtils !== 'undefined' && GeminiUtils.sanitizeRelativePath) {
                return GeminiUtils.sanitizeRelativePath(p, 'file');
            }
            if (typeof globalThis !== 'undefined' && globalThis.GeminiUtils?.sanitizeRelativePath) {
                return globalThis.GeminiUtils.sanitizeRelativePath(p, 'file');
            }
            if (typeof require !== 'undefined') {
                try {
                    const u = require('../../utils/utils.js');
                    if (u && u.sanitizeRelativePath) return u.sanitizeRelativePath(p, 'file');
                } catch { /* intentional: require fallback in browser context */ }
            }
            throw new Error('GeminiUtils.sanitizeRelativePath unavailable — check module load order');
        }

        writeFile(relativePath, content, options = {}) {
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

        getTotalBytes() {
            return this.totalBytes;
        }

        async generateBlob(onUpdate) {
            return await this.zip.generateAsync({
                type: 'blob',
                compression: 'DEFLATE',
                compressionOptions: { level: 6 }
            }, (meta) => {
                if (onUpdate && typeof onUpdate === 'function') {
                    onUpdate(meta.percent);
                }
            });
        }
    }

    ZipWriter.ZipWriter = ZipWriter;
    return ZipWriter;
}));
