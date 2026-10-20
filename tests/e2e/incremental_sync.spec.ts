import { test, expect, seedRegistryAccounts } from './fixtures';
import { openOptions, seedConversations, accountId } from './uiFixture';

test.beforeEach(async ({ context }) => { await seedRegistryAccounts(context); });

async function sourcePage(context: import('@playwright/test').BrowserContext) {
    const page = await context.newPage();
    await page.route('https://gemini.google.com/**', route => route.fulfill({
        contentType: 'text/html',
        body: '<script>window.WIZ_global_data={qDCSke:"10000000001",SNlM0e:"test",cfb2h:"test"}</script>',
    }));
    await page.goto('https://gemini.google.com/app');
    return page;
}
const v2 = (page: import('@playwright/test').Page) => page.evaluate(async id => {
    const api = Reflect.get(globalThis, 'uiFixture');
    return {
        coverage: await api.getCoverage(id, 'recent'),
        indexes: await api.listIndexes(id),
        retainedRecord: await api.getExportRecord({ accountId: id, conversationId: 'retained' }),
        retained: await api.readConversation({ accountId: id, conversationId: 'retained' }),
    };
}, accountId);

test('trusted provider-limit window is persisted by L2/L3a and reused for v2 early stop without losing existing facts', async ({ context, extensionId }) => {
    const gemini = await sourcePage(context);
    let round = 0;
    const requests: string[][] = [[], [], []];
    // Active scan RPC is issued by the extension/provider, not the Gemini tab.\n    // Observe requests in the BrowserContext (as the passing scan_flow E2E does).\n    await context.route('**/batchexecute*', async route => {
        const args = JSON.parse(JSON.parse(new URLSearchParams(route.request().postData()!).get('f.req')!)[0][0][1]);
        const cursor = args[1];
        requests[round].push(cursor || 'head');
        const values = round === 0 ? cursor === null ? [100, 90] : [80, 70] : round === 1 ? [120, 110, 95, 85] : [130, 120, 110, 95];
        const next = round === 0 ? cursor === null ? 'tC_middle' : 'tC_limit' : 'tC_unread';
        const packet = cursor === 'tC_limit'
            ? ['wrb.fr', 'MaZiqc', null, null, null, ['BardErrorInfo', 1096]]
            : ['wrb.fr', 'MaZiqc', JSON.stringify([null, next,
                values.map(t => ['c_chat' + t, 'Chat ' + t, null, null, null, [1700000000 + t, 0]])])];
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify([packet]) });
    });
    const options = await openOptions(context, extensionId);
    await seedConversations(options, [{ id: 'retained', title: 'Retained', titleSource: 'user' }], {
        retained: { exportedAt: 100, format: 'markdown', status: 'ok' },
    });
    await options.click('#btnSyncAll');
    await expect(options.locator('#btnSyncAll')).toBeEnabled();
    await expect(options.locator('.tour-overlay-container')).toHaveCount(0);
    // Four committed source rows are below the v2 Takeout suggestion threshold (>150).
    expect(requests[0]).toEqual(['head', 'tC_middle', 'tC_limit']);
    await expect.poll(async () => (await v2(options)).coverage?.range?.head.time).toBe(1700000100000);

    for (round = 1; round <= 2; round++) {
        await options.click('#btnSyncAll');
        await expect.poll(async () => (await v2(options)).coverage?.range?.head.time).toBe(
            round === 1 ? 1700000120000 : 1700000130000);
        await expect(options.locator('#btnSyncAll')).toBeEnabled();
        const { coverage, indexes, retainedRecord, retained } = await v2(options);
        expect(requests[round], 'overlap with frozen history must avoid another provider page').toEqual(['head']);
        expect(coverage?.range?.tail.time).toBe(1700000070000);
        expect(Object.keys(coverage!)).toEqual(['range']);
        expect(JSON.stringify(coverage)).not.toContain('tC_');
        expect(indexes.some((row: { key: { conversationId: string } }) => row.key.conversationId === 'retained')).toBe(true);
        expect(retainedRecord?.status).toBe('ok');
        expect(retained?.detail.messages.length).toBeGreaterThan(0);
    }
});

test('passive non-head Gemini page adds v2 indexes but cannot fabricate trusted coverage', async ({ context, extensionId }) => {
    const gemini = await sourcePage(context);
    await gemini.route('**/batchexecute*', route => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify([['wrb.fr', 'MaZiqc',
            JSON.stringify([null, null, [['c_passive80', 'Passive 80', null, null, null, [1700000080, 0]]]])]]),
    }));
    const options = await openOptions(context, extensionId);
    await gemini.evaluate(async () => fetch('/_/BardChatUi/data/batchexecute', {
        method: 'POST',
        body: new URLSearchParams({ 'f.req': JSON.stringify([[['MaZiqc',
            JSON.stringify([20, 'tC_segment', [0, null, 1]]), null, 'generic']]]) }),
    }));
    await expect.poll(async () => (await v2(options)).indexes.length).toBe(1);
    // Passive Sniffer commits Index in the background; the Options read mirror
    // intentionally refreshes on focus, rather than subscribing to L2 writes.
    await options.bringToFront();
    await options.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(options.locator('[data-chat-id="passive80"]')).toBeVisible();
    expect((await v2(options)).coverage).toEqual({ range: null });
});

test('a new complete disjoint recent scan replaces old v2 coverage and never requests pinned', async ({ context, extensionId }) => {
    const gemini = await sourcePage(context);
    let round = 0;
    const requests: string[][] = [[], []];
    // Active scan RPC is issued by the extension/provider, not the Gemini tab.\n    // Observe requests in the BrowserContext (as the passing scan_flow E2E does).\n    await context.route('**/batchexecute*', async route => {
        const args = JSON.parse(JSON.parse(new URLSearchParams(route.request().postData()!).get('f.req')!)[0][0][1]);
        expect(args[2][0]).toBe(0);
        const cursor = args[1];
        requests[round].push(cursor || 'head');
        const values = round === 0 ? [100, 70] : cursor === null ? [150, 140] : [130, 120];
        const next = round === 1 && cursor === null ? 'tC_fresh' : null;
        await route.fulfill({ contentType: 'application/json',
            body: JSON.stringify([['wrb.fr', 'MaZiqc', JSON.stringify([null, next,
                values.map(t => ['c_rebuild' + t, 'Rebuild ' + t, null, null, null, [1700000000 + t, 0]])])]]) });
    });
    const options = await openOptions(context, extensionId);
    await options.click('#btnSyncAll');
    await expect.poll(async () => (await v2(options)).coverage?.range?.tail.time).toBe(1700000070000);
    await expect(options.locator('#btnSyncAll')).toBeEnabled();
    round = 1;
    await options.click('#btnSyncAll');
    await expect.poll(async () => (await v2(options)).coverage?.range?.head.time).toBe(1700000150000);
    await expect(options.locator('#btnSyncAll')).toBeEnabled();
    const { coverage, indexes } = await v2(options);
    expect(coverage?.range?.tail.time).toBe(1700000120000);
    expect(requests[1]).toEqual(['head', 'tC_fresh']);
    expect(indexes).toHaveLength(6);
    await expect(options.locator('#list .item')).toHaveCount(6);
});
