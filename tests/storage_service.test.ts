import test from 'node:test';
import assert from 'node:assert/strict';
import * as storage from '../src/l3a/storageService.js';
import { indexStorage, useIndexStorage } from './helpers/indexStorage.js';
import { fixtureKey } from './helpers/domainFixture.js';

import { getSettings, updateSettings } from '../src/application/settings/index.js';
useIndexStorage();
test('compound storage keys partition identical provider IDs by Account UUID', async () => {
    const key = fixtureKey('same'), other = { ...key, accountId: '20000000-0000-4000-8000-000000000002' };
    await storage.putIndexes([{ key, title: 'First', titleSource: 'provider' }, { key: other, title: 'Second', titleSource: 'provider' }]);
    assert.equal((await storage.getIndex(key))?.title, 'First');
    assert.equal((await storage.listIndexes(other.accountId))[0].title, 'Second');
});
test('storage never infers deletions from an incoming page or migration batch', async () => {
    const key = fixtureKey('older'), next = fixtureKey('newer');
    await storage.putIndexes([{ key }]);
    await storage.putIndexes([{ key: next }]);
    await storage.putIndexes([]);
    assert.equal((await storage.listIndexes(key.accountId)).length, 2);
});
test('format defaults and preference writes belong to Application Settings', async () => {
    assert.equal((await getSettings()).defaultFormat, 'markdown');
    for (const format of ['markdown', 'html', 'json', 'pdf'] as const) {
        await updateSettings({ defaultFormat: format });
        assert.equal((await getSettings()).defaultFormat, format);
    }
});
