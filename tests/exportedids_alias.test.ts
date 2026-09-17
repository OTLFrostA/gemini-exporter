export {};
const test = require('node:test');
const assert = require('node:assert');

// Regression tests for exportedIds triple-alias write bloat.
// Historical writers stored three alias keys per conversation
// (raw id / normId(id) / 'c_'+normId(id)) in the in-memory maps.
// The fix: writes use the single canonical key normId(id); the read path
// (StorageService.getExportedIds, ConversationsStore.setExportedIds) folds
// legacy alias keys back to canonical, so readers probe the single canonical
// key instead of a triple lookup, and no migration is needed.

const { finalizeChatExport } = require('../src/core/engine/export/sessionRecovery.js');
const { normId } = require('../src/core/utils/pathUtils.js');
const { exportedIdsKey } = require('../src/core/utils/constants.js');
const ConversationsStore = require('../src/ui/state/conversationsStore.js');

// Same alias-tolerant lookup the production readers use.
const lookup = (map: Record<string, any>, id: string) => {
    const nid = normId(id);
    return map[id] || map['c_' + nid] || map[nid] || null;
};

async function runFinalize(targetId: string) {
    const nid = normId(targetId);
    const rec = { exportedAt: '2026-09-16T00:00:00.000Z', title: 't', format: 'markdown' };
    const exportedIds: Record<string, any> = {};
    const curIds: Record<string, any> = {};
    const ok = await finalizeChatExport(targetId, {
        finalizedChatsSet: new Set<string>(),
        chatRecordsMap: new Map<string, any>([[nid, rec]]),
        chatFailedAssetsSet: new Set<string>(),
        curIds,
        exportedIds,
        storageAdapter: { saveExportRecord: async () => ({}) },
        onItemExported: () => {}
    });
    return { ok, nid, rec, exportedIds, curIds };
}

test('exportedIds alias - finalizeChatExport writes a single canonical key (padded id -> 3 aliases before fix)', async () => {
    // '  xyz789  ' trims to 'xyz789': old code wrote 3 distinct keys
    // ('  xyz789  ', 'xyz789', 'c_xyz789'); fixed code writes exactly 1.
    const { ok, nid, rec, exportedIds, curIds } = await runFinalize('  xyz789  ');
    assert.strictEqual(ok, true);
    assert.strictEqual(nid, 'xyz789');
    assert.deepStrictEqual(Object.keys(exportedIds), ['xyz789']);
    assert.deepStrictEqual(Object.keys(curIds), ['xyz789']);
    assert.strictEqual(exportedIds['xyz789'], rec);
});

test('exportedIds alias - finalizeChatExport writes a single canonical key (c_ prefixed id)', async () => {
    const { ok, nid, exportedIds, curIds } = await runFinalize('c_abc123');
    assert.strictEqual(ok, true);
    assert.strictEqual(nid, 'abc123');
    assert.deepStrictEqual(Object.keys(exportedIds), ['abc123']);
    assert.deepStrictEqual(Object.keys(curIds), ['abc123']);
});

test('exportedIds alias - canonical write stays readable via every historical alias', async () => {
    const { exportedIds, rec } = await runFinalize('c_abc123');
    for (const alias of ['c_abc123', 'abc123', 'c_abc123']) {
        assert.strictEqual(lookup(exportedIds, alias), rec, `lookup via ${alias}`);
    }
});

test('exportedIds alias - legacy alias-only map still resolves (no migration needed)', () => {
    const rec = { exportedAt: '2026-01-01T00:00:00.000Z' };
    // Simulates a map persisted by the old triple-alias writers.
    const legacy: Record<string, any> = { 'c_xyz789': rec, 'xyz789': rec };
    assert.strictEqual(lookup(legacy, 'xyz789'), rec);
    assert.strictEqual(lookup(legacy, 'c_xyz789'), rec);

    ConversationsStore.setExportedIds(legacy);
    assert.strictEqual(ConversationsStore.getExportedRecord('xyz789'), rec);
    assert.strictEqual(ConversationsStore.getExportedRecord('c_xyz789'), rec);
    assert.strictEqual(ConversationsStore.getExportedRecord('nope'), null);
});

test('exportedIdsKey - canonical key computation and slot fallback', () => {
    assert.strictEqual(exportedIdsKey('u0'), 'exportedIds');
    assert.strictEqual(exportedIdsKey('u1'), 'gemini_exported_u1');
    assert.strictEqual(exportedIdsKey('u2'), 'gemini_exported_u2');
    assert.strictEqual(exportedIdsKey(null), 'exportedIds');
    assert.strictEqual(exportedIdsKey(undefined), 'exportedIds');
    assert.strictEqual(exportedIdsKey(''), 'exportedIds');
    assert.strictEqual(exportedIdsKey(), 'exportedIds');
});
