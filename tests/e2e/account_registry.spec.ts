import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

async function accounts(page: Page) {
    return page.evaluate(async () => {
        const response = await chrome.runtime.sendMessage({ action: 'accountRegistry', command: 'list' });
        if (!response.ok) throw new Error(response.error);
        return response.value as { id: string; providerId: string; providerAccountId: string; email?: string }[];
    });
}
async function tabContext(page: Page, url: string) {
    return page.evaluate(async url => {
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find(tab => tab.url === url);
        if (!tab?.id) return null;
        return (await chrome.tabs.sendMessage(tab.id, { action: 'getAccountContext' })).accountContext;
    }, url);
}

test('real MAIN → isolated → background discovery deduplicates across slots and retains UUID after reload', async ({ context, extensionId }) => {
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/src/ui/options/options.html?notour=1`);
    const urls = ['https://gemini.google.com/app', 'https://gemini.google.com/u/1/app'];
    const pages = await Promise.all(urls.map(() => context.newPage()));
    for (const page of pages) {
        await page.route('https://gemini.google.com/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head>
            <script>window._WIZ_global_data = {qDCSke: '10987654321', oPEP7c: 'alice@example.com'};</script></head><body>
            <button aria-label="Google Account: Alice (alice@example.com)">Profile</button></body></html>` }));
    }
    await Promise.all(pages.map((page, index) => page.goto(urls[index])));
    await expect.poll(async () => (await accounts(options)).length).toBe(1);
    const [account] = await accounts(options);
    expect(account).toMatchObject({ providerId: 'gemini', providerAccountId: '10987654321', email: 'alice@example.com' });
    expect(account.id).toMatch(/^[a-f0-9-]{36}$/);
    for (let index = 0; index < urls.length; index++) {
        await expect.poll(() => tabContext(options, urls[index])).toEqual({ providerId: 'gemini', accountId: account.id, slot: `u${index}` });
    }
    // No slot/UUID mapping was written into the old AccountSlots truth source.
    expect(await options.evaluate(async () => (await chrome.storage.local.get('gemini_account_slots')).gemini_account_slots)).toBeUndefined();
    await pages[0].reload();
    await expect.poll(() => tabContext(options, urls[0])).toEqual({ providerId: 'gemini', accountId: account.id, slot: 'u0' });
    await options.reload();
    expect((await accounts(options))[0].id).toBe(account.id);

    // A credential-bearing request uses the Registry UUID, including the default→u0 route.
    await pages[0].route('**/batchexecute*', route => route.fulfill({ body: '[]' }));
    await pages[0].evaluate(() => fetch('/_/BardChatUi/data/batchexecute?f.sid=test-registry-sid&at=test-registry-token'));
    await expect.poll(async () => options.evaluate(async () => {
        const value = await chrome.storage.session.get<{ gemini_credentials_map?: Record<string, { accountId?: string }> }>('gemini_credentials_map');
        return value.gemini_credentials_map?.['test-registry-sid']?.accountId;
    })).toBe(account.id);
});

test('concurrent real IDB admission, provider isolation, email updates and invalid identity rejection', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/ui/options/options.html?notour=1`);
    const result = await page.evaluate(async () => {
        const observe = (observation: unknown) => chrome.runtime.sendMessage({ action: 'accountRegistry', command: 'observe', observation });
        const observation = { providerId: 'gemini', providerAccountId: 'same-subject', email: 'shared@example.com' };
        const receipts = await Promise.all(Array.from({ length: 12 }, () => observe(observation)));
        const uuid = receipts[0].value.account.id;
        const renamed = await observe({ ...observation, email: 'changed@example.com', displayName: 'Changed' });
        const sparse = await observe({ providerId: 'gemini', providerAccountId: 'same-subject' });
        const other = await observe({ ...observation, providerAccountId: 'other-subject' });
        const provider = await observe({ ...observation, providerId: 'claude' });
        const invalid = await observe({ providerId: 'gemini', email: 'shared@example.com', slot: 'u0' });
        const read = await chrome.runtime.sendMessage({ action: 'accountRegistry', command: 'get', accountId: uuid });
        const filtered = await chrome.runtime.sendMessage({ action: 'accountRegistry', command: 'list', providerId: 'claude' });
        return { receipts, uuid, renamed, sparse, other, provider, invalid, read, filtered };
    });
    expect(new Set(result.receipts.map(receipt => receipt.value.account.id)).size).toBe(1);
    expect(result.receipts.filter(receipt => receipt.value.resolution === 'created')).toHaveLength(1);
    expect(result.renamed.value.account).toMatchObject({ id: result.uuid, email: 'changed@example.com' });
    expect(result.sparse.value.account).toMatchObject({ id: result.uuid, email: 'changed@example.com', displayName: 'Changed' });
    expect(result.other.value.account.id).not.toBe(result.uuid);
    expect(result.provider.value.account.id).not.toBe(result.uuid);
    expect(result.invalid.ok).toBe(false);
    expect(result.read.value.id).toBe(result.uuid);
    expect(result.filtered.value).toHaveLength(1);
    await page.reload();
    expect(await accounts(page)).toHaveLength(3);
});
