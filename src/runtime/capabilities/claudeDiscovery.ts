import { hasClaudeAccess, readClaudeSource, ensureClaudeRegistered } from '../../l1/client/claude/claudeAccess.js';
import type { Account } from '../../l2/accountRegistry.js';
import { claudeUuid } from '../../l1/sniffer/claude/observation.js';
import { isRecord } from '../../shared/utils/typeGuards.js';
import { admitDiscoveredPlatformAccounts } from './platformDiscovery.js';

/** Read only chat-capable Claude organizations; never invent an account from a tab URL. */
export async function discoverClaudeAccounts(): Promise<Account[]> {
    return admitDiscoveredPlatformAccounts({
        platform: 'claude',
        hasAccess: hasClaudeAccess,
        ensureRegistered: ensureClaudeRegistered,
        discover: async () => {
            const raw = await readClaudeSource('/api/organizations');
            if (!Array.isArray(raw)) throw new TypeError('Claude organization response changed');
            const verified = raw.flatMap((value: unknown) => {
                if (!isRecord(value) || typeof value.uuid !== 'string' || !claudeUuid(value.uuid)) return [];
                const name = typeof value.name === 'string' ? value.name.trim() : '';
                const chat = Array.isArray(value.capabilities) && value.capabilities.includes('chat');
                return [{ uuid: value.uuid, name, chat }];
            });
            const chatOrganizations = verified.filter(value => value.chat);
            // Older Claude accounts may omit capabilities. Fallback only when
            // exactly one organization makes source identity unambiguous.
            const organizations = chatOrganizations.length ? chatOrganizations
                : verified.length === 1 ? verified : [];
            return organizations.map(org => ({
                providerAccountId: org.uuid,
                displayName: org.name || undefined,
            }));
        },
    });
}
