export {};
const test = require('node:test');
const assert = require('node:assert');

const { renderCanonicalHtml } = require('../src/core/export/canonical/renderCanonicalHtml.js');

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

const imageAsset = (id: string) => ({ id, kind: 'image', name: `${id}.png`, mimeType: 'image/png', status: 'available' });

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
