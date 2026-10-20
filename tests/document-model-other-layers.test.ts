import { fixtureAccountFor } from './helpers/domainFixture.js';
import { historicalFixture } from './helpers/nativeFixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatHtmlDocument, formatMarkdownDocument } from '../src/core/engine/chatFormatter.js';
import { preparePdfItem } from './helpers/pdfAcquisitionFixture.js';
test('production export entrypoints preserve provider model names', async () => {
    const raw = { id: 'production-model', title: 'Model', messages: [{ role: 'model' as const, model: 'Gemini 2.5 Pro', content: 'Answer' }] };
    assert.match((await formatHtmlDocument(historicalFixture(raw))).content, /gem-model-label">Gemini 2.5 Pro</);
    assert.match((await formatMarkdownDocument(historicalFixture(raw))).content, /Gemini 2\.5 Pro/);
    const pdf = await preparePdfItem(historicalFixture(raw), { accountId: '10000000-0000-4000-8000-000000000001' });
    assert.equal(pdf.ok, true);
    if (!pdf.ok || !pdf.document) throw new Error('Expected prepared PDF document');
    assert.equal(pdf.document.messages[0].modelLabel, 'Gemini 2.5 Pro');
});
