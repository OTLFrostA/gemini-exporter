import { waitForAuthorization } from '../helpers/tourNavigation';
import { test, expect } from './fixtures';
import { openOptions } from './uiFixture';
import { expectProviderDownloads } from './providerDownloads';
import { listGen as chatgptListGen } from '../fixtures/providers/chatgpt.js';
import { sessionGen as chatgptSessionGen } from '../fixtures/providers/chatgptSession.js';
import { detailGen as chatgptDetailGen } from '../fixtures/providers/chatgptDetail.js';

// Optional permission UI and remote HTTP are browser boundaries. The real
// Workbench, discovery, account registry, provider, L2 and IDB run unchanged.
async function source(page: import('@playwright/test').Page, allow: boolean) {
    const list = chatgptListGen('C_E2E_CHATGPT_SCAN_01');
    const session = chatgptSessionGen('C_E2E_CHATGPT_SCAN_02');
    const detail = chatgptDetailGen('C_E2E_CHATGPT_EXPORT_DETAIL_01');
    const calls: string[] = [];
    await page.route('https://chatgpt.com/**', async route => {
        const url = new URL(route.request().url());
        calls.push(url.pathname);
        if (url.pathname.endsWith('/api/auth/session')) {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session) });
            return;
        }
        if (url.pathname === '/backend-api/conversation/gpt-chat') {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail) });
            return;
        }
        if (url.pathname === '/backend-api/conversations') {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(list) });
            return;
        }
        await route.fulfill({ status: 404, contentType: 'text/plain', body: 'Unexpected ChatGPT fixture endpoint: ' + url.pathname });
    });
    await page.evaluate(({ allow }) => {
        let granted = false;
        const query = chrome.tabs.query.bind(chrome.tabs);
        const nativeContains = chrome.permissions.contains.bind(chrome.permissions);
        // Optional permission UI and source tab presence are browser boundaries; HTTP runs through Chromium's real fetch().
        Object.defineProperty(chrome.tabs, 'get', { configurable: true, value: async () =>
            ({ id: 99, url: 'https://chatgpt.com/' }) });
        Object.defineProperty(chrome.tabs, 'sendMessage', { configurable: true, value: async () => ({ ok: true }) });
        const scripts: chrome.scripting.RegisteredContentScript[] = [];
        Object.defineProperty(chrome.scripting, 'getRegisteredContentScripts', { configurable: true,
            value: async () => scripts });
        Object.defineProperty(chrome.scripting, 'registerContentScripts', { configurable: true,
            value: async (items: chrome.scripting.RegisteredContentScript[]) => { scripts.push(...items); } });
        Object.defineProperty(chrome.permissions, 'contains', { configurable: true,
            value: async ({ origins }: { origins: string[] }) =>
                origins.includes('https://chatgpt.com/*') ? granted : nativeContains({ origins }) });
        Object.defineProperty(chrome.permissions, 'request', { configurable: true, value: async () => { granted = allow; return granted; } });
        Object.defineProperty(chrome.tabs, 'query', { configurable: true, value: async (options: chrome.tabs.QueryInfo) =>
            Array.isArray(options.url) && options.url.includes('https://chatgpt.com/*')
                ? [{ id: 99, url: 'https://chatgpt.com/' }] : query(options) });
    }, { allow });
    return calls;
}

test('Connect ChatGPT selects its verified account and Sync All commits only its history', async ({ context, extensionId }) => {
    const page = await openOptions(context, extensionId);
    const calls = await source(page, true);
    await expect(page.locator('header #btnConnectChatGPT, header #btnConnectClaude')).toHaveCount(0);
    await page.locator('#btnPlatformPermissions').click(); await waitForAuthorization(page);
    await expect(page.getByRole('checkbox', { name: 'Gemini', exact: true })).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'Claude', exact: true }).uncheck();
    await page.getByRole('checkbox', { name: 'Grok', exact: true }).uncheck();
    await page.locator('#btnAuthorizePlatforms').click();
    await expect(page.locator('#accountIdSelect option:checked')).toContainText('ChatGPT');
    await page.locator('#platformAuthorizationDone').click();
    await page.locator('#btnSyncAll').click();
    await expect(page.locator('#scanStatus')).toHaveText('Read 1 conversation record, added 1, total 1');
    await expect(page.locator('#list .item')).toHaveCount(1);
    await expect(page.locator('#list')).toContainText('ChatGPT history from source');
    await expect(page.locator('#list .open-link')).toHaveAttribute('href', 'https://chatgpt.com/c/gpt-chat');
    await expect(page.locator('#list .open-link')).toHaveAttribute('aria-label', 'Open in ChatGPT');
    const id = await page.locator('#accountIdSelect').inputValue();
    expect(await page.evaluate(async id => {
        const api = Reflect.get(window, 'uiFixture');
        const accounts = await api.listAccounts();
        return { provider: accounts.find((a: { id: string }) => a.id === id)?.providerId,
            conversations: (await api.listIndexes(id)).length,
            geminiRows: (await Promise.all(accounts.filter((a: { providerId: string }) => a.providerId === 'gemini')
                .map((a: { id: string }) => api.listIndexes(a.id)))).flat().length };
    }, id)).toEqual({ provider: 'chatgpt', conversations: 1, geminiRows: 0 });
    expect(calls).toContain('/backend-api/conversations');
    await expect(page.locator('#btnImportTakeout')).toBeEnabled();
    await expect(page.locator('#liveSaveDiskToggle')).toBeDisabled();

    // Physical export through Options -> Application -> ChatGPTProvider.fetchConversationDetail
    await page.locator('#btnSelectAll').click();
    await expectProviderDownloads(page, 'chatgpt', 'gpt-chat', 'Derive Euler-Lagrange equation.', 'Stationary action requires');
    expect(calls).toContain('/backend-api/conversation/gpt-chat');
});

test('Declining ChatGPT site access leaves the registry and history untouched', async ({ context, extensionId }) => {
    const page = await openOptions(context, extensionId);
    const calls = await source(page, false);
    await page.locator('#btnTourGuide').click(); await waitForAuthorization(page);
    await expect(page.getByRole('checkbox', { name: 'Gemini', exact: true })).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'Claude', exact: true }).uncheck();
    await page.getByRole('checkbox', { name: 'Grok', exact: true }).uncheck();
    await page.locator('#btnAuthorizePlatforms').click();
    await expect(page.locator('.tour-popover [role=status]')).toContainText('Access was not granted');
    // Gemini remains authorized, so a rejected ChatGPT request does not block tutorial progress.
    await expect(page.locator('#tourNextBtn')).toBeEnabled();
    await page.locator('#tourCloseBtn').click();
    expect(await page.evaluate(async () => (await Reflect.get(window, 'uiFixture').listAccounts())
        .filter((a: { providerId: string }) => a.providerId === 'chatgpt'))).toEqual([]);
    expect(calls).toEqual([]);
    await expect(page.locator('#btnSyncAll')).toBeEnabled();
});
