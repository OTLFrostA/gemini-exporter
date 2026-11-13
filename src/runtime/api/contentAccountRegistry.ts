import { readAccount, DEFAULT_ACCOUNT_KEY, type Account } from '../../l2/accountRegistry.js';
import { ensureContentReady } from './contentReady.js';

type ContentRegistryRequest =
    | { command: 'get'; accountId: Account['id'] }
    | ({ command: 'getOrCreate' } & Omit<Account, 'id'>);

async function request(parameters: ContentRegistryRequest): Promise<unknown> {
    const response: unknown = await chrome.runtime.sendMessage({ action: 'accountRegistry', ...parameters });
    if (!response || typeof response !== 'object' || !('ok' in response) || response.ok !== true || !('value' in response)) {
        throw new Error(response && typeof response === 'object' && 'error' in response ? String(response.error) : 'Account registry unavailable');
    }
    return response.value;
}

/** Content-world Account Registry IPC client. Extension-origin persistence stays in the Worker. */
export async function getOrCreateContentAccount(providerId: string, providerAccountId: string,
    email?: string, displayName?: string): Promise<Account> {
    await ensureContentReady();
    const account = readAccount(await request({ command: 'getOrCreate', providerId, providerAccountId, email, displayName }));
    if (account.providerId !== providerId || (providerAccountId !== DEFAULT_ACCOUNT_KEY && account.providerAccountId !== providerAccountId)) {
        throw new TypeError('Account registry identity mismatch');
    }
    return account;
}

export async function getContentAccount(accountId: string): Promise<Account | null> {
    await ensureContentReady();
    const result = await request({ command: 'get', accountId });
    if (result === null) return null;
    const account = readAccount(result);
    if (account.id !== accountId) throw new TypeError('Account registry UUID mismatch');
    return account;
}
