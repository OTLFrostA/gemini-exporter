import { readAccount, readAccountRegistry, type Account } from '../domain/accountRegistry.js';

/** The worker cannot receive its own runtime messages; it accesses the same Registry directly. */
function inBackground(): boolean {
    return typeof document === 'undefined' && typeof location !== 'undefined' && location.protocol === 'chrome-extension:';
}
/** All surfaces resolve Accounts from the extension-origin Registry. */
async function request(command: string, parameters: Record<string, unknown> = {}): Promise<unknown> {
    const response: unknown = await chrome.runtime.sendMessage({ action: 'accountRegistry', command, ...parameters });
    if (!response || typeof response !== 'object' || !('ok' in response) || response.ok !== true || !('value' in response)) {
        throw new Error(response && typeof response === 'object' && 'error' in response ? String(response.error) : 'Account registry unavailable');
    }
    return response.value;
}
export async function getOrCreateAccount(providerId: string, providerAccountId: string,
    email?: string, displayName?: string): Promise<Account> {
    const account = readAccount(inBackground()
        ? await (await import('../domain/accountAdmission.js')).getOrCreateAccount(providerId, providerAccountId, email, displayName)
        : await request('getOrCreate', { providerId, providerAccountId, email, displayName }));
    if (account.providerId !== providerId || account.providerAccountId !== providerAccountId) throw new TypeError('Account registry identity mismatch');
    return account;
}
export async function listAccounts(providerId?: string): Promise<Account[]> {
    return readAccountRegistry(inBackground()
        ? await (await import('../storage/accountRegistryStore.js')).listAccounts(providerId)
        : await request('list', { providerId }));
}
export async function getAccount(accountId: string): Promise<Account | null> {
    const result = inBackground()
        ? await (await import('../storage/accountRegistryStore.js')).getAccount(accountId)
        : await request('get', { accountId });
    if (result === null) return null;
    const account = readAccount(result);
    if (account.id !== accountId) throw new TypeError('Account registry UUID mismatch');
    return account;
}
