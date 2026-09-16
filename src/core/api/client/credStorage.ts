// src/core/api/client/credStorage.ts - Shared credential storage-area resolver.
//
// Previously getCredStorage was copy-pasted in three places with drifted semantics:
//   - src/content/bootstrap.ts                (tracked sessionAccessFailed + "not allowed" downgrade)
//   - src/core/api/client/credentialManager.ts (naive copy, no downgrade)
//   - src/core/storage/storageService.ts       (naive copy, no downgrade)
//
// Only bootstrap's copy tracked sessionAccessFailed, so a session failure observed
// on the bootstrap path never downgraded the credentialManager/storageService paths —
// they kept returning the broken session area. All three now share this module's
// single flag, so one "not allowed" failure downgrades every caller to
// chrome.storage.local. This module imports nothing, so it cannot create cycles.

let sessionAccessFailed = false;

/**
 * Resolve the storage area for credentials.
 * Prefer chrome.storage.session (memory-scoped, cleared with the browser session);
 * once session access has failed ("not allowed"), permanently fall back to
 * chrome.storage.local for the lifetime of this context.
 */
export function getCredStorage(): chrome.storage.StorageArea | null {
    if (typeof chrome !== 'undefined' && chrome.storage) {
        if (!sessionAccessFailed && chrome.storage.session) return chrome.storage.session;
        return chrome.storage.local;
    }
    return null;
}

/**
 * Record that chrome.storage.session is unusable. Call from a catch block that
 * observed a "not allowed" session error; every getCredStorage caller then
 * downgrades to chrome.storage.local without touching session again.
 */
export function markCredSessionAccessFailed(): void {
    sessionAccessFailed = true;
}
