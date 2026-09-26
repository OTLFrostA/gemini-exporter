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
const { collectReferencedAssetIds } = require('../src/core/export/canonical/assetReferences.js');

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

test('inline image maps to a formal transport node', async () => {
    const b = bundle(
        [msg('m1', 'user', [
            {
                type: 'paragraph',
                children: [
                    { type: 'text', text: 'see ' },
                    { type: 'image', assetId: 'a-inline', alt: 'a diagram' },
                    { type: 'text', text: ' here' },
                ],
            },
        ])],
        { assets: [{ id: 'a-inline', kind: 'image', name: 'd.png', mimeType: 'image/png', status: 'available' }] },
    );
    const { payload, diagnostics } = toTypstPayload(b, { assetPath: (a: any) => `assets/${a.id}.png` });
    const para: any = payload.messages[0].blocks[0];
    assert.strictEqual(para.type, 'paragraph');
    assert.deepStrictEqual(para.children.map((c: any) => c.type), ['text', 'image', 'text']);
    assert.deepStrictEqual(para.children[1], { type: 'image', asset: 'assets/a-inline.png', alt: 'a diagram' });
    assert.ok(!diagnostics.some((d: any) => d.code === 'TYPST_V8_INLINE_IMAGE_FLATTENED'),
        'TYPST_V8_INLINE_IMAGE_FLATTENED is retired');
});

test('inline image without alt omits the alt key', async () => {
    const b = bundle(
        [msg('m1', 'user', [
            { type: 'paragraph', children: [{ type: 'image', assetId: 'a-inline' }] },
        ])],
        { assets: [{ id: 'a-inline', kind: 'image', name: 'd.png', mimeType: 'image/png', status: 'available' }] },
    );
    const { payload } = toTypstPayload(b, { assetPath: (a: any) => `assets/${a.id}.png` });
    assert.deepStrictEqual((payload.messages[0].blocks[0] as any).children[0],
        { type: 'image', asset: 'assets/a-inline.png' });
});

test('missing inline image asset falls back to visible text with missing-asset diagnostic', async () => {
    const b = bundle([msg('m1', 'user', [
        { type: 'paragraph', children: [{ type: 'image', assetId: 'a-gone', alt: 'a diagram' }] },
    ])]);
    const { payload, diagnostics } = toTypstPayload(b, opts);
    const para: any = payload.messages[0].blocks[0];
    assert.deepStrictEqual(para.children[0], { type: 'text', text: 'a diagram' });
    assert.ok(diagnostics.some((d: any) => d.code === 'TYPST_V8_INLINE_IMAGE_MISSING' && d.severity === 'warning'),
        'asset absence must be visible, never silent');
    assert.ok(!diagnostics.some((d: any) => d.code === 'TYPST_V8_INLINE_IMAGE_FLATTENED'),
        'TYPST_V8_INLINE_IMAGE_FLATTENED is retired');
});

test('missing inline image asset without alt shows [image: id] placeholder', async () => {
    const b = bundle([msg('m1', 'user', [
        { type: 'paragraph', children: [{ type: 'image', assetId: 'a-gone' }] },
    ])]);
    const { payload } = toTypstPayload(b, opts);
    assert.strictEqual((payload.messages[0].blocks[0] as any).children[0].text, '[image: a-gone]');
});

test('collectReferencedAssetIds walks block and inline trees recursively', async () => {
    const blocks = [
        { type: 'image', assetId: 'top-img' },
        { type: 'file', assetId: 'top-file' },
        { type: 'paragraph', children: [{ type: 'image', assetId: 'para-img', alt: 'p' }] },
        { type: 'heading', level: 1, children: [{ type: 'strong', children: [{ type: 'image', assetId: 'heading-img' }] }] },
        {
            type: 'table',
            rows: [{ cells: [{ children: [{ type: 'link', url: 'https://x', children: [{ type: 'image', assetId: 'cell-img' }] }] }] }],
        },
        {
            type: 'list', ordered: false,
            items: [{ blocks: [{ type: 'paragraph', children: [{ type: 'image', assetId: 'list-img' }] }] }],
        },
        { type: 'quote', blocks: [{ type: 'paragraph', children: [{ type: 'image', assetId: 'quote-img' }] }] },
        { type: 'unknown', sourceType: 'x', fallbackBlocks: [{ type: 'paragraph', children: [{ type: 'image', assetId: 'unknown-img' }] }] },
    ];
    const ids = collectReferencedAssetIds(blocks as any);
    assert.deepStrictEqual([...ids].sort(), [
        'cell-img', 'heading-img', 'list-img', 'para-img',
        'quote-img', 'top-file', 'top-img', 'unknown-img',
    ].sort());
});

test('inline image asset is not duplicated as a trailing attachment', async () => {
    const b = bundle(
        [msg('m1', 'user', [
            { type: 'paragraph', children: [{ type: 'text', text: 'see ' }, { type: 'image', assetId: 'a-inline', alt: 'd' }] },
            {
                type: 'table',
                rows: [{ cells: [{ children: [{ type: 'image', assetId: 'a-cell' }] }] }],
            },
        ], { associatedAssetIds: ['a-inline', 'a-cell', 'a-orphan'] })],
        { assets: [
            { id: 'a-inline', kind: 'image', name: 'd.png', mimeType: 'image/png', status: 'available' },
            { id: 'a-cell', kind: 'image', name: 'c.png', mimeType: 'image/png', status: 'available' },
            { id: 'a-orphan', kind: 'image', name: 'o.png', mimeType: 'image/png', status: 'available' },
        ] },
    );
    const { payload, diagnostics } = toTypstPayload(b, { assetPath: (a: any) => `assets/${a.id}.png` });
    const attachments = payload.messages[0].attachments ?? [];
    assert.strictEqual(attachments.length, 1, 'inline-placed assets must not reappear as attachments');
    assert.strictEqual((attachments[0] as any).name, 'o.png');
    // ... and the inline placements themselves are intact
    assert.strictEqual((payload.messages[0].blocks[0] as any).children[1].type, 'image');
    assert.strictEqual((payload.messages[0].blocks[1] as any).rows[0][0][0].type, 'image');
    assert.ok(!diagnostics.some((d: any) => d.code === 'TYPST_V8_INLINE_IMAGE_MISSING'));
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

test('branched conversation without selected leaf renders every message in source order', async () => {
    const b = bundle([
        msg('root', 'user', [{ type: 'paragraph', children: [{ type: 'text', text: 'q' }] }]),
        msg('a', 'assistant', [{ type: 'paragraph', children: [{ type: 'text', text: 'a1' }] }], { parentId: 'root' }),
        msg('b', 'assistant', [{ type: 'paragraph', children: [{ type: 'text', text: 'a2' }] }], { parentId: 'root' }),
    ]);
    const { payload } = toTypstPayload(b, opts);
    assert.deepStrictEqual(payload.messages.map((m: any) => m.id), ['root', 'a', 'b']);

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

test('associated image companion with no path emits TYPST_V8_ASSOCIATED_IMAGE_MISSING (no silent drop)', async () => {
    // The companion rule promises a trailing image attachment, but the stage
    // output gave it no path (not resolved, or missing). Dropping it silently
    // is forbidden: the payload must say so.
    const b = bundle(
        [msg('m1', 'model', [
            { type: 'paragraph', children: [{ type: 'text', text: 'see attached' }] },
        ], { associatedAssetIds: ['comp-img'] })],
        { assets: [
            { id: 'comp-img', kind: 'image', name: 'comp.png', mimeType: 'image/png', status: 'available' },
        ] },
    );
    const { payload, diagnostics } = toTypstPayload(b, opts); // opts.assetPath always returns undefined
    const attachments = payload.messages[0].attachments ?? [];
    assert.strictEqual(attachments.length, 0, 'unresolvable companion image must not vanish silently');
    const d = diagnostics.find((x: any) => x.code === 'TYPST_V8_ASSOCIATED_IMAGE_MISSING');
    assert.ok(d, 'must emit TYPST_V8_ASSOCIATED_IMAGE_MISSING');
    assert.strictEqual(d.severity, 'warning');
    assert.strictEqual(d.path, 'message:m1/attachment:comp-img');
});

test('associated image companion with a path renders trailing attachment without diagnostic', async () => {
    const b = bundle(
        [msg('m1', 'model', [
            { type: 'paragraph', children: [{ type: 'text', text: 'see attached' }] },
        ], { associatedAssetIds: ['comp-img'] })],
        { assets: [
            { id: 'comp-img', kind: 'image', name: 'comp.png', mimeType: 'image/png', status: 'available' },
        ] },
    );
    const { payload, diagnostics } = toTypstPayload(b, { assetPath: (a: any) => `assets/${a.id}.png` });
    const attachments = payload.messages[0].attachments ?? [];
    assert.strictEqual(attachments.length, 1);
    assert.strictEqual((attachments[0] as any).type, 'image');
    assert.strictEqual((attachments[0] as any).asset, 'assets/comp-img.png');
    assert.ok(!diagnostics.some((x: any) => x.code === 'TYPST_V8_ASSOCIATED_IMAGE_MISSING'),
        'resolved companion must not emit the missing diagnostic');
});

test('collectUnplacedAssociatedImageIds: block-placed, non-image and unknown ids excluded', async () => {
    // Both consumers (resourceStage binary resolution and the payload's
    // trailing attachment emission) import this same symbol from the
    // canonical module, so this one unit test pins the shared rule.
    const { collectUnplacedAssociatedImageIds } = require('../src/core/export/canonical/assetReferences.js');
    const message: any = {
        id: 'm1',
        blocks: [
            { type: 'image', assetId: 'blk-img' },
            { type: 'paragraph', children: [{ type: 'image', assetId: 'inl-img' }] },
        ],
        associatedAssetIds: ['blk-img', 'comp-img', 'comp-doc', 'ghost-img'],
    };
    const referenced = new Set(['blk-img', 'inl-img']);
    const kindOf = (id: string) =>
        ({ 'comp-img': 'image', 'comp-doc': 'file' } as Record<string, string | undefined>)[id];
    const out = collectUnplacedAssociatedImageIds(message, referenced, kindOf);
    assert.deepStrictEqual([...out].sort(), ['comp-img'],
        'only unplaced kind:image companions qualify (ghost-img unknown -> excluded like the payload skips it)');
});
