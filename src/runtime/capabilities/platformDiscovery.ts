import type { Account } from '../../l2/accountRegistry.js';
import { getOrCreateAccount } from '../api/accountRegistry.js';
import { syncPlatformContentScripts } from './platformInjection.js';

export interface DiscoveredAccountCandidate {
    readonly providerAccountId: string;
    readonly email?: string;
    readonly displayName?: string;
}

/** Shared discovery pipeline for optional-permission platforms:
 * check host grant -> probe authenticated session -> register provider -> sync content scripts -> admit Accounts.
 */
export async function admitDiscoveredPlatformAccounts(options: {
    readonly platform: 'chatgpt' | 'claude' | 'grok';
    readonly hasAccess: () => Promise<boolean>;
    readonly ensureRegistered: () => Promise<unknown>;
    readonly discover: () => Promise<readonly DiscoveredAccountCandidate[]>;
}): Promise<Account[]> {
    if (!await options.hasAccess()) return [];
    const candidates = await options.discover();
    if (!candidates.length) return [];
    await options.ensureRegistered();
    await syncPlatformContentScripts(options.platform);
    const accounts: Account[] = [];
    for (const candidate of candidates) {
        accounts.push(await getOrCreateAccount(
            options.platform,
            candidate.providerAccountId,
            candidate.email,
            candidate.displayName,
        ));
    }
    return accounts;
}
