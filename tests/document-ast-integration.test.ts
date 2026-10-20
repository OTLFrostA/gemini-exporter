import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixtureAccount } from './helpers/domainFixture.js';
import { validateParserDomain } from '../src/core/domain/runtimeValidation.js';
import type { DomainConversationWithDetail } from '../src/core/domain/conversation.js';
import { composeDomainDocument } from '../src/core/document/compose/composeDomainDocument.js';
import { renderDocumentHtml } from '../src/core/renderers/html/renderHtml.js';
import { renderDocumentMarkdown } from '../src/core/renderers/markdown/renderMarkdown.js';
import { renderDocumentTypst } from '../src/core/renderers/typst/renderTypst.js';
import { unavailableResourceText } from '../src/core/renderers/shared/backendPresentation.js';

const account = Object.freeze({ ...fixtureAccount('chatgpt'), email: 'private@example.test', displayName: 'Private name' });
function input(): DomainConversationWithDetail {
    const key = { accountId: account.id, conversationId: 'same-native-id' };
    return { index: { key, title: 'Index title', titleSource: 'provider', createdAt: 1000, updatedAt: 2000 },
        detail: { key: { ...key }, savedAt: 9999999999999, quality: { status: 'partial' }, assets: [], messages: [
            { id: 'provider-z', role: 'assistant', model: 'Source model', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'First body' }] }] },
            { id: 'provider-a', role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Second body' }] }] },
        ] } };
}

// Existing renderer/export coverage, separated from AST unit tests.
test('integration: exported metadata and message order', async () => {
    const domain = validateParserDomain(input());
    const markdown = renderDocumentMarkdown(composeDomainDocument(domain, account), {}, { exportedAt: Date.parse('2026-01-01T00:00:00Z'), includeFrontMatter: true });
    assert.ok(markdown.includes('provider: "chatgpt"'));
    assert.ok(markdown.indexOf('First body') < markdown.indexOf('Second body'));
    assert.ok((renderDocumentHtml(composeDomainDocument(domain, account), {}).html).includes('Index title'));
    const document = composeDomainDocument(domain, account);
    const otherAccount = fixtureAccount('chatgpt', '20000000-0000-4000-8000-000000000001');
    const other = input(); other.index.key.accountId = otherAccount.id; other.detail.key.accountId = otherAccount.id;
    other.detail.messages[0].content = [{ type: 'paragraph', children: [{ type: 'text', text: 'Other account body' }] }];
    const otherDocument = composeDomainDocument(validateParserDomain(other), otherAccount);
    assert.ok(renderDocumentMarkdown(otherDocument, {}).includes('Other account body'));
    assert.ok(!renderDocumentMarkdown(document, {}).includes('Other account body'));
});

test('integration: renderers preserve Composer citation numbers', () => {
    const raw = input();
    raw.detail.messages = [0, 1].map(() => ({ role: 'assistant', citations: [{ id: 'same' }, { id: 'named', title: 'Article', url: 'https://example.test/article' }],
        reasoning: [{ type: 'paragraph', children: [{ type: 'citationRef', citationId: 'same', label: '[99]' }] }],
        content: [{ type: 'paragraph', children: [{ type: 'citationRef', citationId: 'named', label: 'Read this' }, { type: 'citationRef', citationId: 'same' }] }],
    }));
    const document = composeDomainDocument(validateParserDomain(raw), account);
    const markdown = renderDocumentMarkdown(document, {});
    assert.ok(markdown.includes('> [4] [Article](https://example.test/article)'));
    assert.ok(markdown.includes('Read this'));
    assert.ok(markdown.split('\n').includes('> [3]'), 'untitled offline source has one plain display number');
    assert.ok(!markdown.includes('[3] \\[3\\]'), 'untitled source number appears once');
    const html = renderDocumentHtml(document, {}, { locale: 'en' }).html;
    assert.ok(html.includes('>[4] Article</a>'));
    assert.ok(html.includes('gem-citation-chip">[3]</span>'));
    const pdf = renderDocumentTypst(document, {});
    const footer = pdf.messages[1].blocks.at(-1);
    assert.ok(footer?.type === 'note');
    assert.equal(footer.label, 'Sources');
    assert.deepEqual(footer.children, [{ type: 'text', text: '[3]' }, { type: 'lineBreak' },
        { type: 'link', url: 'https://example.test/article', children: [{ type: 'text', text: '[4] Article' }] }]);
});

test('integration: renderers express unavailable media', () => {
    const raw = input();
    raw.detail.assets = [{ id: 'photo', kind: 'image', name: 'Diagram.png' }, { id: 'file', kind: 'file', name: 'Report.pdf' }, { id: 'unowned', kind: 'image' }];
    raw.detail.messages = [
        { role: 'assistant', content: [] },
        { role: 'user', content: [{ type: 'paragraph', children: [{ type: 'image', assetId: 'photo' }] }], attachmentIds: ['photo', 'file'] },
    ];
    const document = composeDomainDocument(validateParserDomain(raw), account);
    for (const locale of ['en', 'zh'] as const) {
        const text = unavailableResourceText('image', 'Diagram.png', locale);
        assert.ok(renderDocumentHtml(document, {}, { locale }).html.includes(text));
        assert.ok(renderDocumentMarkdown(document, {}, { locale }).includes(text));
        assert.ok(JSON.stringify(renderDocumentTypst(document, {}, { locale })).includes(text));
    }
    const diagnostics: string[] = [];
    const pdf = renderDocumentTypst(document, { photo: 'assets/photo.png' }, { onDiagnostic: d => diagnostics.push(d.code) });
    assert.ok(pdf.messages[1].blocks.some(block => block.type === 'file'), 'PDF file card does not imply download failure');
    assert.deepEqual(diagnostics, []);

});

test('integration: renderer options control code headers and disclosure folding', async () => {
    const raw = input(); raw.detail.messages[0].reasoning = [{ type: 'code', code: 'thought', language: 'text' }];
    raw.detail.messages[0].content = [{ type: 'code', code: 'answer', language: 'js', meta: 'Authored filename' }];
    const domain = validateParserDomain(raw), document = composeDomainDocument(domain, account);
    const options = { showCodeHeader: false, thoughtInitiallyCollapsed: false };
    assert.ok(!renderDocumentHtml(document, {}, options).html.includes('<div class="gem-code-header">'));
    const markdown = renderDocumentMarkdown(document, {}, options);
    assert.ok(markdown.includes('<details open>') && markdown.includes('```js\nanswer'));
    assert.ok(!markdown.includes('Authored filename'));
    const pdf = renderDocumentTypst(document, {}, options);
    assert.equal(pdf.messages[0].blocks[1].type === 'code' && pdf.messages[0].blocks[1].header, '');
    assert.ok(!(renderDocumentMarkdown(document, {}, options)).includes('Authored filename'));
    assert.ok(!(renderDocumentHtml(document, {}, options).html).includes('<div class="gem-code-header">'));

});
