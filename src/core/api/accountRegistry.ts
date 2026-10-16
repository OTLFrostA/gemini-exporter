import { readAccount, readAccountRegistry, type Account } from '../domain/accountRegistry.js';

/** All extension surfaces use the background's extension-origin Registry. */
async function request(command: string, parameters: Record<string, unknown> = {}): Promise<unknown> {
    const response: unknown = await chrome.runtime.sendMessage({ action: 'accountRegistry', command, ...parameters });
    if (!response || typeof response !== 'object' || !('ok' in response) || response.ok !== true || !('value' in response)) {
        throw new Error(response && typeof response === 'object' && 'error' in response ? String(response.error) : 'Account registry unavailable');
    }
    return response.value;
}
export async function getOrCreateAccount(providerId: string, providerAccountId: string,
    email?: string, displayName?: string): Promise<Account> {
    const account = readAccount(await request('getOrCreate', { providerId, providerAccountId, email, displayName }));
    if (account.providerId !== providerId || account.providerAccountId !== providerAccountId) throw new TypeError('Account registry identity mismatch');
    return account;
}
export async function listAccounts(providerId?: string): Promise<Account[]> {
    return readAccountRegistry(await request('list', { providerId }));
}
export async function getAccount(accountId: string): Promise<Account | null> {
    const result = await request('get', { accountId });
    if (result === null) return null;
    const account = readAccount(result);
    if (account.id !== accountId) throw new TypeError('Account registry UUID mismatch');
    return account;
}
