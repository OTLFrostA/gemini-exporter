// src/core/exporter/zipWriter.js - JSZip Packaging Writer
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ZipWriter = factory();
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    class ZipWriter {
        constructor(folderName = 'gemini_export') {
            if (typeof JSZip === 'undefined') {
                throw new Error('JSZip library is not available');
            }
            this.zip = new JSZip();
            this.folder = this.zip.folder(folderName);
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
                } catch {}
            }
            return p.split(/[/\\]/).map(seg => {
                if (!seg || seg === '.' || seg === '..') return '_';
                return seg.replace(/\.\./g, '_');
            }).filter(Boolean).join('/');
        }

        writeFile(relativePath, content, options = {}) {
            const cleanPath = this.sanitizePath(relativePath);
            this.folder.file(cleanPath, content, options);
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

    return ZipWriter;
}));
