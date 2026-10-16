import type { Account } from '../../src/core/domain/accountRegistry.js';
import { ACCOUNT_UUID, OTHER_ACCOUNT_UUID } from './accountRuntime.js';

/** Explicit fixture Accounts, shared by storage-only chrome mocks. */
export function withRegistry<T extends object>(mock: T, extra: Account[] = []): T {
    const accounts: Account[] = [
        { id: ACCOUNT_UUID, providerId: 'gemini', providerAccountId: '10000000001' },
        { id: OTHER_ACCOUNT_UUID, providerId: 'gemini', providerAccountId: '10000000002' },
        ...extra,
    ];
    return Object.assign(mock, { runtime: { async sendMessage(message: Record<string, unknown>) {
        if (message.action !== 'accountRegistry') return undefined;
        if (message.command === 'get') return { ok: true, value: accounts.find(a => a.id === message.accountId) ?? null };
        if (message.command === 'list') return { ok: true, value: accounts.filter(a => !message.providerId || a.providerId === message.providerId) };
        throw new Error('Storage fixture does not allocate accounts');
    } } });
}
