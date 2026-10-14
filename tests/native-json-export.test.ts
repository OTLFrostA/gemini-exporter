import { validateParserDomain } from '../src/core/domain/runtimeValidation.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatContent } from '../src/core/engine/chatFormatter.js';
import type { ResourceConversationParseResult } from '../src/core/parsers/parsingResult.js';
import { assertDomainClosure } from '../src/core/domain/closure.js';
const native: ResourceConversationParseResult = {
    conversation: validateParserDomain({ providerId: 'test-provider', id: 'opaque-id', title: 'Portable archive', createdAt: 0,
        completeness: 'partial', assets: [
            { id: 'image', kind: 'image', name: 'image.png', mediaType: 'image/png', sourceUri: 'https://example.test/image.png' },
            { id: 'file', kind: 'file', name: 'report.pdf', mediaType: 'application/pdf', byteLength: 42 } ],
        messages: [{ id: 'system', role: 'system', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Instruction' }] }] },
            { id: 'answer', role: 'assistant', timestamp: 0, model: 'Source model',
                content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Answer' }, { type: 'image', assetId: 'image' }, { type: 'citationRef', citationId: 'source' }] }],
                reasoning: [{ type: 'paragraph', children: [{ type: 'text', text: 'Reasoning' }] }],
                attachmentIds: ['file'], citations: [{ id: 'source', title: 'Evidence', url: 'https://example.test/source' }] }] }),
    diagnostics: [{ severity: 'warning', code: 'TEST_WARNING', message: 'Separate problem record' }],
    resourceHints: { image: { archivePath: 'assets/image.png' }, file: { archivePath: 'files/report.pdf' } },
    acquisitionHints: { image: { url: 'https://example.test/image.png' } },
};
const delivered = Object.entries(native.resourceHints).map(([resourceId, hint]) => ({ ok: true as const, resourceId, value: { path: hint.archivePath! } }));
test('complete JSON preserves the full native Domain and versioned resource destinations', () => {
    const before = structuredClone(native);
    const archive = JSON.parse(formatContent(native, 'json', delivered).content);
    assert.equal(archive.format, 'gemini-exporter-domain'); assert.equal(archive.version, 2);
    assert.deepEqual(archive.conversation, native.conversation); assertDomainClosure(archive.conversation);
    assert.deepEqual(archive.resources, { image: { path: 'assets/image.png' }, file: { path: 'files/report.pdf' } });
    for (const name of ['diagnostics', 'transport', 'acquisitionHints']) assert.equal(name in archive, false);
    assert.deepEqual(native, before);
});
for (const format of ['json_openai', 'json_raw']) test(`removed format ${format} is rejected even with provider evidence`, () => {
    const raw = { ...native, transport: { decodedPayload: [null, ['source bytes']] } };
    assert.throws(() => formatContent(raw, format), /unsupported format/);
});
