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

/**
 * Executes Claude's real `readClaudeSource` `func` closure inside an actual
 * Playwright-routed `https://claude.ai/new` tab so cookie checks, org-membership
 * caching, inflight dedupe, and same-origin `fetch()` all run in Chromium.
 */
async function claudeBoundary(
    context: import('@playwright/test').BrowserContext,
    page: import('@playwright/test').Page,
    allow: boolean,
): Promise<{ calls: string[]; close: () => Promise<void> }> {
    const replies = {
        orgUuid,
        orgs: claudeOrganizationsGen('CL_E2E_CLAUDE_SCAN_01'),
        list: claudeListGen('CL_E2E_CLAUDE_SCAN_LIST_01'),
        details: [claudeDetailGen('CL_E2E_CLAUDE_EXPORT_DETAIL_01'), claudeDetailGen('CL_E2E_CLAUDE_EXPORT_COMPANION_01')],
    };
    const calls: string[] = [];
    const claudeTab = await context.newPage();
    await claudeTab.route('https://claude.ai/**', async route => {
        const url = new URL(route.request().url());
        const apiPath = url.pathname + url.search;
        if (url.pathname === '/new') {
            await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Claude</title>' });
            return;
        }
        calls.push(apiPath);
        if (apiPath === '/api/organizations') {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(replies.orgs) });
            return;
        }
        const prefix = `/api/organizations/${replies.orgUuid}`;
        if (apiPath === `${prefix}/chat_conversations_v2?limit=100&offset=0&consistency=strong`) {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(replies.list) });
            return;
        }
        for (const detail of replies.details) {
            if (apiPath === `${prefix}/chat_conversations/${detail.uuid}?tree=true&rendering_mode=messages&render_all_tools=true`) {
                await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail) });
                return;
            }
        }
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'unexpected endpoint: ' + apiPath }) });
    });
    await claudeTab.goto('https://claude.ai/new');
    await claudeTab.evaluate(org => { document.cookie = `lastActiveOrg=${encodeURIComponent(org)}; path=/`; }, orgUuid);

    await page.exposeFunction('__execInClaudeTab', async (funcSource: string, args: unknown[]) => {
        return claudeTab.evaluate(async ([src, callArgs]) => {
            const fn = (0, eval)('(' + src + ')') as (...a: unknown[]) => Promise<unknown>;
            return await fn(...callArgs);
        }, [funcSource, args] as const);
    });

    await page.evaluate(({ allow }) => {
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
        Object.defineProperty(chrome.scripting, 'executeScript', { configurable: true,
            value: async (request: { func?: Function; args?: unknown[] }) => {
                if (typeof request.func !== 'function') throw new Error('Expected executeScript func');
                const exec = Reflect.get(window, '__execInClaudeTab') as (src: string, args: unknown[]) => Promise<unknown>;
                const result = await exec(request.func.toString(), request.args ?? []);
                return [{ result }];
            } });
    }, { allow });

    return { calls, close: () => claudeTab.close() };
}

for (const allow of [true, false]) test(`Claude site authorization ${allow ? 'connects, syncs and exports individual files and a batch archive' : 'denial leaves its account absent'}`, async ({ context, extensionId }) => {
    const page = await openOptions(context, extensionId);
    const boundary = await claudeBoundary(context, page, allow);
    try {
        await page.locator('#btnTourGuide').click();
        await waitForAuthorization(page);
        for (const name of ['Gemini', 'ChatGPT', 'Grok']) {
            await page.getByRole('checkbox', { name, exact: true }).uncheck();
        }
        await page.locator('#btnAuthorizePlatforms').click();
        if (!allow) {
            await expect(page.locator('.tour-popover [role=status]')).toContainText('Access was not granted');
            await expect(page.locator('#tourNextBtn')).toBeDisabled();
            expect(boundary.calls).toEqual([]);
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
        expect(boundary.calls).toContain(
            `/api/organizations/${orgUuid}/chat_conversations/${convUuid}?tree=true&rendering_mode=messages&render_all_tools=true`,
        );
    } finally {
        await boundary.close();
    }
});

test('an unavailable selected Gemini account stays selected while Claude is connected', async ({ context, extensionId }) => {
    await seedRegistryAccounts(context);
    const page = await openOptions(context, extensionId);
    const boundary = await claudeBoundary(context, page, true);
    try {
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
        await expect(page.locator('#accountIdSelect')).toHaveValue(accountId);
    } finally {
        await boundary.close();
    }
});
