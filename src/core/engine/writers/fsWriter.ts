// src/core/engine/writers/fsWriter.ts - FileSystem Access API Writer

import type { IExportWriter } from './writerInterface.js';
import { sanitizeFileName as utilsSanitizeFileName, sanitizeRelativePath as utilsSanitizeRelativePath } from '../../utils/utils.js';
import { DEFAULT_EXPORT_FOLDER_NAME } from '../../utils/constants.js';

export interface FsWriterModule {
    FsWriter: typeof FsWriter;
    ensureSubDir: typeof ensureSubDir;
    sanitizeFileName: typeof sanitizeFileName;
    sanitizeRelativePath: typeof sanitizeRelativePath;
}

declare global {
    var FsWriter: FsWriterModule;
}

function sanitizeFileName(name?: string | null, fallback: string = 'untitled'): string {
    return utilsSanitizeFileName(name, fallback);
}

function sanitizeRelativePath(p?: string | null, defaultName: string = 'file'): string {
    return utilsSanitizeRelativePath(p, defaultName);
}


async function ensureSubDir(root: any, subPath: string): Promise<any> {
    let cur = root;
    const cleanSubPath = sanitizeRelativePath(subPath, 'dir');
    const parts = cleanSubPath.split('/').filter(Boolean);
    for (let p of parts) {
        if (!p || p === '.' || p === '..') continue;
        cur = await cur.getDirectoryHandle(p, { create: true });
    }
    return cur;
}

function isWriteOptions(val: any): boolean {
    if (!val || typeof val !== 'object' || Array.isArray(val)) return false;
    if (typeof Uint8Array !== 'undefined' && val instanceof Uint8Array) return false;
    if (typeof ArrayBuffer !== 'undefined' && (val instanceof ArrayBuffer || ArrayBuffer.isView(val))) return false;
    if (typeof Blob !== 'undefined' && val instanceof Blob) return false;
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(val)) return false;
    return 'base64' in val || 'compression' in val || 'compressionOptions' in val || 'binary' in val;
}

class FsWriter implements IExportWriter {
    rootDirHandle: any;
    folderName: string;
    batchDirHandle: any;
    // Serialize concurrent writes targeting the same target path
    __writeChains: Map<string, Promise<void>>;

    static FsWriter = FsWriter;
    static ensureSubDir = ensureSubDir;
    static sanitizeFileName = sanitizeFileName;
    static sanitizeRelativePath = sanitizeRelativePath;

    constructor(dirHandle: any, folderName: string = DEFAULT_EXPORT_FOLDER_NAME) {
        if (!dirHandle) throw new Error('Directory handle is required for FsWriter');
        this.rootDirHandle = dirHandle;
        this.folderName = folderName;
        this.batchDirHandle = null;
        this.__writeChains = new Map();
    }

    async init(): Promise<any> {
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

    async writeFile(pathOrSubDir: string, contentOrFileName?: any, optionsOrContent?: any): Promise<string> {
        let actualSubDir = '';
        let actualFileName = '';
        let actualContent: any;
        let options: any = {};

        if (arguments.length === 3 && optionsOrContent !== undefined && !isWriteOptions(optionsOrContent)) {
            // Pattern 2: (subDirPath, fileName, content)
            actualSubDir = pathOrSubDir;
            actualFileName = contentOrFileName;
            actualContent = optionsOrContent;
        } else {
            // Pattern 1: (relativePath, content, options?)
            const clean = sanitizeRelativePath(pathOrSubDir, 'file');
            const lastSlash = clean.lastIndexOf('/');
            if (lastSlash !== -1) {
                actualSubDir = clean.slice(0, lastSlash);
                actualFileName = clean.slice(lastSlash + 1);
            } else {
                actualSubDir = '';
                actualFileName = clean;
            }
            actualContent = contentOrFileName;
            options = optionsOrContent || {};
        }

        if (options && options.base64 && typeof actualContent === 'string') {
            const binStr = atob(actualContent);
            const len = binStr.length;
            const b = new Uint8Array(len);
            for (let k = 0; k < len; k++) b[k] = binStr.charCodeAt(k);
            actualContent = b;
        }

        if (!this.batchDirHandle) await this.init();
        const targetDir = actualSubDir ? await ensureSubDir(this.batchDirHandle, actualSubDir) : this.batchDirHandle;
        const cleanName = sanitizeFileName(actualFileName, 'file');

        if (actualContent === null || actualContent === undefined) {
            throw new Error(`[FsWriter] Cannot write null or undefined content to ${cleanName}`);
        }
        const isBlob = typeof Blob !== 'undefined' && actualContent instanceof Blob;
        const isBufferSource = (typeof ArrayBuffer !== 'undefined' && actualContent instanceof ArrayBuffer) ||
            (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(actualContent));
        if (typeof actualContent === 'object' && !isBlob && !isBufferSource) {
            throw new Error(`[FsWriter] Invalid content object passed to writeFile for ${cleanName}`);
        }

        // Serialize concurrent writes targeting the same path
        const chainKey = (actualSubDir ? actualSubDir + '/' : '') + cleanName;
        const prev = this.__writeChains.get(chainKey) || Promise.resolve();
        let releaseGate!: () => void;
        const gate = new Promise<void>((res) => { releaseGate = res; });
        this.__writeChains.set(chainKey, gate);
        await prev;
        try {
            const fileHandle = await targetDir.getFileHandle(cleanName, { create: true });
            const writable = await fileHandle.createWritable();
            try {
                await writable.write(actualContent);
                await writable.close();
            } catch (writeErr) {
                if (typeof (writable as any)?.abort === 'function') {
                    try { await (writable as any).abort(); } catch (_) {}
                }
                throw writeErr;
            }
        } finally {
            releaseGate();
            if (this.__writeChains.get(chainKey) === gate) {
                this.__writeChains.delete(chainKey);
            }
        }
        return cleanName;
    }
}

export {
    FsWriter,
    ensureSubDir,
    sanitizeFileName,
    sanitizeRelativePath
};

export const FsWriterModule: FsWriterModule = {
    FsWriter,
    ensureSubDir,
    sanitizeFileName,
    sanitizeRelativePath
};


export default FsWriterModule;

