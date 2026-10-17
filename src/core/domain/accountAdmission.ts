import { readAccountParameters, findAccount, readAccount, type Account } from './accountRegistry.js';
/** L2 entry: the transaction port guarantees atomic matching, allocation and profile updates. */
export async function getOrCreateAccount(providerId: string, providerAccountId: string,
    email?: string, displayName?: string): Promise<Account> {
    const parameters = readAccountParameters({ providerId, providerAccountId, email, displayName });
    const { transactAccounts } = await import('../storage/accountRegistryStore.js');
    return transactAccounts(accounts => findAccount(accounts, parameters.providerId, parameters.providerAccountId,
        parameters.email, parameters.displayName) ?? readAccount({ id: crypto.randomUUID(), ...parameters }));
}
