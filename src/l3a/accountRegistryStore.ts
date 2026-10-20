import type { Account } from '../l2/accountRegistry.js';
import { inStore, inStores, readOne } from './idb.js';

export function getAccount(id: Account['id']): Promise<Account | null> {
    return readOne('accounts', id);
}
export function listAccounts(): Promise<Account[]> {
    return inStore<Account[]>('accounts', 'readonly', (store, done) => {
        const request = store.getAll();
        request.onsuccess = () => done(request.result);
    });
}
/** The unique identity lookup and insert share one readwrite transaction. */
export function insertAccountIfAbsent(account: Account): Promise<Account> {
    return inStore<Account>('accounts', 'readwrite', (store, done) => {
        const request = store.index('providerIdentity').get([account.providerId, account.providerAccountId]);
        request.onsuccess = () => {
            if (request.result !== undefined) done(request.result);
            else { store.add(account); done(account); }
        };
    });
}
/** Keep the stable UUID and provider identity immutable while allowing migration Upsert. */
export function putAccount(account: Account): Promise<void> {
    return inStores<void>(['accounts'], 'readwrite', (tx, done, fail) => {
        const store = tx.objectStore('accounts');
        const request = store.get(account.id);
        request.onsuccess = () => {
            try {
                const old = request.result as Account | undefined;
                if (old && (old.providerId !== account.providerId || old.providerAccountId !== account.providerAccountId))
                    throw new TypeError('Account identity cannot change');
                store.put(account);
                done(undefined);
            } catch (error) { fail(error); }
        };
    });
}
