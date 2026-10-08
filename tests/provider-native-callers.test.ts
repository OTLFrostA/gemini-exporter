import type { ResourceResult, ResourceDelivery } from '../src/core/resources/resourceResult.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGeminiRpcConversation } from '../src/core/parsers/gemini/rpc/parseConversation.js';
import { mergeConversationPages } from '../src/core/parsers/gemini/rpc/mergePages.js';
import { projectDomainRecord } from '../src/core/compatibility/record/projectDomainRecord.js';
import { getConversationDetail } from '../src/core/api/client/pagination.js';
import { formatContent, formatHtmlDocument, formatMarkdownDocument } from '../src/core/engine/chatFormatter.js';
import { preparePdfItem } from '../src/core/export/pdf/prepareItem.js';
import { assertDomainClosure } from '../src/core/domain/closure.js';
import { extractChatParseDrift, chatRecordStatusWithDrift } from '../src/core/engine/export/parseDrift.js';
import { parseTakeoutZip } from '../src/core/compatibility/takeout/takeoutParser.js';
import { MediaIndex } from '../src/core/compatibility/takeout/mediaIndex.js';
import type { ResourceConversationParseResult } from '../src/core/parsers/parsingResult.js';
import { extractBlockText } from '../src/core/domain/content/unknownFallback.js';

const rpc = (inner: unknown) => `)]}'\n\n${JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify(inner)]])}`;
function page(request: string, seconds: number, cursor: string | null = null) {
    const turn = [['c_native', request], [seconds, 0], [[`Question ${request}`]], [[['rc_' + request, [['**Answer**']]]]]];
    return parseGeminiRpcConversation(rpc([[turn], cursor, 'Title']), { providerId: 'gemini', targetConvId: 'native' });
}
const result = (uri?: string, messageId = 'm1', timestamp = 1): ResourceConversationParseResult => ({
    conversation: { providerId: 'gemini', id: 'native', title: 'Title', timestamp, messages: [{ id: messageId, role: 'assistant', model: 'Authored model', timestamp,
        content: [{ type: 'table', rows: [{ cells: [{ children: [{ type: 'strong', children: [{ type: 'text', text: 'Rich answer' }] }, { type: 'image', assetId: 'image' }] }] }] }], attachmentIds: ['image'] }],
        assets: [{ id: 'image', kind: 'image', name: 'photo.png', ...(uri ? { source: { uri } } : {}) }] },
    diagnostics: [], resourceHints: {}, acquisitionHints: {},
});

test('production pagination merges native pages chronologically and closes renamed resources', async () => {
    const pages = [page('r_new', 1700000010, 'tC_older'), page('r_old', 1700000000)];
    let index = 0;
    const detail = await getConversationDetail({ async fetchConversationPage() { return pages[index++]; } }, 'native');
    const native = detail;
    assert.equal(index, 2);
    assert.deepEqual(native.conversation.messages.filter(m => m.role === 'user').map(m => extractBlockText(m.content[0])), ['Question r_old', 'Question r_new']);
    assert.equal(native.conversation.createdAt, 1700000000000);
    assert.equal(detail.conversation.createdAt, native.conversation.createdAt);
    assert.equal(detail.conversation.updatedAt, 1700000010000);
    assertDomainClosure(native.conversation);
    const merged = mergeConversationPages([result('https://example.test/new.png', 'new', 20), result('https://example.test/old.png', 'old', 10)]);
    assert.deepEqual(merged.conversation.messages.map(m => m.attachmentIds), [['image_page1'], ['image']]);
    assert.equal(merged.conversation.assets.length, 2);
    assertDomainClosure(merged.conversation);
});

test('page merge dedupes stable messages and shared source images without collapsing anonymous assets', () => {
    const same = result('https://example.test/shared.png');
    const merged = mergeConversationPages([same, structuredClone(same)]);
    assert.equal(merged.conversation.messages.length, 1);
    assert.equal(merged.conversation.assets.length, 1);
    const anonymous = mergeConversationPages([result(undefined, 'new'), result(undefined, 'old')]);
    assert.equal(anonymous.conversation.assets.length, 2);
    assert.throws(() => mergeConversationPages([same, { ...same, conversation: { ...same.conversation, id: 'other' } }]), /different conversations/);
});

test('native token loops retain diagnostics and explicitly mark incomplete coverage', async () => {
    const view = page('r_one', 1700000000, 'tC_repeat');
    const detail = await getConversationDetail({ async fetchConversationPage() { return view; } }, 'native');
    assert.equal(detail.transport.truncateReason, 'token_loop');
    assert.equal(detail.conversation.messages.length, 2);
    assert.equal(detail.conversation.completeness?.status, 'partial');
    assert.ok(detail.diagnostics.some(d => d.code === 'GEMINI_PAGINATION_TRUNCATED'));
    assert.equal(chatRecordStatusWithDrift('ok', extractChatParseDrift(detail)), 'partial');
});

test('native exports use Domain despite a deliberately corrupted compatibility body', async () => {
    const view = result('data:image/png;base64,iVBORw0KGgo=');
    const projected = projectDomainRecord(view.conversation); projected.messages![0].content = 'CORRUPTED SNAPSHOT';
    const recordParser = require('../src/core/compatibility/record/parseConversationRecord.js') as { parseConversationRecord: (...args: unknown[]) => unknown };
    const old = recordParser.parseConversationRecord;
    recordParser.parseConversationRecord = () => { throw new Error('A native result cannot be reparsed as a record'); };
    try {
        const html = await formatHtmlDocument(view);
        const markdown = await formatMarkdownDocument(view);
        const pdf = await preparePdfItem(view, { includeAssets: false });
        assert.ok(pdf.ok);
        assert.match(html.content, /Rich answer/);
        assert.match(markdown.content, /Rich answer/);
        assert.doesNotMatch(html.content + markdown.content + JSON.stringify(pdf.document), /CORRUPTED SNAPSHOT/);
        assert.match(html.content + markdown.content + JSON.stringify(pdf.document), /Authored model/);
        assert.equal(pdf.document.messages.length, 1);
    } finally { recordParser.parseConversationRecord = old; }
});

test('final serializers preserve native JSON and isolate the external record projection', () => {
    const native = result('https://example.test/photo.png');
    const snapshot = structuredClone(native.conversation);
    const view = native;
    const record = projectDomainRecord(native.conversation);
    assert.equal('parsed' in record, false);
    assert.equal(typeof record.messages![0].content, 'string');
    const json = JSON.parse(formatContent(view, 'json').content);
    assert.equal('parsed' in json, false);
    assert.deepEqual(json.conversation, native.conversation);
    assert.equal(json.version, 1);
    assert.deepEqual(native.conversation, snapshot);

});

test('malformed native results fail rather than silently using the legacy parser', () => {
    assert.throws(() => formatContent({ conversation: result().conversation, diagnostics: [], resourceHints: [], acquisitionHints: {} } as never, 'json'), /Malformed native/);
    assert.throws(() => formatContent({ id: 'old', messages: [] } as never, 'json'));
});

const zipArchive = (files: Record<string, unknown>) => ({ files, file() {} });
const activity = (refs: string) => `<div class="outer-cell"><a href="https://gemini.google.com/app/c_native">Chat</a><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Prompted Read ${refs}<br>2026-09-02T12:00:00Z<br><p>Answer</p></div></div>`;
const htmlEntry = (html: string) => ({ _data: { uncompressedSize: html.length }, async: async () => html });
const bytesEntry = (byte: number) => ({ _data: { uncompressedSize: 1 }, async: async () => new Uint8Array([byte]) });

test('production Takeout binds extension variations once and carries native Domain to PDF acquisition', async () => {
    const slot = 'native-bindings';
    const html = activity('<a href="image-hash.png">image</a> <a href="IMG-hash.jpeg">photo</a> <a href="script-hash.py">script</a>');
    try {
        const parsed = await parseTakeoutZip(zipArchive({ 'Takeout/Gemini Apps/MyActivity.html': htmlEntry(html), 'Takeout/Gemini Apps/image-hash': bytesEntry(1), 'Takeout/Gemini Apps/IMG-hash.jpg': bytesEntry(2), 'Takeout/Gemini Apps/script-hash': bytesEntry(3) }), null, slot);
        const view = parsed.convCache.native;
        assert.equal(view.conversation.assets.length, 3);
        assert.equal(parsed.diagnostics.some(d => /MISSING|AMBIGUOUS/.test(d.code)), false);
        assert.equal('parsed' in parsed.conversations[0], false);
        assert.equal('messages' in parsed.conversations[0], false);
        assert.equal('turns' in parsed.conversations[0], false);
        assert.equal(parsed.conversations[0].source, 'takeout-import');
        assert.ok(Array.isArray(view.conversation.messages[0].content));
        for (const [i, asset] of view.conversation.assets.entries()) assert.deepEqual(await MediaIndex.getTakeoutFallbackMedia('native', { assetId: '', sourceUri: view.resourceHints[asset.id].archivePath! }, slot), new Uint8Array([i + 1]));
        assert.equal(await MediaIndex.getTakeoutFallbackMedia('other', { assetId: '', sourceUri: 'image-hash' }, slot), null);
        const pdf = await preparePdfItem(view, { currentSlot: slot, takeoutEngine: MediaIndex, fetchAsset: async () => ({ success: false, error: 'offline' }), maxAssetRetries: 0 });
        assert.ok(pdf.ok);
        assert.equal([...pdf.resources.values()].filter(r => r.bytes).length, 2);
    } finally { MediaIndex.clearTakeoutData(slot); }
});

test('ambiguous Takeout resources cannot be recovered later by permissive legacy guessing', async () => {
    const slot = 'native-ambiguity';
    try {
        const parsed = await parseTakeoutZip(zipArchive({ 'Takeout/Gemini Apps/MyActivity.html': htmlEntry(activity('<a href="photo.png">image</a>')), 'one/photo.png': bytesEntry(1), 'two/photo.png': bytesEntry(2) }), null, slot);
        assert.ok(parsed.diagnostics.some(d => d.code === 'TAKEOUT_AMBIGUOUS_RESOURCE'));
        const view = parsed.convCache.native;
        const asset = view.conversation.assets[0];
        assert.equal(await MediaIndex.getTakeoutFallbackMedia('native', { assetId: asset.id }, slot), null);
        assert.equal(await MediaIndex.getTakeoutFallbackMedia('native', { assetId: '', sourceUri: 'photo.png' }, slot), null);
    } finally { MediaIndex.clearTakeoutData(slot); }
});

test('production RPC client parses raw responses without invoking the legacy detail facade', async () => {
    const credentials = require('../src/core/api/client/credentialManager.js') as typeof import('../src/core/api/client/credentialManager.js');
    const transport = require('../src/core/api/client/rpcClient.js') as typeof import('../src/core/api/client/rpcClient.js');
    const originalCred = credentials.resolveCred, originalPost = transport.postBatchexecute;
    credentials.resolveCred = async () => ({ at: 'test', bl: 'test', accountSlot: 'u0', fSid: 'test' });
    const rawTurn = [['c_native', 'r_one'], [1700000000, 0], [['Question']], [[['rc_one', [['Answer']]]]]];
    transport.postBatchexecute = async () => new Response(rpc([[rawTurn], null, 'Native title']));
    try {
        const { GeminiAPIClient } = require('../src/core/api/geminiClient.js') as typeof import('../src/core/api/geminiClient.js');
        const detail = await new GeminiAPIClient().fetchConversationPage('native', null, 'u0');
        assert.equal(detail.conversation.title, 'Native title');
        assert.equal(detail.conversation.messages.length, 2);
        assert.equal(detail.conversation.messages[0].provenance?.providerRequestId, 'r_one');
    } finally { credentials.resolveCred = originalCred; transport.postBatchexecute = originalPost; }
});

test('live image renaming updates export hints without modifying native source facts', async () => {
    const { processAndSaveImages, init } = require('../src/content/liveSaveCoordinator.js') as typeof import('../src/content/liveSaveCoordinator.js');
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


test('native pagination rejects mixed legacy message pages instead of dropping their bodies', async () => {
    const native = page('r_native', 1700000000, 'tC_old');
    const legacy = { id: 'native', messages: [{ role: 'model', content: 'old' }] };
    let index = 0;
    await assert.rejects(getConversationDetail({ async fetchConversationPage() { return [native, legacy][index++] as never; } }, 'native'), /native/);
});

test('compatibility table projection preserves pipe and backslash content without adding columns', async () => {
    const { fromMarkdown } = await import('mdast-util-from-markdown');
    const { gfm } = await import('micromark-extension-gfm');
    const { gfmFromMarkdown } = await import('mdast-util-gfm');
    const samples: Array<{ node: import('../src/core/domain/content/inline.js').InlineNode; text: string }> = [
        { node: { type: 'text', text: 'a|b' }, text: 'a|b' },
        { node: { type: 'text', text: 'a\\|b' }, text: 'a\\|b' },
        { node: { type: 'text', text: 'a\\\\|b' }, text: 'a\\\\|b' },
        { node: { type: 'strong', children: [{ type: 'text', text: 'a\\|b' }] }, text: 'a\\|b' },
        { node: { type: 'inlineCode', code: 'a|b' }, text: 'a|b' },
        { node: { type: 'inlineCode', code: 'a\\|b' }, text: 'a\\|b' },
        { node: { type: 'inlineCode', code: 'a\\\\|b' }, text: 'a\\\\|b' },
    ];
    const domain: import('../src/core/domain/conversationDetail.js').DomainConversationDetail = {
        providerId: 'gemini', id: 'projection', title: 'Projection', timestamp: null, assets: [], messages: [{ role: 'assistant', content: [{ type: 'table',
            headerRows: [{ cells: [{ children: [{ type: 'text', text: 'Content' }] }, { children: [{ type: 'text', text: 'Sentinel' }] }] }],
            rows: samples.map(sample => ({ cells: [{ children: [sample.node] }, { children: [{ type: 'text', text: 'kept' }] }] })) }] }],
    };
    const markdown = projectDomainRecord(domain).messages![0].content;
    const tree = fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
    const table = tree.children.find(node => node.type === 'table')!;
    const visible = (node: import('mdast').Nodes): string => node.type === 'html' ? '' : 'value' in node ? node.value : 'children' in node ? node.children.map(visible).join('') : '';
    assert.equal(table.children.length, samples.length + 1);
    samples.forEach((sample, index) => {
        const row = table.children[index + 1];
        assert.equal(row.children.length, 2);
        assert.equal(visible(row.children[0]), sample.text);
        assert.equal(visible(row.children[1]), 'kept');
    });
});


test('metadata-only detail retry follows native pagination to its terminal page', async () => {
    const calls: Array<{ token?: string | null; detailOnly?: boolean }> = [];
    const empty = parseGeminiRpcConversation(rpc([null, null, [['c_native']]]), { providerId: 'gemini', targetConvId: 'native' });
    const detail = await getConversationDetail({ async fetchConversationPage(_id, token, _sid, options) {
        calls.push({ token, detailOnly: options?.detailOnly });
        if (!options?.detailOnly) return empty;
        return token ? page('r_older', 1700000000) : page('r_newer', 1700000010, 'tC_retry_older');
    } }, 'native');
    assert.equal(calls.length, 3);
    assert.equal(calls[2].token, 'tC_retry_older');
    assert.equal(calls[2].detailOnly, true);
    assert.equal(detail.conversation.messages.length, 4);
    assert.equal(detail.transport.truncated, undefined);
});

test('cooperative ZIP decoding yields to the event loop and preserves synchronous HTML semantics', async () => {
    const { parseGeminiTakeoutArchive, parseGeminiTakeoutArchiveAsync } = require('../src/core/parsers/gemini/takeout/parseConversation.js') as typeof import('../src/core/parsers/gemini/takeout/parseConversation.js');
    const raw = { htmlText: Array.from({ length: 120 }, (_, index) => activity(`Question ${index}`)).join('') };
    let yielded = false;
    const timer = setTimeout(() => { yielded = true; }, 0);
    const progress: number[][] = [];
    try {
        const asyncResults = await parseGeminiTakeoutArchiveAsync(raw, { providerId: 'gemini' }, (completed, total) => progress.push([completed, total]));
        assert.equal(yielded, true);
        assert.ok(progress.some(([completed, total]) => completed === 100 && total === 120));
        assert.deepEqual(asyncResults, parseGeminiTakeoutArchive(raw, { providerId: 'gemini' }));
        assert.equal(asyncResults[0].conversation.messages.length, 240);
    } finally { clearTimeout(timer); }
});


test('Takeout prompt-cell attachments and audio stay user-owned while response references remain assistant-owned', () => {
    const { parseGeminiTakeoutArchive } = require('../src/core/parsers/gemini/takeout/parseConversation.js') as typeof import('../src/core/parsers/gemini/takeout/parseConversation.js');
    const htmlText = `<div class="outer-cell"><a href="https://gemini.google.com/app/c_native">Chat</a><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Prompted Read files<br>Attached 1 file.<br><a href="same.png">Image</a><br><a href="recording.wav">Audio</a><br>2026-09-02T12:00:00Z<br><p>Answer <img src="same.png"></p></div><div class="content-cell mdl-typography--text-right"><img src="same.png" class="image-preview"></div><img src="unowned.png"></div>`;
    const result = parseGeminiTakeoutArchive({ htmlText, archiveFiles: { 'same.png': {}, 'recording.wav': {}, 'unowned.png': {} } }, { providerId: 'gemini' })[0];
    const assets = new Map(result.conversation.assets.map(asset => [asset.id, asset]));
    assert.deepEqual(result.conversation.messages[0].attachmentIds!.map(id => assets.get(id)!.kind), ['image', 'audio']);
    assert.deepEqual(result.conversation.messages[1].attachmentIds!.map(id => assets.get(id)!.name), ['same.png']);
    assert.equal(result.conversation.messages[0].attachmentIds![0], result.conversation.messages[1].attachmentIds![0]);
    assert.equal(result.diagnostics.filter(d => d.code === 'TAKEOUT_UNBOUND_RESOURCE').length, 1);
    assertDomainClosure(result.conversation);
});


test('metadata-only retry cannot hide a subsequent detail-page fetch failure', async () => {
    const empty = parseGeminiRpcConversation(rpc([null, null, [['c_native']]]), { providerId: 'gemini', targetConvId: 'native' });
    await assert.rejects(getConversationDetail({ async fetchConversationPage(_id, token, _sid, options) {
        if (!options?.detailOnly) return empty;
        if (token) throw new Error('Interrupted detail chain');
        return page('r_newer', 1700000010, 'tC_retry_older');
    } }, 'native'), /Interrupted detail chain/);
});
