import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

const registryBundle = require('esbuild').buildSync({ stdin: { resolveDir: require('node:path').resolve(__dirname, '../..'), loader: 'ts', contents: `
    import * as registry from './src/core/api/accountRegistry.ts'; globalThis.accountProbe = registry;
` }, bundle: true, write: false, format: 'iife', logLevel: 'silent' }).outputFiles[0].text;
async function accounts(page: Page) {
    await page.evaluate(registryBundle);
    return page.evaluate(async () => (await Reflect.get(globalThis, 'accountProbe').listAccounts() as {id:string;providerId:string;providerAccountId:string;email?:string}[]).filter(a => a.providerAccountId !== 'default'));
}
async function tabContext(page: Page, url: string) {
    return page.evaluate(async url => {
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find(tab => tab.url === url);
        if (!tab?.id) return null;
        return (await chrome.tabs.sendMessage(tab.id, { action: 'getAccountContext' })).accountContext;
    }, url);
}

test('same-tab SPA Gaia switching survives a wrong DOM email, same-email identities and loss of Gaia', async ({ context, extensionId }) => {
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/src/ui/options/options.html?notour=1`);
    const page = await context.newPage();
    const url = 'https://gemini.google.com/app';
    await page.route('https://gemini.google.com/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head>
        <script>window._WIZ_global_data = {qDCSke: '10000000001', oPEP7c: 'shared@example.com'};</script></head><body>
        <button aria-label="Google Account: Other (other@example.com)">Other account</button></body></html>` }));
    await page.goto(url);
    const origin = await page.evaluate(() => performance.timeOrigin);
    await expect.poll(async () => (await accounts(options)).length).toBe(1);
    const [first] = await accounts(options);
    expect(first.email).toBe('shared@example.com');
    expect(await tabContext(options, url)).toMatchObject({ accountId: first.id });

    // Change only MAIN-world bootstrap data: no reload, no synthetic extension
    // observation and no credential request. Queries must obtain fresh Gaia.
    await page.evaluate(() => { window._WIZ_global_data!.qDCSke = '10000000002'; });
    const secondContext = await tabContext(options, url);
    expect(secondContext.accountId).not.toBe(first.id);
    expect((await accounts(options)).find(a => a.id === secondContext.accountId)).toMatchObject({
        providerAccountId: '10000000002', email: 'shared@example.com',
    });
    await page.evaluate(() => { window._WIZ_global_data!.qDCSke = '10000000001'; });
    expect(await tabContext(options, url)).toMatchObject({ accountId: first.id });
    await expect.poll(async () => (await accounts(options)).length).toBe(2);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);

    // Unsolicited periodic observation must discover a profile change too.
    await page.evaluate(() => { window._WIZ_global_data!.oPEP7c = 'renamed@example.com'; });
    await expect.poll(async () => (await accounts(options)).find(a => a.id === first.id)?.email).toBe('renamed@example.com');
    const repeated = await Promise.all(Array.from({ length: 12 }, () => tabContext(options, url)));
    expect(repeated.every(result => result?.accountId === first.id)).toBe(true);
    await page.evaluate(() => { window._WIZ_global_data!.qDCSke = ''; });
    const fallback = await tabContext(options, url);
    expect(fallback.accountId).not.toBe(first.id);
    expect(await options.evaluate(async id => await Reflect.get(globalThis, 'accountProbe').getAccount(id), fallback.accountId)).toEqual({id:fallback.accountId,providerId:'gemini',providerAccountId:'default'});
    expect(await accounts(options)).toHaveLength(2);
});

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
    await page.evaluate(registryBundle);
    const result = await page.evaluate(async () => {
        const api = Reflect.get(globalThis, 'accountProbe');
        const observe = async (observation: unknown) => {
            const value = observation as {providerId:string;providerAccountId:string;email?:string;displayName?:string};
            try { return { ok: true, value: await api.getOrCreateAccount(value.providerId, value.providerAccountId, value.email, value.displayName) }; }
            catch { return { ok: false, value: null }; }
        };
        const observation = { providerId: 'gemini', providerAccountId: 'same-subject', email: 'shared@example.com' };
        const receipts = await Promise.all(Array.from({ length: 12 }, () => observe(observation)));
        const uuid = receipts[0].value.id;
        const renamed = await observe({ ...observation, email: 'changed@example.com', displayName: 'Changed' });
        const sparse = await observe({ providerId: 'gemini', providerAccountId: 'same-subject' });
        const other = await observe({ ...observation, providerAccountId: 'other-subject' });
        const provider = await observe({ ...observation, providerId: 'claude' });
        const invalid = await observe({ providerId: 'gemini', email: 'shared@example.com', slot: 'u0' });
        const read = { value: await api.getAccount(uuid) };
        const filtered = { value: await api.listAccounts('claude') };
        return { receipts, uuid, renamed, sparse, other, provider, invalid, read, filtered };
    });
    expect(new Set(result.receipts.map(receipt => receipt.value.id)).size).toBe(1);
    expect(result.renamed.value).toMatchObject({ id: result.uuid, email: 'changed@example.com' });
    expect(result.sparse.value).toMatchObject({ id: result.uuid, email: 'changed@example.com', displayName: 'Changed' });
    expect(result.other.value.id).not.toBe(result.uuid);
    expect(result.provider.value.id).not.toBe(result.uuid);
    expect(result.invalid.ok).toBe(false);
    expect(result.read.value.id).toBe(result.uuid);
    expect(result.filtered.value).toHaveLength(1);
    await page.reload();
    expect(await accounts(page)).toHaveLength(3);
});
