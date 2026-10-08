import { parseGeminiTakeoutZipArchive } from '../src/core/parsers/gemini/takeout/parseZip.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseConversation } from '../src/core/parsers/parseConversation.js';
import { parseGeminiTakeoutArchive, type GeminiTakeoutRaw } from '../src/core/parsers/gemini/takeout/parseConversation.js';
import { decodeTakeoutHtml } from '../src/core/parsers/gemini/takeout/decodeHtml.js';
import { assertDomainClosure } from '../src/core/domain/closure.js';
import { composeDomainDocument } from '../src/core/document/compose/composeDomainDocument.js';
import { renderDocumentHtml } from '../src/core/renderers/html/renderHtml.js';
import { renderDocumentMarkdown } from '../src/core/renderers/markdown/renderMarkdown.js';
import { renderDocumentTypst } from '../src/core/renderers/typst/renderTypst.js';
import { extractBlockText } from '../src/core/domain/content/unknownFallback.js';

const ID = 'CaseSensitive_99';
function activity(prompt = 'Question', answer = '<p><strong>Answer</strong></p>', date = '2026-09-02T12:00:00Z', id = ID, extra = ''): string {
    return `<div class="outer-cell"><a href="https://gemini.google.com/app/c_${id}">Conversation</a><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Prompted ${prompt}<br>${date}<br>${answer}</div>${extra}</div>`;
}
const native = (data: GeminiTakeoutRaw, targetConvId?: string) => parseConversation({ format: 'gemini-takeout', providerId: 'gemini', data, targetConvId });
const text = (blocks: Parameters<typeof extractBlockText>[0][]) => blocks.map(block => extractBlockText(block)).join('\n');

test('Takeout raw HTML constructs Domain without persisted records or fabricated message dates', () => {
    const { conversation } = native({ htmlText: activity() });
    assert.equal(conversation.id, ID);
    assert.equal(conversation.title, 'Question');
    assert.equal(conversation.provenance?.source, 'gemini-takeout');
    assert.deepEqual(conversation.messages.map(m => m.role), ['user', 'assistant']);
    assert.equal(text(conversation.messages[1].content), 'Answer');
    const timestamp = Date.parse('2026-09-02T12:00:00Z');
    assert.deepEqual(conversation.messages.map(m => m.timestamp), [timestamp, timestamp]);
    assert.equal(conversation.createdAt, timestamp);
    assert.equal(conversation.updatedAt, timestamp);
    for (const message of conversation.messages) assert.equal(message.id, undefined);
    assertDomainClosure(conversation);
});

test('missing Takeout dates remain absent and activity logs never claim complete coverage', () => {
    const { conversation } = native({ htmlText: activity('Question', '<p>Answer</p>', '') });
    assert.equal(conversation.timestamp, null);
    assert.equal(conversation.createdAt, null);
    for (const message of conversation.messages) assert.equal(message.timestamp, undefined);
    assert.equal(conversation.completeness?.status, 'partial');
});

test('batch and selected parsing preserve separate conversation identities and source chronology', () => {
    const htmlText = activity('Newer', '<p>New answer</p>', '2026-09-03T12:00:00Z') + activity('Older') + activity('Other', '<p>Other answer</p>', '', 'other_chat_99');
    assert.throws(() => native({ htmlText }), /targetConvId/);
    const batch = parseGeminiTakeoutArchive({ htmlText }, { providerId: 'gemini' });
    assert.equal(batch.length, 2);
    const selected = native({ htmlText }, `c_${ID}`);
    assert.deepEqual(selected.conversation, batch[0].conversation);
    assert.deepEqual(selected.conversation.messages.map(m => text(m.content)), ['Older', 'Answer', 'Newer', 'New answer']);
    assert.equal(batch[1].conversation.id, 'other_chat_99');
});

test('archive source paths and handles stay separate from export destinations', () => {
    const entry = { _data: { uncompressedSize: 123 }, async: async () => 'source bytes' };
    const raw = { htmlText: activity('Read <a href="docs/report%3F.pdf">report</a>'), archiveFiles: { 'docs/report?.pdf': entry } };
    const result = native(raw);
    const asset = result.conversation.assets[0];
    assert.equal(asset.kind, 'file');
    assert.equal(asset.name, 'report?.pdf');
    assert.equal(asset.byteLength, 123);
    assert.equal(asset.source?.uri, 'docs/report?.pdf');
    assert.equal(result.archiveResources[asset.id].entry, entry);
    assert.equal(result.archiveResources[asset.id].path, 'docs/report?.pdf');
    assert.deepEqual(result.resourceHints, {});
    assert.deepEqual(result.conversation.messages[0].attachmentIds, [asset.id]);
    for (const field of ['localName', 'archiveResources', 'diagnostics', 'async', 'chatTime', 'lastSeen']) assert.ok(!JSON.stringify(result.conversation).includes(`"${field}":`));
    assertDomainClosure(result.conversation);
});

test('missing and ambiguous archive files remain explicit resources with diagnostics', () => {
    const result = native({ htmlText: activity('Read <a href="photo.png">image</a> and <a href="missing.pdf">file</a>'), archiveFiles: { 'one/photo.png': {}, 'two/photo.png': {} } });
    assert.equal(result.conversation.assets.length, 2);
    assert.ok(result.diagnostics.some(d => d.code === 'TAKEOUT_AMBIGUOUS_RESOURCE'));
    assert.ok(result.diagnostics.some(d => d.code === 'TAKEOUT_MISSING_RESOURCE'));
    assert.deepEqual(result.archiveResources, {});
    for (const asset of result.conversation.assets) assert.ok(asset.failureReason);
    assertDomainClosure(result.conversation);
});

test('a recorded generation event survives missing files without guessing ZIP ownership', () => {
    const result = native({ htmlText: activity('Draw', '', '', ID, '2 generated images'), archiveFiles: { 'watermarked_img_unrelated.png': {} } });
    assert.deepEqual(result.conversation.messages[1].generation, { mediaKind: 'image', outputCount: 2 });
    assert.equal(result.conversation.assets.length, 0);
    assert.ok(result.diagnostics.some(d => d.code === 'TAKEOUT_GENERATED_MEDIA_UNRESOLVED'));
    const restored = JSON.parse(JSON.stringify(result.conversation));
    assert.deepEqual(restored.messages[1].generation, result.conversation.messages[1].generation);
    assertDomainClosure(restored);
});

test('explicit generated output references close body and attachment relationships over one source asset', () => {
    const result = native({ htmlText: activity('Draw', '<p>Output <img src="images/source.png"></p>', '', ID, '1 generated image'), archiveFiles: { 'images/source.png': {} } });
    const asset = result.conversation.assets[0];
    assert.equal(result.conversation.assets.length, 1);
    assert.equal(asset.generated, true);
    assert.equal(asset.generation?.imageOrdinal, 0);
    assert.deepEqual(result.conversation.messages[1].attachmentIds, [asset.id]);
    assert.deepEqual(result.conversation.messages[1].generation, { mediaKind: 'image', outputCount: 1 });
    assertDomainClosure(result.conversation);
});

test('uncertain media ownership preserves the source resource without inventing a message relationship', () => {
    const result = native({ htmlText: activity('Question', '<p>Answer</p>', '', ID, '<img src="unbound.png">'), archiveFiles: { 'unbound.png': {} } });
    assert.equal(result.conversation.assets.length, 1);
    for (const message of result.conversation.messages) assert.deepEqual(message.attachmentIds ?? [], []);
    assert.ok(result.diagnostics.some(d => d.code === 'TAKEOUT_UNBOUND_RESOURCE'));
    assertDomainClosure(result.conversation);
});

test('long report HTML becomes authored Content AST without synthetic document IDs or filenames', () => {
    const report = `<h1>Research report</h1><div><p>${'Evidence '.repeat(400)}</p></div><p>Tail evidence</p><table><tr><th>Item</th></tr><tr><td>Value</td></tr></table>`;
    const result = native({ htmlText: activity('Research', report, '') });
    assert.equal(result.conversation.assets.length, 0);
    assert.ok(text(result.conversation.messages[1].content).includes('Tail evidence'));
    assert.ok(result.conversation.messages[1].content.some(block => block.type === 'heading'));
    assert.ok(result.conversation.messages[1].content.some(block => block.type === 'table'));
    const before = JSON.stringify(result.conversation);
    const document = composeDomainDocument(result.conversation).document;
    const restored = composeDomainDocument(JSON.parse(before)).document;
    for (const backend of [renderDocumentHtml, renderDocumentMarkdown, renderDocumentTypst]) assert.deepEqual(backend(document, {}), backend(restored, {}));
    assert.equal(JSON.stringify(result.conversation), before);
});

test('Takeout extraction has no export naming and native parsing does not call compatibility constructors', () => {
    assert.equal(native({ htmlText: activity() }).conversation.messages.length, 2);
    const source = readFileSync(join(__dirname, '../src/core/parsers/gemini/takeout/parseConversation.ts'), 'utf8');
    assert.doesNotMatch(source, /parseTakeoutHtmlBlocks|correlateGeneratedImages|parseConversationRecord|Date\.now|sanitizeFileName|localName/);
    assert.equal(decodeTakeoutHtml(activity())[0].conversationIds[0], ID);
    assert.throws(() => native({ htmlText: 'unsupported format' }), /Unsupported Takeout/);
    assert.throws(() => parseGeminiTakeoutArchive({ htmlText: activity() }, { providerId: 'openai' }), /providerId gemini/);
});


test('raw ZIP bytes decode directly to selected and batch Domain results with actual archive entries', async () => {
    const JSZip = require('../lib/jszip.min.js') as { new(): { file(path: string, data: string): void; generateAsync(options: { type: string }): Promise<Uint8Array> }; loadAsync(bytes: unknown): Promise<unknown> };
    const zip = new JSZip();
    zip.file('Takeout/Gemini/MyActivity.html', activity('Question', '<p>Output <img src="photo.png"></p>'));
    zip.file('Takeout/Gemini/photo.png', 'image source bytes');
    const data = await zip.generateAsync({ type: 'uint8array' });
    const result = await parseConversation({ format: 'gemini-takeout-zip', providerId: 'gemini', data, readArchive: bytes => JSZip.loadAsync(bytes) });
    assert.equal(result.conversation.id, ID);
    assert.equal(result.conversation.assets.length, 1);
    const handle = result.archiveResources[result.conversation.assets[0].id];
    assert.equal(handle.path, 'Takeout/Gemini/photo.png');
    assert.equal(await handle.entry.async!('text'), 'image source bytes');
    assertDomainClosure(JSON.parse(JSON.stringify(result.conversation)));
    const batch = await parseGeminiTakeoutZipArchive(data, { providerId: 'gemini', readArchive: bytes => JSZip.loadAsync(bytes) });
    assert.deepEqual(batch[0].conversation, result.conversation);
});

test('ZIP parsing rejects malformed inventories, unverifiable HTML sizes and ambiguous activity selection', async () => {
    const data = new Uint8Array([1]);
    await assert.rejects(parseConversation({ format: 'gemini-takeout-zip', providerId: 'gemini', data, readArchive: async () => ({}) }), /inventory/);
    await assert.rejects(parseConversation({ format: 'gemini-takeout-zip', providerId: 'gemini', data,
        readArchive: async () => ({ files: { 'MyActivity.html': { async: async () => activity() } } }) }), /size|大小/);
    await assert.rejects(parseConversation({ format: 'gemini-takeout-zip', providerId: 'gemini', data,
        readArchive: async () => ({ files: { 'a/MyActivity.html': { _data: { uncompressedSize: 0 } }, 'b/MyActivity.html': { _data: { uncompressedSize: 0 } } } }) }), /activityPath/);
});


test('Domain generation events reject invalid media kinds and output counts', () => {
    const { conversation } = native({ htmlText: activity('Draw', '', '', ID, '2 generated images') });
    for (const outputCount of [-1, 1.5, Infinity, NaN]) {
        const invalid = structuredClone(conversation);
        invalid.messages[1].generation!.outputCount = outputCount;
        assert.throws(() => assertDomainClosure(invalid), /generation event/);
    }
    const invalid = structuredClone(conversation);
    invalid.messages[1].generation!.mediaKind = 'unknown' as never;
    assert.throws(() => assertDomainClosure(invalid), /generation event/);
});


test('response-only activity cannot fabricate a user prompt from its first content cell', () => {
    const htmlText = activity().replace('Prompted Question<br>', '');
    const { conversation } = native({ htmlText });
    assert.deepEqual(conversation.messages.map(m => m.role), ['assistant']);
    assert.equal(text(conversation.messages[0].content), 'Answer');
});


test('authored assets prefixes are source paths and cannot collapse different ZIP entries', () => {
    const result = native({ htmlText: activity('Question', '<p><img src="assets/photo.png"><img src="photo.png"></p>'), archiveFiles: { 'assets/photo.png': {}, 'photo.png': {} } });
    assert.equal(result.conversation.assets.length, 2);
    assert.deepEqual(result.conversation.assets.map(asset => asset.source?.uri).sort(), ['assets/photo.png', 'photo.png']);
    assert.equal(result.conversation.messages[1].attachmentIds?.length, 2);
    assertDomainClosure(result.conversation);
});
