import type { StreamCoverage } from '../../src/l2/streamCoverage.js';
import type { DomainConversationIndex as Conversation } from '../../src/l2/conversationIndex.js';
import { test, expect, seedRegistryAccounts } from './fixtures';

test.beforeEach(async ({context, extensionId}) => {
    void extensionId;
    await seedRegistryAccounts(context);
});

test('a proven provider history window establishes a range and later scans stop against the frozen boundary', async ({ context, extensionId }) => {
    const gemini = await context.newPage();
    await gemini.route('https://gemini.google.com/**', route => route.fulfill({ contentType: 'text/html', body: `<script>window._WIZ_global_data={qDCSke:'10000000001',SNlM0e:'test',cfb2h:'test'}</script>` }));
    let round = 0;
    const requests: string[][] = [[], [], []];
    await gemini.route('**/batchexecute*', async route => {
        const args = JSON.parse(JSON.parse(new URLSearchParams(route.request().postData()!).get('f.req')!)[0][0][1]);
        const cursor = args[1];
        requests[round].push(cursor || 'head');
        const values = round === 0 ? cursor === null ? [100, 90] : [80, 70] : round === 1 ? [120, 110, 95, 85] : [130, 120, 110, 95];
        const next = round === 0 ? cursor === null ? 'tC_middle' : 'tC_limit' : 'tC_unread';
        const packet = cursor === 'tC_limit' ? ['wrb.fr', 'MaZiqc', null, null, null, ['BardErrorInfo', 1096]]
            : ['wrb.fr', 'MaZiqc', JSON.stringify([null, values.map(t => ['c_chat' + t, 'Chat ' + t, null, null, null, [1700000000 + t, 0]]), next])];
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify([packet]) });
    });
    await gemini.goto('https://gemini.google.com/app');
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/src/ui/options/options.html?notour=1`);
    await options.evaluate(async () => {
        await chrome.storage.local.set({
            ['conversations_10000000-0000-4000-8000-000000000001']: [{ key: { accountId: '10000000-0000-4000-8000-000000000001', conversationId: 'retained' }, title: 'Retained', titleSource: 'user' }],
            ['exported_10000000-0000-4000-8000-000000000001']: { retained: { status: 'ok' } } });
        await chrome.storage.local.remove('scan_coverage_10000000-0000-4000-8000-000000000001');
    });
    const read = () => options.evaluate(async () => chrome.storage.local.get<{
        ['scan_coverage_10000000-0000-4000-8000-000000000001']: Record<string, StreamCoverage>;
        ['conversations_10000000-0000-4000-8000-000000000001']: Conversation[];
        ['exported_10000000-0000-4000-8000-000000000001']: Record<string, { status: string }>;
    }>(['scan_coverage_10000000-0000-4000-8000-000000000001', 'conversations_10000000-0000-4000-8000-000000000001', 'exported_10000000-0000-4000-8000-000000000001']));
    await options.click('#btnSyncAll');
    await expect(options.locator('#takeoutLimitModal')).toBeVisible({ timeout: 15000 });
    expect(requests[0]).toEqual(['head', 'tC_middle', 'tC_limit']);
    await expect.poll(async () => (await read())['scan_coverage_10000000-0000-4000-8000-000000000001'].recent.range?.head.time).toBe(1700000100000);
    await options.click('#btnModalDismissTakeout');
    for (round = 1; round <= 2; round++) {
        await options.click('#btnSyncAll');
        await expect.poll(async () => (await read())['scan_coverage_10000000-0000-4000-8000-000000000001'].recent.range?.head.time).toBe(round === 1 ? 1700000120000 : 1700000130000);
        await expect(options.locator('#btnSyncAll')).toBeEnabled();
        const data = await read(), coverage = data['scan_coverage_10000000-0000-4000-8000-000000000001'];
        expect(requests[round]).toEqual(['head']);
        expect(coverage.recent.range?.tail.time).toBe(1700000070000);
        expect(Object.keys(coverage.recent)).toEqual(['range']);
        expect(JSON.stringify(coverage)).not.toContain('tC_');
        expect(data['conversations_10000000-0000-4000-8000-000000000001'].some(row => row.key.conversationId === 'retained')).toBe(true);
        expect(data['exported_10000000-0000-4000-8000-000000000001'].retained.status).toBe('ok');
    }
});

test('an isolated passive page saves rows but cannot establish a historical boundary', async ({ context, extensionId }) => {
    const gemini = await context.newPage();
    await gemini.route('https://gemini.google.com/**', route => route.fulfill({ contentType: 'text/html', body: `<script>window._WIZ_global_data={qDCSke:'10000000001',SNlM0e:'test',cfb2h:'test'}</script>` }));
    await gemini.route('**/batchexecute*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify([['wrb.fr', 'MaZiqc', JSON.stringify([null, [['c_passive80', 'Passive 80', null, null, null, [1700000080, 0]]], null])]]) }));
    await gemini.goto('https://gemini.google.com/app');
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/src/ui/options/options.html?notour=1`);
    await gemini.evaluate(async () => fetch('/_/BardChatUi/data/batchexecute', { method: 'POST', body: new URLSearchParams({
        'f.req': JSON.stringify([[['MaZiqc', JSON.stringify([20, 'tC_segment', [0, null, 1]]), null, 'generic']]])
    }) }));
    await expect(options.locator('[data-chat-id="passive80"]')).toBeVisible();
    const coverage = await options.evaluate(async () => (await chrome.storage.local.get<Record<string, Record<string, StreamCoverage>>>('scan_coverage_10000000-0000-4000-8000-000000000001'))['scan_coverage_10000000-0000-4000-8000-000000000001']);
    expect(coverage).toEqual({ recent: { range: null } });
});

test('a complete disjoint recent scan replaces its boundary and does not request pinned', async ({ context, extensionId }) => {
    const gemini = await context.newPage();
    await gemini.route('https://gemini.google.com/**', route => route.fulfill({ contentType: 'text/html', body: `<script>window._WIZ_global_data={qDCSke:'10000000001',SNlM0e:'test',cfb2h:'test'}</script>` }));
    let round = 0;
    const requests: string[][] = [[], []];
    await gemini.route('**/batchexecute*', async route => {
        const args = JSON.parse(JSON.parse(new URLSearchParams(route.request().postData()!).get('f.req')!)[0][0][1]);
        expect(args[2][0]).toBe(0);
        const cursor = args[1]; requests[round].push(cursor || 'head');
        const values = round === 0 ? [100, 70] : cursor === null ? [150, 140] : [130, 120];
        const next = round === 1 && cursor === null ? 'tC_fresh' : null;
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify([['wrb.fr', 'MaZiqc', JSON.stringify([null,
            values.map(t => ['c_rebuild' + t, 'Rebuild ' + t, null, null, null, [1700000000 + t, 0]]), next])]]) });
    });
    await gemini.goto('https://gemini.google.com/app');
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/src/ui/options/options.html?notour=1`);
    const read = () => options.evaluate(async () => (await chrome.storage.local.get<Record<string, Record<string, StreamCoverage>>>('scan_coverage_10000000-0000-4000-8000-000000000001'))['scan_coverage_10000000-0000-4000-8000-000000000001']);
    await options.click('#btnSyncAll');
    await expect.poll(async () => (await read())?.recent?.range?.tail.time).toBe(1700000070000);
    await expect(options.locator('#btnSyncAll')).toBeEnabled();
    round = 1;
    await options.click('#btnSyncAll');
    await expect.poll(async () => (await read())?.recent?.range?.head.time).toBe(1700000150000);
    await expect(options.locator('#btnSyncAll')).toBeEnabled();
    expect((await read()).recent.range!.tail.time).toBe(1700000120000);
    expect(requests[1]).toEqual(['head', 'tC_fresh']);
    await expect(options.locator('#list .item')).toHaveCount(6);
});
