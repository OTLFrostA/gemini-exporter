import { describe as __suiteDescribe } from 'node:test';
import { geminiRpcPacket } from "./fixtures/providers/geminiRpcCapture.js";
import { GEMINI_DETAIL_CAPTURE } from "./fixtures/providers/geminiRpcCapture.js";
import { fixtureAccount } from "./helpers/domainFixture.js";
import { useIndexStorage } from "./helpers/indexStorage.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGeminiRpcConversation } from "../src/l1/parsers/gemini/rpc/parseConversation.js";
import { mergeConversationPages } from "../src/l1/parsers/gemini/rpc/mergePages.js";
import { getConversationDetail } from "../src/l1/client/gemini/api/pagination.js";
import { assertDomainClosure } from "../src/l2/closure.js";
import { textOfBlock } from "./helpers/contentText.js";
import { type SourceConversationParseResult } from "../src/l1/parsers/parsingResult.js";
import { detailGen as geminiDetailGen } from "./fixtures/providers/geminiDetail.js";
import test__s1 from "node:test";
import { fixtureKey } from "./helpers/domainFixture.js";
import { validateParserDomain } from "../src/l2/runtimeValidation.js";
import { importTakeout } from "../src/application/imports/importTakeout.js";
import { createSourceResourceContext } from "../src/l1/resources/sourceResources.js";
import { ingestDetail } from "../src/l2/ingestion.js";
import { readConversation } from "../src/l2/readConversation.js";
import { getDetail } from "../src/l3a/storageService.js";
import { getIndex } from "../src/l3a/storageService.js";
import { composeDomainDocument } from "../src/l3b/compose/composeDomainDocument.js";
import { collectDocumentResources } from "../src/l3b/ast/resourceReferences.js";
import { renderDocumentHtml } from "../src/l4/format/html/renderHtml.js";
import { renderDocumentMarkdown } from "../src/l4/format/markdown/renderMarkdown.js";
import { renderDocumentTypst } from "./helpers/renderTypstFixture.js";
import { serializeDomainJson } from "../src/l4/format/json/serializeDomainJson.js";
import { JSON_ARCHIVE_VERSION } from "../src/l4/format/json/serializeDomainJson.js";
import { planExportPaths } from "../src/l4/packaging/index.js";
import { buildExportFiles } from "../src/l4/packaging/index.js";
import { packageExportFiles } from "../src/l4/packaging/index.js";
import { prepareExportResources } from "../src/application/export/prepareExportResources.js";
import { type PreparedResources } from "../src/shared/resources/resourceResult.js";
import { type ResourceResult } from "../src/shared/resources/resourceResult.js";
import { type ResourceBytes } from "../src/shared/resources/resourceResult.js";
import { __setZipConstructor } from "../src/l4/packaging/writers/zipWriter.js";
import { __getZipConstructor } from "../src/l4/packaging/writers/zipWriter.js";

__suiteDescribe("provider-native-callers", () => {
useIndexStorage();









function page(key: Parameters<typeof geminiDetailGen>[0]) {
    return parseGeminiRpcConversation(geminiDetailGen(key), {
        account: fixtureAccount('gemini'), providerId: 'gemini', targetConvId: 'native',
    });
}
const result = (uri?: string, messageId = 'm1', timestamp = 1): SourceConversationParseResult => ({ conversationId: 'native',
    sourceVersion: timestamp, conversation: { index: { titleSource: 'derived', title: 'Title' }, detail: { quality: { status: 'unknown' }, messages: [{ id: messageId, role: 'assistant', model: 'Authored model', timestamp,
        content: [{ type: 'table', rows: [{ cells: [{ children: [{ type: 'strong', children: [{ type: 'text', text: 'Rich answer' }] }, { type: 'image', assetId: 'image' }] }] }] }], attachmentIds: ['image'] }], assets: [{ id: 'image', kind: 'image', name: 'photo.png', ...(uri ? { sourceUri: uri } : {}) }] } }, diagnostics: [], acquisitionHints: {} });
const activity = (refs: string) => `<div class="outer-cell"><a href="https://gemini.google.com/app/c_native">Chat</a><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Prompted Read ${refs}<br>2026-09-02T12:00:00Z<br><p>Answer</p></div></div>`;
test('production pagination merges native pages chronologically and closes renamed resources', async () => {
    const pages = [page('G_NATIVE_CALLERS_MIXED_01'), page('G_NATIVE_CALLERS_MIXED_02')];
    let index = 0;
    const detail = await getConversationDetail({ async fetchConversationPage() { return pages[index++]; } }, 'native');
    const native = detail;
    assert.equal(index, 2);
    assert.deepEqual(native.conversation.detail.messages.filter(m => m.role === 'user').map(m => textOfBlock(m.content[0])), ['Question r_old', 'Question r_new']);
    assert.equal(native.conversation.index.createdAt, undefined);
    assert.equal(detail.conversation.index.createdAt, native.conversation.index.createdAt);
    assert.equal(detail.sourceVersion, 1700000010000);
    assertDomainClosure((native.conversation).detail);
    const merged = mergeConversationPages([result('https://example.test/new.png', 'new', 20), result('https://example.test/old.png', 'old', 10)]);
    assert.deepEqual(merged.conversation.detail.messages.map(m => m.attachmentIds), [['image_page1'], ['image']]);
    assert.equal(merged.conversation.detail.assets.length, 2);
    assertDomainClosure((merged.conversation).detail);
});

test('page merge dedupes stable messages and shared source images without collapsing anonymous assets', () => {
    const same = result('https://example.test/shared.png');
    const merged = mergeConversationPages([same, structuredClone(same)]);
    assert.equal(merged.conversation.detail.messages.length, 1);
    assert.equal(merged.conversation.detail.assets.length, 1);
    const anonymous = mergeConversationPages([result(undefined, 'new'), result(undefined, 'old')]);
    assert.equal(anonymous.conversation.detail.assets.length, 2);
    assert.throws(() => mergeConversationPages([same, { ...same, conversationId: 'other' }]), /different conversations/);
});

test('native token loops retain diagnostics and explicitly mark incomplete coverage', async () => {
    const view = page('G_NATIVE_CALLERS_MIXED_03');
    const detail = await getConversationDetail({ async fetchConversationPage() { return view; } }, 'native');
    assert.equal(detail.evidence?.truncation, 'token_loop');
    assert.equal(detail.conversation.detail.messages.length, 2);
    assert.equal(detail.conversation.detail.quality.status, 'partial');
    assert.ok(detail.diagnostics.some(d => d.code === 'GEMINI_PAGINATION_TRUNCATED'));
});

test('production RPC client parses raw responses without invoking the legacy detail facade', async () => {
    const credentials = require('../src/l1/client/gemini/api/credentialManager.js') as typeof import('../src/l1/client/gemini/api/credentialManager.js');
    const transport = require('../src/l1/client/gemini/api/rpcClient.js') as typeof import('../src/l1/client/gemini/api/rpcClient.js');
    const originalCred = credentials.resolveCred, originalPost = transport.postBatchexecute;
    credentials.resolveCred = async () => ({ at: 'test', bl: 'test', accountSlot: '10000000-0000-4000-8000-000000000001', fSid: 'test' });
    transport.postBatchexecute = async () => ({ response: new Response(), text: geminiRpcPacket('detail').responseBody });
    try {
        const { GeminiAPIClient } = require('../src/l1/client/gemini/geminiClient.js') as typeof import('../src/l1/client/gemini/geminiClient.js');
        const detail = await new GeminiAPIClient().fetchConversationPage(GEMINI_DETAIL_CAPTURE.conversationId, null, '10000000-0000-4000-8000-000000000001');
        assert.equal(detail.conversation.index.title, GEMINI_DETAIL_CAPTURE.title);
        assert.equal(detail.conversation.detail.messages.length, GEMINI_DETAIL_CAPTURE.messages);
        assert.equal(Reflect.get(detail.conversation.detail.messages[0], 'provenance'), undefined);
    } finally { credentials.resolveCred = originalCred; transport.postBatchexecute = originalPost; }
});

test('native pagination rejects mixed legacy message pages instead of dropping their bodies', async () => {
    const native = page('G_NATIVE_CALLERS_MIXED_04');
    const legacy = { id: 'native', messages: [{ role: 'model', content: 'old' }] };
    let index = 0;
    await assert.rejects(getConversationDetail({ async fetchConversationPage() { return [native, legacy][index++] as never; } }, 'native'), TypeError);
});


test('metadata-only detail retry follows native pagination to its terminal page', async () => {
    const calls: Array<{ token?: string | null; detailOnly?: boolean }> = [];
    const empty = parseGeminiRpcConversation(geminiDetailGen('G_NATIVE_CALLERS_02'), { account: fixtureAccount('gemini'), providerId: 'gemini', targetConvId: 'native' });
    const detail = await getConversationDetail({ async fetchConversationPage(_id, token, _sid, options) {
        calls.push({ token, detailOnly: options?.detailOnly });
        if (!options?.detailOnly) return empty;
        return token ? page('G_NATIVE_CALLERS_MIXED_05') : page('G_NATIVE_CALLERS_MIXED_06');
    } }, 'native');
    assert.equal(calls.length, 3);
    assert.equal(calls[2].token, 'tC_retry_older');
    assert.equal(calls[2].detailOnly, true);
    assert.equal(detail.conversation.detail.messages.length, 4);
    assert.equal(Boolean(detail.evidence?.truncation), false);
});

test('cooperative ZIP decoding yields to the event loop and preserves synchronous HTML semantics', async () => {
    const { parseGeminiTakeoutArchive, parseGeminiTakeoutArchiveAsync } = require('../src/l1/parsers/gemini/takeout/parseConversation.js') as typeof import('../src/l1/parsers/gemini/takeout/parseConversation.js');
    const raw = { htmlText: Array.from({ length: 120 }, (_, index) => activity(`Question ${index}`)).join('') };
    let yielded = false;
    const timer = setTimeout(() => { yielded = true; }, 0);
    const progress: number[][] = [];
    try {
        const asyncResults = await parseGeminiTakeoutArchiveAsync(raw, { account: fixtureAccount('gemini'), providerId: 'gemini' }, (completed, total) => progress.push([completed, total]));
        assert.equal(yielded, true);
        assert.ok(progress.some(([completed, total]) => completed === 100 && total === 120));
        assert.deepEqual(asyncResults, parseGeminiTakeoutArchive(raw, { account: fixtureAccount('gemini'), providerId: 'gemini' }));
        assert.equal(asyncResults[0].conversation.detail.messages.length, 240);
    } finally { clearTimeout(timer); }
});


test('Takeout prompt-cell attachments and audio stay user-owned while response references remain assistant-owned', () => {
    const { parseGeminiTakeoutArchive } = require('../src/l1/parsers/gemini/takeout/parseConversation.js') as typeof import('../src/l1/parsers/gemini/takeout/parseConversation.js');
    const htmlText = `<div class="outer-cell"><a href="https://gemini.google.com/app/c_native">Chat</a><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Prompted Read files<br>Attached 1 file.<br><a href="same.png">Image</a><br><a href="recording.wav">Audio</a><br>2026-09-02T12:00:00Z<br><p>Answer <img src="same.png"></p></div><div class="content-cell mdl-typography--text-right"><img src="same.png" class="image-preview"></div><img src="unowned.png"></div>`;
    const result = parseGeminiTakeoutArchive({ htmlText, archiveFiles: { 'same.png': {}, 'recording.wav': {}, 'unowned.png': {} } }, { account: fixtureAccount('gemini'), providerId: 'gemini' })[0];
    const assets = new Map(result.conversation.detail.assets.map(asset => [asset.id, asset]));
    assert.deepEqual(result.conversation.detail.messages[0].attachmentIds!.map(id => assets.get(id)!.kind), ['image', 'audio']);
    assert.deepEqual(result.conversation.detail.messages[1].attachmentIds!.map(id => assets.get(id)!.name), ['same.png']);
    assert.equal(result.conversation.detail.messages[0].attachmentIds![0], result.conversation.detail.messages[1].attachmentIds![0]);
    assert.equal(result.diagnostics.filter(d => d.code === 'TAKEOUT_UNBOUND_RESOURCE').length, 1);
    assertDomainClosure((result.conversation).detail);
});


test('metadata-only retry cannot hide a subsequent detail-page fetch failure', async () => {
    const empty = parseGeminiRpcConversation(geminiDetailGen('G_NATIVE_CALLERS_03'), { account: fixtureAccount('gemini'), providerId: 'gemini', targetConvId: 'native' });
    await assert.rejects(getConversationDetail({ async fetchConversationPage(_id, token, _sid, options) {
        if (!options?.detailOnly) return empty;
        if (token) throw new Error('Interrupted detail chain');
        return page('G_NATIVE_CALLERS_MIXED_07');
    } }, 'native'), /Interrupted detail chain/);
});
});

__suiteDescribe("provider-native-callers_other_layers", () => {
/**
 * Cross-module v2 integration: native L1, L2 admission, L3a persistence,
 * L3b document composition and L4 outputs. Only ZIP input/bytes are external.
 */






















useIndexStorage();
const account = fixtureAccount('gemini');
const key = fixtureKey('native');
const JSZip = require('../lib/jszip.min.js');

function native(): SourceConversationParseResult {
    return {
        conversationId: key.conversationId, sourceVersion: 100,
        conversation: {
            index: { title: 'Source-native title', titleSource: 'provider', updatedAt: 100 },
            detail: {
                savedAt: 100, quality: { status: 'complete' },
                assets: [{ id: 'image', kind: 'image', name: 'photo.png', mediaType: 'image/png',
                    sourceUri: 'https://example.test/photo.png' }],
                messages: [{ id: 'source-message', role: 'assistant', model: 'Authored model',
                    attachmentIds: ['image'], content: [{
                        type: 'table', rows: [{ cells: [{ children: [
                            { type: 'strong', children: [{ type: 'text', text: 'Rich answer' }] },
                            { type: 'image', assetId: 'image' },
                        ] }] }],
                    }],
                }],
            },
        },
        diagnostics: [], acquisitionHints: {},
    };
}
function bind(source: SourceConversationParseResult) {
    const conversationKey = { accountId: account.id, conversationId: source.conversationId };
    return validateParserDomain({
        index: { ...source.conversation.index, key: conversationKey },
        detail: { ...source.conversation.detail, key: conversationKey },
    });
}
const activity = (references: string) =>
    '<div class="outer-cell"><a href="https://gemini.google.com/app/c_native">Chat</a>' +
    '<div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">' +
    'Prompted Read ' + references + '<br>2026-09-02T12:00:00Z<br><p>Answer</p></div></div>';
type Entry = { _data: { uncompressedSize: number }; async: (type: string) => Promise<string | Uint8Array> };
function takeoutArchive(html: string, entries: Record<string, Uint8Array> = {}): File {
    const files: Record<string, Entry> = {
        'Takeout/Gemini Apps/MyActivity.html': { _data: { uncompressedSize: html.length }, async: async () => html },
    };
    for (const [name, bytes] of Object.entries(entries)) files[name] = {
        _data: { uncompressedSize: bytes.length }, async: async () => bytes,
    };
    return { file() {}, files } as unknown as File;
}

test__s1('native L1 facts preserve rich content and model through real L2, L3b and three renderers', async () => {
    const source = native(), before = structuredClone(source.conversation);
    const trusted = bind(source);
    await ingestDetail(account.id, source.conversationId, trusted.detail, trusted.index);
    const conversation = await readConversation(key);
    assert.ok(conversation);
    const document = composeDomainDocument(conversation, account);
    const snapshot = structuredClone(document);
    const outputs = [
        renderDocumentHtml(document, {}).html,
        renderDocumentMarkdown(document, {}),
        JSON.stringify(renderDocumentTypst(document, {})),
    ];
    for (const output of outputs) {
        assert.match(output, /Rich answer/);
        assert.match(output, /Authored model/);
    }
    assert.equal(document.messages.length, 1);
    assert.deepEqual([...collectDocumentResources(document).referencedIds], ['image']);
    assert.deepEqual(document, snapshot);
    assert.deepEqual(source.conversation, before);
});

test__s1('L4 JSON serializes trusted native v2 Domain without legacy DTO or mutable source fields', () => {
    const source = native(), before = structuredClone(source);
    const trusted = bind(source);
    const archive = JSON.parse(serializeDomainJson(trusted, account, {}));
    assert.equal(archive.version, JSON_ARCHIVE_VERSION);
    assert.equal(archive.version, 1);
    assert.equal(archive.format, 'gemini-exporter-domain');
    assert.deepEqual(archive.conversation, trusted);
    assert.equal('sourceVersion' in archive, false);
    assert.equal('parsed' in archive, false);
    assert.equal(archive.conversation.detail.messages[0].model, 'Authored model');
    assert.deepEqual(source, before);
    assert.throws(() => validateParserDomain({ ...trusted,
        detail: { ...trusted.detail, quality: { ...trusted.detail.quality, rejectedTurns: 2 } } } as never),
    /Domain contract/);
    assert.throws(() => serializeDomainJson(trusted, fixtureAccount('chatgpt'), {}), /Account\/key mismatch/);
});

test__s1('real v2 Takeout import admits Index/Detail and retains variant filenames as lazy task bytes', async () => {
    const context = createSourceResourceContext();
    const files = {
        'Takeout/Gemini Apps/image-hash': Uint8Array.of(1),
        'Takeout/Gemini Apps/IMG-hash.jpg': Uint8Array.of(2),
        'Takeout/Gemini Apps/script-hash': Uint8Array.of(3),
    };
    const refs = '<a href="image-hash.png">image</a> <a href="IMG-hash.jpeg">photo</a> <a href="script-hash.py">script</a>';
    try {
        const result = await importTakeout(takeoutArchive(activity(refs), files), account.id, undefined, context);
        assert.equal(result.imported, 1);
        assert.equal(result.status, 'partial', 'Takeout is not an online completeness claim');
        const conversation = await readConversation(key);
        assert.ok(conversation);
        assert.ok(await getIndex(key));
        assert.ok(await getDetail(key));
        assert.equal(conversation.detail.assets.length, 3);
        assert.equal(conversation.detail.quality.status, 'partial');
        const assets = conversation.detail.assets;
        const acquired = await Promise.all(assets.map(asset => context.acquire(key, asset)));
        assert.deepEqual(acquired.map(value => [...value.bytes]), [[1], [2], [3]]);
        assert.ok(!JSON.stringify(conversation).includes('dataBase64'));

        const document = composeDomainDocument(conversation, account);
        const prepared: PreparedResources = new Map<string, ResourceResult<ResourceBytes>>(assets.map((asset, i): [string, ResourceResult<ResourceBytes>] =>
            [asset.id, { ok: true, resourceId: asset.id,
                value: { bytes: acquired[i].bytes,
                    mediaType: asset.kind === 'image' ? 'image/png' : 'application/octet-stream' } }]));
        const oldZip = __getZipConstructor();
        __setZipConstructor(JSZip);
        try {
            const [plan] = planExportPaths([{ conversation, prepared,
                fileIds: collectDocumentResources(document).fileIds }], 'markdown');
            const markdown = renderDocumentMarkdown(document, plan.resources);
            const files = buildExportFiles('markdown', plan, markdown, prepared);
            const [packed] = await packageExportFiles([files], 'browserDownload');
            const zip = await JSZip.loadAsync(await (packed.content as Blob).arrayBuffer());
            assert.equal(await zip.file(plan.fileName).async('string'), markdown);
            for (const [i, asset] of assets.entries()) {
                assert.deepEqual(await zip.file(plan.resources[asset.id]).async('uint8array'), acquired[i].bytes);
            }
        } finally { __setZipConstructor(oldZip); }
    } finally { context.release(); }
});

test__s1('a partial Takeout cannot replace a complete v2 Detail or capture its source readers', async () => {
    await ingestDetail(account.id, key.conversationId, {
        savedAt: 9999999999999, quality: { status: 'complete' }, assets: [],
        messages: [{ role: 'assistant', content: [{ type: 'paragraph',
            children: [{ type: 'text', text: 'Keep complete body' }] }] }],
    }, { title: 'Local title', titleSource: 'user', updatedAt: 9999999999999 });
    const context = createSourceResourceContext();
    try {
        const result = await importTakeout(takeoutArchive(activity('<a href="image.png">image</a>'), {
            'Takeout/Gemini Apps/image.png': Uint8Array.of(7),
        }), account.id, undefined, context);
        assert.equal(result.imported, 1);
        const stored = await readConversation(key);
        assert.ok(stored);
        assert.equal(stored.detail.quality.status, 'complete');
        assert.equal(stored.detail.assets.length, 0);
        assert.match(JSON.stringify(stored.detail.messages), /Keep complete body/);
        assert.equal(stored.index.title, 'Local title');
        await assert.rejects(context.acquire(key, { id: 'image', kind: 'image' }), /No supported source locator/);
    } finally { context.release(); }
});

test__s1('ambiguous Takeout ZIP paths never select unrelated resource bytes', async () => {
    const context = createSourceResourceContext();
    try {
        const result = await importTakeout(takeoutArchive(activity('<a href="photo.png">image</a>'), {
            'one/photo.png': Uint8Array.of(1), 'two/photo.png': Uint8Array.of(2),
        }), account.id, undefined, context);
        assert.equal(result.imported, 1);
        assert.equal(result.status, 'partial');
        const stored = await readConversation(key);
        assert.ok(stored);
        const asset = stored.detail.assets[0];
        assert.ok(asset);
        await assert.rejects(context.acquire(key, asset), /No supported source locator/);
    } finally { context.release(); }
});

for (const uri of ['missing.png', 'blob:missing.png', 'file:missing.png', 'custom:missing.png']) {
    test__s1('missing or unsupported Takeout reference ' + uri + ' never fabricates bytes', async () => {
        const context = createSourceResourceContext();
        try {
            const result = await importTakeout(takeoutArchive(activity('<a href="' + uri + '">image</a>')),
                account.id, undefined, context);
            assert.equal(result.imported, 1);
            assert.equal(result.status, 'partial');
            const conversation = await readConversation(key);
            assert.ok(conversation);
            const asset = conversation.detail.assets[0];
            assert.ok(asset);
            await assert.rejects(context.acquire(key, asset), /No supported source locator/);
        } finally { context.release(); }
    });
}

test__s1('Application resources and L4 paths rename output without mutating L1 source identity or bytes', async () => {
    const source = native();
    source.acquisitionHints = { image: { dataBase64: 'AQID' } };
    const trusted = bind(source), before = structuredClone(trusted);
    const context = createSourceResourceContext();
    try {
        context.retainParsed(key, source);
        const prepared = await prepareExportResources(trusted.detail.assets, new Set(['image']),
            (asset, signal) => context.acquire(key, asset, signal));
        const image = prepared.get('image');
        assert.ok(image?.ok);
        assert.deepEqual(image.value.bytes, Uint8Array.of(1, 2, 3));
        const document = composeDomainDocument(trusted, account);
        const [plan] = planExportPaths([{ conversation: trusted, prepared, fileIds: new Set<string>() }], 'markdown');
        const markdown = renderDocumentMarkdown(document, plan.resources);
        assert.match(markdown, /assets\//);
        assert.ok(plan.resources.image.startsWith('assets/'));
        assert.notEqual(plan.resources.image, trusted.detail.assets[0].sourceUri);
        assert.deepEqual(trusted, before);
    } finally { context.release(); }
});
});
