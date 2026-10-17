import type { DirectoryHandle } from './directoryHandle.js';

export type WriteFileContent = string | Uint8Array | ArrayBuffer | Blob;

/** Fields consumed by writers; additional JSZip file options pass through unchanged. */
export interface WriteFileOptions {
    base64?: boolean;
    compression?: 'STORE' | 'DEFLATE';
    compressionOptions?: { level?: number };
    [key: string]: unknown;
}

export interface IExportWriter {
    /** Resolves to the actual relative path accepted by the writer. */
    writeFile(relativePath: string, content: WriteFileContent, options?: WriteFileOptions): Promise<string> | string;
    generateBlob?(onUpdate?: (pct: number) => void): Promise<Blob>;
    generateAsync?(options: { type: 'blob' }, onUpdate?: (metadata: { percent: number }) => void): Promise<Blob>;
    close?(): Promise<void>;
    getTotalBytes?(): number;
    init?(): Promise<DirectoryHandle>;
    [key: string]: any;
}

export interface WriterFactoryOptions {
    dirHandle?: ConstructorParameters<typeof FsWriter>[0];
}

export interface WriterInterfaceModule {
    isWriter: (obj: any) => boolean;
    createWriter: (type: 'zip' | 'fs' | string, options?: WriterFactoryOptions) => IExportWriter;
}

import { ZipWriter } from './zipWriter.js';
import { FsWriter } from './fsWriter.js';



export function isWriter(obj: any): boolean {
    return Boolean(obj && typeof obj.writeFile === 'function');
}

export function createWriter(type: 'zip' | 'fs' | string, options: WriterFactoryOptions = {}): IExportWriter {
    if (type === 'zip') {
        const Cls = ZipWriter?.ZipWriter || ZipWriter;
        return new Cls();
    }
    if (type === 'fs') {
        const Cls = FsWriter?.FsWriter || FsWriter;
        return new Cls(options.dirHandle);
    }
    throw new Error(`Unsupported writer type: ${type}`);
}

export const WriterInterface: WriterInterfaceModule = {
    isWriter,
    createWriter
};

export default WriterInterface;
