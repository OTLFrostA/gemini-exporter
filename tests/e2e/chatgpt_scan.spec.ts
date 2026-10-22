import { test, expect } from './fixtures';
import { openOptions } from './uiFixture';
import { chatgptList } from '../fixtures/providers/chatgpt.js';

// Optional permission UI and remote HTTP are browser boundaries. The real
// Workbench, discovery, account registry, provider, L2 and IDB run unchanged.
async function source(page: import('@playwright/test').Page, allow: boolean) {
    const list = chatgptList({ items: [{ id: 'gpt-chat', title: 'ChatGPT history from source',
        create_time: 1700000000, update_time: 1700000010 }], total: 1, offset: 0, limit: 100 });
    await page.evaluate(({ allow, list }) => {
        let granted = false;
        const query = chrome.tabs.query.bind(chrome.tabs);
        Object.defineProperty(chrome.permissions, 'contains', { configurable: true, value: async () => granted });
        Object.defineProperty(chrome.permissions, 'request', { configurable: true, value: async () => { granted = allow; return granted; } });
        Object.defineProperty(chrome.tabs, 'query', { configurable: true, value: async (options: chrome.tabs.QueryInfo) =>
            Array.isArray(options.url) && options.url.includes('https://chatgpt.com/*')
                ? [{ id: 99, url: 'https://chatgpt.com/' }] : query(options) });
        const original = window.fetch.bind(window);
        const calls: string[] = [];
        Reflect.set(window, 'chatgptHttpCalls', calls);
        window.fetch = async (input, init) => {
            const url = String(input);
            if (!url.startsWith('https://chatgpt.com/')) return original(input, init);
            calls.push(new URL(url).pathname);
            if (url.endsWith('/api/auth/session')) return new Response(JSON.stringify({
                accessToken: 'test-token', user: { id: 'chatgpt-user', name: 'GPT test account' }, account: { id: 'workspace' },
            }));
            return new Response(JSON.stringify(list));
        };
    }, { allow, list });
}

test('Connect ChatGPT selects its verified account and Sync All commits only its history', async ({ context, extensionId }) => {
    const page = await openOptions(context, extensionId);
    await source(page, true);
    await page.locator('#btnConnectChatGPT').click();
    await expect(page.locator('#status')).toContainText('ChatGPT connected');
    await page.locator('#btnSyncAll').click();
    await expect(page.locator('#status')).toContainText('Reached the end');
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
    expect(await page.evaluate(() => Reflect.get(window, 'chatgptHttpCalls'))).toContain('/backend-api/conversations');
    await expect(page.locator('#btnImportTakeout')).toBeDisabled();
    await expect(page.locator('#liveSaveDiskToggle')).toBeDisabled();
});

test('Declining ChatGPT site access leaves the registry and history untouched', async ({ context, extensionId }) => {
    const page = await openOptions(context, extensionId);
    await source(page, false);
    await page.locator('#btnConnectChatGPT').click();
    await expect(page.locator('#status')).toContainText('ChatGPT access was not granted');
    expect(await page.evaluate(async () => (await Reflect.get(window, 'uiFixture').listAccounts())
        .filter((a: { providerId: string }) => a.providerId === 'chatgpt'))).toEqual([]);
    expect(await page.evaluate(() => Reflect.get(window, 'chatgptHttpCalls'))).toEqual([]);
    await expect(page.locator('#btnSyncAll')).toBeEnabled();
});
