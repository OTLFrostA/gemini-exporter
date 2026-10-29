export type WriteFileContent = string | Uint8Array | ArrayBuffer | Blob;

export interface WriteFileOptions {
    base64?: boolean;
    compression?: 'STORE' | 'DEFLATE';
    compressionOptions?: { level?: number };
}

export interface IExportWriter {
    writeFile(relativePath: string, content: WriteFileContent, options?: WriteFileOptions): Promise<string> | string;
    generateBlob?(onUpdate?: (pct: number) => void): Promise<Blob>;
    init?(): Promise<FileSystemDirectoryHandle>;
}
