import { describe as __suiteDescribe } from 'node:test';
import test from "node:test";
import assert from "node:assert/strict";
import { liveCoordinatorHost } from "./helpers/liveCoordinatorHost.js";
import { executeLiveSave } from "../src/runtime/content/liveSaveCoordinator.js";
import { cleanup } from "../src/runtime/content/liveSaveCoordinator.js";
import { init } from "../src/runtime/content/liveSaveCoordinator.js";
import { indexStorage } from "./helpers/indexStorage.js";
import { fixtureKey } from "./helpers/domainFixture.js";
import { getSettings } from "../src/application/settings/index.js";
import { updateSettings } from "../src/application/settings/index.js";
import { isLiveSaveEffective } from "../src/application/settings/index.js";
import { getStoredSettings } from "../src/l3a/storageService.js";
import { getExportRecord } from "../src/l3a/storageService.js";
import { runLiveSave } from "../src/runtime/background/liveSaveHandler.js";
import { readConversation } from "../src/l2/readConversation.js";
import { FsWriter } from "../src/l4/delivery/writers/fsWriter.js";
import { liveKey } from "./helpers/v2LiveSaveHost.js";
import { seedLiveDetail } from "./helpers/v2LiveSaveHost.js";
import { v2LiveSaveHost } from "./helpers/v2LiveSaveHost.js";
import { getDetail } from "../src/l3a/storageService.js";
import { accountRuntime } from "./helpers/accountRuntime.js";
import { ACCOUNT_UUID } from "./helpers/accountRuntime.js";
import { ACCOUNT_OBSERVATION } from "./helpers/accountRuntime.js";
import { init as init__s4 } from "../src/l1/sniffer/gemini/messageBridge.js";
import { handleWindowMessage } from "../src/l1/sniffer/gemini/messageBridge.js";
import { runCleanups } from "../src/runtime/content/cleanupRegistry.js";
import { extractConversationIdFromUrl } from "../src/l1/protocol/gemini/url.js";
import { resolveCurrentAccount } from "../src/runtime/content/accountContext.js";
import { detailGen as geminiDetailGen } from "./fixtures/providers/geminiDetail.js";
import { getDirectoryHandle } from "../src/l3a/storageService.js";
import * as Directory from "../src/runtime/capabilities/dirHandleController.js";
import { OTHER_ACCOUNT_UUID } from "./helpers/accountRuntime.js";
import { fixtureAccount } from "./helpers/domainFixture.js";
import { sourceDetail } from "./helpers/l1SourceFixture.js";
import { sourceList } from "./helpers/l1SourceFixture.js";
import { GeminiProvider } from "../src/l1/client/gemini/geminiProvider.js";
import { ConfirmedGeminiConversationNotFound } from "../src/l1/client/gemini/geminiClient.js";
import { ingestDetail } from "../src/l2/ingestion.js";
import { getIndex } from "../src/l3a/storageService.js";
import { putExportRecord } from "../src/l3a/storageService.js";
import { init as initBridge } from "../src/l1/sniffer/gemini/messageBridge.js";
import { CrossWorldEvents } from "../src/l1/protocol/gemini/protocol.js";
import { init as initLive } from "../src/runtime/content/liveSaveCoordinator.js";
import { cleanup as cleanupLive } from "../src/runtime/content/liveSaveCoordinator.js";
import { init as initRouter } from "../src/runtime/content/messageRouter.js";
import { AssetFetcher } from "../src/l1/resources/gemini/assetFetcher.js";
import { notifyDomainChanged } from "../src/runtime/api/domainChanges.js";
import { observeDomainChanges } from "../src/runtime/api/domainChanges.js";
import { registerCleanup } from "../src/runtime/content/cleanupRegistry.js";
import { installContentRuntimeHost } from "../src/runtime/content/installContentHost.js";
import { MessageRouter } from "../src/runtime/content/messageRouter.js";
import { init as initMessageBridge } from "../src/l1/sniffer/gemini/messageBridge.js";
import { PageObserver } from "../src/runtime/content/pageObserver.js";

__suiteDescribe("live_save_coordinator", () => {
test('Live Save sends only the accepted ConversationKey to the unified worker and displays its result', async t => {
    const host = await liveCoordinatorHost(t);
    assert.deepEqual(await executeLiveSave(host.key), host.result);
    assert.deepEqual(host.sent, [{ action: 'runLiveSave', key: host.key }]);
    assert.deepEqual(host.feedback, [host.result]);
});
test('disabled Live Save response produces neither success feedback nor a download fallback', async t => {
    const host = await liveCoordinatorHost(t);
    host.reply(async () => ({ ok: true, result: null }));
    assert.equal(await executeLiveSave(host.key), null);
    assert.deepEqual(host.feedback, []);
    assert.deepEqual(host.sent, [{ action: 'runLiveSave', key: host.key }]);
});
for (const error of ['no_dir_handle', 'dir_not_found', 'NotFoundError', 'permission_denied']) {
    test(`Live Save reports ${error} and leaves recovery to the configured folder capability`, async t => {
        const host = await liveCoordinatorHost(t);
        host.reply(async () => ({ ok: false, error }));
        await assert.rejects(executeLiveSave(host.key), new RegExp(error));
        assert.deepEqual(host.errors, [host.key.accountId]);
        assert.deepEqual(host.feedback, []);
        assert.equal(host.sent.length, 1);
    });
}
test('partial Live Save feedback retains the actual result instead of claiming full success', async t => {
    const host = await liveCoordinatorHost(t);
    const partial = { ...host.result, partial: 1 };
    host.reply(async () => ({ ok: true, result: partial }));
    assert.deepEqual(await executeLiveSave(host.key), partial);
    assert.deepEqual(host.feedback, [partial]);
});
test('reinitialization and cleanup suppress feedback from an old pending request', async t => {
    const host = await liveCoordinatorHost(t);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    host.reply(async () => { await gate; return { ok: true, result: host.result }; });
    const pending = executeLiveSave(host.key);
    cleanup(); init({ badge: host.badge }); release();
    await pending;
    assert.deepEqual(host.feedback, []);
    cleanup();
    assert.equal(await executeLiveSave(host.key), null);
    assert.equal(host.sent.length, 1);
});

test('completed reply forwards the refresh requirement to the authenticated worker', async t => {
    const host = await liveCoordinatorHost(t);
    await executeLiveSave(host.key, true);
    assert.deepEqual(host.sent, [{ action: 'runLiveSave', key: host.key, refreshDetail: true }]);
});

test('Live Save rejects malformed IPC results before returning them or notifying Badge', async t => {
    const host = await liveCoordinatorHost(t);
    const invalid = [null, {}, { ok: 1, result: host.result }, { ok: true },
        ...[undefined, false, [], {}, { ...host.result, exported: '1' },
            { ...host.result, skipped: -1 }, { ...host.result, partial: 0.5 },
            { ...host.result, aborted: 0 }, { ...host.result, failed: null },
            { ...host.result, failed: [{ ...host.key, accountId: 'foreign' }] },
            { ...host.result, failed: [{ ...host.key, conversationId: ' padded ' }] },
            { ...host.result, expiredConversations: null }, { ...host.result, otherPartial: -1 },
            ...[null, '1700000000000', false, 0, -1, NaN, Infinity, -Infinity]
                .map(rateLimitedUntil => ({ ...host.result, rateLimitedUntil })),
            { ...host.result, attachmentIssues: {} }, { ...host.result, attachmentIssues: [null] },
            ...[{ resourceId: 1, name: 'file', code: 'FAILED' },
                { resourceId: 'r', name: 'file', code: 1 },
                { resourceId: 'r', name: 'file', code: 'FAILED', sourceUrl: false },
                { resourceId: 'r', name: 'file', code: 'FAILED', httpStatus: '404' }]
                .map(issue => ({ ...host.result, attachmentIssues: [issue] }))]
            .map(result => ({ ok: true, result }))];
    for (const reply of invalid) {
        host.reply(async () => reply);
        await assert.rejects(executeLiveSave(host.key), /Live Save|conversation key/);
        assert.deepEqual(host.feedback, []);
    }
    assert.equal(host.errors.length, invalid.length);
});

test('Live Save decodes complete failure and attachment details without changing their values', async t => {
    const host = await liveCoordinatorHost(t);
    const result = { ...host.result, failed: [host.key], partial: 1, expiredConversations: 1, otherPartial: 0, rateLimitedUntil: 1700000000000,
        attachmentIssues: [{ resourceId: 'r', name: 'file', code: 'RESOURCE_SOURCE_EXPIRED',
            sourceUrl: 'https://example.test/file', httpStatus: 404 }] };
    host.reply(async () => ({ ok: true, result }));
    assert.deepEqual(await executeLiveSave(host.key), result);
    assert.deepEqual(host.feedback, [result]);
    assert.deepEqual(host.errors, []);
});

test('Live Save omits an undefined optional cooldown timestamp', async t => {
    const host = await liveCoordinatorHost(t);
    host.reply(async () => ({ ok: true, result: { ...host.result, rateLimitedUntil: undefined } }));
    assert.deepEqual(await executeLiveSave(host.key), host.result);
    assert.deepEqual(host.feedback, [host.result]);
});

test('Live Save preserves finite positive cooldown timestamps including fractional values', async t => {
    const host = await liveCoordinatorHost(t);
    for (const rateLimitedUntil of [1700003600000.5, Number.MAX_SAFE_INTEGER + 1]) {
        const result = { ...host.result, aborted: true, rateLimitedUntil };
        host.reply(async () => ({ ok: true, result }));
        assert.deepEqual(await executeLiveSave(host.key), result);
        assert.deepEqual(host.feedback.at(-1), result);
    }
    assert.deepEqual(host.errors, []);
});
});

__suiteDescribe("live_storage_manager_other_layers", () => {
// Cross-module behavior: real Application settings, L3a persistence, and Runtime Live Save.
// Only the browser and IndexedDB host surfaces are provided by indexStorage.








test('non-Markdown formats pause Live Save without discarding its v2 setting', async () => {
    const env = indexStorage();
    const key = fixtureKey('live-v2');
    try {
        await updateSettings({ enabledDisk: true, defaultFormat: 'markdown' });
        assert.equal(isLiveSaveEffective(await getSettings(), true), true);
        for (const format of ['pdf', 'html', 'json'] as const) {
            await updateSettings({ defaultFormat: format });
            const settings = await getSettings();
            assert.equal(settings.enabledDisk, true, 'format changes preserve the user intent');
            assert.equal(isLiveSaveEffective(settings, true), false);
            assert.equal(await runLiveSave(key), null, 'Runtime must not export a non-Markdown live save');
            assert.equal(await getExportRecord(key), null, 'no delivery or export record was created');
        }
        await updateSettings({ defaultFormat: 'markdown' });
        await updateSettings({ exportDelivery: 'browserDownload' });
        const paused = await getSettings();
        assert.equal(paused.enabledDisk, true, 'destination changes preserve the enabled preference');
        assert.equal(isLiveSaveEffective(paused, true), false);
        assert.equal(await runLiveSave(key), null, 'Runtime must not write files in browser-download mode');
        assert.equal(await getExportRecord(key), null);
        await updateSettings({ exportDelivery: 'folderWriter' });
        assert.equal(isLiveSaveEffective(await getSettings(), false), false);
        await assert.rejects(runLiveSave(key), /Choose a Live Save directory/, 'a Markdown live save still requires a writable folder');
        assert.equal((await getStoredSettings()).enabledDisk, true);
        await updateSettings({ enabledDisk: false });
        assert.equal(await runLiveSave(key), null);
    } finally {
        env.restore();
    }
});
});

__suiteDescribe("live_save_assets", () => {
/**
 * V2 native Live Save media coverage: L2 asset IDs -> L3b AST -> Application
 * acquisition -> L4 relative paths/FsWriter -> one committed ExportRecord.
 * Legacy coordinator injection, DOM reparse and mock AssetPipeline are retired.
 */








const paragraph = (text: string) => ({ type: 'paragraph' as const, children: [{ type: 'text' as const, text }] });
const entries = (files: Map<string, string | Uint8Array>) => [...files.entries()];
function mainMarkdown(files: Map<string, string | Uint8Array>): string {
    const item = entries(files).find(([name]) => name.endsWith('.md') && !name.startsWith('files/'));
    assert.ok(item);
    assert.equal(typeof item[1], 'string');
    return item[1] as string;
}

test('v2 Live Save preserves user-upload and generated Imagen bytes as distinct resources with Markdown relative links', async t => {
    const host = v2LiveSaveHost(t);
    const id = '1122334455667788';
    const userUrl = 'https://lh3.googleusercontent.com/user-photo-123';
    const modelUrl = 'https://lh3.googleusercontent.com/generated-photo-456';
    const upload = Uint8Array.of(1, 2, 3, 4, 5);
    const generated = Uint8Array.of(6, 7, 8, 9, 10, 11);
    const assets = [
        { id: 'uploaded', kind: 'image' as const, name: 'cute-cat.jpg', sourceUri: userUrl, mediaType: 'image/jpeg' },
        { id: 'imagen', kind: 'image' as const, name: 'cyberpunk-cat.png', sourceUri: modelUrl,
            mediaType: 'image/png', generation: { prompt: 'Make this cat cyberpunk', imageOrdinal: 0, imageCount: 1 } },
    ];
    await seedLiveDetail(id, assets, { title: 'Multimodal Cat & Cyberpunk Art', messages: [
        { role: 'user', content: [paragraph('Enhance this cat photo'),
            { type: 'image', assetId: 'uploaded', alt: 'Cat upload' }] },
        { role: 'assistant', content: [paragraph('Here is the generated cat'),
            { type: 'image', assetId: 'imagen', alt: 'Generated cyberpunk cat' }] },
    ] });
    const before = await readConversation(liveKey(id));
    host.source(userUrl, upload, 'image/jpeg');
    host.source(modelUrl, generated, 'image/png');

    const result = await runLiveSave(liveKey(id));
    assert.equal(result?.exported, 1);
    assert.equal(result?.partial, 0);
    assert.deepEqual(result?.failed, []);
    assert.deepEqual(host.requests, [userUrl, modelUrl]);
    const imageFiles = entries(host.files).filter(([name]) => name.startsWith('assets/'));
    assert.equal(imageFiles.length, 2);
    const savedUser = imageFiles.find(([name]) => name.endsWith('cute-cat.jpg'));
    const savedModel = imageFiles.find(([name]) => name.endsWith('cyberpunk-cat.png'));
    assert.ok(savedUser && savedModel);
    assert.deepEqual(savedUser[1], upload);
    assert.deepEqual(savedModel[1], generated);
    assert.notEqual(savedUser[0], savedModel[0]);
    const markdown = mainMarkdown(host.files);
    assert.ok(markdown.includes(savedUser[0]));
    assert.ok(markdown.includes(savedModel[0]));
    assert.doesNotMatch(markdown, /https:\/\/lh3\.googleusercontent\.com/);
    assert.match(markdown, /Enhance this cat photo/);
    assert.match(markdown, /Here is the generated cat/);
    assert.equal((await getExportRecord(liveKey(id)))?.status, 'ok');
    assert.deepEqual(await readConversation(liveKey(id)), before, 'task resource binding cannot mutate persisted Domain facts');
});

test('v2 Live Save renders failed image visibly as unavailable without a dangling sidecar or remote image embedding', async t => {
    const host = v2LiveSaveHost(t), id = 'failing-images';
    const good = 'https://lh3.googleusercontent.com/good.png', bad = 'https://lh3.googleusercontent.com/broken.png';
    await seedLiveDetail(id, [
        { id: 'good', kind: 'image', name: 'good.png', sourceUri: good, mediaType: 'image/png' },
        { id: 'broken', kind: 'image', name: 'broken.png', sourceUri: bad, mediaType: 'image/png' },
    ]);
    const bytes = Uint8Array.of(91, 92, 93);
    host.source(good, bytes);
    host.source(bad, null);
    const result = await runLiveSave(liveKey(id));
    assert.equal(result?.exported, 1);
    assert.equal(result?.partial, 1);
    assert.equal((await getExportRecord(liveKey(id)))?.status, 'partial');
    assert.deepEqual(host.requests, [good, bad]);
    const imageFiles = entries(host.files).filter(([name]) => name.startsWith('assets/'));
    assert.equal(imageFiles.length, 1);
    assert.deepEqual(imageFiles[0][1], bytes);
    const markdown = mainMarkdown(host.files);
    assert.ok(markdown.includes(imageFiles[0][0]));
    assert.match(markdown, /\[Open source\]\(https:\/\/lh3\.googleusercontent\.com\/broken\.png\)/);
    assert.doesNotMatch(markdown, /!\[[^\]]*\]\(https:/);
    assert.doesNotMatch(markdown, /\]\(assets\/[^)]*broken\.png\)/,
        'failed media may have a visible placeholder but never a missing relative file link');
    assert.match(markdown, /broken\.png|Image unavailable/i);
});

test('L3b reference dedup means one source fetch and sidecar despite multiple image occurrences', async t => {
    const host = v2LiveSaveHost(t), id = 'repeated-image', url = 'https://lh3.googleusercontent.com/same.png';
    await seedLiveDetail(id, [{ id: 'same', kind: 'image', name: 'same.png', sourceUri: url, mediaType: 'image/png' }], {
        messages: [
            { role: 'user', content: [paragraph('Please explain this diagram')] },
            { role: 'assistant', content: [paragraph('Repeated illustration'),
                { type: 'image', assetId: 'same' }, { type: 'image', assetId: 'same' }] },
        ],
    });
    host.source(url, Uint8Array.of(1, 3, 3, 7));
    const result = await runLiveSave(liveKey(id));
    assert.equal(result?.partial, 0);
    assert.equal(result?.exported, 1);
    assert.deepEqual(host.requests, [url]);
    const [asset] = entries(host.files).filter(([name]) => name.startsWith('assets/'));
    assert.ok(asset);
    assert.equal(entries(host.files).filter(([name]) => name.startsWith('assets/')).length, 1);
    assert.equal(mainMarkdown(host.files).split(asset[0]).length - 1, 2);
});

test('L4 FsWriter serializes concurrent writes targeting the same physical path', async () => {
    const order: string[] = [];
    let unblock!: () => void, started!: () => void;
    const waiting = new Promise<void>(resolve => { unblock = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    let current = '', createCount = 0;
    const directory = {
        async queryPermission() { return 'granted'; },
        async getFileHandle(name: string) {
            assert.equal(name, 'same-file.md');
            const ordinal = ++createCount;
            return { async createWritable() { return {
                async write(content: string) {
                    order.push('start:' + content);
                    if (ordinal === 1) { started(); await waiting; }
                    current = content;
                    order.push('end:' + content);
                },
                async close() { order.push('close:' + ordinal); },
            }; } };
        },
    } as unknown as FileSystemDirectoryHandle;
    const writer = new FsWriter(directory);
    await writer.init();
    const first = writer.writeFile('same-file.md', 'first');
    await entered;
    const second = writer.writeFile('same-file.md', 'second');
    unblock();
    assert.deepEqual(await Promise.all([first, second]), ['same-file.md', 'same-file.md']);
    assert.deepEqual(order, ['start:first', 'end:first', 'close:1', 'start:second', 'end:second', 'close:2']);
    assert.equal(current, 'second');
});
});

__suiteDescribe("live_save_coordinator_safety", () => {
// v2 has no content-side RPC/DOM resolver, mock-success mode, image writer or
// second queue. Real Domain -> unified Export -> Folder Writer owns these cases.
test('Live Save exports committed authoritative Domain without a content scraper or active refresh', async t => {
    const host = v2LiveSaveHost(t);
    await seedLiveDetail('authority', [], { title: 'RPC Authority Title' });
    const before = await getDetail(liveKey('authority'));
    const result = await runLiveSave(liveKey('authority'));
    assert.equal(result?.exported, 1);
    assert.deepEqual(await getDetail(liveKey('authority')), before);
    assert.deepEqual(host.requests, []);
    assert.ok([...host.files.values()].some(text => typeof text === 'string' && text.includes('RPC Authority Title')));
});
for (const permission of ['denied', 'prompt'] as const) {
    test(`Live Save never prompts or downloads when folder permission is ${permission}`, async t => {
        const host = v2LiveSaveHost(t);
        await seedLiveDetail('permission'); host.permission(permission);
        await assert.rejects(runLiveSave(liveKey('permission')), /Reauthorize/);
        assert.equal(host.requestCount(), 0);
        assert.equal(host.files.size, 0);
        assert.equal((await getSettings()).enabledDisk, true, 'preserve user enablement intent');
        assert.equal(await getExportRecord(liveKey('permission')), null);
    });
}
test('missing directory does not start acquisition or publish success', async t => {
    const host = v2LiveSaveHost(t);
    await seedLiveDetail('no-directory'); host.directory(null);
    await assert.rejects(runLiveSave(liveKey('no-directory')), /Choose a Live Save directory/);
    assert.equal(host.files.size, 0); assert.deepEqual(host.requests, []);
    assert.equal((await getSettings()).enabledDisk, true);
});
test('non-Markdown settings disable Live Save without resetting the user preference', async t => {
    const host = v2LiveSaveHost(t);
    await seedLiveDetail('format'); await updateSettings({ defaultFormat: 'pdf' });
    assert.equal(await runLiveSave(liveKey('format')), null);
    assert.equal(host.files.size, 0);
    assert.equal((await getSettings()).enabledDisk, true);
});
test('missing source bytes produce visible placeholders, a partial record and unchanged source facts', async t => {
    const host = v2LiveSaveHost(t), key = liveKey('missing');
    await seedLiveDetail(key.conversationId, [{ id: 'image', kind: 'image', sourceUri: 'https://lh3.googleusercontent.com/missing.png' }]);
    const before = await getDetail(key);
    const result = await runLiveSave(key);
    assert.equal(result?.exported, 1); assert.equal(result?.partial, 1);
    assert.equal((await getExportRecord(key))?.status, 'partial');
    assert.equal([...host.files.keys()].some(path => path.startsWith('assets/')), false);
    assert.ok([...host.files.values()].some(text => typeof text === 'string' && text.includes('Attachment failed: Unknown error')));
    assert.deepEqual(await getDetail(key), before);
});
test('same authored asset names receive distinct physical paths with exact binary views', async t => {
    const host = v2LiveSaveHost(t), key = liveKey('collision');
    const raw = Uint8Array.of(99, 1, 2, 3, 88);
    const bytes = [raw.subarray(1, 4), Uint8Array.of(4, 5, 6)];
    const assets = bytes.map((_, index) => ({ id: 'image-' + index, kind: 'image' as const, name: 'same.png', sourceUri: 'https://lh3.googleusercontent.com/' + index }));
    await seedLiveDetail(key.conversationId, assets);
    assets.forEach((asset, index) => host.source(asset.sourceUri, bytes[index]));
    const before = await getDetail(key);
    assert.equal((await runLiveSave(key))?.exported, 1);
    const files = [...host.files.entries()].filter(([path]) => path.startsWith('assets/'));
    assert.equal(files.length, 2); assert.notEqual(files[0][0], files[1][0]);
    for (const value of bytes) assert.ok(files.some(([, data]) => data instanceof Uint8Array && Buffer.from(data).equals(Buffer.from(value))));
    const md = [...host.files.values()].find(value => typeof value === 'string') as string;
    files.forEach(([path]) => assert.ok(md.includes(path)));
    assert.deepEqual(await getDetail(key), before);
});
test('a multi-image turn completes every image once without retaining resource bytes in Domain', async t => {
    const host = v2LiveSaveHost(t);
    const assets = Array.from({ length: 9 }, (_, index) => ({ id: 'image-' + index, kind: 'image' as const, name: index + '.png', sourceUri: 'https://lh3.googleusercontent.com/' + index }));
    await seedLiveDetail('many', assets);
    assets.forEach((asset, index) => host.source(asset.sourceUri, Uint8Array.of(index + 1)));
    const result = await runLiveSave(liveKey('many'));
    assert.equal(result?.exported, 1); assert.equal(result?.partial, 0);
    assert.equal(host.requests.length, 9);
    assert.equal([...host.files.keys()].filter(path => path.startsWith('assets/')).length, 9);
    assert.ok(!JSON.stringify(await getDetail(liveKey('many'))).includes('dataBase64'));
});
test('write failure does not poison the next Live Save task and only the delivered task gets a record', async t => {
    const host = v2LiveSaveHost(t);
    await seedLiveDetail('first'); await seedLiveDetail('second');
    host.failWrite('.md');
    assert.equal((await runLiveSave(liveKey('first')))?.exported, 0);
    host.failWrite(null);
    assert.equal((await runLiveSave(liveKey('second')))?.exported, 1);
    assert.equal(await getExportRecord(liveKey('first')), null);
    assert.equal((await getExportRecord(liveKey('second')))?.status, 'ok');
});
});

__suiteDescribe("live_save_observer", () => {
// The old DOM/debounce LiveSaveObserver is retired. Actual passive admissions
// commit Detail; stream completion requests Application acquisition without inventing DOM Detail.
async function host(t: import('node:test').TestContext) {
    const storage = indexStorage(), runtime = accountRuntime();
    await resolveCurrentAccount(ACCOUNT_OBSERVATION, 'u0');
    const changed: string[] = [], completed: string[] = [];
    init__s4({ onDetailChanged: key => changed.push(key.conversationId), onStreamComplete: key => completed.push(key.conversationId) });
    t.after(() => { runCleanups(); runtime.restore(); storage.restore(); });
    const event = (type: string, extra: Record<string, unknown> = {}) => ({ source: window, origin: location.origin,
        data: { type, payload: { id: 'passive123', slot: 'u0', requestAccountObservation: ACCOUNT_OBSERVATION, ...extra } } }) as unknown as MessageEvent;
    return { changed, completed, event };
}
test('active conversation extraction supports account routes and excludes reserved pages', () => {
    assert.equal(extractConversationIdFromUrl('/app/82a15f0bc2e'), '82a15f0bc2e');
    assert.equal(extractConversationIdFromUrl('/u/1/app/999abcdef'), '999abcdef');
    assert.equal(extractConversationIdFromUrl('/app'), null);
    assert.equal(extractConversationIdFromUrl('/app/trash'), null);
});
test('stream lifecycle notifications do not save unfinished or uncommitted DOM content', async t => {
    const h = await host(t);
    await handleWindowMessage(h.event('GEMINI_STREAM_GENERATE_START'));
    await handleWindowMessage(h.event('GEMINI_STREAM_GENERATE_COMPLETE'));
    assert.deepEqual(h.changed, []);
    assert.deepEqual(h.completed, ['passive123']);
    assert.equal(await getDetail({ accountId: ACCOUNT_UUID, conversationId: 'passive123' }), null);
});
test('a real completed passive Detail triggers after storage commit and duplicate captures do not retrigger', async t => {
    const h = await host(t);
    const text = geminiDetailGen('G_LIVE_SAVE_OBSERVER_01');
    const event = h.event('GEMINI_NETWORK_BATCHEXECUTE', { text, requestedAt: 1700000000000, truncated: false,
        url: 'https://gemini.google.com/_/BardChatUi/data/batchexecute', detailRequest: { conversationId: 'passive123', requestCursor: null } });
    await handleWindowMessage(event);
    assert.equal((await getDetail({ accountId: ACCOUNT_UUID, conversationId: 'passive123' }))?.quality.status, 'complete');
    assert.deepEqual(h.changed, ['passive123']);
    await handleWindowMessage(event);
    assert.deepEqual(h.changed, ['passive123']);
});
test('foreign origin and foreign window notifications cannot trigger completion', async t => {
    const h = await host(t);
    await handleWindowMessage({ ...h.event('GEMINI_STREAM_GENERATE_COMPLETE'), origin: 'https://evil.test' } as MessageEvent);
    await handleWindowMessage({ ...h.event('GEMINI_STREAM_GENERATE_COMPLETE'), source: {} } as MessageEvent);
    assert.deepEqual(h.completed, []); assert.deepEqual(h.changed, []);
});
test('cleanup removes passive dispatch and reinitialization installs one current listener', async t => {
    const h = await host(t);
    runCleanups();
    await handleWindowMessage(h.event('GEMINI_STREAM_GENERATE_COMPLETE'));
    assert.deepEqual(h.completed, []);
    init__s4({ onStreamComplete: key => h.completed.push(key.conversationId) });
    await handleWindowMessage(h.event('GEMINI_STREAM_GENERATE_COMPLETE'));
    assert.deepEqual(h.completed, ['passive123']);
});
});

__suiteDescribe("live_save_permission_deadlock", () => {
/**
 * V2 Folder authority crosses real L3a handle persistence, Runtime capability
 * controller and Background Live Save. Only native structured-cloneable
 * FileSystemDirectoryHandle and the extension host are faked.
 */









test('degraded Background Live Save never requests disk permission or writes even when user enabled it', async t => {
    const host = v2LiveSaveHost(t), id = 'degraded-directory';
    Directory.setDirHandle(null);
    t.after(() => Directory.setDirHandle(null));
    await seedLiveDetail(id);
    host.permission('prompt');

    await assert.rejects(runLiveSave(liveKey(id)), /Reauthorize.*Options/);
    assert.equal(host.queryCount(), 1);
    assert.equal(host.requestCount(), 0, 'the worker cannot request user activation');
    assert.equal(host.files.size, 0);
    assert.equal(await getExportRecord(liveKey(id)), null);
    assert.equal((await getSettings()).enabledDisk, true);
});

test('explicit v2 Directory Controller reauthorization retains a pending handle and restores real Live Save', async t => {
    const host = v2LiveSaveHost(t), id = 'reauthorized';
    Directory.setDirHandle(null);
    t.after(() => Directory.setDirHandle(null));
    await seedLiveDetail(id);
    host.permission('prompt');

    assert.equal(await Directory.restoreSavedDirHandle(), null);
    assert.equal(Directory.getPendingPermissionHandle(), host.root);
    assert.equal(Directory.getDirHandle(), null);
    assert.equal(host.requestCount(), 0);
    assert.equal(await Directory.reauthorizeDirHandle(), true);
    assert.equal(host.requestCount(), 1);
    assert.equal(Directory.getPendingPermissionHandle(), null);
    assert.equal(Directory.getDirHandle(), host.root);
    assert.equal(await getDirectoryHandle(), host.root, 'L3a persists the selected capability');

    const result = await runLiveSave(liveKey(id));
    assert.equal(result?.exported, 1);
    assert.equal(result?.partial, 0);
    assert.equal((await getExportRecord(liveKey(id)))?.status, 'ok');
    assert.equal([...host.files.keys()].filter(name => name.endsWith('.md')).length, 1);
    assert.match(String([...host.files.values()][0]), /Answer for reauthorized/);
    assert.equal((await getSettings()).enabledDisk, true);
});

test('disabled Live Save intention remains disabled after restoring a previously granted directory', async t => {
    const host = v2LiveSaveHost(t), id = 'disabled-with-handle';
    Directory.setDirHandle(null);
    t.after(() => Directory.setDirHandle(null));
    await seedLiveDetail(id);
    await updateSettings({ enabledDisk: false });
    assert.equal(await Directory.restoreSavedDirHandle(), host.root);
    assert.equal(Directory.getPendingPermissionHandle(), null);
    assert.equal(await runLiveSave(liveKey(id)), null);
    assert.equal(host.files.size, 0);
    assert.equal(host.requestCount(), 0);
    assert.equal(await getExportRecord(liveKey(id)), null);
});
});

__suiteDescribe("messageRouter_liveSave_detail_contract", () => {
// The v1 getConversationDetail router, DOM fallback and Live Save detail resolver
// are gone. Detail belongs to L1 -> L2; only committed passive changes request
// the unified Export through Content -> Background IPC.
const account = fixtureAccount();
const sourceClient = (getDetailFromSource: () => ReturnType<typeof sourceDetail> | Promise<ReturnType<typeof sourceDetail>>) => ({
    getConversationList: async () => sourceList('G_SOURCE_EMPTY_01'),
    getConversationDetail: async () => getDetailFromSource(),
});
const route = async () => 'u0';
const paragraph = (text: string) => ({ type: 'paragraph' as const, children: [{ type: 'text' as const, text }] });

test('v2 detail: L1 commits title, model, reasoning, citations and asset references to L2 without transport evidence', async () => {
    const environment = indexStorage();
    try {
        const parsed = sourceDetail({ id: 'detail123', title: 'Research', updatedAt: 1700000000000 });
        parsed.conversation.detail.quality = { status: 'complete' };
        parsed.conversation.detail.assets = [
            { id: 'generated-image', kind: 'image', name: 'generated.png', sourceUri: 'https://lh3.googleusercontent.com/image' },
        ];
        parsed.conversation.detail.messages = [{
            id: 'answer', role: 'assistant', model: 'Model', timestamp: 1700000000000,
            content: [
                { type: 'paragraph', children: [{ type: 'text', text: 'Research answer' }, { type: 'citationRef', citationId: 'cite' }] },
                { type: 'image', assetId: 'generated-image' },
            ],
            reasoning: [paragraph('thought')],
            citations: [{ id: 'cite', title: 'Citation', url: 'https://example.com/source' }],
            attachmentIds: ['generated-image'],
        }];
        parsed.transport.decodedPayload = { wire: ['raw-only-evidence'] };
        const expected = structuredClone(parsed.conversation.detail);
        const provider = new GeminiProvider({
            getConversationList: async () => sourceList('G_SOURCE_EMPTY_01'),
            getConversationDetail: async (id, slot, owner) => {
                assert.equal(id, 'detail123');
                assert.equal(slot, 'u0');
                assert.equal(owner?.id, account.id);
                return parsed;
            },
        }, route);

        assert.equal(await provider.fetchConversationDetail(account.id, 'detail123'), undefined);
        const key = { accountId: account.id, conversationId: 'detail123' };
        const committed = await getDetail(key);
        assert.ok(committed);
        assert.deepEqual(committed.messages, expected.messages);
        assert.deepEqual(committed.assets, expected.assets);
        assert.deepEqual(committed.quality, expected.quality);
        assert.equal(committed.savedAt, 1700000000000);
        assert.equal((await getIndex(key))?.title, 'Research');
        assert.equal((await getIndex(key))?.titleSource, 'provider');
        assert.equal((await getIndex(key))?.updatedAt, 1700000000000);
        assert.equal(Object.hasOwn(committed, 'transport'), false, 'raw RPC/debug payload is not trusted Domain');
        assert.equal(JSON.stringify(committed).includes('raw-only-evidence'), false);
    } finally {
        environment.restore();
    }
});

test('v2 detail: unknown source times remain absent instead of inventing chatTime or savedAt', async () => {
    const environment = indexStorage();
    try {
        const parsed = sourceDetail({ id: 'no_time', updatedAt: null });
        const provider = new GeminiProvider(sourceClient(() => parsed), route);
        await provider.fetchConversationDetail(account.id, 'no_time');
        const key = { accountId: account.id, conversationId: 'no_time' };
        const stored = await getDetail(key);
        const index = await getIndex(key);
        assert.ok(stored && index);
        assert.equal(Object.hasOwn(stored, 'savedAt'), false);
        assert.equal(Object.hasOwn(stored, 'chatTime'), false);
        assert.equal(Object.hasOwn(index, 'updatedAt'), false);
        assert.equal(Object.hasOwn(index, 'createdAt'), false);
    } finally {
        environment.restore();
    }
});

test('v2 detail: transient/ambiguous failures leave local data intact; confirmed Not Found deletes only the matching key', async () => {
    const environment = indexStorage();
    try {
        const id = 'deadbeef00112233';
        const key = { accountId: account.id, conversationId: id };
        const otherKey = { accountId: OTHER_ACCOUNT_UUID, conversationId: id };
        const body = { quality: { status: 'complete' as const }, assets: [], messages: [
            { role: 'assistant' as const, content: [paragraph('Previously saved answer')] },
        ] };
        await ingestDetail(key.accountId, id, body, { title: 'Previously saved', titleSource: 'provider' });
        await ingestDetail(otherKey.accountId, id, body, { title: 'Other account', titleSource: 'provider' });
        await putExportRecord(key, { exportedAt: 1700000000000, format: 'markdown', status: 'ok' });
        const oldDetail = await getDetail(key);
        const oldRecord = await getExportRecord(key);

        let failure: Error = new Error('temporary failure');
        const provider = new GeminiProvider({
            getConversationList: async () => sourceList('G_SOURCE_EMPTY_01'),
            getConversationDetail: async () => { throw failure; },
        }, route);
        for (const error of [new Error('temporary failure'), new Error('HTTP 404'),
            new ConfirmedGeminiConversationNotFound('c_different_conversation')]) {
            failure = error;
            await assert.rejects(provider.fetchConversationDetail(account.id, id));
            assert.deepEqual(await getDetail(key), oldDetail);
            assert.deepEqual(await getExportRecord(key), oldRecord);
        }

        failure = new ConfirmedGeminiConversationNotFound('c_' + id);
        await assert.rejects(provider.fetchConversationDetail(account.id, id), /conversation_not_found/);
        assert.equal(await getDetail(key), null);
        assert.equal(await getIndex(key), null);
        assert.equal(await getExportRecord(key), null);
        assert.ok(await getDetail(otherKey), 'another Account must not be deleted');
    } finally {
        environment.restore();
    }
});

test('v2 Live Save: only a committed, changed passive Detail requests a single keyed export', async () => {
    const environment = indexStorage();
    const runtime = accountRuntime();
    const forward = chrome.runtime.sendMessage.bind(chrome.runtime);
    const sent: unknown[] = [];
    const feedback: string[] = [];
    const jobs: Array<Promise<unknown>> = [];
    try {
        await resolveCurrentAccount(ACCOUNT_OBSERVATION, 'u0');
        chrome.runtime.sendMessage = (async (message: { action: string; key?: unknown }) => {
            if (message.action === 'runLiveSave') {
                sent.push(message);
                return { ok: true, result: { exported: 1, skipped: 0, partial: 0, failed: [], aborted: false } };
            }
            return forward(message);
        }) as typeof chrome.runtime.sendMessage;
        initLive({ badge: { showLiveSaveResult: (_result, accountId) => { feedback.push(accountId); } } });
        initBridge({ onDetailChanged: key => { jobs.push(executeLiveSave(key)); } });

        const id = 'source_sniff_123';
        const key = { accountId: ACCOUNT_UUID, conversationId: id };
        const wire = geminiDetailGen('G_MESSAGE_ROUTER_LIVE_SAVE_01');
        const captured = (extra: Record<string, unknown> = {}): MessageEvent => ({
            source: window, origin: location.origin, data: {
                type: CrossWorldEvents.NETWORK_BATCHEXECUTE,
                payload: {
                    text: wire, slot: 'u0', requestedAt: 1700000000000, truncated: false,
                    url: 'https://gemini.google.com/_/BardChatUi/data/batchexecute',
                    requestAccountObservation: ACCOUNT_OBSERVATION,
                    detailRequest: { conversationId: id, requestCursor: null }, ...extra,
                },
            },
        }) as unknown as MessageEvent;
        const admit = async (extra: Record<string, unknown> = {}) => {
            await handleWindowMessage(captured(extra));
            await Promise.all(jobs.splice(0));
        };

        await admit();
        const initial = await getDetail(key);
        assert.ok(initial);
        assert.equal(initial.quality.status, 'complete');
        assert.deepEqual(sent, [{ action: 'runLiveSave', key }]);
        assert.deepEqual(feedback, [ACCOUNT_UUID]);

        await admit(); // A duplicate candidate is accepted but not changed.
        await admit({ truncated: true }); // A partial candidate cannot replace complete Detail.
        assert.deepEqual(await getDetail(key), initial);
        assert.equal(sent.length, 1, 'no second Export for unchanged or rejected Detail');
    } finally {
        runCleanups();
        cleanupLive();
        runtime.restore();
        environment.restore();
    }
});

test('v2 Live Save: a changed Account prevents dispatch and suppresses late badge feedback', async () => {
    const runtime = accountRuntime();
    const forward = chrome.runtime.sendMessage.bind(chrome.runtime);
    const key = { accountId: ACCOUNT_UUID, conversationId: 'detail123' };
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const feedback: string[] = [];
    let dispatched = 0;
    try {
        await resolveCurrentAccount(ACCOUNT_OBSERVATION, 'u0');
        chrome.runtime.sendMessage = (async (message: { action: string }) => {
            if (message.action === 'runLiveSave') {
                dispatched++;
                await pending;
                return { ok: true, result: { exported: 1, skipped: 0, partial: 0, failed: [], aborted: false } };
            }
            return forward(message);
        }) as typeof chrome.runtime.sendMessage;
        initLive({ badge: { showLiveSaveResult: (_result, id) => { feedback.push(id); } } });
        const inFlight = executeLiveSave(key);
        assert.equal(dispatched, 1);
        runtime.state.observation = { providerId: 'gemini', providerAccountId: 'other-gaia' };
        await resolveCurrentAccount(runtime.state.observation, 'u0');
        release();
        await inFlight;
        assert.deepEqual(feedback, []);
        assert.equal(await executeLiveSave(key), null);
        assert.equal(dispatched, 1);
    } finally {
        release();
        cleanupLive();
        runtime.restore();
    }
});

test('v2 messageRouter: resource IPC rejects foreign Accounts/hosts and never leaks bytes across an Account switch', async () => {
    const runtime = accountRuntime();
    const originalFetch = AssetFetcher.handleGetFileBlob;
    type Listener = Parameters<typeof chrome.runtime.onMessage.addListener>[0];
    let listener: Listener | undefined;
    let downloads = 0;
    try {
        await resolveCurrentAccount(ACCOUNT_OBSERVATION, 'u0');
        Object.assign(chrome.runtime, {
            id: 'own-extension',
            onMessage: {
                addListener(fn: Listener) { listener = fn; },
                removeListener() {},
            },
        });
        AssetFetcher.handleGetFileBlob = async (_message, reply) => {
            downloads++;
            runtime.state.observation = { providerId: 'gemini', providerAccountId: 'other-gaia' };
            reply({ success: true, dataBase64: 'AQID', size: 3 });
        };
        initRouter();
        assert.ok(listener);
        const request = (message: unknown) => new Promise<Record<string, unknown>>(resolve => {
            const handled = listener!(message, { id: 'own-extension' } as chrome.runtime.MessageSender,
                response => resolve(response as Record<string, unknown>));
            assert.equal(handled, true);
        });
        const url = 'https://lh3.googleusercontent.com/asset';
        assert.equal((await request({ action: 'getFileBlob', accountId: OTHER_ACCOUNT_UUID, url })).success, false);
        assert.equal((await request({ action: 'getFileBlob', accountId: ACCOUNT_UUID, url: 'https://evil.example/a' })).success, false);
        assert.equal(downloads, 0);
        const switched = await request({ action: 'getFileBlob', accountId: ACCOUNT_UUID, url });
        assert.equal(switched.success, false);
        assert.match(String(switched.error), /Account changed/);
        assert.equal(Object.hasOwn(switched, 'dataBase64'), false);
        assert.equal(downloads, 1);
    } finally {
        runCleanups();
        AssetFetcher.handleGetFileBlob = originalFetch;
        runtime.restore();
    }
});
});

__suiteDescribe("domain_change_notifications", () => {
test('committed change notifications never wait for slow or failing UI observers', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const seen: string[] = [];
    const stopSlow = observeDomainChanges(async id => { seen.push(`started:${id}`); await gate; seen.push(`finished:${id}`); });
    const stopThrowing = observeDomainChanges(() => { throw new Error('view closed'); });
    const stopRejecting = observeDomainChanges(async () => { throw new Error('view read failed'); });
    const stopHealthy = observeDomainChanges(id => { seen.push(`healthy:${id}`); });
    try {
        assert.equal(notifyDomainChanged('first'), undefined);
        assert.equal(seen.length, 0);
        await Promise.resolve();
        assert.deepEqual(seen, ['started:first', 'healthy:first']);
        notifyDomainChanged('second');
        await Promise.resolve();
        assert.deepEqual(seen, ['started:first', 'healthy:first', 'started:second', 'healthy:second']);
        release();
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        assert.ok(seen.includes('finished:first'));
        assert.ok(seen.includes('finished:second'));
    } finally { release(); stopSlow(); stopThrowing(); stopRejecting(); stopHealthy(); }
    const count = seen.length;
    notifyDomainChanged('after-close');
    await Promise.resolve();
    assert.equal(seen.length, count);
});
});

__suiteDescribe("seam_s4_reinit_cleanup", () => {
// Runtime contracts for the content-script listener/cleanup seams.
// Content-bundle re-execution itself belongs in a browser integration test;
// source-text regex matching must not be used as a substitute for that flow.








installContentRuntimeHost();

function makeWindow() {
    const listeners: Record<string, Array<(...args: any[]) => void>> = {};
    return {
        __gemExporterCleanups: [] as Array<() => void>,
        addEventListener(type: string, fn: (...args: any[]) => void) {
            (listeners[type] ||= []).push(fn);
        },
        removeEventListener(type: string, fn: (...args: any[]) => void) {
            listeners[type] = (listeners[type] || []).filter(existing => existing !== fn);
        },
        dispatchEvent(event: Event | string) {
            const type = typeof event === 'string' ? event : event.type;
            for (const fn of (listeners[type] || []).slice()) fn(event);
        },
        listenerCount(type: string) { return (listeners[type] || []).length; },
    };
}

function makeChrome() {
    const messages: Array<(...args: any[]) => void> = [];
    return {
        runtime: {
            onMessage: {
                addListener: (fn: (...args: any[]) => void) => { messages.push(fn); },
                removeListener: (fn: (...args: any[]) => void) => {
                    const index = messages.indexOf(fn);
                    if (index >= 0) messages.splice(index, 1);
                },
            },
            getManifest: () => ({ version: '9.9.9-test' }),
            sendMessage: () => {},
        },
        storage: { onChanged: { addListener: () => {}, removeListener: () => {} } },
        messages,
    };
}

function withMockHost(run: (host: { win: ReturnType<typeof makeWindow>; chrome: ReturnType<typeof makeChrome>;
    history: { pushState: (...args: any[]) => void; replaceState: (...args: any[]) => void };
    location: { href: string } }) => void): void {
    const g = globalThis as any;
    const keys = ['window', 'chrome', 'history', 'location'] as const;
    const prior = keys.map(key => Object.getOwnPropertyDescriptor(g, key));
    const win = makeWindow(), chrome = makeChrome();
    const history = { pushState: (..._args: any[]) => {}, replaceState: (..._args: any[]) => {} };
    const location = { href: 'https://gemini.google.com/app/starting' };
    try {
        for (const [i, value] of [win, chrome, history, location].entries()) {
            Object.defineProperty(g, keys[i], { value, configurable: true, writable: true });
        }
        run({ win, chrome, history, location });
    } finally {
        // Drain registered listeners while the matching mock globals are still installed.
        runCleanups();
        PageObserver.cleanup();
        keys.forEach((key, i) => {
            if (prior[i]) Object.defineProperty(g, key, prior[i]);
            else Reflect.deleteProperty(g, key);
        });
    }
}

test('cleanup registry runs callbacks once and isolates a throwing cleanup', () => {
    withMockHost(({ win }) => {
        const calls: string[] = [];
        registerCleanup(() => calls.push('first'));
        registerCleanup(() => { calls.push('throws'); throw new Error('simulated cleanup exception'); });
        registerCleanup(() => calls.push('last'));
        assert.equal(win.__gemExporterCleanups.length, 3);
        assert.doesNotThrow(() => runCleanups());
        assert.deepEqual(calls, ['first', 'throws', 'last']);
        assert.equal(win.__gemExporterCleanups.length, 0);
        runCleanups();
        assert.deepEqual(calls, ['first', 'throws', 'last'], 'no cleanup runs twice');
    });
});

test('messageRouter re-init replaces a single active Chrome listener and still answers ping', () => {
    withMockHost(({ chrome }) => {
        MessageRouter.init();
        assert.equal(chrome.messages.length, 1);
        runCleanups();
        assert.equal(chrome.messages.length, 0);
        MessageRouter.init();
        assert.equal(chrome.messages.length, 1);
        let response: any;
        chrome.messages[0]({ action: 'ping' }, {}, (result: any) => { response = result; });
        assert.equal(response?.ok, true);
    });
});

test('messageBridge re-init never duplicates its window listener', () => {
    withMockHost(({ win }) => {
        initMessageBridge({});
        assert.equal(win.listenerCount('message'), 1);
        initMessageBridge({});
        assert.equal(win.listenerCount('message'), 1, 'calling init twice without cleanup must be idempotent');
        runCleanups();
        assert.equal(win.listenerCount('message'), 0);
        initMessageBridge({});
        assert.equal(win.listenerCount('message'), 1, 'listener must be re-installed after cleanup');
    });
});

test('pageObserver routes history and popstate events only through the newest callback', () => {
    withMockHost(({ win, history, location }) => {
        const seen: string[] = [];
        PageObserver.hookHistoryEvents(() => seen.push('old'));
        assert.equal(win.listenerCount('popstate'), 1);
        assert.equal(win.listenerCount('gemini:locationchange'), 1);

        location.href = 'https://gemini.google.com/app/first';
        history.pushState({}, '', '/app/first');
        assert.deepEqual(seen, ['old'], 'pushState must actually reach the registered callback');

        PageObserver.hookHistoryEvents(() => seen.push('new'));
        assert.equal(win.listenerCount('popstate'), 1);
        assert.equal(win.listenerCount('gemini:locationchange'), 1);
        location.href = 'https://gemini.google.com/app/second';
        history.replaceState({}, '', '/app/second');
        assert.deepEqual(seen, ['old', 'new'], 'the old callback must not receive subsequent history events');

        location.href = 'https://gemini.google.com/app/third';
        win.dispatchEvent('popstate');
        assert.deepEqual(seen, ['old', 'new', 'new']);
        runCleanups();
        assert.equal(win.listenerCount('popstate'), 0);
        assert.equal(win.listenerCount('gemini:locationchange'), 0);
        location.href = 'https://gemini.google.com/app/fourth';
        win.dispatchEvent('popstate');
        assert.deepEqual(seen, ['old', 'new', 'new'], 'cleanup must stop future notifications');
        PageObserver.cleanup();
        assert.equal(win.listenerCount('popstate'), 0, 'explicit cleanup is idempotent');
    });
});
});
