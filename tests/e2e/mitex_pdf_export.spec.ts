/**
 * Full MV3 v2 MiTeX/PDF integration: native L2 Detail -> L3a -> Application
 * -> L3b -> L4 MiTeX + Typst sandbox -> browser download + ExportRecord.
 * No v1 chrome.storage.local conversation arrays or __mitex UI debug hooks.
 */
import { test, expect, seedRegistryAccounts } from './fixtures';
import { openOptions, seedConversations, accountId, exposeUIStorage } from './uiFixture';
import { extractPdfText } from '../helpers/pdfTextExtract';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
const JSZip = require(path.resolve(__dirname, '../../lib/jszip.min.js'));

let mitexBundle: string;
test.beforeAll(async () => {
    const built = await build({
        stdin: {
            resolveDir: path.resolve(__dirname, '../..'), loader: 'ts',
            contents: "import { initMitexWasm, isMitexReady, convertMathWithMitex } from './src/l4/format/typst/mathConverter.ts';" +
                'globalThis.mitexV2Probe = { initMitexWasm, isMitexReady, convertMathWithMitex };',
        },
        bundle: true, write: false, format: 'iife', platform: 'browser',
    });
    mitexBundle = built.outputFiles[0].text;
});
test.beforeEach(async ({ context }) => { await seedRegistryAccounts(context); });

const formulas = [
    '\\int_0^\\infty e^{-x} dx = 1',
    '\\frac{\\sqrt{x^2 + 1}}{2}',
    '\\begin{cases} 1 & x > 0 \\\\ 0 & x \\le 0 \\end{cases}',
];

for (const denied of [false, true]) {
    test(denied ? 'v2 PDF exports math offline when local fonts are denied'
        : 'v2 PDF uses real MiTeX and Typst sandbox with no external HTTP requests',
    async ({ context, extensionId }) => {
        test.setTimeout(120000);
        const remoteRequests: string[] = [];
        await context.route(/^https?:\/\//, async route => {
            remoteRequests.push(route.request().url());
            await route.abort();
        });
        const page = await openOptions(context, extensionId);
        await page.evaluate(mitexBundle);

        // The actual L4 module owns MiTeX initialization; UI exposes no math debug global.
        const math = await page.evaluate(async expressions => {
            const api = Reflect.get(globalThis, 'mitexV2Probe');
            await api.initMitexWasm();
            return {
                ready: api.isMitexReady(),
                converted: expressions.map((source: string) => api.convertMathWithMitex(source, 'latex', true)),
            };
        }, formulas);
        expect(math.ready).toBe(true);
        for (const converted of math.converted) {
            expect(converted.typst).toBeTruthy();
            expect(converted.diagnostic).toBeUndefined();
        }

        const conversationId = denied ? 'mitex_denied' : 'mitex_allowed';
        await page.evaluate(async ({ accountId, conversationId, expressions, denied }) => {
            const api = Reflect.get(globalThis, 'uiFixture');
            await api.ingestDetail(accountId, conversationId, {
                savedAt: 1700000000000, quality: { status: 'complete' }, assets: [],
                messages: [
                    { role: 'user', content: [{ type: 'paragraph', children: [
                        { type: 'text', text: denied ? 'Calculate the integral' : 'Show me the Gaussian integral' },
                    ] }] },
                    { role: 'assistant', content: [
                        { type: 'paragraph', children: [{ type: 'text', text: 'MiTeX math in the production PDF:' }] },
                        ...expressions.map((source: string) => ({ type: 'math', source })),
                    ] },
                ],
            }, {
                title: denied ? 'Math without local fonts' : 'MiTeX PDF integration',
                titleSource: 'provider', updatedAt: 1700000000000,
            });
        }, { accountId, conversationId, expressions: formulas, denied });
        await page.reload();
        await exposeUIStorage(page);
        await expect(page.locator('#list .item')).toHaveCount(1);

        if (denied) {
            await page.evaluate(() => {
                (window as any).__deniedFontQueries = 0;
                const originalQuery = navigator.permissions.query.bind(navigator.permissions);
                navigator.permissions.query = (async descriptor => descriptor.name === ('local-fonts' as PermissionName)
                    ? { state: 'denied' } : originalQuery(descriptor)) as typeof navigator.permissions.query;
                (window as any).queryLocalFonts = async () => {
                    (window as any).__deniedFontQueries++;
                    throw new DOMException('User denied Local Font Access', 'NotAllowedError');
                };
            });
        }

        await page.locator('#format').selectOption('pdf');
        await page.locator('#btnSelectAll').click();
        const downloadPromise = page.waitForEvent('download', { timeout: 90000 });
        await page.locator('#btnExport').click();
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toMatch(/\.pdf$/);
        const bytes = await readFile((await download.path())!);
        expect(bytes.length).toBeGreaterThan(1000);
        expect(bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
        await expect.poll(async () => page.evaluate(async ({ accountId, conversationId }) =>
            Reflect.get(globalThis, 'uiFixture').getExportRecord({ accountId, conversationId }),
        { accountId, conversationId })).toMatchObject({ format: 'pdf', status: 'ok' });

        if (denied) {
            expect(await page.evaluate(() => (window as any).__deniedFontQueries)).toBe(0); // Denied fonts must never be queried or block export.
            await readFile((await download.path())!); // Final artifact remains readable without permission.
        }
        expect(remoteRequests).toEqual([]);
    });
}

test('sandbox page compiles a minimal template to PDF with zero external requests', async ({ context, extensionId }) => {
    test.setTimeout(90000);
    const extOrigin = `chrome-extension://${extensionId}`;
    const page = await context.newPage();

    const remoteRequests: string[] = [];
    await page.route(/^https?:\/\//, async route => {
        remoteRequests.push(route.request().url());
        await route.abort();
    });

    await page.goto(`${extOrigin}/src/ui/options/options.html`);

    const result = await page.evaluate(
        async (urls: { sandbox: string; wasm: string; font: string }) => {
            const nextJob = () => (crypto as Crypto).randomUUID
                ? (crypto as Crypto).randomUUID()
                : `job-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            const ready = new Promise<void>(resolve => {
                const onMessage = (event: MessageEvent) => {
                    if (event.source !== iframe.contentWindow || event.origin !== 'null') return;
                    const data = event.data as { type?: string };
                    if (data && data.type === 'typst/ready') {
                        window.removeEventListener('message', onMessage);
                        resolve();
                    }
                };
                window.addEventListener('message', onMessage);
            });
            iframe.src = urls.sandbox;
            document.documentElement.appendChild(iframe);
            await ready;

            const post = <T>(message: Record<string, unknown>, transfer?: Transferable[]): Promise<T> =>
                new Promise<T>((resolve, reject) => {
                    const jobId = message.jobId as string;
                    const timer = window.setTimeout(() => reject(new Error(`timeout waiting for ${message.type}`)), 60000);
                    const onMessage = (event: MessageEvent) => {
                        if (event.source !== iframe.contentWindow || event.origin !== 'null') return;
                        const data = event.data as { type?: string; jobId?: string };
                        if (!data || data.jobId !== jobId) return;
                        if (data.type === 'typst/compiled' || data.type === 'typst/inited') {
                            window.clearTimeout(timer);
                            window.removeEventListener('message', onMessage);
                            resolve(data as T);
                        } else if (data.type === 'typst/error') {
                            window.clearTimeout(timer);
                            window.removeEventListener('message', onMessage);
                            const err = (data as { error?: { message?: string } }).error;
                            reject(new Error(`sandbox error: ${err?.message ?? 'unknown'}`));
                        }
                    };
                    window.addEventListener('message', onMessage);
                    iframe.contentWindow!.postMessage(message, '*', transfer ?? []);
                });

            const fetchBytes = async (url: string): Promise<ArrayBuffer> => {
                const res = await fetch(url);
                if (!res.ok) throw new Error(`fetch ${url}: HTTP ${res.status}`);
                return res.arrayBuffer();
            };

            const wasm = await fetchBytes(urls.wasm);
            const initJob = nextJob();
            const inited = await post<{ type: string; ok: boolean; initMs: number }>(
                { type: 'typst/init', jobId: initJob, wasm },
                [wasm],
            );
            if (!inited.ok) throw new Error('sandbox init reported ok=false');

            const font = await fetchBytes(urls.font);
            const payload = {
                schemaVersion: 1,
                title: 'P1b sandbox smoke',
                profile: { id: 'pdf', version: 1 },
                metadata: 'gemini · 2026-09-26 · 1 messages',
                layout: {
                    page: { widthMm: 210, heightMm: 297, topMm: 18.5, bottomMm: 18, sideMm: 22, contentWidthMm: 166, proseWidthMm: 166 * 720 / 880 },
                    bubble: { maxWidthRatio: 0.85, compactHeightPt: 120, minInnerWidthPt: 28, paddingXPt: 12.5, paddingYPt: 8.4 },
                    figure: { maxPageHeightRatio: 0.6, captionMaxWidthMm: 115 },
                    textLanguage: 'zh', headerGapPt: 4.5, bodyGapPt: 22.5,
                },
                messages: [{
                    id: 'm1',
                    variant: 'bubble', minWidthCards: [], gapAfterPt: 0,
                    blocks: [{
                        type: 'paragraph',
                        layout: { gapBeforePt: 0, keepWithNext: false, width: 'container' },
                        children: [{ type: 'text', text: 'hello from the sandbox smoke test' }],
                    }],
                }],
            };
            const compileJob = nextJob();
            const compiled = await post<{
                type: string;
                ok: boolean;
                pdf: ArrayBuffer | null;
                pdfBytes: number;
                diagnostics: Array<{ severity: string; message: string }>;
            }>(
                {
                    type: 'typst/compile',
                    jobId: compileJob,
                    files: [{ path: '/payload.json', text: JSON.stringify(payload) }],
                    binaries: [],
                    fonts: [font],
                },
                [font],
            );
            iframe.remove();
            const header = compiled.pdf
                ? String.fromCharCode(...new Uint8Array(compiled.pdf).slice(0, 5))
                : null;
            return { ok: compiled.ok, pdfBytes: compiled.pdfBytes, pdfHeader: header };
        },
        {
            sandbox: `${extOrigin}/src/l4/format/pdf/sandbox/typst-compile.html`,
            wasm: `${extOrigin}/src/l4/format/pdf/sandbox/vendor/typst_ts_web_compiler_bg.wasm`,
            font: `${extOrigin}/src/l4/format/pdf/sandbox/fonts/NewCMMath-Regular.otf`,
        },
    );

    expect(result.ok).toBe(true);
    expect(result.pdfHeader).toBe('%PDF-');
    expect(result.pdfBytes).toBeGreaterThan(1000);
    expect(remoteRequests).toEqual([]);
});

test('one PDF batch survives sandbox rotation with all physical documents and text intact', async ({ context, extensionId }) => {
    test.setTimeout(120000);
    const remoteRequests: string[] = [];
    await context.route(/^https?:\/\//, async route => { remoteRequests.push(route.request().url()); await route.abort(); });
    const page = await openOptions(context, extensionId);
    await seedConversations(page, Array.from({ length: 33 }, (_, index) => ({
        id: `batch_${index}`, title: `Batch lifecycle ${index}`,
        body: `Retained answer marker ${index}.`, question: `Retained question marker ${index}.`,
    })));
    await page.evaluate(() => {
        Object.defineProperty(window, 'queryLocalFonts', { configurable: true,
            value: async () => { throw new DOMException('Denied for test', 'NotAllowedError'); } });
    });
    let sandboxes = 0;
    page.on('framenavigated', frame => { if (frame.url().includes('/sandbox/typst-compile.html')) sandboxes++; });
    await page.locator('#format').selectOption('pdf');
    await expect(page.locator('body')).toHaveAttribute('data-busy', 'false');
    await page.locator('#skipExported').uncheck();
    await expect(page.locator('body')).toHaveAttribute('data-busy', 'false');
    await page.locator('#btnSelectAll').click();
    const downloaded = page.waitForEvent('download', { timeout: 90000 });
    await page.locator('#btnExport').click();
    await expect(page.locator('#directWriteModal')).toBeVisible();
    await expect(page.locator('#directWritePromptText')).toContainText('33 conversations');
    await page.locator('#btnModalContinueZip').click();
    const download = await downloaded;
    const zip = await JSZip.loadAsync(await readFile((await download.path())!));
    const documents = Object.values(zip.files).filter((file: unknown) => {
        const entry = file as { dir: boolean; name: string };
        return !entry.dir && entry.name.endsWith('.pdf');
    }) as Array<{ async(type: string): Promise<Uint8Array> }>;
    expect(documents).toHaveLength(33);
    const text: string[] = [];
    for (const document of documents) {
        const bytes = await document.async('uint8array');
        expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe('%PDF-');
        text.push(extractPdfText(bytes).text);
    }
    for (let index = 0; index < 33; index++) {
        expect(text.filter(value => value.includes(`Retained answer marker ${index}.`))).toHaveLength(1);
        expect(text.filter(value => value.includes(`Retained question marker ${index}.`))).toHaveLength(1);
    }
    await expect(page.locator('body')).toHaveAttribute('data-busy', 'false');
    expect(sandboxes).toBe(2);
    expect(remoteRequests).toEqual([]);
});
