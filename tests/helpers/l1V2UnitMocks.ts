/**
 * Contract-shaped L1 test doubles. This module is preloaded BEFORE any L1 import
 * by scripts/test-l1-units.cjs. Nothing here starts L2, Runtime or IndexedDB.
 *
 * Types are checked against the frozen v2 public entrypoints. Mock decisions are
 * scripted by tests; this deliberately does NOT reproduce L2 selection/Coverage.
 */
import { provideProviderHost } from '../../src/l1/client/providerHost.js';
import { provideContentRuntimeHost } from '../../src/l1/contentPorts.js';
import type { Account } from '../../src/l2/accountRegistry.js';
import type { DetailIngestResult } from '../../src/l2/ingestion.js';
import type { AccountContext } from '../../src/runtime/content/accountContext.js';

type Ingest = typeof import('../../src/l2/ingestion.js');
type IndexCall = { accountId: Parameters<Ingest['ingestIndexes']>[0];
    items: Parameters<Ingest['ingestIndexes']>[1]; page: Parameters<Ingest['ingestIndexes']>[2] };
type DetailCall = { accountId: Parameters<Ingest['ingestDetail']>[0];
    conversationId: Parameters<Ingest['ingestDetail']>[1];
    detail: Parameters<Ingest['ingestDetail']>[2]; indexFields: Parameters<Ingest['ingestDetail']>[3] };
type DeletedCall = Parameters<Ingest['ingestDeletedConversation']>;

export const GEMINI_ACCOUNT: Account = {
    id: '10000000-0000-4000-8000-000000000001', providerId: 'gemini', providerAccountId: '10000000001',
};
const OTHER_ACCOUNT: Account = {
    id: '10000000-0000-4000-8000-000000000002', providerId: 'gemini', providerAccountId: '10000000002',
};
export const DEFAULT_ACCOUNT: Account = {
    id: '10000000-0000-4000-8000-000000000003', providerId: 'gemini', providerAccountId: 'default',
};
export const CHATGPT_ACCOUNT: Account = {
    id: '10000000-0000-4000-8000-000000000004', providerId: 'chatgpt',
    providerAccountId: JSON.stringify(['user-1', 'workspace-1']),
};

type Hook = () => void | Promise<void>;
const initialAccounts = [GEMINI_ACCOUNT, OTHER_ACCOUNT, DEFAULT_ACCOUNT, CHATGPT_ACCOUNT];
export const ports = {
    accounts: new Map<string, Account>(),
    cooldowns: new Map<string, number>(),
    indexes: [] as IndexCall[],
    details: [] as DetailCall[],
    deletions: [] as DeletedCall[],
    lookups: [] as string[],
    notifications: [] as string[],
    detailDecision: { accepted: true, changed: true } as DetailIngestResult,
    indexError: null as Error | null,
    detailError: null as Error | null,
    deletionError: null as Error | null,
    beforeIndexCommit: undefined as Hook | undefined,
    beforeDetailCommit: undefined as Hook | undefined,
    beforeDeletionCommit: undefined as Hook | undefined,
    current: null as AccountContext | null,
    reset() {
        this.accounts = new Map(initialAccounts.map(account => [account.id, { ...account }]));
        this.cooldowns.clear();
        this.notifications.length = 0; this.indexes.length = 0; this.details.length = 0; this.deletions.length = 0; this.lookups.length = 0;
        this.detailDecision = { accepted: true, changed: true };
        this.indexError = null; this.detailError = null; this.deletionError = null;
        this.beforeIndexCommit = undefined; this.beforeDetailCommit = undefined;
        this.beforeDeletionCommit = undefined;
        this.current = { providerId: 'gemini', accountId: GEMINI_ACCOUNT.id, slot: 'u0' };
    },
};
ports.reset();

const ingestion: Pick<Ingest, 'ingestIndexes' | 'ingestDetail' | 'ingestDeletedConversation'> = {
    async ingestIndexes(accountId, items, page) {
        await ports.beforeIndexCommit?.();
        if (ports.indexError) throw ports.indexError;
        ports.indexes.push({ accountId, items, page });
        return { added: items.length, updated: 0, accepted: items.length, rejected: 0 };
    },
    async ingestDetail(accountId, conversationId, detail, indexFields) {
        await ports.beforeDetailCommit?.();
        if (ports.detailError) throw ports.detailError;
        ports.details.push({ accountId, conversationId, detail, indexFields });
        if (!ports.detailDecision.accepted && ports.detailDecision.changed)
            throw new TypeError('Invalid mock admission: rejected candidate cannot be changed');
        return { ...ports.detailDecision };
    },
    async ingestDeletedConversation(accountId, conversationId) {
        await ports.beforeDeletionCommit?.();
        if (ports.deletionError) throw ports.deletionError;
        ports.deletions.push([accountId, conversationId]);
    },
};
const cooldownStorage: Pick<typeof import('../../src/l3a/storageService.js'), 'getSourceCooldown' | 'extendSourceCooldown'> = {
    async getSourceCooldown(accountId) { return ports.cooldowns.get(accountId) ?? 0; },
    async extendSourceCooldown(accountId, until) {
        const deadline = Math.max(ports.cooldowns.get(accountId) ?? 0, until);
        ports.cooldowns.set(accountId, deadline);
        return deadline;
    },
};
const accountRegistry: Pick<typeof import('../../src/runtime/api/accountRegistry.js'),
    'getAccount' | 'getOrCreateAccount' | 'listAccounts'> = {
    async getAccount(accountId) {
        ports.lookups.push(accountId);
        const account = ports.accounts.get(accountId);
        return account ? { ...account } : null;
    },
    async getOrCreateAccount(providerId, providerAccountId, email, displayName) {
        // Script one valid L2 fallback response: unknown source can be assigned real A.
        if (providerId === 'gemini' && providerAccountId === 'default') {
            const existingReal = [...ports.accounts.values()].filter(a =>
                a.providerId === providerId && a.providerAccountId !== 'default')
                .sort((a, b) => a.id.localeCompare(b.id))[0];
            if (existingReal) return { ...existingReal };
        }
        const found = [...ports.accounts.values()].find(a =>
            a.providerId === providerId && a.providerAccountId === providerAccountId);
        if (found) return { ...found };
        const created: Account = { id: crypto.randomUUID(), providerId, providerAccountId,
            ...(email ? { email } : {}), ...(displayName ? { displayName } : {}) };
        ports.accounts.set(created.id, created);
        return { ...created };
    },
    async listAccounts(providerId) {
        return [...ports.accounts.values()].filter(a => !providerId || providerId === a.providerId).map(a => ({ ...a }));
    },
};
const accountContext: Pick<typeof import('../../src/runtime/content/accountContext.js'),
    'resolveRequestAccount' | 'resolveCurrentAccount' | 'getAccountContext' | 'matchesCurrentAccount'
    | 'isCurrentAccount' | 'invalidateAccountContext' | 'setAccountChangedHandler'> = {
    async resolveRequestAccount(observation, slot) {
        if (observation === undefined || typeof slot !== 'string' || !/^u\d+$/.test(slot)) return null;
        if (observation !== null && (typeof observation !== 'object' || Array.isArray(observation))) return null;
        const source = observation === null
            ? { providerId: 'gemini', providerAccountId: 'default' }
            : observation as { providerId?: string; providerAccountId?: string };
        if (source.providerId !== 'gemini' || !source.providerAccountId) return null;
        const account = await accountRegistry.getOrCreateAccount(source.providerId, source.providerAccountId);
        return { providerId: account.providerId, accountId: account.id, slot };
    },
    async resolveCurrentAccount() { return ports.current ? { ...ports.current } : null; },
    getAccountContext() { return ports.current ? { ...ports.current } : null; },
    matchesCurrentAccount(observation) {
        const current = ports.current && ports.accounts.get(ports.current.accountId);
        return !!current && current.providerId === observation.providerId
            && current.providerAccountId === observation.providerAccountId;
    },
    isCurrentAccount(context) { return !!ports.current && context.accountId === ports.current.accountId
        && context.providerId === ports.current.providerId && context.slot === ports.current.slot; },
    invalidateAccountContext() { ports.current = null; },
    setAccountChangedHandler() {},
};

type Loader = { _load(request: string, parent: { filename?: string } | undefined, isMain: boolean): unknown };
const loader = require('node:module') as Loader;
let installed = false;

/** Install only at the L1 import boundary. Pure L2 domain validators/AST helpers
 * load directly; stateful ingestion, storage and Runtime ports are mocked. */
export function installL1V2Mocks(): void {
    if (installed) return;
    installed = true;
    const originalLoad = loader._load;
    loader._load = (request, parent, isMain) => {
        const parentPath = parent?.filename?.replace(/\\/g, '/') ?? '';
        if (parentPath.includes('/tests/')
            && ['l3a', 'l3b', 'l4', 'runtime', 'application', 'ui']
                .some(layer => request.includes('/src/' + layer + '/')))
            throw new Error('L1 unit test directly loaded external implementation: ' + request);
        if (parentPath.includes('/src/l1/') || parentPath.includes('/src/shared/')) {
            if (request.endsWith('/l2/ingestion.js')) return ingestion;
            if (request.endsWith('/l2/sourceCooldown.js')) return cooldownStorage;
            if (request.endsWith('/l3a/storageService.js')) return cooldownStorage;
            if (request.endsWith('/runtime/api/domainIngestion.js')) return ingestion;
            if (request.endsWith('/runtime/api/contentDomainIngestion.js')) return {
                ingestContentIndexes: ingestion.ingestIndexes,
                ingestContentDetail: ingestion.ingestDetail,
                ingestContentDeletedConversation: ingestion.ingestDeletedConversation,
            };
            if (request.endsWith('/runtime/api/domainChanges.js')) return { notifyDomainChanged: (id: string) => { ports.notifications.push(id); } };
            if (request.endsWith('/runtime/api/contentAccountRegistry.js')) return {
                getContentAccount: accountRegistry.getAccount,
                getOrCreateContentAccount: accountRegistry.getOrCreateAccount,
            };
            if (request.endsWith('/runtime/content/accountContext.js')) return accountContext;
            if (request.endsWith('/runtime/content/cleanupRegistry.js')) return { registerCleanup: () => () => {} };
            if (/\/(?:l3a|l3b|l4|runtime|application|ui)\//.test(request) && !request.endsWith('.d.ts'))
                throw new Error('Unmocked external dependency in L1 unit test: ' + request + ' from ' + parentPath);
        }
        return Reflect.apply(originalLoad, loader, [request, parent, isMain]);
    };
    provideProviderHost({
        getAccount: accountRegistry.getAccount,
        async resolveProviderRoute(_providerId, accountId) {
            if (ports.current?.accountId !== accountId) throw new Error('No mocked Gemini account route');
            return ports.current.slot;
        },
        ingestion: {
            ingestIndexes: ingestion.ingestIndexes,
            ingestDetail: ingestion.ingestDetail,
            ingestDeletedConversation: ingestion.ingestDeletedConversation,
        },
        cooldown: {
            getSourceCooldown: cooldownStorage.getSourceCooldown,
            extendSourceCooldown: cooldownStorage.extendSourceCooldown,
        },
    });
    provideContentRuntimeHost({
        ingestion: {
            ingestIndexes: ingestion.ingestIndexes,
            ingestDetail: ingestion.ingestDetail,
            ingestDeletedConversation: ingestion.ingestDeletedConversation,
        },
        account: {
            getAccount: accountRegistry.getAccount,
            resolveRequestAccount: accountContext.resolveRequestAccount,
            resolveCurrentAccount: accountContext.resolveCurrentAccount,
            matchesCurrentAccount: accountContext.matchesCurrentAccount,
            isCurrentAccount: context => context !== null && accountContext.isCurrentAccount(context),
        },
        registerCleanup: () => () => {},
    });
}
