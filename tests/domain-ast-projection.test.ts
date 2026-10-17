import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixtureAccount } from './helpers/domainFixture.js';
import { validateParserDomain } from '../src/core/domain/runtimeValidation.js';
import type { DomainConversationWithDetail } from '../src/core/domain/conversation.js';
import { composeDomainDocument } from '../src/core/document/compose/composeDomainDocument.js';
import { exportDomainHtml, exportDomainMarkdown } from '../src/core/export/exportDomainDocument.js';
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

test('projection uses matched Account and Index facts, preserving supplied partial body order', async () => {
    const domain = validateParserDomain(input()), before = JSON.stringify(domain);
    const { document, diagnostics } = composeDomainDocument(domain, account);
    assert.deepEqual(document.metadata, { id: 'same-native-id', provider: 'chatgpt', createdAt: '1970-01-01T00:00:01.000Z', updatedAt: '1970-01-01T00:00:02.000Z' });
    assert.deepEqual(document.header, { title: 'Index title', providerLabel: 'chatgpt', date: '1970-01-01', messageCount: 2 });
    assert.deepEqual(document.messages.map(m => [m.id, m.label, m.variant, m.modelLabel]), [
        ['msg-0', 'assistant', 'flow', 'Source model'], ['msg-1', 'you', 'bubble', undefined],
    ]);
    assert.equal(diagnostics.length, 0);
    assert.doesNotMatch(JSON.stringify(document), /private@example|Private name|provider-z|savedAt|quality|9999999999999/);
    const markdown = await exportDomainMarkdown(domain, account, { exportedAt: '2026-01-01T00:00:00Z' });
    assert.ok(markdown.includes('provider: "chatgpt"'));
    assert.ok(markdown.indexOf('First body') < markdown.indexOf('Second body'));
    assert.ok((await exportDomainHtml(domain, account)).includes('Index title'));
    assert.equal(JSON.stringify(domain), before);

    const otherAccount = fixtureAccount('chatgpt', '20000000-0000-4000-8000-000000000001');
    assert.throws(() => composeDomainDocument(domain, otherAccount), /Account\/key mismatch/);
    const other = input(); other.index.key.accountId = otherAccount.id; other.detail.key.accountId = otherAccount.id;
    other.detail.messages[0].content = [{ type: 'paragraph', children: [{ type: 'text', text: 'Other account body' }] }];
    const otherDocument = composeDomainDocument(validateParserDomain(other), otherAccount).document;
    assert.equal(otherDocument.metadata.id, document.metadata.id, 'AST source ID is not a cross-account storage key');
    assert.ok(renderDocumentMarkdown(otherDocument, {}).includes('Other account body'));
    assert.ok(!renderDocumentMarkdown(document, {}).includes('Other account body'));
    domain.detail.key.conversationId = 'wrong-detail';
    assert.throws(() => composeDomainDocument(domain, account), /Account\/key mismatch/);
});

test('missing Index title and times get reading defaults without borrowing savedAt', () => {
    const raw = input(); raw.index = { key: raw.index.key };
    const domain = validateParserDomain(raw), before = JSON.stringify(domain);
    const { document } = composeDomainDocument(domain, account);
    assert.equal(document.header.title, 'Untitled conversation');
    assert.ok(!('date' in document.header));
    assert.deepEqual(document.metadata, { id: 'same-native-id', provider: 'chatgpt' });
    assert.equal(JSON.stringify(domain), before);
});

test('Composer numbers sources once across messages; renderers retain numbers and absent URLs', () => {
    const raw = input();
    raw.detail.messages = [0, 1].map(() => ({ role: 'assistant', citations: [{ id: 'same' }, { id: 'named', title: 'Article', url: 'https://example.test/article' }],
        reasoning: [{ type: 'paragraph', children: [{ type: 'citationRef', citationId: 'same', label: '[99]' }] }],
        content: [{ type: 'paragraph', children: [{ type: 'citationRef', citationId: 'named', label: 'Read this' }, { type: 'citationRef', citationId: 'same' }] }],
    }));
    const { document } = composeDomainDocument(validateParserDomain(raw), account);
    assert.deepEqual(document.messages.map(m => m.sources?.items.map(s => [s.id, s.number, s.label, s.href])), [
        [['msg-0:same', 1, '[1]', undefined], ['msg-0:named', 2, 'Article', 'https://example.test/article']],
        [['msg-1:same', 3, '[3]', undefined], ['msg-1:named', 4, 'Article', 'https://example.test/article']],
    ]);
    const reasoning = document.messages[1].blocks[0];
    assert.ok(JSON.stringify(reasoning).includes('"label":"[3]"'));
    const markdown = renderDocumentMarkdown(document, {});
    assert.ok(markdown.includes('> [4] [Article](https://example.test/article)'));
    assert.ok(markdown.includes('Read this'));
    assert.ok(markdown.includes('> [3]\n'), 'untitled offline source has one plain display number');
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

test('only explicit media placements become AST content; resource absence never changes the AST', () => {
    const raw = input();
    raw.detail.assets = [{ id: 'photo', kind: 'image', name: 'Diagram.png' }, { id: 'file', kind: 'file', name: 'Report.pdf' }, { id: 'unowned', kind: 'image' }];
    raw.detail.messages = [
        { role: 'assistant', content: [], generation: { mediaKind: 'image', outputCount: 1 } },
        { role: 'user', content: [{ type: 'paragraph', children: [{ type: 'image', assetId: 'photo' }] }], attachmentIds: ['photo', 'file'] },
    ];
    const { document } = composeDomainDocument(validateParserDomain(raw), account), before = JSON.stringify(document);
    assert.deepEqual(document.messages[0].blocks, []);
    assert.equal(document.messages[1].blocks.length, 2, 'placed photo is not repeated as an attachment');
    assert.ok(!before.includes('unowned') && !before.includes('placeholder'));
    for (const locale of ['en', 'zh'] as const) {
        const text = unavailableResourceText('image', 'Diagram.png', locale);
        assert.ok(renderDocumentHtml(document, {}, { locale }).html.includes(text));
        assert.ok(renderDocumentMarkdown(document, {}, { locale }).includes(text));
        assert.ok(JSON.stringify(renderDocumentTypst(document, {}, { locale })).includes(text));
    }
    const diagnostics: string[] = [];
    const pdf = renderDocumentTypst(document, { photo: 'assets/photo.png' }, { onDiagnostic: d => diagnostics.push(d.code) });
    assert.equal(pdf.messages[1].blocks[1].type, 'file', 'PDF file card does not imply download failure');
    assert.deepEqual(diagnostics, []);
    assert.equal(JSON.stringify(document), before);
});

test('code headers and initial disclosure folding are Renderer options for the same tree', async () => {
    const raw = input(); raw.detail.messages[0].reasoning = [{ type: 'code', code: 'thought', language: 'text' }];
    raw.detail.messages[0].content = [{ type: 'code', code: 'answer', language: 'js', meta: 'Authored filename' }];
    const domain = validateParserDomain(raw), { document } = composeDomainDocument(domain, account), before = JSON.stringify(document);
    const options = { showCodeHeader: false, thoughtInitiallyCollapsed: false };
    assert.ok(!renderDocumentHtml(document, {}, options).html.includes('<div class="gem-code-header">'));
    const markdown = renderDocumentMarkdown(document, {}, options);
    assert.ok(markdown.includes('<details open>') && markdown.includes('```js\nanswer'));
    assert.ok(!markdown.includes('Authored filename'));
    const pdf = renderDocumentTypst(document, {}, options);
    assert.equal(pdf.messages[0].blocks[1].type === 'code' && pdf.messages[0].blocks[1].header, '');
    assert.ok(!(await exportDomainMarkdown(domain, account, options)).includes('Authored filename'));
    assert.ok(!(await exportDomainHtml(domain, account, options)).includes('<div class="gem-code-header">'));
    assert.equal(JSON.stringify(document), before);
});

test('Composer modules cannot reach persistence, acquisition or provider services', () => {
    for (const file of ['composeDomainDocument', 'composeContent', 'resourcePresentation']) {
        const source = readFileSync(`src/core/document/compose/${file}.ts`, 'utf8');
        for (const [, dependency] of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
            assert.doesNotMatch(dependency, /(?:^|\/)(?:storage|api|providers?|parsers|resources|renderers|export)(?:\/|$)/);
        }
        assert.doesNotMatch(source, /\bfetch\s*\(|chrome\.storage|\bdataBase64\b/);
    }
});
