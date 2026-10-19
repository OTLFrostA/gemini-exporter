import { IDBFactory, IDBObjectStore, IDBKeyRange } from 'fake-indexeddb';
import { resetIndexCoverageSessions } from '../../src/core/domain/indexCoverage.js';
import { fixtureAccount } from './domainFixture.js';
import { ACCOUNT_UUID, OTHER_ACCOUNT_UUID } from './accountRuntime.js';
import { beforeEach, afterEach } from 'node:test';


/** Production Storage over a fresh IndexedDB test backend; Chrome Settings/IPC are boundary doubles. */
export function indexStorage(seed: Record<string, unknown> = {}) {
    const previous = globalThis.chrome, previousDB = globalThis.indexedDB, previousRange = globalThis.IDBKeyRange;
    globalThis.indexedDB = new IDBFactory();
    globalThis.IDBKeyRange = IDBKeyRange;
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value: unknown, key?: IDBValidKey) {
        const row = value as { key?: { accountId?: string } };
        if (failKey && (failKey === this.name || failKey === `conversations_${row.key?.accountId}`)) throw new Error(`write failed: ${failKey}`);
        writes++;
        return originalPut.call(this, value, key);
    };
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
        if (message.action === 'ensureV2Ready') return { ok: true };
        if (message.action === 'domainIngest') {
            const domain: typeof import('../../src/core/domain/ingestion.js') = require('../../src/core/domain/ingestion.js');
            if (message.operation === 'indexes') { await domain.ingestIndexes(message.accountId as string, message.items as Parameters<typeof domain.ingestIndexes>[1], message.page as Parameters<typeof domain.ingestIndexes>[2]); return { ok: true }; }
            if (message.operation === 'detail') return { ok: true, changed: await domain.ingestDetail(message.accountId as string, message.conversationId as string, message.detail as Parameters<typeof domain.ingestDetail>[2], message.indexFields as Parameters<typeof domain.ingestDetail>[3]) };
        }
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

    return { local, writes: () => writes, fail: (key?: string) => { failKey = key; },
        restore() { globalThis.chrome = previous; globalThis.indexedDB = previousDB; globalThis.IDBKeyRange = previousRange;
            IDBObjectStore.prototype.put = originalPut; } };
}

/** Catalog-aware application tests use the same storage boundary as production reads. */
export function useIndexStorage(): void {
    let environment: ReturnType<typeof indexStorage>;
    beforeEach(() => { environment = indexStorage(); });
    afterEach(() => { environment.restore(); });
}
