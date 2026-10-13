import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateParserDomain, restoreDomainSnapshot } from '../src/core/domain/runtimeValidation.js';
import type { DomainConversationDetail } from '../src/core/domain/conversationDetail.js';

function valid(): DomainConversationDetail {
    return { providerId: 'future', id: 'independent', title: 'Fixture', timestamp: null,
        assets: [{ id: 'image', kind: 'image' }], messages: [{ role: 'assistant',
            citations: [{ id: 'cite', url: 'https://example.test' }],
            content: [{ type: 'paragraph', children: [{ type: 'image', assetId: 'image' }, { type: 'citationRef', citationId: 'cite' }] },
                { type: 'unknown', sourceType: 'future', text: 'preserved' }] }] };
}
test('parser validation preserves identity; recovery isolates all nested objects without brand fields', () => {
    const input = valid();
    const json = JSON.stringify(input);
    assert.equal(validateParserDomain(input), input);
    const restored = restoreDomainSnapshot(input);
    assert.deepEqual(restored, input);
    assert.notEqual(restored.messages, input.messages);
    assert.equal(JSON.stringify(restored), json);
    assert.deepEqual(Object.getOwnPropertySymbols(restored), []);
    restored.assets[0].id = 'changed';
    assert.equal(input.assets[0].id, 'image');
});
test('both entry points reject independent malformed graphs and nonportable values', () => {
    const negatives: unknown[] = [
        { ...valid(), title: 4 }, { ...valid(), messages: {} }, { ...valid(), timestamp: Infinity },
        { ...valid(), completeness: { status: 'fabricated' } }, { ...valid(), extra: true },
        { ...valid(), messages: [{ role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'text', text: 1 }] }] }] },
        { ...valid(), assets: [] },
        { ...valid(), messages: [{ role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'citationRef', citationId: 'missing' }] }] }] },
        { ...valid(), assets: [{ id: 'image', kind: 'image' }, { id: 'image', kind: 'image' }] },
        { ...valid(), messages: [{ role: 'assistant', content: [], attachmentIds: ['image', 'image'] }] },
        { ...valid(), title: () => 'bad' }, { ...valid(), timestamp: 1n },
    ];
    const cycle = valid(); cycle.messages[0].content.push({ type: 'quote', blocks: cycle.messages[0].content });
    negatives.push(cycle);
    for (const input of negatives) {
        assert.throws(() => restoreDomainSnapshot(input));
        // Deliberately corrupted producer output: runtime validation must protect the contract.
        assert.throws(() => validateParserDomain(input as DomainConversationDetail));
    }
});
test('storage rejects toJSON laundering, parser does not silently normalize it', () => {
    const value = { ...valid(), toJSON: () => valid() };
    assert.throws(() => restoreDomainSnapshot(value));
    assert.throws(() => validateParserDomain(value));
});
