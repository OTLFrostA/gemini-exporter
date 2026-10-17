import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexFixture } from './helpers/indexFixture.js';
import { mergeConversation } from '../src/core/domain/indexCollection.js';

test('index activity time is monotonic without a source-specific merge option', () => {
    const old = indexFixture({ id: 'source-independent', title: 'Stored', titleSource: 'rpc', updatedAt: 2000 });
    for (const [time, expected] of [[1000, 2000], [3000, 3000]] as const) {
        const incoming = indexFixture({ id: old.key.conversationId, title: 'Stored', titleSource: 'rpc', updatedAt: time });
        const merged = mergeConversation(old, incoming);
        assert.equal(merged.merged.updatedAt, expected);
        assert.equal(old.updatedAt, 2000, 'merging must not mutate the stored observation');
    }
});
