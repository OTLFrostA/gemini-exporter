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
            const sanitize = (typeof GeminiUtils !== 'undefined' && GeminiUtils.sanitizeFileName)
                ? GeminiUtils.sanitizeFileName
                : (name, fallback) => (name || fallback);
            return p.split('/').map(seg => {
                if (!seg || seg === '.' || seg === '..') return '_';
                return sanitize(seg.replace(/\.\./g, '_'), 'file');
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
