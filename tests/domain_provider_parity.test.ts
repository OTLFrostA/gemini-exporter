import { historicalFixture, historicalFixtureDomain } from './helpers/nativeFixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HistoricalConversation as Conversation } from './helpers/historicalConversation.js';
import { composeFixture } from './helpers/documentFixture.js';
import type { DocumentAst, DisplayBlock } from '../src/l3b/ast/ast.js';

async function assertDomainDocument(conversation: Conversation, expected: DocumentAst): Promise<void> {
    const { conversation: domain, resourceHints } = historicalFixture(conversation);
    const result = await composeFixture(domain, resourceHints);
    assert.deepEqual(result.document, expected);
}

const paragraph = (text: string): DisplayBlock => ({ type: 'paragraph', children: [{ type: 'text', text }] });
const reasoning = (text: string): DisplayBlock => ({
    type: 'disclosure', kind: 'reasoning', title: 'Thinking Process', blocks: [paragraph(text)],
});
const expectedMetadata = { id: 'd2-conversation', provider: 'gemini' };

const metadata = {
    id: 'd2-conversation',
    title: 'Document parity',
    timestamp: 1_700_000_000_000,
};

test('Domain composition preserves provider parsing for an RPC conversation', async () => {
    const conversation: Conversation = {
        ...metadata,
        updatedAt: 1_700_000_001_000,
        url: 'https://gemini.google.com/app/d2-conversation',
        messages: [
            { id: 'user-1', role: 'user', content: 'Question', timestamp: 1_700_000_000_000 },
            { id: 'model-1', role: 'model', content: 'Answer', timestamp: 1_700_000_001_000 },
        ],
    };
    await assertDomainDocument(conversation, {
        title: 'Document parity',
        metadata: { ...expectedMetadata, updatedAt: 1_700_000_001_000 },
        messages: [
            { role: 'user', timestamp: 1_700_000_000_000, blocks: [paragraph('Question')] },
            { role: 'assistant', timestamp: 1_700_000_001_000, blocks: [paragraph('Answer')] },
        ],
    });
});

test('Domain composition preserves provider parsing for attachments and generated media', async () => {
    const conversation: Conversation = {
        ...metadata,
        messages: [{
            role: 'model', content: 'Generated image',
            attachments: [{
                type: 'image', isGenerated: true, url: 'https://example.test/generated.png',
                generation: {
                    chatId: metadata.id, providerRequestId: 'request-42', time: null,
                    prompt: 'A blue bird', generationOrdinal: 1, imageCount: 1, imageOrdinal: 0,
                },
            }],
        }],
    };
    await assertDomainDocument(conversation, {
        title: 'Document parity', metadata: expectedMetadata,
        messages: [{ role: 'assistant', blocks: [
            paragraph('Generated image'),
            { type: 'image', resourceId: 'resource-307c26709cfd66cc', alt: 'Image' },
        ] }],
    });
});

test('Domain composition preserves provider parsing for citations and documents', async () => {
    const conversation: Conversation = {
        ...metadata,
        messages: [{
            role: 'assistant', content: 'Research [1]', thoughts: 'Considering sources',
            citations: [{ url: 'https://example.test/source', title: 'Source' }],
            documents: [{
                type: 'doc', id: 'doc-1', title: 'Research report',
                url: 'https://example.test/report', contentMarkdown: '# Findings', sections: ['Findings'],
                links: [{ title: 'Source', url: 'https://example.test/source' }],
            }],
        }],
    };
    await assertDomainDocument(conversation, {
        title: 'Document parity', metadata: expectedMetadata,
        messages: [{ role: 'assistant', blocks: [
            reasoning('Considering sources'),
            { type: 'paragraph', children: [
                { type: 'text', text: 'Research ' },
                { type: 'citation', id: 'citation-0', label: '[1]', href: 'https://example.test/source' },
            ] },
            { type: 'file', resourceId: 'resource-51a850dd7c9aaa21', label: 'Research report', kind: 'file', byteLength: 10 },
        ], sources: [{ id: 'citation-0', label: 'Source', href: 'https://example.test/source', number: 1 }] }],
    });
});

test('Domain composition preserves provider parsing after flattening turns-only input', async () => {
    const conversation: Conversation = {
        ...metadata,
        source: 'takeout',
        turns: [
            { timestamp: 1_700_000_000_000, userContent: 'Question', modelContent: 'Answer', thoughts: ['Reasoning'] },
            { messages: [{ role: 'user', content: 'Follow-up', timestamp: null }, { role: 'model', content: 'Follow-up answer' }] },
        ],
    };
    const domain = historicalFixtureDomain(conversation);
    assert.equal('turns' in domain, false);
    assert.deepEqual(domain.detail.messages.map((message) => message.role), ['user', 'assistant', 'user', 'assistant']);
    await assertDomainDocument(conversation, {
        title: 'Document parity', metadata: expectedMetadata,
        messages: [
            { role: 'user', timestamp: 1_700_000_000_000, blocks: [paragraph('Question')] },
            { role: 'assistant', timestamp: 1_700_000_000_000, blocks: [reasoning('Reasoning'), paragraph('Answer')] },
            { role: 'user', blocks: [paragraph('Follow-up')] },
            { role: 'assistant', blocks: [paragraph('Follow-up answer')] },
        ],
    });
});
