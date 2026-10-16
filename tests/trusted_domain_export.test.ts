import { useIndexStorage } from './helpers/indexStorage.js';
useIndexStorage();
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DomainConversationWithDetail } from '../src/core/domain/conversation.js';
import { validateParserDomain } from '../src/core/domain/runtimeValidation.js';
import { preparePdfItem, pdfDomainSelection } from '../src/core/export/pdf/prepareItem.js';
import { formatContent, formatHtmlDocument, formatMarkdownDocument } from '../src/core/engine/chatFormatter.js';
import { composeDomainDocument } from '../src/core/document/compose/composeDomainDocument.js';

function rawIsNotExportable(raw: DomainConversationWithDetail): void {
    // @ts-expect-error Builders must establish trust at their source.
    formatHtmlDocument(raw);
    // @ts-expect-error The PDF adapter accepts only an established trusted graph.
    pdfDomainSelection(raw);
    const misleading = { id: 'raw', conversation: raw };
    // @ts-expect-error Extra conversation fields cannot slip through the metadata branch.
    preparePdfItem(misleading, { accountId: '10000000-0000-4000-8000-000000000001' });
}
void rawIsNotExportable;

test('PDF metadata cannot impersonate Domain; explicit trusted adapter preserves messages', async () => {
    const raw: DomainConversationWithDetail = { index: { cloudAvailability: 'unknown', hasTakeoutImport: false, titleSource: 'legacy', providerId: 'independent', id: 'pdf-source', title: 'Title' }, detail: { quality: { status: 'unknown' }, messages: [{ role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Independent body' }] }] }], assets: [] } };
    // @ts-expect-error Raw Domain is neither request metadata nor a trusted result.
    const rejected = await preparePdfItem(raw, { accountId: '10000000-0000-4000-8000-000000000001', ...({ includeAssets: false }) });
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.match(rejected.error, /Invalid conversation ID/);
    const selected = pdfDomainSelection(validateParserDomain(raw));
    const prepared = await preparePdfItem(selected, { accountId: '10000000-0000-4000-8000-000000000001', ...({ includeAssets: false }) });
    assert.equal(prepared.ok, true);
    if (prepared.ok) assert.equal(prepared.document.messages.length, 1);
});

test('one trusted graph preserves independent content across HTML, Markdown, JSON and PDF preparation', async () => {
    const conversation = validateParserDomain({ index: { cloudAvailability: 'unknown', hasTakeoutImport: false, titleSource: 'legacy', providerId: 'independent', id: 'exports', title: '<Independent>' }, detail: { assets: [], quality: { status: 'partial' }, messages: [
            { id: 'q', role: 'user', content: [{ type: 'paragraph',
                children: [{ type: 'text', text: 'Question <safe>' }] }] },
            { id: 'a', role: 'assistant', reasoning: [{ type: 'paragraph',
                children: [{ type: 'text', text: 'Reasoning evidence' }] }],
                content: [{ type: 'code', language: 'ts', code: 'const value = 2;' }] },
        ] } });
    const parsed = { conversation, diagnostics: [], resourceHints: {}, acquisitionHints: {} };
    const document = composeDomainDocument(conversation).document;
    const html = (await formatHtmlDocument(parsed)).content;
    const markdown = (await formatMarkdownDocument(parsed)).content;
    const native = JSON.parse(formatContent(parsed, 'json').content);
    const pdf = await preparePdfItem(pdfDomainSelection(conversation), { accountId: '10000000-0000-4000-8000-000000000001', ...({ includeAssets: false }) });

    assert.equal(document.messages.length, 2);
    assert.match(html, /Question &lt;safe&gt;/);
    assert.match(html, /Reasoning evidence/);
    assert.match(markdown, /const value = 2;/);
    assert.match(markdown, /Reasoning evidence/);
    assert.equal(native.conversation.detail.quality.status, 'partial');
    assert.deepEqual(native.conversation.detail.messages.map((message: { role: string }) => message.role), ['user', 'assistant']);
    assert.match(JSON.stringify(native.conversation.detail.messages[1].content), /const value = 2;/);
    assert.equal(pdf.ok, true);
    if (pdf.ok) assert.equal(pdf.document.messages.length, 2);
});
