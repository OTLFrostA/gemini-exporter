import { readOne, putOne, deleteOne } from './idb.js';

export function getDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
    return readOne('directoryHandles', 'default');
}
export function setDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
    return putOne('directoryHandles', handle, 'default');
}
export function clearDirectoryHandle(): Promise<void> {
    return deleteOne('directoryHandles', 'default');
}
