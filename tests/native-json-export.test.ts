import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatContent } from '../src/core/engine/chatFormatter.js';
import type { ResourceConversationParseResult } from '../src/core/parsers/parsingResult.js';
import { assertDomainClosure } from '../src/core/domain/closure.js';
const native: ResourceConversationParseResult = {
    conversation: { providerId: 'test-provider', id: 'opaque-id', title: 'Portable archive', timestamp: 0, createdAt: 0,
        completeness: { status: 'partial', reason: 'Selected range' }, provenance: { source: 'fixture' }, assets: [
            { id: 'image', kind: 'image', name: 'image.png', mediaType: 'image/png', source: { uri: 'https://example.test/image.png' } },
            { id: 'file', kind: 'file', name: 'report.pdf', mediaType: 'application/pdf', byteLength: 42 } ],
        messages: [{ id: 'system', role: 'system', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Instruction' }] }] },
            { id: 'answer', role: 'assistant', timestamp: 0, model: 'Source model',
                content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Answer' }, { type: 'image', assetId: 'image' }, { type: 'citationRef', citationId: 'source' }] }],
                reasoning: [{ type: 'paragraph', children: [{ type: 'text', text: 'Reasoning' }] }],
                attachmentIds: ['file'], citations: [{ id: 'source', title: 'Evidence', url: 'https://example.test/source' }] }] },
    diagnostics: [{ severity: 'warning', code: 'TEST_WARNING', message: 'Separate problem record' }],
    resourceHints: { image: { archivePath: 'assets/image.png' }, file: { archivePath: 'files/report.pdf' } },
    acquisitionHints: { image: { url: 'https://example.test/image.png' } },
};
test('complete JSON preserves the full native Domain and versioned resource destinations', () => {
    const before = structuredClone(native);
    const archive = JSON.parse(formatContent(native, 'json').content);
    assert.equal(archive.format, 'gemini-exporter-domain'); assert.equal(archive.version, 1);
    assert.deepEqual(archive.conversation, native.conversation); assertDomainClosure(archive.conversation);
    assert.deepEqual(archive.resources, { image: { path: 'assets/image.png' }, file: { path: 'files/report.pdf' } });
    for (const name of ['diagnostics', 'transport', 'acquisitionHints']) assert.equal(name in archive, false);
    assert.deepEqual(native, before);
});
test('OpenAI JSON converts roles, multimodal images and reasoning only at the output boundary', () => {
    const before = structuredClone(native);
    const archive = JSON.parse(formatContent(native, 'json_openai').content);
    assert.equal(archive.created_at, '1970-01-01T00:00:00.000Z');
    assert.deepEqual(archive.messages.map((m: { role: string }) => m.role), ['system', 'assistant']);
    assert.ok(archive.messages[1].content.some((part: { type: string; image_url?: { url: string } }) => part.type === 'image_url' && part.image_url?.url === 'assets/image.png'));
    assert.match(archive.messages[1].reasoning_content, /Reasoning/);
    assert.deepEqual(native, before);
});
test('raw JSON requires actual provider evidence and never exports a synthetic snapshot', () => {
    assert.throws(() => formatContent(native, 'json_raw'), /evidence is unavailable/);
    const raw = { ...native, transport: { decodedPayload: [null, ['source bytes']] } };
    assert.deepEqual(JSON.parse(formatContent(raw, 'json_raw').content), raw.transport.decodedPayload);
});
