import { useIndexStorage } from './helpers/indexStorage.js';
useIndexStorage();
import { historicalFixture } from './helpers/nativeFixture.js';
import { parseConversation } from '../src/l1/parsers/parseConversation.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preparePdfItem } from './helpers/pdfAcquisitionFixture.js';
import type { ConversationRecordInput } from './helpers/recordFixture/conversationRecord.js';

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
        const result = await preparePdfItem(historicalFixture(raw), { accountId: '10000000-0000-4000-8000-000000000001', ...({ includeAssets: false }) });
        assert.equal(result.ok, true);
        assert.equal(result.resources.size, 1);
        const node = result.document.messages[0];
        assert.equal(node.label, 'unknown');
        assert.ok(!('heading' in node));
        const unknownBlock = node.blocks.find((block) => block.type === 'unsupported');
        assert.ok(unknownBlock && unknownBlock.type === 'unsupported');
        assert.match(unknownBlock.text, /historical.*payload.*42/);
        assert.ok(result.diagnostics.some((d) => d.code === 'UNKNOWN_MESSAGE_CONTENT'));
        assert.ok(result.diagnostics.some((d) => d.code === 'UNKNOWN_ROLE'));
        assert.deepEqual(raw, snapshot);
    });
}

test('provider parser contract accepts missing metadata and historical aliases without coercing input', async () => {
    const raw: ConversationRecordInput = {
        messages: [{ role: 'tool', content: 17, images: [{ src: 'https://example.com/generated', fileName: 'historical' }] }],
    };
    const snapshot = structuredClone(raw);
    const { conversation: domain, diagnostics } = await historicalFixture(raw, { providerId: 'gemini' });
    assert.equal(domain.detail.assets[0].kind, 'image');
    assert.equal(domain.detail.assets[0].name, 'historical');
    assert.equal(Object.hasOwn(domain.detail.messages[0], 'provenance'), false);
    assert.ok(diagnostics.some((d) => d.code === 'UNKNOWN_MESSAGE_CONTENT'));
    assert.deepEqual(raw, snapshot);
});
