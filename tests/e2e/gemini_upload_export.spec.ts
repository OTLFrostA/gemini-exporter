import { readFile } from 'node:fs/promises';
import { test, expect, seedRegistryAccounts } from './fixtures';
import { openOptions } from './uiFixture';
import { editCapturedRpc } from '../fixtures/providers/geminiCaptureWire.js';
import { detailGen } from '../fixtures/providers/geminiDetail.js';

const JSZip = require('../../lib/jszip.min.js');
const conversationId = '533ac8ca2ecb8bd7';
const uploadUrl = 'https://contribution.usercontent.google.com/download?c=bard_storage_sanitized_df3d5b8c104625dd&filename=test_config.json';
const otherUrl = uploadUrl.replace('df3d5b8c104625dd', 'ec4e6f230b4acae0');

function twoUploadTurns(secondUrl: string): string {
    return editCapturedRpc(detailGen('G_P0_CAPTURED_USER_FILE_01'), 'hNvQHb', inner => {
        const turns = inner[0] as unknown[][];
        // Keep the captured file-only prompt (including repeated native tuples)
        // and give its newer copy a separate request and selected candidate.
        const newer = JSON.parse(JSON.stringify(turns[0])
            .replaceAll('r_25690ca4a29fded2', 'r_25690ca4a29fded3')
            .replaceAll('rc_ac619437d3ab6d35', 'rc_ac619437d3ab6d36')
            .replaceAll(uploadUrl, secondUrl));
        newer[4][0]++;
        turns.unshift(newer);
    });
}

for (const [scenario, secondUrl] of [
    ['the same upload', uploadUrl],
    ['a different upload with the same filename', otherUrl],
] as const) {
    test(`Gemini Markdown export preserves both file-only prompts with ${scenario}`, async ({ context, extensionId }, testInfo) => {
        await seedRegistryAccounts(context);
        const source = await context.newPage();
        await source.route('https://gemini.google.com/app/**', route => route.fulfill({
            contentType: 'text/html',
            body: '<script>window.WIZ_global_data={qDCSke:"10000000001",SNlM0e:"token",cfb2h:"build"};</script><main>Offline Gemini fixture</main>',
        }));
        await source.route('**/batchexecute*', route => route.fulfill({
            contentType: 'application/json', body: twoUploadTurns(secondUrl),
        }));
        const firstFile = { version: 'original' };
        const secondFile = secondUrl === uploadUrl ? firstFile : { version: 'replacement' };
        await context.route(url => url.href === uploadUrl, route => route.fulfill({ json: firstFile }));
        if (secondUrl !== uploadUrl) {
            await context.route(url => url.href === secondUrl, route => route.fulfill({ json: secondFile }));
        }

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
        expect(file.suggestedFilename()).toMatch(/\.zip$/);
        const zip = await JSZip.loadAsync(await readFile((await file.path())!));
        const markdownName = Object.keys(zip.files).find(name => name.endsWith('.md'));
        expect(markdownName).toBeDefined();
        const markdown: string = await zip.file(markdownName).async('string');
        await testInfo.attach('downloaded-markdown', { body: markdown, contentType: 'text/markdown' });
        const messages = markdown.split(/(?=^## (?:👤|🤖) )/m).slice(1);
        const isUserMessage = (message: string) => message.startsWith('## 👤 ');
        expect(messages.map(message => isUserMessage(message) ? 'user' : 'assistant'),
            'roles in the downloaded Markdown').toEqual(['user', 'assistant', 'user', 'assistant']);
        const paths = messages.filter(isUserMessage).map(message => {
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
