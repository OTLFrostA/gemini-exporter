import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreDomainSnapshot, validateParserDomain } from '../src/core/domain/runtimeValidation.js';
import { TITLE_SOURCES } from '../src/core/domain/titleAuthority.js';
import { closeDomainResources } from '../src/core/parsers/shared/resources/domainResourceAdapter.js';
import { parseConversation } from '../src/core/parsers/parseConversation.js';
import { saveDomainConversation, getStoredDomain, storedParseResult, storageIdentity, __clearDomainMemory } from '../src/core/storage/domain/domainStore.js';
import { preparePdfResources } from '../src/core/export/pdf/prepareResources.js';
import { resolveExportRecordStatus } from '../src/core/engine/export/exportCompletion.js';
import { extractChatParseDrift } from '../src/core/engine/export/parseDrift.js';
import type { DomainConversationDetail } from '../src/core/domain/conversationDetail.js';

const base = (): DomainConversationDetail => ({ providerId: 'custom', id: 'final-contract', title: 'Final', completeness: 'unknown', assets: [], messages: [] });

test('current schema rejects deleted fields and empty resource objects at the existing snapshot boundary', () => {
    for (const invalid of [
        { ...base(), messages: [{ role: 'unknown', content: [], provenance: { rawRole: 'tool' } }] },
        { ...base(), messages: [{ role: 'unknown', content: [], rawRole: 'tool' }] },
        { ...base(), assets: [{ id: 'a', kind: 'image', failureReason: 'HTTP 404' }] },
        { ...base(), messages: [{ role: 'assistant', content: [], citations: [{ id: 'c', number: 4 }] }] },
        { ...base(), assets: [{ id: 'a', kind: 'image', generation: {} }] },
        { ...base(), assets: [{ id: 'a', kind: 'file', document: {} }] },
        { ...base(), titleSource: 'future-provider-tier' },
    ]) assert.throws(() => restoreDomainSnapshot(invalid), /Invalid persisted Domain contract/);
    for (const titleSource of TITLE_SOURCES) assert.equal(restoreDomainSnapshot({ ...base(), titleSource }).titleSource, titleSource);
});

test('partial resource identities remain valid and parsers omit absent generation/document information', () => {
    for (const generation of [{ providerRequestId: 'request' }, { time: 0 }, { prompt: '' }, { generationOrdinal: 0 }, { imageCount: 0 }, { imageOrdinal: 0 }]) {
        const source = { ...base(), assets: [{ id: 'a', kind: 'image', generation }] };
        assert.deepEqual(restoreDomainSnapshot(source).assets[0].generation, generation);
    }
    for (const document of [{ id: 'report' }, { contentMarkdown: '' }, { hasFabricatedText: false }]) {
        assert.deepEqual(restoreDomainSnapshot({ ...base(), assets: [{ id: 'a', kind: 'file', document }] }).assets[0].document, document);
    }
    const result = closeDomainResources('custom', [], [{ input: { attachments: [{ type: 'file', url: 'opaque:file' }] } }]);
    assert.equal(Object.hasOwn(result.assets[0], 'generation'), false);
    assert.equal(Object.hasOwn(result.assets[0], 'document'), false);
    validateParserDomain({ ...base(), assets: result.assets });
});

test('legacy parser normalizes unknown role/source without changing title authority or input', () => {
    const raw = { metadata: { id: 'old', title: 'Original', titleSource: 'future-provider-tier' }, detail: { messages: [{ role: 'plugin-tool', content: 'Kept answer' }] } };
    const original = structuredClone(raw);
    const parsed = parseConversation({ format: 'legacy-storage', providerId: 'gemini', data: raw });
    assert.equal(parsed.conversation.title, 'Original');
    assert.equal(parsed.conversation.titleSource, 'default');
    assert.equal(parsed.conversation.messages[0].role, 'unknown');
    assert.equal(Object.hasOwn(parsed.conversation.messages[0], 'provenance'), false);
    assert.ok(parsed.diagnostics.some(d => d.code === 'UNKNOWN_ROLE'));
    assert.deepEqual(raw, original);
});

test('restored Domain detects heuristic reports and unavailable images without persisted acquisition failures', async () => {
    __clearDomainMemory();
    try {
        const conversation = validateParserDomain({ ...base(), assets: [
            { id: 'report', kind: 'file', document: { id: 'original-report', contentMarkdown: '# Deep Research\n\nComplete retained body', hasFabricatedText: true } },
            { id: 'image', kind: 'image', sourceUri: 'Takeout/missing.png', generation: { imageOrdinal: 0 } },
        ], messages: [{ role: 'assistant', content: [{ type: 'image', assetId: 'image' }], attachmentIds: ['report'], generation: { mediaKind: 'image', outputCount: 1 } }] });
        await saveDomainConversation('account', { conversation, acquisitionHints: {}, resourceHints: {}, diagnostics: [] });
        const stored = await getStoredDomain(storageIdentity('custom', 'account', conversation.id));
        assert.ok(stored);
        const restored = storedParseResult(stored);
        assert.equal(extractChatParseDrift(restored).hasHeuristicDocs, true);
        assert.equal(resolveExportRecordStatus({ evidence: extractChatParseDrift(restored) }).status, 'partial');
        assert.equal(restored.conversation.assets[0].document?.contentMarkdown, conversation.assets[0].document?.contentMarkdown);
        assert.deepEqual(restored.conversation.messages[0].generation, { mediaKind: 'image', outputCount: 1 });
        const prepared = await preparePdfResources(restored.conversation, new Set(['image']), restored.acquisitionHints);
        assert.equal(prepared.resources.get('image')?.bytes, undefined);
        assert.ok(prepared.resources.get('image')?.failureReason);
        assert.equal(resolveExportRecordStatus({ failedAssetsCount: prepared.diagnostics.length }).status, 'partial');
        assert.ok(prepared.diagnostics.some(d => d.code === 'RESOURCE_UNAVAILABLE' && d.path === 'asset:image'));
        assert.equal(Object.hasOwn(restored.conversation.assets[1], 'failureReason'), false);
    } finally { __clearDomainMemory(); }
});
