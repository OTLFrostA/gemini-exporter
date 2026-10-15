import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIndexObservation } from '../src/core/compatibility/index/parseIndex.js';
import { mergeConversationIndex } from '../src/core/domain/conversationIndex.js';

for (const source of ['openai', 'sniff', 'api-detail', 'rpc', 'takeout', 'dom'] as const) {
    test(`legacy ${source} title candidate resolves before entering Domain`, () => {
        const old = parseIndexObservation({ id: 'chat', title: 'Historical fallback title', titles: { [source]: 'Authoritative title' } }, 'legacy');
        const incoming = parseIndexObservation({ id: 'chat', title: 'New fallback title' }, 'legacy');
        const merged = mergeConversationIndex(old, incoming);
        assert.equal(merged.title, 'Authoritative title');
        assert.equal(merged.titleSource, source);
        assert.equal('titles' in merged, false);
    });
}
test('a historical title without provenance becomes an explicit legacy candidate', () => {
    const index = parseIndexObservation({ id: 'chat', title: 'Historical title' }, 'legacy');
    assert.equal(index.title, 'Historical title');
    assert.equal(index.titleSource, 'legacy');
});
