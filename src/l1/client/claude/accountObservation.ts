import { activeClaudeOrganization } from '../../sniffer/claude/observation.js';
import type { Account } from '../../../l2/accountRegistry.js';
let pending: Promise<unknown> | undefined;
let organizations: unknown;
let expires = 0;
/** Verify membership once per short session; changing cookies never reuses an old binding. */
export async function observeClaudeAccount(): Promise<Omit<Account, 'id'> | null> {
    const id = activeClaudeOrganization(document.cookie);
    if (!id) return null;
    if (Date.now() >= expires) {
        pending ??= fetch('/api/organizations', { credentials: 'include' })
            .then(async response => response.ok ? response.json() as Promise<unknown> : null)
            .then(value => { organizations = value; expires = Date.now() + 30_000; return value; })
            .finally(() => { pending = undefined; });
        await pending;
    }
    if (activeClaudeOrganization(document.cookie) !== id || !Array.isArray(organizations)) return null;
    const organization: unknown = organizations.find((o: unknown) => !!o && typeof o === 'object' && 'uuid' in o && o.uuid === id);
    if (!organization || typeof organization !== 'object') return null;
    return { providerId: 'claude', providerAccountId: id,
        ...('name' in organization && typeof organization.name === 'string' ? { displayName: organization.name } : {}) };
}
