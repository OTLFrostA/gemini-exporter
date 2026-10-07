import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preparePdfItem } from '../src/core/export/pdf/prepareItem.js';
import { parseProviderConversation } from '../src/core/compatibility/conversationParser.js';
import type { GeminiNormalizationInput } from '../src/core/compatibility/gemini/exportInput.js';

for (const layout of ['messages', 'turns'] as const) {
    test(`PDF ${layout}: typeless historical image, unknown content and role survive normalization`, async () => {
        const message = {
            role: 'historical-tool',
            content: { historical: ['payload', 42] },
            images: [{ url: 'https://example.com/generated' }],
        };
        const raw = {
            id: 'boundary-regression',
            ...(layout === 'messages' ? { messages: [message] } : { turns: [{ messages: [message] }] }),
        };
        const snapshot = structuredClone(raw);
        const result = await preparePdfItem(raw, { includeAssets: false });
        assert.equal(result.ok, true);
        assert.equal(result.resources.size, 1);
        const node = result.document.messages[0];
        assert.equal(node.label, 'unknown');
        assert.equal(node.heading?.text, 'historical-tool');
        const unknownBlock = node.blocks.find((block) => block.type === 'unsupported');
        assert.ok(unknownBlock && unknownBlock.type === 'unsupported');
        assert.match(unknownBlock.text, /historical.*payload.*42/);
        assert.ok(result.diagnostics.some((d) => d.code === 'UNKNOWN_MESSAGE_CONTENT'));
        assert.ok(result.diagnostics.some((d) => d.code === 'UNKNOWN_ROLE'));
        assert.deepEqual(raw, snapshot);
    });
}

test('provider parser contract accepts missing metadata and historical aliases without coercing input', async () => {
    const raw: GeminiNormalizationInput = {
        messages: [{ role: 'tool', content: 17, images: [{ src: 'https://example.com/generated', fileName: 'historical' }] }],
    };
    const snapshot = structuredClone(raw);
    const { conversation: domain, diagnostics } = await parseProviderConversation(raw);
    assert.equal(domain.assets[0].kind, 'image');
    assert.equal(domain.assets[0].name, 'historical');
    assert.equal(domain.messages[0].provenance?.rawRole, 'tool');
    assert.ok(diagnostics.some((d) => d.code === 'UNKNOWN_MESSAGE_CONTENT'));
    assert.deepEqual(raw, snapshot);
});
