/**
 * tests/canonical-html-projection.test.ts
 * HTML renderer honors the shared canonical contracts:
 *
 * 1. Branch projection: a branched conversation renders ONLY the selected
 *    root->leaf path via projectConversation() -- never all branches
 *    flattened in sibling order.
 * 2. Asset collection: inline images (paragraph/heading/table cells) enter
 *    the companion resource plan through the shared
 *    collectReferencedAssetIds() helper (block tree + inline tree), so the
 *    plan can never miss an asset the document actually references.
 */
export {};
const test = require('node:test');
const assert = require('node:assert');

const {
    renderCanonicalHtml,
    CanonicalHtmlRenderer,
    collectReferencedAssetIds,
} = require('../src/core/export/canonical/index.js');

function textMsg(id: string, parentId: string | null, role: string, text: string): any {
    return {
        id,
        parentId,
        role,
        blocks: [{ type: 'paragraph', children: [{ type: 'text', text }] }],
    };
}

function branchedBundle(): any {
    return {
        schemaVersion: 1,
        conversation: {
            key: { providerId: 'gemini', conversationId: 'branch_001' },
            messages: [
                textMsg('m-a1', null, 'user', 'question-A1-root'),
                textMsg('m-b1', 'm-a1', 'model', 'answer-B1-branch-one'),
                textMsg('m-c1', 'm-b1', 'user', 'followup-C1-branch-one'),
                textMsg('m-b2', 'm-a1', 'model', 'answer-B2-branch-two'),
                textMsg('m-c2', 'm-b2', 'user', 'followup-C2-branch-two'),
            ],
            selectedLeafMessageId: 'm-c2',
        },
        assets: [],
        citations: [],
    };
}

test('branched conversation renders only the selected branch', () => {
    const { html, projectedMessageIds } = renderCanonicalHtml(branchedBundle(), { lang: 'en' });
    assert.deepStrictEqual(projectedMessageIds, ['m-a1', 'm-b2', 'm-c2']);
    assert.ok(html.includes('question-A1-root'), 'root renders');
    assert.ok(html.includes('answer-B2-branch-two'), 'selected branch renders');
    assert.ok(html.includes('followup-C2-branch-two'), 'selected leaf renders');
    assert.ok(!html.includes('answer-B1-branch-one'), 'unselected branch must not render');
    assert.ok(!html.includes('followup-C1-branch-one'), 'unselected branch must not render');
});

test('no selection renders all messages in source order', () => {
    const bundle = branchedBundle();
    delete bundle.conversation.selectedLeafMessageId;
    const { html, projectedMessageIds } = renderCanonicalHtml(bundle, { lang: 'en' });
    assert.deepStrictEqual(
        projectedMessageIds,
        ['m-a1', 'm-b1', 'm-c1', 'm-b2', 'm-c2'],
        'no-selection policy: all messages in source order',
    );
    assert.ok(html.includes('answer-B1-branch-one'));
    assert.ok(html.includes('answer-B2-branch-two'));
});

test('shared collectReferencedAssetIds sees inline images everywhere', () => {
    const blocks: any = [
        {
            type: 'paragraph',
            children: [
                { type: 'text', text: 'before ' },
                { type: 'image', assetId: 'img-para', alt: 'para' },
                { type: 'text', text: ' after' },
            ],
        },
        {
            type: 'heading',
            level: 2,
            children: [{ type: 'image', assetId: 'img-heading', alt: 'h' }],
        },
        {
            type: 'table',
            headerRows: [],
            rows: [
                { cells: [{ children: [{ type: 'image', assetId: 'img-cell', alt: 'c' }] }] },
            ],
        },
        { type: 'image', assetId: 'img-block', alt: 'b' },
    ];
    const ids = collectReferencedAssetIds(blocks);
    assert.deepStrictEqual(
        [...ids].sort(),
        ['img-block', 'img-cell', 'img-heading', 'img-para'],
    );
});

test('inline image assets enter the HTML companion resource plan', async () => {
    const bundle: any = {
        schemaVersion: 1,
        conversation: {
            key: { providerId: 'gemini', conversationId: 'inline_asset_001' },
            messages: [
                {
                    id: 'm-1',
                    parentId: null,
                    role: 'model',
                    blocks: [
                        {
                            type: 'paragraph',
                            children: [
                                { type: 'text', text: 'diagram: ' },
                                { type: 'image', assetId: 'img-1', alt: 'architecture' },
                            ],
                        },
                    ],
                },
            ],
        },
        assets: [
            { id: 'img-1', kind: 'image', mimeType: 'image/png', status: 'available', storageRef: 'assets/img-1.png' },
        ],
        citations: [],
    };
    const context: any = {
        bundle,
        locale: 'en',
        signal: new AbortController().signal,
        reportProgress() {},
        assets: {
            resolve: async (assetId: string) => {
                const asset = bundle.assets.find((a: any) => a.id === assetId);
                if (!asset) return null;
                return { asset, renderUrl: `assets/${assetId}.png` };
            },
        },
    };
    const renderer = new CanonicalHtmlRenderer({});
    const artifact = await renderer.render(context);
    assert.ok(
        artifact.companionResourceIds.includes('img-1'),
        'inline image asset must be in companionResourceIds',
    );
    assert.ok(
        artifact.companionPlan.resourceIds.includes('img-1'),
        'inline image asset must be in the companion plan',
    );
    assert.ok(artifact.content.includes('<img'), 'html references the image');
    assert.ok(
        artifact.content.includes('assets/img-1.png'),
        'html uses the resolved asset url',
    );
});
