import { describe as __suiteDescribe } from 'node:test';
import { importTakeout } from "../src/application/imports/importTakeout.js";
import { takeoutArchive } from "./helpers/l1SourceFixture.js";
import { getDetail } from "../src/l3a/storageService.js";
import { decodeGeminiDetail } from "../src/l1/parsers/gemini/rpc/detailDecoder.js";
import { listGen as geminiListGen } from "./fixtures/providers/gemini.js";
import { detailGen as geminiDetailGen } from "./fixtures/providers/geminiDetail.js";
import { deleteGen as geminiDeleteGen } from "./fixtures/providers/geminiDelete.js";
import { requestGen as geminiListRequestGen } from "./fixtures/providers/geminiListRequest.js";
import { deleteRequestGen as geminiDeleteRequestGen } from "./fixtures/providers/geminiDeleteRequest.js";
import { useIndexStorage } from "./helpers/indexStorage.js";
import { accountRuntime } from "./helpers/accountRuntime.js";
import { ACCOUNT_OBSERVATION } from "./helpers/accountRuntime.js";
import { ACCOUNT_UUID } from "./helpers/accountRuntime.js";
import { listIndexes } from "../src/l3a/storageService.js";
import { createHookSandbox } from "./helpers/hookSandbox.js";
import * as Extractors from "../src/l1/parsers/gemini/rpc/extractors.js";
import { isRealTitle } from "../src/l1/parsers/gemini/rpc/extractors.js";
import { extractImages } from "./helpers/recordFixture/attachments.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readDeliveredFiles } from "./helpers/v2ExportHost.js";
import { fixtureAccount } from "./helpers/domainFixture.js";
import { ingestDetail } from "../src/l2/ingestion.js";
import { getExportRecord } from "../src/l3a/storageService.js";
import { listExportRecords } from "../src/l3a/storageService.js";
import { putExportRecord } from "../src/l3a/storageService.js";
import { putAccount } from "../src/l3a/storageService.js";
import { updateSettings } from "../src/application/settings/index.js";
import { runExport } from "../src/application/export/runExport.js";
import { type ExportRequest } from "../src/application/export/types.js";
import { assertExportPath } from "../src/l4/packaging/exportPath.js";
import { sanitizeRelativePath } from "../src/shared/utils/pathUtils.js";
import { writeToFolder } from "../src/l4/delivery/index.js";
import { resolveAccountTab } from "../src/runtime/capabilities/tabService.js";
import { __setZipConstructor } from "../src/l4/packaging/writers/zipWriter.js";
import { __getZipConstructor } from "../src/l4/packaging/writers/zipWriter.js";

__suiteDescribe("regression_lock", () => {
// L1 regression locks. Other-layer scenarios remain in regression_lock_other_layers.test.ts
// and stay in ordinary repository discovery alongside this suite.









useIndexStorage();
test('hookCredentials - unrelated fetch and XHR traffic does not rescan account profiles', async () => {
    let scans = 0;
    const { posted, win, Xhr } = createHookSandbox(() => {
        scans++;
        return { gaiaId: '10000000001', email: 'alice@example.com' };
    });
    const initialScans = scans;
    assert.ok(initialScans > 0, 'startup discovery still runs independently of traffic');
    for (let i = 0; i < 20; i++) {
        await win.fetch(new Request(`https://gemini.google.com/assets/chunk-${i}.js`));
        const xhr = new Xhr();
        xhr.open('POST', 'https://gemini.google.com/telemetry');
        xhr.send('event=sample');
    }
    assert.equal(scans, initialScans, 'ordinary requests must add no account DOM scans');
    await win.fetch('https://gemini.google.com/batchexecute?at=token&f.sid=fetch-sid');
    assert.ok(scans > initialScans, 'batchexecute still refreshes the account');
    const afterFetch = scans;
    const xhr = new Xhr();
    xhr.open('POST', 'https://gemini.google.com/batchexecute?at=token&f.sid=xhr-sid');
    xhr.send();
    assert.ok(scans > afterFetch, 'batchexecute XHR still refreshes the account');
    assert.ok(posted.every(p => p.msg.type !== 'GEMINI_CREDENTIALS'));
});

// ============================================================================
// Section 1: Behavioral Locks & End-to-End Export Finalize
// ============================================================================


test('p0-lock: deletion sniffing requires the exact request-bound acknowledgement and ignores decoys', async () => {
    const { posted, win } = createHookSandbox();
    const id = 'deadbeef00112233';
    const body = new URLSearchParams(geminiDeleteRequestGen('G_REGRESSION_MIXED_DELETE_REQUEST_01'));
    body.set('at', 'fixture-at');
    win.__nextResponseText = geminiDeleteGen('G_REGRESSION_LOCK_DELETE_RESPONSE_01');
    await win.fetch('https://gemini.google.com/u/0/batchexecute', { method: 'POST', body });
    await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
    const deleted = posted.filter(p => p.msg.type === 'GEMINI_CONVERSATION_DELETED');
    assert.equal(deleted.length, 1); assert.equal(deleted[0].msg.payload.id, id);
    const relayBody = deleted[0].msg.payload.requestBody;
    assert.ok(typeof relayBody === 'string');
    assert.deepEqual([...new URLSearchParams(relayBody)], [['f.req', body.get('f.req')]]);
    assert.equal(deleted[0].msg.payload.responseText, win.__nextResponseText);
});
test('p0-lock: response-only ids, unacknowledged requests and unrelated hex values cannot authorize deletion', async () => {
    for (const [body, response] of [
        [geminiDeleteRequestGen('G_REGRESSION_DELETE_NO_ID_REQUEST_01'), geminiDeleteGen('G_REGRESSION_LOCK_DELETE_RESPONSE_02')],
        [geminiDeleteRequestGen('G_REGRESSION_DECOY_DELETE_REQUEST_01'), geminiDeleteGen('G_REGRESSION_EMPTY_DELETE_RESPONSE_01')],
        [geminiListRequestGen('G_REGRESSION_DECOY_LIST_REQUEST_01'), geminiListGen('G_REGRESSION_LOCK_DECOY_LIST_01')],
    ]) {
        const { posted, win } = createHookSandbox(); win.__nextResponseText = response;
        await win.fetch('https://gemini.google.com/u/0/batchexecute', { method: 'POST', body });
        await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
        assert.equal(posted.filter(p => p.msg.type === 'GEMINI_CONVERSATION_DELETED').length, 0);
    }
});

test('hookCredentials - broadcastBatchexecute filter only relays LIST and DETAIL payloads', async () => {
    // Drives the REAL filter inside hookCredentials (via the fetch-interception
    // sandbox), not a hand copy: batchexecute response text flows through the
    // actual broadcastBatchexecute, which only relays when the text mentions
    // the LIST or DETAIL RPC ids.
    const batchexecuteUrl = 'https://gemini.google.com/u/0/batchexecute';

    async function relayedTypesFor(responseText: string): Promise<string[]> {
        const { posted, win } = createHookSandbox();
        win.__nextResponseText = responseText;
        await win.fetch(batchexecuteUrl, { method: 'POST', body: geminiListRequestGen('G_HOOK_GENERIC_PROBE_REQUEST_01') });
        // The relay resolves in a few ms via the promise chain; 500ms is ample
        // margin without making negative cases (filtered out) slow.
        const deadline = Date.now() + 500;
        for (;;) {
            const types = posted.map((p: any) => p.msg.type);
            if (types.includes('GEMINI_NETWORK_BATCHEXECUTE') || Date.now() > deadline) return types;
            await new Promise(r => setTimeout(r, 10));
        }
    }
    async function wasRelayed(responseText: string): Promise<boolean> {
        return (await relayedTypesFor(responseText)).includes('GEMINI_NETWORK_BATCHEXECUTE');
    }

    const genericBatchexecute = geminiListGen('G_REGRESSION_GENERIC_DECOY_LIST_01');
    assert.strictEqual(await wasRelayed(genericBatchexecute), false, 'Generic wrb.fr response must be filtered out');

    const deleteBatchexecute = geminiDeleteGen('G_REGRESSION_LOCK_DELETE_RESPONSE_03');
    assert.strictEqual(await wasRelayed(deleteBatchexecute), false, 'Delete RPC response must not pass batchexecute broadcast');

    const listBatchexecute = geminiListGen('G_REGRESSION_LOCK_FILTER_LIST_01');
    assert.strictEqual(await wasRelayed(listBatchexecute), true, 'List RPC must pass filter');

    const detailBatchexecute = geminiDetailGen('G_REGRESSION_LOCK_FILTER_DETAIL_01');
    assert.strictEqual(await wasRelayed(detailBatchexecute), true, 'Detail RPC must pass filter');
});


test('hookCredentials - arbitrary Request-like objects are not treated as browser Requests', async () => {
    const { posted, win } = createHookSandbox();
    win.__nextResponseText = geminiListGen('G_REGRESSION_LOCK_REQUEST_LIST_01');

    // A standard browser Request object produces "[object Request]" from .toString().
    // The pre-refactor hook relied on (url || '').toString() and thus never recognized
    // Request instances as batchexecute or streaming endpoints.
    class MockRequest {
        url: string;
        body: any;
        constructor(url: string, init?: any) {
            this.url = url;
            this.body = init?.body;
        }
        toString() {
            return '[object Request]';
        }
    }

    const req = new MockRequest(
        'https://gemini.google.com/u/0/batchexecute?at=dummy_at&f.sid=dummy_sid',
        { body: geminiListRequestGen('G_HOOK_MALFORMED_LIST_REQUEST_01') }
    );

    await win.fetch(req as any, { method: 'POST', body: geminiListRequestGen('G_HOOK_MALFORMED_LIST_REQUEST_01') });
    await new Promise(r => setTimeout(r, 50));

    // Must not emit stream events or relayed batchexecute payloads
    assert.strictEqual(posted.length, 0, 'Request object input must not be intercepted by (url || "").toString() logic');

    // In contrast, a direct string URL (or URL object) is recognized and intercepted
    await win.fetch('https://gemini.google.com/u/0/batchexecute?at=dummy_at&f.sid=dummy_sid', {
        method: 'POST',
        body: geminiListRequestGen('G_HOOK_MALFORMED_LIST_REQUEST_01')
    });
    await new Promise(r => setTimeout(r, 50));
    assert.ok(posted.length > 0, 'String URL must be recognized and intercepted');
    assert.ok(posted.some(p => p.msg.type === 'GEMINI_NETWORK_BATCHEXECUTE'));
});


test('hookCredentials - real Request inputs preserve list cursor context', async () => {
    const { posted, win } = createHookSandbox();
    win.__nextResponseText = geminiListGen('G_REGRESSION_LOCK_CURSOR_LIST_01');
    const body = new URLSearchParams(geminiListRequestGen('G_HOOK_LIST_CURSOR_REQUEST_01'));
    await win.fetch(new Request('https://gemini.google.com/u/0/batchexecute', { method: 'POST', body }));
    await new Promise(r => setTimeout(r, 50));
    const relay = posted.find(p => p.msg.type === 'GEMINI_NETWORK_BATCHEXECUTE');
    assert.ok(relay);
    assert.deepEqual(JSON.parse(JSON.stringify(relay.msg.payload.listRequest)), { streamId: 'recent', requestCursor: 'cursor' });
    assert.equal(relay.msg.payload.truncated, false);
    assert.ok(typeof relay.msg.payload.requestedAt === 'number' && relay.msg.payload.requestedAt > 0);
});


// ============================================================================
// Section 3: API Parser, Title Extraction & Deduplication
// ============================================================================


test('audit fix: robustFirstPayload preserves , null , and control characters inside user content strings', () => {
    const testContent = 'Special test message with , null , in code and [brackets]';
    const text = geminiDetailGen('G_REGRESSION_LOCK_PARSER_DETAIL_01');
    const parsed = decodeGeminiDetail(text, 'testid1234567890ab');
    assert.ok(parsed, 'Detail should be parsed successfully');
    assert.ok(parsed.messages && parsed.messages.length > 0, 'Messages should be extracted');
    assert.strictEqual(parsed.messages[0].content, testContent, 'Message content should not be altered by regex replacements');
});


test('P2 regression: robustFirstPayload retains all 601 entries in a large multiline payload', () => {
    const lines = [")]}'", '['];
    for (let i = 0; i < 600; i++) {
        lines.push(`  ["turn_${i}", "user query with [nested bracket] ${i}", "response_${i}"],`);
    }
    lines.push('  ["final_turn", "query", "answer"]');
    lines.push(']');
    const payload = lines.join('\n');

    const result = Extractors.robustFirstPayload(payload);

    assert.ok(Array.isArray(result), 'Payload must parse to array');
    assert.strictEqual(result.length, 601, 'Must extract all 601 items');
});


test('P2 regression: robustFirstPayload handles strings containing brackets without corrupting structure', () => {
    const jsonStr = geminiListGen('G_REGRESSION_BRACKET_TITLE_LIST_01');
    const res = Extractors.robustFirstPayload(jsonStr);
    assert.ok(Array.isArray(res));
    assert.strictEqual(res.length, 1);
    assert.ok(Array.isArray(res[0]));
    assert.strictEqual(res[0][0], 'wrb.fr');
    assert.strictEqual(res[0][1], 'MaZiqc');
});


test('audit fix: isRealTitle fallback filters invalid titles properly', () => {
    assert.strictEqual(isRealTitle('Sign in with Google'), false, 'Sign in should be filtered');
    assert.strictEqual(isRealTitle('未命名对话(3)', 'c_123'), false, 'Numbered untitled should be filtered');
    assert.strictEqual(isRealTitle('搜索'), false, 'Search should be filtered');
    assert.strictEqual(isRealTitle('Valid Chat Title 2026', 'c_123'), true, 'Real title should be accepted');
});


test('regression: gemini_parser image naming must be globally unique across turns', () => {
    const seq = { value: 1 };
    const imgObj1 = ['https://lh3.googleusercontent.com/a1b2c3d4', 100, 200];
    const imgObj2 = ['https://lh3.googleusercontent.com/e5f6g7h8', 300, 400];
    const res1 = extractImages([imgObj1], seq);
    const res2 = extractImages([imgObj2], seq);
    assert.strictEqual(res1.length, 1);
    assert.strictEqual(res2.length, 1);
    assert.notStrictEqual(res1[0].fileName, res2[0].fileName, `fileName should be unique, got both ${res1[0].fileName}`);
    assert.ok(res2[0].fileName);
    assert.ok(res2[0].fileName.includes('image-2') || res2[0].fileName.includes('image-1') === false, 'second image should have incremented counter');
    const seq2 = { value: 1 };
    extractImages([imgObj1], seq2);
    const r2 = extractImages([imgObj1, imgObj2], seq2);
    assert.strictEqual(r2.length, 2);
});

// ============================================================================
// Section 4: Storage, Tabs & Slot Isolation
// ============================================================================


test('passive RPC lists bind captured UUID independently of the routing slot', async () => {
    const runtime = accountRuntime();
    try {
        const bridge = require('../src/l1/sniffer/gemini/messageBridge.js'); bridge.init();
        const text = geminiListGen('G_REGRESSION_SLOT_ISOLATION_LIST_01');
        for (const slot of ['u1','u0']) await bridge.handleWindowMessage({ origin: location.origin, source: window,
            data: { type: 'GEMINI_NETWORK_BATCHEXECUTE', payload: { text, slot, requestAccountObservation: ACCOUNT_OBSERVATION,
                requestedAt: Date.now(), truncated: false, url: 'https://gemini.google.com/_/BardChatUi/data/batchexecute' } } });
        const rows = await listIndexes(ACCOUNT_UUID); assert.equal(rows.length, 1);
        assert.equal(rows[0].key.accountId, ACCOUNT_UUID);
    } finally { runtime.restore(); }
});

test('Takeout later meaningful title replaces a placeholder through current L1 import and L2 admission', async () => {
    const html = `<html><body>
      <div class="outer-cell">
        <a href="https://gemini.google.com/app/BUG_REPRO_001">Link1</a>
        <div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Takeout conversation<br><p>model response 1</p></div>
      </div>
      <div class="outer-cell">
        <a href="https://gemini.google.com/app/BUG_REPRO_001">Link2</a>
        <div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Corrected Title<br><p>model response 2</p></div>
      </div>
    </body></html>`;
    const result = await importTakeout(takeoutArchive(html), ACCOUNT_UUID);
    assert.equal(result.imported, 1);
    const indexes = await listIndexes(ACCOUNT_UUID);
    assert.equal(indexes.length, 1);
    assert.equal(indexes[0].title, 'Corrected Title');
    assert.equal(indexes[0].titleSource, 'derived');
    const detail = await getDetail({ accountId: ACCOUNT_UUID, conversationId: 'BUG_REPRO_001' });
    assert.ok(detail);
    const persisted = JSON.stringify(detail.messages);
    assert.ok(persisted.includes('model response 1'));
    assert.ok(persisted.includes('model response 2'));
});
});

__suiteDescribe("regression_lock_other_layers", () => {
/**
 * Retained cross-module regression behaviors on real v2 implementations:
 * L2 Detail/Index -> L3a -> Application -> L3b -> L4 -> Delivery/ExportRecord.
 * Legacy ExportEngine queues, AssetPipeline and source-text implementation locks
 * are not v2 interfaces. Only browser/network/IndexedDB host surfaces are faked.
 */
















useIndexStorage();
const account = fixtureAccount('gemini');
test.beforeEach(async () => {
    await putAccount(account);
    await putAccount({ id: '10000000-0000-4000-8000-000000000002', providerId: 'gemini', providerAccountId: '10000000002' });
});
const JSZip = require('../lib/jszip.min.js');
const conversationKey = (conversationId: string) => ({ accountId: account.id, conversationId });
function request(conversationId: string, overrides: Partial<ExportRequest> = {}): ExportRequest {
    return { keys: [conversationKey(conversationId)], format: 'markdown',
        delivery: 'browserDownload', includeAssets: true, skipUnchanged: false, ...overrides };
}
function paragraph(text: string) {
    return { type: 'paragraph' as const, children: [{ type: 'text' as const, text }] };
}
async function seed(id: string, options: { doc?: boolean; image?: boolean } = {}) {
    const assets = options.doc ? [{
        id: 'doc', kind: 'file' as const, name: 'doc.md',
        sourceUri: 'https://example.test/doc.md', mediaType: 'text/markdown',
        document: { contentMarkdown: 'embedded doc body' },
    }] : options.image ? [{
        id: 'image', kind: 'image' as const, name: 'image.png',
        sourceUri: 'https://lh3.googleusercontent.com/image.png', mediaType: 'image/png',
    }] : [];
    await ingestDetail(account.id, id, {
        savedAt: 100, quality: { status: 'complete' }, assets,
        messages: [
            { role: 'user', content: [paragraph('hello')] },
            { role: 'assistant', content: [
                paragraph('Answer ' + id),
                ...(options.image ? [{ type: 'image' as const, assetId: 'image' }] : []),
            ], ...(options.doc ? { attachmentIds: ['doc'] } : {}) },
        ],
    }, { title: 'Export ' + id, titleSource: 'provider', updatedAt: 100 });
    await updateSettings({ language: 'en' });
}
function fakeBrowser(t: { after: (fn: () => void) => void }, failClick = false) {
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const previousLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    const previousMouseEvent = Object.getOwnPropertyDescriptor(globalThis, 'MouseEvent');
    Object.defineProperty(globalThis, 'MouseEvent', { configurable: true, value: Event });
    const originalCreate = URL.createObjectURL;
    const blobs: Blob[] = [];
    const filenames: string[] = [];
    let clicks = 0;
    Object.defineProperty(globalThis, 'document', { configurable: true, value: {
        createElement: (tag: string) => {
            assert.equal(tag, 'a');
            return { href: '', download: '', remove() {}, dispatchEvent() {
                clicks++;
                filenames.push(this.download);
                if (failClick) throw new Error('Browser download refused');
                return true;
            } };
        },
        body: { appendChild() {} },
    } });
    Object.defineProperty(globalThis, 'location', {
        configurable: true, value: { hostname: 'example.test', protocol: 'https:' },
    });
    URL.createObjectURL = ((blob: Blob) => {
        blobs.push(blob);
        return originalCreate.call(URL, blob);
    }) as typeof URL.createObjectURL;
    t.after(() => {
        URL.createObjectURL = originalCreate;
        if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
        else Reflect.deleteProperty(globalThis, 'document');
        if (previousLocation) Object.defineProperty(globalThis, 'location', previousLocation);
        else Reflect.deleteProperty(globalThis, 'location');
        if (previousMouseEvent) Object.defineProperty(globalThis, 'MouseEvent', previousMouseEvent);
        else Reflect.deleteProperty(globalThis, 'MouseEvent');
    });
    return { blobs, filenames, clicks: () => clicks };
}
function fakeNetwork(t: { after: (fn: () => void) => void }, bytes: Uint8Array, mediaType: string) {
    const chromeHost = globalThis.chrome;
    const previousFetch = globalThis.fetch;
    const previousTabs = Object.getOwnPropertyDescriptor(chromeHost, 'tabs');
    globalThis.fetch = async () => new Response(new Uint8Array(bytes) as BodyInit, { status: 200,
        headers: { 'content-type': mediaType } });
    Object.defineProperty(chromeHost, 'tabs', { configurable: true, value: {
        query: async () => [{ id: 10, url: 'https://gemini.google.com/app/native' }],
        sendMessage: (_id: number, _message: unknown, reply?: (value: unknown) => void) => {
            const response = { ok: true, accountContext: { accountId: account.id, providerId: 'gemini', slot: 'u0' } };
            reply?.(response); return Promise.resolve(response);
        },
    } });
    t.after(() => { globalThis.fetch = previousFetch;
        if (previousTabs) Object.defineProperty(chromeHost, 'tabs', previousTabs);
        else Reflect.deleteProperty(chromeHost, 'tabs');
    });
}

test('P0: an asset-free v2 export downloads once and writes exactly one committed Record', async t => {
    const host = fakeBrowser(t);
    const id = 'aaaa1111bbbb2222';
    await seed(id);
    const result = await runExport(request(id));
    assert.equal(result.exported, 1);
    assert.equal(result.failed.length, 0);
    assert.equal(result.partial, 0);
    assert.equal(host.clicks(), 1);
    assert.equal(host.blobs.length, 1);
    assert.match(await host.blobs[0].text(), /hello/);
    assert.match(await host.blobs[0].text(), /Answer aaaa1111bbbb2222/);
    const record = await getExportRecord(conversationKey(id));
    assert.ok(record);
    assert.ok(Number.isSafeInteger(record.exportedAt));
    assert.equal(record.format, 'markdown');
    assert.equal(record.status, 'ok');
    assert.equal(record.chatTime, 100);
    const second = await runExport(request(id, { skipUnchanged: true }));
    assert.equal(second.exported, 0);
    assert.equal(second.skipped, 1);
    assert.equal(host.clicks(), 1, 'skip cannot deliver the same unchanged document twice');
});

test('P0: a v2 document attachment is present in ZIP and its ExportRecord lands after delivery', async t => {
    const host = fakeBrowser(t);
    const bytes = new TextEncoder().encode('# embedded doc body');
    fakeNetwork(t, bytes, 'text/markdown');
    const originalZip = __getZipConstructor();
    __setZipConstructor(JSZip);
    t.after(() => __setZipConstructor(originalZip));
    const id = 'cccc3333dddd4444';
    await seed(id, { doc: true });
    const result = await runExport(request(id));
    assert.equal(result.exported, 1);
    assert.equal(result.failed.length, 0);
    assert.equal(result.partial, 0);
    assert.equal(host.clicks(), 1);
    const files = await readDeliveredFiles(host);
    const main = files.find(file=>file.name.endsWith('.md') && !file.name.startsWith('files/'));
    const document = files.find(file=>file.name.startsWith('files/') && file.name.endsWith('doc.md'));
    assert.ok(main && document);
    assert.match(String(await main.async('string')), /Answer cccc3333dddd4444/);
    assert.equal(await document.async('string'), '# embedded doc body');
    assert.equal((await getExportRecord(conversationKey(id)))?.status, 'ok');
});

test('P0: a v2 image attachment is packaged once with its original bytes and a single Record', async t => {
    const host = fakeBrowser(t);
    const png = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3);
    fakeNetwork(t, png, 'image/png');
    const originalZip = __getZipConstructor();
    __setZipConstructor(JSZip);
    t.after(() => __setZipConstructor(originalZip));
    const id = 'eeee5555ffff6666';
    await seed(id, { image: true });
    const result = await runExport(request(id));
    assert.equal(result.exported, 1);
    assert.equal(result.failed.length, 0);
    assert.equal(host.clicks(), 1);
    const files = await readDeliveredFiles(host);
    const images = files.filter(file=>file.name.startsWith('assets/') && file.name.endsWith('.png'));
    assert.equal(images.length,1);
    assert.deepEqual(await images[0].async('uint8array'),png);
    assert.equal((await getExportRecord(conversationKey(id)))?.status, 'ok');
    assert.equal(Object.keys(await listExportRecords(account.id)).length, 1);
});

test('P0: v2 delivery failure must not mark the conversation successfully exported', async t => {
    const host = fakeBrowser(t, true);
    const id = 'delivery_refused';
    await seed(id);
    const result = await runExport(request(id));
    assert.equal(host.clicks(), 1);
    assert.equal(result.exported, 0);
    assert.deepEqual(result.failed, [conversationKey(id)]);
    assert.equal(await getExportRecord(conversationKey(id)), null);
});

test('L3a persists parallel per-conversation records without lost updates', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => 'chat_' + (i + 1));
    await Promise.all(ids.map((id, i) => putExportRecord(conversationKey(id), {
        exportedAt: 1000 + i, format: 'markdown', status: 'ok', chatTime: 100 + i,
    })));
    const stored = await listExportRecords(account.id);
    assert.equal(Object.keys(stored).length, ids.length);
    for (const [i, id] of ids.entries()) assert.equal(stored[id].chatTime, 100 + i);
});

test('L4 rejects traversal paths instead of normalizing unsafe delivery targets', async () => {
    assert.equal(sanitizeRelativePath('a/../b'), 'a/_/b');
    assert.equal(sanitizeRelativePath('files/../../etc/passwd'), 'files/_/_/etc/passwd');
    for (const path of ['a/../b', 'files/../../etc/passwd', 'files/a..b', '/absolute']) {
        assert.throws(() => assertExportPath(path), /Noncanonical export path|Unsafe archive resource path/);
    }
    assert.doesNotThrow(() => assertExportPath('assets/ab1234_image-1.jpg'));
});

test('L4 folder delivery fails closed when a requested subdirectory cannot be created', async () => {
    let rootWrites = 0;
    const directory = {
        queryPermission: async () => 'granted',
        getDirectoryHandle: async () => { throw new Error('Unable to create subdirectory'); },
        getFileHandle: async () => { rootWrites++; throw new Error('Root fallback prohibited'); },
    } as unknown as FileSystemDirectoryHandle;
    await assert.rejects(writeToFolder([
        { fileName: 'files/doc.md', mimeType: 'text/markdown', content: '# content' },
    ], directory), /Unable to create subdirectory/);
    assert.equal(rootWrites, 0, 'a failed subfolder must not quietly write into the root');
});

test('verified v2 Runtime account routing never falls back to a different Gemini tab', async t => {
    const chromeHost = globalThis.chrome;
    const priorTabs = Object.getOwnPropertyDescriptor(chromeHost, 'tabs');
    Object.defineProperty(chromeHost, 'tabs', { configurable: true, value: {
        query: async () => [
            { id: 1, active: true, url: 'https://gemini.google.com/u/0/app/a' },
            { id: 2, active: false, url: 'https://gemini.google.com/u/1/app/b' },
        ],
        sendMessage: (_id: number, _message: unknown, reply: (value: unknown) => void) => {
            reply({ ok: true, accountContext: { accountId: account.id, providerId: 'gemini' } });
        },
    } });
    t.after(() => {
        if (priorTabs) Object.defineProperty(chromeHost, 'tabs', priorTabs);
        else Reflect.deleteProperty(chromeHost, 'tabs');
    });
    const tab = await resolveAccountTab(account.id);
    assert.equal(tab.id, 1);
    await assert.rejects(resolveAccountTab('10000000-0000-4000-8000-000000000002'),
        /No open Provider Tab matches this Account/);
});
});
