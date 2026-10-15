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
    __setModuleOverride('ConversationsStore', { getCurrentSlot: () => 'u0' });
    try {
        await init({ loadStore: async () => { refreshed++; } });
        assert.ok(listener);
        const originalSet = chrome.storage.local.set;
        chrome.storage.local.set = async values => {
            await originalSet(values);
            listener!(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { newValue: value }])), 'local');
        };
        await StorageService.ingestConversation('u0', historicalFixture({ id: 'chat', title: 'Fresh', messages: [{ role: 'user', content: 'Question' }] }));
        assert.equal(refreshed, 1);
        await StorageService.ingestConversation('u1', historicalFixture({ id: 'chat', title: 'Other account', messages: [{ role: 'user', content: 'Question' }] }));
        assert.equal(refreshed, 1);
    } finally {
        if (previousDocument === undefined) Reflect.deleteProperty(globalThis, 'document');
        else Reflect.set(globalThis, 'document', previousDocument);
        __clearModuleOverrides(); env.restore();
    }
});
