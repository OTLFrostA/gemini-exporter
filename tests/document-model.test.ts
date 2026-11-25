import { describe as __suiteDescribe } from 'node:test';
import { fixtureAccountFor } from "./helpers/domainFixture.js";
import { useIndexStorage } from "./helpers/indexStorage.js";
import { historicalFixture } from "./helpers/nativeFixture.js";
import test from "node:test";
import assert from "node:assert/strict";
import { composeDomainDocument } from "../src/l3b/compose/composeDomainDocument.js";
import { renderDocumentHtml } from "../src/l4/format/html/renderHtml.js";
import { renderDocumentMarkdown } from "../src/l4/format/markdown/renderMarkdown.js";
import { renderDocumentTypst } from "./helpers/renderTypstFixture.js";
import { TypstSandboxCompiler } from "../src/l4/format/pdf/typst/typstSandboxCompiler.js";
import { RealWasmSandboxHost } from "./helpers/realWasmSandbox.js";
import { repoRoot } from "./helpers/realWasmSandbox.js";
import { extractPdfText } from "./helpers/pdfTextExtract.js";
import { fixtureAccount } from "./helpers/domainFixture.js";
import { ingestDetail } from "../src/l2/ingestion.js";
import { readConversation } from "../src/l2/readConversation.js";
import { serializeDomainJson } from "../src/l4/format/json/serializeDomainJson.js";

__suiteDescribe("document-model", () => {
useIndexStorage();











for (const messages of [
    [{ role: 'model', model: '  Gemini 2.5 Pro  ', content: 'Answer' }],
    [{ role: 'assistant', author: { model: '  Gemini 2.5 Pro  ' }, content: 'Answer' }],
]) test('provider model survives Domain, JSON AST and all renderers: ' + JSON.stringify(messages[0]), () => {
    const raw = { id: 'model', messages }; const before = JSON.stringify(raw);
    const domain = historicalFixture(raw, { providerId: 'gemini' }).conversation;
    assert.equal(domain.detail.messages[0].model, 'Gemini 2.5 Pro');
    const document = JSON.parse(JSON.stringify(composeDomainDocument(domain, fixtureAccountFor(domain))));
    assert.equal(document.messages[0].modelLabel, 'Gemini 2.5 Pro');
    assert.match(renderDocumentHtml(document, {}).html, /gem-model-label">Gemini 2.5 Pro</);
    assert.match(renderDocumentMarkdown(document, {}), /Gemini 2\.5 Pro/);
    assert.equal(renderDocumentTypst(document, {}).messages[0].model, 'Gemini 2.5 Pro');
    assert.equal(JSON.stringify(raw), before);
});

test('turn models, absent/invalid models and escaped model names', () => {
    const domain = historicalFixture({ id: 'turn', turns: [{ userContent: 'Question', modelContent: 'Answer', model: 'GPT-5' }] }, { providerId: 'gemini' }).conversation;
    assert.equal(domain.detail.messages[0].model, undefined);
    assert.equal(domain.detail.messages[1].model, 'GPT-5');
    for (const model of [undefined, null, '', '  ', 42, {}]) {
        assert.ok(!('model' in historicalFixture({ messages: [{ role: 'model', model, content: '' }] }, { providerId: 'gemini' }).conversation.detail.messages[0]));
    }
    const document = composeDomainDocument(historicalFixture({ messages: [{ role: 'assistant', model: '<script>**x**</script>', content: '' }] }, { providerId: 'gemini' }).conversation, fixtureAccountFor(historicalFixture({ messages: [{ role: 'assistant', model: '<script>**x**</script>', content: '' }] }, { providerId: 'gemini' }).conversation));
    assert.match(renderDocumentHtml(document, {}).html, /&lt;script&gt;\*\*x\*\*&lt;\/script&gt;/);
    assert.match(renderDocumentMarkdown(document, {}), /&lt;script&gt;\\\*\\\*x\\\*\\\*&lt;\/script&gt;/);
});

test('compiled PDF visibly retains the model name', async () => {
    const document = composeDomainDocument(historicalFixture({ messages: [{ role: 'model', model: 'Gemini 2.5 Pro', content: 'Answer' }] }, { providerId: 'gemini' }).conversation, fixtureAccountFor(historicalFixture({ messages: [{ role: 'model', model: 'Gemini 2.5 Pro', content: 'Answer' }] }, { providerId: 'gemini' }).conversation));
    const compiler = new TypstSandboxCompiler({ host: new RealWasmSandboxHost(repoRoot()) });
    try {
        const result = await compiler.compile({ rendererSchemaVersion: 1, document: renderDocumentTypst(document, {}), assetPaths: new Map() }, {
            assets: { resolve: async () => null }, signal: new AbortController().signal, reportProgress: () => undefined,
        });
        assert.match(extractPdfText(result.pdfBytes).text, /Gemini 2\.5 Pro/);
    } finally { compiler.dispose(); }
});
});

__suiteDescribe("document-model-other-layers", () => {
/**
 * The provider model label is a DomainMessage fact. L3b carries that fact
 * once to every L4 projection; none of the formats must reparse source HTML
 * or reconstruct the retired ChatFormatter legacy message model.
 */












useIndexStorage();
const account = fixtureAccount('gemini');
const paragraph = (text: string) => ({ type: 'paragraph' as const, children: [{ type: 'text' as const, text }] });

test('native provider model names survive L2 -> L3b and Markdown, HTML, Typst/PDF payloads', async () => {
    const key = { accountId: account.id, conversationId: 'production-model' };
    await ingestDetail(key.accountId, key.conversationId, {
        savedAt: 100, quality: { status: 'complete' }, assets: [],
        messages: [
            { role: 'user', content: [paragraph('Question')] },
            { role: 'assistant', model: 'Gemini 2.5 Pro', content: [paragraph('Answer')] },
        ],
    }, { title: 'Model fidelity', titleSource: 'provider', updatedAt: 100 });
    const conversation = await readConversation(key);
    assert.ok(conversation);
    const before = structuredClone(conversation);
    const document = composeDomainDocument(conversation, account);
    assert.equal(document.messages[1].modelLabel, 'Gemini 2.5 Pro');
    assert.match(renderDocumentMarkdown(document, {}), /Gemini 2\.5 Pro/);
    const html = renderDocumentHtml(document, {}).html;
    assert.match(html, /gem-model-label/);
    assert.match(html, /Gemini 2\.5 Pro/);
    const typst = renderDocumentTypst(document, {});
    assert.equal(typst.messages[1].model, 'Gemini 2.5 Pro');
    const archive = JSON.parse(serializeDomainJson(conversation, account, {}));
    assert.equal(archive.conversation.detail.messages[1].model, 'Gemini 2.5 Pro');
    assert.deepEqual(conversation, before, 'presentation cannot mutate captured provider facts');
});

test('different authored models remain attached to their own messages in every v2 renderer', async () => {
    const key = { accountId: account.id, conversationId: 'multiple-models' };
    await ingestDetail(key.accountId, key.conversationId, {
        savedAt: 200, quality: { status: 'complete' }, assets: [],
        messages: [
            { role: 'assistant', model: 'Gemini Flash', content: [paragraph('Fast answer')] },
            { role: 'assistant', model: 'Gemini Pro', content: [paragraph('Detailed answer')] },
            { role: 'assistant', content: [paragraph('Unknown model response')] },
        ],
    }, { title: 'Two models', titleSource: 'provider', updatedAt: 200 });
    const conversation = await readConversation(key);
    assert.ok(conversation);
    const document = composeDomainDocument(conversation, account);
    assert.deepEqual(document.messages.map(message => message.modelLabel),
        ['Gemini Flash', 'Gemini Pro', undefined]);
    assert.deepEqual(renderDocumentTypst(document, {}).messages.map(message => message.model),
        ['Gemini Flash', 'Gemini Pro', undefined]);
    const markdown = renderDocumentMarkdown(document, {});
    for (const text of ['Gemini Flash', 'Gemini Pro', 'Fast answer', 'Detailed answer', 'Unknown model response']) {
        assert.ok(markdown.includes(text));
    }
    const html = renderDocumentHtml(document, {}).html;
    assert.match(html, /Gemini Flash/);
    assert.match(html, /Gemini Pro/);
});
});
