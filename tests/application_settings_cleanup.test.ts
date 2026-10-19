import { key, address, reset, events, state, records, indexes, details, seed } from './helpers/applicationHarness.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { getSettings, updateSettings, isLiveSaveEffective } from '../src/core/application/settings/index.js';
import { clearLocalScanRecords, clearLocalExportRecords } from '../src/core/application/localCleanup.js';

test.beforeEach(reset);
test('Settings defaults are applied only on read; explicit false is preserved', async () => {
    assert.deepEqual(await getSettings(), { defaultFormat: 'markdown', skipExported: true, includeAssets: true, enabledDisk: false, developerMode: false });
    assert.deepEqual(events, []);
    await updateSettings({ includeAssets: false, language: 'en' });
    await updateSettings({ enabledDisk: true });
    const settings = await getSettings();
    assert.equal(settings.includeAssets, false);
    assert.equal(settings.language, 'en'); assert.equal(settings.enabledDisk, true);
});
test('Live Save format and directory changes pause effectiveness without mutating user intent', async () => {
    await updateSettings({ enabledDisk: true });
    const markdown = await getSettings();
    assert.equal(isLiveSaveEffective(markdown, true), true);
    assert.equal(isLiveSaveEffective(markdown, false), false);
    for (const defaultFormat of ['pdf', 'html', 'json'] as const) {
        await updateSettings({ defaultFormat });
        assert.equal(isLiveSaveEffective(await getSettings(), true), false);
        assert.equal((await getSettings()).enabledDisk, true);
    }
    await updateSettings({ defaultFormat: 'markdown' });
    assert.equal(isLiveSaveEffective(await getSettings(), true), true);
    assert.equal(events.filter(event => event === 'settings-write').length, 5);
});
test('Settings IO failures propagate instead of silently manufacturing defaults or claiming success', async () => {
    state.failRead = true; await assert.rejects(getSettings(), /read failed/);
    state.failSettingsWrite = true; await assert.rejects(updateSettings({ language: 'en' }), /write failed/);
    assert.deepEqual(events, []);
});
test('record cleanup enumerates only the requested account and does not touch Domain', async () => {
    seed();
    const record = { exportedAt: 1, format: 'markdown' as const, status: 'ok' as const };
    records.set(address(key()), record); records.set(address(key('second')), record);
    const other = { accountId: '10000000-0000-4000-8000-000000000002', conversationId: 'first' };
    records.set(address(other), record);
    await clearLocalExportRecords(key().accountId);
    assert.deepEqual(events, ['delete-record:first', 'delete-record:second']);
    assert.equal(records.size, 1); assert.equal(records.has(address(other)), true); assert.equal(indexes.size, 1);
});
test('scan cleanup clears coverage and export history, preserving Index and Detail', async () => {
    seed(); records.set(address(key()), { exportedAt: 1, format: 'markdown', status: 'ok' });
    await clearLocalScanRecords(key().accountId);
    assert.deepEqual(events, [`clear-coverage:${key().accountId}`, 'delete-record:first']);
    assert.equal(indexes.size, 1); assert.equal(details.size, 1); assert.equal(records.size, 0);
});
test('scan cleanup failure propagates without deleting Domain or claiming success', async () => {
    seed(); state.failDelete = 'coverage';
    await assert.rejects(clearLocalScanRecords(key().accountId), /coverage failed/);
    assert.equal(indexes.size, 1); assert.equal(details.size, 1);
});
