export {};
const test = require('node:test');
const assert = require('node:assert');

const {
    resolveUnknownBlockFallback,
    formatUnknownPayload,
    unknownBlockFallbackText,
} = require('../src/core/export/canonical/unknownFallback.js');
const { toTypstPayload } = require('../src/core/export/typst/payload.js');
const { renderCanonicalHtml } = require('../src/core/export/canonical/renderCanonicalHtml.js');

function unk(extra: any) {
    return { id: 'u1', type: 'unknown', sourceType: 'gemini.mystery', ...extra };
}

function bundle(messages: any[]) {
    return {
        schemaVersion: 1,
        conversation: {
            key: { providerId: 'gemini', accountId: 't', conversationId: 'c1' },
            title: { value: 't', source: 'derived', candidates: [] },
            createdAt: '2026-09-20T10:00:00Z',
            messages,
        },
        assets: [],
        citations: [],
    };
}

function msg(blocks: any[]) {
    return { id: 'm1', role: 'model', blocks };
}

const opts = { assetPath: (_a: any) => undefined };

test('resolver priority: blocks > payload > rawRef > generic', () => {
    assert.strictEqual(
        resolveUnknownBlockFallback(unk({ fallbackBlocks: [{ id: 'p', type: 'paragraph', children: [] }] })).kind,
        'blocks',
    );
    const withPayload = resolveUnknownBlockFallback(unk({ payload: { b: 1 } }));
    assert.strictEqual(withPayload.kind, 'payload');
    const withRef = resolveUnknownBlockFallback(unk({ rawRef: 'raw/x.json' }));
    assert.strictEqual(withRef.kind, 'rawRef');
    assert.ok(withRef.text.includes('raw/x.json'));
    const generic = resolveUnknownBlockFallback(unk({}));
    assert.strictEqual(generic.kind, 'generic');
    assert.ok(generic.text.includes('gemini.mystery'));
});

test('payload stringify is deterministic and depth-limited', () => {
    const { text, truncated } = formatUnknownPayload({ z: 1, a: 2 } as any);
    assert.strictEqual(truncated, false);
    assert.ok(text.indexOf('"a"') < text.indexOf('"z"'));
    const deep = formatUnknownPayload({ a: { b: { c: { d: { e: 1 } } } } } as any);
    assert.ok(deep.text.includes('{…}'));
    assert.strictEqual(deep.truncated, false);
});

test('oversized payload is length-truncated', () => {
    const big = formatUnknownPayload({ s: 'x'.repeat(5000) } as any);
    assert.strictEqual(big.truncated, true);
    assert.ok(big.text.endsWith('…'));
    assert.ok(big.text.length <= 2001);
});

test('text extraction shows payload content', () => {
    const text = unknownBlockFallbackText(unk({ payload: { note: 'hello' } }) as any);
    assert.ok(text.includes('hello'));
});

test('typst payload-only unknown carries readable fallback', () => {
    const b = bundle([msg([unk({ payload: { widget: 'carousel', n: 3 } })])]);
    const { payload, diagnostics } = toTypstPayload(b, opts);
    const node = payload.messages[0].blocks[0];
    assert.strictEqual(node.type, 'unknown');
    assert.ok(node.fallback.includes('carousel'));
    assert.ok(!diagnostics.some((d: any) => d.code === 'TYPST_UNKNOWN_PAYLOAD_TRUNCATED'));
});

test('typst truncated payload emits diagnostic', () => {
    const b = bundle([msg([unk({ payload: { s: 'y'.repeat(5000) } })])]);
    const { payload, diagnostics } = toTypstPayload(b, opts);
    assert.ok(payload.messages[0].blocks[0].fallback.endsWith('…'));
    assert.ok(diagnostics.some((d: any) => d.code === 'TYPST_UNKNOWN_PAYLOAD_TRUNCATED'));
});

test('html payload-only unknown renders pre block', () => {
    const b = bundle([msg([unk({ payload: { widget: 'carousel' } })])]);
    const out = renderCanonicalHtml(b, { lang: 'en' });
    assert.ok(out.html.includes('gem-unknown-payload'));
    assert.ok(out.html.includes('carousel'));
});

test('html truncated payload emits warning diagnostic', () => {
    const b = bundle([msg([unk({ payload: { s: 'z'.repeat(5000) } })])]);
    const out = renderCanonicalHtml(b, { lang: 'en' });
    assert.ok(out.diagnostics.some((d: any) => d.code === 'HTML_UNKNOWN_PAYLOAD_TRUNCATED'));
});
