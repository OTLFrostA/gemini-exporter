import { readAccountParameters, findAccount, readAccount, type Account } from './accountRegistry.js';
import { insertAccountIfAbsent, putAccount } from '../storage/storageService.js';
import { withAdmissionLock } from './admissionLock.js';
/** Storage atomically resolves identity; L2 owns allocation and profile updates. */
export async function getOrCreateAccount(providerId: string, providerAccountId: string,
    email?: string, displayName?: string): Promise<Account> {
    const parameters = readAccountParameters({ providerId, providerAccountId, email, displayName });
    return withAdmissionLock(`account:${JSON.stringify([providerId, providerAccountId])}`, async () => {
        const existing = readAccount(await insertAccountIfAbsent(readAccount({ id: crypto.randomUUID(), ...parameters })));
        const accepted = findAccount([existing], providerId, providerAccountId, email, displayName)!;
        if (JSON.stringify(existing) !== JSON.stringify(accepted)) await putAccount(accepted);
        return accepted;
    });
}
