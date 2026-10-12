import type { ScanCoverage } from '../../src/core/storage/scanCoverage.js';
import type { Conversation } from '../../src/types/conversation.js';
import { test, expect } from './fixtures';

test('partial accessible history initializes activity coverage and later sync closes without fetching its older tail', async ({ context, extensionId }) => {
    const gemini = await context.newPage();
    await gemini.route('https://gemini.google.com/**', route => route.fulfill({ contentType: 'text/html', body: `<script>window._WIZ_global_data={SNlM0e:'test',cfb2h:'test'}</script><button aria-label="Google Account: Sync (increment@example.com)">Account</button>` }));
    let round = 0;
    const requests: string[][] = [[], [], []];
    const row = (id: string, time: number) => ['c_' + id, id, null, null, null, [1700000000 + time, 0]];
    await gemini.route('**/batchexecute*', async route => {
        const wire = new URLSearchParams(route.request().postData() || '').get('f.req')!;
        const args = JSON.parse(JSON.parse(wire)[0][0][1]);
        const pinned = args[2][0] === 1;
        const cursor = args[1];
        requests[round].push(pinned ? 'pinned' : cursor || 'head');
        let data: unknown = [];
        if (!pinned) {
            if (round === 0) data = cursor === null ? [null, [row('old100', 100), row('old90', 90)], 'tC_middle']
                : cursor === 'tC_middle' ? [null, [row('old80', 80), row('old70', 70)], 'tC_limit'] : null;
            else data = [null, round === 1 ? [row('new120', 120), row('new110', 110), row('new95', 95), row('new85', 85)]
                : [row('old70', 130), row('new120', 120), row('new110', 110), row('new95', 95)], 'tC_middle'];
        }
        const packet = data === null ? ['wrb.fr', 'MaZiqc', null, null, null, ['BardErrorInfo', 1096]]
            : ['wrb.fr', 'MaZiqc', JSON.stringify(data)];
        await route.fulfill({ contentType: 'application/json', body: `)]}'\n\n${JSON.stringify([packet])}` });
    });
    await gemini.goto('https://gemini.google.com/app');
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/src/ui/options/options.html?notour=1`);
    await options.evaluate(async () => {
        await chrome.storage.local.set({ gemini_conversations: [{ id: 'retained', title: 'Retained archive', timestamp: 1 }], exportedIds: { retained: { status: 'ok' } } });
        await chrome.storage.local.remove('gemini_scan_coverage');
    });
    const read = () => options.evaluate(async () => chrome.storage.local.get<{ gemini_scan_coverage: ScanCoverage; gemini_conversations: Conversation[]; exportedIds: Record<string, { status: string }> }>(['gemini_scan_coverage', 'gemini_conversations', 'exportedIds']));
    await options.click('#btnSyncAll');
    await expect(options.locator('#takeoutLimitModal')).toBeVisible({ timeout: 15000 });
    const first = await read();
    expect(first.gemini_scan_coverage).toMatchObject({ initialized: true, historyComplete: false, lastStatus: 'partial_limit' });
    expect(first.gemini_scan_coverage.streams.recent.range!.head).toMatchObject({ id: 'old100', time: 1700000100000 });
    expect(requests[0]).toEqual(['pinned', 'head', 'tC_middle', 'tC_limit']);
    await options.click('#btnModalDismissTakeout');
    for (round = 1; round <= 2; round++) {
        await options.click('#btnSyncAll');
        await expect.poll(async () => (await read()).gemini_scan_coverage.lastStatus).toBe('up_to_date');
        await expect(options.locator('#btnSyncAll')).toBeEnabled();
        const stored = await read();
        expect(stored.gemini_scan_coverage).toMatchObject({ initialized: true, historyComplete: false, activeRunId: null });
        expect(stored.gemini_scan_coverage.streams.recent.range!.head.time).toBe(round === 1 ? 1700000120000 : 1700000130000);
        expect(stored.gemini_scan_coverage.streams.recent.range!.tail.time).toBe(1700000070000);
        expect(requests[round]).toEqual(['pinned', 'head']);
        expect(stored.gemini_conversations.find((item: { id: string }) => item.id === 'retained')?.cloudAvailability).toBeUndefined();
        expect(stored.exportedIds.retained.status).toBe('ok');
        expect(JSON.stringify(stored.gemini_scan_coverage)).not.toContain('tC_');
    }
    await expect(options.locator('#list .item')).toHaveCount(9);
});

test('a naturally observed non-head page initializes coverage and later sync connects through the intervening pages', async ({ context, extensionId }) => {
    const gemini = await context.newPage();
    await gemini.route('https://gemini.google.com/**', route => route.fulfill({ contentType: 'text/html', body: `<script>window._WIZ_global_data={SNlM0e:'test',cfb2h:'test'}</script><button aria-label="Google Account: Sync (passive@example.com)">Account</button>` }));
    const requests: string[] = [];
    await gemini.route('**/batchexecute*', async route => {
        const args = JSON.parse(JSON.parse(new URLSearchParams(route.request().postData() || '').get('f.req')!)[0][0][1]);
        const pinned = args[2][0] === 1;
        const cursor = args[1];
        requests.push(pinned ? 'pinned' : cursor || 'head');
        const values = cursor === 'tC_segment' ? [80, 70] : cursor === 'tC_prefix' ? [100, 90] : [120, 110];
        const next = cursor === 'tC_segment' ? 'tC_unread' : cursor === 'tC_prefix' ? 'tC_segment' : 'tC_prefix';
        const inner = pinned ? [] : [null, values.map(value => ['c_passive' + value, 'Passive ' + value, null, null, null, [1700000000 + value, 0]]), next];
        await route.fulfill({ contentType: 'application/json', body: `)]}'\n\n${JSON.stringify([['wrb.fr', 'MaZiqc', JSON.stringify(inner)]])}` });
    });
    await gemini.goto('https://gemini.google.com/app');
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/src/ui/options/options.html?notour=1`);
    await options.evaluate(async () => chrome.storage.local.remove('gemini_scan_coverage'));
    await gemini.evaluate(async () => {
        const body = new URLSearchParams({ 'f.req': JSON.stringify([[['MaZiqc', JSON.stringify([20, 'tC_segment', [0, null, 1]]), null, 'generic']]]) });
        await fetch('/_/BardChatUi/data/batchexecute', { method: 'POST', body });
    });
    const read = () => options.evaluate(async () => (await chrome.storage.local.get<{ gemini_scan_coverage: ScanCoverage }>('gemini_scan_coverage')).gemini_scan_coverage);
    await expect.poll(async () => (await read())?.streams?.recent?.range?.head?.id).toBe('passive80');
    expect(await read()).toMatchObject({ initialized: true, historyComplete: false });
    await options.click('#btnSyncAll');
    await expect.poll(async () => (await read())?.lastStatus).toBe('up_to_date');
    expect(requests).toEqual(['tC_segment', 'pinned', 'head', 'tC_prefix']);
    expect((await read()).streams.recent.range).toEqual({ head: { id: 'passive120', time: 1700000120000 }, tail: { id: 'passive70', time: 1700000070000 } });
});

test('a complete current scan replaces a disjoint old interval without stopping against its own writes', async ({ context, extensionId }) => {
    const gemini = await context.newPage();
    await gemini.route('https://gemini.google.com/**', route => route.fulfill({ contentType: 'text/html', body: `<script>window._WIZ_global_data={SNlM0e:'test',cfb2h:'test'}</script><button aria-label="Google Account: Rebuild (rebuild@example.com)">Account</button>` }));
    let round = 0;
    const requests: string[][] = [[], []];
    await gemini.route('**/batchexecute*', async route => {
        const args = JSON.parse(JSON.parse(new URLSearchParams(route.request().postData()!).get('f.req')!)[0][0][1]);
        const pinned = args[2][0] === 1;
        const cursor = args[1];
        requests[round].push(pinned ? 'pinned' : cursor || 'head');
        const values = round === 0 ? [100, 70] : cursor === null ? [150, 140] : [130, 120];
        const next = !pinned && round === 1 && cursor === null ? 'tC_fresh' : null;
        const data = pinned ? [] : [null, values.map(time => ['c_rebuild' + time, 'Rebuild ' + time, null, null, null, [1700000000 + time, 0]]), next];
        await route.fulfill({ contentType: 'application/json', body: `)]}'\n\n${JSON.stringify([['wrb.fr', 'MaZiqc', JSON.stringify(data)]])}` });
    });
    await gemini.goto('https://gemini.google.com/app');
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/src/ui/options/options.html?notour=1`);
    const read = () => options.evaluate(async () => (await chrome.storage.local.get<{ gemini_scan_coverage: ScanCoverage }>('gemini_scan_coverage')).gemini_scan_coverage);
    await options.click('#btnSyncAll');
    await expect.poll(async () => (await read())?.lastStatus).toBe('complete');
    await expect(options.locator('#btnSyncAll')).toBeEnabled();
    expect((await read()).streams.recent.range!.tail.time).toBe(1700000070000);
    round = 1;
    await options.click('#btnSyncAll');
    await expect.poll(async () => (await read())?.streams.recent.range?.head.time).toBe(1700000150000);
    expect(await read()).toMatchObject({ historyComplete: true, lastStatus: 'complete', activeRunId: null });
    expect((await read()).streams.recent.range!.tail.time).toBe(1700000120000);
    expect(requests[1]).toEqual(['pinned', 'head', 'tC_fresh']);
    await expect(options.locator('#list .item')).toHaveCount(6);
});

test('passive evidence arriving during the active head request fills the shared chain against the frozen baseline', async ({ context, extensionId }) => {
    const gemini = await context.newPage();
    await gemini.route('https://gemini.google.com/**', route => route.fulfill({ contentType: 'text/html', body: `<script>window._WIZ_global_data={SNlM0e:'test',cfb2h:'test'}</script><button aria-label="Google Account: Shared (shared@example.com)">Account</button>` }));
    const requests: string[] = [];
    let releaseHead!: () => void;
    const headReady = new Promise<void>(resolve => { releaseHead = resolve; });
    await gemini.route('**/batchexecute*', async route => {
        const args = JSON.parse(JSON.parse(new URLSearchParams(route.request().postData()!).get('f.req')!)[0][0][1]);
        const pinned = args[2][0] === 1;
        const cursor = args[1];
        requests.push(pinned ? 'pinned' : cursor || 'head');
        if (!pinned && cursor === null) await headReady;
        const values = cursor === 'tC_middle' ? [105, 95] : [120, 110];
        const next = cursor === 'tC_middle' ? 'tC_unread' : 'tC_middle';
        const data = pinned ? [] : [null, values.map(time => ['c_shared' + time, 'Shared ' + time, null, null, null, [1700000000 + time, 0]]), next];
        await route.fulfill({ contentType: 'application/json', body: `)]}'\n\n${JSON.stringify([['wrb.fr', 'MaZiqc', JSON.stringify(data)]])}` });
    });
    await gemini.goto('https://gemini.google.com/app');
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/src/ui/options/options.html?notour=1`);
    // Persisted interval from a prior extension session: no in-memory page chain.
    await options.evaluate(async () => {
        await chrome.storage.local.set({ gemini_scan_coverage: { version: 3, providerId: 'gemini', revision: 1, generation: 'shared-generation',
            resetAt: 0, accountId: 'shared@example.com', initialized: true, historyComplete: false, complete: false,
            streams: { recent: { initialized: true, historyComplete: false,
                range: { head: { id: 'old100', time: 1700000100000 }, tail: { id: 'old70', time: 1700000070000 } } } },
            baseline: null, activeRunId: null, lastStatus: 'partial_limit' } });
    });
    const read = () => options.evaluate(async () => (await chrome.storage.local.get<{ gemini_scan_coverage: ScanCoverage }>('gemini_scan_coverage')).gemini_scan_coverage);
    try {
        await options.click('#btnSyncAll');
        await expect.poll(() => requests.includes('head')).toBe(true);
        await gemini.evaluate(async () => {
            await fetch('/_/BardChatUi/data/batchexecute', { method: 'POST', body: new URLSearchParams({
                'f.req': JSON.stringify([[['MaZiqc', JSON.stringify([20, 'tC_middle', [0, null, 1]]), null, 'generic']]])
            }) });
        });
        await expect.poll(async () => (await read()).streams.recent.range?.head.time).toBe(1700000105000);
        expect((await read()).activeRunId).not.toBeNull();
        releaseHead();
        await expect.poll(async () => (await read()).lastStatus).toBe('up_to_date');
        expect(requests).toEqual(['pinned', 'head', 'tC_middle']);
        expect((await read()).streams.recent.range).toEqual({ head: { id: 'shared120', time: 1700000120000 }, tail: { id: 'old70', time: 1700000070000 } });
    } finally { releaseHead(); }
});
