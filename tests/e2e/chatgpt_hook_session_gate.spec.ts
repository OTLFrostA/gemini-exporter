import * as path from 'node:path';
import { test, expect } from './fixtures';
import { sessionGen as chatgptSessionGen } from '../fixtures/providers/chatgptSession.js';
import { streamGen } from '../fixtures/providers/chatgptStream.js';

test.use({ grantGemini: false });

// The shipped MAIN-world bundle runs in a real ChatGPT-origin page; only HTTP is local.
const hookBundle = path.resolve(__dirname, '../../dist/content/chatgpt-hook.js');

test('a stalled ChatGPT session lookup never holds back or un-aborts native site requests', async ({ context }) => {
    test.setTimeout(45_000);
    const page = await context.newPage();
    let releaseSession!: () => void;
    const sessionHeld = new Promise<void>(resolve => { releaseSession = resolve; });
    const sessionFailed = page.waitForEvent('requestfailed', {
        predicate: request => request.url().endsWith('/api/auth/session'), timeout: 20_000 });
    sessionFailed.catch(() => {});
    const conversationPosts: string[] = [];
    await page.route('https://chatgpt.com/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<main>ChatGPT fixture</main>' });
        if (url.pathname === '/api/auth/session') {
            await sessionHeld;
            return route.fulfill({ json: chatgptSessionGen('C_CAPTURE_SESSION_01') }).catch(() => {});
        }
        if (url.pathname === '/backend-api/f/conversation') {
            conversationPosts.push(route.request().postData() ?? '');
            if (route.request().postData() === '{"hold":true}') return;
            return route.fulfill({ contentType: 'text/event-stream', body: streamGen('C_STREAM_CAPTURE_CHUNK_01') });
        }
        return route.abort();
    });
    await page.addInitScript({ path: hookBundle });
    await page.goto('https://chatgpt.com/');
    expect(await page.evaluate(() => Reflect.get(window, '__gemExporterChatGPTHookInstalled'))).toBe(true);

    const completed = await page.evaluate(async () => {
        const send = fetch('/backend-api/f/conversation', { method: 'POST', body: '{}' }).then(r => r.text());
        return Promise.race([send, new Promise<string>(resolve => setTimeout(() => resolve('still pending'), 3000))]);
    });
    expect(completed).toContain('data: [DONE]');

    const aborted = await page.evaluate(async () => {
        const controller = new AbortController();
        const send = fetch('/backend-api/f/conversation', { method: 'POST', body: '{"hold":true}', signal: controller.signal })
            .then(() => 'resolved', (error: Error) => error.name);
        setTimeout(() => controller.abort(), 500);
        return Promise.race([send, new Promise<string>(resolve => setTimeout(() => resolve('still pending'), 3000))]);
    });
    expect(aborted).toBe('AbortError');
    expect(conversationPosts).toEqual(['{}', '{"hold":true}']);

    // The observation-only lookup itself is bounded instead of pending forever.
    expect((await sessionFailed).failure()?.errorText).toBe('net::ERR_ABORTED');
    releaseSession();
});

test('a prompt ChatGPT session lookup still captures the stream for the extension', async ({ context }) => {
    const page = await context.newPage();
    await page.route('https://chatgpt.com/**', route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<main>ChatGPT fixture</main>' });
        if (url.pathname === '/api/auth/session') return route.fulfill({ json: chatgptSessionGen('C_CAPTURE_SESSION_01') });
        if (url.pathname === '/backend-api/f/conversation')
            return route.fulfill({ contentType: 'text/event-stream', body: streamGen('C_STREAM_CAPTURE_CHUNK_01') });
        return route.abort();
    });
    await page.addInitScript({ path: hookBundle });
    await page.goto('https://chatgpt.com/');
    const captured = await page.evaluate(async () => {
        const event = new Promise<unknown>(resolve => window.addEventListener('message', message => {
            if (message.data?.type === 'gemini-exporter:chatgpt-source-v1') resolve(message.data.payload);
        }));
        const body = await (await fetch('/backend-api/f/conversation', { method: 'POST', body: '{}' })).text();
        return { body, payload: await event };
    });
    expect(captured.body).toContain('data: [DONE]');
    expect(captured.payload).toMatchObject({ kind: 'stream', conversationId: '6acffdc5-c4d0-83e8-8e1b-ba60979a618a',
        requestIdentity: '["subject","workspace"]', url: 'https://chatgpt.com/backend-api/f/conversation' });
});
