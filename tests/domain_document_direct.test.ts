import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { DomainConversationDetail } from '../src/core/domain/conversationDetail.js';
import { closeLegacyCitations } from '../src/core/parsers/shared/resources/domainCitationAdapter.js';
import { historicalFixtureDomain, historicalFixture } from './helpers/nativeFixture.js';
import { composeDomainDocument } from '../src/core/document/compose/composeDomainDocument.js';
import { exportDomainHtml, exportDomainMarkdown } from '../src/core/export/exportDomainDocument.js';
import { prepareDomainResources } from '../src/core/export/assets/prepareDomainResources.js';
import { formatHtmlDocument, formatMarkdownDocument } from '../src/core/engine/chatFormatter.js';

const raw = {
    id: 'direct', title: 'Draft', titles: { rpc: 'Authoritative title' }, timestamp: 1700000000000,
    messages: [
        { id: 'u', role: 'user' as const, content: '![photo](assets/photo.png)',
            attachments: [{ type: 'image', url: 'https://example.test/photo.png', localName: 'assets/photo.png', name: 'photo.png', isGenerated: true,
                generation: { chatId: 'direct', generationOrdinal: 1, imageOrdinal: 0 } }],
            images: [{ type: 'image', url: 'https://example.test/photo.png', localName: 'assets/photo.png', name: 'photo.png' }] },
        { id: 'a', role: 'model' as const, content: 'Answer **[1]** and [cite:2]. `[1]` stays code.', thoughts: 'Reasoning [1]',
            citations: [{ url: 'https://example.test/source', title: 'Source' }], groundingCitationMarkers: ['[cite:2]'],
            documents: [{ type: 'doc', id: 'doc', title: 'report.pdf', localName: 'files/report.pdf', mimeType: 'application/pdf', size: 1234567,
                sections: ['Introduction'], contentMarkdown: '# Report' }] },
    ],
};

function freeze<T>(value: T): T {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
}

test('raw -> Domain resolves citations and one resource registry without mutating input', () => {
    const snapshot = structuredClone(raw);
    const domain = historicalFixtureDomain(freeze(structuredClone(raw)));
    assert.deepEqual(raw, snapshot);
    assert.equal(domain.title, 'Authoritative title');
    assert.equal(domain.assets.length, 2);
    assert.equal(domain.assets[0].generated, true);
    assert.equal(domain.assets[0].generation?.generationOrdinal, 1);
    assert.deepEqual(domain.assets[1].document?.sections, ['Introduction']);
    assert.equal('groundingCitationMarkers' in domain.messages[1], false);
    assert.deepEqual(domain.messages[1].citations, [
        { id: 'citation-0', title: 'Source', url: 'https://example.test/source' }, { id: 'grounding-2', kind: 'attachment', number: 2 },
    ]);
    const ast = composeDomainDocument(domain).document;
    assert.equal(ast.messages[0].blocks.length, 1, 'inline placement suppresses the attachment tail');
    const answer = ast.messages[1].blocks[1];
    assert.equal(answer.type, 'paragraph');
    if (answer.type !== 'paragraph') throw Error('expected paragraph');
    assert.deepEqual(answer.children[1], { type: 'strong', children: [{ type: 'citation', id: 'a:citation-0', label: '[1]', href: 'https://example.test/source' }] });
    assert.ok(answer.children.some(node => node.type === 'citation' && node.label === '[2]' && !node.href));
    assert.ok(answer.children.some(node => node.type === 'inlineCode' && node.code === '[1]'));
    const file = ast.messages[1].blocks[2];
    assert.equal(file.type, 'file');
    if (file.type === 'file') { assert.equal(file.mediaType, 'application/pdf'); assert.equal(file.byteLength, 1234567); }
});

test('Domain JSON round-trip gives the same AST and HTML/Markdown, including resource identities', async () => {
    const domain = freeze(historicalFixtureDomain(structuredClone(raw)));
    const restored = JSON.parse(JSON.stringify(domain));
    assert.deepEqual(composeDomainDocument(domain), composeDomainDocument(restored));
    assert.deepEqual(await prepareDomainResources(domain), await prepareDomainResources(restored));
    const options = { exportedAt: '2026-10-06T00:00:00Z', locale: 'en' as const, resourceHints: historicalFixture(raw).resourceHints };
    assert.equal(await exportDomainMarkdown(domain, options), await exportDomainMarkdown(restored, options));
    assert.equal(await exportDomainHtml(domain, options), await exportDomainHtml(restored, options));
    assert.equal(await formatMarkdownDocument(historicalFixture(raw), options).then(result => result.content), await exportDomainMarkdown(domain, options));
    assert.equal(await formatHtmlDocument(historicalFixture(raw), options).then(result => result.content), await exportDomainHtml(domain, options));
});

test('composer trusts literal Domain content and does not reinterpret Markdown or marker syntax', () => {
    const domain: DomainConversationDetail = { providerId: 'custom', id: 'literal', title: 'Literal', timestamp: null, assets: [], messages: [
        { role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'text', text: '**literal** [1] [cite:2] ![pic](url)' }] }],
            citations: [{ id: 'source', url: 'https://example.test' }] },
    ] };
    const ast = composeDomainDocument(domain, { documentLanguage: 'zh' }).document;
    assert.equal(ast.header.providerLabel, 'custom');
    assert.equal(ast.documentLanguage, 'zh');
    assert.deepEqual(ast.messages[0].blocks, domain.messages[0].content);
});

test('reasoning placement prevents another attachment copy and dangling citations fail closed', () => {
    const domain: DomainConversationDetail = { providerId: 'custom', id: 'placement', title: '', timestamp: null,
        assets: [{ id: 'shared', kind: 'image', name: 'diagram.png' }], messages: [
            { role: 'assistant', content: [], reasoning: [{ type: 'image', assetId: 'shared' }], attachmentIds: ['shared'] },
            { role: 'user', content: [], attachmentIds: ['shared'] },
        ] };
    const ast = composeDomainDocument(domain).document;
    assert.equal(ast.messages[0].blocks.length, 1);
    assert.equal(ast.messages[1].blocks.length, 1);
    const broken = structuredClone(domain);
    broken.messages[0].content = [{ type: 'paragraph', children: [{ type: 'citationRef', citationId: 'unknown' }] }];
    assert.throws(() => composeDomainDocument(broken), /Unregistered Domain citation/);
});

test('direct export dependency closure cannot load Canonical conversation normalization/composition', () => {
    // Traverse runtime relative imports: type-only legacy parser diagnostics do not add a representation.
    const visited = new Set<string>();
    const visit = (file: string): void => {
        if (visited.has(file)) return;
        visited.add(file);
        assert.ok(!/canonical\/(?:conversation|normaliz\w+|renderCanonical\w+|messageInput|assetInput)\.ts$/.test(file), file);
        const source = fs.readFileSync(file, 'utf8');
        for (const match of source.matchAll(/(?:import|export)\s+(?!type\b)[\s\S]*?\sfrom\s+['"]([^'"]+)['"]/g)) {
            if (!match[1].startsWith('.')) continue;
            const dependency = path.resolve(path.dirname(file), match[1].replace(/\.js$/, '.ts'));
            if (fs.existsSync(dependency)) visit(dependency);
        }
    };
    visit(path.resolve(__dirname, '../src/core/engine/chatFormatter.ts'));
});

test('provider citation binding covers rich captions/descriptions and ignores code/math markers', () => {
    const bound = closeLegacyCitations({ role: 'assistant', citations: [{ id: 'source', url: 'https://example.test/source' }], content: [
        { type: 'image', assetId: 'image', caption: [{ type: 'strong', children: [{ type: 'text', text: 'caption [1]' }] }] },
        { type: 'file', assetId: 'file', description: [{ type: 'text', text: 'description [1]' }] },
        { type: 'table', caption: [{ type: 'text', text: 'table [1]' }], rows: [] },
        { type: 'code', code: '[1]' }, { type: 'math', source: '[1]' },
    ] });
    const serialized = JSON.stringify(bound.content);
    assert.equal((serialized.match(/"citationRef"/g) ?? []).length, 3);
    assert.ok(serialized.includes('"citationId":"source"'));
    assert.deepEqual(bound.content.slice(3), [{ type: 'code', code: '[1]' }, { type: 'math', source: '[1]' }]);
});

test('prepared paths retain archive namespaces, hash inline bytes and omit failed/remote resources', async () => {
    const domain: DomainConversationDetail = { providerId: 'custom', id: 'resources', title: '', timestamp: null, messages: [], assets: [
        { id: 'path', kind: 'file',  },
        { id: 'bytes', kind: 'image', mediaType: 'image/png', dataBase64: 'AQID' },
        { id: 'uri', kind: 'image', source: { uri: 'data:image/png;base64,AQID' } },
        { id: 'failed', kind: 'file',  failureReason: 'missing' },
        { id: 'remote', kind: 'image', source: { uri: 'https://example.test/image.png' } },
    ] };
    const prepared = await prepareDomainResources(freeze(domain), { path: { archivePath: 'files/report.pdf' }, failed: { archivePath: 'files/missing.pdf' } });
    assert.equal(prepared.path, 'files/report.pdf');
    assert.match(prepared.bytes, /^assets\/sha256\/\w{2}\/\w{2}\/\w{64}\.png$/);
    assert.equal(prepared.bytes, prepared.uri);
    assert.equal(prepared.failed, undefined);
    assert.equal(prepared.remote, undefined);
});
