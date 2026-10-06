import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DomainConversationDetail } from '../src/core/domain/conversationDetail.js';
import { normalizeDomainConversation } from '../src/core/export/canonical/gemini/normalizeDomainConversation.js';
import { toCanonicalDomainMessage } from '../src/core/domain/canonicalInputAdapter.js';
import { normalizeGeminiConversation } from '../src/core/export/canonical/gemini/normalizeConversation.js';
import { normalizeCanonicalConversation } from '../src/core/export/canonical/normalizeConversation.js';

const metadata = { id: 'semantic', title: 'Semantic input', timestamp: null, providerId: 'other', assets: [] };

test('shared Canonical construction contains no body parsing or provider-format decisions', () => {
    for (const file of ['normalizeMessage.ts', 'normalizeConversation.ts', 'messageInput.ts', 'gemini/normalizeAssets.ts']) {
        const source = readFileSync(join(__dirname, '../src/core/export/canonical', file), 'utf8');
        assert.doesNotMatch(source, /parseMarkdown|parseGemini|preprocessGemini|structuredContent|geminiStructuredTo/);
        assert.doesNotMatch(source, /from\s+['"][^'"]*(?:api\/parser|provider\/gemini)[^'"]*['"]/);
    }
});

test('Domain semantic nodes are reused by Canonical and raw Markdown-looking text remains literal', async () => {
    const domain: DomainConversationDetail = { ...metadata, messages: [{
        id: 'message', role: 'assistant', content: [
            { type: 'paragraph', children: [{ type: 'text', text: '**literal** $x$ ![not an image](file.png)' }] },
            { type: 'unknown', sourceType: 'semantic-extension', text: 'visible unknown' },
        ],
    }] };
    const original = structuredClone(domain);
    const input = toCanonicalDomainMessage(domain.messages[0], 'messages[0]', new Map());
    assert.equal(input.message.content, domain.messages[0].content);
    const result = await normalizeCanonicalConversation(domain, [input], { providerId: 'other' });
    assert.equal(result.bundle.conversation.messages[0].blocks[0], domain.messages[0].content[0]);
    assert.equal(result.bundle.conversation.messages[0].blocks[1], domain.messages[0].content[1]);
    assert.equal(result.bundle.assets.length, 0);
    assert.deepEqual(domain, original);
});

test('separate reasoning presentation does not reinterpret the Domain body', async () => {
    const domain: DomainConversationDetail = { ...metadata, messages: [{
        role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'text', text: '**literal body**' }] }],
        reasoning: [{ type: 'paragraph', children: [{ type: 'strong', children: [{ type: 'text', text: 'formatted reasoning' }] }] }],
    }] };
    const result = await normalizeDomainConversation(domain);
    const [reasoning, body] = result.bundle.conversation.messages[0].blocks;
    assert.ok(reasoning.type === 'thought' && reasoning.blocks[0].type === 'paragraph');
    assert.equal(reasoning.blocks[0].children[0].type, 'strong');
    assert.equal(body, domain.messages[0].content[0]);
    assert.equal(reasoning.blocks, domain.messages[0].reasoning);
});

test('legacy compatibility preserves source positional identity after rejecting malformed entries', async () => {
    const result = await normalizeGeminiConversation({ id: 'legacy', messages: [
        null as never,
        { role: 'assistant', content: { unsupported: 'visible fallback' } },
    ] });
    assert.equal(result.bundle.conversation.messages[0].id, 'msg-1');
    assert.equal(result.bundle.conversation.messages[0].blocks[0].type, 'unknown');
    assert.equal(result.diagnostics.filter(d => d.code === 'BAD_MESSAGE_SHAPE').length, 1);
});
