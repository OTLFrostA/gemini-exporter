import { clearResourceContext } from '../../src/core/storage/domain/resourceContext.js';
import { resetIndexCoverageSessions } from '../../src/core/domain/indexCoverage.js';
import { fixtureAccount } from './domainFixture.js';
import { ACCOUNT_UUID, OTHER_ACCOUNT_UUID } from './accountRuntime.js';
import { beforeEach, afterEach } from 'node:test';
import { __resetStorageReadyForTest } from '../../src/core/storage/schemaMigration.js';
import { __clearDomainMemory } from '../../src/core/storage/domain/domainStore.js';

/** A physical storage mock: no implicit normalization or migration. */
export function indexStorage(seed: Record<string, unknown> = {}) {
    const previous = globalThis.chrome;
    const local = structuredClone(seed);
    let writes = 0;
    let failKey: string | undefined;
    const accounts = new Map([
        [ACCOUNT_UUID, { id: ACCOUNT_UUID, providerId: 'gemini', providerAccountId: '10000000001' }],
        [OTHER_ACCOUNT_UUID, { id: OTHER_ACCOUNT_UUID, providerId: 'gemini', providerAccountId: '10000000002' }],
        ['10000000-0000-4000-8000-000000000003', { id: '10000000-0000-4000-8000-000000000003', providerId: 'gemini', providerAccountId: 'default' }],
    ]);
    for (const provider of ['chatgpt', 'custom', 'future', 'future-provider', 'other', 'example', 'neutral', 'openai', 'independent']) { const account = fixtureAccount(provider); accounts.set(account.id, account); }
    globalThis.chrome = { runtime: { async sendMessage(message: Record<string, unknown>) {
        if (message.action !== 'accountRegistry') return undefined;
        if (message.command === 'get') return { ok: true, value: accounts.get(String(message.accountId)) ?? null };
        if (message.command === 'list') return { ok: true, value: [...accounts.values()].filter(account => !message.providerId || account.providerId === message.providerId) };
        const found = [...accounts.values()].find(account => account.providerId === message.providerId && account.providerAccountId === message.providerAccountId);
        const account = found ?? { id: crypto.randomUUID(), providerId: String(message.providerId), providerAccountId: String(message.providerAccountId) };
        accounts.set(account.id, account);
        return { ok: true, value: account };
    } }, storage: { local: {
        async get(keys: string | string[] | null) {
            return structuredClone(keys === null ? local : Object.fromEntries((typeof keys === 'string' ? [keys] : keys).filter(k => k in local).map(k => [k, local[k]])));
        },
        async set(values: Record<string, unknown>) {
            if (failKey && failKey in values) throw new Error(`write failed: ${failKey}`);
            writes++; Object.assign(local, structuredClone(values));
        },
        async remove(keys: string | string[]) { for (const key of typeof keys === 'string' ? [keys] : keys) delete local[key]; }
    } } } as typeof chrome;
    resetIndexCoverageSessions();
    __resetStorageReadyForTest();
    __clearDomainMemory(); clearResourceContext();
    return { local, writes: () => writes, fail: (key?: string) => { failKey = key; },
        restore() { globalThis.chrome = previous; __resetStorageReadyForTest(); __clearDomainMemory(); clearResourceContext(); } };
}

/** Catalog-aware application tests use the same storage boundary as production reads. */
export function useIndexStorage(): void {
    let environment: ReturnType<typeof indexStorage>;
    beforeEach(() => { environment = indexStorage(); });
    afterEach(() => { environment.restore(); });
}
