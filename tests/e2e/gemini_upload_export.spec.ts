import { readFile } from 'node:fs/promises';
import type { BrowserContext, TestInfo } from '@playwright/test';
import { test, expect, seedRegistryAccounts } from './fixtures';
import { openOptions } from './uiFixture';
import { editCapturedRpc } from '../fixtures/providers/geminiCaptureWire.js';
import { detailGen } from '../fixtures/providers/geminiDetail.js';

const JSZip = require('../../lib/jszip.min.js');
const conversationId = '533ac8ca2ecb8bd7';
const uploadUrl = 'https://contribution.usercontent.google.com/download?c=bard_storage_sanitized_df3d5b8c104625dd&filename=test_config.json';
const otherUrl = uploadUrl.replace('df3d5b8c104625dd', 'ec4e6f230b4acae0');

function twoTurns(edit: (older: unknown[], newer: unknown[]) => void): string {
    return editCapturedRpc(detailGen('G_P0_CAPTURED_USER_FILE_01'), 'hNvQHb', inner => {
        const turns = inner[0] as unknown[][];
        // Give the newer copy a separate request and selected candidate.
        const newer = JSON.parse(JSON.stringify(turns[0])
            .replaceAll('r_25690ca4a29fded2', 'r_25690ca4a29fded3')
            .replaceAll('rc_ac619437d3ab6d35', 'rc_ac619437d3ab6d36'));
        newer[4][0]++;
        edit(turns[0], newer);
        turns.unshift(newer);
    });
}

async function captureAndExport(context: BrowserContext, extensionId: string, detail: string, testInfo: TestInfo) {
    await seedRegistryAccounts(context);
    const source = await context.newPage();
    await source.route('https://gemini.google.com/app/**', route => route.fulfill({
        contentType: 'text/html',
        body: '<script>window.WIZ_global_data={qDCSke:"10000000001",SNlM0e:"token",cfb2h:"build"};</script><main>Offline Gemini fixture</main>',
    }));
    await source.route('**/batchexecute*', route => route.fulfill({
        contentType: 'application/json', body: detail,
    }));
    await source.goto(`https://gemini.google.com/app/${conversationId}`);
    await source.waitForFunction(() => window.__gemExporterHookInstalled === true);
    await source.evaluate(async id => {
        const body = new URLSearchParams({
            'f.req': JSON.stringify([[['hNvQHb', JSON.stringify([`c_${id}`, 10, null, 1, [1], [4], null, 1]), null, 'generic']]]),
        });
        await fetch('/_/BardChatUi/data/batchexecute?rpcids=hNvQHb', { method: 'POST', body });
    }, conversationId);

    const options = await openOptions(context, extensionId);
    await expect(options.locator(`#list [data-chat-id="${conversationId}"]`)).toBeVisible();
    await options.locator('#format').selectOption('markdown');
    await options.locator('#includeAssets').check();
    await options.locator('#btnSelectAll').click();
    const download = options.waitForEvent('download');
    await options.locator('#btnExport').click();
    const file = await download;
    const filename = file.suggestedFilename();
    expect(filename).toMatch(/\.(?:zip|md)$/);
    const bytes = await readFile((await file.path())!);
    const zip = filename.endsWith('.zip') ? await JSZip.loadAsync(bytes) : undefined;
    const markdownName = zip ? Object.keys(zip.files).find(name => name.endsWith('.md')) : filename;
    expect(markdownName).toBeDefined();
    const markdown: string = zip ? await zip.file(markdownName).async('string') : bytes.toString('utf8');
    await testInfo.attach('downloaded-markdown', { body: markdown, contentType: 'text/markdown' });
    const messages = markdown.split(/(?=^## (?:👤|🤖) )/m).slice(1);
    const isUserMessage = (message: string) => message.startsWith('## 👤 ');
    expect(messages.map(message => isUserMessage(message) ? 'user' : 'assistant'),
        'roles in the downloaded Markdown').toEqual(['user', 'assistant', 'user', 'assistant']);
    return { zip, markdownName, userMessages: messages.filter(isUserMessage) };
}

for (const [scenario, secondUrl] of [
    ['the same upload', uploadUrl],
    ['a different upload with the same filename', otherUrl],
] as const) {
    test(`Gemini Markdown export preserves both file-only prompts with ${scenario}`, async ({ context, extensionId }, testInfo) => {
        const firstFile = { version: 'original' };
        const secondFile = secondUrl === uploadUrl ? firstFile : { version: 'replacement' };
        await context.route(url => url.href === uploadUrl, route => route.fulfill({ json: firstFile }));
        if (secondUrl !== uploadUrl) {
            await context.route(url => url.href === secondUrl, route => route.fulfill({ json: secondFile }));
        }

        const detail = twoTurns((_older, newer) => {
            newer[2] = JSON.parse(JSON.stringify(newer[2]).replaceAll(uploadUrl, secondUrl));
        });
        const { zip, markdownName, userMessages } = await captureAndExport(context, extensionId, detail, testInfo);
        expect(zip, 'Markdown with uploads should be packaged as a ZIP').toBeDefined();
        const paths = userMessages.map(message => {
            const links = [...message.matchAll(/\]\(([^)]+)\)/g)];
            expect(links, 'each file-only prompt should link its upload once').toHaveLength(1);
            return decodeURIComponent(new URL(links[0][1], `https://archive.test/${markdownName}`).pathname.slice(1));
        });
        expect(new Set(paths).size).toBe(secondUrl === uploadUrl ? 1 : 2);
        const files = await Promise.all(paths.map(async path => {
            const attachment = zip.file(path);
            expect(attachment, `archived upload for ${path}`).toBeTruthy();
            return JSON.parse(await attachment.async('string'));
        }));
        expect(files).toEqual([firstFile, secondFile]);
    });
}

test('Gemini Markdown export retains pasted Drive URLs as text, not uploaded files', async ({ context, extensionId }, testInfo) => {
    const driveUrl = 'https://drive.google.com/file/d/example/view';
    const detail = twoTurns((older, newer) => {
        older[2] = [[driveUrl, null, null, null, null]];
        newer[2] = [driveUrl];
    });
    await context.route(url => url.href === driveUrl, route => route.fulfill({ body: 'Not an upload' }));
    const { zip, userMessages } = await captureAndExport(context, extensionId, detail, testInfo);
    for (const message of userMessages) {
        expect(message).toContain(driveUrl);
        expect(message).not.toContain('[attachment]');
    }
    expect(zip, 'Markdown without assets should be downloaded directly').toBeUndefined();
});
