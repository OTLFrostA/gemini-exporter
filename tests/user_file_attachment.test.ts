import { composeFixture } from './helpers/documentFixture.js';
const { historicalFixture } = require('./helpers/nativeFixture.js');
export {};
const test = require('node:test');
const assert = require('node:assert');
import { renderDocumentMarkdown } from '../src/l4/format/markdown/renderMarkdown.js';

// L1 user-file source extraction contracts live in `tests/l1_extracted_regressions.test.ts`.
// This suite covers cross-layer L2 -> L3b -> L4 Markdown rendering of user file attachments.

test('user_file_attachment: Markdown renderer renders clean attachment link without URL leakage', async () => {
    const mockChat = {
        id: '273175',
        title: 'Gemini 架构设计评估报告',
        url: 'https://gemini.google.com/app/273175',
        timestamp: 1700000000000,
        messages: [
            {
                role: 'user',
                content: '请评估这个架构',
                attachments: [
                    {
                        type: 'file',
                        title: 'architecture.md',
                        localName: 'files/273175_architecture.md',
                        name: 'architecture.md',
                    },
                    {
                        type: 'file',
                        title: 'custom_data.xyz',
                        localName: 'files/273175_custom_data.xyz',
                        name: 'custom_data.xyz',
                    },
                ],
            },
            {
                role: 'model',
                content: '架构评估完成。',
            },
        ],
    };

    const parsed = historicalFixture(mockChat);
    const { document, resources } = await composeFixture(parsed.conversation, parsed.resourceHints);
    const markdown = renderDocumentMarkdown(document, resources);
    assert.ok(markdown.includes('[architecture.md](files/273175_architecture.md)'), 'Must render clean Markdown link for architecture.md');
    assert.ok(markdown.includes('[custom\\_data.xyz](files/273175_custom_data.xyz)'), 'Must render clean Markdown link for custom_data.xyz');
    assert.ok(!markdown.includes('https___contribution'), 'Must NOT contain sanitized URL artifacts in Markdown');
    assert.ok(!markdown.includes('[https://'), 'Must NOT render URL as link title');
});

test('user_file_attachment: Markdown renderer preserves a supplied resource label without inferring one from its destination', async () => {
    const mockChat = {
        id: '273175',
        title: 'Leaked URL Title Test',
        messages: [
            {
                role: 'user',
                content: 'Test message',
                attachments: [
                    {
                        type: 'file',
                        title: 'https://contribution.usercontent.google.com/download?c=123&filename=leaked.json',
                        localName: 'files/273175_leaked.json',
                    },
                ],
            },
        ],
    };

    const parsed = historicalFixture(mockChat);
    const { document, resources } = await composeFixture(parsed.conversation, parsed.resourceHints);
    const markdown = renderDocumentMarkdown(document, resources);
    assert.ok(markdown.includes('[https://contribution.usercontent.google.com/download?c=123&amp;filename=leaked.json]'),
        'Composer preserves a supplied nonempty source name; it cannot reinterpret it as missing');
    assert.ok(markdown.includes('files/273175_leaked.json'), 'Must keep localName path');
    assert.ok(!markdown.includes('[leaked.json]'), 'Destination basename cannot replace a supplied source label');
});
