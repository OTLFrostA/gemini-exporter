import type { Account } from '../domain/accountRegistry.js';
import { inStore, readOne, putOne } from './idb.js';

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
export function putAccount(account: Account): Promise<void> {
    return putOne('accounts', account);
}
