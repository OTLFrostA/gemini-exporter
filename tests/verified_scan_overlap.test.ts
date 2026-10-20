import test from 'node:test';
import assert from 'node:assert/strict';
import { indexStorage } from './helpers/indexStorage.js';
import { ACCOUNT_UUID } from './helpers/accountRuntime.js';
import { defaultGeminiProvider } from '../src/l1/client/gemini/geminiProvider.js';
import { ProviderRegistry } from '../src/l1/client/providerRegistry.js';
import { scanAll } from '../src/application/sync/scanController.js';

test('production scan entry admits one pagination call per account and releases the lock on completion', async () => {
    const store = indexStorage();
    const original = ProviderRegistry.get('gemini');
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    let calls = 0;
    let first: ReturnType<typeof scanAll> | undefined;
    const provider = Object.create(defaultGeminiProvider) as typeof defaultGeminiProvider;
    provider.listConversations = async () => { calls++; entered(); await gate; return 'source_end'; };
    ProviderRegistry.unregister('gemini');
    ProviderRegistry.register(provider);
    try {
        first = scanAll({ accountId: ACCOUNT_UUID });
        await started;
        assert.deepEqual(await scanAll({ accountId: ACCOUNT_UUID }), {
            status: 'error', reason: 'Scan already running', pagesFetched: 0, conversationsFetched: 0,
        });
        assert.equal(calls, 1);
        release();
        assert.equal((await first).status, 'complete');
        assert.equal((await scanAll({ accountId: ACCOUNT_UUID })).status, 'complete');
        assert.equal(calls, 2);
    } finally {
        release(); await first;
        ProviderRegistry.unregister('gemini');
        if (original) ProviderRegistry.register(original);
        store.restore();
    }
});
