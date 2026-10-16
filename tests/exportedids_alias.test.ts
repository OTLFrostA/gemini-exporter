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
const { StorageService } = require('../src/core/storage/storageService.js');
const { indexStorage } = require('./helpers/indexStorage.js');

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

test('finalizeChatExport admits one concurrent finalization per conversation', async () => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const finalizedChatsSet = new Set<string>();
    let saves = 0;
    let callbacks = 0;
    const context = {
        finalizedChatsSet,
        chatRecordsMap: new Map([['abc123', { status: 'ok' }]]),
        storageAdapter: { saveExportRecord: async () => { saves++; entered(); await gate; } },
        onItemExported: () => { callbacks++; }
    };
    const first = finalizeChatExport('abc123', context);
    await started;
    const second = finalizeChatExport('abc123', context);
    release();
    const outcomes = await Promise.all([first, second]);
    assert.deepStrictEqual(outcomes, [true, false]);
    assert.strictEqual(saves, 1);
    assert.strictEqual(callbacks, 1);
});

test('exportedIds alias - real StorageService writes one key and UI resolves both ID forms', async () => {
    const environment = indexStorage();
    const previous = ConversationsStore.getExportedIds();
    try {
        const record = { exportedAt: '2026-09-16T00:00:00.000Z', title: 'Saved', status: 'ok' };
        await StorageService.saveExportRecord('u1', 'c_abc123', record);
        const physical = environment.local['gemini_exported_u1'] as Record<string, any>;
        assert.deepStrictEqual(Object.keys(physical), ['abc123'],
            'persistence must store exactly one canonical key, not the three legacy aliases');

        const stored = await StorageService.getExportedIds('u1');
        assert.deepStrictEqual(Object.keys(stored), ['abc123']);
        assert.deepStrictEqual(stored.abc123, record);
        ConversationsStore.setExportedIds(stored);
        for (const alias of ['abc123', 'c_abc123']) {
            assert.deepStrictEqual(ConversationsStore.getExportedRecord(alias), record,
                `UI must resolve a stored record through ${alias}`);
        }
    } finally {
        ConversationsStore.setExportedIds(previous);
        environment.restore();
    }
});

test('exportedIds alias - legacy alias-only storage is normalized on read without migration', async () => {
    const record = { exportedAt: '2026-01-01T00:00:00.000Z' };
    const environment = indexStorage({ gemini_exported_u1: { c_xyz789: record } });
    const previous = ConversationsStore.getExportedIds();
    try {
        const records = await StorageService.getExportedIds('u1');
        assert.deepStrictEqual(Object.keys(records), ['xyz789'],
            'legacy-only storage must be readable without a canonical sibling');
        assert.deepStrictEqual(records.xyz789, record);
        assert.equal(environment.writes(), 0, 'reads should not rewrite an old record to normalize aliases');
        assert.deepStrictEqual(Object.keys(environment.local.gemini_exported_u1 as object), ['c_xyz789'],
            'the raw legacy map stays intact until an explicit persistence operation');

        ConversationsStore.setExportedIds(records);
        for (const alias of ['xyz789', 'c_xyz789']) {
            assert.deepStrictEqual(ConversationsStore.getExportedRecord(alias), record);
        }

        const newer = { exportedAt: '2026-02-01T00:00:00.000Z' };
        environment.local.gemini_exported_u1 = { c_xyz789: record, xyz789: newer };
        const conflict = await StorageService.getExportedIds('u1');
        assert.deepStrictEqual(conflict, { xyz789: newer },
            'an authoritative canonical record must win over a stale legacy alias');
    } finally {
        ConversationsStore.setExportedIds(previous);
        environment.restore();
    }
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

test('exportedIds - finalizeChatExport persists export record with partial status when assets fail', async () => {
    const targetId = 'chat_partial_123';
    const nid = normId(targetId);
    const rec = { exportedAt: '2026-09-21T00:00:00.000Z', title: 'test partial', format: 'markdown', status: 'ok' };
    const exportedIds: Record<string, any> = {};
    const curIds: Record<string, any> = {};
    const failedSet = new Set<string>([nid]);
    let savedInStorage: any = null;

    const ok = await finalizeChatExport(targetId, {
        finalizedChatsSet: new Set<string>(),
        chatRecordsMap: new Map<string, any>([[nid, rec]]),
        chatFailedAssetsSet: failedSet,
        curIds,
        exportedIds,
        storageAdapter: {
            saveExportRecord: async (_slot: any, _id: any, r: any) => {
                savedInStorage = r;
                return {};
            }
        },
        onItemExported: () => {}
    });

    assert.strictEqual(ok, true, 'finalizeChatExport must succeed even when attachments fail');
    assert.strictEqual(rec.status, 'partial', 'status must be updated to partial');
    assert.strictEqual((rec as any).hasFailedAssets, true, 'hasFailedAssets flag must be true');
    assert.strictEqual(exportedIds[nid].status, 'partial');
    assert.strictEqual(exportedIds[nid].hasFailedAssets, true);
    assert.strictEqual(curIds[nid].status, 'partial');
    assert.strictEqual(savedInStorage.status, 'partial');
    assert.strictEqual(savedInStorage.hasFailedAssets, true);
});

test('exportedIds - finalizeChatExport preserves empty status with hasFailedAssets flag', async () => {
    const targetId = 'chat_empty_fail_456';
    const nid = normId(targetId);
    const rec = { exportedAt: '2026-09-21T00:00:00.000Z', title: 'empty chat', format: 'markdown', status: 'empty' };
    const exportedIds: Record<string, any> = {};
    const curIds: Record<string, any> = {};
    const failedSet = new Set<string>([nid]);

    const ok = await finalizeChatExport(targetId, {
        finalizedChatsSet: new Set<string>(),
        chatRecordsMap: new Map<string, any>([[nid, rec]]),
        chatFailedAssetsSet: failedSet,
        curIds,
        exportedIds,
        storageAdapter: { saveExportRecord: async () => ({}) },
        onItemExported: () => {}
    });

    assert.strictEqual(ok, true);
    assert.strictEqual(rec.status, 'empty', 'empty status must remain empty');
    assert.strictEqual((rec as any).hasFailedAssets, true);
    assert.strictEqual(exportedIds[nid].status, 'empty');
    assert.strictEqual(exportedIds[nid].hasFailedAssets, true);
});

test('locale - badgeExportedPartial exists in zh and en locales', () => {
    const zh = require('../src/core/utils/locales/zh.js');
    const en = require('../src/core/utils/locales/en.js');
    const zhDict = zh.zh || zh.default || zh;
    const enDict = en.en || en.default || en;
    assert.strictEqual(zhDict.badgeExportedPartial, '已导出 (部分附件缺失)');
    assert.strictEqual(enDict.badgeExportedPartial, 'Exported (Partial Assets)');
});
