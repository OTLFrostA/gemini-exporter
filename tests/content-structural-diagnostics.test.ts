import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBundle } from '../src/core/export/canonical/validate.js';

test('nested content diagnostics identify their exact structural location', () => {
    const bundle = {
        schemaVersion: 1,
        conversation: {
            key: { providerId: 'test', accountId: 'account', conversationId: 'conversation' },
            messages: [{ id: 'message', role: 'assistant', blocks: [{
                type: 'list', ordered: false, items: [{ blocks: [{
                    type: 'quote', blocks: [{ type: 'image', assetId: 'missing' }],
                }] }],
            }] }],
        },
        assets: [], citations: [],
    };
    const unresolved = validateBundle(bundle).filter(d => d.code === 'ASSET_UNRESOLVED');
    assert.equal(unresolved.length, 1);
    assert.equal(unresolved[0].path, 'conversation.messages[0].blocks[0].items[0].blocks[0].blocks[0]');
});
