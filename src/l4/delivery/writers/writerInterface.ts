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
    init?(): Promise<FileSystemDirectoryHandle>;
}
