/**
 * tests/pdf-resource-stage.test.ts
 * Tier 1 tests for the D7 S2 resources stage
 * (src/core/export/pdf/pipeline/resourceStage.ts).
 *
 * Focused matrix:
 *   - normal image asset -> pathMap + mounts (bytes from the byte store)
 *   - inline images inside paragraph/heading/table cells are collected too
 *     (shared recursive collector, same traversal as the payload builder)
 *   - metadata-only file attachments skip byte resolution entirely: no
 *     pathMap entry, not "unresolved", no diagnostic, and their bytes are
 *     never read (spy on the byte store) — file cards render from Asset
 *     metadata alone
 *   - missing asset -> unresolved + warning diagnostic (never silent)
 *   - remote-only asset -> unresolved + warning (resolver only emits info)
 *   - referenced id absent from bundle.assets -> unresolved + warning
 *     (image placements are binary by placement, not by kind lookup)
 *   - aborted signal -> AbortError DOMException
 *   - binary decision is AST placement, not Asset.kind:
 *       - ImageBlock referencing a kind:'file' asset still resolves + mounts
 *         (placement wins), with an ASSET_KIND_MISMATCH warning
 *       - FileBlock referencing a kind:'image' asset is metadata-only:
 *         never resolved, no pathMap entry, no diagnostic, bytes untouched
 *   - message-level companions (associatedAssetIds):
 *       - kind:'image' companion with no block placement resolves + mounts
 *         (regression: #591 dropped it silently; the Typst payload still
 *         builds a trailing image attachment for it via assetPath)
 *       - non-image companion is metadata-only: never resolved, bytes
 *         untouched
 *       - id with block placement AND in associatedAssetIds resolves
 *         exactly once (no double mount, no companion duplication)
 */
export {};
const test = require('node:test');
const assert = require('node:assert');

const { resourceStage } = require('../src/core/export/pdf/pipeline/resourceStage.js');
const { createInlineByteStore } = require('../src/core/export/assets/byteStore.js');

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngBytes(seed = 1): Uint8Array {
    const b = new Uint8Array(PNG_MAGIC.length + 16);
    b.set(PNG_MAGIC, 0);
    for (let i = PNG_MAGIC.length; i < b.length; i++) b[i] = (i * seed) & 0xff;
    return b;
}

function asset(id: string, overrides: any = {}): any {
    return { id, kind: 'image', status: 'available', ...overrides };
}

function stageCtx(signal: AbortSignal): any {
    const calls: any[] = [];
    return {
        ctx: {
            signal,
            reportProgress: (stage: string, current: number, total: number) => {
                calls.push(['progress', stage, current, total]);
            },
            log: (message: string) => { calls.push(['log', message]); },
        },
        calls,
    };
}

function input(): any {
    const store = createInlineByteStore();
    const goodBlock = pngBytes(1);
    const goodPara = pngBytes(2);
    store.put('inline/img-block', goodBlock);
    store.put('inline/img-para', goodPara);

    const bundle = {
        assets: [
            asset('img-block', { storageRef: 'inline/img-block', mimeType: 'image/png' }),
            asset('img-para', { storageRef: 'inline/img-para', mimeType: 'image/png' }),
            asset('img-cell', { status: 'missing', failureReason: 'never fetched' }),
            asset('img-remote', { status: 'remote', sourceUrl: 'https://example.com/x.png' }),
        ],
    };
    const view = {
        messages: [
            {
                id: 'm1',
                role: 'model',
                blocks: [
                    { type: 'image', assetId: 'img-block' },
                    { type: 'paragraph', children: [{ type: 'image', assetId: 'img-para' }] },
                    {
                        type: 'table',
                        rows: [{ cells: [{ children: [{ type: 'image', assetId: 'img-cell' }] }] }],
                    },
                    { type: 'heading', level: 2, children: [{ type: 'image', assetId: 'img-remote' }] },
                    { type: 'list', items: [{ blocks: [{ type: 'image', assetId: 'img-ghost' }] }] },
                ],
            },
        ],
        rootIds: ['m1'],
        selectedPathIds: ['m1'],
        omittedBranchMessageIds: [],
    };
    return { bundle, view, byteStore: store, expected: { goodBlock, goodPara } };
}

test('resources stage: clean assets land in pathMap + mounts with byte-store bytes', async () => {
    const { bundle, view, byteStore, expected } = input();
    const { ctx } = stageCtx(new AbortController().signal);
    const { output, diagnostics } = await resourceStage({ bundle, view, byteStore }, ctx);

    assert.deepStrictEqual([...output.pathMap.keys()].sort(), ['img-block', 'img-para']);
    assert.strictEqual(output.mounts.length, 2);
    for (const mount of output.mounts) {
        assert.ok(typeof mount.virtualPath === 'string' && mount.virtualPath.length > 0);
        assert.strictEqual(mount.mimeType, 'image/png');
        assert.ok(mount.bytes instanceof Uint8Array && mount.bytes.length > 0);
    }
    const byPath: Map<string, any> = new Map(output.mounts.map((m: any) => [m.virtualPath, m]));
    assert.deepStrictEqual(
        byPath.get(output.pathMap.get('img-block'))!.bytes,
        expected.goodBlock,
    );
    assert.deepStrictEqual(
        byPath.get(output.pathMap.get('img-para'))!.bytes,
        expected.goodPara,
    );
    assert.ok(Array.isArray(diagnostics));
});

test('resources stage: missing/remote/ghost assets are unresolved, each with a warning+ diagnostic', async () => {
    const { bundle, view, byteStore } = input();
    const { ctx } = stageCtx(new AbortController().signal);
    const { output, diagnostics } = await resourceStage({ bundle, view, byteStore }, ctx);

    assert.deepStrictEqual(
        output.unresolved.map((u: any) => u.assetId).sort(),
        ['img-cell', 'img-ghost', 'img-remote'],
    );
    for (const entry of output.unresolved) {
        assert.ok(typeof entry.reason === 'string' && entry.reason.length > 0,
            `unresolved ${entry.assetId} must carry a reason`);
    }
    // Every omission must be diagnosed at warning or above — never silent.
    for (const entry of output.unresolved) {
        const hits = diagnostics.filter(
            (d: any) => d.path === `asset:${entry.assetId}`
                && (d.severity === 'warning' || d.severity === 'error'),
        );
        assert.ok(hits.length >= 1,
            `unresolved asset ${entry.assetId} has no warning+ diagnostic`);
    }
});

test('resources stage: aborted signal throws AbortError', async () => {
    const { bundle, view, byteStore } = input();
    const controller = new AbortController();
    controller.abort();
    const { ctx } = stageCtx(controller.signal);
    await assert.rejects(
        () => resourceStage({ bundle, view, byteStore }, ctx),
        (err: any) => err instanceof DOMException && err.name === 'AbortError',
    );
});

test('resources stage: metadata-only file attachments skip byte resolution entirely', async () => {
    // A 40MB-style report.pdf: referenced by a FileBlock, rendered by the
    // Typst template as a metadata-only card (name/kind/size from the Asset
    // entity). It must never reach the resolver: no byte read, no SHA-256,
    // no pathMap entry — while a sibling image still resolves normally.
    const readRefs: Array<[string, string]> = [];
    const real = createInlineByteStore();
    const spyStore: any = {
        put: (r: string, b: Uint8Array) => real.put(r, b),
        has: (r: string) => { readRefs.push(['has', r]); return real.has(r); },
        get: (r: string) => { readRefs.push(['get', r]); return real.get(r); },
        clear: () => real.clear(),
        get entryCount() { return real.entryCount; },
    };
    // Bytes are present in the store on purpose: the stage must not touch
    // them even when it cheaply could.
    spyStore.put('inline/report-pdf', new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])); // %PDF-
    spyStore.put('inline/img-ok', pngBytes(7));
    const bundle = {
        assets: [
            asset('doc-report', {
                kind: 'file', storageRef: 'inline/report-pdf',
                mimeType: 'application/pdf', name: 'report.pdf',
                // 40MB claimed in metadata; never allocated.
                sizeBytes: 40 * 1024 * 1024,
            }),
            asset('img-ok', { storageRef: 'inline/img-ok', mimeType: 'image/png' }),
        ],
    };
    const view = {
        messages: [
            {
                id: 'm1', role: 'model',
                blocks: [
                    { type: 'file', assetId: 'doc-report', label: 'report.pdf' },
                    { type: 'image', assetId: 'img-ok' },
                ],
            },
        ],
        rootIds: ['m1'],
        selectedPathIds: ['m1'],
        omittedBranchMessageIds: [],
    };
    const { ctx } = stageCtx(new AbortController().signal);
    const { output, diagnostics } = await resourceStage({ bundle, view, byteStore: spyStore }, ctx);

    // The image still resolves + mounts as before.
    assert.ok(output.pathMap.has('img-ok'), 'image asset still resolves');
    assert.strictEqual(output.mounts.length, 1, 'only the image is mounted');
    // The file attachment: never resolved, so no pathMap entry; not
    // "unresolved" either (its card renders from metadata); no diagnostic.
    assert.strictEqual(output.pathMap.has('doc-report'), false,
        'metadata-only file never enters pathMap');
    assert.deepStrictEqual(output.unresolved, []);
    const warnPlus = diagnostics.filter(
        (d: any) => d.path === 'asset:doc-report'
            && (d.severity === 'warning' || d.severity === 'error'),
    );
    assert.strictEqual(warnPlus.length, 0, 'metadata-only file gets no diagnostic');
    // And its bytes were never read (hence never hashed): zero get/has on
    // its storageRef, even though bytes were available.
    const touched = readRefs.filter(([, r]) => r === 'inline/report-pdf');
    assert.deepStrictEqual(touched, [],
        'resolver must never touch the file attachment bytes');
});

test('resources stage: RESOURCE_BYTES_MISSING drops the asset from pathMap and reports it exactly once', async () => {
    // Simulate bytes vanishing between resolveAssets and the mount re-read:
    // the resolver's single get() sees bytes, the stage's re-read misses.
    const real = createInlineByteStore();
    const doomed = pngBytes(9);
    real.put('inline/doomed', doomed);
    const victimRef = 'inline/doomed';
    let gets = 0;
    const vanishing: any = {
        put: (r: string, b: Uint8Array) => real.put(r, b),
        has: (r: string) => real.has(r),
        get: (r: string) => {
            if (r !== victimRef) return real.get(r);
            gets++;
            return gets === 1 ? real.get(r) : undefined;
        },
        clear: () => real.clear(),
        get entryCount() { return real.entryCount; },
    };

    const bundle = {
        assets: [asset('img-doomed', { storageRef: 'inline/doomed', mimeType: 'image/png' })],
    };
    const view = {
        messages: [
            {
                id: 'm1', role: 'model',
                blocks: [{ type: 'image', assetId: 'img-doomed' }],
            },
        ],
        rootIds: ['m1'],
        selectedPathIds: ['m1'],
        omittedBranchMessageIds: [],
    };
    const { ctx } = stageCtx(new AbortController().signal);
    const { output, diagnostics } = await resourceStage({ bundle, view, byteStore: vanishing }, ctx);

    // pathMap must not claim a clean resolve for an asset with no mount.
    assert.ok(!output.pathMap.has('img-doomed'), 'pathMap must drop the bytes-missing asset');
    assert.strictEqual(output.mounts.length, 0);
    // Exactly one unresolved entry and one error diagnostic — no duplicates.
    assert.deepStrictEqual(output.unresolved.map((u: any) => u.assetId), ['img-doomed']);
    const hits = diagnostics.filter((d: any) => d.code === 'RESOURCE_BYTES_MISSING');
    assert.strictEqual(hits.length, 1, 'exactly one RESOURCE_BYTES_MISSING diagnostic');
    assert.strictEqual(hits[0].severity, 'error');
});

test('resources stage: binary decision is AST placement, not Asset.kind (image placement wins)', async () => {
    // Regression for the review round: an ImageBlock referencing a
    // kind:'file' asset whose bytes are genuinely a PNG must still be
    // resolved + mounted — the canonical validator does not force
    // ImageBlock -> kind 'image', and judging by kind would silently
    // degrade the image. Placement wins; the mismatch gets a warning.
    const real = createInlineByteStore();
    real.put('inline/misfiled', pngBytes(11));
    const bundle = {
        assets: [
            asset('misfiled', {
                kind: 'file', storageRef: 'inline/misfiled',
                mimeType: 'image/png', name: 'photo.png',
            }),
        ],
    };
    const view = {
        messages: [
            {
                id: 'm1', role: 'model',
                blocks: [{ type: 'image', assetId: 'misfiled' }],
            },
        ],
        rootIds: ['m1'],
        selectedPathIds: ['m1'],
        omittedBranchMessageIds: [],
    };
    const { ctx } = stageCtx(new AbortController().signal);
    const { output, diagnostics } = await resourceStage({ bundle, view, byteStore: real }, ctx);

    assert.ok(output.pathMap.has('misfiled'),
        'image placement resolves even when Asset.kind is file');
    assert.strictEqual(output.mounts.length, 1, 'misfiled image is mounted');
    assert.deepStrictEqual(output.unresolved, []);
    const hits = diagnostics.filter((d: any) => d.code === 'ASSET_KIND_MISMATCH');
    assert.strictEqual(hits.length, 1, 'exactly one kind-mismatch warning');
    assert.strictEqual(hits[0].severity, 'warning');
    assert.strictEqual(hits[0].path, 'asset:misfiled');
});

test('resources stage: FileBlock referencing a kind:image asset is metadata-only', async () => {
    // Mirror case: a FileBlock is metadata-only by placement, even when the
    // asset's kind claims 'image'. Its file card renders from the Asset
    // entity; the stage must not resolve it and must not warn about it.
    const readRefs: Array<[string, string]> = [];
    const real = createInlineByteStore();
    const spyStore: any = {
        put: (r: string, b: Uint8Array) => real.put(r, b),
        has: (r: string) => { readRefs.push(['has', r]); return real.has(r); },
        get: (r: string) => { readRefs.push(['get', r]); return real.get(r); },
        clear: () => real.clear(),
        get entryCount() { return real.entryCount; },
    };
    spyStore.put('inline/not-really-image', pngBytes(12));
    const bundle = {
        assets: [
            asset('filey', {
                kind: 'image', storageRef: 'inline/not-really-image',
                mimeType: 'image/png', name: 'attachment.bin', sizeBytes: 28,
            }),
        ],
    };
    const view = {
        messages: [
            {
                id: 'm1', role: 'model',
                blocks: [{ type: 'file', assetId: 'filey', label: 'attachment.bin' }],
            },
        ],
        rootIds: ['m1'],
        selectedPathIds: ['m1'],
        omittedBranchMessageIds: [],
    };
    const { ctx } = stageCtx(new AbortController().signal);
    const { output, diagnostics } = await resourceStage({ bundle, view, byteStore: spyStore }, ctx);

    assert.strictEqual(output.pathMap.has('filey'), false,
        'FileBlock asset never enters pathMap');
    assert.strictEqual(output.mounts.length, 0, 'nothing mounted');
    assert.deepStrictEqual(output.unresolved, []);
    const warnPlus = diagnostics.filter(
        (d: any) => d.path === 'asset:filey'
            && (d.severity === 'warning' || d.severity === 'error'),
    );
    assert.strictEqual(warnPlus.length, 0, 'metadata-only FileBlock gets no diagnostic');
    assert.deepStrictEqual(readRefs, [],
        'resolver must never touch the FileBlock bytes');
});

test('resources stage: kind:image companion via associatedAssetIds resolves + mounts (no silent drop)', async () => {
    // Regression: #591 changed the stage to resolve only block-tree image
    // placements, but the Typst payload still turns a kind:'image'
    // associatedAssetIds entry with no block placement into a trailing
    // image attachment via options.assetPath(asset). Without a pathMap
    // entry the attachment was silently skipped. Roadmap §43 lists
    // associatedAssetIds as a first-class association path alongside
    // blocks, so the stage must resolve these companions.
    const real = createInlineByteStore();
    real.put('inline/comp', pngBytes(21));
    const compAsset = asset('comp-img', {
        storageRef: 'inline/comp', mimeType: 'image/png', name: 'comp.png',
    });
    const bundle = { assets: [compAsset] };
    const msgBlocks = [
        { type: 'paragraph', children: [{ type: 'text', text: 'see attached' }] },
    ];
    const view = {
        messages: [
            {
                id: 'm1', role: 'model', blocks: msgBlocks,
                associatedAssetIds: ['comp-img'],
            },
        ],
        rootIds: ['m1'],
        selectedPathIds: ['m1'],
        omittedBranchMessageIds: [],
    };
    const { ctx } = stageCtx(new AbortController().signal);
    const { output, diagnostics } = await resourceStage({ bundle, view, byteStore: real }, ctx);

    assert.ok(output.pathMap.has('comp-img'), 'companion image resolves');
    assert.strictEqual(output.mounts.length, 1, 'companion image is mounted');
    assert.deepStrictEqual(output.mounts[0].bytes, pngBytes(21));
    assert.deepStrictEqual(output.unresolved, []);
    const warnPlus = diagnostics.filter(
        (d: any) => d.path === 'asset:comp-img'
            && (d.severity === 'warning' || d.severity === 'error'),
    );
    assert.strictEqual(warnPlus.length, 0, 'clean companion gets no diagnostic');

    // End-to-end: the payload's trailing attachment now has a real path.
    const { toTypstPayload } = require('../src/core/export/typst/payload.js');
    const payloadBundle = {
        schemaVersion: 1,
        conversation: {
            key: { providerId: 'gemini', accountId: 'test', conversationId: 'c1' },
            title: { value: 't', source: 'derived', candidates: [] },
            createdAt: '2026-09-20T10:00:00Z',
            messages: [{ id: 'm1', role: 'model', blocks: msgBlocks, associatedAssetIds: ['comp-img'] }],
        },
        assets: [compAsset],
        citations: [],
    };
    const { payload } = toTypstPayload(payloadBundle, {
        assetPath: (a: any) => output.pathMap.get(a.id),
    });
    const attachments = payload.messages[0].attachments ?? [];
    assert.strictEqual(attachments.length, 1, 'companion appears as trailing attachment');
    assert.strictEqual(attachments[0].type, 'image');
    assert.strictEqual(attachments[0].asset, output.pathMap.get('comp-img'));
});

test('resources stage: non-image companion via associatedAssetIds is metadata-only', async () => {
    // A kind:'file' associated id renders as a metadata-only file card in
    // the payload (payload else-branch) and must never reach the resolver.
    const readRefs: Array<[string, string]> = [];
    const real = createInlineByteStore();
    const spyStore: any = {
        put: (r: string, b: Uint8Array) => real.put(r, b),
        has: (r: string) => { readRefs.push(['has', r]); return real.has(r); },
        get: (r: string) => { readRefs.push(['get', r]); return real.get(r); },
        clear: () => real.clear(),
        get entryCount() { return real.entryCount; },
    };
    spyStore.put('inline/comp-doc', new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]));
    const bundle = {
        assets: [
            asset('comp-doc', {
                kind: 'file', storageRef: 'inline/comp-doc',
                mimeType: 'application/pdf', name: 'notes.pdf', sizeBytes: 1234,
            }),
        ],
    };
    const view = {
        messages: [
            {
                id: 'm1', role: 'model',
                blocks: [{ type: 'paragraph', children: [{ type: 'text', text: 'notes attached' }] }],
                associatedAssetIds: ['comp-doc'],
            },
        ],
        rootIds: ['m1'],
        selectedPathIds: ['m1'],
        omittedBranchMessageIds: [],
    };
    const { ctx } = stageCtx(new AbortController().signal);
    const { output, diagnostics } = await resourceStage({ bundle, view, byteStore: spyStore }, ctx);

    assert.strictEqual(output.pathMap.has('comp-doc'), false,
        'file companion never enters pathMap');
    assert.strictEqual(output.mounts.length, 0, 'nothing mounted');
    assert.deepStrictEqual(output.unresolved, []);
    const warnPlus = diagnostics.filter(
        (d: any) => d.path === 'asset:comp-doc'
            && (d.severity === 'warning' || d.severity === 'error'),
    );
    assert.strictEqual(warnPlus.length, 0, 'metadata-only companion gets no diagnostic');
    assert.deepStrictEqual(readRefs, [],
        'resolver must never touch the file companion bytes');
});

test('resources stage: block-placed id also listed in associatedAssetIds resolves exactly once', async () => {
    // The payload skips block-referenced ids when building companions (an
    // inline image must not reappear as a trailing attachment); the stage
    // must agree and not double-count or double-resolve.
    const real = createInlineByteStore();
    real.put('inline/dup', pngBytes(22));
    const bundle = {
        assets: [asset('dup-img', { storageRef: 'inline/dup', mimeType: 'image/png' })],
    };
    const view = {
        messages: [
            {
                id: 'm1', role: 'model',
                blocks: [{ type: 'image', assetId: 'dup-img' }],
                associatedAssetIds: ['dup-img'],
            },
        ],
        rootIds: ['m1'],
        selectedPathIds: ['m1'],
        omittedBranchMessageIds: [],
    };
    const { ctx } = stageCtx(new AbortController().signal);
    const { output, diagnostics } = await resourceStage({ bundle, view, byteStore: real }, ctx);

    assert.ok(output.pathMap.has('dup-img'), 'image still resolves');
    assert.strictEqual(output.mounts.length, 1, 'mounted exactly once');
    assert.deepStrictEqual(output.unresolved, []);
    assert.strictEqual(
        diagnostics.filter((d: any) => d.code === 'ASSET_KIND_MISMATCH').length, 0,
        'kind:image block placement gets no mismatch warning',
    );
});
