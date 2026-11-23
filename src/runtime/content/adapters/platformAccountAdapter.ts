import type { Account } from '../../../l2/accountRegistry.js';
import type { SourcePlatform } from '../../../shared/platformHosts.js';

export interface PlatformAccountAdapter {
    readonly providerId: SourcePlatform;
    currentSlot(): string;
    observeAccount(slot: string, registerCleanup?: (fn: () => void) => () => void): Promise<Omit<Account, 'id'> | null>;
}
