import { admitFixture } from './admitFixture.js';
import { readAccount } from '../../src/core/domain/accountRegistry.js';
import { restoreDomainSnapshot } from '../../src/core/domain/runtimeValidation.js';
import type { DomainFixture } from './domainFixture.js';
function isBoundFixture(value: unknown): value is DomainFixture {
    if (!value || typeof value !== 'object' || !('account' in value) || !('conversation' in value)) return false;
    try {
        const account = readAccount(value.account), domain = restoreDomainSnapshot(value.conversation);
        return account.id === domain.index.key.accountId && Array.isArray(Reflect.get(value, 'diagnostics'))
            && !!Reflect.get(value, 'resourceHints') && !!Reflect.get(value, 'acquisitionHints');
    } catch { return false; }
}
/** Legacy Application mocks admit explicitly bound fixtures; this is not an L1 parser guard. */
export async function acquiredReply<T>(reply: T): Promise<T> {
    if (!reply || typeof reply !== 'object' || Reflect.get(reply, 'success') !== true) return reply;
    const items: unknown = Reflect.get(reply, 'results') ?? [Reflect.get(reply, 'chat') ?? Reflect.get(reply, 'data')];
    if (Array.isArray(items)) for (const item of items) if (isBoundFixture(item)) await admitFixture(item.account.id, item);
    return reply;
}
