// src/core/engine/writers/writerInterface.ts - Unified export writer contract and factory (Phase 2c)

export interface IExportWriter {
    writeFile(relativePath: string, content: any, options?: any): Promise<string> | string;
    generateBlob?(): Promise<Blob>;
    close?(): Promise<void>;
    getTotalBytes?(): number;
    [key: string]: any;
}

export interface WriterFactoryOptions {
    folderName?: string;
    dirHandle?: any;
    [key: string]: any;
}

export interface WriterInterfaceModule {
    isWriter: (obj: any) => boolean;
    createWriter: (type: 'zip' | 'fs' | string, options?: WriterFactoryOptions) => IExportWriter;
}

declare global {
    var WriterInterface: WriterInterfaceModule;
}

(function(root: any, factory: () => WriterInterfaceModule) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WriterInterface = factory();
}(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function(): WriterInterfaceModule {
    'use strict';

    /**
     * Check whether an object conforms to the Writer interface.
     */
    function isWriter(obj: any): boolean {
        return Boolean(obj && typeof obj.writeFile === 'function');
    }

    /**
     * Factory function to create a writer instance.
     */
    function createWriter(type: 'zip' | 'fs' | string, options: WriterFactoryOptions = {}): IExportWriter {
        if (type === 'zip') {
            const ZipWriterClass = (typeof (globalThis as any).ZipWriter !== 'undefined' && (globalThis as any).ZipWriter.ZipWriter)
                || (typeof (globalThis as any).ZipWriter !== 'undefined' ? (globalThis as any).ZipWriter : null)
                || (typeof require !== 'undefined' ? (function() { try { return require('./zipWriter.js'); } catch { return null; } })() : null);
            if (ZipWriterClass) {
                const Cls = ZipWriterClass.ZipWriter || ZipWriterClass;
                return new Cls(options.folderName || 'gemini_export');
            }
            throw new Error('ZipWriter is not available');
        }
        if (type === 'fs') {
            const FsWriterModule = (typeof (globalThis as any).FsWriter !== 'undefined' ? (globalThis as any).FsWriter : null)
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
