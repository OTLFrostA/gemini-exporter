/**
 * tests/pdf-pipeline-m2-payload.test.ts
 * Tier 1 focused test for the D7 S3 Typst payload stage (M2).
 *
 * Locks the stage behavior with fake inputs:
 * - degraded math (unsupported LaTeX) keeps its raw latex in the payload
 *   AND produces a warning diagnostic — never silent;
 * - convertible math carries the Typst body with no diagnostic;
 * - the stage consumes the S1 projected view verbatim and never calls the
 *   adapter's internal linearize (a branched bundle with no selected leaf
 *   must succeed, because the internal linearize would throw there);
 * - asset paths are read from the S2 pathMap (no re-resolution);
 * - an aborted signal throws AbortError.
 */
export {};
const test = require('node:test');
const assert = require('node:assert');

const { payloadStage } = require('../src/core/export/pdf/pipeline/payloadStage.js');

function para(text: string): any {
    return { type: 'paragraph', children: [{ type: 'text', text }] };
}

function mathBlock(source: string): any {
    return { type: 'math', source, notation: 'latex' };
}

function message(id: string, role: string, parentId: string | null, blocks: any[]): any {
    return { id, role, parentId, blocks };
}

function bundleWith(messages: any[], assets: any[] = []): any {
    return {
        conversation: {
            key: { providerId: 'gemini', accountId: 't', conversationId: 'c1' },
            title: { value: 'T', source: 'default', candidates: [] },
            messages,
        },
        assets,
        citations: [],
    };
}

function viewOf(messages: any[]): any {
    return {
        messages,
        rootIds: messages.filter((m: any) => !m.parentId).map((m: any) => m.id),
        selectedPathIds: messages.map((m: any) => m.id),
        omittedBranchMessageIds: [],
    };
}

function makeCtx() {
    const controller = new AbortController();
    return {
        controller,
        signal: controller.signal,
        reportProgress: (_s: string, _c: number, _t: number) => {},
        log: (_m: string, _l?: string) => {},
    };
}

test('degraded math is diagnosed, never silent', async () => {
    const m1 = message('m1', 'user', null, [para('hello')]);
    const m2 = message('m2', 'assistant', 'm1', [mathBlock('\\begin{matrix} x \\end{matrix}')]);
    const bundle = bundleWith([m1, m2]);
    const { output, diagnostics } = await payloadStage(
        { bundle, view: viewOf([m1, m2]), pathMap: new Map() },
        makeCtx(),
    );
    // diagnostic channel carries the failure
    const failed = diagnostics.filter((d: any) => d.code === 'TYPST_MATH_CONVERT_FAILED');
    assert.strictEqual(failed.length, 1, `expected one convert-failed diagnostic, got: ${JSON.stringify(diagnostics)}`);
    assert.strictEqual(failed[0].severity, 'warning');
    assert.ok(failed[0].message.length > 0);
    // and the payload keeps the raw latex (visible, not dropped)
    const mathNodes = output.payload.messages[1].blocks.filter((b: any) => b.type === 'math');
    assert.strictEqual(mathNodes.length, 1);
    assert.strictEqual(mathNodes[0].latex, '\\begin{matrix} x \\end{matrix}');
    assert.strictEqual(mathNodes[0].typst, undefined);
    assert.strictEqual(output.payload.messageCount, 2);
});

test('convertible math carries the Typst body with no diagnostic', async () => {
    const m1 = message('m1', 'user', null, [mathBlock('\\frac{a}{b}')]);
    const bundle = bundleWith([m1]);
    const { output, diagnostics } = await payloadStage(
        { bundle, view: viewOf([m1]), pathMap: new Map() },
        makeCtx(),
    );
    const mathNodes = output.payload.messages[0].blocks.filter((b: any) => b.type === 'math');
    assert.strictEqual(mathNodes.length, 1);
    assert.strictEqual(mathNodes[0].typst, 'frac(a, b)');
    assert.deepStrictEqual(diagnostics, []);
});

test('consumes the projected view verbatim, never re-linearizes', async () => {
    const m1 = message('m1', 'user', null, [para('q')]);
    const m2 = message('m2', 'assistant', 'm1', [para('a2')]);
    const m3 = message('m3', 'assistant', 'm1', [para('a3')]);
    const bundle = bundleWith([m1, m2, m3]);
    const { output } = await payloadStage(
        { bundle, view: viewOf([m1, m2]), pathMap: new Map() },
        makeCtx(),
    );
    assert.strictEqual(output.payload.messageCount, 2);
    assert.deepStrictEqual(output.payload.messages.map((m: any) => m.id), ['m1', 'm2']);
});

test('asset paths come from the S2 pathMap without re-resolution', async () => {
    const m1 = message('m1', 'user', null, [{ type: 'image', assetId: 'img1', alt: 'pic' }]);
    const bundle = bundleWith([m1], [
        { id: 'img1', kind: 'image', status: 'available', mimeType: 'image/png', name: 'x.png' },
    ]);
    const pathMap = new Map([['img1', 'assets/sha256/ab/x.png']]);
    const { output, diagnostics } = await payloadStage(
        { bundle, view: viewOf([m1]), pathMap },
        makeCtx(),
    );
    const images = output.payload.messages[0].blocks.filter((b: any) => b.type === 'image');
    assert.strictEqual(images.length, 1);
    assert.strictEqual(images[0].asset, 'assets/sha256/ab/x.png');
    assert.ok(!diagnostics.some((d: any) => d.code === 'TYPST_V8_IMAGE_MISSING'));
});

test('aborted signal throws AbortError', async () => {
    const m1 = message('m1', 'user', null, [para('hello')]);
    const bundle = bundleWith([m1]);
    const ctx = makeCtx();
    ctx.controller.abort();
    await assert.rejects(
        payloadStage({ bundle, view: viewOf([m1]), pathMap: new Map() }, ctx),
        (e: any) => e instanceof DOMException && e.name === 'AbortError',
    );
});
