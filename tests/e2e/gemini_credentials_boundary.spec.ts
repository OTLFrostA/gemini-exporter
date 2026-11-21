import { geminiListPage } from '../fixtures/providers/geminiListCapture.js';
import { test, expect } from './fixtures';

for (const transport of ['fetch', 'XHR'] as const) test(`native Gemini ${transport} feeds extension storage without putting credentials on the page bus`, async ({ context }) => {
    const source = await context.newPage();
    const { requestBody, responseBody } = geminiListPage();
    await source.route('https://gemini.google.com/**', route => {
        if (new URL(route.request().url()).pathname.endsWith('/batchexecute')) {
            return route.fulfill({ contentType: 'application/json', body: responseBody });
        }
        return route.fulfill({ contentType: 'text/html', body: '<title>Offline Gemini fixture</title>' });
    });
    await source.goto('https://gemini.google.com/u/1/app');
    await expect(source.locator('#geminiExportBadge')).toBeVisible();

    const boundary = await source.evaluate(async ({ requestBody, transport }) => {
        const counts = { list: 0, credentialEvents: 0, rpcUrlsWithQuery: 0 };
        const listDelivered = new Promise<void>(resolve => {
            window.addEventListener('message', function receive(event) {
                if (event.data?.type === 'GEMINI_CREDENTIALS') counts.credentialEvents++;
                if (event.data?.type !== 'GEMINI_NETWORK_BATCHEXECUTE') return;
                counts.list++;
                if (new URL(event.data.payload.url).search) counts.rpcUrlsWithQuery++;
                window.removeEventListener('message', receive);
                resolve();
            });
        });
        const body = new URLSearchParams(requestBody);
        body.set('at', 'fixture-at');
        const url = '/u/1/_/BardChatUi/data/batchexecute?f.sid=fixture-sid&bl=fixture-build';
        if (transport === 'fetch') {
            const response = await fetch(url, { method: 'POST', body });
            await response.text();
        } else {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', url);
            const done = new Promise<void>(resolve => xhr.addEventListener('loadend', () => resolve(), { once: true }));
            xhr.send(body.toString());
            await done;
        }
        await listDelivered;
        return counts;
    }, { requestBody, transport });
    expect(boundary, 'page bus should carry list facts, not credential events or RPC query strings')
        .toEqual({ list: 1, credentialEvents: 0, rpcUrlsWithQuery: 0 });

    const worker = context.serviceWorkers()[0];
    await expect.poll(() => worker.evaluate(async () => {
        const { gemini_credentials_map } = await chrome.storage.session.get('gemini_credentials_map');
        const entry = (gemini_credentials_map as Record<string, { at?: string; bl?: string; accountSlot?: string }> | undefined)
            ?.['fixture-sid'];
        return entry?.at === 'fixture-at' && entry?.bl === 'fixture-build' && entry?.accountSlot === 'u1';
    }), { message: 'extension session storage still has the native RPC credentials for u1' }).toBe(true);
});
