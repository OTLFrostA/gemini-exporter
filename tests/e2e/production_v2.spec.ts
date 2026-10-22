import { test, expect, seedRegistryAccounts } from './fixtures';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { geminiListFixtures } from '../fixtures/providers/gemini.js';

const accountId = '10000000-0000-4000-8000-000000000001';
let bundle: string;
test.beforeAll(async () => {
    const output = await build({ stdin: { resolveDir: path.resolve(__dirname, '../..'), loader: 'ts', contents: `
        import * as storage from './src/l3a/storageService.ts';
        import * as domain from './src/l2/ingestion.ts';
        import { readConversation } from './src/l2/readConversation.ts';
        import { resolveScanTarget } from './src/runtime/capabilities/tabService.ts';
        import { runLiveSave } from './src/runtime/background/liveSaveHandler.ts';
        Object.assign(globalThis, { productionProbe: { ...storage, ...domain, readConversation, resolveScanTarget, runLiveSave } });
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
    await page.locator('#btnClearScan').click();
    await page.locator('#btnCleanupConfirm').click();
    await expect.poll(() => page.evaluate(async accountId => Object.keys(await Reflect.get(globalThis, 'productionProbe').listExportRecords(accountId)).length, accountId)).toBe(0);
    await page.reload(); await page.evaluate(bundle);
    await expect(page.locator('#list .item')).toHaveCount(0);
    expect(await page.evaluate(async accountId => !!await Reflect.get(globalThis, 'productionProbe').readConversation({ accountId, conversationId: 'two' }), accountId)).toBe(false);
    expect((await JSZip.loadAsync(await readFile((await file.path())!))).file(files[0])).toBeTruthy();
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
    await expect(page.evaluate(() => Reflect.get(globalThis, 'productionProbe').resolveScanTarget())).rejects.toThrow(/Multiple Gemini/);
    expect(await page.evaluate(id => Reflect.get(globalThis, 'productionProbe').resolveScanTarget(id), accountId)).toBe(accountId);
    await a.close(); await second.close(); await b.close();
    const unknown = await sourcePage(context, '');
    await expect(page.evaluate(() => Reflect.get(globalThis, 'productionProbe').resolveScanTarget())).rejects.toThrow(/Open Gemini/);
    await unknown.close();
});

test('MAIN fetch → isolated L1 → Background L2 commits in extension IDB and updates Badge; forged export is inert', async ({ context, extensionId }) => {
    const page = await workbench(context, extensionId);
    const source = await sourcePage(context);
    const wire = geminiListFixtures.browserPassiveCaptureWire();
    await source.route('**/batchexecute*', route => route.fulfill({ contentType: 'application/json', body: wire }));
    await source.evaluate(async () => {
        await fetch('/_/BardChatUi/data/batchexecute', { method: 'POST', body: new URLSearchParams({ 'f.req': JSON.stringify([[['MaZiqc', JSON.stringify([20, null, [0, null, 1]]), null, 'generic']]]) }) });
        window.postMessage({ action: 'runLiveSave', key: { accountId: 'fake', conversationId: 'passive' } }, location.origin);
    });
    await expect.poll(() => page.evaluate(async accountId => (await Reflect.get(globalThis, 'productionProbe').listIndexes(accountId)).length, accountId)).toBe(1);
    // Badge v2 deliberately pulls counts on visibility restoration (and every ~60s),
    // not on an Index-commit push. Exercise that existing refresh boundary.
    await source.bringToFront();
    await source.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(source.locator('#geminiExportBadge')).toContainText('1');
    expect(await page.evaluate(async accountId => Object.keys(await Reflect.get(globalThis, 'productionProbe').listExportRecords(accountId)).length, accountId)).toBe(0);
    expect(await source.evaluate(async () => (await indexedDB.databases()).map(db => db.name))).not.toContain('gemini_exporter_v2');
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
            const request = indexedDB.open('gemini_exporter_v2', 1);
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
    const wire = JSON.stringify([
        ['wrb.fr', 'hNvQHb', JSON.stringify([[[['c_passive', 'r_question'], [1700000000, 0], [['Question from passive capture']], [[['rc_question', [['Answer from passive capture']]]]]]], null])],
        ['wrb.fr', 'MaZiqc', JSON.stringify([null, null, [['c_passive', 'Passive detail', null, null, null, [1700000000, 0]]]])],
    ]);
    await source.route('**/batchexecute*', route => route.fulfill({ contentType: 'application/json', body: wire }));
    const capture = () => source.evaluate(async () => {
        await fetch('/_/BardChatUi/data/batchexecute', { method: 'POST', body: new URLSearchParams({ 'f.req': JSON.stringify([[['hNvQHb', JSON.stringify(['c_passive', null, null, 1, [1], [4], null, 1]), null, 'generic']]]) }).toString() });
    });
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


const tier2Scripts = JSON.parse(execFileSync('python3', ['-c',
    'import json; from scripts.framework.v2_probe import probe_bundle; from scripts.framework.gemini_dual_parse import INSTALL_CAPTURE; print(json.dumps(dict(probe=probe_bundle(),capture=INSTALL_CAPTURE)))'],
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })) as { probe: string; capture: string };

test('Tier 2 Skip preparation rejects stale, partial, wrong-format and unsafe versions before choosing a current record', async ({ context, extensionId }) => {
    const page = await workbench(context, extensionId);
    const ids = ['stale', 'partial', 'wrong-format', 'unsafe', 'current', 'unexported'];
    await seed(page, ids);
    await page.evaluate(async ({ accountId, ids }) => {
        const api = Reflect.get(globalThis, 'productionProbe');
        for (const id of ids.slice(0, -1)) await api.putExportRecord({ accountId, conversationId: id }, {
            format: id === 'wrong-format' ? 'html' : 'markdown', status: id === 'partial' ? 'partial' : 'ok',
            exportedAt: 200, chatTime: id === 'stale' ? 99 : id === 'unsafe' ? 100.5 : 100,
        });
    }, { accountId, ids });
    await page.evaluate(tier2Scripts.probe);
    const eligible = await page.evaluate(() => Reflect.get(globalThis, '__tier2V2').skipEligibleIds());
    expect(eligible).toEqual(['current']);
    // Run the actual two selection scripts from the Tier 2 case, in the browser.
    const selections = JSON.parse(execFileSync('python3', ['-c',
        "import ast,json; tree=ast.parse(open('scripts/framework/cases/export.py').read()); cls=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='FastSkipExportedCase'); print(json.dumps([n.value for n in ast.walk(cls) if isinstance(n,ast.Constant) and isinstance(n.value,str) and 'const items = Array.from' in n.value]))"], { encoding: 'utf8' })) as string[];
    for (const script of selections) {
        const result = await page.evaluate(script);
        if (result && typeof result === 'object' && 'exportedId' in result) expect(result.exportedId).toBe('current');
    }
});

test('Tier 2 native audit acquires raw Detail even when manual export would use complete cached Domain', async ({ context, extensionId }) => {
    const page = await workbench(context, extensionId); await seed(page);
    const source = await sourcePage(context);
    await page.evaluate(tier2Scripts.probe);
    let requests = 0;
    const wire = JSON.stringify([
        ['wrb.fr', 'hNvQHb', JSON.stringify([[[['c_production', 'r_question'], [1700000000, 0], [['Question production']], [[['rc_question', [['Current native answer']]]]]]], null])],
        ['wrb.fr', 'MaZiqc', JSON.stringify([null, null, [['c_production', 'Current title', null, null, null, [1700000000, 0]]]])],
    ]);
    await page.route('https://gemini.google.com/**/batchexecute*', route => {
        requests++; return route.fulfill({ contentType: 'application/json', body: wire });
    });
    await page.locator('#btnSelectAll').click();
    const first = page.waitForEvent('download'); await page.locator('#btnExport').click(); await first;
    expect(requests, 'cached export cannot itself supply native evidence').toBe(0);
    await page.evaluate(tier2Scripts.capture);
    await page.evaluate(() => Reflect.get(globalThis, '__tier2V2').refreshForNativeAudit(['production']));
    expect(requests).toBeGreaterThan(0);
    const captured = await page.evaluate(async () => {
        const state = Reflect.get(globalThis, '__geminiDualCapture'); await Promise.all(state.pending); return state.replies.production;
    });
    expect(captured[0].text).toBe(wire);
    await page.locator('#skipExported').uncheck();
    const next = page.waitForEvent('download'); await page.locator('#btnExport').click();
    expect(await readFile((await (await next).path())!, 'utf8')).toContain('Current native answer');
    await source.close();
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
    const wire = JSON.stringify([
        ['wrb.fr', 'hNvQHb', JSON.stringify([[[['c_' + id, 'r_question'], [1700000000, 0], [['Final prompt']], [[['rc_question', [['Final appended answer']]]]]]], null])],
        ['wrb.fr', 'MaZiqc', JSON.stringify([null, null, [['c_' + id, 'Current continued title', null, null, null, [1700000000, 0]]]])],
    ]);
    let acquisitions = 0;
    await context.route('https://gemini.google.com/**/batchexecute*', route => {
        acquisitions++; return route.fulfill({ contentType: 'application/json', body: wire });
    });
    const fixture = JSON.parse(await readFile(path.resolve(__dirname, '../fixtures/gemini_answered_stream.json'), 'utf8'));
    const frame = JSON.stringify(fixture.frames[0]);
    await source.route('**/StreamGenerate*', route => route.fulfill({ contentType: 'application/json', body: ")]}'\n\n" + (frame.length + 2) + '\n' + frame + '\n' }));
    await source.evaluate(async () => {
        await fetch('/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate', { method: 'POST', body: 'f.req=test' });
    });
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
