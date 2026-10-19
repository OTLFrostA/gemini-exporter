import { admitFixture, admitFixtures } from './helpers/admitFixture.js';
import * as DomainAdmission from '../src/core/domain/ingestion.js';
import { fixtureAccount } from './helpers/domainFixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { indexStorage } from './helpers/indexStorage.js';
import { historicalFixture } from './helpers/nativeFixture.js';
import { StorageService } from '../src/core/storage/storageService.js';
import { init } from '../src/ui/options/modules/optionsSync.js';
import { __setModuleOverride, __clearModuleOverrides } from '../src/core/utils/moduleOverrides.js';

test('Options observes accepted Index writes even when acquisition emits no syncUpdate message', async () => {
    const env = indexStorage();
    const previousDocument = Reflect.get(globalThis, 'document');
    let listener: Parameters<typeof chrome.storage.onChanged.addListener>[0] | undefined;
    let refreshed = 0;
    Reflect.set(globalThis, 'document', { getElementById: () => null });
    Reflect.set(chrome.storage, 'onChanged', { addListener: (fn: typeof listener) => { listener = fn; } });
    __setModuleOverride('ConversationsStore', { getCurrentAccountId: () => '10000000-0000-4000-8000-000000000001' });
    try {
        await init({ loadStore: async () => { refreshed++; } });
        assert.ok(listener);
        const originalSet = chrome.storage.local.set;
        chrome.storage.local.set = async values => {
            await originalSet(values);
            listener!(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { newValue: value }])), 'local');
        };
        await admitFixture('10000000-0000-4000-8000-000000000001', historicalFixture({ id: 'chat', title: 'Fresh', messages: [{ role: 'user', content: 'Question' }] }));
        assert.equal(refreshed, 1);
        await admitFixture('10000000-0000-4000-8000-000000000002', historicalFixture({ id: 'chat', title: 'Other account', messages: [{ role: 'user', content: 'Question' }] }, { account: fixtureAccount('gemini', '10000000-0000-4000-8000-000000000002') }));
        assert.equal(refreshed, 1);
    } finally {
        if (previousDocument === undefined) Reflect.deleteProperty(globalThis, 'document');
        else Reflect.set(globalThis, 'document', previousDocument);
        __clearModuleOverrides(); env.restore();
    }
});
