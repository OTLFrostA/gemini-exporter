import { waitForAuthorization } from '../helpers/tourNavigation';
import { test, expect, seedRegistryAccounts } from './fixtures';
import { openOptions, accountId } from './uiFixture';
import { expectMarkdownArchive, expectProviderDownloads } from './providerDownloads';
import { organizationsGen as claudeOrganizationsGen } from '../fixtures/providers/claudeOrganizations.js';
import { listGen as claudeListGen } from '../fixtures/providers/claudeList.js';
import { detailGen as claudeDetailGen } from '../fixtures/providers/claudeDetail.js';

const orgUuid = '11111111-1111-4111-8111-111111111111';
const convUuid = '11111111-1111-4111-8111-111111111111';
const companionUuid = '22222222-2222-4222-8222-222222222222';

async function claudeBoundary(page: import('@playwright/test').Page, allow: boolean) {
    await page.evaluate(({ allow, replies }) => {
        let granted = false;
        const origin = 'https://claude.ai/*';
        Object.defineProperty(chrome.permissions, 'contains', { configurable: true,
            value: async (request: { origins: string[] }) => granted && request.origins.includes(origin) });
        Object.defineProperty(chrome.permissions, 'request', { configurable: true,
            value: async () => { granted = allow; return allow; } });
        Object.defineProperty(chrome.tabs, 'query', { configurable: true,
            value: async (request: { url?: string | string[] }) => Array.isArray(request.url) && request.url.includes(origin)
                ? [{ id: 99, url: 'https://claude.ai/new' }] : [] });
        Object.defineProperty(chrome.tabs, 'get', { configurable: true,
            value: async () => ({ id: 99, url: 'https://claude.ai/new' }) });
        Object.defineProperty(chrome.tabs, 'sendMessage', { configurable: true, value: async () => ({ ok: true }) });
        const scripts: chrome.scripting.RegisteredContentScript[] = [];
        Object.defineProperty(chrome.scripting, 'getRegisteredContentScripts', { configurable: true, value: async () => scripts });
        Object.defineProperty(chrome.scripting, 'registerContentScripts', { configurable: true,
            value: async (items: chrome.scripting.RegisteredContentScript[]) => { scripts.push(...items); } });
        const calls: string[] = [];
        Reflect.set(window, 'claudeHttpCalls', calls);
        Object.defineProperty(chrome.scripting, 'executeScript', { configurable: true,
            value: async (request: { args?: unknown[] }) => {
                const apiPath = String(request.args?.[0]);
                calls.push(apiPath);
                if (apiPath === '/api/organizations') return [{ result: { ok: true, value: replies.orgs } }];
                const prefix = `/api/organizations/${replies.orgUuid}`;
                if (request.args?.[1] !== replies.orgUuid) throw new Error('Claude request not bound to the selected organization');
                if (apiPath === `${prefix}/chat_conversations_v2?limit=100&offset=0&consistency=strong`) return [{ result: { ok: true, value: replies.list } }];
                for (const detail of replies.details) {
                    if (apiPath === `${prefix}/chat_conversations/${detail.uuid}?tree=true&rendering_mode=messages&render_all_tools=true`)
                        return [{ result: { ok: true, value: detail } }];
                }
                throw new Error('Unexpected Claude fixture endpoint: ' + apiPath);
            } });
    }, {
        allow,
        replies: {
            orgUuid,
            orgs: claudeOrganizationsGen('CL_E2E_CLAUDE_SCAN_01'),
            list: claudeListGen('CL_E2E_CLAUDE_SCAN_LIST_01'),
            details: [claudeDetailGen('CL_E2E_CLAUDE_EXPORT_DETAIL_01'), claudeDetailGen('CL_E2E_CLAUDE_EXPORT_COMPANION_01')],
        },
    });
}

for (const allow of [true, false]) test(`Claude site authorization ${allow ? 'connects, syncs and exports individual files and a batch archive' : 'denial leaves its account absent'}`, async ({ context, extensionId }) => {
    const page = await openOptions(context, extensionId);
    await claudeBoundary(page, allow);
    await page.locator('#btnTourGuide').click();
    await waitForAuthorization(page);
    for (const name of ['Gemini', 'ChatGPT', 'Grok']) {
        await page.getByRole('checkbox', { name, exact: true }).uncheck();
    }
    await page.locator('#btnAuthorizePlatforms').click();
    if (!allow) {
        await expect(page.locator('.tour-popover [role=status]')).toContainText('Access was not granted');
        await expect(page.locator('#tourNextBtn')).toBeDisabled();
        expect(await page.evaluate(() => Reflect.get(window, 'claudeHttpCalls'))).toEqual([]);
        expect(await page.evaluate(async () => (await Reflect.get(window, 'uiFixture').listAccounts())
            .filter((account: { providerId: string }) => account.providerId === 'claude'))).toEqual([]);
        return;
    }

    await expect(page.locator('#tourNextBtn')).toBeEnabled();
    await page.locator('#tourNextBtn').click();
    await page.locator('#tourSkipBtn').click();
    await page.locator('#btnSyncAll').click();

    await expect(page.locator('#scanStatus')).toHaveText('Read 2 conversation records, added 2, total 2');
    await expect(page.locator('#list .item')).toHaveCount(2);
    const selectedRow = page.locator(`[data-chat-id="${convUuid}"]`);
    await expect(selectedRow).toContainText('Claude history from source');
    await expect(selectedRow.locator('.open-link')).toHaveAttribute('href', `https://claude.ai/chat/${convUuid}`);
    await expect(selectedRow.locator('.open-link')).toHaveAttribute('aria-label', 'Open in Claude');
    await expect(page.locator('#btnImportTakeout')).toBeDisabled();

    const selectedAccountId = await page.locator('#accountIdSelect').inputValue();
    expect(await page.evaluate(async id => {
        const api = Reflect.get(window, 'uiFixture');
        const accounts = await api.listAccounts();
        const found = accounts.find((a: { id: string }) => a.id === id);
        return { provider: found?.providerId, orgId: found?.providerAccountId, count: (await api.listIndexes(id)).length };
    }, selectedAccountId)).toEqual({ provider: 'claude', orgId: orgUuid, count: 2 });

    // The row has no cached Detail before the first download.
    await page.locator('#skipExported').uncheck();
    await selectedRow.locator('input').check();
    await expectProviderDownloads(page, 'claude', convUuid, 'Explain Lagrange multipliers briefly.', 'At a constrained extremum');
    await page.locator(`[data-chat-id="${companionUuid}"] input`).check();
    await expectMarkdownArchive(page, [
        { id: convUuid, answer: 'At a constrained extremum' },
        { id: companionUuid, answer: 'A feasible direction stays inside the constraint set.' },
    ]);
    expect(await page.evaluate(() => Reflect.get(window, 'claudeHttpCalls'))).toContain(
        `/api/organizations/${orgUuid}/chat_conversations/${convUuid}?tree=true&rendering_mode=messages&render_all_tools=true`,
    );
});

test('an unavailable selected Gemini account stays selected while Claude is connected', async ({ context, extensionId }) => {
    await seedRegistryAccounts(context);
    const page = await openOptions(context, extensionId);
    await claudeBoundary(page, true);
    await page.locator('#btnTourGuide').click();
    await waitForAuthorization(page);
    for (const name of ['Gemini', 'ChatGPT', 'Grok']) {
        await page.getByRole('checkbox', { name, exact: true }).uncheck();
    }
    await page.locator('#btnAuthorizePlatforms').click();
    await expect(page.locator('#tourNextBtn')).toBeEnabled();
    await page.locator('#tourNextBtn').click();
    await page.locator('#tourSkipBtn').click();
    await page.locator('#accountIdSelect').selectOption(accountId);
    await page.locator('#btnSyncAll').click();
    await expect(page.locator('.tour-popover h2')).toHaveText('Connect Gemini account');
});
