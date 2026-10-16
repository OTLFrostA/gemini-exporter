import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import * as path from 'node:path';

let bundle: string;
test.beforeAll(async () => {
    const output = await build({ stdin: { contents: `
        import { parseGeminiDomIndex } from './src/core/parsers/gemini/dom/parseIndex.ts';
        import { parseGeminiDomConversation } from './src/core/parsers/gemini/dom/parseConversation.ts';
        globalThis.readTitleEvidence = id => ({
            index: parseGeminiDomIndex(document, id),
            detail: parseGeminiDomConversation({ document, id }, { providerId: 'gemini' }).conversation.index,
        });
    `, resolveDir: path.resolve(__dirname, '../..'), loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'iife' });
    bundle = output.outputFiles[0].text;
});

test('page headings and document.title cannot promote authored prose to a DOM conversation title', async ({ page }) => {
    await page.setContent(`<title>Generic marketing title</title><h1>Generic welcome heading</h1>
        <user-query><p class="query-text">First authored question</p></user-query><model-response><p>Answer</p></model-response>`);
    await page.addScriptTag({ content: bundle });
    const evidence = await page.evaluate(() => Reflect.get(globalThis, 'readTitleEvidence')('evidence12345678'));
    for (const index of [evidence.index, evidence.detail]) {
        expect(index.title).toBe('First authored question');
        expect(index.titleSource).toBe('sniff');
        expect(index.updatedAt).toBeUndefined();
    }
    await page.locator('user-query').evaluate(node => node.remove());
    const untitled = await page.evaluate(() => Reflect.get(globalThis, 'readTitleEvidence')('evidence12345678'));
    expect(untitled.index.title).toBe('');
    expect(untitled.detail.title).toBe('');
});

test('both DOM parsers accept explicit title elements and only exact same-provider conversation links', async ({ page }) => {
    await page.setContent(`<h1>Welcome</h1>
        <a href="https://example.com/app/evidence12345678"><span class="conversation-title">Wrong provider</span></a>
        <a href="https://gemini.google.com/app/evidence123456789"><span class="conversation-title">Different conversation</span></a>
        <a href="https://gemini.google.com/u/1/app/evidence12345678"><span class="conversation-title">Linked title</span></a>
        <user-query><p>Fallback prompt</p></user-query>`);
    await page.addScriptTag({ content: bundle });
    const linked = await page.evaluate(() => Reflect.get(globalThis, 'readTitleEvidence')('evidence12345678'));
    for (const index of [linked.index, linked.detail]) {
        expect(index.title).toBe('Linked title');
        expect(index.titleSource).toBe('dom');
    }
    await page.evaluate(() => {
        const header = document.createElement('h1');
        header.dataset.testId = 'conversation-title';
        header.textContent = 'Explicit conversation title';
        document.body.append(header);
    });
    const explicit = await page.evaluate(() => Reflect.get(globalThis, 'readTitleEvidence')('evidence12345678'));
    expect(explicit.index.title).toBe('Explicit conversation title');
    expect(explicit.detail.title).toBe('Explicit conversation title');
});
