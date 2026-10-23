import { test, expect, seedRegistryAccounts } from './fixtures';
import { openOptions, accountId } from './uiFixture';
import { listGen as geminiListGen } from '../fixtures/providers/gemini.js';

test.beforeEach(async ({ context }) => { await seedRegistryAccounts(context); });

async function sourcePage(context: import('@playwright/test').BrowserContext, email = 'same@example.com') {
    const source = await context.newPage();
    await source.route('https://gemini.google.com/app', route => route.fulfill({
        contentType: 'text/html',
        body: '<script>window.WIZ_global_data={qDCSke:"10000000001",oPEP7c:"' + email + '"}</script><body>Fixture</body>',
    }));
    await source.goto('https://gemini.google.com/app');
    await expect(source.locator('#geminiExportBadge')).toBeVisible();
    return source;
}
function capturedContext(options: import('@playwright/test').Page) {
    return options.evaluate(async () => {
        const tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
        return (await chrome.tabs.sendMessage(tabs[0].id!, { action: 'getAccountContext' })).accountContext;
    });
}
async function readIndexes(options: import('@playwright/test').Page, id: string) {
    return options.evaluate(async accountId => Reflect.get(globalThis, 'uiFixture').listIndexes(accountId), id) as Promise<Array<{ key: { conversationId: string } }>>;
}
async function send(source: import('@playwright/test').Page, transport: 'fetch' | 'xhr',
    rpc: 'MaZiqc' | 'hNvQHb', id: string) {
    await source.evaluate(async ({ transport, rpc, id }) => {
        const args = rpc === 'MaZiqc'
            ? [20, null, [0, null, 1]]
            : ['c_' + id, 10, null, 1, [1], [4], null, 1];
        const body = new URLSearchParams({
            'f.req': JSON.stringify([[[rpc, JSON.stringify(args), null, 'generic']]]),
        }).toString();
        const url = '/_/BardChatUi/data/batchexecute';
        if (transport === 'fetch') await fetch(url, { method: 'POST', body });
        else await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', url);
            xhr.onload = () => resolve();
            xhr.onerror = () => reject(new Error('XHR failed'));
            xhr.send(body);
        });
    }, { transport, rpc, id });
}

for (const transport of ['fetch', 'xhr'] as const) {
    for (const kind of ['list', 'detail'] as const) {
        test(transport + ' ' + kind + ' binds delayed source evidence to the request UUID after a same-slot Gaia switch', async ({ context, extensionId }) => {
            const options = await openOptions(context, extensionId);
            const source = await sourcePage(context);
            const original = await capturedContext(options);
            expect(original.accountId).toBe(accountId);
            let release!: () => void;
            const held = new Promise<void>(resolve => { release = resolve; });
            let arrived!: () => void;
            const requestArrived = new Promise<void>(resolve => { arrived = resolve; });
            let index = 0;
            const rpc = kind === 'list' ? 'MaZiqc' : 'hNvQHb';
            await source.route('**/batchexecute*', async route => {
                const current = index++;
                if (current === 0) { arrived(); await held; }
                const id = current === 0 ? 'staleuuid123' : 'currentuuid123';
                const turn = [['c_' + id, 'r_turn'], [1700000000, 0],
                    [['Question']], [[['rc_turn', [['Answer']]]]]];
                const payload = kind === 'list'
                    ? [null, [['c_' + id, 'Source title', null, null, null, [1700000000, 0]]], null]
                    : [[turn], null, 'Source title'];
                await route.fulfill({ contentType: 'application/json',
                    body: JSON.stringify([['wrb.fr', rpc, JSON.stringify(payload)]]) });
            });
            const pending = send(source, transport, rpc, 'staleuuid123');
            await requestArrived;
            await source.evaluate(() => { (window as unknown as { WIZ_global_data: { qDCSke: string } }).WIZ_global_data.qDCSke = '10000000002'; });
            await expect.poll(async () => (await capturedContext(options)).accountId).toBe('10000000-0000-4000-8000-000000000002');
            release();
            await pending;
            await send(source, transport, rpc, 'currentuuid123');
            const other = '10000000-0000-4000-8000-000000000002';
            await expect.poll(async () => (await readIndexes(options, other)).some(row =>
                row.key.conversationId === 'currentuuid123')).toBe(true);
            await expect.poll(async () => (await readIndexes(options, accountId)).some(row =>
                row.key.conversationId === 'staleuuid123')).toBe(true);
            expect((await readIndexes(options, other)).some(row => row.key.conversationId === 'staleuuid123')).toBe(false);
            expect((await readIndexes(options, accountId)).some(row => row.key.conversationId === 'currentuuid123')).toBe(false);
        });
    }
}

test('delayed response keeps original v2 Account UUID without rolling back a newer display email', async ({ context, extensionId }) => {
    const options = await openOptions(context, extensionId);
    const source = await sourcePage(context, 'old@example.com');
    const original = await capturedContext(options);
    expect(original.accountId).toBe(accountId);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let arrived!: () => void;
    const requestArrived = new Promise<void>(resolve => { arrived = resolve; });
    await source.route('**/batchexecute*', async route => {
        arrived(); await held;
        await route.fulfill({ contentType: 'application/json',
            body: geminiListGen('G_E2E_UUID_PROFILE_LIST_01') });
    });
    const pending = send(source, 'fetch', 'MaZiqc', 'profile_delay');
    await requestArrived;
    await source.evaluate(() => { (window as unknown as { WIZ_global_data: { oPEP7c: string } }).WIZ_global_data.oPEP7c = 'new@example.com'; });
    await expect.poll(async () => (await options.evaluate(async id =>
        Reflect.get(globalThis, 'uiFixture').getAccount(id), accountId))?.email).toBe('new@example.com');
    expect((await capturedContext(options)).accountId).toBe(original.accountId);
    release();
    await pending;
    await expect.poll(async () => (await readIndexes(options, original.accountId)).some(row =>
        row.key.conversationId === 'profile_delay')).toBe(true);
    const account = await options.evaluate(async id => Reflect.get(globalThis, 'uiFixture').getAccount(id), original.accountId);
    expect(account.email).toBe('new@example.com');
});
