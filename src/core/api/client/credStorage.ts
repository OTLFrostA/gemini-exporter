// src/core/api/client/credStorage.ts - Shared credential storage-area resolver.

let sessionAccessFailed = false;

/**
 * Resolve the storage area for credentials, falling back to local on session failure.
 */
export function getCredStorage(): chrome.storage.StorageArea | null {
    if (typeof chrome !== 'undefined' && chrome.storage) {
        if (!sessionAccessFailed && chrome.storage.session) return chrome.storage.session;
        return chrome.storage.local;
    }
    return null;
}

/**
 * Record that chrome.storage.session is unusable, downgrading to local storage.
 */
export function markCredSessionAccessFailed(): void {
    sessionAccessFailed = true;
}
