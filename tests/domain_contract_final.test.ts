import { fixtureKey, fixtureAccount, fixtureAccountFor } from './helpers/domainFixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreDomainSnapshot, validateParserDomain } from '../src/core/domain/runtimeValidation.js';
import { TITLE_AUTHORITY_RANK } from '../src/core/domain/titleAuthority.js';
import { closeDomainResources } from '../src/core/parsers/shared/resources/domainResourceAdapter.js';
import { parseConversation } from '../src/core/parsers/parseConversation.js';
import { saveDomainConversation, getStoredDomain, storedParseResult, storageIdentity, __clearDomainMemory } from '../src/core/storage/domain/domainStore.js';
import { preparePdfResources } from '../src/core/export/pdf/prepareResources.js';
import { resolveExportRecordStatus } from '../src/core/engine/export/exportCompletion.js';
import type { DomainConversationWithDetail } from '../src/core/domain/conversation.js';

const base = (): DomainConversationWithDetail => ({ index: { key: fixtureKey(String('final-contract'), 'custom'),   titleSource: "derived",   title: 'Final' }, detail: { key: fixtureKey(String('final-contract'), 'custom'), quality: { status: 'unknown' }, assets: [], messages: [] } });

test('current schema rejects deleted fields and empty resource objects at the existing snapshot boundary', () => {
    for (const invalid of [
        { index: { ...base().index }, detail: {   ...base().detail, messages: [{ role: 'unknown', content: [], provenance: { rawRole: 'tool' } }] } },
        { index: { ...base().index }, detail: {   ...base().detail, messages: [{ role: 'unknown', content: [], rawRole: 'tool' }] } },
        { index: { ...base().index }, detail: {   ...base().detail, assets: [{ id: 'a', kind: 'image', failureReason: 'HTTP 404' }] } },
        { index: { ...base().index }, detail: {   ...base().detail, messages: [{ role: 'assistant', content: [], citations: [{ id: 'c', number: 4 }] }] } },
        { index: { ...base().index }, detail: {   ...base().detail, assets: [{ id: 'a', kind: 'image', generation: {} }] } },
        { index: { ...base().index }, detail: {   ...base().detail, assets: [{ id: 'a', kind: 'file', document: {} }] } },
        { index: { ...base().index, titleSource: 'future-provider-tier' }, detail: {   ...base().detail } },
    ]) assert.throws(() => restoreDomainSnapshot(invalid), /Invalid (?:persisted Domain contract|conversation index)/);
    for (const titleSource of Object.keys(TITLE_AUTHORITY_RANK)) assert.equal(restoreDomainSnapshot({ index: { ...base().index, ...(titleSource === 'default' ? { title: '' } : {}), titleSource }, detail: {   ...base().detail } }).index.titleSource, titleSource);
});

test('partial resource identities remain valid and parsers omit absent generation/document information', () => {
    for (const generation of [{ providerRequestId: 'request' }, { time: 0 }, { prompt: '' }, { generationOrdinal: 0 }, { imageCount: 0 }, { imageOrdinal: 0 }]) {
        const source = { index: { ...base().index }, detail: {   ...base().detail, assets: [{ id: 'a', kind: 'image', generation }] } };
        assert.deepEqual(restoreDomainSnapshot(source).detail.assets[0].generation, generation);
    }
    for (const document of [{ id: 'report' }, { contentMarkdown: '' }]) {
        assert.deepEqual(restoreDomainSnapshot({ index: { ...base().index }, detail: {   ...base().detail, assets: [{ id: 'a', kind: 'file', document }] } }).detail.assets[0].document, document);
    }
    const result = closeDomainResources('custom', [], [{ input: { attachments: [{ type: 'file', url: 'opaque:file', id: undefined, contentMarkdown: undefined, hasFabricatedText: undefined }] } }]);
    assert.equal(Object.hasOwn(result.assets[0], 'generation'), false);
    assert.equal(Object.hasOwn(result.assets[0], 'document'), false);
    validateParserDomain({ index: { ...base().index }, detail: {   ...base().detail, assets: result.assets } });
    const generated = closeDomainResources('custom', [], [{ input: { attachments: [{ type: 'image', generation: { chatId: 'c', generationOrdinal: 0, providerRequestId: undefined, prompt: undefined, time: undefined } }] } }]);
    assert.deepEqual(generated.assets[0].generation, { generationOrdinal: 0 });
    assert.deepEqual(restoreDomainSnapshot({ index: { ...base().index }, detail: {   ...base().detail, assets: generated.assets } }).detail.assets, generated.assets);
});

test('legacy parser normalizes unknown role/source without changing title authority or input', () => {
    const raw = { metadata: { id: 'old', title: 'Original', titleSource: 'future-provider-tier' }, detail: { key: fixtureKey(), messages: [{ role: 'plugin-tool', content: 'Kept answer' }] } };
    const original = structuredClone(raw);
    const parsed = parseConversation({ account: fixtureAccount('gemini'), format: 'legacy-storage', providerId: 'gemini', data: raw });
    assert.equal(parsed.conversation.index.title, 'Original');
    assert.equal(parsed.conversation.index.titleSource, 'derived');
    assert.equal(parsed.conversation.detail.messages[0].role, 'unknown');
    assert.equal(Object.hasOwn(parsed.conversation.detail.messages[0], 'provenance'), false);
    assert.ok(parsed.diagnostics.some(d => d.code === 'UNKNOWN_ROLE'));
    assert.deepEqual(raw, original);
});

test('restored Domain detects heuristic reports and unavailable images without persisted acquisition failures', async () => {
    __clearDomainMemory();
    try {
        const conversation = validateParserDomain({ index: { ...base().index }, detail: {   ...base().detail, quality: { status: 'partial' }, assets: [
            { id: 'report', kind: 'file', document: { id: 'original-report', contentMarkdown: '# Deep Research\n\nComplete retained body' } },
            { id: 'image', kind: 'image', sourceUri: 'Takeout/missing.png', generation: { imageOrdinal: 0 } },
        ], messages: [{ role: 'assistant', content: [{ type: 'image', assetId: 'image' }], attachmentIds: ['report'], generation: { mediaKind: 'image', outputCount: 1 } }] } });
        await saveDomainConversation(fixtureAccount('custom').id, { account: fixtureAccount('custom'), conversation, acquisitionHints: {}, resourceHints: {}, diagnostics: [] });
        const stored = await getStoredDomain(storageIdentity('custom', fixtureAccount('custom').id, conversation.index.key.conversationId));
        assert.ok(stored);
        const restored = storedParseResult(stored, fixtureAccountFor(stored.conversation));
        assert.equal(restored.evidence, undefined);
        assert.deepEqual(restored.conversation.detail.quality, { status: 'partial' });
        assert.equal(resolveExportRecordStatus({ quality: restored.conversation.detail.quality }).status, 'partial');
        assert.equal(restored.conversation.detail.assets[0].document?.contentMarkdown, conversation.detail.assets[0].document?.contentMarkdown);
        assert.deepEqual(restored.conversation.detail.messages[0].generation, { mediaKind: 'image', outputCount: 1 });
        const prepared = await preparePdfResources(restored.conversation.detail, new Set(['image']), restored.acquisitionHints);
        assert.equal(prepared.resources.get('image')?.ok, false);
        assert.ok(prepared.resources.get('image'));
        assert.equal(resolveExportRecordStatus({ failedAssetsCount: prepared.diagnostics.length }).status, 'partial');
        assert.ok(prepared.diagnostics.some(d => d.code === 'RESOURCE_UNAVAILABLE' && d.path === 'asset:image'));
        assert.equal(Object.hasOwn(restored.conversation.detail.assets[1], 'failureReason'), false);
    } finally { __clearDomainMemory(); }
});
