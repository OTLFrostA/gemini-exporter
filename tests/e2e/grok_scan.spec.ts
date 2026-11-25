import { waitForAuthorization } from '../helpers/tourNavigation';
import { test, expect, seedRegistryAccounts } from './fixtures';
import { openOptions, accountId } from './uiFixture';
import { expectProviderDownloads } from './providerDownloads';
import { detailGen as grokDetailGen, metadataGen, treeGen, responsesGen } from '../fixtures/providers/grokDetail.js';
import { listGen as grokListGen } from '../fixtures/providers/grokList.js';
import { userGen as grokUserGen } from '../fixtures/providers/grokUser.js';
const wire = grokDetailGen('GR_DETAIL_TEXT_01');

/**
 * Executes Grok's real `readGrokSource` `func` closure inside an actual
 * Playwright-routed `https://grok.com/` tab so GET/POST fetch, JSON body
 * serialization, user verification cache, and cookie checks run in Chromium.
 */
async function grokBoundary(
    context: import('@playwright/test').BrowserContext,
    page: import('@playwright/test').Page,
    allow: boolean,
): Promise<{ calls: string[]; close: () => Promise<void> }> {
    const replies = {
        user: grokUserGen('GR_USER_E2E_01'),
        list: grokListGen('GR_LIST_TERMINAL_01'),
        metadata: metadataGen('GR_METADATA_01'),
        tree: treeGen('GR_TREE_STABLE_01'),
        bodies: responsesGen('GR_RESPONSES_01'),
    };
    const calls: string[] = [];
    const grokTab = await context.newPage();
    await grokTab.route('https://grok.com/**', async route => {
        const url = new URL(route.request().url());
        const apiPath = url.pathname + url.search;
        if (url.pathname === '/') {
            await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Grok</title>' });
            return;
        }
        calls.push(apiPath);
        if (apiPath === '/rest/auth/get-user') {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(replies.user) });
            return;
        }
        if (apiPath.includes('pageSize=60')) {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(replies.list) });
            return;
        }
        if (apiPath.includes('conversations_v2')) {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(replies.metadata) });
            return;
        }
        if (apiPath.includes('response-node')) {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(replies.tree) });
            return;
        }
        if (apiPath.includes('load-responses')) {
            expect(route.request().method()).toBe('POST');
            const parsedBody = route.request().postDataJSON() as { responseIds?: string[] };
            expect(Array.isArray(parsedBody?.responseIds) && parsedBody.responseIds.length > 0).toBe(true);
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(replies.bodies) });
            return;
        }
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'unexpected endpoint: ' + apiPath }) });
    });
    await grokTab.goto('https://grok.com/');
    await grokTab.evaluate(() => { document.cookie = 'sso=fixture-session; path=/'; });
    await page.bringToFront();

    await page.exposeFunction('__execInGrokTab', async (funcSource: string, args: unknown[]) => {
        return grokTab.evaluate(async ([src, callArgs]) => {
            const fn = (0, eval)('(' + src + ')') as (...a: unknown[]) => Promise<unknown>;
            return await fn(...callArgs);
        }, [funcSource, args] as const);
    });

    await page.evaluate(({ allow }) => {
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
        Object.defineProperty(chrome.scripting, 'executeScript', { configurable: true,
            value: async (request: { func?: Function; args?: unknown[] }) => {
                if (typeof request.func !== 'function') throw new Error('Expected executeScript func');
                const exec = Reflect.get(window, '__execInGrokTab') as (src: string, args: unknown[]) => Promise<unknown>;
                const result = await exec(request.func.toString(), request.args ?? []);
                return [{ result }];
            } });
    }, { allow });

    return { calls, close: () => grokTab.close() };
}

for (const allow of [true, false]) test(`Grok site authorization ${allow ? 'connects and syncs its native history' : 'denial leaves its account absent'}`, async ({ context, extensionId }) => {
    const page = await openOptions(context, extensionId);
    const boundary = await grokBoundary(context, page, allow);
    try {
        await page.locator('#btnTourGuide').click(); await waitForAuthorization(page);
        for (const name of ['Gemini', 'ChatGPT', 'Claude']) await page.getByRole('checkbox', { name, exact: true }).uncheck();
        await page.locator('#btnAuthorizePlatforms').click();
        if (!allow) {
            await expect(page.locator('.tour-popover [role=status]')).toContainText('Access was not granted');
            await expect(page.locator('#tourNextBtn')).toBeDisabled();
            expect(boundary.calls).toEqual([]);
            return;
        }
        await expect(page.locator('#tourNextBtn')).toBeEnabled();
        await page.locator('#tourNextBtn').click();
        await page.locator('#tourSkipBtn').click();
        await page.locator('#btnSyncAll').click();
        await expect(page.locator('#scanStatus')).toHaveText('Read 1 conversation record, added 1, total 1');
        await expect(page.locator('#list .item')).toHaveCount(1);
        await expect(page.locator('#list')).toContainText(wire.metadata.conversation.title);
        await expect(page.locator('#list .open-link')).toHaveAttribute('href', 'https://grok.com/c/' + wire.id);
        await expect(page.locator('#list .open-link')).toHaveAttribute('aria-label', 'Open in Grok');
        await expect(page.locator('#btnImportTakeout')).toBeDisabled();
        expect(boundary.calls).toContain('/rest/app-chat/conversations?pageSize=60');

        // Physical export through Options -> Application -> GrokProvider.fetchConversationDetail
        await page.locator('#btnSelectAll').click();
        await expectProviderDownloads(page, 'grok', wire.id, 'reply with a Markdown table comparing CSV and JSON', 'import csv, json');
        expect(boundary.calls).toEqual(expect.arrayContaining([
            expect.stringContaining('response-node'), expect.stringContaining('load-responses'),
        ]));
    } finally {
        await boundary.close();
    }
});

test('an unavailable selected Gemini account stays selected while Grok is connected', async ({ context, extensionId }) => {
    await seedRegistryAccounts(context);
    const page = await openOptions(context, extensionId);
    const boundary = await grokBoundary(context, page, true);
    try {
        await page.locator('#btnTourGuide').click(); await waitForAuthorization(page);
        for (const name of ['Gemini', 'ChatGPT', 'Claude']) await page.getByRole('checkbox', { name, exact: true }).uncheck();
        await page.locator('#btnAuthorizePlatforms').click();
        await expect(page.locator('#tourNextBtn')).toBeEnabled();
        await page.locator('#tourNextBtn').click();
        await page.locator('#tourSkipBtn').click();
        await page.locator('#accountIdSelect').selectOption(accountId);
        await page.locator('#btnSyncAll').click();
        await expect(page.locator('.tour-popover h2')).toHaveText('Connect Gemini account');
        await expect(page.getByRole('button', { name: 'Go to Gemini', exact: true })).toBeEnabled();
        await expect(page.locator('.tour-footer button')).toHaveCount(1);
        await expect(page.locator('#accountIdSelect')).toHaveValue(accountId);
        expect(boundary.calls.some((p: string) => p.includes('pageSize=60'))).toBe(false);
    } finally {
        await boundary.close();
    }
});
