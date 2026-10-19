import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import * as path from 'node:path';

let bundle: string;
test.beforeAll(async () => {
    const built = await build({ stdin: { contents: `
        import { validateParserDomain } from './src/core/domain/runtimeValidation.ts';
        import { fixtureKey } from './tests/helpers/domainFixture.ts';
        import { fixtureAccount } from './tests/helpers/domainFixture.ts';
        import { parseGeminiDomConversation } from './src/core/parsers/gemini/dom/parseConversation.ts';
        import { composeDomainDocument } from './src/core/document/compose/composeDomainDocument.ts';
        import { assertDomainClosure } from './src/core/domain/closure.ts';
        import { collectDocumentResources } from './src/core/document/ast/resourceReferences.ts';
        globalThis.nativeParserProbe = (document) => {
            const result = parseGeminiDomConversation({ document, id: 'native_dom_123' }, { providerId: 'gemini', account: fixtureAccount() });
            assertDomainClosure(JSON.parse(JSON.stringify(result.conversation.detail)));
            const key = fixtureKey(result.conversationId);
            const domain = validateParserDomain({ index: { ...result.conversation.index, key }, detail: { ...result.conversation.detail, key } });
            const ast = composeDomainDocument(domain, fixtureAccount());
            return { result, ast, images: [...collectDocumentResources(ast).imageIds] };
        };`, resolveDir: path.resolve(__dirname, '../..'), loader: 'ts' }, bundle: true, write: false, format: 'iife', platform: 'browser' });
    bundle = built.outputFiles[0].text;
});

test('DOM parser retains long text, nested code/list, rich table images, math and model source facts', async ({ page }) => {
    await page.route('**/*', route => route.abort());
    const long = '长文'.repeat(13000) + 'END_OF_LONG_BODY';
    await page.setContent(`<title>Source title - Gemini</title><user-query data-message-id="query1"><div class="query-text"><p>First line</p><p>Second line</p><a download="source.pdf" href="https://example.test/source.pdf">File</a></div></user-query>
    <model-response data-message-id="answer1" data-model-name="Gemini source model" data-timestamp-ms="1700000000000"><div class="markdown">
        <p>${long}</p><pre><code class="language-python">print("ONE_CODE_OCCURRENCE")</code></pre>
        <ul><li>Outer<ul><li>Inner</li></ul></li></ul>
        <table><caption><strong>Caption</strong></caption><thead><tr><th>Header</th></tr></thead><tbody><tr><td><strong>Cell</strong><img src="https://example.test/source.png" alt="Source image"></td></tr></tbody></table>
        <span class="katex-display"><math><semantics><annotation encoding="application/x-tex">x^2</annotation></semantics></math></span>
    <audio preload="none"><source src="https://example.test/source.wav" type="audio/wav"></audio></div></model-response>`);
    await page.addScriptTag({ content: bundle });
    const parsed = await page.evaluate(() => (globalThis as unknown as { nativeParserProbe: (doc: Document) => unknown }).nativeParserProbe(document)) as {
        result: { conversation: { detail: { messages: Array<{ role: string; model?: string; timestamp?: number; content: Array<{ type: string }> }>; assets: Array<{ kind: string }>; quality: { status: string } } } }; images: string[]; ast: unknown;
    };
    expect(parsed.result.conversation.detail.messages).toHaveLength(2);
    expect(parsed.result.conversation.detail.messages.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(parsed.result.conversation.detail.messages[1].model).toBe('Gemini source model');
    expect(parsed.result.conversation.detail.messages[1].timestamp).toBe(1700000000000);
    expect(parsed.result.conversation.detail.messages[1].content.map(b => b.type)).toEqual(['paragraph', 'code', 'list', 'table', 'math']);
    const responseContent = JSON.stringify(parsed.result.conversation.detail.messages[1].content);
    expect(responseContent.split('长文')).toHaveLength(13001); // all 13,000 authored repetitions survive
    expect(responseContent).toContain('END_OF_LONG_BODY');
    expect(JSON.stringify(parsed.result.conversation).split('ONE_CODE_OCCURRENCE')).toHaveLength(2);
    expect(JSON.stringify(parsed.result.conversation)).toContain('Second line');
    expect(parsed.result.conversation.detail.assets.map(a => a.kind)).toEqual(['file', 'image', 'audio']);
    expect(parsed.images).toHaveLength(1);
    expect(parsed.result.conversation.detail.quality.status).toBe('partial');
    expect(JSON.stringify(parsed.result.conversation)).not.toMatch(/"(?:diagnostics|localName|archivePath)":/);
});

test('DOM fallback keeps separate roles and extracts nested message nodes once', async ({ page }) => {
    await page.setContent(`<div data-test-id="conversation-turn" role="article"><div data-message-author-role="user"><div class="query-text">Question</div></div><div data-message-author-role="assistant"><div data-test-id="model-response"><div class="markdown"><p>Answer</p></div></div></div></div>`);
    await page.addScriptTag({ content: bundle });
    const parsed = await page.evaluate(() => (globalThis as unknown as { nativeParserProbe: (doc: Document) => unknown }).nativeParserProbe(document)) as { result: { conversation: { detail: { messages: Array<{ role: string; timestamp?: number }> } }; transport: { nodeCount: number } } };
    expect(parsed.result.conversation.detail.messages.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(parsed.result.transport.nodeCount).toBe(2);
    expect(parsed.result.conversation.detail.messages.every(m => m.timestamp === undefined)).toBe(true);
});
