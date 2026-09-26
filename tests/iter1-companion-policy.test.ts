export {};
const test = require('node:test');
const assert = require('node:assert');

const { toTypstPayload } = require('../src/core/export/typst/payload.js');
const { renderCanonicalHtml } = require('../src/core/export/canonical/renderCanonicalHtml.js');
const { validateBundle } = require('../src/core/export/canonical/validate.js');

function bundle(messages: any[], assets: any[] = []) {
    return {
        schemaVersion: 1,
        conversation: {
            key: { providerId: 'gemini', accountId: 't', conversationId: 'c1' },
            title: { value: 't', source: 'derived', candidates: [] },
            createdAt: '2026-09-20T10:00:00Z',
            messages,
        },
        assets,
        citations: [],
    };
}

function msg(id: string, role: string, blocks: any[], extra: any = {}) {
    return { id, role, blocks, ...extra };
}

function toolResult(callId: string, assetIds: string[], displayBlocks: any[] = []) {
    return { id: `tr-${callId}`, type: 'toolResult', callId, assetIds, displayBlocks };
}

const imageAsset = (id: string) => ({ id, kind: 'image', name: `${id}.png`, mimeType: 'image/png', status: 'available' });
const fileAsset = (id: string) => ({ id, kind: 'file', name: `${id}.pdf`, mimeType: 'application/pdf', status: 'available' });

test('toolResult.assetIds image becomes a Typst trailing image attachment', () => {
    const b = bundle(
        [msg('t1', 'tool', [toolResult('c1', ['tool-img'], [{ id: 'p1', type: 'paragraph', children: [{ type: 'text', text: 'done' }] }])])],
        [imageAsset('tool-img')],
    );
    const { payload, diagnostics } = toTypstPayload(b, { assetPath: (a: any) => `assets/${a.id}.png` });
    const attachments = payload.messages[0].attachments ?? [];
    assert.strictEqual(attachments.length, 1);
    assert.strictEqual(attachments[0].type, 'image');
    assert.strictEqual(attachments[0].asset, 'assets/tool-img.png');
    assert.ok(!diagnostics.some((x: any) => x.code === 'ASSET_UNRESOLVED'));
});

test('asset placed in displayBlocks is not duplicated as a trailing companion', () => {
    const b = bundle(
        [msg('t1', 'tool', [toolResult('c1', ['tool-img'], [{ id: 'i1', type: 'image', assetId: 'tool-img' }])])],
        [imageAsset('tool-img')],
    );
    const { payload } = toTypstPayload(b, { assetPath: (a: any) => `assets/${a.id}.png` });
    assert.strictEqual(payload.messages[0].attachments, undefined);
});

test('same asset in associatedAssetIds and toolResult.assetIds renders once', () => {
    const b = bundle(
        [msg('t1', 'tool', [toolResult('c1', ['shared'])], { associatedAssetIds: ['shared'] })],
        [imageAsset('shared')],
    );
    const { payload } = toTypstPayload(b, { assetPath: (a: any) => `assets/${a.id}.png` });
    const attachments = payload.messages[0].attachments ?? [];
    assert.strictEqual(attachments.length, 1);
});

test('toolResult.assetIds file becomes a metadata-only file attachment', () => {
    const b = bundle(
        [msg('t1', 'tool', [toolResult('c1', ['tool-doc'])])],
        [fileAsset('tool-doc')],
    );
    const { payload } = toTypstPayload(b, { assetPath: (a: any) => `assets/${a.id}` });
    const attachments = payload.messages[0].attachments ?? [];
    assert.strictEqual(attachments.length, 1);
    assert.strictEqual(attachments[0].type, 'file');
    assert.strictEqual(attachments[0].name, 'tool-doc.pdf');
});

test('HTML renders toolResult.assetIds companions with the same dedup rule', () => {
    const b = bundle(
        [msg('t1', 'tool', [toolResult('c1', ['tool-img', 'tool-doc', 'placed-img'], [{ id: 'i1', type: 'image', assetId: 'placed-img' }])])],
        [imageAsset('tool-img'), fileAsset('tool-doc'), imageAsset('placed-img')],
    );
    const out = renderCanonicalHtml(b, { assetUrl: (_a: any) => 'https://example.com/a.png' });
    const cards = out.html.match(/<a class="gem-att-card/g) || [];
    assert.strictEqual(cards.length, 3);
    assert.ok(out.html.includes('tool-img.png'));
    assert.ok(out.html.includes('tool-doc.pdf'));
    assert.strictEqual(out.html.split('placed-img.png').length - 1, 3);
});

test('HTML renders associatedAssetIds companions and dedups against placements', () => {
    const b = bundle(
        [msg('m1', 'model', [{ id: 'i1', type: 'image', assetId: 'placed' }], { associatedAssetIds: ['placed', 'comp-img'] })],
        [imageAsset('placed'), imageAsset('comp-img')],
    );
    const out = renderCanonicalHtml(b, { assetUrl: (_a: any) => 'https://example.com/a.png' });
    const cards = out.html.match(/<a class="gem-att-card/g) || [];
    assert.strictEqual(cards.length, 2);
    assert.ok(out.html.includes('comp-img.png'));
});

test('validator reports toolResult.assetIds pointing at a missing asset', () => {
    const b = bundle([msg('t1', 'tool', [toolResult('c1', ['ghost'])])], []);
    const diags = validateBundle(b);
    const hit = diags.find((d: any) => d.code === 'ASSET_UNRESOLVED' && d.severity === 'error');
    assert.ok(hit);
});
