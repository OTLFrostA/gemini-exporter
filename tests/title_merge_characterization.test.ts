import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeConversation } from '../src/core/utils/mergeUtils.js';
import { resolveTitle, resolveDetailTitle, setTitleBySource, applyExportTitleWriteback } from '../src/core/utils/titleUtils.js';

test('title merge characterizes source ordering, including Takeout over prompt fallback', () => {
    const sources = ['rpc', 'api-detail', 'dom', 'takeout', 'openai', 'sniff', 'legacy'] as const;
    for (let i = 0; i < sources.length - 1; i++) {
        const strong = sources[i];
        const weak = sources[i + 1];
        const stronger = { id: 'title-order', title: 'Authoritative title', titleSource: strong, titles: { [strong]: 'Authoritative title' } };
        const weaker = { id: 'title-order', title: 'Fallback title', titleSource: weak, titles: { [weak]: 'Fallback title' } };
        for (const [old, incoming] of [[stronger, weaker], [weaker, stronger]]) {
            const { merged } = mergeConversation(old, incoming);
            assert.equal(merged.title, 'Authoritative title');
            assert.equal(merged.titleSource, strong);
            assert.deepEqual(resolveTitle(merged), { title: merged.title, source: merged.titleSource });
        }
    }
});

test('empty incoming titles preserve the existing title and source through all write paths', () => {
    for (const title of ['', '   ', '\t\n']) {
        const old = { id: 'empty-title', title: 'Stored RPC title', titleSource: 'rpc', titles: { rpc: 'Stored RPC title' } };
        const incoming = { id: old.id, title, titleSource: 'rpc', titles: { rpc: title } };
        const { merged } = mergeConversation(old, incoming);
        assert.equal(merged.title, old.title);
        assert.equal(merged.titleSource, 'rpc');
        assert.equal(merged.titles.rpc, old.title);
        setTitleBySource(old, 'rpc', title);
        assert.equal(old.title, 'Stored RPC title');
        assert.equal(applyExportTitleWriteback(old, incoming), old);
        assert.equal(old.title, 'Stored RPC title');
    }
});

test('missing fields and metadata retain legacy and default fallback semantics', () => {
    assert.deepEqual(resolveTitle(null), { title: '未命名对话', source: 'default' });
    assert.deepEqual(resolveTitle({}), { title: '未命名对话', source: 'default' });
    const { merged } = mergeConversation(undefined, { id: 'missing-fields', title: 'Unprovenanced title' });
    assert.equal(merged.titleSource, 'legacy');
    assert.equal(merged.titles.legacy, merged.title);
    assert.equal(resolveDetailTitle(undefined), null);
    assert.equal(resolveDetailTitle([{ role: 'user' }]), null);
    assert.deepEqual(resolveDetailTitle([{ role: 'user', content: 'Prompt derived title' }]), { title: 'Prompt derived title', source: 'sniff' });
});

test('title arbitration preserves monotonic activity, body protection and incoming extension data', () => {
    const messages = [{ role: 'user' as const, content: 'Full conversation' }];
    const old = { id: 'merge-fields', title: 'RPC title', titleSource: 'rpc', timestamp: 5000, updatedAt: 5000, createdAt: 2000, lastSeen: 9000, messageCount: 4, messages, attachmentCount: 2 };
    const incoming = { id: old.id, title: 'Offline title', titleSource: 'takeout', timestamp: 3000, createdAt: 1000, lastSeen: 8000, messageCount: 1, messages: [], attachmentCount: 1, extensionData: { keep: true } };
    const { merged, isChanged } = mergeConversation(old, incoming, { source: 'takeout-import', targetSlot: '2' });
    assert.equal(merged.updatedAt, 5000);
    assert.equal(merged.timestamp, 5000);
    assert.equal(merged.createdAt, 1000);
    assert.equal(merged.lastSeen, 9000);
    assert.equal(merged.messageCount, 4);
    assert.equal(merged.messages, messages);
    assert.equal(merged.attachmentCount, 1);
    assert.equal(merged.source, 'takeout-import');
    assert.equal(merged.accountSlot, '2');
    assert.equal(isChanged, true);
    assert.deepEqual(Reflect.get(merged, 'extensionData'), { keep: true });
});

// These cases describe ingestion behavior, including raw-field precedence and observed time.
test('metadata merge preserves timestamp precedence, creation time and lastSeen encoding', () => {
    const base = { id: 'merge-metadata', title: 'Stored RPC title', titleSource: 'rpc', titles: { rpc: 'Stored RPC title' }, timestamp: 5000, updatedAt: 5000 };
    const cases: Array<{
        old: import('../src/core/utils/mergeUtils.js').ConversationMergeInput;
        incoming: import('../src/core/utils/mergeUtils.js').ConversationMergeInput;
        updated: number | null; created: number | null; seen?: number | string; changed: boolean;
    }> = [
        { old: base, incoming: { updatedAt: 9000 }, updated: 9000, created: null, changed: true },
        { old: base, incoming: { updatedAt: 3000 }, updated: 5000, created: null, changed: false },
        { old: base, incoming: { createdAt: 2000, lastSeen: 90000 }, updated: 5000, created: 2000, seen: 90000, changed: false },
        { old: { ...base, updatedAt: 'invalid', timestamp: 5000 }, incoming: { updatedAt: 'invalid', timestamp: 9000 }, updated: 5000, created: null, changed: false },
        { old: { ...base, updatedAt: 0, timestamp: 9000 }, incoming: { updatedAt: 1000 }, updated: 1000, created: null, changed: true },
        { old: { ...base, updatedAt: null, timestamp: null }, incoming: { lastSeen: '2026-10-13T00:00:00Z' }, updated: null, created: null, seen: '2026-10-13T00:00:00Z', changed: false },
        { old: { ...base, createdAt: '2026-10-13T00:00:00Z', lastSeen: 2000 }, incoming: { updatedAt: '1700000000', createdAt: '1700000000', lastSeen: '1700000000000' }, updated: 1700000000000, created: 1700000000000, seen: 2000, changed: true },
        { old: { ...base, createdAt: 2000, lastSeen: 1000 }, incoming: { createdAt: 3000, lastSeen: '1970-01-01T00:00:01.000Z' }, updated: 5000, created: 2000, seen: 1000, changed: false },
    ];
    for (const { old, incoming, updated, created, seen, changed } of cases) {
        const result = mergeConversation(old, incoming);
        assert.equal(result.merged.timestamp, updated);
        assert.equal(result.merged.updatedAt, updated);
        assert.equal(result.merged.createdAt, created);
        assert.equal(result.merged.lastSeen, seen);
        assert.equal(result.isChanged, changed);
        assert.equal(result.hasDirtyTitles, false);
    }
});

test('declared count, loaded body and effective count retain their separate merge behavior', () => {
    const base = { id: 'merge-body', title: 'Stored RPC title', titleSource: 'rpc', titles: { rpc: 'Stored RPC title' }, timestamp: 5000, updatedAt: 5000 };
    const full = Array.from({ length: 5 }, (_, i) => ({ role: 'assistant' as const, content: `Full response ${i}` }));
    const partial = full.slice(0, 2);
    const longer = [...full, ...partial];
    for (const body of [undefined, [], partial]) {
        const result = mergeConversation({ ...base, messages: full, messageCount: 5 }, { ...base, messages: body, messageCount: body?.length });
        assert.equal(result.merged.messages, full);
        assert.equal(result.merged.messageCount, 5);
        assert.equal(result.isChanged, false);
        assert.equal(result.hasDirtyTitles, false);
    }
    const growing = mergeConversation({ ...base, messages: full, messageCount: 5 }, { ...base, messages: longer });
    assert.equal(growing.merged.messages, longer);
    assert.equal(growing.merged.messageCount, 5, 'loading more body does not invent a declared count');
    assert.equal(growing.isChanged, true);

    const metadataGrowth = mergeConversation({ ...base, messages: full }, { ...base, messages: partial, messageCount: 8 });
    assert.equal(metadataGrowth.merged.messages, full, 'a larger declared count does not permit a shorter loaded body to replace the old body');
    assert.equal(metadataGrowth.merged.messageCount, 8);
    assert.equal(metadataGrowth.isChanged, true);

    const slim = mergeConversation({ ...base, messageCount: 5 }, { ...base, messages: partial, turns: [{ userContent: 'Partial turn' }], messageCount: 2 });
    assert.equal(Object.hasOwn(slim.merged, 'messages'), false);
    assert.equal(Object.hasOwn(slim.merged, 'turns'), false);
    assert.equal(slim.merged.messageCount, 5);
    assert.equal(slim.isChanged, false);

    const oldTurns = Array.from({ length: 5 }, (_, i) => ({ userContent: `Turn ${i}` }));
    const turns = mergeConversation({ ...base, turns: oldTurns }, { ...base, turns: oldTurns.slice(0, 2) });
    assert.equal(turns.merged.turns, oldTurns);
    assert.equal(turns.merged.messageCount, 5);
    assert.equal(turns.isChanged, false);
});
