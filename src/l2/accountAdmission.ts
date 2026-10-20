import { readAccountParameters, findAccount, readAccount, type Account } from './accountRegistry.js';
import { insertAccountIfAbsent, putAccount } from '../l3a/storageService.js';

/** The provider identity unique index owns atomic creation; L2 decides display data. */
export async function getOrCreateAccount(providerId: Account['providerId'], providerAccountId: Account['providerAccountId'],
    email?: Account['email'], displayName?: Account['displayName']): Promise<Account> {
    const parameters = readAccountParameters({ providerId, providerAccountId, email, displayName });
    const existing = readAccount(await insertAccountIfAbsent(readAccount({ id: crypto.randomUUID(), ...parameters })));
    const accepted = findAccount([existing], providerId, providerAccountId, email, displayName)!;
    if (JSON.stringify(existing) !== JSON.stringify(accepted)) await putAccount(accepted);
    return accepted;
}
