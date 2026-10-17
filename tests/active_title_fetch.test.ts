import { accountRuntime } from './helpers/accountRuntime.js';
import { indexStorage } from './helpers/indexStorage.js';
import { indexFixture } from './helpers/indexFixture.js';
export {};
const test = require('node:test');
const assert = require('node:assert/strict');
const { __setModuleOverride } = require('../src/core/utils/moduleOverrides.js');
const { scheduleActiveChatDetailFetch } = require('../src/content/syncEngine.js');
const { ProviderRegistry } = require('../src/core/provider/providerRegistry.js');
const { rpcFixture } = require('./helpers/nativeFixture.js');

test('active detail fetch retries unresolved or undated titles, but skips timestamped RPC titles', async (t: any) => {
    const store = indexStorage();
    const runtime = accountRuntime();
    const original = ProviderRegistry.getDefault();
    assert.ok(original, 'Gemini provider must be registered');
    const fetched: string[] = [];
    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
        ProviderRegistry.register({
            ...original,
            id: 'gemini',
            matchesUrl: () => true,
            fetchConversationDetail: async (id: string) => {
                fetched.push(id);
                // A valid parser-shaped detail without a source timestamp:
                // the scheduler is under test, not downstream storage writes.
                return rpcFixture({ id, title: 'Fetched detail', messages: [] });
            }
        });
        __setModuleOverride('StorageService', { getConversations: async () => ([
            { id: 'generic_title_01', title: 'Gemini', titleSource: 'default', timestamp: 1700000000000 },
            { id: 'sniff_title_01', title: 'Initial question', titleSource: 'sniff', timestamp: 1700000000000 },
            { id: 'resolved_title_01', title: 'A resolved conversation title', titleSource: 'rpc', timestamp: 1700000000000 },
            { id: 'undated_rpc_01', title: 'RPC title without server time', titleSource: 'rpc' }
        ]).map(indexFixture) });

        for (const id of ['generic_title_01', 'sniff_title_01', 'resolved_title_01', 'undated_rpc_01']) {
            scheduleActiveChatDetailFetch(id);
        }
        scheduleActiveChatDetailFetch('generic_title_01'); // duplicate before dispatch

        t.mock.timers.tick(200);
        await new Promise<void>(resolve => setImmediate(resolve));
        assert.deepEqual(fetched.slice().sort(), ['generic_title_01', 'sniff_title_01', 'undated_rpc_01'],
            'default/sniff and undated RPC titles need refresh; timestamped RPC titles do not');

        // Force bypasses the resolved-title guard; an in-flight ID remains deduplicated otherwise.
        scheduleActiveChatDetailFetch('resolved_title_01', { force: true });
        scheduleActiveChatDetailFetch('generic_title_01');
        t.mock.timers.tick(200);
        await new Promise<void>(resolve => setImmediate(resolve));
        assert.equal(fetched.filter(id => id === 'resolved_title_01').length, 1);
        assert.equal(fetched.filter(id => id === 'generic_title_01').length, 1);

        // The 10-second deduplication window must eventually expire.
        t.mock.timers.tick(10_000);
        scheduleActiveChatDetailFetch('generic_title_01');
        t.mock.timers.tick(200);
        await new Promise<void>(resolve => setImmediate(resolve));
        assert.equal(fetched.filter(id => id === 'generic_title_01').length, 2);
    } finally {
        // Let scheduled deduplication expiry callbacks run before restoring timers.
        t.mock.timers.tick(10_000);
        t.mock.timers.reset();
        __setModuleOverride('StorageService', null);
        ProviderRegistry.register(original);
        runtime.restore(); store.restore();
    }
});
