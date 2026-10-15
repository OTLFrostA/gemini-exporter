import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexFixture } from './helpers/indexFixture.js';
import { mergeConversation } from '../src/core/utils/mergeUtils.js';

test('index activity time is monotonic regardless of observation source', () => {
    const old = indexFixture({ id: 'source-independent', title: 'Stored', titleSource: 'rpc', updatedAt: 2000 });
    for (const source of ['network-list', 'network-detail', 'stream-live', 'takeout', 'sniff', 'unknown']) {
        for (const [time, expected] of [[1000, 2000], [3000, 3000]] as const) {
            const incoming = indexFixture({ id: old.id, title: 'Stored', titleSource: 'rpc', updatedAt: time });
            const merged = mergeConversation(old, incoming, { source });
            assert.equal(merged.merged.updatedAt, expected, `${source}: incoming activity ${time}`);
            assert.equal(old.updatedAt, 2000, 'merging must not mutate the stored observation');
        }
    }
});
