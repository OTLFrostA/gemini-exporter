import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateParserDomain, restoreDomainSnapshot } from '../src/core/domain/runtimeValidation.js';
import { closeDomainResources } from '../src/core/parsers/shared/resources/domainResourceAdapter.js';
import { findResourceMatch, resourceIdentity } from '../src/core/parsers/shared/resources/resourceIdentity.js';
import type { DomainAsset, DomainConversationDetail } from '../src/core/domain/conversationDetail.js';
const base = (assets: DomainAsset[] = []): DomainConversationDetail => ({ providerId: 'custom', id: 'chat', title: 'Resources', completeness: 'unknown', assets, messages: [] });
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
    for (const key of ['chatId', 'turnId']) assert.throws(() => validateParserDomain(base([{ ...valid, generation: { ...valid.generation, [key]: 'old' } }])));
    for (const key of ['createdAt', 'chipUrl', 'sections', 'links', 'candidates']) assert.throws(() => validateParserDomain(base([{ ...valid, document: { contentMarkdown: 'body', [key]: 'old' } }])));
    assert.throws(() => validateParserDomain(base([{ ...valid, generation: { time: null as never } }])));
});
test('v1 recovery preserves source URI, identity evidence, reasoning and resource references without mutating disk values', () => {
    const old = { ...base(), timestamp: null, completeness: { status: 'unknown' }, assets: [{ id: 'asset', kind: 'image', source: { uri: 'original' }, generated: true, generation: { chatId: 'chat', turnId: 'turn', time: '1700000000123', prompt: 'draw', generationOrdinal: 0 }, document: { contentMarkdown: '# Body', sections: ['# Body'], createdAt: null } }], messages: [{ role: 'assistant', content: [{ type: 'thought', disclosure: 'providerExposed', blocks: [{ type: 'image', assetId: 'asset' }, { type: 'paragraph', children: [{ type: 'text', text: 'Real reasoning' }] }] }], provenance: { providerRequestId: 'old' } }] };
    const copy = structuredClone(old);
    const restored = restoreDomainSnapshot(old, 1);
    assert.equal(restored.assets[0].sourceUri, 'original');
    assert.equal(restored.assets[0].generation?.time, 1700000000123);
    assert.equal(restored.messages[0].reasoning?.length, 2);
    assert.equal(restored.messages[0].content.length, 0);
    assert.equal(restored.messages[0].provenance, undefined);
    assert.deepEqual(old, copy);
    assert.throws(() => restoreDomainSnapshot({ ...old, assets: [{ ...old.assets[0], document: { sections: ['unconverted real body'] } }] }, 1), /original retained/);
    assert.throws(() => restoreDomainSnapshot({ ...old, assets: [{ ...old.assets[0], generation: { chatId: 'foreign' } }] }, 1), /different conversation/);
});
test('parent context prevents cross-conversation resource matches even with identical URI and request identity', () => {
    const asset: DomainAsset = { id: 'image', kind: 'image', sourceUri: 'shared', generation: { providerRequestId: 'same-request', time: 1000, prompt: 'draw', generationOrdinal: 0, imageCount: 1 } };
    const requested = resourceIdentity(asset, 'chat');
    assert.equal(findResourceMatch('chat', requested, [resourceIdentity(asset, 'foreign')]), null);
    assert.equal(findResourceMatch('chat', requested, [resourceIdentity(asset, 'chat')]), 0);
    assert.equal(findResourceMatch('foreign', requested, [resourceIdentity(asset, 'foreign')]), null);
    assert.equal(findResourceMatch('chat', requested, [resourceIdentity(asset, 'c_chat')]), null);
});

test('canonical report body keeps independent sections and links and unsafe historical losses are rejected', () => {
    const result = closeDomainResources('custom', [], [{ input: { attachments: [{ type: 'file', contentMarkdown: '# Canonical', sections: ['# Canonical', 'Unique section'], links: [{ title: 'Evidence', url: 'https://example.test/evidence' }] }] } }]);
    assert.equal(result.assets[0].document?.contentMarkdown, '# Canonical\n\nUnique section\n\n[Evidence](https://example.test/evidence)');
    const old = { ...base(), completeness: { status: 'unknown' }, assets: [{ id: 'report', kind: 'file', document: { contentMarkdown: '# Canonical', links: [{ title: 'Evidence', url: 'https://example.test/evidence' }] } }] };
    assert.throws(() => restoreDomainSnapshot(old, 1), /original retained/);
    assert.throws(() => restoreDomainSnapshot({ ...old, assets: [{ id: 'image', kind: 'image', generated: true }] }, 1), /identity evidence/);
    assert.throws(() => restoreDomainSnapshot({ ...old, assets: [{ id: 'image', kind: 'image', generated: true, generation: { chatId: 'chat' } }] }, 1), /identity evidence/);
});

test('historical generated flag can recover only from unambiguous explicit owner request evidence', () => {
    const old = { ...base(), completeness: { status: 'unknown' }, assets: [{ id: 'image', kind: 'image', generated: true }], messages: [{ role: 'assistant', content: [], attachmentIds: ['image'], provenance: { providerRequestId: 'source-request' } }] };
    const restored = restoreDomainSnapshot(old, 1);
    assert.deepEqual(restored.assets[0].generation, { providerRequestId: 'source-request' });
    assert.equal(restored.messages[0].provenance, undefined);
    assert.throws(() => restoreDomainSnapshot({ ...old, messages: [...old.messages, { ...old.messages[0], provenance: { providerRequestId: 'conflict' } }] }, 1), /identity evidence/);
    assert.equal(Object.hasOwn(old.assets[0], 'generated'), true);
});

test('nested historical thoughts preserve reasoning order instead of moving inner content before its parent', () => {
    const paragraph = (text: string) => ({ type: 'paragraph', children: [{ type: 'text', text }] });
    const thought = (blocks: unknown[]) => ({ type: 'thought', disclosure: 'providerExposed', blocks });
    const old = { ...base(), completeness: { status: 'unknown' }, messages: [{ role: 'assistant',
        reasoning: [thought([paragraph('Existing A'), thought([paragraph('Existing B')])]), paragraph('Existing C')],
        content: [thought([paragraph('A'), thought([paragraph('B')]), paragraph('C')]), paragraph('Body')] }] };
    const restored = restoreDomainSnapshot(old, 1);
    assert.deepEqual(restored.messages[0].reasoning, ['Existing A', 'Existing B', 'Existing C', 'A', 'B', 'C'].map(paragraph));
    assert.deepEqual(restored.messages[0].content, [paragraph('Body')]);
});
