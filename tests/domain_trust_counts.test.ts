import { admitFixture } from './helpers/admitFixture.js';
import { fixtureKey, fixtureAccount } from './helpers/domainFixture.js';
import { useIndexStorage } from './helpers/indexStorage.js';
useIndexStorage();
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateParserDomain, restoreDomainSnapshot } from '../src/core/domain/runtimeValidation.js';
import { storageIdentity, __clearDomainMemory } from '../src/core/storage/domain/domainStore.js';
import { getDomainResource } from '../src/core/storage/domain/resourceContext.js';
import { readFixture } from './helpers/admitFixture.js';
import type { DomainConversationWithDetail } from '../src/core/domain/conversation.js';

test('large provider-neutral graphs preserve complete/partial/unknown coverage and real resource bytes', async () => {
    try {
    for (const status of ['complete', 'partial', 'unknown'] as const) {
        const builder: DomainConversationWithDetail = { index: { key: fixtureKey(String(`large-${status}`), 'future-provider'),   titleSource: "derived",   title: 'Independent large graph' }, detail: { key: fixtureKey(String(`large-${status}`), 'future-provider'), quality: { status }, assets: [{ id: 'bytes', kind: 'file', sourceUri: 'opaque:original' }], messages: Array.from({ length: 1000 }, (_, index) => ({ id: `message-${index}`, role: 'unknown',
                content: [{ type: 'unknown', sourceType: 'future-block', text: `Preserved ${index}` }], attachmentIds: ['bytes'] })) } };
        const trusted = validateParserDomain(builder);
        assert.equal(restoreDomainSnapshot(trusted).detail.messages.length, 1000);
        __clearDomainMemory();
        const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
        await admitFixture(fixtureAccount('future-provider').id, { account: fixtureAccount('future-provider'), conversation: trusted, resourceHints: {}, acquisitionHints: {}, diagnostics: [] }, [{ assetId: 'bytes', bytes }]);
        bytes[0] = 99;
        const read = await readFixture(storageIdentity('future-provider', fixtureAccount('future-provider').id, builder.index.key.conversationId));
        assert.ok(read); const recoveredBytes = await getDomainResource(storageIdentity(read.account.providerId, read.account.id, read.conversation.index.key.conversationId), 'bytes');
        assert.ok(recoveredBytes); assert.deepEqual([...recoveredBytes], [0, 1, 2, 253, 254, 255]);
        assert.equal(read.conversation.detail.quality.status, status);
        assert.equal(read.conversation.detail.messages[999].content[0].type, 'unknown');
        assert.equal(Object.getOwnPropertySymbols(read.conversation).length, 0);
    }
    } finally {
        __clearDomainMemory();
    }
});

