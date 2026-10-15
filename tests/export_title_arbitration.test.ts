import test from 'node:test';
import assert from 'node:assert/strict';
import { indexFixture } from './helpers/indexFixture.js';
import { mergeConversationIndex } from '../src/core/domain/conversationIndex.js';

for (const [oldSource, newSource, title] of [
    ['rpc', 'takeout', 'Stored title'], ['takeout', 'rpc', 'Incoming title'],
    ['dom', 'dom', 'Incoming title'], ['legacy', 'sniff', 'Incoming title'],
] as const) {
    test(`index title arbitration ${oldSource} -> ${newSource}`, () => {
        const old = indexFixture({ id: 'chat', title: 'Stored title', titleSource: oldSource, hasTakeoutImport: true });
        const incoming = indexFixture({ id: 'chat', title: 'Incoming title', titleSource: newSource });
        const merged = mergeConversationIndex(old, incoming);
        assert.equal(merged.title, title);
        assert.equal(merged.hasTakeoutImport, true);
        assert.equal('titles' in merged, false);
        assert.equal(old.title, 'Stored title');
    });
}
