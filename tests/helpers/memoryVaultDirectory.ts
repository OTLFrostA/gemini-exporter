import { beforeEach, afterEach } from 'node:test';
import type { DirectoryHandle } from '../../src/shared/types/directoryHandle.js';

const handles = new WeakSet<object>();
const clone = globalThis.structuredClone;
beforeEach(() => {
    globalThis.structuredClone = (value, options) => value !== null && typeof value === 'object' && handles.has(value)
        ? value : clone(value, options);
});
afterEach(() => { globalThis.structuredClone = clone; });

interface MemoryDirNode {
    handle: DirectoryHandle;
    files: Map<string, Uint8Array<ArrayBuffer>>;
    subdirs: Map<string, MemoryDirNode>;
}

export function createMemoryDirectoryHandle(name = 'MockEncryptedFolder', initialPerm: PermissionState = 'granted') {
    let permission: PermissionState = initialPerm;
    const files = new Map<string, Uint8Array<ArrayBuffer>>();
    const subdirs = new Map<string, MemoryDirNode>();

    function makeFileHandle(fileName: string, store: Map<string, Uint8Array<ArrayBuffer>>): FileSystemFileHandle {
        return {
            kind: 'file',
            name: fileName,
            isSameEntry: async () => false,
            async getFile() {
                const bytes = store.get(fileName);
                if (!bytes) {
                    const err = new Error(`File not found: ${fileName}`);
                    err.name = 'NotFoundError';
                    throw err;
                }
                return new File([bytes], fileName);
            },
            async createWritable() {
                let staged = new Uint8Array(0);
                return {
                    async write(data: BufferSource | Blob | string) {
                        if (data instanceof Uint8Array) {
                            const copy = new Uint8Array(data.byteLength);
                            copy.set(data);
                            staged = copy;
                        } else if (typeof data === 'string') {
                            staged = new Uint8Array(new TextEncoder().encode(data));
                        }
                    },
                    async close() {
                        store.set(fileName, staged);
                    },
                    async abort() {},
                    async seek() {},
                    async truncate() {},
                } as unknown as FileSystemWritableFileStream;
            },
        } as FileSystemFileHandle;
    }

    function makeDir(dirName: string, fileMap: Map<string, Uint8Array<ArrayBuffer>>, dirMap: Map<string, MemoryDirNode>): MemoryDirNode {
        const proto = {
            isSameEntry: async (other: FileSystemHandle) => Object.is(other, handle),
            queryPermission: async () => permission,
            requestPermission: async () => permission,
            async getFileHandle(fileName: string, options?: FileSystemGetFileOptions) {
                if (!options?.create && !fileMap.has(fileName)) {
                    const err = new Error(`File not found: ${fileName}`);
                    err.name = 'NotFoundError';
                    throw err;
                }
                if (options?.create && !fileMap.has(fileName)) {
                    fileMap.set(fileName, new Uint8Array(0));
                }
                return makeFileHandle(fileName, fileMap);
            },
            async getDirectoryHandle(childName: string, options?: FileSystemGetDirectoryOptions) {
                let child = dirMap.get(childName);
                if (!child) {
                    if (!options?.create) {
                        const err = new Error(`Directory not found: ${childName}`);
                        err.name = 'NotFoundError';
                        throw err;
                    }
                    child = makeDir(childName, new Map(), new Map());
                    dirMap.set(childName, child);
                }
                return child.handle;
            },
            async removeEntry(entryName: string) {
                fileMap.delete(entryName);
                dirMap.delete(entryName);
            },
        };
        const handle = Object.assign(Object.create(proto) as Record<string, unknown>, {
            kind: 'directory' as const,
            name: dirName,
        });
        handles.add(handle);
        return { handle: handle as unknown as DirectoryHandle, files: fileMap, subdirs: dirMap };
    }

    const root = makeDir(name, files, subdirs);
    return {
        handle: root.handle,
        files,
        subdirs,
        setPermission(next: PermissionState) { permission = next; },
    };
}
