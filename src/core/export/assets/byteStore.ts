/**
 * src/core/export/assets/byteStore.ts
 * In-memory byte store for inline assets decoded during normalize.
 *
 * PdfExporter.run() calls normalizeGeminiConversation in the same JS context
 * that later resolves asset bytes, so a session-scoped in-memory store is
 * sufficient -- no persistence or cross-context plumbing. Keys are
 * content-addressed storageRefs, so storing the same bytes twice is harmless.
 *
 * API freeze note: the asset resolver track reads bytes through these
 * functions. Do not rename or retype them without coordinating with it.
 */

const store = new Map<string, Uint8Array>();

/** Record the decoded bytes of an inline asset under its storageRef. */
export function putInlineAssetBytes(storageRef: string, bytes: Uint8Array): void {
    store.set(storageRef, bytes);
}

/** Previously stored bytes for a storageRef, or undefined when absent. */
export function getInlineAssetBytes(storageRef: string): Uint8Array | undefined {
    return store.get(storageRef);
}

/** True when bytes were previously stored for this storageRef. */
export function hasInlineAssetBytes(storageRef: string): boolean {
    return store.has(storageRef);
}

/** Drop all stored bytes. Primarily for test isolation. */
export function clearInlineAssetBytes(): void {
    store.clear();
}
