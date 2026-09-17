// src/core/engine/writers/writerInterface.ts - Unified export writer contract and factory (Phase 2c)

export type WriteFileContent = string | Uint8Array | ArrayBuffer | Blob;

export interface IExportWriter {
    writeFile(relativePath: string, content: WriteFileContent, options?: any): Promise<string> | string;
    writeFile(subDirPath: string, fileName: string, content: WriteFileContent): Promise<string> | string;
    generateBlob?(onUpdate?: (pct: number) => void): Promise<Blob>;
    close?(): Promise<void>;
    getTotalBytes?(): number;
    init?(): Promise<any>;
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

import { ZipWriter } from './zipWriter.js';
import { FsWriter } from './fsWriter.js';

/**
 * Check whether an object conforms to the Writer interface.
 */
export function isWriter(obj: any): boolean {
    return Boolean(obj && typeof obj.writeFile === 'function');
}

/**
 * Factory function to create a writer instance.
 */
export function createWriter(type: 'zip' | 'fs' | string, options: WriterFactoryOptions = {}): IExportWriter {
    if (type === 'zip') {
        const Cls = (ZipWriter as any)?.ZipWriter || ZipWriter;
        return new Cls(options.folderName || 'gemini_export');
    }
    if (type === 'fs') {
        const Cls = (FsWriter as any)?.FsWriter || FsWriter;
        return new Cls(options.dirHandle, options.folderName || 'gemini_export');
    }
    throw new Error(`Unsupported writer type: ${type}`);
}

export const WriterInterface: WriterInterfaceModule = {
    isWriter,
    createWriter
};

export default WriterInterface;

