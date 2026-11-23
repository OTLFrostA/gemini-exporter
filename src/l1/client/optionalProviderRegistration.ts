import { hasPlatformAccess } from './platformAccess.js';
import { ProviderRegistry } from './providerRegistry.js';
import type { AIProvider } from './aiProvider.js';
import type { SourcePlatform } from '../../shared/platformHosts.js';

/** Register an optional-permission provider once host access is granted. */
export async function ensureOptionalProviderRegistered(
    platform: SourcePlatform,
    createProvider: () => AIProvider,
): Promise<boolean> {
    if (!await hasPlatformAccess(platform)) return false;
    if (!ProviderRegistry.get(platform)) {
        ProviderRegistry.register(createProvider());
    }
    return true;
}
