import { readOne, putOne } from './idb.js';

export function getDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
    return readOne('directoryHandles', 'default');
}
export function setDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
    return putOne('directoryHandles', handle, 'default');
}
