import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BlockNode } from '../src/core/content/blocks.js';
import { mapContentAssetReferences } from '../src/core/content/assetReferences.js';
import { parseMarkdownToBlocks } from '../src/core/content/markdown/index.js';
import { parseGeminiBody } from '../src/core/provider/gemini/contentAdapter.js';
import { toDomainConversationDetail } from '../src/core/domain/legacyConversationAdapter.js';
import { normalizeDomainConversation } from '../src/core/export/canonical/gemini/normalizeDomainConversation.js';
import { normalizeGeminiConversation } from '../src/core/export/canonical/gemini/normalizeConversation.js';
import type { Conversation } from '../src/types/conversation.js';

const paragraph = (text: string): BlockNode[] => [{ type: 'paragraph', children: [{ type: 'text', text }] }];
const metadata = { id: 'content-input', title: 'Content boundary', timestamp: null };

test('Gemini chooses provider structure before Domain and does not reinterpret structured text as Markdown', () => {
    const domain = toDomainConversationDetail({ ...metadata, messages: [{
        role: 'model', content: 'raw **fallback**',
        structuredContent: { children: [{ nodeType: 18, text: '**literal structure**' }] },
    }] });
    assert.deepEqual(domain.messages[0].contentAst, paragraph('**literal structure**'));
});

for (const structured of [
    { children: [{ nodeType: 99, text: 'unsupported' }] },
    { children: [{ nodeType: 20, items: [{ children: [{ nodeType: 99 }] }] }] },
    { children: [{ nodeType: 18, text: 'bad', annotations: [null] }] },
    { children: [{ nodeType: 18, text: 'bad', annotations: { length: 1 } }] },
    { children: [{ nodeType: 18, text: 'bad', annotations: [{ start: 0, end: 100, type: 0 }] }] },
    { children: [{ nodeType: 17, rows: [{ cells: null }] }] },
    { children: [] },
]) {
    test(`malformed or unsupported structured input preserves its full Markdown fallback: ${JSON.stringify(structured)}`, () => {
        assert.deepEqual(parseGeminiBody('# Visible\n\n**answer**', structured), [
            { type: 'heading', level: 1, children: [{ type: 'text', text: 'Visible' }] },
            { type: 'paragraph', children: [{ type: 'strong', children: [{ type: 'text', text: 'answer' }] }] },
        ]);
    });
}

test('generic Markdown parses images through a caller hook and has no Gemini import or preprocessing', () => {
    const ctx = { diagnostics: [], sourceRef: { providerId: 'other', locator: 'content' },
        resolveImage: (ref: string, alt: string) => ({ type: 'image' as const, assetId: `resolved:${ref}`, alt }),
    };
    assert.deepEqual(parseMarkdownToBlocks('![diagram](image.png)', '', ctx), [{
        type: 'paragraph', children: [{ type: 'image', assetId: 'resolved:image.png', alt: 'diagram' }],
    }]);
    for (const file of ['parseMarkdown.ts', 'mdastToContent.ts', 'index.ts']) {
        const source = readFileSync(join(__dirname, '../src/core/content/markdown', file), 'utf8');
        assert.doesNotMatch(source, /from\s+['"][^'"]*(?:gemini|compat)[^'"]*['"]/i);
        assert.doesNotMatch(source, /preprocessGemini/);
    }
});

for (const content of [
    '![local](assets/image.png)\n\n> ![linked](https://example.test/image.png)',
    '![data](data:image/png;base64,AQID)\n\n![missing](unknown.png)',
    '<h2>Takeout title</h2><p>中文 <strong>answer</strong></p><ul><li>one</li><li>two</li></ul>',
    '# Title\n\n1. **first**\n2. second\n\n> [source](https://example.test) [1]\n\n```ts\nconst x = 1;\n```\n\n$$x^2$$\n\n|a|b|\n|---|---|\n|1|2|',
]) {
    test(`pre-Domain AST keeps legacy export parity and input immutability: ${content.slice(0, 35)}`, async () => {
        const legacy: Conversation = { ...metadata, messages: [{ role: 'assistant', content,
            attachments: [{ type: 'image', localName: 'assets/image.png', url: 'https://example.test/image.png' }],
            citations: [{ url: 'https://example.test/source', title: 'Source' }], thoughts: 'Reasoning **detail**',
        }] };
        const domain = toDomainConversationDetail(legacy);
        const before = structuredClone(domain);
        const [raw, semantic] = await Promise.all([normalizeGeminiConversation(legacy), normalizeDomainConversation(domain)]);
        assert.deepEqual(semantic.bundle, raw.bundle);
        assert.deepEqual(domain, before, 'asset/citation reconciliation must not mutate Domain');
        assert.deepEqual((await normalizeDomainConversation(domain)).bundle, semantic.bundle);
    });
}

test('semantic asset binding visits nested captions, descriptions and cells while retaining unchanged nodes', () => {
    const blocks: BlockNode[] = [{ type: 'list', ordered: true, items: [{ blocks: [{
        type: 'table', caption: [{ type: 'image', assetId: 'caption' }],
        rows: [{ cells: [{ children: [{ type: 'link', href: 'https://example.test', children: [{ type: 'image', assetId: 'cell' }] }] }] }],
    }, { type: 'image', assetId: 'block', caption: [{ type: 'image', assetId: 'image-caption' }] },
    { type: 'file', assetId: 'file', description: [{ type: 'image', assetId: 'description' }] }] }] }];
    assert.equal(mapContentAssetReferences(blocks, ref => ref), blocks);
    const original = structuredClone(blocks);
    const seen: string[] = [];
    const mapped = mapContentAssetReferences(blocks, ref => { seen.push(ref); return `bound:${ref}`; });
    assert.deepEqual(new Set(seen), new Set(['caption', 'cell', 'block', 'image-caption', 'file', 'description']));
    assert.deepEqual(blocks, original);
    assert.notEqual(mapped, blocks);
});
