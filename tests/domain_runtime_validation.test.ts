import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateParserDomain, restoreDomainSnapshot } from '../src/core/domain/runtimeValidation.js';
import type { DomainConversationWithDetail } from '../src/core/domain/conversation.js';

function valid(): DomainConversationWithDetail {
    return { index: { cloudAvailability: 'unknown', hasTakeoutImport: false, titleSource: 'legacy', providerId: 'future', id: 'independent', title: 'Fixture' }, detail: { completeness: 'unknown', assets: [{ id: 'image', kind: 'image' }], messages: [{ role: 'assistant',
            citations: [{ id: 'cite', url: 'https://example.test' }],
            content: [{ type: 'paragraph', children: [{ type: 'image', assetId: 'image' }, { type: 'citationRef', citationId: 'cite' }] },
                { type: 'unknown', sourceType: 'future', text: 'preserved' }] }] } };
}
test('parser validation preserves identity; recovery isolates all nested objects without brand fields', () => {
    const input = valid();
    const json = JSON.stringify(input);
    assert.equal(validateParserDomain(input), input);
    const restored = restoreDomainSnapshot(input);
    assert.deepEqual(restored, input);
    assert.notEqual(restored.detail.messages, input.detail.messages);
    assert.equal(JSON.stringify(restored), json);
    assert.deepEqual(Object.getOwnPropertySymbols(restored), []);
    restored.detail.assets[0].id = 'changed';
    assert.equal(input.detail.assets[0].id, 'image');
    restored.detail.messages[0].citations![0].url = 'https://changed.test';
    assert.equal(input.detail.messages[0].citations![0].url, 'https://example.test',
        'a snapshot must deep-clone message-local citations, not just its top-level arrays');
});
test('both entry points reject independent malformed graphs and nonportable values', () => {
    const negatives: unknown[] = [
        { index: { ...valid().index, title: 4 }, detail: { ...valid().detail } }, { index: { ...valid().index }, detail: { ...valid().detail, messages: {} } }, { index: { ...valid().index }, detail: { ...valid().detail }, timestamp: Infinity },
        { index: { ...valid().index }, detail: { ...valid().detail, completeness: { status: 'fabricated' } } }, { index: { ...valid().index }, detail: { ...valid().detail }, extra: true },
        { index: { ...valid().index }, detail: { ...valid().detail, messages: [{ role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'text', text: 1 }] }] }] } },
        { index: { ...valid().index }, detail: { ...valid().detail, assets: [] } },
        { index: { ...valid().index }, detail: { ...valid().detail, messages: [{ role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'citationRef', citationId: 'missing' }] }] }] } },
        { index: { ...valid().index }, detail: { ...valid().detail, assets: [{ id: 'image', kind: 'image' }, { id: 'image', kind: 'image' }] } },
        { index: { ...valid().index }, detail: { ...valid().detail, messages: [{ role: 'assistant', content: [], attachmentIds: ['image', 'image'] }] } },
        { index: { ...valid().index, title: () => 'bad' }, detail: { ...valid().detail } }, { index: { ...valid().index }, detail: { ...valid().detail }, timestamp: 1n },
    ];
    const cycle = valid(); cycle.detail.messages[0].content.push({ type: 'quote', blocks: cycle.detail.messages[0].content });
    negatives.push(cycle);
    for (const input of negatives) {
        assert.throws(() => restoreDomainSnapshot(input));
        // Deliberately corrupted producer output: runtime validation must protect the contract.
        assert.throws(() => validateParserDomain(input as DomainConversationWithDetail));
    }
});
test('storage rejects toJSON laundering, parser does not silently normalize it', () => {
    const value = { index: { ...valid().index }, detail: { ...valid().detail }, toJSON: () => valid() };
    assert.throws(() => restoreDomainSnapshot(value));
    assert.throws(() => validateParserDomain(value));
});


test('both entry points share index identity and reference closure rules', () => {
    for (const id of ['', '   ', ' padded ']) {
        const value = valid(); value.index.id = id;
        assert.throws(() => validateParserDomain(value), TypeError);
        assert.throws(() => restoreDomainSnapshot(value), TypeError);
    }
    const empty = valid();
    empty.detail.assets = []; empty.detail.messages = [];
    assert.equal(validateParserDomain(empty), empty);
    assert.deepEqual(restoreDomainSnapshot(empty), empty);
});

test('both entry points reject holes and undefined elements throughout nested Domain arrays', () => {
    const hole = <T>(): T[] => new Array<T>(1);
    const cases: Array<(value: DomainConversationWithDetail) => void> = [
        v => { v.detail.messages = hole(); },
        v => { v.detail.assets = hole(); },
        v => { v.detail.messages[0].content = hole(); },
        v => { v.detail.messages[0].reasoning = hole(); },
        v => { v.detail.messages[0].attachmentIds = hole(); },
        v => { v.detail.messages[0].citations = hole(); },
        v => { v.detail.messages[0].content = [{ type: 'paragraph', children: hole() }]; },
        v => { v.detail.messages[0].content = [{ type: 'paragraph', children: [{ type: 'strong', children: hole() }] }]; },
        v => { v.detail.messages[0].content = [{ type: 'list', ordered: false, items: hole() }]; },
        v => { v.detail.messages[0].content = [{ type: 'list', ordered: false, items: [{ blocks: hole() }] }]; },
        v => { v.detail.messages[0].content = [{ type: 'quote', blocks: hole() }]; },
        v => { v.detail.messages[0].content = [{ type: 'table', columns: hole(), rows: [] }]; },
        v => { v.detail.messages[0].content = [{ type: 'table', headerRows: hole(), rows: [] }]; },
        v => { v.detail.messages[0].content = [{ type: 'table', rows: hole() }]; },
        v => { v.detail.messages[0].content = [{ type: 'table', rows: [{ cells: hole() }] }]; },
        v => { v.detail.messages[0].content = [{ type: 'table', rows: [{ cells: [{ children: hole() }] }] }]; },
        v => { v.detail.messages[0].content = [{ type: 'image', assetId: 'image', caption: hole() }]; },
        v => { v.detail.messages[0].content = [{ type: 'file', assetId: 'image', description: hole() }]; },
    ];
    for (const [index, corrupt] of cases.entries()) {
        const value = valid(); corrupt(value);
        assert.throws(() => validateParserDomain(value), TypeError, `parser case ${index}`);
        assert.throws(() => restoreDomainSnapshot(value), TypeError, `storage case ${index}`);
        // JSON represents the same unusable positions as null, which must also fail.
        assert.throws(() => restoreDomainSnapshot(JSON.parse(JSON.stringify(value))), TypeError);
    }
    const undefinedNode = valid();
    Object.assign(undefinedNode.detail.messages[0].content, { 0: undefined });
    assert.throws(() => validateParserDomain(undefinedNode), TypeError);
    assert.throws(() => restoreDomainSnapshot(undefinedNode), TypeError);
});
