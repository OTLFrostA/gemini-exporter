/** Runtime closure and JSON portability of actual Domain and Document AST fixtures. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { assertDomainClosure } from '../src/core/domain/closure.js';
import type { DomainConversationDetail } from '../src/core/domain/conversationDetail.js';
import { composeDomainDocument } from '../src/core/export/document/composeDomainDocument.js';
import { parseProviderConversation } from '../src/core/provider/conversationParser.js';
import { renderDocumentHtml } from '../src/core/export/document/renderHtml.js';
import { renderDocumentMarkdown } from '../src/core/export/document/renderMarkdown.js';
import { renderDocumentTypst } from '../src/core/export/document/renderTypst.js';
test('each Domain fixture is closed and JSON round-trip preserves every backend output', () => {
    const dir = join(__dirname, 'fixtures', 'document-domain');
    const files = readdirSync(dir).filter(file => file.endsWith('.json'));
    assert.equal(files.length, 4);
    for (const file of files) {
        const domain: DomainConversationDetail = JSON.parse(readFileSync(join(dir, file), 'utf8'));
        assertDomainClosure(domain);
        const before = JSON.stringify(domain);
        const document = composeDomainDocument(domain).document;
        const roundTrip = composeDomainDocument(JSON.parse(before)).document;
        assert.deepEqual(roundTrip, document, file);
        const backends = [renderDocumentHtml, renderDocumentMarkdown, renderDocumentTypst];
        for (const backend of backends) assert.deepEqual(backend(document, {}), backend(roundTrip, {}), file);
        assert.equal(JSON.stringify(domain), before);
        const json = JSON.stringify(document);
        for (const field of ['conversation', 'assets', 'reasoning', 'storageRef', 'sourceRef', 'initiallyCollapsed', 'pdfLayout', 'measurementText', 'frontMatter', 'theme', 'modelLabel']) assert.ok(!json.includes(`"${field}":`), `${file}: ${field}`);
    }
});
test('provider-only state and malformed title data cannot become document context', () => {
    const raw = { id: 'state', title: { text: 'not a title' }, theme: 'dark', messages: [{ role: 'model', content: 'Authored content', initiallyCollapsed: false }] };
    const original = structuredClone(raw);
    const { conversation } = parseProviderConversation(raw as never);
    assert.equal(typeof conversation.title, 'string');
    const document = composeDomainDocument(conversation).document;
    assert.ok(!JSON.stringify(document).includes('initiallyCollapsed'));
    assert.ok(!JSON.stringify(document).includes('not a title'));
    assert.deepEqual(raw, original);
});
