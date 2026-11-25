import { geminiListPage, GEMINI_LIST_CAPTURE } from '../fixtures/providers/geminiListCapture.js';
import { geminiRpcPacket, GEMINI_DETAIL_CAPTURE } from '../fixtures/providers/geminiRpcCapture.js';
import { test, expect, seedRegistryAccounts } from './fixtures';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { detailGen as geminiDetailGen } from '../fixtures/providers/geminiDetail.js';
import { inlineHtmlFallback } from '../fixtures/providers/gemini/detail/p0CapturedCases.js';
import { requestGen as geminiDetailRequestGen } from '../fixtures/providers/geminiDetailRequest.js';
import { streamGen as geminiStreamGen } from '../fixtures/providers/geminiStream.js';
import { requestGen as geminiStreamRequestGen } from '../fixtures/providers/geminiStreamRequest.js';

const accountId = '10000000-0000-4000-8000-000000000001';
let bundle: string;
test.beforeAll(async () => {
    const output = await build({ stdin: { resolveDir: path.resolve(__dirname, '../..'), loader: 'ts', contents: `
        import { installDomainStorage } from './src/runtime/api/domainStorage.ts';
        installDomainStorage();
        import { installApplicationHost } from './src/runtime/api/applicationHost.ts';
        installApplicationHost();
        import * as storage from './src/l3a/storageService.ts';
        import * as domain from './src/l2/ingestion.ts';
        import { readConversation } from './src/l2/readConversation.ts';
        import { resolveScanTarget } from './src/runtime/capabilities/tabService.ts';
        import { runLiveSave } from './src/runtime/background/liveSaveHandler.ts';
        import { installProviderHost } from './src/runtime/api/providerHost.ts';
        installProviderHost();
        import { repairSourceVersions } from './src/migration/sourceVersions.ts';
        Object.assign(globalThis, { productionProbe: { ...storage, ...domain, readConversation, resolveScanTarget, runLiveSave, repairSourceVersions } });
    ` }, bundle: true, write: false, format: 'iife', platform: 'browser', conditions: ['worker', 'browser'], logLevel: 'silent',
        define: { __EXT_VERSION__: '"2.0.0"' } });
    bundle = output.outputFiles[0].text;
});
test.beforeEach(async ({ context }) => { await seedRegistryAccounts(context); });

async function workbench(context: import('@playwright/test').BrowserContext, extensionId: string) {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/ui/options/options.html`);
    await page.evaluate(bundle);
    return page;
}
async function seed(page: import('@playwright/test').Page, ids = ['production']) {
    await page.evaluate(async ({ accountId, ids }) => {
        const api = Reflect.get(globalThis, 'productionProbe');
        for (const id of ids) await api.ingestDetail(accountId, id, {
            savedAt: 100, quality: { status: 'complete' }, assets: [], messages: [
                { role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: `Question ${id}` }] }] },
                { role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'text', text: `Answer ${id}` }] }] },
            ],
        }, { title: `Title ${id}`, titleSource: 'provider', updatedAt: 100 });
        await api.patchStoredSettings({ language: 'en', lastSeenFeatureVersion: '999.0.0' });
    }, { accountId, ids });
    await page.reload(); await page.evaluate(bundle);
    // Account is explicit even when the developer selector is hidden.
    await expect(page.locator('#list .item')).toHaveCount(ids.length);
}

for (const format of ['markdown', 'html', 'json'] as const) test(`production Options → Application → ${format} download → ExportRecord`, async ({ context, extensionId }) => {
    const page = await workbench(context, extensionId); await seed(page);
    await page.locator('#format').selectOption(format);
    await page.locator('#btnSelectAll').click();
    const download = page.waitForEvent('download'); await page.locator('#btnExport').click();
    const file = await download;
    const contents = await readFile((await file.path())!, 'utf8');
    expect(contents).toContain('Question production'); expect(contents).toContain('Answer production');
    if (format === 'json') expect(JSON.parse(contents)).toBeTruthy();
    await expect.poll(() => page.evaluate(async accountId => {
        const record = await Reflect.get(globalThis, 'productionProbe').getExportRecord({ accountId, conversationId: 'production' });
        return record?.format;
    }, accountId)).toBe(format);
    // Manual Skip uses the committed source version and does not deliver again.
    await page.locator('#btnExport').click();
    await expect(page.locator('#status')).toContainText('Skipped: 1');
});

test('a cancelled browser download cannot commit an ExportRecord or report success', async ({ context, extensionId }) => {
    const page = await workbench(context, extensionId); await seed(page);
    await page.locator('#btnSelectAll').click();
    await page.evaluate(() => document.addEventListener('click', event => {
        if (event.target instanceof HTMLAnchorElement && event.target.hasAttribute('download')) {
            event.preventDefault(); event.stopImmediatePropagation();
        }
    }, true));
    await page.locator('#btnExport').click();
    await expect(page.locator('#status')).toContainText('Conversation export failed: 1');
    expect(await page.evaluate(accountId => Reflect.get(globalThis, 'productionProbe')
        .getExportRecord({ accountId, conversationId: 'production' }), accountId)).toBeNull();
    await expect(page.locator('#list .item')).not.toContainText('Export successful');
});

test('production multi-file export creates ZIP; scan reset clears local history while keeping the downloaded ZIP', async ({ context, extensionId }) => {
    const page = await workbench(context, extensionId); await seed(page, ['one', 'two']);
    await page.locator('#btnSelectAll').click();
    const download = page.waitForEvent('download'); await page.locator('#btnExport').click();
    const file = await download; expect(file.suggestedFilename()).toMatch(/\.zip$/);
    const JSZip = require(path.resolve(__dirname, '../../lib/jszip.min.js'));
    const zip = await JSZip.loadAsync(await readFile((await file.path())!));
    const files = Object.keys(zip.files).filter(name => name.endsWith('.md'));
    expect(files).toHaveLength(2);
    expect((await Promise.all(files.map(name => zip.file(name).async('string')))).join('\n')).toContain('Answer two');
    await page.locator('#devToggle').check();
    await page.locator('#btnMoreActions').click(); await page.locator('#btnClearScan').click();
    await page.locator('#btnCleanupConfirm').click();
    await expect.poll(() => page.evaluate(async accountId => Object.keys(await Reflect.get(globalThis, 'productionProbe').listExportRecords(accountId)).length, accountId)).toBe(0);
    await page.reload(); await page.evaluate(bundle);
    await expect(page.locator('#list .item')).toHaveCount(0);
    expect(await page.evaluate(async accountId => !!await Reflect.get(globalThis, 'productionProbe').readConversation({ accountId, conversationId: 'two' }), accountId)).toBe(false);
    expect((await JSZip.loadAsync(await readFile((await file.path())!))).file(files[0])).toBeTruthy();
});

test('browser ZIP preserves long Unicode text across every streaming boundary', async ({ context, extensionId }) => {
    const page = await workbench(context, extensionId); await seed(page, ['unicode', 'other']);
    const answer = 'x👤'.repeat(30000) + '🤖 中文结尾';
    await page.evaluate(async ({ accountId, answer }) => {
        await Reflect.get(globalThis, 'productionProbe').ingestDetail(accountId, 'unicode', {
            savedAt: 200, quality: { status: 'complete' }, assets: [], messages: [
                { role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Unicode question' }] }] },
                { role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'text', text: answer }] }] },
            ],
        }, { title: 'Unicode', titleSource: 'provider', updatedAt: 200 });
    }, { accountId, answer });
    await page.locator('#btnSelectAll').click();
    const download = page.waitForEvent('download'); await page.locator('#btnExport').click();
    const JSZip = require(path.resolve(__dirname, '../../lib/jszip.min.js'));
    const zip = await JSZip.loadAsync(await readFile((await (await download).path())!));
    const name = Object.keys(zip.files).find(name => name.endsWith('_nicode.md'));
    expect(name).toBeTruthy();
    const bytes = await zip.file(name).async('uint8array');
    expect(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).toContain(answer);
});

async function sourcePage(context: import('@playwright/test').BrowserContext, gaia = '10000000001') {
    const source = await context.newPage();
    await source.route('https://gemini.google.com/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>Gemini</title><script>window.WIZ_global_data={qDCSke:'${gaia}',SNlM0e:'token',cfb2h:'build'};</script><main>Offline source fixture</main>` }));
    await source.goto('https://gemini.google.com/app/passive');
    return source;
}

test('real Content discovery resolves scan targets, deduplicates tabs and rejects ambiguous/default sources', async ({ context, extensionId }) => {
    const page = await workbench(context, extensionId);
    const a = await sourcePage(context), second = await sourcePage(context);
    expect(await page.evaluate(() => Reflect.get(globalThis, 'productionProbe').resolveScanTarget())).toBe(accountId);
    const b = await sourcePage(context, '10000000002');
    await expect(page.evaluate(() => Reflect.get(globalThis, 'productionProbe').resolveScanTarget())).rejects.toThrow(/Multiple provider accounts/);
    expect(await page.evaluate(id => Reflect.get(globalThis, 'productionProbe').resolveScanTarget(id), accountId)).toBe(accountId);
    await a.close(); await second.close(); await b.close();
    const unknown = await sourcePage(context, '');
    await expect(page.evaluate(() => Reflect.get(globalThis, 'productionProbe').resolveScanTarget())).rejects.toThrow(/Open Gemini/);
    await unknown.close();
});

test('MAIN fetch → isolated L1 → Background L2 commits in extension IDB and updates Badge; forged export is inert', async ({ context, extensionId }) => {
    const page = await workbench(context, extensionId);
    const source = await sourcePage(context);
    const wire = geminiListPage().responseBody;
    await source.route('**/batchexecute*', route => route.fulfill({ contentType: 'application/json', body: wire }));
    await source.evaluate(async body => {
        await fetch('/_/BardChatUi/data/batchexecute', { method: 'POST', body: new URLSearchParams(body) });
        window.postMessage({ action: 'runLiveSave', key: { accountId: 'fake', conversationId: 'passive' } }, location.origin);
    }, geminiListPage().requestBody);
    await expect.poll(() => page.evaluate(async accountId => (await Reflect.get(globalThis, 'productionProbe').listIndexes(accountId)).length, accountId)).toBe(GEMINI_LIST_CAPTURE.firstPageRows);
    // Badge v2 deliberately pulls counts on visibility restoration (and every ~60s),
    // not on an Index-commit push. Exercise that existing refresh boundary.
    await source.bringToFront();
    await source.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(source.locator('#geminiExportBadge')).toContainText(String(GEMINI_LIST_CAPTURE.firstPageRows));
    expect(await page.evaluate(async accountId => Object.keys(await Reflect.get(globalThis, 'productionProbe').listExportRecords(accountId)).length, accountId)).toBe(0);
    expect(await source.evaluate(async () => (await indexedDB.databases()).map(db => db.name))).not.toContain('gemini_exporter_v2');
});

test('captured Gemini Markdown fallback preserves inline HTML in an Options download', async ({ context, extensionId }) => {
    const page = await workbench(context, extensionId);
    const source = await sourcePage(context);
    const { conversationId, literal } = inlineHtmlFallback;
    const wire = inlineHtmlFallback.wire();
    await source.route('**/batchexecute*', route => route.fulfill({ contentType: 'application/json', body: wire }));
    await source.waitForFunction(() => window.__gemExporterHookInstalled === true);
    const body = geminiDetailRequestGen('G_E2E_PRODUCTION_PASSIVE_DETAIL_REQUEST_01')
        .replace('c_passive', 'c_' + conversationId);
    await source.evaluate(async body => {
        await fetch('/_/BardChatUi/data/batchexecute', { method: 'POST', body });
    }, body);
    await expect.poll(() => page.evaluate(async ({ accountId, conversationId }) => !!await Reflect.get(globalThis, 'productionProbe')
        .readConversation({ accountId, conversationId }), { accountId, conversationId })).toBe(true);
    await page.reload();
    await expect(page.locator('#list .item')).toHaveCount(1);
    await page.locator('#format').selectOption('markdown');
    await page.locator('#btnSelectAll').click();
    const download = page.waitForEvent('download');
    await page.locator('#btnExport').click();
    const contents = await readFile((await (await download).path())!, 'utf8');
    expect(contents).toContain('```html\n' + literal + '\n```');
    expect(contents).toContain('Use `' + literal + '` here.');
});

test('Service Worker unified Live Save writes a real stored directory handle and reports missing permissions without changing Settings', async ({ context, extensionId }) => {
    const page = await workbench(context, extensionId); await seed(page);
    await page.evaluate(async () => {
        const api = Reflect.get(globalThis, 'productionProbe');
        await api.setDirectoryHandle(await navigator.storage.getDirectory());
        await api.patchStoredSettings({ enabledDisk: true, defaultFormat: 'markdown' });
    });
    const worker = context.serviceWorkers()[0]; await worker.evaluate(bundle);
    const result = await worker.evaluate(async accountId => Reflect.get(globalThis, 'productionProbe').runLiveSave({ accountId, conversationId: 'production' }), accountId);
    expect(result.exported).toBe(1);
    const contents = await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory(); const texts: string[] = [];
        for await (const [name, handle] of Reflect.get(root, 'entries').call(root)) if (name.endsWith('.md')) texts.push(await (await (handle as FileSystemFileHandle).getFile()).text());
        return texts.join('\n');
    });
    expect(contents).toContain('Answer production');
    // Simulate a missing native capability directly in the test fixture, not via a public Storage delete API.
    await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('gemini_exporter_v2');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        try {
            await new Promise<void>((resolve, reject) => {
                const tx = db.transaction('directoryHandles', 'readwrite');
                tx.objectStore('directoryHandles').delete('default');
                tx.oncomplete = () => resolve();
                tx.onabort = () => reject(tx.error);
                tx.onerror = () => reject(tx.error);
            });
        } finally { db.close(); }
    });
    await expect(worker.evaluate(async accountId => Reflect.get(globalThis, 'productionProbe').runLiveSave({ accountId, conversationId: 'production' }), accountId)).rejects.toThrow(/directory/i);
    expect(await page.evaluate(async () => (await Reflect.get(globalThis, 'productionProbe').getStoredSettings()).enabledDisk)).toBe(true);
});

test('production PDF export uses the real sandbox through the unified Application pipeline', async ({ context, extensionId }) => {
    test.setTimeout(90000);
    const page = await workbench(context, extensionId); await seed(page);
    await page.locator('#format').selectOption('pdf'); await page.locator('#btnSelectAll').click();
    const download = page.waitForEvent('download'); await page.locator('#btnExport').click();
    const file = await download; expect(file.suggestedFilename()).toMatch(/\.pdf$/);
    const bytes = await readFile((await file.path())!);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-'); expect(bytes.length).toBeGreaterThan(1000);
    await expect.poll(() => page.evaluate(async accountId => (await Reflect.get(globalThis, 'productionProbe').getExportRecord({ accountId, conversationId: 'production' }))?.format, accountId)).toBe('pdf');
});

test('passive Detail commit triggers Background Live Save and writes the real file', async ({ context, extensionId }) => {
    const page = await workbench(context, extensionId);
    await page.evaluate(async () => {
        const api = Reflect.get(globalThis, 'productionProbe');
        await api.setDirectoryHandle(await navigator.storage.getDirectory());
        await api.patchStoredSettings({ enabledDisk: true, defaultFormat: 'markdown' });
    });
    const source = await sourcePage(context);
    const wire = geminiDetailGen('G_E2E_PRODUCTION_PASSIVE_MIXED_01');
    await source.route('**/batchexecute*', route => route.fulfill({ contentType: 'application/json', body: wire }));
    const capture = () => source.evaluate(async body => {
        await fetch('/_/BardChatUi/data/batchexecute', { method: 'POST', body });
    }, geminiDetailRequestGen('G_E2E_PRODUCTION_PASSIVE_DETAIL_REQUEST_01'));
    await capture();
    await expect.poll(() => page.evaluate(async accountId => (await Reflect.get(globalThis, 'productionProbe').getExportRecord({ accountId, conversationId: 'passive' }))?.status, accountId)).toBe('ok');
    const read = () => page.evaluate(async () => {
        const root = await navigator.storage.getDirectory(); const output: {name:string;time:number;text:string}[] = [];
        for await (const [name, handle] of Reflect.get(root, 'entries').call(root)) if (name.endsWith('.md')) {
            const file = await (handle as FileSystemFileHandle).getFile(); output.push({ name, time: file.lastModified, text: await file.text() });
        }
        return output;
    });
    const written = await read(); expect(written).toHaveLength(1); expect(written[0].text).toContain('Answer from passive capture');

});


test('Options Takeout ZIP import persists decoded text from a real Takeout prompt', async ({ context, extensionId }) => {
    const page = await workbench(context, extensionId);
    await page.evaluate(async () => Reflect.get(globalThis, 'productionProbe').patchStoredSettings({ language: 'en', lastSeenFeatureVersion: '999.0.0' }));
    await page.reload();
    await page.evaluate(bundle);
    await page.locator('#btnMoreActions').click();
    const chooser = page.waitForEvent('filechooser');
    await page.locator('#btnImportTakeout').click();
    await (await chooser).setFiles(path.resolve(__dirname, '../fixtures/gemini_takeout_clean.zip'));
    await expect(page.locator('#status')).toContainText('Read 6 conversation records, added 6');
    const prompts = await page.evaluate(async ({ accountId, conversationId }) => {
        const detail = await Reflect.get(globalThis, 'productionProbe').getDetail({ accountId, conversationId });
        return JSON.stringify(detail?.messages.filter((message: { role: string }) => message.role === 'user') ?? []);
    }, { accountId, conversationId: '7b29852ecae8344a' });
    expect(prompts).toContain("Bell's inequality");
});

test('completed reply with Live Save off refreshes current source and reorders the open Options view without focus or reload', async ({ context, extensionId }) => {
    const id = 'abcdef123456';
    const page = await workbench(context, extensionId); await seed(page, [id, 'newer']);
    await page.evaluate(async ({ accountId, id }) => {
        const api = Reflect.get(globalThis, 'productionProbe');
        await api.ingestIndexes(accountId, [{ conversationId: 'newer', fields: { updatedAt: 200 } }]);
        await api.putExportRecord({ accountId, conversationId: id }, { format: 'markdown', status: 'ok', chatTime: 100, exportedAt: 200 });
        await api.patchStoredSettings({ enabledDisk: false });
    }, { accountId, id });
    await page.reload(); await page.evaluate(bundle);
    expect(await page.locator('#list .item').first().getAttribute('data-chat-id')).toBe('newer');
    const source = await sourcePage(context);
    const wire = geminiDetailGen('G_E2E_PRODUCTION_CONTINUED_MIXED_01');
    let acquisitions = 0;
    await context.route('https://gemini.google.com/**/batchexecute*', route => {
        acquisitions++; return route.fulfill({ contentType: 'application/json', body: wire });
    });
    await source.route('**/StreamGenerate*', route => route.fulfill({
        contentType: 'application/json',
        body: geminiStreamGen('G_STREAM_E2E_ANSWERED_01'),
    }));
    await source.evaluate(async body => {
        await fetch('/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate', { method: 'POST', body });
    }, geminiStreamRequestGen('G_STREAM_E2E_REQUEST_01'));
    await expect.poll(() => acquisitions).toBeGreaterThan(0);
    await expect(page.locator('#list .item').first()).toHaveAttribute('data-chat-id', id);
    const state = await page.evaluate(async ({ accountId, id }) => {
        const api = Reflect.get(globalThis, 'productionProbe'), key = { accountId, conversationId: id };
        return { index: await api.getIndex(key), detail: await api.getDetail(key), record: await api.getExportRecord(key) };
    }, { accountId, id });
    expect(state.index.updatedAt).toBe(1700000000000);
    expect(state.record.chatTime).toBe(100);
    expect(JSON.stringify(state.detail)).toContain('Final appended answer');
});

test('scan source resolution activates an already authorized document without a Content receiver', async ({context,extensionId}) => {
    const page=await workbench(context,extensionId);
    await page.evaluate(async()=>chrome.scripting.unregisterContentScripts({ids:['gemini-source-main','gemini-source-content']}));
    const source=await sourcePage(context);
    const tabId=await page.evaluate(async()=>{
        const tabs=await chrome.tabs.query({url:'https://gemini.google.com/*'});
        const id=tabs[0]?.id;
        if(id===undefined)throw Error('Missing source tab');
        return id;
    });
    await expect(page.evaluate(id=>chrome.tabs.sendMessage(id,{action:'getAccountContext'}),tabId)).rejects.toThrow(/Receiving end does not exist/);
    expect(await page.evaluate(id=>Reflect.get(globalThis,'productionProbe').resolveScanTarget(id),accountId)).toBe(accountId);
    expect(await page.evaluate(id=>chrome.tabs.sendMessage(id,{action:'getAccountContext'}),tabId))
        .toMatchObject({ok:true,accountContext:{accountId,providerId:'gemini'}});
    await source.close();
});

test('content-script native detail is committed in extension IndexedDB and remains readable after the source tab closes', async ({ context, extensionId }) => {
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/src/ui/options/options.html?notour=1`);
    const source = await context.newPage();
    await source.route('https://gemini.google.com/**', route => route.fulfill({ contentType: 'text/html', body: `
        <title>Cross origin - Gemini</title><script>window._WIZ_global_data = { qDCSke: '10000000001', SNlM0e: 'mock-at', cfb2h: 'mock-bl' };</script>
        <user-query><div class="query-text"><p>Persist this question</p></div></user-query>
        <model-response data-model-name="Cross origin model"><div class="markdown"><p><strong>Persist this answer</strong></p></div></model-response>
    ` }));
    const wire = geminiRpcPacket('detail').responseBody;
    await source.route('**/batchexecute*', route => route.fulfill({ contentType: 'application/json', body: wire }));
    await source.goto('https://gemini.google.com/app/0000000000000001');
    await source.waitForFunction(() => window.__gemExporterHookInstalled === true);
    await source.evaluate(async body => {
        await fetch('/_/BardChatUi/data/batchexecute', { method: 'POST', body: new URLSearchParams(body) });
    }, geminiRpcPacket('detail').requestBody);
    await expect.poll(() => options.evaluate(async () => {
        const request = indexedDB.open('gemini_exporter_v2');
        const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        try {
            return await new Promise<number>((resolve, reject) => {
                const get = db.transaction('details').objectStore('details').get(['10000000-0000-4000-8000-000000000001', '0000000000000001']);
                get.onsuccess = () => resolve(get.result?.messages?.length ?? 0); get.onerror = () => reject(get.error);
            });
        } finally { db.close(); }
    })).toBe(GEMINI_DETAIL_CAPTURE.messages);
    await source.close();
    const stored = await options.evaluate(async () => {
        const request = indexedDB.open('gemini_exporter_v2');
        const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        try {
            return await new Promise<unknown>((resolve, reject) => {
                const tx = db.transaction('details', 'readonly');
                const get = tx.objectStore('details').get(['10000000-0000-4000-8000-000000000001', '0000000000000001']);
                let value: unknown;
                get.onsuccess = () => { value = get.result; };
                tx.oncomplete = () => resolve(value);
                tx.onerror = () => reject(tx.error);
            });
        } finally { db.close(); }
    }) as { key: { accountId: string }; messages: Array<{ model?: string; content: unknown[] }> };
    expect(stored.key.accountId).toBe('10000000-0000-4000-8000-000000000001');
    expect(stored.messages).toHaveLength(GEMINI_DETAIL_CAPTURE.messages);
    expect(stored.messages[0].content).not.toHaveLength(0);
    expect(stored.messages.every(message => message.content.length > 0)).toBe(true);
    expect(JSON.stringify(stored.messages.at(-1)?.content)).toContain(GEMINI_DETAIL_CAPTURE.lastAnswer);
    expect(stored).not.toHaveProperty('index');
});

test('existing profile repairs mixed versions once and admits an older online timestamp in native IndexedDB', async ({ context, extensionId }) => {
    const page = await workbench(context, extensionId);
    const result = await page.evaluate(async accountId => {
        const api = Reflect.get(globalThis, 'productionProbe');
        const key = { accountId, conversationId: 'migration-version' };
        const detail = { savedAt: 9000, quality: { status: 'partial' }, assets: [], messages: [
            { role: 'user', timestamp: 9000, content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Keep this body' }] }] },
        ] };
        await api.ingestDetail(accountId, key.conversationId, detail, { title: 'Migration regression', titleSource: 'provider', updatedAt: 9000 });
        await api.putExportRecord(key, { format: 'markdown', status: 'ok', exportedAt: 10000, chatTime: 9000 });
        await chrome.storage.local.remove('gemini_exporter_source_versions_v1');
        await api.repairSourceVersions();
        const repaired = { index: await api.getIndex(key), detail: await api.getDetail(key), record: await api.getExportRecord(key) };
        const admission = await api.ingestDetail(accountId, key.conversationId, { ...detail, savedAt: 1000 }, { updatedAt: 1000 });
        await api.repairSourceVersions();
        return { repaired, admission, final: { index: await api.getIndex(key), detail: await api.getDetail(key) } };
    }, accountId);
    expect(result.repaired.index.updatedAt).toBeUndefined();
    expect(result.repaired.index.activityAt).toBe(9000);
    expect(result.repaired.detail.savedAt).toBeUndefined();
    expect(result.repaired.detail.messages[0].content[0].children[0].text).toBe('Keep this body');
    expect(result.repaired.record).toEqual({ format: 'markdown', status: 'ok', exportedAt: 10000 });
    expect(result.admission.accepted).toBe(true);
    expect(result.final.index.updatedAt).toBe(1000);
    expect(result.final.detail.savedAt).toBe(1000);
    await page.reload();
    await expect(page.locator('#list .item')).toHaveCount(1);
    await expect(page.locator('#list')).toContainText('Migration regression');
});

for (const transport of ['fetch', 'XHR'] as const) test(`native Gemini ${transport} feeds extension storage without putting credentials on the page bus`, async ({ context }) => {
    const source = await context.newPage();
    const { requestBody, responseBody } = geminiListPage();
    await source.route('https://gemini.google.com/**', route => {
        if (new URL(route.request().url()).pathname.endsWith('/batchexecute')) {
            return route.fulfill({ contentType: 'application/json', body: responseBody });
        }
        return route.fulfill({ contentType: 'text/html', body: '<title>Offline Gemini fixture</title>' });
    });
    await source.goto('https://gemini.google.com/u/1/app');
    await expect(source.locator('#geminiExportBadge')).toBeVisible();

    const boundary = await source.evaluate(async ({ requestBody, transport }) => {
        const counts = { list: 0, credentialEvents: 0, rpcUrlsWithQuery: 0 };
        const listDelivered = new Promise<void>(resolve => {
            window.addEventListener('message', function receive(event) {
                if (event.data?.type === 'GEMINI_CREDENTIALS') counts.credentialEvents++;
                if (event.data?.type !== 'GEMINI_NETWORK_BATCHEXECUTE') return;
                counts.list++;
                if (new URL(event.data.payload.url).search) counts.rpcUrlsWithQuery++;
                window.removeEventListener('message', receive);
                resolve();
            });
        });
        const body = new URLSearchParams(requestBody);
        body.set('at', 'fixture-at');
        const url = '/u/1/_/BardChatUi/data/batchexecute?f.sid=fixture-sid&bl=fixture-build';
        if (transport === 'fetch') {
            const response = await fetch(url, { method: 'POST', body });
            await response.text();
        } else {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', url);
            const done = new Promise<void>(resolve => xhr.addEventListener('loadend', () => resolve(), { once: true }));
            xhr.send(body.toString());
            await done;
        }
        await listDelivered;
        return counts;
    }, { requestBody, transport });
    expect(boundary, 'page bus should carry list facts, not credential events or RPC query strings')
        .toEqual({ list: 1, credentialEvents: 0, rpcUrlsWithQuery: 0 });

    const worker = context.serviceWorkers()[0];
    await expect.poll(() => worker.evaluate(async () => {
        const { gemini_credentials_map } = await chrome.storage.session.get('gemini_credentials_map');
        const entry = (gemini_credentials_map as Record<string, { at?: string; bl?: string; accountSlot?: string }> | undefined)
            ?.['fixture-sid'];
        return entry?.at === 'fixture-at' && entry?.bl === 'fixture-build' && entry?.accountSlot === 'u1';
    }), { message: 'extension session storage still has the native RPC credentials for u1' }).toBe(true);
});

test('connecting activates an existing document without granting other platforms', async ({ context, extensionId }) => {
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/src/ui/options/options.html?notour=1`);
    await options.evaluate(async () => {
        const scripts = await chrome.scripting.getRegisteredContentScripts();
        await chrome.scripting.unregisterContentScripts({ ids: scripts.map(script => script.id) });
    });
    const source = await context.newPage();
    await source.route('https://gemini.google.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><script>window.WIZ_global_data={qDCSke:"10000000001",SNlM0e:"fixture",cfb2h:"build"}</script><main>Existing tab</main>' }));
    await source.goto('https://gemini.google.com/app');
    expect(await source.locator('#geminiExportBadge').count()).toBe(0);
    const prepareBundle = await build({ stdin: { contents: "import {preparePlatformTab} from './src/runtime/capabilities/platformInjection.ts'; globalThis.prepareSource=preparePlatformTab;", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife' });
    await options.evaluate(prepareBundle.outputFiles[0].text);
    await options.evaluate(async () => {
        const tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
        await Reflect.get(globalThis, 'prepareSource')('gemini', tabs[0].id);
    });
    await expect(source.locator('#geminiExportBadge')).toBeVisible();
    const scripts = await options.evaluate(() => chrome.scripting.getRegisteredContentScripts());
    expect(scripts.map(script => script.id).sort()).toEqual(['gemini-source-content', 'gemini-source-main']);
    expect(await options.evaluate(() => chrome.permissions.contains({ origins: ['https://chatgpt.com/*'] }))).toBe(false);
    expect(await options.evaluate(() => chrome.permissions.contains({ origins: ['https://claude.ai/*'] }))).toBe(false);
});
