import test from 'node:test';
import assert from 'node:assert/strict';
import { makeConversationIndex } from './helpers/conversationIndexFixture.js';
import { indexFixture } from './helpers/indexFixture.js';
import { useIndexStorage } from './helpers/indexStorage.js';
import { indexActivityTime, mergeConversationIndex } from '../src/l2/conversationIndex.js';
import { ingestIndexes } from '../src/l2/ingestion.js';
import { getIndex, listIndexes, putAccount } from '../src/l3a/storageService.js';
import { ConversationViewState } from '../src/ui/options/state/conversationsStore.js';
import { shouldSkipExport } from '../src/application/export/runExport.js';
import { STORAGE_KEYS } from '../src/shared/utils/constants.js';

useIndexStorage({ seedAccounts: false });

const accountId = '10000000-0000-4000-8000-000000000001';

async function ensureSeedAccount(): Promise<void> {
    await putAccount({ id: accountId, providerId: 'gemini', providerAccountId: 'fixture' });
}

test('index activity time is monotonic without a source-specific merge option or input mutation', () => {
    const old = makeConversationIndex({
        key: { conversationId: 'source-independent' },
        title: 'Stored',
        titleSource: 'provider',
        updatedAt: 2000,
    });
    for (const [time, expected] of [[1000, 2000], [3000, 3000]] as const) {
        const incoming = makeConversationIndex({
            key: { conversationId: old.key.conversationId },
            title: 'Stored',
            titleSource: 'provider',
            updatedAt: time,
        });
        const merged = mergeConversationIndex(old, incoming);
        assert.equal(merged.updatedAt, expected);
        assert.equal(old.updatedAt, 2000, 'merging must not mutate the stored observation');
    }
});

test('indexActivityTime ignores client-observed lastSeen and never authorizes skipping unversioned exports', () => {
    const legacy = indexActivityTime as (input: unknown) => number | undefined;
    assert.strictEqual(legacy({ id: 'c_lastseen_only', lastSeen: '2026-09-03T12:00:00.000Z' }), undefined);
    assert.strictEqual(legacy({ id: 'c2', lastSeen: 1788100000000 }), undefined);
    const serverUpdatedAt = 1788000000000;
    assert.strictEqual(legacy({ id: 'c3', updatedAt: serverUpdatedAt, lastSeen: 1788100000000 }), serverUpdatedAt);

    const record = { exportedAt: 1788000000000, chatTime: 1788000000000, format: 'markdown' as const, status: 'ok' as const };
    const request = { keys: [], delivery: 'browserDownload' as const, includeAssets: false, skipUnchanged: true, format: 'markdown' as const };
    assert.equal(shouldSkipExport(record, undefined, request), false);
    assert.equal(shouldSkipExport(record, 1788000000000, request), true);
    assert.equal(shouldSkipExport(record, 1788100000000, request), false);
});

test('legacy timestamp normalization drops invalid strings, coerces numeric strings and keeps the newest value', () => {
    const conv = (over: Record<string, unknown> = {}) => ({ id: 'c_hygiene_4242', title: 'hygiene probe', titles: {}, ...over });

    assert.strictEqual(STORAGE_KEYS.LANG, 'gemini_exporter_lang');
    assert.strictEqual(STORAGE_KEYS.PENDING_TAKEOUT_PROMPT, 'gemini_pending_takeout_prompt');

    assert.strictEqual(
        mergeConversationIndex(
            indexFixture(conv({ timestamp: 'not-a-date', updatedAt: null })),
            indexFixture(conv({ timestamp: null, updatedAt: null })),
        ).updatedAt,
        undefined,
    );

    const coerced = mergeConversationIndex(
        indexFixture(conv({ timestamp: '1726358400000', updatedAt: null })),
        indexFixture(conv({ timestamp: null, updatedAt: null })),
    );
    assert.strictEqual(coerced.updatedAt, 1726358400000);
    assert.strictEqual(typeof coerced.updatedAt, 'number');

    assert.strictEqual(
        mergeConversationIndex(
            indexFixture(conv({ timestamp: 1000, updatedAt: null })),
            indexFixture(conv({ timestamp: 9000, updatedAt: null })),
        ).updatedAt,
        9000,
    );
});

test('persisted Index admission rejects client lastSeen fields and keeps undated observations undated', async () => {
    await ensureSeedAccount();
    for (const [id, previous] of [['new', undefined], ['existing', 1000]] as const) {
        const key = { accountId, conversationId: id };
        if (previous) await ingestIndexes(accountId, [{ conversationId: id, fields: { updatedAt: previous } }]);
        await ingestIndexes(accountId, [{ conversationId: id, fields: { updatedAt: 900 } }]);
        const index = await getIndex(key);
        assert.equal(index?.updatedAt, previous ?? 900);
        assert.equal(Object.hasOwn(index ?? {}, 'lastSeen'), false);
        assert.equal(Object.hasOwn(index ?? {}, 'timestamp'), false);
        await assert.rejects(
            ingestIndexes(accountId, [{ conversationId: id, fields: { lastSeen: '2099-01-01' } as never }]),
            /Invalid conversation index schema/,
        );
        assert.equal((await getIndex(key))?.updatedAt, previous ?? 900);
    }

    await ingestIndexes(accountId, [{ conversationId: 'undated', fields: {} }]);
    const undated = await getIndex({ accountId, conversationId: 'undated' });
    assert.equal(undated?.updatedAt, undefined);
    assert.equal(undated?.createdAt, undefined);
});

test('Index persistence retains imported conversations across partial provider pages without transient import flags', async () => {
    await ensureSeedAccount();
    for (const conversationId of ['mixed', 'takeout', 'active', 'stale']) {
        await ingestIndexes(accountId, [{
            conversationId,
            fields: { title: conversationId, titleSource: conversationId === 'active' ? 'provider' : 'derived' },
        }]);
    }
    await ingestIndexes(accountId, [{ conversationId: 'mixed', fields: { title: 'Authoritative title', titleSource: 'provider' } }]);

    const view = new ConversationViewState();
    view.selectAccount(accountId);
    await view.refresh();
    await ingestIndexes(accountId, [{ conversationId: 'active', fields: { title: 'Online active', titleSource: 'provider' } }]);
    await view.refresh();

    assert.deepEqual(new Set(view.indexes.map(x => x.key.conversationId)), new Set(['mixed', 'takeout', 'active', 'stale']));
    assert.equal(view.indexes.find(x => x.key.conversationId === 'mixed')?.title, 'Authoritative title');
    assert.equal(view.indexes.find(x => x.key.conversationId === 'takeout')?.titleSource, 'derived');

    const stored = await listIndexes(accountId);
    assert.deepEqual(new Set(stored.map(x => x.key.conversationId)), new Set(['mixed', 'takeout', 'active', 'stale']));
    for (const row of stored) {
        assert.equal('hasTakeoutImport' in row, false);
        assert.equal('isTakeoutOnly' in row, false);
    }
});
