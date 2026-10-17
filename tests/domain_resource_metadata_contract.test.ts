import { fixtureKey } from './helpers/domainFixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateParserDomain } from '../src/core/domain/runtimeValidation.js';
import { closeDomainResources } from '../src/core/parsers/shared/resources/domainResourceAdapter.js';
import { findResourceMatch, resourceIdentity } from '../src/core/parsers/shared/resources/resourceIdentity.js';
import type { DomainAsset } from '../src/core/domain/conversationDetail.js';
import type { DomainConversationWithDetail } from '../src/core/domain/conversation.js';
const base = (assets: DomainAsset[] = []): DomainConversationWithDetail => ({ index: { key: fixtureKey(String('chat'), 'custom'),   titleSource: "derived",   title: 'Resources' }, detail: { key: fixtureKey(String('chat'), 'custom'), quality: { status: 'unknown' }, assets, messages: [] } });
test('source metadata stays outside Domain and canonical report body retains authored sections and links', () => {
    const result = closeDomainResources('custom', [], [{ input: { attachments: [{ type: 'file', id: 'report', url: 'https://example.test/report', createdAt: 1, chipUrl: 'https://example.test/chip', width: 100, height: 80, source: 'source', sections: ['# Report', 'Evidence'], links: [{ title: 'Reference', url: 'https://example.test/reference' }], candidates: ['https://example.test/download'] }] } }]);
    const asset = result.assets[0];
    assert.equal(asset.sourceUri, 'https://example.test/report');
    for (const key of ['origin', 'dimensions', 'source', 'generated']) assert.equal(Object.hasOwn(asset, key), false);
    assert.ok(asset.document?.contentMarkdown?.includes('# Report'));
    assert.ok(asset.document?.contentMarkdown?.includes('[Reference](https://example.test/reference)'));
    for (const key of ['createdAt', 'chipUrl', 'sections', 'links', 'candidates']) assert.equal(Object.hasOwn(asset.document ?? {}, key), false);
    assert.deepEqual(result.acquisitionHints[asset.id].candidates, ['https://example.test/download']);
    validateParserDomain(base([asset]));
});
test('new schema rejects every removed asset and generation field', () => {
    const valid: DomainAsset = { id: 'asset', kind: 'image', sourceUri: 'original', generation: { providerRequestId: 'request', time: 123, generationOrdinal: 0 } };
    for (const [key, value] of Object.entries({ source: { uri: 'old' }, origin: 'rpc', dimensions: { width: 1 }, generated: true })) {
        assert.throws(() => validateParserDomain(base([{ ...valid, [key]: value }])));
    }
    for (const key of ['chatId', 'turnId']) assert.throws(() => validateParserDomain(base([{ ...valid, generation: { providerRequestId: 'request', [key]: 'old' } }])));
    for (const key of ['createdAt', 'chipUrl', 'sections', 'links', 'candidates']) assert.throws(() => validateParserDomain(base([{ ...valid, document: { contentMarkdown: 'body', [key]: 'old' } }])));
    assert.throws(() => validateParserDomain(base([{ ...valid, generation: { time: null as never } }])));
});
test('parent context prevents cross-conversation resource matches even with identical URI and request identity', () => {
    const asset: DomainAsset = { id: 'image', kind: 'image', sourceUri: 'shared', generation: { providerRequestId: 'same-request', time: 1000, prompt: 'draw', generationOrdinal: 0, imageCount: 1 } };
    const requested = resourceIdentity(asset, 'chat');
    assert.equal(findResourceMatch('chat', requested, [resourceIdentity(asset, 'foreign')]), null);
    assert.equal(findResourceMatch('chat', requested, [resourceIdentity(asset, 'chat')]), 0);
    assert.equal(findResourceMatch('foreign', requested, [resourceIdentity(asset, 'foreign')]), null);
    assert.equal(findResourceMatch('chat', requested, [resourceIdentity(asset, 'c_chat')]), null);
});

test('canonical report body keeps independent sections and links', () => {
    const result = closeDomainResources('custom', [], [{ input: { attachments: [{ type: 'file', contentMarkdown: '# Canonical', sections: ['# Canonical', 'Unique section'], links: [{ title: 'Evidence', url: 'https://example.test/evidence' }] }] } }]);
    assert.equal(result.assets[0].document?.contentMarkdown, '# Canonical\n\nUnique section\n\n[Evidence](https://example.test/evidence)');
});
