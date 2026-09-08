// src/core/engine/writers/writerInterface.js - Unified export writer contract and factory (Phase 2c)
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WriterInterface = factory();
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    /**
     * Check whether an object conforms to the Writer interface.
     * @param {Object} obj
     * @returns {boolean}
     */
    function isWriter(obj) {
        return Boolean(obj && typeof obj.writeFile === 'function');
    }

    /**
     * Factory function to create a writer instance.
     * @param {'zip'|'fs'} type
     * @param {Object} options
     * @returns {Object} Writer instance
     */
    function createWriter(type, options = {}) {
        if (type === 'zip') {
            const ZipWriterClass = (typeof ZipWriter !== 'undefined' && ZipWriter.ZipWriter)
                || (typeof ZipWriter === 'function' ? ZipWriter : null)
                || (typeof require !== 'undefined' ? (function() { try { return require('./zipWriter.js'); } catch { return null; } })() : null);
            if (ZipWriterClass) {
                const Cls = ZipWriterClass.ZipWriter || ZipWriterClass;
                return new Cls(options.folderName || 'gemini_export');
            }
            throw new Error('ZipWriter is not available');
        }
        if (type === 'fs') {
            const FsWriterModule = (typeof FsWriter !== 'undefined' ? FsWriter : null)
                || (typeof require !== 'undefined' ? (function() { try { return require('./fsWriter.js'); } catch { return null; } })() : null);
            const FsWriterClass = FsWriterModule ? (FsWriterModule.FsWriter || FsWriterModule) : null;
            if (FsWriterClass) {
                return new FsWriterClass(options.dirHandle, options.folderName || 'gemini_export');
            }
            throw new Error('FsWriter is not available');
        }
        throw new Error(`Unsupported writer type: ${type}`);
    }

    return {
        isWriter,
        createWriter
    };
}));
