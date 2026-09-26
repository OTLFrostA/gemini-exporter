export interface InlineByteStore {
    put(storageRef: string, bytes: Uint8Array): void;
    get(storageRef: string): Uint8Array | undefined;
    has(storageRef: string): boolean;
    clear(): void;
    readonly entryCount: number;
}

export function createInlineByteStore(): InlineByteStore {
    const map = new Map<string, Uint8Array>();
    return {
        put(storageRef: string, bytes: Uint8Array): void {
            map.set(storageRef, bytes);
        },
        get(storageRef: string): Uint8Array | undefined {
            return map.get(storageRef);
        },
        has(storageRef: string): boolean {
            return map.has(storageRef);
        },
        clear(): void {
            map.clear();
        },
        get entryCount(): number {
            return map.size;
        },
    };
}
