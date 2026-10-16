import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateParserDomain } from '../src/core/domain/runtimeValidation.js';
import { readStoredAcquisitionHints } from '../src/core/storage/domain/transport.js';
import { saveDomainRequest, saveDomainConversation, getStoredDomain, getDomainResource, __clearDomainMemory, storageIdentity, storedParseResult } from '../src/core/storage/domain/domainStore.js';

test('storage acquisition context retains only verified fields and rejects malformed inputs', async () => {
    const hints = { asset: { url: 'source', resolvedUrl: 'derived', localName: 'export/path', candidates: ['original'] } };
    const selected = readStoredAcquisitionHints(hints);
    assert.deepEqual(selected, { asset: { url: 'source', candidates: ['original'] } });
    hints.asset.candidates[0] = 'modified';
    assert.deepEqual(selected.asset.candidates, ['original'], 'transport hint lists must not alias caller arrays');

    for (const value of [null, [], { asset: null }, { asset: { url: 1 } },
        { asset: { candidates: ['valid', 1] } }]) {
        assert.throws(() => readStoredAcquisitionHints(value), TypeError);
    }
    const proto = JSON.parse('{"__proto__":{"url":"source"}}');
    const parsed = readStoredAcquisitionHints(proto);
    assert.deepEqual(Object.keys(parsed), ['__proto__']);
    assert.equal(Object.getPrototypeOf(parsed), Object.prototype, 'untrusted keys must not alter the result prototype');

    await assert.rejects(
        saveDomainRequest('10000000-0000-4000-8000-000000000001', { conversation: { providerId: 'gemini' }, acquisitionHints: {} }),
        TypeError, 'raw unvalidated objects cannot cross the storage write boundary',
    );
});

test('storage write, restore and native adaptation preserve detached Domain, hints and resource bytes', async () => {
    __clearDomainMemory();
    try {
        const original = validateParserDomain({
            index: { providerId: 'gemini', id: 'trust-copy-case', title: 'Original', titleSource: 'legacy',
                cloudAvailability: 'unknown', hasTakeoutImport: false },
            detail: {
                quality: { status: 'unknown' },
                assets: [{ id: 'asset', kind: 'file', sourceUri: 'opaque:original' }],
                messages: [{ role: 'user', attachmentIds: ['asset'],
                    content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Body' }] }] }],
            },
        });
        const candidates = ['opaque:original'];
        const bytes = new Uint8Array([1, 2, 3]);
        await saveDomainConversation('10000000-0000-4000-8000-000000000001',
            { conversation: original, acquisitionHints: { asset: { candidates } }, resourceHints: {}, diagnostics: [] },
            [{ assetId: 'asset', bytes }],
        );

        original.index.title = 'Mutated source';
        const paragraph = original.detail.messages[0].content[0];
        if (paragraph.type !== 'paragraph' || paragraph.children[0].type !== 'text') throw new Error('Invalid test fixture');
        paragraph.children[0].text = 'Mutated source';
        candidates[0] = 'mutated';
        bytes[0] = 99;

        const identity = storageIdentity('gemini', '10000000-0000-4000-8000-000000000001', 'trust-copy-case');
        const stored = await getStoredDomain(identity);
        assert.ok(stored);
        assert.equal(stored.conversation.index.title, 'Original');
        assert.equal(stored.conversation.detail.messages[0].content[0].type, 'paragraph');
        assert.equal(JSON.stringify(stored.conversation.detail.messages).includes('Body'), true);
        assert.deepEqual(stored.acquisitionHints.asset.candidates, ['opaque:original']);
        const firstBytes = await getDomainResource(identity, 'asset');
        assert.ok(firstBytes);
        assert.deepEqual([...firstBytes], [1, 2, 3]);

        const adapted = storedParseResult(stored);
        adapted.conversation.index.title = 'Changed projection';
        adapted.acquisitionHints.asset.candidates![0] = 'changed';
        firstBytes[0] = 88;

        const reread = await getStoredDomain(identity);
        assert.ok(reread);
        assert.equal(reread.conversation.index.title, 'Original');
        assert.deepEqual(reread.acquisitionHints.asset.candidates, ['opaque:original']);
        const rereadBytes = await getDomainResource(identity, 'asset');
        assert.ok(rereadBytes);
        assert.deepEqual([...rereadBytes], [1, 2, 3]);
        assert.equal(JSON.stringify(reread.conversation.detail.messages).includes('Mutated source'), false);
    } finally { __clearDomainMemory(); }
});
