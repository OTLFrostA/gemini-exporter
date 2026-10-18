const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');
const { chromium } = require('@playwright/test');
const { readFileSync } = require('node:fs');

const root = process.cwd();
function bundle(contents) {
    return buildSync({ stdin: { contents, resolveDir: root }, bundle: true,
        format: 'iife', globalName: 'ui', write: false, logLevel: 'error' }).outputFiles[0].text;
}
const harness = bundle(`
export * as storage from './src/core/storage/storageService.ts';
export * as app from './src/core/application/index.ts';
export * as ingestion from './src/core/domain/ingestion.ts';
export {ProviderRegistry} from './src/core/provider/providerRegistry.ts';
export * as store from './src/ui/state/conversationsStore.ts';
export * as exporting from './src/ui/controllers/exportController.ts';
export * as scanning from './src/ui/controllers/syncController.ts';
export * as optionsExport from './src/ui/options/modules/optionsExport.ts';
export * as optionsSettings from './src/ui/options/modules/optionsSettings.ts';
export * as optionsTakeout from './src/ui/options/modules/optionsTakeout.ts';
export * as dialogs from './src/ui/views/dialogView.ts';
export * as list from './src/ui/views/listView.ts';
export * as takeout from './src/ui/controllers/takeoutController.ts';
export * as tour from './src/ui/tour/tourGuide.ts';
export * as badge from './src/content/badgeView.ts';
export {__setModuleOverride} from './src/core/utils/moduleOverrides.ts';
`);
const entry = name => buildSync({ entryPoints: [`src/ui/${name}/${name}.ts`], bundle: true,
    write: false, logLevel: 'error' }).outputFiles[0].text;
const optionsBundle = entry('options'), popupBundle = entry('popup');
const accountId = '10000000-0000-4000-8000-000000000001';
const otherId = '10000000-0000-4000-8000-000000000002';
let browser;
test.before(async () => { browser = await chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });
async function surface(name = 'options') {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const html = readFileSync(`src/ui/${name}/${name}.html`, 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
    await page.route('http://localhost/**', route => route.fulfill({ body: html, contentType: 'text/html' }));
    await page.goto(`http://localhost/${name}?notour=1`);
    await page.evaluate(({ accountId }) => {
        window.testSettings = {};
        window.settingsListeners = [];
        window.activeAccount = accountId;
        window.chrome = { storage: { local: {
            async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in window.testSettings).map(key => [key, window.testSettings[key]])); },
            async set(values) { Object.assign(window.testSettings, structuredClone(values)); for (const callback of window.settingsListeners) callback(Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { newValue }])), 'local'); },
            async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete window.testSettings[key]; }
        }, onChanged: { addListener(callback) { window.settingsListeners.push(callback); } } }, runtime: {
            id: 'fixture-extension', getManifest: () => ({ version: '1.8.1' }), onMessage: { addListener() {} },
            async sendMessage(message) {
                if (message.action !== 'accountRegistry') throw new Error('Unexpected Runtime message: ' + message.action);
                const storage = window.ui.storage;
                return { ok: true, value: message.command === 'list' ? await storage.listAccounts() : await storage.getAccount(message.accountId) };
            }, openOptionsPage() {}
        }, tabs: { async query() { return [{ id: 1, url: 'https://gemini.google.com/app/c_opaque', title: 'Fixture - Gemini', active: true }]; },
            async sendMessage(_id, message) {
                if (message.action !== 'getAccountContext') throw new Error('Unexpected tab message');
                if (window.failBinding) throw new Error('Account unavailable');
                return { ok: true, conversationId: 'c_opaque', accountContext: { providerId: 'gemini', accountId: window.activeAccount } };
            }, onUpdated: { addListener() {} } } };
    }, { accountId });
    await page.addScriptTag({ content: harness });
    await page.addScriptTag({ content: readFileSync('lib/jszip.min.js', 'utf8') });
    await page.evaluate(async ({ accountId, otherId }) => {
        const { storage, ingestion, ProviderRegistry } = window.ui;
        for (const id of [accountId, otherId]) await storage.putAccount({ id, providerId: 'ui-fixture', providerAccountId: id });
        window.providerEnd = 'source_end';
        ProviderRegistry.register({ id: 'ui-fixture', name: 'Fixture IO boundary', hostPatterns: [], matchesUrl: () => false,
            async checkReadiness() { return { ready: true }; },
            async listConversations(options) {
                window.scanSignal = options.signal;
                await options.onPageCommitted?.({ page: 2, totalObserved: 3 });
                if (window.holdScan) await new Promise(resolve => { window.releaseScan = resolve; });
                if (window.providerError) throw new Error(window.providerError);
                return window.providerEnd;
            },
            async fetchConversationDetail() { throw new Error('Unexpected source refresh'); },
            async acquireResource(_key, _asset, signal) {
                window.exportSignal = signal;
                if (window.holdExport) await new Promise(resolve => { window.releaseExport = resolve; });
                throw new Error('Resource unavailable');
            }
        });
        for (const [id, title] of [['c_opaque', 'Opaque ID preserved'], ['other', 'Second account']]) {
            const owner = id === 'c_opaque' ? accountId : otherId;
            await ingestion.ingestDetail(owner, id, { messages: [{ id: 'message', role: 'assistant',
                content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Actual exported body' }] }] }], assets: [],
                quality: { status: 'complete' }, savedAt: 1000 }, { title, titleSource: 'provider', updatedAt: 1000 });
        }
        await window.ui.app.updateSettings({ language: 'en', tourAutoHandled: true, lastSeenFeatureVersion: '1.8.1' });
    }, { accountId, otherId });
    return { page, errors, close: () => context.close() };
}

test('Options entrypoint initializes against v2 IDB, preserves opaque IDs and sparse preferences', { timeout: 20000 }, async () => {
    const view = await surface();
    try {
        await view.page.addScriptTag({ content: optionsBundle });
        await view.page.waitForSelector('#list .item');
        assert.equal(await view.page.locator('#list .item').count(), 1);
        assert.equal(await view.page.locator('#list .item').getAttribute('data-chat-id'), 'c_opaque');
        await view.page.locator('#includeZip').uncheck();
        await view.page.waitForFunction(() => window.testSettings.gemini_exporter_v2_settings.useZip === false);
        assert.deepEqual(await view.page.evaluate(() => Object.keys(window.testSettings)), ['gemini_exporter_v2_settings']);
        assert.deepEqual(view.errors, []);
        await view.page.selectOption('#accountIdSelect', otherId);
        await view.page.waitForFunction(() => document.querySelector('#list .item')?.getAttribute('data-chat-id') === 'other');
        assert.equal(await view.page.locator('#list input:checked').count(), 0);
    } finally { await view.close(); }
});

test('Popup uses unified delivery, writes an actual export Record, and rejects stale tab binding', { timeout: 20000 }, async () => {
    const view = await surface('popup');
    try {
        await view.page.addScriptTag({ content: popupBundle });
        await view.page.waitForFunction(() => !document.getElementById('btnCurrent').disabled);
        const downloadEvent = view.page.waitForEvent('download');
        await view.page.click('#btnCurrent');
        const download = await downloadEvent;
        const file = await download.path();
        assert.ok(download.suggestedFilename().endsWith('.zip'));
        const Zip = require('../lib/jszip.min.js');
        const zip = await Zip.loadAsync(readFileSync(file));
        const text = await zip.file(Object.keys(zip.files).find(name => name.endsWith('.md'))).async('string');
        assert.match(text, /Actual exported body/);
        await view.page.waitForFunction(async id => (await window.ui.storage.getExportRecord({ accountId: id, conversationId: 'c_opaque' }))?.status === 'ok', accountId);
        await view.page.evaluate(() => { window.failBinding = true; });
        await view.page.click('#btnCurrent');
        await view.page.waitForFunction(() => document.getElementById('btnCurrent').disabled);
        assert.match(await view.page.locator('#log').innerText(), /Account unavailable/);
        assert.deepEqual(view.errors, []);
    } finally { await view.close(); }
});

test('JSON/HTML/Markdown use Application; partial resources remain visible and cancel holds the lock', { timeout: 20000 }, async () => {
    const view = await surface();
    try {
        const result = await view.page.evaluate(async accountId => {
            const ui = window.ui;
            const key = { accountId, conversationId: 'c_opaque' };
            // JSON/HTML/Markdown all pass through real L2 → AST → renderer → delivery → Record.
            const formats = [];
            for (const format of ['json', 'html', 'markdown']) {
                const result = await ui.exporting.runExport({ accountId, selected: ['c_opaque'], format, useZip: true, skip: false }, {});
                formats.push({ format, exported: result.exportedCount, record: await ui.storage.getExportRecord(key) });
            }
            await ui.ingestion.ingestDetail(accountId, 'c_opaque', { messages: [{ id: 'm', role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'image', assetId: 'missing', alt: 'Missing resource' }] }] }],
                assets: [{ id: 'missing', kind: 'image' }], quality: { status: 'complete' }, savedAt: 2000 }, { updatedAt: 2000 });
            window.holdExport = true;
            const pending = ui.exporting.runExport({ accountId, selected: ['c_opaque'], format: 'markdown', useZip: true }, {});
            await new Promise(resolve => { const timer = setInterval(() => { if (window.releaseExport) { clearInterval(timer); resolve(); } }, 1); });
            ui.exporting.abort();
            const locked = ui.exporting.isRunning();
            const aborted = window.exportSignal.aborted;
            window.releaseExport();
            const cancelled = await pending;
            window.holdExport = false;
            const partial = await ui.exporting.runExport({ accountId, selected: ['c_opaque'], format: 'markdown', useZip: true }, {});
            let mismatch;
            try { await ui.exporting.runExport({ accountId, selected: [{ id: 'other', key: { accountId: '10000000-0000-4000-8000-000000000002', conversationId: 'other' } }] }, {}); }
            catch (error) { mismatch = error.message; }
            return { formats, locked, aborted, cancelled, partial, finalLock: ui.exporting.isRunning(), mismatch };
        }, accountId);
        assert.deepEqual(result.formats.map(item => [item.format, item.exported, item.record.status, item.record.format]),
            [['json', 1, 'ok', 'json'], ['html', 1, 'ok', 'html'], ['markdown', 1, 'ok', 'markdown']]);
        assert.equal(result.locked, true); assert.equal(result.aborted, true);
        assert.equal(result.cancelled.aborted, true); assert.equal(result.finalLock, false);
        assert.equal(result.partial.partial, 1); assert.equal(result.partial.exportedCount, 1);
        assert.match(result.mismatch, /another account/);
    } finally { await view.close(); }
});

test('scan provider limit, max_pages, HTTP429 and cancellation retain distinct outcomes', { timeout: 20000 }, async () => {
    const view = await surface();
    try {
        const results = await view.page.evaluate(async accountId => {
            const ui = window.ui;
            const run = () => new Promise(resolve => ui.scanning.startSync(accountId, {
                onFinished: result => resolve(result), onError: (_error, message, details) => resolve({ message, ...details })
            }));
            const waitIdle = async () => { while (ui.scanning.isScanning()) await new Promise(resolve => setTimeout(resolve, 0)); };
            const results = [];
            for (const end of ['source_end', 'provider_limit', 'max_pages']) {
                window.providerEnd = end;
                results.push(await run()); await waitIdle();
            }
            window.providerError = 'HTTP 429'; results.push(await run()); await waitIdle();
            window.providerError = ''; window.holdScan = true;
            const pending = run();
            while (!window.releaseScan) await new Promise(resolve => setTimeout(resolve, 0));
            ui.scanning.stopScan(accountId);
            const locked = ui.scanning.isScanning(), aborted = window.scanSignal.aborted;
            window.releaseScan(); results.push(await pending); await waitIdle();
            return { results, locked, aborted };
        }, accountId);
        assert.deepEqual(results.results.map(item => [item.res.status, item.hitGoogleLimit]),
            [['complete', false], ['partial_limit', true], ['partial_limit', false], ['error', false], ['aborted', false]]);
        assert.equal(results.locked, true); assert.equal(results.aborted, true);
    } finally { await view.close(); }
});

test('Live Save intent survives format/permission pauses; guidance is marked only when displayed', { timeout: 20000 }, async () => {
    const view = await surface();
    try {
        const result = await view.page.evaluate(async () => {
            const ui = window.ui;
            await ui.app.updateSettings({ enabledDisk: true, defaultFormat: 'pdf' });
            document.getElementById('format').value = 'pdf';
            await ui.optionsSettings.initLiveSaveSettings();
            const toggle = document.getElementById('liveSaveDiskToggle');
            const paused = { checked: toggle.checked, disabled: toggle.disabled, intent: (await ui.app.getSettings()).enabledDisk };
            document.getElementById('format').value = 'markdown';
            ui.optionsSettings.updateLiveSaveFormatAvailability();
            const resumed = { checked: toggle.checked, disabled: toggle.disabled };
            await ui.optionsTakeout.maybePromptTakeout(999, false);
            const noFalsePrompt = document.getElementById('takeoutLimitModal').style.display !== 'flex';
            document.getElementById('takeoutLimitModal').remove();
            await ui.dialogs.showTakeoutLimitPrompt({ hitGoogleLimit: true });
            const absent = (await ui.app.getSettings()).takeoutPromptCompleted;
            return { paused, resumed, noFalsePrompt, absent };
        });
        assert.deepEqual(result.paused, { checked: true, disabled: true, intent: true });
        assert.deepEqual(result.resumed, { checked: true, disabled: false });
        assert.equal(result.noFalsePrompt, true); assert.equal(result.absent, undefined);
        assert.deepEqual(view.errors, []);
    } finally { await view.close(); }
});

test('Takeout Controller imports accepted facts and does not mark an unsuccessful file selection complete', { timeout: 20000 }, async () => {
    const view = await surface();
    try {
        const result = await view.page.evaluate(async accountId => {
            const ui = window.ui;
            await ui.storage.putAccount({ id: accountId, providerId: 'gemini', providerAccountId: 'takeout-user' });
            ui.store.setCurrentAccountId(accountId);
            const zip = new window.JSZip();
            zip.file('Takeout/Gemini Apps/MyActivity.html', '<div class="outer-cell"><div class="content-cell">Prompted Import test<br>Sep 2, 2026, 12:00:00 PM UTC<br><a href="https://gemini.google.com/app/import_chat_123">Details</a><p>Answer</p></div></div>');
            const file = new File([await zip.generateAsync({ type: 'uint8array' })], 'takeout.zip');
            let imported, failure;
            await ui.takeout.handleTakeoutImport(new File(['invalid'], 'invalid.zip'), { onError: error => { failure = error.message; } });
            const afterFailure = (await ui.app.getSettings()).takeoutPromptCompleted;
            await ui.takeout.handleTakeoutImport(file, { onFinished: result => { imported = result; } });
            return { failure, afterFailure, imported, completed: (await ui.app.getSettings()).takeoutPromptCompleted,
                indexes: (await ui.storage.listIndexes(accountId)).map(row => row.key.conversationId) };
        }, accountId);
        assert.ok(result.failure); assert.equal(result.afterFailure, undefined);
        assert.equal(result.imported.res.imported, 1); assert.equal(result.completed, true);
        assert.ok(result.indexes.includes('import_chat_123'));
    } finally { await view.close(); }
});

test('Badge saves only a completed drag into shared Settings, without webpage localStorage', { timeout: 20000 }, async () => {
    const view = await surface();
    try {
        await view.page.evaluate(() => {
            const badge = window.ui.badge.ensureBadge();
            Object.assign(badge.style, { position: 'fixed', left: '40px', top: '40px', width: '110px', height: '34px', zIndex: '999999' });
        });
        await view.page.mouse.move(60, 50); await view.page.mouse.down();
        await view.page.mouse.move(160, 150);
        await view.page.evaluate(() => window.ui.badge.ensureBadge());
        const inProgress = await view.page.evaluate(() => window.testSettings.gemini_exporter_v2_settings.badgePosition);
        assert.equal(inProgress, undefined);
        await view.page.mouse.up();
        await view.page.waitForFunction(() => !!window.testSettings.gemini_exporter_v2_settings.badgePosition);
        const position = await view.page.evaluate(() => window.testSettings.gemini_exporter_v2_settings.badgePosition);
        assert.deepEqual(position, { left: 140, top: 140 });
        const afterCancel = await view.page.evaluate(async () => {
            const element = document.getElementById('geminiExportBadge');
            element.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 150, clientY: 150, pointerId: 4 }));
            element.dispatchEvent(new PointerEvent('pointermove', { clientX: 180, clientY: 180, pointerId: 4 }));
            element.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 4 }));
            window.dispatchEvent(new Event('resize'));
            await new Promise(resolve => setTimeout(resolve, 0));
            return { position: (await window.ui.app.getSettings()).badgePosition, localKeys: Object.keys(localStorage) };
        });
        assert.deepEqual(afterCancel, { position, localKeys: [] });
    } finally { await view.close(); }
});

test('Tour records actual first display; finishing a manual tour never advances feature watermark', { timeout: 20000 }, async () => {
    const view = await surface();
    try {
        const result = await view.page.evaluate(async () => {
            const ui = window.ui;
            delete window.testSettings.gemini_exporter_v2_settings.tourAutoHandled;
            await ui.app.updateSettings({ lastSeenFeatureVersion: '1.0.0' });
            await ui.tour.startTour(0);
            const displayed = !!document.querySelector('.tour-overlay-container');
            const handled = (await ui.app.getSettings()).tourAutoHandled;
            await ui.tour.finishTour();
            await ui.tour.startFeatureSpotlight('unknown-step', '9.0.0');
            return { displayed, handled, watermark: (await ui.app.getSettings()).lastSeenFeatureVersion,
                unknownVisible: !!document.querySelector('.tour-overlay-container') };
        });
        assert.deepEqual(result, { displayed: true, handled: true, watermark: '1.0.0', unknownVisible: false });
    } finally { await view.close(); }
});

test('Options keeps partial exports selected and ignores a completed folder picker after account switch', { timeout: 20000 }, async () => {
    const view = await surface();
    try {
        const result = await view.page.evaluate(async ({ accountId, otherId }) => {
            const ui = window.ui;
            ui.store.setCurrentAccountId(accountId);
            await ui.store.loadStore();
            await ui.optionsExport.init({ loadStore: () => ui.store.loadStore() });
            ui.list.render(ui.store.getConversations(), {}, new Set(['c_opaque']));
            await ui.ingestion.ingestDetail(accountId, 'c_opaque', { messages: [{ role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'image', assetId: 'missing', alt: 'image' }] }] }],
                assets: [{ id: 'missing', kind: 'image' }], quality: { status: 'complete' }, savedAt: 2000 }, { updatedAt: 2000 });
            const selected = [{ ...ui.store.getConversations()[0], id: 'c_opaque' }];
            await ui.optionsExport.startExportPipeline(selected, 'markdown', false, false, true, true, null);
            const partialMessage = document.getElementById('progText').textContent;
            const stillSelected = [...ui.list.getSelectedIds()];
            await ui.storage.deleteExportRecord({ accountId, conversationId: 'c_opaque' });
            let release;
            ui.__setModuleOverride('DirHandleController', {
                requestDirHandle: () => new Promise(resolve => { release = resolve; }), getDirHandle: () => null
            });
            const pending = ui.optionsExport.startExportPipeline(selected, 'markdown', false, false, true, false, null);
            ui.store.setCurrentAccountId(otherId);
            release({ name: 'Folder' });
            await pending;
            return { partialMessage, stillSelected,
                afterSwitch: await ui.storage.getExportRecord({ accountId, conversationId: 'c_opaque' }),
                otherRecords: await ui.storage.listExportRecords(otherId) };
        }, { accountId, otherId });
        assert.match(result.partialMessage, /Partial exports: 1/);
        assert.deepEqual(result.stillSelected, ['c_opaque']);
        assert.equal(result.afterSwitch, null); assert.deepEqual(result.otherRecords, {});
    } finally { await view.close(); }
});

test('a busy guidance modal cannot swallow export; folder suggestion is invocation-only', { timeout: 20000 }, async () => {
    const view = await surface();
    try {
        const result = await view.page.evaluate(async accountId => {
            const ui = window.ui;
            ui.store.setCurrentAccountId(accountId);
            await ui.ingestion.ingestIndexes(accountId, [{ conversationId: 'second', fields: { updatedAt: 1000 } }]);
            await ui.store.loadStore();
            await ui.optionsExport.init();
            const requests = [];
            ui.__setModuleOverride('GeminiConstants', { DIRECT_WRITE_THRESHOLD: 1 });
            ui.__setModuleOverride('ExportController', { async runExport(request) { requests.push(request); return { exportedCount: 0, skipped: 2 }; } });
            ui.__setModuleOverride('DirHandleController', { getDirHandle: () => null, async requestDirHandle() { return { name: 'Folder' }; } });
            const select = () => ui.list.render(ui.store.getConversations(), {}, new Set(['c_opaque', 'second']));
            select();
            document.getElementById('takeoutImportModal').style.display = 'flex';
            await ui.optionsExport.exportSelected();
            const afterBusy = (await ui.app.getSettings()).directWritePromptShown;
            document.getElementById('takeoutImportModal').style.display = 'none';
            select();
            const pending = ui.optionsExport.exportSelected();
            while (document.getElementById('directWriteModal').style.display !== 'flex') await new Promise(resolve => setTimeout(resolve, 0));
            document.getElementById('btnModalSwitchFolder').click();
            await pending;
            return { requests: requests.map(request => ({ useZip: request.useZip, accountId: request.accountId })), afterBusy,
                settings: await ui.app.getSettings() };
        }, accountId);
        assert.deepEqual(result.requests, [{ useZip: true, accountId }, { useZip: false, accountId }]);
        assert.equal(result.afterBusy, undefined);
        assert.equal(result.settings.directWritePromptShown, true);
        assert.equal(result.settings.useZip, true);
    } finally { await view.close(); }
});
