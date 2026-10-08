const { historicalFixture } = require('./helpers/nativeFixture.js');
/**
 * tests/pdf-image-hydration.test.ts
 *
 * Regression suite for PDF binary image asset hydration via AssetPipeline:
 * 1. Remote Gemini image (RPC-style with pre-populated localName, URL-only
 *    attachment, and standalone inline Markdown remote image):
 *    - injected fetchAsset returns known PNG bytes
 *    - preparePdfItem succeeds without writing standalone assets/... files
 *    - prepared image resource contains the acquired bytes
 *    - prepared resources return the exact PNG bytes
 *    - resourceStage mounts the image and payloadStage emits { type: 'image' }
 *      with zero 'missing-image' unsupported blocks
 * 2. Takeout fallback:
 *    - network fetch fails
 *    - takeoutEngine fallback returns bytes
 *    - PDF receives and mounts the image without 'missing-image'
 * 3. Acquisition failure:
 *    - both network fetch and Takeout fallback fail
 *    - export does not crash and still writes the PDF
 *    - prepared resource carries failureReason without bytes
 *      (never PSEUDO_AVAILABLE even when localName was pre-populated by parseDetail)
 *    - resourceStage + payloadStage preserve the existing 'missing-image'
 *      fallback block and warning diagnostics
 * 4. Abort during asset acquisition:
 *    - aborting while fetchAsset is in flight stops acquisition immediately
 *      and marks PdfExporter.run as aborted with zero files written
 */
export {};
const test = require('node:test');
const assert = require('node:assert');

const { preparePdfItem } = require('../src/core/export/pdf/prepareItem.js');
const { PdfExporter } = require('../src/core/export/pdf/index.js');
const { resourceStage } = require('../src/core/export/pdf/pipeline/resourceStage.js');
const { payloadStage } = require('../src/core/export/pdf/pipeline/payloadStage.js');
const { TypstSandboxCompiler } = require('../src/core/export/typst/typstSandboxCompiler.js');
const { StubPdfCompiler } = require('./helpers/stubPdfCompiler.js');
const { RealWasmSandboxHost, repoRoot } = require('./helpers/realWasmSandbox.js');
const { extractPdfText } = require('./helpers/pdfTextExtract.js');

// 1x1 transparent PNG (70 bytes)
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_BYTES = new Uint8Array(Buffer.from(PNG_B64, 'base64'));

function makeStageCtx(signal = new AbortController().signal) {
    return {
        signal,
        reportProgress: (_stage: string, _current: number, _total: number) => {},
        log: (_msg: string, _level?: string) => {},
    };
}

function makeFakeWriter() {
    const files: Array<{ name: string; bytes: Uint8Array }> = [];
    return {
        files,
        written: 0,
        async writeFile(relativePath: string, content: any) {
            const bytes = content instanceof Uint8Array
                ? content
                : new TextEncoder().encode(String(content));
            files.push({ name: relativePath, bytes });
            this.written++;
            return relativePath;
        },
        async generateBlob() {
            return new Blob(files.map((f) => f.bytes as any), { type: 'application/zip' });
        },
    };
}

test('1a. Remote Gemini RPC image (with pre-populated localName): hydrates bytes into prepared resources, mounts in resourceStage, and produces zero missing-image blocks', async () => {
    const remoteUrl = 'https://lh3.googleusercontent.com/gg-dl/AOI_d_test_martian_cat=s0-rj';
    const rawChat = {
        id: 'chat-martian-cat',
        title: 'Martian Astronaut Cat Drinking Coffee',
        messages: [
            {
                id: 'u1',
                role: 'user',
                content: 'Generate an image of an astronaut cat on Mars.',
            },
            {
                id: 'm1',
                role: 'model',
                content: 'Here is your astronaut cat on Mars:',
                attachments: [
                    {
                        type: 'image',
                        name: 'watermarked_img_1.png',
                        localName: 'assets/040ffd_watermarked_img_1.png',
                        src: remoteUrl,
                        resolvedUrl: remoteUrl,
                        mime: 'image/png',
                        isGenerated: true,
                        modelName: 'Imagen 3',
                    },
                ],
            },
        ],
    };

    const fetchedUrls: string[] = [];
    const prepared = await preparePdfItem(
        { id: rawChat.id, title: rawChat.title },
        {
            conversations: [rawChat], fetchChatDetail: async (item: { id: string }) => ({ success: true, results: [historicalFixture(([rawChat]).find((row: { id: string }) => row.id.replace(/^c_/, '') === item.id.replace(/^c_/, '')) || {})] }),
            fetchAsset: async (req: any) => {
                fetchedUrls.push(typeof req === 'string' ? req : req.url);
                return {
                    success: true,
                    mime: 'image/png',
                    dataBase64: PNG_B64,
                };
            },
        },
    );

    assert.strictEqual(prepared.ok, true, 'preparePdfItem must succeed');
    if (!prepared.ok) return;

    assert.deepStrictEqual(fetchedUrls, [remoteUrl], 'AssetPipeline must fetch the remote Gemini image URL once');
    // Caller's rawChat must not be mutated in place
    assert.strictEqual((rawChat.messages[1].attachments![0] as any).dataBuffer, undefined, 'caller conversation object must not be mutated');

    const { document, resources } = prepared;
    const entries = [...resources].map(([id, resource]: any) => ({ id, ...resource }));
    assert.strictEqual(entries.length, 1, 'one prepared image resource is registered');
    const imgAsset = entries[0];
    assert.ok(imgAsset.bytes?.length);
    assert.ok(!('storageRef' in imgAsset), 'prepared bytes do not inherit export paths');

    const storedBytes = imgAsset.bytes;
    assert.ok(storedBytes instanceof Uint8Array, 'prepared resource must contain Uint8Array bytes');
    assert.deepStrictEqual(Buffer.from(storedBytes!), Buffer.from(PNG_BYTES), 'stored bytes must match fetched PNG bytes');

    const ctx = makeStageCtx();
    const s2 = await resourceStage({ document, resources }, ctx);

    assert.strictEqual(s2.output.unresolved.length, 0, 'no unresolved assets in resourceStage');
    assert.strictEqual(s2.output.mounts.length, 1, 'resourceStage must produce 1 mount');
    assert.ok(s2.output.pathMap.has(imgAsset.id), 'pathMap must contain the image asset ID');
    assert.deepStrictEqual(
        Buffer.from(s2.output.mounts[0].bytes),
        Buffer.from(PNG_BYTES),
        'mounted bytes must match fetched PNG bytes',
    );

    const s3 = await payloadStage(
        { document, pathMap: s2.output.pathMap, locale: 'zh' },
        ctx,
    );
    const modelMsg = s3.output.payload.messages.find((m: any) => m.variant === 'flow');
    assert.ok(modelMsg, 'assistant message present in Typst payload');
    const imageBlocks = modelMsg.blocks.filter((b: any) => b.type === 'image');
    const missingBlocks = modelMsg.blocks.filter(
        (b: any) => b.type === 'unknown' && b.sourceType === 'missing-image',
    );
    assert.strictEqual(imageBlocks.length, 1, 'Typst payload must contain the resolved image block');
    assert.strictEqual(missingBlocks.length, 0, 'Typst payload must NOT contain any missing-image block');
    assert.ok(
        !s3.diagnostics.some((d: any) => d.code === 'TYPST_V8_IMAGE_MISSING'),
        'payloadStage must emit zero TYPST_V8_IMAGE_MISSING diagnostics',
    );
});

test('1b. Remote URL-only attachment and standalone Markdown remote image: content-addresses into prepared resources and mounts without writing standalone assets/... files', async () => {
    const remoteAttUrl = 'https://lh3.googleusercontent.com/gg-dl/AOI_d_url_only=s0';
    const remoteInlineUrl = 'https://lh3.googleusercontent.com/gg-dl/AOI_d_inline_md=s0';
    const rawChat = {
        id: 'chat-url-only',
        title: 'URL Only + Inline Markdown Remote Image',
        messages: [
            {
                id: 'm1',
                role: 'model',
                content: `Inline remote image:\n\n![Cryo-ET PSF](${remoteInlineUrl})`,
                attachments: [
                    {
                        type: 'image',
                        name: 'companion.png',
                        src: remoteAttUrl,
                    },
                ],
            },
        ],
    };

    const writer = makeFakeWriter();
    const resolvedMountAssets: any[] = [];
    let capturedPayload: any = null;
    const compiler = {
        name: 'spy-stub-compiler',
        async compile(payload: any, compileCtx: any) {
            capturedPayload = payload;
            for (const assetId of payload.assetPaths.keys()) {
                const resolved = await compileCtx.assets.resolve(assetId);
                if (resolved) resolvedMountAssets.push(resolved);
            }
            const stub = new StubPdfCompiler();
            return stub.compile(payload, compileCtx);
        },
    };

    const exporter = new PdfExporter(compiler as any);
    const result = await exporter.run(
        {
            selected: [{ id: rawChat.id, title: rawChat.title }],
            conversations: [rawChat], fetchChatDetail: async (item: { id: string }) => ({ success: true, results: [historicalFixture(([rawChat]).find((row: { id: string }) => row.id.replace(/^c_/, '') === item.id.replace(/^c_/, '')) || {})] }),
            useZip: false,
            writer,
            fetchAsset: async () => ({
                success: true,
                mime: 'image/png',
                dataBuffer: PNG_BYTES.buffer.slice(
                    PNG_BYTES.byteOffset,
                    PNG_BYTES.byteOffset + PNG_BYTES.byteLength,
                ),
            }),
        },
        {},
    );

    assert.strictEqual(result.succeeded, 1);
    assert.strictEqual(writer.files.length, 1, 'only the single .pdf file is written to the writer (no standalone assets/ files)');
    assert.ok(writer.files[0].name.endsWith('.pdf'));

    assert.strictEqual(resolvedMountAssets.length, 2, 'both the inline Markdown remote image and companion attachment must be mounted');
    const msg = capturedPayload.document.messages[0];
    const blocks = msg.blocks;
    const missingBlocks = blocks.filter((b: any) => b.type === 'unknown' && b.sourceType === 'missing-image');
    const imageBlocks = blocks.filter((b: any) => b.type === 'image');
    const inlineImages = blocks
        .filter((b: any) => b.type === 'paragraph' && Array.isArray(b.children))
        .flatMap((b: any) => b.children)
        .filter((c: any) => c.type === 'image' && c.asset);
    assert.strictEqual(missingBlocks.length, 0, 'zero missing-image blocks');
    assert.strictEqual(imageBlocks.length, 1, 'attachment image rendered as top-level image block');
    assert.strictEqual(inlineImages.length, 1, 'inline Markdown remote image rendered with resolved asset path');
});

test('2. Takeout fallback: when network fetch fails, Takeout fallback provides bytes and PDF mounts the image', async () => {
    const remoteUrl = 'https://lh3.googleusercontent.com/gg-dl/AOI_d_expired_url=s0';
    const rawChat = {
        id: 'chat-takeout-fallback',
        title: 'Takeout Fallback Conversation',
        messages: [
            {
                id: 'u1',
                role: 'user',
                content: 'Draw a diagram.',
            },
            {
                id: 'm1',
                role: 'model',
                content: 'Here is the diagram:',
                attachments: [
                    {
                        type: 'image',
                        name: 'watermarked_img.png',
                        localName: 'assets/b0c0e2_watermarked_img.png',
                        src: remoteUrl,
                        resolvedUrl: remoteUrl,
                    },
                ],
            },
        ],
    };

    let takeoutFallbackCalls = 0;
    const fakeTakeoutEngine = {
        getTakeoutMediaForChat: () => null,
        getTakeoutFallbackMedia: async (_chatId: string, _localName: string, _slot: string) => {
            takeoutFallbackCalls++;
            return PNG_BYTES;
        },
    };

    const prepared = await preparePdfItem(
        { id: rawChat.id, title: rawChat.title },
        {
            conversations: [rawChat], fetchChatDetail: async (item: { id: string }) => ({ success: true, results: [historicalFixture(([rawChat]).find((row: { id: string }) => row.id.replace(/^c_/, '') === item.id.replace(/^c_/, '')) || {})] }),
            maxAssetRetries: 0,
            takeoutEngine: fakeTakeoutEngine,
            fetchAsset: async () => ({
                success: false,
                error: 'HTTP 403 Forbidden',
            }),
        },
    );

    assert.strictEqual(prepared.ok, true);
    if (!prepared.ok) return;
    assert.strictEqual(takeoutFallbackCalls, 1, 'Takeout fallback must be consulted after network fetch fails');

    const { document, resources } = prepared;
    const entries = [...resources].map(([id, resource]: any) => ({ id, ...resource }));
    assert.strictEqual(entries.length, 1);
    const imgAsset = entries[0];
    assert.ok(imgAsset.bytes?.length);
    assert.ok(imgAsset.bytes);
    assert.deepStrictEqual(
        Buffer.from(imgAsset.bytes!),
        Buffer.from(PNG_BYTES),
    );

    const ctx = makeStageCtx();
    const s2 = await resourceStage({ document, resources }, ctx);
    assert.strictEqual(s2.output.mounts.length, 1, 'Takeout fallback image must be mounted');
    assert.strictEqual(s2.output.unresolved.length, 0);

    const s3 = await payloadStage(
        { document, pathMap: s2.output.pathMap, locale: 'zh' },
        ctx,
    );
    const modelMsg = s3.output.payload.messages.find((m: any) => m.variant === 'flow');
    assert.strictEqual(
        modelMsg.blocks.filter((b: any) => b.type === 'image').length,
        1,
        'Takeout fallback image must render as an image block',
    );
    assert.strictEqual(
        modelMsg.blocks.filter((b: any) => b.type === 'unknown' && b.sourceType === 'missing-image').length,
        0,
        'zero missing-image blocks when Takeout fallback succeeds',
    );
});

test('2b. PDF does not invent ownership for detached Takeout media', async () => {
    const input = historicalFixture({ id: 'chat-detached-media', messages: [
        { role: 'user', content: 'Generate an astronaut cat.' },
        { role: 'model', content: 'Here is your astronaut cat:' },
    ] });
    let acquired = 0;
    const prepared = await preparePdfItem(input, { takeoutEngine: {
        getTakeoutMediaForChat: () => [{ filename: 'detached.png', isGenerated: true }],
        getTakeoutFallbackMedia: async () => { acquired++; return PNG_BYTES; },
    } });
    assert.equal(prepared.ok, true);
    assert.equal(prepared.resources.size, 0);
    assert.equal(acquired, 0);
});

test('3. Acquisition failure: when both network fetch and Takeout fallback fail, export does not crash and preserves missing-image fallback + diagnostics', async () => {
    const remoteUrl = 'https://lh3.googleusercontent.com/gg-dl/AOI_d_dead_link=s0';
    const rawChat = {
        id: 'chat-dead-image',
        title: 'Dead Image Conversation',
        messages: [
            {
                id: 'm1',
                role: 'model',
                content: 'Image below:',
                attachments: [
                    {
                        type: 'image',
                        name: 'dead_img.png',
                        localName: 'assets/dead_img.png',
                        src: remoteUrl,
                        resolvedUrl: remoteUrl,
                    },
                ],
            },
        ],
    };

    const fakeTakeoutEngine = {
        getTakeoutMediaForChat: () => null,
        getTakeoutFallbackMedia: async () => null,
    };

    const prepared = await preparePdfItem(
        { id: rawChat.id, title: rawChat.title },
        {
            conversations: [rawChat], fetchChatDetail: async (item: { id: string }) => ({ success: true, results: [historicalFixture(([rawChat]).find((row: { id: string }) => row.id.replace(/^c_/, '') === item.id.replace(/^c_/, '')) || {})] }),
            maxAssetRetries: 0,
            takeoutEngine: fakeTakeoutEngine,
            fetchAsset: async () => ({
                success: false,
                error: 'HTTP 404 Not Found',
            }),
        },
    );

    assert.strictEqual(prepared.ok, true, 'preparePdfItem must not crash when image acquisition fails');
    if (!prepared.ok) return;

    const { document, resources } = prepared;
    const entries = [...resources].map(([id, resource]: any) => ({ id, ...resource }));
    assert.strictEqual(entries.length, 1);
    const imgAsset = entries[0];
    assert.equal(imgAsset.bytes, undefined, 'failed acquisition cannot claim mountable bytes');
    assert.ok(imgAsset.failureReason && imgAsset.failureReason.includes('HTTP 404'), 'failureReason must record the acquisition error');

    const ctx = makeStageCtx();
    const s2 = await resourceStage({ document, resources }, ctx);
    assert.strictEqual(s2.output.mounts.length, 0);
    assert.strictEqual(s2.output.unresolved.length, 1);
    assert.ok(
        s2.diagnostics.some((d: any) => d.severity === 'warning' || d.severity === 'error'),
        'resourceStage must emit warning+ diagnostic for the unresolved image asset',
    );

    const s3 = await payloadStage(
        { document, pathMap: s2.output.pathMap, locale: 'zh' },
        ctx,
    );
    const blocks = s3.output.payload.messages[0].blocks;
    const missingBlocks = blocks.filter((b: any) => b.type === 'unknown' && b.sourceType === 'missing-image');
    assert.strictEqual(missingBlocks.length, 1, 'payloadStage must emit the missing-image unknown block');
    assert.ok(
        s3.diagnostics.some((d: any) => d.code === 'TYPST_V8_IMAGE_MISSING' && d.severity === 'warning'),
        'payloadStage must emit TYPST_V8_IMAGE_MISSING warning',
    );

    // Full PdfExporter.run still succeeds and writes the fallback PDF
    const writer = makeFakeWriter();
    const exporter = new PdfExporter(new StubPdfCompiler());
    const runRes = await exporter.run(
        {
            selected: [{ id: rawChat.id, title: rawChat.title }],
            conversations: [rawChat], fetchChatDetail: async (item: { id: string }) => ({ success: true, results: [historicalFixture(([rawChat]).find((row: { id: string }) => row.id.replace(/^c_/, '') === item.id.replace(/^c_/, '')) || {})] }),
            useZip: false,
            writer,
            maxAssetRetries: 0,
            takeoutEngine: fakeTakeoutEngine,
            fetchAsset: async () => ({ success: false, error: 'HTTP 404 Not Found' }),
        },
        {},
    );
    assert.strictEqual(runRes.succeeded, 1, 'PDF export still succeeds with missing-image fallback');
    assert.strictEqual(writer.files.length, 1);
});

test('4. Abort during asset acquisition stops immediately and writes no files', async () => {
    const remoteUrl = 'https://lh3.googleusercontent.com/gg-dl/AOI_d_slow_image=s0';
    const rawChat = {
        id: 'chat-abort-hydration',
        title: 'Abort During Asset Hydration',
        messages: [
            {
                id: 'm1',
                role: 'model',
                content: '![Slow](assets/slow.png)',
                attachments: [
                    {
                        type: 'image',
                        name: 'slow.png',
                        localName: 'assets/slow.png',
                        src: remoteUrl,
                    },
                ],
            },
        ],
    };

    const writer = makeFakeWriter();
    const exporter = new PdfExporter(new StubPdfCompiler());

    let fetchStartedResolve!: () => void;
    const fetchStarted = new Promise<void>((r) => { fetchStartedResolve = r; });

    const runPromise = exporter.run(
        {
            selected: [{ id: rawChat.id, title: rawChat.title }],
            conversations: [rawChat], fetchChatDetail: async (item: { id: string }) => ({ success: true, results: [historicalFixture(([rawChat]).find((row: { id: string }) => row.id.replace(/^c_/, '') === item.id.replace(/^c_/, '')) || {})] }),
            useZip: false,
            writer,
            fetchAsset: async () => {
                fetchStartedResolve();
                await new Promise((r) => setTimeout(r, 500));
                return { ok: true, mime: 'image/png', dataBase64: PNG_B64 };
            },
        },
        {},
    );

    await fetchStarted;
    exporter.abort();

    const result = await runPromise;
    assert.strictEqual(result.aborted, true, 'run must report aborted');
    assert.strictEqual(result.succeeded, 0, 'no item marked succeeded');
    assert.strictEqual(writer.files.length, 0, 'no PDF file written after abort');
});

test('5. End-to-end real Typst WASM compile: PdfExporter mounts relative resourceStage virtual path into sandbox and embeds image XObject', async () => {
    const remoteUrl = 'https://lh3.googleusercontent.com/gg-dl/AOI_d_real_wasm_cat=s0-rj';
    const rawChat = {
        id: 'chat-real-wasm-cat',
        title: 'Martian Cat Real WASM Compile',
        messages: [
            {
                id: 'u1',
                role: 'user',
                content: 'Render an astronaut cat on Mars.',
            },
            {
                id: 'm1',
                role: 'model',
                content: 'Here is the generated image:',
                attachments: [
                    {
                        type: 'image',
                        name: 'watermarked_img_1.png',
                        localName: 'assets/040ffd_watermarked_img_1.png',
                        src: remoteUrl,
                        resolvedUrl: remoteUrl,
                        mime: 'image/png',
                        isGenerated: true,
                        modelName: 'Imagen 3',
                    },
                ],
            },
        ],
    };

    const host = new RealWasmSandboxHost(repoRoot());
    const compiler = new TypstSandboxCompiler({ host });
    const writer = makeFakeWriter();

    try {
        const exporter = new PdfExporter(compiler);
        const result = await exporter.run(
            {
                selected: [{ id: rawChat.id, title: rawChat.title }],
                conversations: [rawChat], fetchChatDetail: async (item: { id: string }) => ({ success: true, results: [historicalFixture(([rawChat]).find((row: { id: string }) => row.id.replace(/^c_/, '') === item.id.replace(/^c_/, '')) || {})] }),
                useZip: false,
                writer,
                fetchAsset: async () => ({
                    success: true,
                    mime: 'image/png',
                    dataBase64: PNG_B64,
                }),
            },
            {},
        );

        assert.strictEqual(result.succeeded, 1, 'real Typst WASM compile must succeed');
        assert.strictEqual(result.failed.length, 0);
        assert.strictEqual(writer.files.length, 1, 'only the single PDF file is written');

        const pdfBytes = writer.files[0].bytes;
        assert.strictEqual(Buffer.from(pdfBytes.slice(0, 5)).toString('latin1'), '%PDF-');

        const extracted = extractPdfText(pdfBytes);
        assert.strictEqual(extracted.imageXObjectCount, 1, 'compiled PDF must contain 1 embedded image XObject');
        assert.ok(!extracted.text.includes('missing-image'), 'compiled PDF text must not contain missing-image');
    } finally {
        compiler.dispose();
    }
});



test('PDF preparation refuses duplicate message IDs before entering the pipeline', async () => {
    const chat = { id: 'duplicate', title: 'Duplicate', messages: [
        { id: 'same', role: 'user', content: 'one' }, { id: 'same', role: 'model', content: 'two' },
    ] };
    const result = await preparePdfItem(historicalFixture(chat));
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /MSG_DUP_ID/);
    assert.ok(result.diagnostics.some((d: any) => d.code === 'PDF_INPUT_INVALID'));
});

test('PDF preparation preserves nonfatal normalization diagnostics', async () => {
    const result = await preparePdfItem(historicalFixture({ id: 'warning', title: 'Warning', messages: [
        { id: 'valid', role: 'unrecognized', content: 'visible' },
    ] }));
    assert.strictEqual(result.ok, true);
    assert.ok(result.diagnostics.some((d: any) => d.code === 'UNKNOWN_ROLE'));
});

test('hydrated image bytes and image classification do not mutate the original input conversation object', async () => {
    const origImage: {
        name: string;
        url: string;
        dataBuffer?: unknown;
        type?: string;
        failureReason?: string;
    } = {
        name: 'test_photo.png',
        url: 'https://example.com/test_photo.png',
    };
    const origMsg = {
        id: 'm1',
        role: 'model',
        content: 'Check this image',
        images: [origImage],
    };
    const origChat = {
        id: 'immutability-check',
        title: 'Immutability Check',
        messages: [origMsg],
    };

    const dummyBytes = new Uint8Array([10, 20, 30, 40]);
    let acquireCalls = 0;
    const fakePipeline = {
        acquireAssetBytes: async () => {
            acquireCalls++;
            return {
                ok: true,
                bytes: dummyBytes,
                mimeType: 'image/png',
                failReason: '',
                recoveredFromTakeout: false,
                localName: 'test_photo.png',
            };
        },
    };

    const result = await preparePdfItem(historicalFixture(origChat), {
        assetPipeline: fakePipeline,
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(acquireCalls, 1);
    assert.strictEqual(origImage.dataBuffer, undefined);
    assert.strictEqual(origImage.type, undefined);
    assert.strictEqual(origImage.failureReason, undefined);
});

test('references to one Domain asset acquire once and share the prepared resource', async () => {
    const sharedUrl = 'https://example.com/shared_image.png';
    const img1 = { url: sharedUrl, name: 'img1.png' };
    const img2 = { url: sharedUrl, name: 'img2.png' };
    const chat = {
        id: 'dedupe-check',
        title: 'Dedupe Check',
        messages: [
            { id: 'm1', role: 'model', content: 'first', images: [img1] },
            { id: 'm2', role: 'model', content: 'second', images: [img2] },
        ],
    };

    const dummyBytes = new Uint8Array([1, 2, 3, 4, 5]);
    let acquireCalls = 0;
    const fakePipeline = {
        acquireAssetBytes: async () => {
            acquireCalls++;
            return {
                ok: true,
                bytes: dummyBytes,
                mimeType: 'image/png',
                failReason: '',
                recoveredFromTakeout: false,
                localName: 'shared_image.png',
            };
        },
    };

    const result = await preparePdfItem(historicalFixture(chat), {
        assetPipeline: fakePipeline,
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(acquireCalls, 1, 'acquireAssetBytes must be called only once for one Domain asset ID');
    assert.strictEqual([...result.resources.values()].length >= 1, true);
    for (const asset of [...result.resources.values()]) {
        assert.ok(asset.bytes?.length);
    }
});

test('inline bytes skip acquisition', async () => {
    const existingBytes = new Uint8Array([99, 98, 97]);
    const imgWithInline = {
        type: 'image',
        name: 'inline_cat.png',
        url: 'https://example.com/inline_cat.png',
        dataBuffer: existingBytes,
    };
    const chat = {
        id: 'skip-inline',
        title: 'Skip Inline Check',
        messages: [
            { id: 'm1', role: 'model', content: 'already has bytes', images: [imgWithInline] },
        ],
    };

    let acquireCalls = 0;
    const fakePipeline = {
        acquireAssetBytes: async () => {
            acquireCalls++;
            return {
                ok: true,
                bytes: new Uint8Array([1, 2, 3]),
                mimeType: 'image/png',
                failReason: '',
                recoveredFromTakeout: false,
                localName: 'inline_cat.png',
            };
        },
    };

    const result = await preparePdfItem(historicalFixture(chat), {
        assetPipeline: fakePipeline,
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(acquireCalls, 0, 'acquireAssetBytes must NOT be called when inline bytes exist');
});

test('acquisition keeps the legacy destination hint while source URI controls grouping', async () => {
    let capturedItem: { localName?: string } = {};
    const img = {
        localName: 'assets/key_local.png',
        resolvedUrl: 'https://example.com/key_resolved.png',
        sourceUrl: 'https://example.com/key_source.png',
        url: 'https://example.com/key_url.png',
        src: 'https://example.com/key_src.png',
        fileName: 'key_filename.png',
        name: 'key_name.png',
    };
    const chat = {
        id: 'precedence-check',
        title: 'Precedence Check',
        messages: [
            { id: 'm1', role: 'model', content: 'precedence test', images: [img] },
        ],
    };

    const fakePipeline = {
        acquireAssetBytes: async (item: { localName?: string }) => {
            capturedItem = item;
            return {
                ok: true,
                bytes: new Uint8Array([1, 2, 3]),
                mimeType: 'image/png',
                failReason: '',
                recoveredFromTakeout: false,
                localName: item.localName || 'asset.png',
            };
        },
    };

    const result = await preparePdfItem(historicalFixture(chat), {
        assetPipeline: fakePipeline,
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(capturedItem?.localName, 'assets/key_local.png');
});
