import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationViewState } from '../src/ui/options/state/conversationsStore.js';
import { normId } from '../src/shared/utils/pathUtils.js';
import { conversationKey } from '../src/l2/conversationKey.js';
import type { DomainConversationIndex } from '../src/l2/conversationIndex.js';
import type { ExportRecord } from '../src/application/export/types.js';

const A = '10000000-0000-4000-8000-000000000001';
const B = '10000000-0000-4000-8000-000000000002';
const accounts = [A, B].map(id => ({ id, providerId: 'gemini', providerAccountId: id }));
const row = (id: string, accountId = A, updatedAt = 10): DomainConversationIndex => ({ key: conversationKey(accountId, id), title: id, updatedAt });
function view(rows = [row('one')], records: Record<string, ExportRecord> = {}) {
    return new ConversationViewState({ listAccounts: async () => accounts,
        listIndexes: async id => rows.filter(row => row.key.accountId === id), listExportRecords: async () => records });
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }

test('conversationsStore - canonical keys retain source identity; UI does not normalize provider IDs', () => {
    assert.equal(normId('c_12345678'), '12345678'); assert.equal(normId('12345678'), '12345678');
    assert.equal(normId(''), ''); assert.equal(normId(null), '');
    const state = view(); state.indexes = [row('c_12345678'), row('12345678')];
    state.selectVisible();
    assert.deepEqual(state.keys(), [conversationKey(A, 'c_12345678'), conversationKey(A, '12345678')]);
    assert.throws(() => conversationKey(A, ' '), /Invalid conversation key/);
});
test('conversationsStore - in-memory view state is per instance and account changes clear selection', async () => {
    const first = view(), second = view(); await first.refresh();
    first.selectVisible(); assert.equal(first.selected.size, 1); assert.equal(second.selected.size, 0);
    first.selectAccount(B); assert.equal(first.accountId, B); assert.deepEqual(first.indexes, []);
    assert.deepEqual(first.records, {}); assert.equal(first.selected.size, 0);
});
test('conversationsStore - export records use exact current Conversation IDs', async () => {
    const record: ExportRecord = { format: 'markdown', exportedAt: 5000, status: 'ok' };
    const state = view([row('123'), row('c_123')], { '123': record }); await state.refresh();
    state.filter = 'has_record'; assert.deepEqual(state.visible().map(r => r.key.conversationId), ['123']);
    state.filter = 'no_record'; assert.deepEqual(state.visible().map(r => r.key.conversationId), ['c_123']);
});
test('conversationsStore - refresh publishes changed titles and identities without a signature cache', async () => {
    let rows = [row('a')]; const state = new ConversationViewState({ listAccounts: async () => accounts,
        listIndexes: async () => rows, listExportRecords: async () => ({}) });
    await state.refresh(); assert.deepEqual(state.indexes, rows);
    rows = [{ ...row('b'), title: 'Real title' }]; await state.refresh();
    assert.deepEqual(state.indexes, rows); assert.equal(state.visible()[0].title, 'Real title');
});
test('conversationsStore retains canonical Index facts without introducing legacy flags', async () => {
    const rows = [{ ...row('imported'), title: 'Renamed online', titleSource: 'provider' as const }];
    const state = view(rows); await state.refresh();
    assert.deepEqual(state.indexes, rows); assert.equal(Object.hasOwn(state.indexes[0], 'hasTakeoutImport'), false);
});
test('conversationsStore consumes canonical indexes without rewriting them', async () => {
    const rows = [row('abc123')], state = view(rows); const snapshot = structuredClone(rows);
    await state.refresh(); state.search = 'abc'; state.visible();
    assert.deepEqual(rows, snapshot); assert.strictEqual(state.indexes[0], rows[0]);
});
test('conversationsStore refresh observes activity changes without a title or identity change', async () => {
    let rows = [row('first', A, 10), row('second', A, 20)];
    const state = new ConversationViewState({ listAccounts: async () => accounts, listIndexes: async () => rows, listExportRecords: async () => ({}) });
    await state.refresh(); assert.equal(state.visible()[0].key.conversationId, 'second');
    rows = [{ ...rows[0], updatedAt: 30 }, rows[1]]; await state.refresh();
    assert.equal(state.visible()[0].key.conversationId, 'first');
});
for (const switchAccount of [false, true]) test(`a delayed account load cannot replace a newer ${switchAccount ? 'account selection' : 'snapshot'}`, async () => {
    const held = deferred<DomainConversationIndex[]>(), started = deferred<void>(); let reads = 0;
    const state = new ConversationViewState({ listAccounts: async () => accounts, listExportRecords: async () => ({}),
        listIndexes: async id => { if (reads++ === 0) { started.resolve(); return held.promise; } return [row('newer', id)]; } });
    state.selectAccount(A); const old = state.refresh(); await started.promise;
    const next = switchAccount ? B : A; state.selectAccount(next); await state.refresh();
    held.resolve([row('older')]); await old;
    assert.equal(state.accountId, next); assert.deepEqual(state.indexes.map(r => r.key), [conversationKey(next, 'newer')]);
});
test('completion of an old account refresh cannot remove the same conversation from visible account B', async () => {
    const held = deferred<DomainConversationIndex[]>(), started = deferred<void>();
    const state = new ConversationViewState({ listAccounts: async () => accounts, listExportRecords: async () => ({}),
        listIndexes: async id => { if (id === A) { started.resolve(); return held.promise; } return [row('shared', B)]; } });
    state.selectAccount(A); const pending = state.refresh(); await started.promise;
    state.selectAccount(B); await state.refresh(); state.selected.add('shared'); held.resolve([]); await pending;
    assert.deepEqual(state.keys(), [conversationKey(B, 'shared')]);
});
