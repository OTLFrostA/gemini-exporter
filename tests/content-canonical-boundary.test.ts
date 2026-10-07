import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DomainConversationDetail } from '../src/core/domain/conversationDetail.js';
import { composeDomainDocument } from '../src/core/export/document/composeDomainDocument.js';
import { parseProviderConversation } from '../src/core/provider/conversationParser.js';
import { collectDocumentResources } from '../src/core/export/document/resourceReferences.js';

const metadata = { id: 'semantic', title: 'Semantic input', timestamp: null, providerId: 'other', assets: [] };

test('Document composition contains no body parsing or provider-format decisions', () => {
    for (const file of ['composeDomainDocument.ts', 'composeContent.ts']) {
        const source = readFileSync(join(__dirname, '../src/core/export/document', file), 'utf8');
        assert.doesNotMatch(source, /parseMarkdown|parseGemini|preprocessGemini|structuredContent|geminiStructuredTo/);
        assert.doesNotMatch(source, /from\s+['"][^'"]*(?:api\/parser|provider\/gemini)[^'"]*['"]/);
    }
});

test('Domain semantic nodes are composed without reparsing and raw Markdown-looking text remains literal', async () => {
    const domain: DomainConversationDetail = { ...metadata, messages: [{
        id: 'message', role: 'assistant', content: [
            { type: 'paragraph', children: [{ type: 'text', text: '**literal** $x$ ![not an image](file.png)' }] },
            { type: 'unknown', sourceType: 'semantic-extension', text: 'visible unknown' },
        ],
    }] };
    const original = structuredClone(domain);
    const { document } = composeDomainDocument(domain);
    assert.deepEqual(document.messages[0].blocks[0], domain.messages[0].content[0]);
    assert.deepEqual(document.messages[0].blocks[1], { type: 'unsupported', sourceType: 'semantic-extension', text: 'visible unknown' });
    assert.equal(collectDocumentResources(document).referencedIds.size, 0);
    assert.deepEqual(domain, original);
});

test('separate reasoning presentation does not reinterpret the Domain body', async () => {
    const domain: DomainConversationDetail = { ...metadata, messages: [{
        role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'text', text: '**literal body**' }] }],
        reasoning: [{ type: 'paragraph', children: [{ type: 'strong', children: [{ type: 'text', text: 'formatted reasoning' }] }] }],
    }] };
    const result = composeDomainDocument(domain);
    const [reasoning, body] = result.document.messages[0].blocks;
    assert.ok(reasoning.type === 'disclosure' && reasoning.blocks[0].type === 'paragraph');
    assert.equal(reasoning.blocks[0].children[0].type, 'strong');
    assert.deepEqual(body, domain.messages[0].content[0]);
    assert.deepEqual(reasoning.blocks, domain.messages[0].reasoning);
});

test('provider parsing diagnoses malformed entries at their source position without mutating input', async () => {
    const raw = { id: 'legacy', messages: [
        null as never,
        { role: 'assistant', content: { unsupported: 'visible fallback' } },
    ] };
    const original = structuredClone(raw);
    const result = parseProviderConversation(raw);
    assert.equal(result.conversation.messages.length, 1);
    assert.deepEqual(raw, original);
    assert.equal(result.diagnostics.find(d => d.code === 'BAD_MESSAGE_SHAPE')?.path, 'messages[0]');
    assert.equal(result.conversation.messages[0].content[0].type, 'unknown');
    assert.equal(result.diagnostics.filter(d => d.code === 'BAD_MESSAGE_SHAPE').length, 1);
});
