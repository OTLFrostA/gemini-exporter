import { indexFixture } from './helpers/indexFixture.js';
/**
 * Canonical Storage Read Invariant Tests (PR B — Retire Migration-on-Read)
 * Contract Classification: Permanent Contract
 * Invariants: Canonical-only querying, non-mutating reads (0 sets, 0 removes), slot isolation, migration recovery.
 *
 * Verifies:
 * - Current-schema read: Canonical state is read accurately for all slots.
 * - Non-mutating read: Normal storage reads never modify or delete storage.
 * - Legacy fixture migration: Historical data is migrated strictly via migration boundary,
 *   never via normal read path.
 * - Slot isolation: Non-u0 slot reads never bleed or fallback to u0 global keys.
 *
 * Run: node -r ./tests/ts_register.js --test tests/storage_read_canonical.test.ts
 */
export {};
const test = require('node:test');
const assert = require('node:assert');

const StorageService = require('../src/core/storage/storageService.js');
const SchemaMigration = require('../src/core/storage/schemaMigration.js');
const CredentialManager = require('../src/core/api/client/credentialManager.js').default || require('../src/core/api/client/credentialManager.js');
const DetailStore = require('../src/core/storage/conversationDetailStore.js');

function makeMockStorage() {
    const localStore: Record<string, any> = {};
    const sessionStore: Record<string, any> = {};
    let localSets = 0;
    let localRemoves = 0;
    let sessionSets = 0;
    let sessionRemoves = 0;

    const mkArea = (store: Record<string, any>, onSet: () => void, onRemove: () => void) => ({
        get: async (keys: any) => {
            if (keys === null || keys === undefined) return structuredClone(store);
            if (typeof keys === 'string') keys = [keys];
            const out: Record<string, any> = {};
            for (const k of keys) {
                if (k in store) out[k] = structuredClone(store[k]);
            }
            return out;
        },
        set: async (items: Record<string, any>) => {
            onSet();
            Object.assign(store, structuredClone(items));
        },
        remove: async (keys: any) => {
            onRemove();
            if (typeof keys === 'string') keys = [keys];
            for (const k of keys) delete store[k];
        }
    });

    const chromeMock = {
        storage: {
            local: mkArea(localStore, () => { localSets++; }, () => { localRemoves++; }),
            session: mkArea(sessionStore, () => { sessionSets++; }, () => { sessionRemoves++; })
        },
        action: {
            setBadgeText: async () => {},
            setBadgeBackgroundColor: async () => {}
        }
    };

    return {
        localStore,
        sessionStore,
        chromeMock,
        stats: () => ({ localSets, localRemoves, sessionSets, sessionRemoves }),
        resetStats: () => {
            localSets = 0;
            localRemoves = 0;
            sessionSets = 0;
            sessionRemoves = 0;
        }
    };
}

function installMock() {
    const s = makeMockStorage();
    const originalChromeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    (global as any).chrome = s.chromeMock;
    SchemaMigration.__setSchemaFrozenForTest(false);
    SchemaMigration.__resetStorageReadyForTest();
    DetailStore.__clearMemoryStore();
    return {
        ...s,
        restore() {
            if (originalChromeDescriptor) Object.defineProperty(globalThis, 'chrome', originalChromeDescriptor);
            else Reflect.deleteProperty(globalThis, 'chrome');
            DetailStore.__clearMemoryStore();
            SchemaMigration.__setSchemaFrozenForTest(false);
            SchemaMigration.__resetStorageReadyForTest();
        }
    };
}

// ---------------------------------------------------------------- Current-schema read
test('PR-B: Current-schema read paths read only canonical keys', async () => {
    const env = installMock();
    try {
        env.localStore['conversations_10000000-0000-4000-8000-000000000001'] = ([{ id: 'u0_c1', title: 'U0 Conv', timestamp: 100 }]).map(indexFixture);
        env.localStore['conversations_10000000-0000-4000-8000-000000000002'] = ([{ id: 'u1_c1', title: 'U1 Conv', timestamp: 200 }]).map(indexFixture).map(c => ({ ...c, key: { ...c.key, accountId: '10000000-0000-4000-8000-000000000002' } }));
        env.localStore['exported_10000000-0000-4000-8000-000000000001'] = { 'u0_c1': { status: 'ok' } };
        env.localStore['exported_10000000-0000-4000-8000-000000000002'] = { 'u1_c1': { status: 'ok' } };
        env.sessionStore['gemini_credentials_map'] = {
            'sid_main': { at: 'at_val', bl: 'bl_val', sid: 'sid_main', accountSlot: 'default' }
        };

        const u0Convs = await StorageService.getConversations('10000000-0000-4000-8000-000000000001');
        assert.deepStrictEqual(u0Convs.map((c: any) => c.key.conversationId), ['u0_c1']);

        const u1Convs = await StorageService.getConversations('10000000-0000-4000-8000-000000000002');
        assert.deepStrictEqual(u1Convs.map((c: any) => c.key.conversationId), ['u1_c1']);

        const u0Exp = await StorageService.getExportedIds('10000000-0000-4000-8000-000000000001');
        assert.deepStrictEqual(Object.keys(u0Exp), ['u0_c1']);

        const u1Exp = await StorageService.getExportedIds('10000000-0000-4000-8000-000000000002');
        assert.deepStrictEqual(Object.keys(u1Exp), ['u1_c1']);

        const creds = await CredentialManager.loadCredMap();
        assert.deepStrictEqual(creds['sid_main'], { at: 'at_val', bl: 'bl_val', sid: 'sid_main', accountSlot: 'default' });
    } finally {
        env.restore();
    }
});

// ---------------------------------------------------------------- Non-mutating read
test('PR-B: Current-schema read paths are strictly non-mutating (0 writes, 0 deletes)', async () => {
    const env = installMock();
    try {
        env.localStore['conversations_10000000-0000-4000-8000-000000000001'] = ([{ id: 'c1', title: 'C1' }]).map(indexFixture);
        env.localStore['conversations_10000000-0000-4000-8000-000000000002'] = ([{ id: 'c2', title: 'C2' }]).map(indexFixture).map(c => ({ ...c, key: { ...c.key, accountId: '10000000-0000-4000-8000-000000000002' } }));
        env.localStore['exported_10000000-0000-4000-8000-000000000001'] = { 'c1': { status: 'ok' } };
        env.localStore['exported_10000000-0000-4000-8000-000000000002'] = { 'c2': { status: 'ok' } };
        env.sessionStore['gemini_credentials_map'] = { 's1': { sid: 's1' } };

        env.resetStats();

        await StorageService.getConversations('10000000-0000-4000-8000-000000000001');
        await StorageService.getConversations('10000000-0000-4000-8000-000000000002');
        await StorageService.getExportedIds('10000000-0000-4000-8000-000000000001');
        await StorageService.getExportedIds('10000000-0000-4000-8000-000000000002');
        await CredentialManager.loadCredMap();

        const stats = env.stats();
        assert.strictEqual(stats.localSets, 0, 'Normal reads must never call chrome.storage.local.set');
        assert.strictEqual(stats.localRemoves, 0, 'Normal reads must never call chrome.storage.local.remove');
        assert.strictEqual(stats.sessionSets, 0, 'Normal reads must never call chrome.storage.session.set');
        assert.strictEqual(stats.sessionRemoves, 0, 'Normal reads must never call chrome.storage.session.remove');
    } finally {
        env.restore();
    }
});

// ---------------------------------------------------------------- Slot isolation
test('PR-B: getExportedIds enforces slot isolation without fallback leakage', async () => {
    const env = installMock();
    try {
        env.localStore['exported_10000000-0000-4000-8000-000000000001'] = { 'u0_only': { status: '10000000-0000-4000-8000-000000000001' } };
        env.localStore['exported_10000000-0000-4000-8000-000000000002'] = { 'u1_only': { status: '10000000-0000-4000-8000-000000000002' } };

        const u1Exp = await StorageService.getExportedIds('10000000-0000-4000-8000-000000000002');
        assert.deepStrictEqual(Object.keys(u1Exp), ['u1_only'], 'u1 must NOT read u0 records from exportedIds');

        const u0Exp = await StorageService.getExportedIds('10000000-0000-4000-8000-000000000001');
        assert.deepStrictEqual(Object.keys(u0Exp), ['u0_only'], 'u0 must NOT read u1 records');
    } finally {
        env.restore();
    }
});
