import { readAccountRegistry, type Account } from '../domain/accountRegistry.js';
import { ACCOUNT_STORE } from './domain/contracts.js';
import { openDomainDB } from './domain/domainStore.js';
import { assertSchemaWritable } from './schemaState.js';


/** Extension-origin only. Content scripts call the background broker. No page-origin DB or memory fallback. */
async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, done: (value: T) => void, fail: (error: unknown) => void) => void): Promise<T> {
    if (typeof chrome !== 'undefined' && chrome.runtime?.id && typeof location !== 'undefined'
        && location.protocol !== 'chrome-extension:') throw new Error('Account registry requires the extension background');
    const db = await openDomainDB();
    try {
        return await new Promise<T>((resolve, reject) => {
            const tx = db.transaction(ACCOUNT_STORE, mode);
            let result: T;
            tx.oncomplete = () => resolve(result);
            tx.onabort = () => reject(tx.error ?? new Error('Account registry transaction aborted'));
            tx.onerror = () => reject(tx.error ?? new Error('Account registry transaction failed'));
            try { run(tx.objectStore(ACCOUNT_STORE), value => { result = value; }, error => { tx.abort(); reject(error); }); }
            catch (error) { tx.abort(); reject(error); }
        });
    } finally { db.close(); }
}
export function listAccounts(providerId?: string): Promise<Account[]> {
    return transaction('readonly', (store, done, fail) => {
        const request = store.getAll();
        request.onsuccess = () => {
            try { done(readAccountRegistry(request.result).filter(account => providerId === undefined || account.providerId === providerId)); }
            catch (error) { fail(error); }
        };
    });
}
export async function getAccount(id: string): Promise<Account | null> {
    return (await listAccounts()).find(account => account.id === id) ?? null;
}
/** Execute a Domain decision against the freshest Registry under one IDB transaction. */
export async function transactAccounts(decide: (accounts: readonly Account[]) => Account): Promise<Account> {
    await assertSchemaWritable();
    let changed = false;
    const result = await transaction<Account>('readwrite', (store, done, fail) => {
        const request = store.getAll();
        request.onsuccess = () => {
            try {
                const accounts = readAccountRegistry(request.result);
                const account = decide(accounts);
                const previous = accounts.find(item => item.id === account.id);
                if (JSON.stringify(previous) !== JSON.stringify(account)) {
                    if (previous) store.put(account); else store.add(account);
                    changed = true;
                }
                done(account);
            } catch (error) { fail(error); }
        };
    });
    if (changed && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        void chrome.runtime.sendMessage({ action: 'accountsChanged' }).catch(() => {});
    }
    return result;
}
