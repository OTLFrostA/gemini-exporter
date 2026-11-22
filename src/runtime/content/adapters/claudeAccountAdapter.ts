import { observeClaudeAccount } from '../../../l1/client/claude/accountObservation.js';
import type { PlatformAccountAdapter } from '../accountContext.js';

export function createClaudeAccountAdapter(): PlatformAccountAdapter {
    return {
        providerId: 'claude',
        currentSlot: () => 'u0',
        observeAccount: () => observeClaudeAccount(),
    };
}
