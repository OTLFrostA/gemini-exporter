/**
 * tests/pdf-resource-stage.test.ts
 * Tier 1 tests for the D7 S2 resources stage
 * (src/core/export/pdf/pipeline/resourceStage.ts).
 *
 * Focused matrix:
 *   - normal image asset -> pathMap + mounts (bytes from the byte store)
 *   - inline images inside paragraph/heading/table cells are collected too
 *     (shared recursive collector, same traversal as the payload builder)
 *   - missing asset -> unresolved + warning diagnostic (never silent)
 *   - remote-only asset -> unresolved + warning (resolver only emits info)
 *   - referenced id absent from bundle.assets -> unresolved + warning
 *   - aborted signal -> AbortError DOMException
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
