/**
 * src/core/export/assets/byteStore.ts
 * Per-run in-memory byte store for inline assets decoded during normalize.
 *
 * Session ownership: each normalizeGeminiConversation() call creates its own
 * InlineByteStore via createInlineByteStore() and returns it on the result.
 * Bytes decoded for one conversation can therefore never leak into (or linger
 * past) the normalization of another. This replaces the old module-global
 * singleton, which had exactly that defect: consecutive normalize calls in
 * one JS context shared one store and bytes accumulated across sessions.
 */

export interface InlineByteStore {
    /** Record the decoded bytes of an inline asset under its storageRef. */
    put(storageRef: string, bytes: Uint8Array): void;
    /** Previously stored bytes for a storageRef, or undefined when absent. */
    get(storageRef: string): Uint8Array | undefined;
    /** True when bytes were previously stored for a storageRef. */
    has(storageRef: string): boolean;
    /** Drop all stored bytes. */
    clear(): void;
    /** Number of stored entries. */
    readonly entryCount: number;
}

/** Create a fresh, run-scoped byte store. Never share one across runs. */
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
