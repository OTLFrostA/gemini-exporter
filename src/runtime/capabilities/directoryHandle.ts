/** Browser directory capability shared by filesystem writers and UI controllers. */
export interface DirectoryHandle extends FileSystemDirectoryHandle {
    queryPermission(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
    requestPermission(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
}
