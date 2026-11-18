import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect } from './fixtures';

const JSZip = require('../../lib/jszip.min.js');

export async function downloadExport(page: Page, format: string, extension: string) {
    await page.locator('#format').selectOption(format);
    const pending = page.waitForEvent('download');
    await page.locator('#btnExport').click();
    const file = await pending;
    expect(file.suggestedFilename().endsWith(extension)).toBe(true);
    const path = await file.path();
    expect(path).not.toBeNull();
    return readFile(path!);
}

export async function expectProviderExportRecord(page: Page, accountId: string, conversationId: string, format: string) {
    await expect.poll(() => page.evaluate(async key => {
        const record = await Reflect.get(window, 'uiFixture').getExportRecord(key);
        return record && { status: record.status, format: record.format };
    }, { accountId, conversationId })).toEqual({ status: 'ok', format });
}

/** Verify the files delivered by the actual Workbench download, against source-owned text. */
export async function expectProviderDownloads(page: Page, providerId: string, conversationId: string,
    question: string, answer: string) {
    const accountId = await page.locator('#accountIdSelect').inputValue();
    const markdown = await downloadExport(page, 'markdown', '.md');
    expect(markdown.toString()).toContain(question);
    expect(markdown.toString()).toContain(answer);
    await expectProviderExportRecord(page, accountId, conversationId, 'markdown');

    const html = await downloadExport(page, 'html', '.html');
    expect(html.toString()).toContain(question);
    expect(html.toString()).toContain(answer);
    await expectProviderExportRecord(page, accountId, conversationId, 'html');

    const json = JSON.parse((await downloadExport(page, 'json', '.json')).toString());
    expect(json.account.providerId).toBe(providerId);
    expect(json.conversation.detail.key).toEqual({ accountId, conversationId });
    const messages: { role: string; content: unknown }[] = json.conversation.detail.messages;
    expect(messages.map(message => message.role)).toEqual(['user', 'assistant']);
    expect(JSON.stringify(messages[0].content)).toContain(question);
    expect(JSON.stringify(messages[1].content)).toContain(answer);
    await expectProviderExportRecord(page, accountId, conversationId, 'json');

    const word = await JSZip.loadAsync(await downloadExport(page, 'docx', '.docx'));
    const document = await word.file('word/document.xml').async('string');
    expect(document).toContain(question);
    expect(document).toContain(answer);
    await expectProviderExportRecord(page, accountId, conversationId, 'docx');
}

export async function expectMarkdownArchive(page: Page, conversations: { id: string; answer: string }[]) {
    const accountId = await page.locator('#accountIdSelect').inputValue();
    const zip = await JSZip.loadAsync(await downloadExport(page, 'markdown', '.zip'));
    const files = Object.keys(zip.files).filter(name => name.endsWith('.md') && !zip.files[name].dir);
    // Archives may contain an index; only conversation documents carry these answers.
    const bodies = await Promise.all(files.map(name => zip.file(name).async('string')));
    for (const { id, answer } of conversations) {
        expect(bodies.filter(body => body.includes(answer))).toHaveLength(1);
        expect(bodies.find(body => body.includes(answer))).toContain(`id: "${id}"`);
        await expectProviderExportRecord(page, accountId, id, 'markdown');
    }
}
