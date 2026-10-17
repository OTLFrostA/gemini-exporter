import { useIndexStorage } from './helpers/indexStorage.js';
useIndexStorage();
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateParserDomain, restoreDomainSnapshot } from '../src/core/domain/runtimeValidation.js';
import { saveDomainConversation, getStoredDomain, storageIdentity, getDomainResource, __clearDomainMemory } from '../src/core/storage/domain/domainStore.js';
import type { DomainConversationWithDetail } from '../src/core/domain/conversation.js';

test('large provider-neutral graphs preserve complete/partial/unknown coverage and real resource bytes', async () => {
    try {
    for (const status of ['complete', 'partial', 'unknown'] as const) {
        const builder: DomainConversationWithDetail = { index: { cloudAvailability: 'unknown', hasTakeoutImport: false, titleSource: 'legacy', providerId: 'future-provider', id: `large-${status}`, title: 'Independent large graph' }, detail: { quality: { status }, assets: [{ id: 'bytes', kind: 'file', sourceUri: 'opaque:original' }], messages: Array.from({ length: 1000 }, (_, index) => ({ id: `message-${index}`, role: 'unknown',
                content: [{ type: 'unknown', sourceType: 'future-block', text: `Preserved ${index}` }], attachmentIds: ['bytes'] })) } };
        const trusted = validateParserDomain(builder);
        assert.equal(restoreDomainSnapshot(trusted).detail.messages.length, 1000);
        __clearDomainMemory();
        const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
        await saveDomainConversation('10000000-0000-4000-8000-000000000001', { conversation: trusted, resourceHints: {}, acquisitionHints: {}, diagnostics: [] }, [{ assetId: 'bytes', bytes }]);
        bytes[0] = 99;
        const read = await getStoredDomain(storageIdentity('future-provider', '10000000-0000-4000-8000-000000000001', builder.index.id));
        assert.ok(read); const recoveredBytes = await getDomainResource(read.identity, 'bytes');
        assert.ok(recoveredBytes); assert.deepEqual([...recoveredBytes], [0, 1, 2, 253, 254, 255]);
        assert.equal(read.conversation.detail.quality.status, status);
        assert.equal(read.conversation.detail.messages[999].content[0].type, 'unknown');
        assert.equal(Object.getOwnPropertySymbols(read.conversation).length, 0);
    }
    } finally {
        __clearDomainMemory();
    }
});

