/**
 * Contract-shaped L1 test doubles. This module is preloaded BEFORE any L1 import
 * by scripts/test-l1-units.cjs. Nothing here starts L2, Runtime or IndexedDB.
 *
 * Types are checked against the frozen v2 public entrypoints. Mock decisions are
 * scripted by tests; this deliberately does NOT reproduce L2 selection/Coverage.
 */
import type { Account } from '../../src/l2/accountRegistry.js';
import type { ConversationKey } from '../../src/l2/conversationKey.js';
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
export const OTHER_ACCOUNT: Account = {
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
    indexes: [] as IndexCall[],
    details: [] as DetailCall[],
    deletions: [] as DeletedCall[],
    lookups: [] as string[],
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
        this.indexes.length = 0; this.details.length = 0; this.deletions.length = 0; this.lookups.length = 0;
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
const accountRegistry: Pick<typeof import('../../src/runtime/api/accountRegistry.js'),
    'getAccount' | 'getOrCreateAccount' | 'listAccounts'> = {
    async getAccount(accountId) {
        ports.lookups.push(accountId);
        const account = ports.accounts.get(accountId);
        return account ? { ...account } : null;
    },
    async getOrCreateAccount(providerId, providerAccountId, email, displayName) {
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
    'resolveRequestAccount' | 'resolveCurrentAccount' | 'getAccountContext'> = {
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
};

const keyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const readConversationKey: typeof import('../../src/l2/conversationKey.js').readConversationKey = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).some(k => k !== 'accountId' && k !== 'conversationId'))
        throw new TypeError('Invalid conversation key');
    const { accountId, conversationId } = value as ConversationKey;
    if (!keyPattern.test(accountId) || typeof conversationId !== 'string'
        || !conversationId || conversationId !== conversationId.trim())
        throw new TypeError('Invalid conversation key');
    return { accountId, conversationId };
};
const normalizeTimestamp: typeof import('../../src/l2/time.js').normalizeTimestamp = value => {
    if (typeof value === 'number') return Number.isSafeInteger(value) ? value : undefined;
    if (typeof value !== 'string' || !value.trim()) return undefined;
    const text = value.trim();
    const ms = /^-?\d+$/.test(text) ? Number(text) : Date.parse(text);
    return Number.isSafeInteger(ms) ? ms : undefined;
};

type Loader = { _load(request: string, parent: { filename?: string } | undefined, isMain: boolean): unknown };
const loader = require('node:module') as Loader;
let installed = false;

/** Install only at the L1 import boundary. The unit runner also rejects
 * accidental direct runtime imports by its own unit files. */
export function installL1V2Mocks(): void {
    if (installed) return;
    installed = true;
    const originalLoad = loader._load;
    loader._load = (request, parent, isMain) => {
        const parentPath = parent?.filename?.replace(/\\/g, '/') ?? '';
        if (parentPath.includes('/src/l1/')) {
            if (request.endsWith('/l2/ingestion.js')) return ingestion;
            if (request.endsWith('/runtime/api/domainIngestion.js')) return ingestion;
            if (request.endsWith('/runtime/api/accountRegistry.js')) return accountRegistry;
            if (request.endsWith('/runtime/content/accountContext.js')) return accountContext;
            if (request.endsWith('/runtime/content/cleanupRegistry.js')) return { registerCleanup: () => () => {} };
            if (request.endsWith('/l2/conversationKey.js')) return { readConversationKey };
            if (request.endsWith('/l2/time.js')) return { normalizeTimestamp };
            if (/\/(?:l2|l3a|l3b|l4|runtime|application|ui)\//.test(request) && !request.endsWith('.d.ts'))
                throw new Error('Unmocked external dependency in L1 unit test: ' + request + ' from ' + parentPath);
        }
        return Reflect.apply(originalLoad, loader, [request, parent, isMain]);
    };
}
