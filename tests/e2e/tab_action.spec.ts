import { test, expect, chromium } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

test('toolbar action follows supported platform tab navigations', async () => {
    const root = path.resolve(__dirname, '../..');
    fs.mkdirSync(path.join(root, 'temp'), { recursive: true });
    const staged = fs.mkdtempSync(path.join(root, 'temp/toolbar-action-'));
    try {
        for (const name of ['src', 'dist', 'icons', 'lib', '_locales'])
            fs.cpSync(path.join(root, name), path.join(staged, name), { recursive: true });
        const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
        manifest.permissions.push('tabs');
        manifest.host_permissions = manifest.optional_host_permissions;
        manifest.optional_host_permissions = [];
        fs.writeFileSync(path.join(staged, 'manifest.json'), JSON.stringify(manifest));
        const context = await chromium.launchPersistentContext('', {
            channel: 'chromium', headless: true, chromiumSandbox: true,
            args: [`--disable-extensions-except=${staged}`, `--load-extension=${staged}`],
        });
        try {
            const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
            await worker.evaluate(() => {
                const results: { tabId?: number | null; error: string | null }[] = [];
                Reflect.set(globalThis, 'tabActionIconResults', results);
                const setIcon = chrome.action.setIcon.bind(chrome.action);
                Object.defineProperty(chrome.action, 'setIcon', {
                    value: (details: Parameters<typeof chrome.action.setIcon>[0]) => setIcon(details).then(() => {
                        results.push({ tabId: details.tabId, error: null });
                    }, error => {
                        results.push({ tabId: details.tabId, error: String(error) });
                        throw error;
                    }),
                });
            });
            const page = await context.newPage();
            let tabId: number | undefined;
            await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Toolbar test</title><main>Stub platform page</main>' }));
            for (const url of ['https://gemini.google.com/app', 'https://chatgpt.com/c/fixture', 'https://chat.openai.com/', 'https://claude.ai/chat/fixture', 'https://grok.com/c/fixture', 'https://example.com/']) {
                await worker.evaluate(() => { Reflect.get(globalThis, 'tabActionIconResults').length = 0; });
                await page.goto(url);
                tabId ??= await worker.evaluate(async () => {
                    const [tab] = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
                    return tab.id;
                });
                const expected = url === 'https://example.com/'
                    ? 'Gemini Exporter (未激活 - 当前非支持的平台页面)' : 'Gemini Exporter (Active)';
                const title = () => worker.evaluate(id => chrome.action.getTitle({ tabId: id }), tabId);
                await expect.poll(title).toBe(expected);
                const iconResults = () => worker.evaluate(id => {
                    const results = Reflect.get(globalThis, 'tabActionIconResults') as { tabId?: number | null; error: string | null }[];
                    return results.filter(result => result.tabId === id);
                }, tabId);
                await expect.poll(iconResults).not.toEqual([]);
                expect((await iconResults()).map(result => result.error), url).toEqual(expect.arrayContaining([null]));
                expect((await iconResults()).every(result => result.error === null), url).toBe(true);
                console.log(`${url} -> ${await title()}`);
                console.log(`setIcon resolved without rejection for ${url}`);
            }
        } finally { await context.close(); }
    } finally { fs.rmSync(staged, { recursive: true, force: true }); }
});
