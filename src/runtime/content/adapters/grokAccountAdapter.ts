import { observeGrokAccount } from '../../../l1/client/grok/accountObservation.js';
import type { PlatformAccountAdapter } from '../accountContext.js';

export function createGrokAccountAdapter(): PlatformAccountAdapter {
    return {
        providerId: 'grok',
        currentSlot: () => 'u0',
        observeAccount: () => observeGrokAccount(),
    };
}
