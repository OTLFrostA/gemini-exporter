import { isAccountId } from '../domain/accountRegistry.js';
import { restoreConversationIndex, compareConversationIndexes, type DomainConversationIndex } from '../domain/conversationIndex.js';
import { assertSchemaWritable } from './schemaState.js';

export interface StorageKeys {
    accountId: string;
    convKey: string;
    expKey: string;
    syncKey: string;
    countKey: string;
    checkpointKey: string;
    coverageKey: string;
}


export interface ConversationTransaction {
    /** List to persist. Must be a fresh array; the stored list is replaced wholesale. */
    list: DomainConversationIndex[];
    /** How many items the merge changed (drives badge / skip-write decisions). */
    changed: number;
}

export function requireAccountId(accountId?: string | null): string {
    if (!isAccountId(accountId)) throw new TypeError('Storage requires a Registry account UUID');
    return accountId;
}

export function getStorageKeys(accountId?: string | null): StorageKeys {
    const id = requireAccountId(accountId);
    return { accountId: id,
        convKey: `conversations_${id}`, expKey: `exported_${id}`,
        syncKey: `last_sync_${id}`, countKey: `last_count_${id}`,
        coverageKey: `scan_coverage_${id}`, checkpointKey: `scan_checkpoint_${id}` };
}

export async function getConversations(slot?: string | null): Promise<DomainConversationIndex[]> {
    const { convKey } = getStorageKeys(slot);
    const data = await chrome.storage.local.get<Record<string, unknown>>([convKey]);
    const raw = data[convKey];
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) throw new TypeError('Invalid conversation index container');
    const indexes = raw.map(restoreConversationIndex);
    if (indexes.some(index => index.key.accountId !== slot)) throw new TypeError("Index account mismatch");
    const ids = new Set(indexes.map(c => JSON.stringify([c.key.accountId, c.key.conversationId])));
    if (ids.size !== indexes.length) throw new TypeError('Duplicate conversation index identity');
    return indexes;
}

let _convChain: Promise<void> = Promise.resolve();

// Cross-tab write serialization.
//
// Every Gemini tab runs its own content-script JS context, so the in-memory
// promise chains below (_convChain / _saveRecordChain) only
// serialize writes *within* one tab. chrome.storage.local is shared across
// tabs, so two tabs could still interleave read-modify-write cycles: both
// read the same stale snapshot, then the later write silently discards the
// earlier tab's updates (classic lost update).
//
// navigator.locks (Web Locks API) is held per origin across tabs, workers
// and the service worker, so requesting a named lock here upgrades each
// chain to a truly global mutex. The lock is taken *inside* the in-memory
// chain, so a tab only holds the global lock while its own critical section
// runs — never while waiting behind its own queued work. Lock order is
// unchanged (conv -> save-record; no path takes them in reverse), and
// Web Locks are never nested for the same name.
//
// When Web Locks is unavailable (very old Chrome, non-window test envs)
// the in-memory chain remains as the fallback, preserving the previous
// within-tab guarantee.
const XTAB_LOCK_PREFIX = 'gemini-exporter:write:';

interface WebLockManager {
    request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

function getWebLocks(): WebLockManager | null {
    try {
        if (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function') {
            return navigator.locks;
        }
    } catch { /* non-window contexts: fall through to in-memory chain */ }
    return null;
}

export function withCrossTabLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const locks = getWebLocks();
    if (locks) {
        return locks.request(XTAB_LOCK_PREFIX + name, fn);
    }
    return fn();
}

export function withConversationLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = () => withCrossTabLock('conversations', fn);
    const p = _convChain.then(run, run);
    _convChain = p.then(() => {}, () => {});
    return p;
}

/** Canonical index writes never inspect or persist conversation bodies. */
export async function writeConversationIndexes(slot: string | null | undefined, list: readonly DomainConversationIndex[]): Promise<DomainConversationIndex[]> {
    await assertSchemaWritable();
    const indexes = list.map(restoreConversationIndex);
    if (indexes.some(index => index.key.accountId !== slot)) throw new TypeError("Index account mismatch");
    if (new Set(indexes.map(c => JSON.stringify([c.key.accountId, c.key.conversationId]))).size !== indexes.length) throw new TypeError('Duplicate conversation index identity');
    indexes.sort(compareConversationIndexes);
    await chrome.storage.local.set({ [getStorageKeys(slot).convKey]: indexes });
    return indexes;
}
export async function setConversations(slot: string | null | undefined, list: readonly DomainConversationIndex[]): Promise<void> {
    await withConversationLock(() => writeConversationIndexes(slot, list));
}
// Atomic read-merge-write for the conversation list.
//
// The updater runs *inside* the cross-tab conversation lock: it receives the
// freshest stored list and returns the list to persist, or null to skip the
// write. The updater must be pure (no storage I/O, no awaits) so the lock is
// only held across one storage get + one storage set.
//
// Callers must NOT read the list first and merge outside: that is exactly the
// cross-tab lost-update hole this closes (two tabs read the same snapshot,
// the later write discards the earlier tab's merge).
export async function transactConversations(
    slot: string | null | undefined,
    updater: (existing: DomainConversationIndex[]) => ConversationTransaction | null
): Promise<{ list: DomainConversationIndex[]; changed: number; written: boolean }> {
    return withConversationLock(async () => {
        const existing = await getConversations(slot);
        const result = updater(existing);
        if (!result) return { list: existing, changed: 0, written: false };
        const list = await writeConversationIndexes(slot, result.list);
        return { list, changed: result.changed, written: true };
    });
}
