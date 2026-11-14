import type { Account } from '../../l2/accountRegistry.js';
import { hasGrokAccess, readGrokSource, ensureGrokRegistered } from '../../l1/client/grok/grokAccess.js';
import { grokAccount } from '../../l1/parsers/grok/source.js';
import { admitDiscoveredPlatformAccounts } from './platformDiscovery.js';

export async function discoverGrokAccounts(): Promise<Account[]> {
    return admitDiscoveredPlatformAccounts({
        platform: 'grok',
        hasAccess: hasGrokAccess,
        ensureRegistered: ensureGrokRegistered,
        discover: async () => {
            const user = grokAccount(await readGrokSource('/rest/auth/get-user'));
            return [{
                providerAccountId: user.providerAccountId,
                email: user.email,
                displayName: user.displayName,
            }];
        },
    });
}
