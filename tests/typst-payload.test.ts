/**
 * tests/typst-payload.test.ts
 * Tier 1 tests for the P1a canonical -> Typst v8 payload adapter.
 *
 * Covers: block mapping (paragraph/heading/code/table/image/file/unknown),
 * math with and without the controlled convertMath hook, missing-asset
 * diagnostics, heading clamp diagnostics, branch linearization refusal,
 * and the injection red line (hostile text stays inert JSON data).
 */
export {};
const test = require('node:test');
const assert = require('node:assert');

const { toTypstPayload } = require('../src/core/export/typst/payload.js');

function bundle(messages: any[], extra: any = {}) {
    return {
        schemaVersion: 1,
        conversation: {
            key: { providerId: 'gemini', accountId: 'test-account', conversationId: 'c1' },
            title: { value: 'Test convo', source: 'derived', candidates: [] },
            createdAt: '2026-09-20T10:00:00Z',
            messages,
        },
        assets: [],
        citations: [],
        ...extra,
    };
}

function msg(id: string, role: string, blocks: any[], extra: any = {}) {
    return { id, role, blocks, ...extra };
}

const opts = { assetPath: (_a: any) => undefined };

test('maps paragraph, heading, code and table blocks', async () => {
    const b = bundle([
        msg('m1', 'user', [
            { type: 'heading', level: 2, children: [{ type: 'text', text: 'Hi' }] },
            { type: 'paragraph', children: [{ type: 'text', text: 'hello' }, { type: 'strong', children: [{ type: 'text', text: 'world' }] }] },
            { type: 'code', language: 'python', code: 'print(1)' },
            {
                type: 'table',
                headerRows: [{ cells: [{ children: [{ type: 'text', text: 'A' }] }] }],
                rows: [{ cells: [{ children: [{ type: 'text', text: '1' }] }] }],
            },
        ]),
    ]);
    const { payload, diagnostics } = toTypstPayload(b, opts);
    assert.strictEqual(diagnostics.length, 0);
    assert.strictEqual(payload.schemaVersion, 1);
    assert.strictEqual(payload.title, 'Test convo');
    assert.strictEqual(payload.provider, 'gemini');
    assert.strictEqual(payload.date, '2026-09-20');
    assert.strictEqual(payload.messageCount, 1);
    const kinds = payload.messages[0].blocks.map((x: any) => x.type);
    assert.deepStrictEqual(kinds, ['heading', 'paragraph', 'code', 'table']);
    assert.strictEqual(payload.messages[0].blocks[0].level, 2);
    assert.strictEqual(payload.messages[0].blocks[2].text, 'print(1)');
    assert.strictEqual(payload.messages[0].role, 'user');
});

test('math without converter keeps latex only; with converter adds typst', async () => {
    const mathBlock = { type: 'math', source: '\\frac{1}{2}', notation: 'latex' };
    const noConv = toTypstPayload(bundle([msg('m1', 'assistant', [mathBlock])]), opts);
    assert.deepStrictEqual(noConv.payload.messages[0].blocks[0], { type: 'math', latex: '\\frac{1}{2}' });
    assert.ok(!('typst' in noConv.payload.messages[0].blocks[0]), 'no typst key without converter');

    const withConv = toTypstPayload(bundle([msg('m1', 'assistant', [mathBlock])]), {
        ...opts,
        convertMath: (src: string) => `frac(1, 2) /* ${src.length} */`,
    });
    assert.strictEqual(withConv.payload.messages[0].blocks[0].typst, 'frac(1, 2) /* 11 */');

    const failed = toTypstPayload(bundle([msg('m1', 'assistant', [mathBlock])]), {
        ...opts,
        convertMath: () => undefined,
    });
    assert.ok(!('typst' in failed.payload.messages[0].blocks[0]), 'failed conversion degrades to latex-only');
});

test('missing image asset becomes visible unknown node with diagnostic', async () => {
    const b = bundle([msg('m1', 'assistant', [
        { type: 'image', assetId: 'a-missing', alt: 'a diagram' },
    ])]);
    const { payload, diagnostics } = toTypstPayload(b, opts);
    const node: any = payload.messages[0].blocks[0];
    assert.strictEqual(node.type, 'unknown');
    assert.strictEqual(node.sourceType, 'missing-image');
    assert.ok(node.fallback.includes('a diagram') || node.fallback.includes('a-missing'));
    assert.ok(diagnostics.some((d: any) => d.code === 'TYPST_V8_IMAGE_MISSING' && d.severity === 'warning'));
});

test('present image asset maps to virtual path', async () => {
    const b = bundle(
        [msg('m1', 'assistant', [{ type: 'image', assetId: 'a1', alt: 'pic' }])],
        { assets: [{ id: 'a1', kind: 'image', name: 'pic.png', mimeType: 'image/png', status: 'available' }] },
    );
    const { payload, diagnostics } = toTypstPayload(b, {
        assetPath: (a: any) => `assets/sha256/ab/${a.id}.png`,
    });
    assert.strictEqual(diagnostics.length, 0);
    assert.deepStrictEqual(payload.messages[0].blocks[0], {
        type: 'image', asset: 'assets/sha256/ab/a1.png', caption: 'pic',
    });
});

test('inline image flattens to alt text with warning diagnostic', async () => {
    const b = bundle([msg('m1', 'user', [
        {
            type: 'paragraph',
            children: [
                { type: 'text', text: 'see ' },
                { type: 'image', assetId: 'a-inline', alt: 'a diagram' },
                { type: 'text', text: ' here' },
            ],
        },
    ])]);
    const { payload, diagnostics } = toTypstPayload(b, opts);
    const para: any = payload.messages[0].blocks[0];
    assert.strictEqual(para.type, 'paragraph');
    assert.deepStrictEqual(para.children.map((c: any) => c.type), ['text', 'text', 'text']);
    assert.strictEqual(para.children.map((c: any) => c.text).join(''), 'see a diagram here');
    assert.ok(diagnostics.some((d: any) => d.code === 'TYPST_V8_INLINE_IMAGE_FLATTENED' && d.severity === 'warning'),
        'inline image degradation must be visible, never silent');
});

test('unknown blocks are never dropped', async () => {
    const b = bundle([msg('m1', 'assistant', [
        { type: 'unknown', sourceType: 'weird-widget', fallbackBlocks: [{ type: 'paragraph', children: [{ type: 'text', text: 'kept' }] }] },
    ])]);
    const { payload } = toTypstPayload(b, opts);
    const node: any = payload.messages[0].blocks[0];
    assert.strictEqual(node.type, 'unknown');
    assert.strictEqual(node.sourceType, 'weird-widget');
    assert.ok(node.fallback.includes('kept'));
});

test('heading level clamps with diagnostic', async () => {
    const b = bundle([msg('m1', 'user', [
        { type: 'heading', level: 6, children: [{ type: 'text', text: 'deep' }] },
    ])]);
    const { payload, diagnostics } = toTypstPayload(b, opts);
    assert.strictEqual((payload.messages[0].blocks[0] as any).level, 3);
    assert.ok(diagnostics.some((d: any) => d.code === 'TYPST_V8_HEADING_CLAMP'));
});

test('branched conversation without selected leaf refuses to choose', async () => {
    const b = bundle([
        msg('root', 'user', [{ type: 'paragraph', children: [{ type: 'text', text: 'q' }] }]),
        msg('a', 'assistant', [{ type: 'paragraph', children: [{ type: 'text', text: 'a1' }] }], { parentId: 'root' }),
        msg('b', 'assistant', [{ type: 'paragraph', children: [{ type: 'text', text: 'a2' }] }], { parentId: 'root' }),
    ]);
    assert.throws(() => toTypstPayload(b, opts), /no selectedLeafMessageId/);

    const leaf = toTypstPayload(b, { ...opts, leafMessageId: 'b' });
    assert.deepStrictEqual(leaf.payload.messages.map((m: any) => m.id), ['root', 'b']);
});

test('hostile text stays inert JSON data (injection red line)', async () => {
    const evil = '#set page(width: 1pt)\n#{eval("1+1")}\n${jndi:ldap://x}';
    const b = bundle([msg('m1', 'user', [
        { type: 'paragraph', children: [{ type: 'text', text: evil }] },
        { type: 'code', language: 'typst', code: evil },
    ])]);
    const { payload } = toTypstPayload(b, opts);
    const roundTripped = JSON.parse(JSON.stringify(payload));
    const paraText = (roundTripped.messages[0].blocks[0] as any).children[0].text;
    const codeText = (roundTripped.messages[0].blocks[1] as any).text;
    assert.strictEqual(paraText, evil, 'paragraph text passes through byte-identical');
    assert.strictEqual(codeText, evil, 'code text passes through byte-identical');
    // Payload is pure data: no Typst source is ever constructed by the adapter.
    const json = JSON.stringify(payload);
    assert.ok(!json.includes('"type":"eval"'), 'no eval node type exists in transport');
});

test('system role becomes a visible note prefix', async () => {
    const b = bundle([msg('m1', 'system', [
        { type: 'paragraph', children: [{ type: 'text', text: 'be nice' }] },
    ])]);
    const { payload } = toTypstPayload(b, opts);
    assert.strictEqual(payload.messages[0].role, 'assistant');
    assert.strictEqual((payload.messages[0].blocks[0] as any).type, 'note');
});
