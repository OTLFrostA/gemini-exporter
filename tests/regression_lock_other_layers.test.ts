import { acquiredReply } from './helpers/acquisitionFixture.js';
import { indexFixture as canonicalIndex } from './helpers/indexFixture.js';
const canonicalList = (value: any): any => Array.isArray(value) ? value.map(canonicalIndex) : value;
import { withRegistry } from './helpers/registryMock.js';
import { accountRuntime, ACCOUNT_OBSERVATION } from './helpers/accountRuntime.js';
import { useIndexStorage } from './helpers/indexStorage.js';
useIndexStorage();
const { historicalFixture } = require('./helpers/nativeFixture.js');
const { extractImages } = require('./helpers/recordFixture/attachments.js');
const { decodeGeminiDetail } = require('../src/core/parsers/gemini/rpc/detailDecoder.js');
const { isRealTitle } = require('../src/core/parsers/gemini/rpc/extractors.js');
export {};

/**
 * tests/regression_lock.test.ts
 * Consolidated regression locks for P0/P1/P2 issues and bug repros.
 * Merged from:
 *   - audit_p0_p2_fixes.test.ts
 *   - audit_p0_v143_regression.test.ts
 *   - bug_repro_critical.test.ts
 *   - perf_p1_p2_regression.test.ts
 *   - regression_p0.test.ts
 *   - p0_regression_lock.test.ts
 *
 * @retire-when: unknown — needs owner
 *   (per-test locks retire when the guarded behavior is covered by a permanent
 *   contract test; see tests/README.md §五)
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { __setModuleOverride, __getModuleOverride } = require('../src/core/utils/moduleOverrides.js');

const SRC = path.join(__dirname, '..', 'src');
const Proto = require('../src/core/protocol/protocol.js');
const Extractors = require('../src/core/parsers/gemini/rpc/extractors.js');
const StorageService = require('../src/core/storage/storageService.js');
const TabService = require('../src/core/utils/tabService.js');
const GeminiUtils = require('../src/core/utils/utils.js');
const ListView = require('../src/ui/views/listView.js');
const ExportEngineMod = require('../src/core/engine/exportEngine.js');
const { ExportEngine } = ExportEngineMod;
const AssetPipeline = require('../src/core/engine/assetPipeline.js');
const AssetFetcherModule = require('../src/content/assetFetcher.js');
const TakeoutEngine = require('../src/core/engine/takeoutEngine.js');

// ---------------------------------------------------------------- helpers & mocks

function readSrc(relPath: string) {
    const fullJs = path.join(__dirname, relPath);
    if (fs.existsSync(fullJs)) return fs.readFileSync(fullJs, 'utf8');
    const fullTs = fullJs.replace(/\.js$/, '.ts');
    if (fs.existsSync(fullTs)) return fs.readFileSync(fullTs, 'utf8');
    return fs.readFileSync(fullJs, 'utf8');
}

function makeChromeStorage() {
    const data: Record<string, any> = {};
    return {
        data,
        storage: {
            local: {
                get: async (keys: any) => {
                    await Promise.resolve();
                    const keyList = Array.isArray(keys) ? keys : [keys];
                    const out: Record<string, any> = {};
                    for (const k of keyList) {
                        if (Object.prototype.hasOwnProperty.call(data, k)) {
                            out[k] = JSON.parse(JSON.stringify(data[k]));
                        }
                    }
                    return out;
                },
                set: async (items: any) => {
                    await Promise.resolve();
                    for (const [k, v] of Object.entries(items)) {
                        data[k] = JSON.parse(JSON.stringify(v));
                    }
                },
                remove: async (keys: any) => {
                    const keyList = Array.isArray(keys) ? keys : [keys];
                    for (const k of keyList) delete data[k];
                }
            },
            session: {
                get: async () => ({}),
                set: async () => {},
                remove: async () => {}
            }
        }
    };
}

const zipCaptures: [any, any][] = [];

class FakeJSZip {
    folder() {
        return {
            file: (name: any, content: any) => zipCaptures.push([name, content])
        };
    }
    async generateAsync(_opts?: any, onMeta?: any) {
        if (onMeta) onMeta({ percent: 100 });
        return { type: 'blob', size: 1 };
    }
}

class FakeAssetPipeline {
    constructor(_opts?: any) {}
    async processAsset(item: any, _chat?: any, _meta?: any) {
        return { ok: true as const, resourceId: item.assetId, value: { path: item.localName || item.fileName || 'asset.bin' } };
    }
}

async function runExport(chatDetail: any, { useFakePipeline = false }: { useFakePipeline?: boolean } = {}) {
    zipCaptures.length = 0;
    const origChrome = (global as any).chrome;
    const origJSZip = __getModuleOverride('JSZip');
    const origPipeline = __getModuleOverride('AssetPipeline');
    const origTab = __getModuleOverride('TabService');

    const chromeMock = makeChromeStorage();
    (global as any).chrome = withRegistry(chromeMock);
    __setModuleOverride('JSZip', FakeJSZip);
    if (useFakePipeline) __setModuleOverride('AssetPipeline', FakeAssetPipeline);
    else __setModuleOverride('AssetPipeline', undefined);

    __setModuleOverride('TabService', {
        sendToGeminiTab: async (msg: any) => {
            assert.strictEqual(msg.action, 'getConversationDetail');
            return acquiredReply({ success: true, domainEnvelopeVersion: 3, data: historicalFixture(chatDetail) });
        }
    });

    try {
        const onItemExportedCalls: any[] = [];
        const engine = new ExportEngine();
        const result = await engine.run(
            {
                selected: [{ id: chatDetail.id, title: chatDetail.title }],
                useZip: true,
                includeAssets: true,
                includeIndex: false,
                accountId: '10000000-0000-4000-8000-000000000001',
                conversations: [],
                downloadHandler: async () => {}
            },
            {
                onItemExported: (id: any, rec: any) => onItemExportedCalls.push({ id, rec }),
                onLog: () => {},
                onProgress: () => {},
                onTitleUpdated: () => {}
            }
        );
        // finalizeChatExport is fire-and-forget; poll until its storage chain
        // lands instead of a fixed sleep (flaky on slow machines).
        const deadline = Date.now() + 2000;
        for (;;) {
            const ids = await StorageService.getExportedIds('10000000-0000-4000-8000-000000000001');
            if (ids[chatDetail.id] || ids['c_' + chatDetail.id]) break;
            if (Date.now() > deadline) break;
            await new Promise(r => setTimeout(r, 10));
        }
        const exportedIds = await StorageService.getExportedIds('10000000-0000-4000-8000-000000000001');
        return { result, onItemExportedCalls, exportedIds, chromeData: chromeMock.data };
    } finally {
        (global as any).chrome = origChrome;
        __setModuleOverride('JSZip', origJSZip);
        __setModuleOverride('AssetPipeline', origPipeline);
        __setModuleOverride('TabService', origTab);
    }
}

test('p0-lock: conversation without assets is finalized exactly once and its record persisted', async () => {
    const chat = {
        id: 'aaaa1111bbbb2222',
        title: 'Plain Chat',
        timestamp: 1700000000000,
        messages: [
            { role: 'user', content: 'hi', timestamp: 1700000000000 },
            { role: 'model', content: 'hello', timestamp: 1700000000001 }
        ]
    };
    const { result, onItemExportedCalls, exportedIds } = await runExport(chat);
    assert.strictEqual(result.landedChats, 1, 'chat text must be exported');
    assert.strictEqual(onItemExportedCalls.length, 1, 'finalizeChatExport must fire exactly once');
    assert.ok(
        exportedIds['aaaa1111bbbb2222'] || exportedIds['c_aaaa1111bbbb2222'],
        'export record must be persisted to exportedIds'
    );
});


test('p0-lock: ZIP-mode contentMarkdown attachment no longer swallows the export record', async () => {
    const chat = {
        id: 'cccc3333dddd4444',
        title: 'Doc Chat',
        timestamp: 1700000000000,
        messages: [
            {
                role: 'model',
                content: 'doc answer',
                timestamp: 1700000000001,
                attachments: [{
                    type: 'file',
                    url: 'https://example.file/download',
                    contentMarkdown: 'embedded doc body',
                    localName: 'assets/doc.md',
                    fileName: 'doc.md'
                }]
            }
        ]
    };
    const { result, onItemExportedCalls, exportedIds } = await runExport(chat);
    assert.strictEqual(result.landedChats, 1, 'chat text must be exported');
    assert.ok(
        zipCaptures.some(([name]) => String(name).includes('doc.md')),
        'contentMarkdown attachment must be written into the ZIP'
    );
    assert.strictEqual(onItemExportedCalls.length, 1, 'finalizeChatExport must fire exactly once');
    assert.ok(
        exportedIds['cccc3333dddd4444'] || exportedIds['c_cccc3333dddd4444'],
        'export record must be persisted even when the only asset is a ZIP-inline contentMarkdown'
    );
});


test('p0-lock: staged image asset finalizes exactly once via the queue (no duplicate finalize)', async () => {
    const chat = {
        id: 'eeee5555ffff6666',
        title: 'Image Chat',
        timestamp: 1700000000000,
        messages: [
            {
                role: 'model',
                content: 'generated image',
                timestamp: 1700000000001,
                images: [{ url: 'https://lh3.example/img', fileName: 'img1.jpg', localName: 'assets/img1.jpg' }]
            }
        ]
    };
    const { result, onItemExportedCalls, exportedIds } = await runExport(chat, { useFakePipeline: true });
    assert.strictEqual(result.downloadedAssets, 1, 'image asset must be downloaded');
    assert.strictEqual(onItemExportedCalls.length, 1, 'finalizedChatsSet must prevent duplicate finalize');
    assert.ok(
        exportedIds['eeee5555ffff6666'] || exportedIds['c_eeee5555ffff6666'],
        'export record must be persisted after the asset completes'
    );
});

// Failed resource settlement and finalization are exercised against real ZIPs in resource-delivery.test.ts.


test('regression: export_engine sanitizeZipPath must sanitize .. and preserve segments', () => {
    assert.strictEqual(typeof ExportEngineMod.sanitizeZipPath, 'function', 'sanitizeZipPath should be exported');
    assert.strictEqual(ExportEngineMod.sanitizeZipPath('a/../b'), 'a/_/b');
    const san1 = ExportEngineMod.sanitizeZipPath('files/abc_../a.md');
    assert.ok(!san1.includes('..'), `san1 should not contain .., got ${san1}`);
    assert.ok(san1.startsWith('files/'), 'should preserve prefix');
    const sanitized = ExportEngineMod.sanitizeZipPath('files/../../etc/passwd');
    assert.ok(!sanitized.includes('..'), `sanitized should not contain .., got ${sanitized}`);
    assert.ok(sanitized.split('/').every((seg: string) => seg !== '..' && seg !== '.'), 'no dot segments');
    assert.strictEqual(ExportEngineMod.sanitizeZipPath('assets/ab1234_image-1.jpg'), 'assets/ab1234_image-1.jpg');
});


test('regression: export_engine must throw on batchDirHandle creation failure instead of fallback', () => {
    const content = readSrc('../src/core/engine/export/exportOrchestrator.js');
    assert.ok(content.includes('throw new Error(`无法创建导出子目录') || content.includes('throw new ExportPipelineError(`无法创建导出子目录'), 'should throw on directory creation failure');
    assert.ok(!content.includes('batchDirHandle = dirHandle;') || content.includes('throw new Error') || content.includes('throw new ExportPipelineError'), 'should not silently fallback to root dirHandle');
});



test('regression: export_engine getExtensionVersion should be exported and read manifest', () => {
    assert.strictEqual(typeof ExportEngineMod.getExtensionVersion, 'function');
    const v = ExportEngineMod.getExtensionVersion();
    assert.ok(typeof v === 'string' && v.length >= 5, `version should be string, got ${v}`);
});



test('regression: stop sync must sync window flag and active client', () => {
    const clientContent = readSrc('../src/core/api/geminiClient.js');
    const contentContent = readSrc('../src/content/content.js') + readSrc('../src/content/messageRouter.js') + readSrc('../src/content/contentContext.js');
    assert.ok(clientContent.includes('window.__gemExporterAborted') && clientContent.includes('isAborted'), 'gemini_client should check window abort flag');
    assert.ok(contentContent.includes('__gemExporterActiveClient'), 'content should store active client');
    assert.ok(
        contentContent.includes("typeof active?.abort === 'function'") ||
        contentContent.includes('__gemExporterActiveClient && window.__gemExporterActiveClient.abort()') ||
        contentContent.includes('w.__gemExporterActiveClient && w.__gemExporterActiveClient.abort()'),
        'stopDeepScan should abort active client'
    );
});


test('regression: empty cloud response must be logged as error with debug', () => {
    const expContent = readSrc('../src/core/engine/export/exportOrchestrator.js');
    assert.ok(expContent.includes("'error'") && expContent.includes('logExportSkipped'), 'empty should be error level');
    assert.ok(expContent.includes('debug: evidence._debug') && expContent.includes('raw: transport.decodedPayload'), 'failedChats should carry debug/raw');
    const bgContent = readSrc('../src/background/background.js') + readSrc('../src/background/batchFetcher.js');
    assert.ok(bgContent.includes('_debug'), 'background should preserve _raw debug');
});

// ============================================================================
// Section 2: Protocol, Sniffing & Hook Credentials
// ============================================================================


test('audit fix: saveExportRecord serializes concurrent writes without losing records', async () => {
    const memoryStorage: Record<string, any> = {};
    const origChrome = (global as any).chrome;
    (global as any).chrome = withRegistry({
        storage: {
            local: {
                get: async (keys: any) => {
                    const res: Record<string, any> = {};
                    const keyList = Array.isArray(keys) ? keys : [keys];
                    for (const k of keyList) {
                        if (memoryStorage[k]) res[k] = JSON.parse(JSON.stringify(memoryStorage[k]));
                    }
                    return res;
                },
                set: async (items: any) => {
                    await new Promise(r => setTimeout(r, Math.random() * 5));
                    for (const [k, v] of Object.entries(items)) {
                        memoryStorage[k] = JSON.parse(JSON.stringify(v));
                    }
                }
            }
        }
    });

    try {
        const promises: Promise<any>[] = [];
        for (let i = 1; i <= 10; i++) {
            promises.push(StorageService.saveExportRecord('10000000-0000-4000-8000-000000000001', `chat_${i}`, { title: `Chat ${i}`, exportedAt: new Date().toISOString() }));
        }
        await Promise.all(promises);

        const saved = await StorageService.getExportedIds('10000000-0000-4000-8000-000000000001');
        for (let i = 1; i <= 10; i++) {
            assert.ok(saved[`chat_${i}`], `Record chat_${i} must not be lost due to concurrent read-modify-write`);
        }
    } finally {
        (global as any).chrome = origChrome;
    }
});


test('audit fix: tabService strictly isolates non-u0 slots without silent cross-slot fallback', async () => {
    const origChrome = (global as any).chrome;
    (global as any).chrome = withRegistry({
        tabs: {
            query: async () => [
                { id: 1, url: 'https://gemini.google.com/app/1', active: false },
                { id: 2, url: 'https://gemini.google.com/u/0/app/1', active: true }
            ]
        }
    });

    try {
        const tabU1 = await TabService.getGeminiTab('10000000-0000-4000-8000-000000000002');
        assert.strictEqual(tabU1, null, 'getGeminiTab(u1) should return null when no u1 tab is open, avoiding u0 fallback');

        await assert.rejects(
            async () => {
                await TabService.sendToGeminiTab({ action: 'ping' }, '10000000-0000-4000-8000-000000000002');
            },
            /matches the selected account/,
            'sendToGeminiTab(u1) should reject when no u1 tab exists'
        );
    } finally {
        (global as any).chrome = origChrome;
    }
});


test('P1 regression: AssetPipeline requests native ArrayBuffer (preferBuffer: true) to prevent Base64 OOM', async () => {
    let capturedMessage: any = null;
    const origChrome = (global as any).chrome;
    (global as any).chrome = withRegistry({
        tabs: {
            sendMessage: (_tabId: any, message: any, callback: any) => {
                capturedMessage = message;
                callback({ success: true, dataBuffer: new ArrayBuffer(16) });
            }
        },
        runtime: { lastError: null }
    });

    try {
        const pipeline = new AssetPipeline({
            accountId: '10000000-0000-4000-8000-000000000001',
            getGeminiTab: async () => ({ id: 12345 }),
            useZip: true,
            writer: { writeFile: async () => 'test.png' }
        });

        const item = { assetId: 'test-asset', url: 'https://lh3.googleusercontent.com/test.png', fileName: 'test.png' };
        const chat = { id: 'c_test123' };

        await pipeline.processAsset(item, chat, { isImage: true });

        assert.ok(capturedMessage, 'chrome.tabs.sendMessage must be called');
        assert.strictEqual(capturedMessage.action, 'downloadAssetDirect');
        assert.strictEqual(
            capturedMessage.preferBuffer,
            true,
            'P1 fix: AssetPipeline must send preferBuffer: true so that assetFetcher transmits ArrayBuffer instead of Base64'
        );
    } finally {
        (global as any).chrome = origChrome;
    }
});


test('assetFetcher - downloadAssetDirect hard caps > 50MB blob and rejects immediately', async () => {
    const downloadAssetDirect = AssetFetcherModule.downloadAssetDirect ||
        (AssetFetcherModule.AssetFetcher && AssetFetcherModule.AssetFetcher.downloadAssetDirect);

    assert.ok(typeof downloadAssetDirect === 'function', 'downloadAssetDirect function must exist');

    const oldFetch = (global as any).fetch;
    let fallbackCalled = false;
    try {
        const oversizedBytes = 51 * 1024 * 1024;
        (global as any).fetch = async () => ({
            ok: true,
            status: 200,
            headers: new Map([['content-type', 'application/octet-stream']]),
            blob: async () => ({
                size: oversizedBytes,
                type: 'application/octet-stream',
                arrayBuffer: async () => { fallbackCalled = true; return new ArrayBuffer(0); }
            })
        });

        let response: any = null;
        await downloadAssetDirect({ url: 'https://example.com/oversized_file.bin' }, (resp: any) => {
            response = resp;
        });

        assert.ok(response, 'Response must be received');
        assert.strictEqual(response.success, false, 'Direct download of >50MB asset must return success: false');
        assert.ok(response.error && response.error.includes('asset too large'), 'Error message must specify asset too large');
        assert.ok(response.error.includes('Google Takeout'), 'Error message must guide user to Google Takeout');
        assert.strictEqual(fallbackCalled, false, 'Must not attempt to read arrayBuffer/toDataUrl on oversized blob');
    } finally {
        (global as any).fetch = oldFetch;
    }
});


// ============================================================================
// Section 6: UI, DOM Fallback Safety & Release Packaging
// ============================================================================


test('audit fix: listView escapes URL properly to prevent attribute injection', () => {
    const mockList = { innerHTML: '', addEventListener: () => {} };
    const origDoc = (global as any).document;
    (global as any).document = {
        getElementById: (id: string) => id === 'list' ? mockList : null
    };

    try {
        ListView.render(canonicalList([
            {
                id: 'test_xss',
                title: 'Test XSS Chat',
                url: 'https://gemini.google.com/app/test" onclick="alert(1)'
            }
        ] as any), {}, new Set());

        assert.ok(mockList.innerHTML.includes('href="https://gemini.google.com/app/test_xss"'), 'Source URL comes only from canonical identity');
        assert.ok(!mockList.innerHTML.includes('href="https://gemini.google.com/app/test" onclick="alert(1)"'), 'Raw double quote breakout must be prevented');
    } finally {
        (global as any).document = origDoc;
    }
});


// Retired active Content detail-fetch/DOM-shell fallback source-string locks are
// superseded by L1 source/parser contracts and p1_a_regressions behavior
// contracts: L1 accepts supplied native evidence; Content has no active fetch port.

test('regression: background Receiving end error must hint refresh', () => {
    const bfTsPath = path.join(__dirname, '../src/background/batchFetcher.ts');
    const bgPath = fs.existsSync(bfTsPath)
        ? bfTsPath
        : path.join(__dirname, '../src/background/background.js');
    const bgContent = fs.readFileSync(bgPath, 'utf8');
    assert.ok(bgContent.includes('Receiving end does not exist'), 'should handle Receiving end');
    assert.ok(bgContent.includes('刷新 gemini.google.com'), 'should hint refresh after reload');
});


test('release workflow - release package excludes TypeScript source and sourcemaps', () => {
    const buildPath = path.join(__dirname, '../build.js');
    const buildContent = fs.readFileSync(buildPath, 'utf8');
    const workflowPath = path.join(__dirname, '../.github/workflows/release.yml');
    const workflowContent = fs.readFileSync(workflowPath, 'utf8');

    // SSoT: build.js defines the exact packaging rules
    assert.ok(buildContent.includes("src -x 'src/*.ts'"), "build.js must exclude src/*.ts");
    assert.ok(buildContent.includes("'src/*/*/*/*.ts'"), "build.js must exclude nested .ts files");
    assert.ok(buildContent.includes("'dist/background/background.js'"), 'build.js must include background.js bundle');
    assert.ok(buildContent.includes("'dist/content/content.js'"), 'build.js must include content.js bundle');
    assert.ok(buildContent.includes("'dist/content/hook.js'"), 'build.js must include hook.js bundle');
    assert.ok(buildContent.includes("'dist/ui/options.js'"), 'build.js must include options.js bundle');
    assert.ok(buildContent.includes("'dist/ui/popup.js'"), 'build.js must include popup.js bundle');

    // release.yml delegates packaging to npm run package SSoT
    assert.ok(workflowContent.includes('npm run package'), 'release.yml must delegate packaging to npm run package');
    assert.ok(workflowContent.includes("      - 'v*'"), 'release workflow must trigger only from version tags');
    assert.ok(workflowContent.includes('ref: ${{ github.sha }}'), 'tag pushes must checkout the event commit');
    assert.ok(!workflowContent.includes('workflow_dispatch'), 'release must not expose manual version-management modes');
    assert.ok(!workflowContent.includes('bump_patch') && !workflowContent.includes('bump_minor') && !workflowContent.includes('custom_tag'), 'release workflow must not manage versions or tags');
    assert.ok(!workflowContent.includes('git push') && !workflowContent.includes('git tag'), 'release workflow must not modify or push main or tags');
    assert.ok(workflowContent.includes('run: npm ci'), 'release dependencies must install with npm ci only');
    const browserInstall = workflowContent.indexOf('npx playwright install --with-deps chromium');
    const testGate = workflowContent.indexOf('npm test');
    assert.ok(browserInstall >= 0 && browserInstall < testGate, 'Chromium and system dependencies must install before npm test');
    assert.ok(workflowContent.includes('npm test'), 'the full test gate must run before packaging');
    assert.ok(workflowContent.includes('Tag ($VERSION), manifest.json ($MANIFEST_VERSION), and package.json ($PACKAGE_VERSION) versions must match.'), 'tag and source versions must be validated');
    assert.ok(workflowContent.includes('ZIP_SHA256=$(sha256sum "$ZIP_NAME"'), 'the verified release ZIP must have a recorded SHA-256');
    assert.ok(workflowContent.includes('uses: softprops/action-gh-release@v2'), 'the validated ZIP must be attached to a GitHub Release');
    const githubRelease = workflowContent.indexOf('uses: softprops/action-gh-release@v2');
    const storeCredentials = workflowContent.indexOf('name: Check Chrome Web Store credentials');
    const storeUpload = workflowContent.indexOf('uses: mnao305/chrome-extension-upload@v7.0.0');
    assert.ok(githubRelease >= 0 && storeCredentials > githubRelease && storeUpload > storeCredentials, 'store publishing must run after the GitHub Release and credential check');
    assert.ok(workflowContent.includes('CWS_PUBLISHER_ID: ${{ secrets.CHROME_PUBLISHER_ID }}'), 'publisher ID must be required by the credential check');
    assert.ok(workflowContent.includes('|| -z "$CWS_PUBLISHER_ID"'), 'missing publisher ID must fail the credential check');
    assert.ok(workflowContent.includes('publisher-id: ${{ secrets.CHROME_PUBLISHER_ID }}'), 'the v7 upload action must receive the publisher ID');
    assert.ok(workflowContent.includes('Chrome Web Store credentials are incomplete; refusing to finish the release.'), 'missing store credentials must fail the workflow');
    assert.ok(workflowContent.includes('file-path: ${{ steps.package.outputs.name }}'), 'the store must upload the verified release ZIP');
    assert.ok(workflowContent.includes('files: ${{ steps.package.outputs.name }}'), 'GitHub Release must use the same verified ZIP as the store');
    assert.ok(workflowContent.includes('name: Verify ZIP before Chrome Web Store upload'), 'the artifact digest must be rechecked before store upload');
    assert.ok(workflowContent.includes('          publish: true'), 'store upload must submit a publish request');
    assert.ok(!workflowContent.includes('continue-on-error: true'), 'store upload failures must fail the workflow');
});


test('architecture doc - all referenced src/ file paths must exist on disk', () => {
    const docPath = path.join(__dirname, '../docs/architecture.md');
    const docContent = fs.readFileSync(docPath, 'utf8');

    // Extract all `src/.../*.ts` file references from architecture.md
    const matches = docContent.matchAll(/`src\/([^`]+\.ts)`/g);
    const referencedFiles: string[] = [];
    for (const m of matches) {
        referencedFiles.push(m[1]);
    }

    assert.ok(referencedFiles.length > 0, 'architecture.md should contain source references');

    const missingFiles: string[] = [];
    for (const relPath of referencedFiles) {
        const fullPath = path.join(__dirname, '../src', relPath);
        if (!fs.existsSync(fullPath)) {
            missingFiles.push(`src/${relPath}`);
        }
    }

    assert.deepStrictEqual(
        missingFiles,
        [],
        `The following files referenced in docs/architecture.md do not exist on disk:\n${missingFiles.join('\n')}`
    );
});


test('src/README.md - all referenced files in source tree must exist on disk', () => {
    const docPath = path.join(__dirname, '../src/README.md');
    const docContent = fs.readFileSync(docPath, 'utf8');

    // Extract all file names matching *.ts, *.d.ts, *.css, *.html
    const fileMatches = docContent.matchAll(/([a-zA-Z0-9_-]+(?:\.d)?\.(?:ts|css|html))/g);
    const referencedFiles = new Set<string>();
    for (const m of fileMatches) {
        referencedFiles.add(m[1]);
    }

    assert.ok(referencedFiles.size > 0, 'src/README.md should contain source references');

    const missingFiles: string[] = [];
    for (const fileName of referencedFiles) {
        let found = false;
        const findRecursive = (dir: string) => {
            if (found) return;
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (found) return;
                if (entry.isDirectory()) {
                    findRecursive(path.join(dir, entry.name));
                } else if (entry.name === fileName) {
                    found = true;
                    return;
                }
            }
        };
        findRecursive(path.join(__dirname, '../src'));
        if (!found) {
            missingFiles.push(fileName);
        }
    }

    assert.deepStrictEqual(
        missingFiles,
        [],
        `The following files referenced in src/README.md do not exist on disk:\n${missingFiles.join('\n')}`
    );
});
