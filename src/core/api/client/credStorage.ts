let sessionAccessFailed = false;

export function getCredStorage(): chrome.storage.StorageArea | null {
    if (typeof chrome !== 'undefined' && chrome.storage) {
        if (!sessionAccessFailed && chrome.storage.session) return chrome.storage.session;
        return chrome.storage.local;
    }
    return null;
}

export function markCredSessionAccessFailed(): void {
    sessionAccessFailed = true;
}
