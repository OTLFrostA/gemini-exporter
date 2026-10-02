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
