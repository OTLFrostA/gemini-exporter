export {};
const test = require('node:test');
const assert = require('node:assert');

// Shared credential storage owns the session-to-local downgrade. Reload only
// the three modules under test, then restore their original require.cache and
// Chrome globals so the suite cannot change module singletons for other tests.
const modulePaths = [
    '../src/core/api/client/credStorage.js',
    '../src/core/api/client/credentialManager.js',
    '../src/content/bootstrap.js',
];

async function withCredentialModules<T>(
    chromeMock: unknown,
    check: (modules: { credStorage: any; credManager: any; bootstrap: any }) => Promise<T> | T,
): Promise<T> {
    const g = globalThis as any;
    const chromeDescriptor = Object.getOwnPropertyDescriptor(g, 'chrome');
    const ids = modulePaths.map((p) => require.resolve(p));
    const previous = ids.map((id: string) => require.cache[id]);
    if (chromeMock === undefined) delete g.chrome;
    else Object.defineProperty(g, 'chrome', { value: chromeMock, writable: true, configurable: true });
    try {
        for (const id of ids) delete require.cache[id];
        const credStorage = require('../src/core/api/client/credStorage.js');
        const credManager = require('../src/core/api/client/credentialManager.js').default;
        const bootstrap = require('../src/content/bootstrap.js');
        return await check({ credStorage, credManager, bootstrap });
    } finally {
        ids.forEach((id: string, i: number) => {
            if (previous[i]) require.cache[id] = previous[i];
            else delete require.cache[id];
        });
        if (chromeDescriptor) Object.defineProperty(g, 'chrome', chromeDescriptor);
        else delete g.chrome;
    }
}

function makeChromeMock(sessionFailure: 'get' | 'set' | null) {
    const sessionCalls: string[] = [];
    const denied = new Error('not allowed to access chrome.storage.session');
    const stores: Record<string, Record<string, any>> = { local: {}, session: {} };
    const area = (name: 'local' | 'session') => ({
        get: async (keys: any) => {
            if (name === 'session') sessionCalls.push('get');
            if (name === 'session' && sessionFailure === 'get') throw denied;
            const out: Record<string, any> = {};
            for (const k of (Array.isArray(keys) ? keys : [keys])) {
                if (Object.prototype.hasOwnProperty.call(stores[name], k)) out[k] = stores[name][k];
            }
            return out;
        },
        set: async (items: any) => {
            if (name === 'session') sessionCalls.push('set');
            if (name === 'session' && sessionFailure === 'set') throw denied;
            Object.assign(stores[name], structuredClone(items));
        },
        remove: async (keys: any) => {
            if (name === 'session') sessionCalls.push('remove');
            for (const k of (Array.isArray(keys) ? keys : [keys])) delete stores[name][k];
        },
    });
    return { mock: { storage: { local: area('local'), session: area('session') } }, stores, sessionCalls };
}

test('unified: every surface prefers a healthy session and reads its credentials', async () => {
    const { mock, stores } = makeChromeMock(null);
    await withCredentialModules(mock, async ({ credStorage, credManager, bootstrap }) => {
        assert.strictEqual(credManager.getCredStorage(), mock.storage.session);
        assert.strictEqual(bootstrap.getCredStorage(), mock.storage.session);
        assert.strictEqual(credStorage.getCredStorage(), mock.storage.session);
        await bootstrap.saveCredentials({ u0: { at: 'fake-token' } });
        assert.deepStrictEqual(await bootstrap.loadCredentialsMap(), { u0: { at: 'fake-token' } });
        assert.deepStrictEqual(stores.session.GEMINI_CREDENTIALS_MAP, undefined);
        assert.equal(Object.keys(stores.session).length > 0, true, 'healthy session must hold the saved map');
    });
});

test('unified: session read denial downgrades all surfaces and subsequent I/O to local', async () => {
    const { mock, stores, sessionCalls } = makeChromeMock('get');
    await withCredentialModules(mock, async ({ credStorage, credManager, bootstrap }) => {
        assert.deepStrictEqual(await bootstrap.loadCredentialsMap(), {});
        assert.deepStrictEqual(sessionCalls, ['get'], 'initial session denial must be exercised');
        for (const surface of [credStorage, credManager, bootstrap]) {
            assert.strictEqual(surface.getCredStorage(), mock.storage.local, 'every surface must share the downgrade');
        }
        sessionCalls.length = 0;
        const map = { u0: { at: 'read-fallback' } };
        await bootstrap.saveCredentials(map);
        assert.deepStrictEqual(await bootstrap.loadCredentialsMap(), map);
        assert.deepStrictEqual(sessionCalls, [], 'no session I/O after the shared downgrade');
        assert.ok(Object.values(stores.local).some(value => JSON.stringify(value) === JSON.stringify(map)),
            'fallback must persist credentials in local storage');
    });
});

test('unified: session write denial also downgrades all surfaces and retains the credential map', async () => {
    const { mock, stores, sessionCalls } = makeChromeMock('set');
    await withCredentialModules(mock, async ({ credStorage, credManager, bootstrap }) => {
        const map = { u1: { at: 'write-fallback' } };
        await bootstrap.saveCredentials(map);
        assert.deepStrictEqual(sessionCalls, ['set'], 'actual session write rejection must be exercised');
        assert.deepStrictEqual(await bootstrap.loadCredentialsMap(), map);
        for (const surface of [credStorage, credManager, bootstrap]) {
            assert.strictEqual(surface.getCredStorage(), mock.storage.local);
        }
        assert.ok(Object.values(stores.local).some(value => JSON.stringify(value) === JSON.stringify(map)));
        assert.deepStrictEqual(sessionCalls, ['set'], 'retry and read must not touch a denied session');
    });
});

test('unified: shared resolver state and missing browser storage remain explicit', async () => {
    const { mock } = makeChromeMock(null);
    await withCredentialModules(mock, ({ credStorage }) => {
        assert.strictEqual(credStorage.getCredStorage(), mock.storage.session);
        credStorage.markCredSessionAccessFailed();
        assert.strictEqual(credStorage.getCredStorage(), mock.storage.local);
    });
    await withCredentialModules({ storage: { local: mock.storage.local } }, ({ credStorage }) => {
        assert.strictEqual(credStorage.getCredStorage(), mock.storage.local, 'missing session uses local');
    });
    await withCredentialModules(undefined, ({ credStorage }) => {
        assert.strictEqual(credStorage.getCredStorage(), null, 'no Chrome storage returns null');
    });
});
