// src/core/exporter/fsWriter.js - FileSystem Access API Writer
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.FsWriter = factory();
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    function sanitizeFileName(name, fallback = 'untitled') {
        if (typeof GeminiUtils !== 'undefined' && GeminiUtils.sanitizeFileName) {
            return GeminiUtils.sanitizeFileName(name, fallback);
        }
        return (name || fallback).trim() || fallback;
    }

    async function ensureSubDir(root, subPath) {
        let cur = root;
        const parts = subPath.split('/').filter(Boolean).filter(p => p !== '.' && p !== '..').map(p => sanitizeFileName(p, 'dir'));
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
            if (!this.batchDirHandle) await this.init();
            const targetDir = subDirPath ? await ensureSubDir(this.batchDirHandle, subDirPath) : this.batchDirHandle;
            const cleanName = sanitizeFileName(fileName, 'file');
            const fileHandle = await targetDir.getFileHandle(cleanName, { create: true });
            const writable = await fileHandle.createWritable();
            try {
                await writable.write(content);
            } finally {
                await writable.close();
            }
        }
    }

    return {
        FsWriter,
        ensureSubDir,
        sanitizeFileName
    };
}));
