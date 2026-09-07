// src/core/exporter/fsWriter.js - FileSystem Access API Writer
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.FsWriter = factory();
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    function getUtils() {
        if (typeof GeminiUtils !== 'undefined' && GeminiUtils) return GeminiUtils;
        if (typeof globalThis !== 'undefined' && globalThis.GeminiUtils) return globalThis.GeminiUtils;
        if (typeof require !== 'undefined') {
            try { return require('../../utils/utils.js'); } catch { /* intentional: require fallback in browser context */ }
        }
        return null;
    }

    function sanitizeFileName(name, fallback = 'untitled') {
        const u = getUtils();
        if (u && u.sanitizeFileName) {
            return u.sanitizeFileName(name, fallback);
        }
        return (name || fallback).trim() || fallback;
    }

    function sanitizeRelativePath(p, defaultName = 'file') {
        const u = getUtils();
        if (u && u.sanitizeRelativePath) {
            return u.sanitizeRelativePath(p, defaultName);
        }
        return p.split(/[/\\]/).map(seg => {
            if (!seg || seg === '.' || seg === '..') return '_';
            return sanitizeFileName(seg.replace(/\.\./g, '_'), defaultName);
        }).filter(Boolean).join('/');
    }

    async function ensureSubDir(root, subPath) {
        let cur = root;
        const cleanSubPath = sanitizeRelativePath(subPath, 'dir');
        const parts = cleanSubPath.split('/').filter(Boolean);
        for (let p of parts) {
            if (!p || p === '.' || p === '..') continue;
            cur = await cur.getDirectoryHandle(p, { create: true });
        }
        return cur;
    }

    class FsWriter {
        constructor(dirHandle, folderName = 'gemini_export') {
            if (!dirHandle) throw new Error('Directory handle is required for FsWriter');
            this.rootDirHandle = dirHandle;
            this.folderName = folderName;
            this.batchDirHandle = null;
        }

        async init() {
            if (this.rootDirHandle.queryPermission) {
                const perm = await this.rootDirHandle.queryPermission({ mode: 'readwrite' });
                if (perm !== 'granted') {
                    const req = this.rootDirHandle.requestPermission ? await this.rootDirHandle.requestPermission({ mode: 'readwrite' }) : perm;
                    if (req !== 'granted') throw new Error('Directory permission not granted: ' + req);
                }
            }
            if (this.rootDirHandle.name === this.folderName) {
                this.batchDirHandle = this.rootDirHandle;
            } else {
                this.batchDirHandle = await this.rootDirHandle.getDirectoryHandle(this.folderName, { create: true });
            }
            return this.batchDirHandle;
        }

        async writeFile(subDirPath, fileName, content) {
            let actualSubDir = subDirPath;
            let actualFileName = fileName;
            let actualContent = content;
            if (arguments.length === 2) {
                actualContent = fileName;
                const clean = sanitizeRelativePath(subDirPath, 'file');
                const lastSlash = clean.lastIndexOf('/');
                if (lastSlash !== -1) {
                    actualSubDir = clean.slice(0, lastSlash);
                    actualFileName = clean.slice(lastSlash + 1);
                } else {
                    actualSubDir = '';
                    actualFileName = clean;
                }
            }
            if (!this.batchDirHandle) await this.init();
            const targetDir = actualSubDir ? await ensureSubDir(this.batchDirHandle, actualSubDir) : this.batchDirHandle;
            const cleanName = sanitizeFileName(actualFileName, 'file');
            const fileHandle = await targetDir.getFileHandle(cleanName, { create: true });
            const writable = await fileHandle.createWritable();
            try {
                await writable.write(actualContent);
            } finally {
                await writable.close();
            }
        }
    }

    return {
        FsWriter,
        ensureSubDir,
        sanitizeFileName,
        sanitizeRelativePath
    };
}));
