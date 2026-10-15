import { validateParserDomain } from '../src/core/domain/runtimeValidation.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertDomainClosure } from '../src/core/domain/closure.js';
import { composeDomainDocument } from '../src/core/document/compose/composeDomainDocument.js';
import { renderDocumentHtml } from '../src/core/renderers/html/renderHtml.js';
import { renderDocumentTypst } from '../src/core/renderers/typst/renderTypst.js';
import type { DomainConversationWithDetail } from '../src/core/domain/conversation.js';
test('nested resource references are checked before composition; unavailable bytes are backend diagnostics', () => {
    const domain: DomainConversationWithDetail = { index: { cloudAvailability: 'unknown', hasTakeoutImport: false, titleSource: 'legacy', providerId: 'test', id: 'conversation', title: 'Nested' }, detail: { quality: { status: 'unknown' }, assets: [], messages: [{ id: 'message', role: 'assistant', content: [{ type: 'list', ordered: false, items: [{ blocks: [{ type: 'quote', blocks: [{ type: 'image', assetId: 'missing', alt: 'Nested figure' }] }] }] }] }] } };
    assert.throws(() => assertDomainClosure((domain).detail), /Unregistered Domain asset 'missing' in messages\[0\]/);
    domain.detail.assets.push({ id: 'missing', kind: 'image' });
    const document = composeDomainDocument(validateParserDomain(domain)).document;
    const html = renderDocumentHtml(document, {});
    assert.equal(html.diagnostics.filter(d => d.code === 'HTML_ASSET_UNRESOLVED').length, 1);
    assert.ok(html.html.includes('Nested figure'));
    const diagnostics: string[] = [];
    const pdf = renderDocumentTypst(document, {}, { onDiagnostic(d) { diagnostics.push(d.code); } });
    assert.equal(diagnostics.filter(code => code === 'TYPST_V8_IMAGE_MISSING').length, 1);
    const list = pdf.messages[0]?.blocks[0];
    assert.ok(list && list.type === 'list', 'nested content must remain a list');
    const quote = list.items[0]?.blocks[0];
    assert.ok(quote && quote.type === 'quote', 'the list must retain its quote');
    const placeholder = quote.blocks[0];
    assert.ok(placeholder && placeholder.type === 'unknown', 'unavailable nested image must stay visible');
    assert.equal(placeholder.sourceType, 'missing-image');
    assert.ok(
        placeholder.fallback === 'Nested figure'
            || placeholder.details?.some(node => node.type === 'text' && node.text === 'Nested figure'),
        'nested missing image must preserve its label in either fallback or caption details'
    );
});
