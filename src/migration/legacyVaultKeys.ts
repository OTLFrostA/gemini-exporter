const LEGACY_SYNC_PREFIX = 'ge_cloud_key_v1:';
const LEGACY_VAULT_DB = 'gemini_exporter_cloud_v1';
const LEGACY_MIRROR = 'localKeys';

async function clearLegacyMirror(): Promise<void> {
    if (!(await indexedDB.databases()).some(db => db.name === LEGACY_VAULT_DB)) return;
    await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(LEGACY_VAULT_DB);
        open.onupgradeneeded = () => open.transaction?.abort(); // The legacy DB may have disappeared.
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
            const db = open.result;
            try {
                if (!db.objectStoreNames.contains(LEGACY_MIRROR)) { resolve(); return; }
                const tx = db.transaction(LEGACY_MIRROR, 'readwrite');
                tx.oncomplete = () => resolve();
                tx.onabort = () => reject(tx.error);
                tx.objectStore(LEGACY_MIRROR).clear();
            } catch (error) {
                reject(error);
            } finally {
                db.close();
            }
        };
    });
}

export function initLegacyVaultKeyCleanup(): void {
    void clearLegacyMirror().catch(() => console.warn('[Vault] Could not clear the legacy IndexedDB key mirror'));
    const sync = chrome.storage?.sync;
    if (typeof sync?.getKeys !== 'function') return; // Never fall back to reading values.
    const purgeSync = async () => {
        const slots = (await sync.getKeys()).filter(slot => slot.startsWith(LEGACY_SYNC_PREFIX));
        if (slots.length) await sync.remove(slots);
    };
    const sweep = () => {
        void purgeSync().catch(() => console.warn('[Vault] Could not remove legacy Chrome Sync key slots'));
    };
    // Sync can replay legacy slots after the worker starts; do not inspect the event payload.
    sync.onChanged.addListener(sweep);
    sweep();
}
