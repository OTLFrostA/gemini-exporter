// Application import/export/resource delivery scenarios retained under normal full discovery.
import { fixtureAccount, fixtureKey } from './helpers/domainFixture.js';
import { useIndexStorage } from './helpers/indexStorage.js';
useIndexStorage();
import { resolveExportRecordStatus } from '../src/core/engine/export/exportCompletion.js';
import { validateParserDomain } from '../src/l2/runtimeValidation.js';
import type { ResourceResult, ResourceDelivery } from '../src/shared/resources/resourceResult.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGeminiRpcConversation } from '../src/l1/parsers/gemini/rpc/parseConversation.js';
import { mergeConversationPages } from '../src/l1/parsers/gemini/rpc/mergePages.js';
import { getConversationDetail } from '../src/l1/client/gemini/api/pagination.js';
import { formatContent, formatHtmlDocument, formatMarkdownDocument } from '../src/core/engine/chatFormatter.js';
import { preparePdfItem } from './helpers/pdfAcquisitionFixture.js';
import { assertDomainClosure } from '../src/l2/closure.js';
import { parseTakeoutZip } from '../src/l1/imports/takeout/importTakeout.js';
import { MediaIndex } from '../src/shared/resources/takeout/mediaIndex.js';
import type { ResourceConversationParseResult } from '../src/l1/parsers/parsingResult.js';
import { getDomainConversationResult } from '../src/l3a/domain/nativePersistence.js';
import { preparePdfResources } from '../src/l4/format/pdf/prepareResources.js';
import { extractBlockText } from '../src/l2/content/unknownFallback.js';

const rpc = (inner: unknown) => `)]}'\n\n${JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify(inner)]])}`;
function page(request: string, seconds: number, cursor: string | null = null) {
    const turn = [['c_native', request], [seconds, 0], [[`Question ${request}`]], [[['rc_' + request, [['**Answer**']]]]]];
    return parseGeminiRpcConversation(JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([[turn], cursor, 'Title'])],
        ['wrb.fr', 'MaZiqc', JSON.stringify([null, null, [['c_native', 'Title', null, null, null, [1700000010, 0]]]])]]), { account: fixtureAccount('gemini'), providerId: 'gemini', targetConvId: 'native' });
}
const result = (uri?: string, messageId = 'm1', timestamp = 1): ResourceConversationParseResult => ({ account: fixtureAccount(),
    sourceVersion: timestamp, conversation: validateParserDomain({ index: { key: fixtureKey(String('native'), 'gemini'),   titleSource: "derived",   title: 'Title' }, detail: { key: fixtureKey(String('native'), 'gemini'), quality: { status: 'unknown' }, messages: [{ id: messageId, role: 'assistant', model: 'Authored model', timestamp,
        content: [{ type: 'table', rows: [{ cells: [{ children: [{ type: 'strong', children: [{ type: 'text', text: 'Rich answer' }] }, { type: 'image', assetId: 'image' }] }] }] }], attachmentIds: ['image'] }], assets: [{ id: 'image', kind: 'image', name: 'photo.png', ...(uri && !/^(?:data|blob):/.test(uri) ? { sourceUri: uri } : {}) }] } }),
    diagnostics: [], resourceHints: {}, acquisitionHints: uri?.startsWith('data:') ? { image: { url: uri } } : {},
});

test('native exports use Domain without invoking the historical record parser', async () => {
    const view = result('data:image/png;base64,iVBORw0KGgo=');
    const recordParser = require('./helpers/recordFixture/parseRecord.js') as { parseConversationRecord: (...args: unknown[]) => unknown };
    const old = recordParser.parseConversationRecord;
    recordParser.parseConversationRecord = () => { throw new Error('A native result cannot be reparsed as a record'); };
    try {
        const html = await formatHtmlDocument(view);
        const markdown = await formatMarkdownDocument(view);
        const pdf = await preparePdfItem(view, { accountId: '10000000-0000-4000-8000-000000000001', ...({ includeAssets: false }) });
        assert.ok(pdf.ok);
        assert.match(html.content, /Rich answer/);
        assert.match(markdown.content, /Rich answer/);
        assert.doesNotMatch(html.content + markdown.content + JSON.stringify(pdf.document), /CORRUPTED SNAPSHOT/);
        assert.match(html.content + markdown.content + JSON.stringify(pdf.document), /Authored model/);
        assert.equal(pdf.document.messages.length, 1);
    } finally { recordParser.parseConversationRecord = old; }
});

test('standard JSON preserves native data without mutation', () => {
    const native = result('https://example.test/photo.png');
    const snapshot = structuredClone(native.conversation);
    const view = native;
    const json = JSON.parse(formatContent(view, 'json').content);
    assert.equal('parsed' in json, false);
    assert.deepEqual(json.conversation, native.conversation);
    assert.equal(json.version, 3);
    assert.deepEqual(native.conversation, snapshot);

});

test('malformed native results fail rather than silently using the legacy parser', () => {
    assert.throws(() => formatContent({ account: fixtureAccount(), conversation: result().conversation, diagnostics: [], resourceHints: [], acquisitionHints: {} } as never, 'json'), /Malformed native/);
    assert.throws(() => formatContent({ id: 'old', messages: [] } as never, 'json'));
});

const zipArchive = (files: Record<string, unknown>) => ({ files, file() {} });
const activity = (refs: string) => `<div class="outer-cell"><a href="https://gemini.google.com/app/c_native">Chat</a><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Prompted Read ${refs}<br>2026-09-02T12:00:00Z<br><p>Answer</p></div></div>`;
const htmlEntry = (html: string) => ({ _data: { uncompressedSize: html.length }, async: async () => html });
const bytesEntry = (byte: number) => ({ _data: { uncompressedSize: 1 }, async: async () => new Uint8Array([byte]) });

test('production Takeout binds extension variations once and carries native Domain to PDF acquisition', async () => {
    const slot = '10000000-0000-4000-8000-000000000001';
    const html = activity('<a href="image-hash.png">image</a> <a href="IMG-hash.jpeg">photo</a> <a href="script-hash.py">script</a>');
    try {
        const parsed = await parseTakeoutZip(zipArchive({ 'Takeout/Gemini Apps/MyActivity.html': htmlEntry(html), 'Takeout/Gemini Apps/image-hash': bytesEntry(1), 'Takeout/Gemini Apps/IMG-hash.jpg': bytesEntry(2), 'Takeout/Gemini Apps/script-hash': bytesEntry(3) }), null, slot);
        const view = parsed.convCache.native;
        assert.equal(view.conversation.detail.assets.length, 3);
        assert.equal(parsed.status, 'ok');
        assert.equal(parsed.resourceResults.filter(result => result.ok).length, 3);
        assert.equal(parsed.diagnostics.some(d => /MISSING|AMBIGUOUS/.test(d.code)), false);
        assert.equal('parsed' in parsed.conversations[0], false);
        assert.equal('messages' in parsed.conversations[0], false);
        assert.equal('turns' in parsed.conversations[0], false);
        assert.equal(Reflect.get(parsed.conversations[0] ?? {}, 'hasTakeoutImport'), undefined);
        assert.ok(Array.isArray(view.conversation.detail.messages[0].content));
        for (const [i, asset] of view.conversation.detail.assets.entries()) assert.deepEqual(await MediaIndex.getTakeoutFallbackMedia('native', { assetId: '', sourceUri: view.resourceHints[asset.id].archivePath! }, slot), new Uint8Array([i + 1]));
        assert.equal(await MediaIndex.getTakeoutFallbackMedia('other', { assetId: '', sourceUri: 'image-hash' }, slot), null);
        const pdf = await preparePdfItem(view, { accountId: slot, takeoutEngine: MediaIndex, fetchAsset: async () => ({ success: false, error: 'offline' }), maxAssetRetries: 0 });
        assert.ok(pdf.ok);
        assert.equal([...pdf.resources.values()].filter(r => r.ok && r.value.bytes.length).length, 2);
    } finally { MediaIndex.clearTakeoutData(slot); }
});

test('non-archive Takeout images do not become missing ZIP resource failures', async () => {
    const slot = '10000000-0000-4000-8000-000000000001';
    try {
        const html = activity('').replace('<p>Answer</p>', '<p>![cdn](//cdn.example.com/image.png) ![remote](https://example.test/remote.png) ![http](http://example.test/plain.png) ![inline](data:image/png;base64,AQID)</p>');
        const parsed = await parseTakeoutZip(zipArchive({ 'Takeout/Gemini Apps/MyActivity.html': htmlEntry(html) }), null, slot);
        assert.equal(parsed.convCache.native.conversation.detail.assets.length, 4);
        assert.equal(parsed.status, 'ok');
        assert.deepEqual(parsed.resourceResults, []);
        assert.ok(!parsed.diagnostics.some(d => d.code === 'RESOURCE_UNAVAILABLE'));
    } finally { MediaIndex.clearTakeoutData(slot); }
});

test('ambiguous Takeout resources cannot be recovered later by permissive legacy guessing', async () => {
    const slot = '10000000-0000-4000-8000-000000000001';
    try {
        const parsed = await parseTakeoutZip(zipArchive({ 'Takeout/Gemini Apps/MyActivity.html': htmlEntry(activity('<a href="photo.png">image</a>')), 'one/photo.png': bytesEntry(1), 'two/photo.png': bytesEntry(2) }), null, slot);
        assert.ok(parsed.diagnostics.some(d => d.code === 'TAKEOUT_AMBIGUOUS_RESOURCE'));
        assert.equal(parsed.status, 'partial');
        assert.equal(parsed.resourceResults.filter(result => !result.ok).length, 1);
        const view = parsed.convCache.native;
        const asset = view.conversation.detail.assets[0];
        assert.equal(await MediaIndex.getTakeoutFallbackMedia('native', { assetId: asset.id }, slot), null);
        assert.equal(await MediaIndex.getTakeoutFallbackMedia('native', { assetId: '', sourceUri: 'photo.png' }, slot), null);
    } finally { MediaIndex.clearTakeoutData(slot); }
});

test('missing ZIP references and unsupported URI schemes report failures through import and storage restore', async () => {
    for (const uri of ['missing.png', 'blob:missing.png', 'file:missing.png', 'custom:missing.png']) {
        const slot = '10000000-0000-4000-8000-000000000001';
        try {
            const parsed = await parseTakeoutZip(zipArchive({ 'Takeout/Gemini Apps/MyActivity.html': htmlEntry(activity(`<a href="${uri}">image</a>`)) }), null, slot);
            assert.equal(parsed.status, 'partial', uri);
            assert.ok(parsed.diagnostics.some(d => d.code === 'TAKEOUT_MISSING_RESOURCE'), uri);
            const asset = parsed.convCache.native.conversation.detail.assets[0];
            assert.ok(parsed.resourceResults.some(result => !result.ok && result.resourceId === asset.id), uri);
            MediaIndex.clearTakeoutData(slot);
            const restored = await getDomainConversationResult(slot, 'native');
            assert.ok(restored);
            const prepared = await preparePdfResources(restored.conversation.detail, new Set([asset.id]), restored.acquisitionHints);
            assert.equal(prepared.resources.get(asset.id)?.ok, false);
            assert.ok(prepared.resources.get(asset.id) && !prepared.resources.get(asset.id)!.ok, uri);
            assert.ok(prepared.diagnostics.some(d => d.code === 'RESOURCE_UNAVAILABLE'), uri);
        } finally { MediaIndex.clearTakeoutData(slot); }
    }
});

test('live image renaming updates export hints without modifying native source facts', async () => {
    const { processAndSaveImages, init } = require('../src/runtime/content/liveSaveCoordinator.js') as typeof import('../src/runtime/content/liveSaveCoordinator.js');
    const native = result('https://example.test/photo.png');
    const source = structuredClone(native.conversation);
    const view = native;
    init({ assetFetcher: { fetchImageBuffer: async () => ({ buffer: new Uint8Array([1, 2, 3]), ext: 'jpg' }) } });
    try {
        const written: string[] = [];
        const deliveries: ResourceResult<ResourceDelivery>[] = [];
        await processAndSaveImages(view, 'native', { async writeFile(subdir: string, filename: string) { written.push(`${subdir}/${filename}`); } }, [], deliveries);
        assert.equal(written.length, 1);
        assert.equal(view.resourceHints.image.archivePath, written[0]);
        assert.deepEqual(native.conversation, source);
        assert.match((await formatMarkdownDocument(view, { resourceResults: deliveries })).content, new RegExp(written[0].replace(/\./g, '\\.')));
    } finally { init(); }
});


