import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProviderConversation } from '../src/core/compatibility/conversationParser.js';
import { composeDomainDocument } from '../src/core/document/compose/composeDomainDocument.js';
import { renderDocumentHtml } from '../src/core/renderers/html/renderHtml.js';
import { renderDocumentMarkdown } from '../src/core/renderers/markdown/renderMarkdown.js';
import { renderDocumentTypst } from '../src/core/renderers/typst/renderTypst.js';
import { TypstSandboxCompiler } from '../src/core/export/typst/typstSandboxCompiler.js';
import { RealWasmSandboxHost, repoRoot } from './helpers/realWasmSandbox.js';
import { formatHtmlDocument, formatMarkdownDocument } from '../src/core/engine/chatFormatter.js';
import { preparePdfItem } from '../src/core/export/pdf/prepareItem.js';
import { extractPdfText } from './helpers/pdfTextExtract.js';

for (const messages of [
    [{ role: 'model', model: '  Gemini 2.5 Pro  ', content: 'Answer' }],
    [{ role: 'assistant', author: { model: '  Gemini 2.5 Pro  ' }, content: 'Answer' }],
]) test('provider model survives Domain, JSON AST and all renderers: ' + JSON.stringify(messages[0]), () => {
    const raw = { id: 'model', messages }; const before = JSON.stringify(raw);
    const domain = parseProviderConversation(raw).conversation;
    assert.equal(domain.messages[0].model, 'Gemini 2.5 Pro');
    const document = JSON.parse(JSON.stringify(composeDomainDocument(domain).document));
    assert.equal(document.messages[0].modelLabel, 'Gemini 2.5 Pro');
    assert.match(renderDocumentHtml(document, {}).html, /gem-model-label">Gemini 2.5 Pro</);
    assert.match(renderDocumentMarkdown(document, {}), /Gemini 2\.5 Pro/);
    assert.equal(renderDocumentTypst(document, {}).messages[0].model, 'Gemini 2.5 Pro');
    assert.equal(JSON.stringify(raw), before);
});

test('turn models, absent/invalid models and escaped model names', () => {
    const domain = parseProviderConversation({ id: 'turn', turns: [{ userContent: 'Question', modelContent: 'Answer', model: 'GPT-5' }] }).conversation;
    assert.equal(domain.messages[0].model, undefined);
    assert.equal(domain.messages[1].model, 'GPT-5');
    for (const model of [undefined, null, '', '  ', 42, {}]) {
        assert.ok(!('model' in parseProviderConversation({ messages: [{ role: 'model', model, content: '' }] }).conversation.messages[0]));
    }
    const document = composeDomainDocument(parseProviderConversation({ messages: [{ role: 'assistant', model: '<script>**x**</script>', content: '' }] }).conversation).document;
    assert.match(renderDocumentHtml(document, {}).html, /&lt;script&gt;\*\*x\*\*&lt;\/script&gt;/);
    assert.match(renderDocumentMarkdown(document, {}), /&lt;script&gt;\\\*\\\*x\\\*\\\*&lt;\/script&gt;/);
});

test('compiled PDF visibly retains the model name', async () => {
    const document = composeDomainDocument(parseProviderConversation({ messages: [{ role: 'model', model: 'Gemini 2.5 Pro', content: 'Answer' }] }).conversation).document;
    const compiler = new TypstSandboxCompiler({ host: new RealWasmSandboxHost(repoRoot()) });
    try {
        const result = await compiler.compile({ rendererSchemaVersion: 1, document: renderDocumentTypst(document, {}), assetPaths: new Map() }, {
            assets: { resolve: async () => null }, signal: new AbortController().signal, reportProgress: () => undefined,
        });
        assert.match(extractPdfText(result.pdfBytes).text, /Gemini 2\.5 Pro/);
    } finally { compiler.dispose(); }
});


test('production export entrypoints preserve provider model names', async () => {
    const raw = { id: 'production-model', title: 'Model', messages: [{ role: 'model' as const, model: 'Gemini 2.5 Pro', content: 'Answer' }] };
    assert.match((await formatHtmlDocument(raw)).content, /gem-model-label">Gemini 2.5 Pro</);
    assert.match((await formatMarkdownDocument(raw)).content, /Gemini 2\.5 Pro/);
    const pdf = await preparePdfItem(raw);
    assert.equal(pdf.ok, true);
    if (!pdf.ok || !pdf.document) throw new Error('Expected prepared PDF document');
    assert.equal(pdf.document.messages[0].modelLabel, 'Gemini 2.5 Pro');
});
