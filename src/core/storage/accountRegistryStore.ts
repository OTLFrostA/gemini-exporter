import { readAccount, readAccountParameters, readAccountRegistry, findAccount, type Account } from '../domain/accountRegistry.js';
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
/** Lookup, UUID allocation and profile update commit in one transaction across all tabs. */
export async function getOrCreateAccount(providerId: string, providerAccountId: string,
    email?: string, displayName?: string): Promise<Account> {
    const parameters = readAccountParameters({ providerId, providerAccountId, email, displayName });
    await assertSchemaWritable();
    let changed = false;
    const result = await transaction<Account>('readwrite', (store, done, fail) => {
        const request = store.getAll();
        request.onsuccess = () => {
            try {
                const accounts = readAccountRegistry(request.result);
                const existing = findAccount(accounts, parameters.providerId, parameters.providerAccountId,
                    parameters.email, parameters.displayName);
                const account = existing ?? readAccount({ id: crypto.randomUUID(), ...parameters });
                if (!existing) { store.add(account); changed = true; }
                else if (JSON.stringify(accounts.find(item => item.id === account.id)) !== JSON.stringify(account)) { store.put(account); changed = true; }
                done(account);
            } catch (error) { fail(error); }
        };
    });
    if (changed && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        void chrome.runtime.sendMessage({ action: 'accountsChanged' }).catch(() => {});
    }
    return result;
}
