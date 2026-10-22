import { getOrCreateAccount } from '../api/accountRegistry.js';
import { hasClaudeAccess, readClaudeSource, requestClaudeAccess, ensureClaudeRegistered } from '../../l1/client/claude/claudeAccess.js';
import type { Account } from '../../l2/accountRegistry.js';

export function requestClaudeConnection(): Promise<boolean> { return requestClaudeAccess(); }

/** Read only chat-capable Claude organizations; never invent an account from a tab URL. */
export async function discoverClaudeAccounts(): Promise<Account[]> {
    if (!await hasClaudeAccess()) return [];
    const raw = await readClaudeSource('/api/organizations');
    if (!Array.isArray(raw)) throw new TypeError('Claude organization response changed');
    const organizations = raw.filter((value): value is Record<string, unknown> =>
        !!value && typeof value === 'object' && !Array.isArray(value)
        && typeof value.uuid === 'string' && /^[\da-f-]{36}$/i.test(value.uuid)
        && Array.isArray(value.capabilities) && value.capabilities.includes('chat'));
    if (!organizations.length) return [];
    await ensureClaudeRegistered();
    const accounts: Account[] = [];
    for (const organization of organizations) {
        const name = typeof organization.name === 'string' ? organization.name.trim() : '';
        accounts.push(await getOrCreateAccount('claude', organization.uuid as string,
            undefined, name || undefined));
    }
    return accounts;
}
