import { readAccountFact, readAccountObservation, readAccountRegistry, resolveAccount, type AccountFact } from '../domain/accountRegistry.js';
import { ACCOUNT_STORE } from './domain/contracts.js';
import { openDomainDB } from './domain/domainStore.js';
import { assertSchemaWritable } from './schemaState.js';

export interface AccountReceipt { resolution: 'existing' | 'created'; account: AccountFact }

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
export function listAccounts(providerId?: string): Promise<AccountFact[]> {
    return transaction('readonly', (store, done, fail) => {
        const request = store.getAll();
        request.onsuccess = () => {
            try { done(readAccountRegistry(request.result).filter(account => providerId === undefined || account.providerId === providerId)); }
            catch (error) { fail(error); }
        };
    });
}
export async function readAccount(id: string): Promise<AccountFact | null> {
    return (await listAccounts()).find(account => account.id === id) ?? null;
}
/** The read, pure decision, UUID allocation and write share one real IDB transaction. */
export async function acceptAccountObservation(value: unknown): Promise<AccountReceipt> {
    const observation = readAccountObservation(value);
    await assertSchemaWritable();
    return transaction('readwrite', (store, done, fail) => {
        const request = store.getAll();
        request.onsuccess = () => {
            try {
                const accounts = readAccountRegistry(request.result);
                const decision = resolveAccount(accounts, observation);
                const account = decision.resolution === 'create'
                    ? readAccountFact({ id: crypto.randomUUID(), ...decision.observation }) : decision.account;
                if (decision.resolution === 'create') store.add(account);
                else if (JSON.stringify(accounts.find(item => item.id === account.id)) !== JSON.stringify(account)) store.put(account);
                done({ resolution: decision.resolution === 'create' ? 'created' : 'existing', account });
            } catch (error) { fail(error); }
        };
    });
}
