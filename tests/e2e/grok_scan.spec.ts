import { test, expect } from './fixtures';
import { openOptions } from './uiFixture';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const wire = JSON.parse(readFileSync(path.resolve(__dirname, '../fixtures/providers/grokDetail.json'), 'utf8'));

async function grokBoundary(page: import('@playwright/test').Page, allow: boolean) {
    await page.evaluate(({ allow, wire }) => {
        let granted = false;
        const origin = 'https://grok.com/*';
        Object.defineProperty(chrome.permissions, 'contains', { configurable: true,
            value: async (request: { origins: string[] }) => granted && request.origins.includes(origin) });
        Object.defineProperty(chrome.permissions, 'request', { configurable: true,
            value: async () => { granted = allow; return allow; } });
        Object.defineProperty(chrome.tabs, 'query', { configurable: true,
            value: async (request: { url?: string | string[] }) => Array.isArray(request.url) && request.url.includes(origin)
                ? [{ id: 99, url: 'https://grok.com/' }] : [] });
        Object.defineProperty(chrome.tabs, 'get', { configurable: true, value: async () => ({ id: 99, url: 'https://grok.com/' }) });
        Object.defineProperty(chrome.tabs, 'sendMessage', { configurable: true, value: async () => ({ ok: true }) });
        const scripts: chrome.scripting.RegisteredContentScript[] = [];
        Object.defineProperty(chrome.scripting, 'getRegisteredContentScripts', { configurable: true, value: async () => scripts });
        Object.defineProperty(chrome.scripting, 'registerContentScripts', { configurable: true,
            value: async (items: chrome.scripting.RegisteredContentScript[]) => { scripts.push(...items); } });
        const calls: string[] = [];
        Reflect.set(window, 'grokHttpCalls', calls);
        Object.defineProperty(chrome.scripting, 'executeScript', { configurable: true,
            value: async (request: { args?: unknown[] }) => {
                const apiPath = String(request.args?.[0]); calls.push(apiPath);
                if (apiPath === '/rest/auth/get-user') return [{ result: { userId: wire.id, givenName: 'Grok fixture account' } }];
                if (apiPath.includes('pageSize=60')) return [{ result: { conversations: [wire.metadata.conversation] } }];
                if (apiPath.includes('conversations_v2')) return [{ result: wire.metadata }];
                if (apiPath.includes('response-node')) return [{ result: wire.tree }];
                if (apiPath.includes('load-responses')) return [{ result: wire.bodies }];
                return [{ result: [] }];
            } });
    }, { allow, wire });
}

for (const allow of [true, false]) test(`Grok site authorization ${allow ? 'connects and syncs its native history' : 'denial leaves its account absent'}`, async ({ context, extensionId }) => {
    const page = await openOptions(context, extensionId);
    await grokBoundary(page, allow);
    await page.locator('#btnTourGuide').click();
    for (const name of ['Gemini', 'ChatGPT', 'Claude']) await page.getByRole('checkbox', { name, exact: true }).uncheck();
    await page.locator('#btnAuthorizePlatforms').click();
    if (!allow) {
        await expect(page.locator('.tour-popover [role=status]')).toContainText('Access was not granted');
        await expect(page.locator('#tourNextBtn')).toBeDisabled();
        expect(await page.evaluate(() => Reflect.get(window, 'grokHttpCalls'))).toEqual([]);
        return;
    }
    await expect(page.locator('#tourNextBtn')).toBeEnabled();
    await page.locator('#tourNextBtn').click();
    await page.locator('#tourSkipBtn').click();
    await page.locator('#btnSyncAll').click();
    await expect(page.locator('#status')).toContainText('Reached the end');
    await expect(page.locator('#list .item')).toHaveCount(1);
    await expect(page.locator('#list')).toContainText(wire.metadata.conversation.title);
    await expect(page.locator('#list .open-link')).toHaveAttribute('href', 'https://grok.com/c/' + wire.id);
    await expect(page.locator('#list .open-link')).toHaveAttribute('aria-label', 'Open in Grok');
    await expect(page.locator('#btnImportTakeout')).toBeDisabled();
    expect(await page.evaluate(() => Reflect.get(window, 'grokHttpCalls'))).toContain('/rest/app-chat/conversations?pageSize=60');
});
