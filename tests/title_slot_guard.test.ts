import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLegacyConversationIndex } from '../src/core/parsers/legacyStorage/parseIndex.js';
import { mergeConversationIndex } from '../src/core/domain/conversationIndex.js';

for (const source of ['openai', 'sniff', 'api-detail', 'rpc', 'takeout', 'dom'] as const) {
    test(`legacy ${source} title candidate resolves before entering Domain`, () => {
        const old = parseLegacyConversationIndex({ id: 'chat', title: 'Historical fallback title', titles: { [source]: 'Authoritative title' } });
        const incoming = parseLegacyConversationIndex({ id: 'chat', title: 'New fallback title' });
        const merged = mergeConversationIndex(old, incoming);
        assert.equal(merged.title, 'Authoritative title');
        assert.equal(merged.titleSource, source);
        assert.equal('titles' in merged, false);
    });
}
test('a historical title without provenance becomes an explicit legacy candidate', () => {
    const index = parseLegacyConversationIndex({ id: 'chat', title: 'Historical title' });
    assert.equal(index.title, 'Historical title');
    assert.equal(index.titleSource, 'legacy');
});
