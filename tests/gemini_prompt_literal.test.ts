import { fixtureAccount, fixtureAccountFor } from './helpers/domainFixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGeminiRpcConversation } from '../src/core/parsers/gemini/rpc/parseConversation.js';
import { composeDomainDocument } from '../src/core/document/compose/composeDomainDocument.js';
import { renderDocumentHtml } from '../src/core/renderers/html/renderHtml.js';
import { renderDocumentMarkdown } from '../src/core/renderers/markdown/renderMarkdown.js';
import { renderDocumentTypst } from '../src/core/renderers/typst/renderTypst.js';
import { parseMarkdownToBlocks } from '../src/core/parsers/shared/markdown/index.js';
import { extractBlockText } from '../src/core/domain/content/unknownFallback.js';

test('native Gemini prompts preserve literal syntax across HTML, PDF payload and Markdown', () => {
    const prompt = String.raw`Use f(\$)=1, **literal**, $x$, <input> and C:\temp\file.

Keep [link](https://example.com) and \* intact.`;
    const turn = [['c_literalprompt', 'r_prompt'], [1700000000, 0], [[prompt]],
        [[['rc_answer', [['**Rendered answer**']]]]]];
    const wire = JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([[turn]])]]);
    const { conversation } = parseGeminiRpcConversation(wire, { account: fixtureAccount('gemini'), providerId: 'gemini' });
    const user = conversation.detail.messages[0];
    assert.equal(user.role, 'user');
    assert.equal(user.content.map(block => extractBlockText(block)).join('\n'), prompt);
    const { document } = composeDomainDocument(conversation, fixtureAccountFor(conversation));
    const { html } = renderDocumentHtml(document, {});
    assert.ok(html.includes(String.raw`f(\$)=1, **literal**, $x$, &lt;input&gt; and C:\temp\file.`));
    assert.ok(html.includes('<strong>Rendered answer</strong>'));
    assert.equal(renderDocumentTypst(document, {}).messages[0].plainText, prompt);
    const markdown = renderDocumentMarkdown(document, {});
    const userMarkdown = markdown.split(/^## 👤 You\s*$/m)[1].split(/^## 🤖 Assistant\s*$/m)[0].trim();
    assert.equal(parseMarkdownToBlocks(userMarkdown, '', { diagnostics: [], sourceRef: { providerId: 'gemini', locator: 'round-trip' } })
        .map(block => extractBlockText(block)).join('\n'), prompt.replace(/\n+/g, '\n'));
});
