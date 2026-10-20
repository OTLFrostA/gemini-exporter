import test from 'node:test';
import assert from 'node:assert/strict';
import * as storage from '../src/core/storage/storageService.js';
import { indexStorage, useIndexStorage } from './helpers/indexStorage.js';
import { fixtureKey } from './helpers/domainFixture.js';

import { getSettings, updateSettings, isLiveSaveEffective } from '../src/core/application/settings/index.js';
useIndexStorage();
test('Storage preferences are sparse while Application supplies defaults', async () => {
    assert.deepEqual(await storage.getStoredSettings(), {});
    const defaults = await getSettings();
    assert.equal(defaults.defaultFormat, 'markdown'); assert.equal(defaults.enabledDisk, false); assert.equal(defaults.includeAssets, true);
    await updateSettings({ enabledDisk: true, includeAssets: false });
    assert.deepEqual(await storage.getStoredSettings(), { enabledDisk: true, includeAssets: false });
});
test('directory handle and enabledDisk are independent facts, effective permission stays transient', async () => {
    await updateSettings({ enabledDisk: true });
    assert.equal(await storage.getDirectoryHandle(), null);
    const settings = await getSettings();
    assert.equal(isLiveSaveEffective(settings, false), false);
    assert.equal(isLiveSaveEffective(settings, true), true);
    assert.equal(isLiveSaveEffective({ ...settings, defaultFormat: 'pdf' }, true), false);
    assert.equal((await storage.getStoredSettings()).enabledDisk, true);
});
