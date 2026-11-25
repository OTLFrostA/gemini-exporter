export {};
import test, { after, before } from 'node:test';
import assert from 'node:assert';
import { chromium, type Browser } from 'playwright';
import { mount, A } from './helpers/uiPortHarness.js';

let browser: Browser;
before(async () => {
    browser = await chromium.launch({ channel: 'chrome', chromiumSandbox: true, headless: true });
});
after(async () => {
    await browser?.close();
});

test('Batch 4 - Canonical classifyDetailError and isConfirmedDeletedError in GeminiProtocol', () => {
    const {
        isConfirmedDeletedError,
        classifyDetailError,
    } = require('../src/l1/protocol/gemini/protocol.js');

    assert.strictEqual(isConfirmedDeletedError('["BardErrorInfo", 1167]'), true);
    assert.strictEqual(classifyDetailError('["BardErrorInfo", 1167]'), 'confirmed_deleted');
    assert.strictEqual(isConfirmedDeletedError('会话已在服务端删除 (c_123) [BardErrorInfo: 1167]'), true);
    assert.strictEqual(isConfirmedDeletedError('HTTP 404 Not Found'), false);
    assert.strictEqual(isConfirmedDeletedError('some error', 404), false);

    assert.strictEqual(isConfirmedDeletedError('["BardErrorInfo", 11167]'), false);
    assert.strictEqual(classifyDetailError('["BardErrorInfo", 11167]'), 'inaccessible');

    assert.strictEqual(isConfirmedDeletedError('["BardErrorInfo", 500]'), false);
    assert.strictEqual(classifyDetailError('["BardErrorInfo", 500]'), 'inaccessible');

    assert.strictEqual(isConfirmedDeletedError('["BardErrorInfo", 1096]'), false);
    assert.strictEqual(classifyDetailError('["BardErrorInfo", 1096]'), 'inaccessible');
    assert.strictEqual(classifyDetailError('Quota exceeded', 429), 'rate_limited');

    assert.strictEqual(classifyDetailError('Unexpected token < in JSON'), 'parse_error');
    assert.strictEqual(classifyDetailError(''), 'unknown');
});

test('Batch 4 - listView constructs fixed-origin links and renders untrusted titles as text', async () => {
    const context = await browser.newContext();
    try {
        const page = await context.newPage();
        const title = '<img src=x onerror=alert(1)>';
        await mount(page, 'options', { indexes: [
            { key: { accountId: A, conversationId: 'evil1' }, title, url: 'javascript:alert(1)' },
            { key: { accountId: A, conversationId: 'evil2' }, title: 'Data URL', url: 'data:text/html,<script>alert(1)</script>' },
            { key: { accountId: A, conversationId: 'good' }, title: 'Good', url: 'https://evil.test/' },
        ] });
        await page.locator('#list .open-link').first().waitFor();
        const links = await page.locator('#list .open-link').evaluateAll(nodes => nodes.map(node => ({
            href: node.getAttribute('href'), rel: node.getAttribute('rel'),
        })));
        assert.deepStrictEqual(links.map(link => link.href).sort(), ['evil1', 'evil2', 'good'].map(id => 'https://gemini.google.com/app/' + id));
        assert.ok(links.every(link => link.rel === 'noopener noreferrer'));
        assert.strictEqual(await page.locator('#list img, #list script').count(), 0);
        assert.ok((await page.locator('#list').textContent())?.includes(title));
    } finally {
        await context.close();
    }
});

test('Conversation links use each selected provider with encoded identity', async () => {
    for (const [providerId, origin] of [['claude', 'https://claude.ai/chat/'], ['chatgpt', 'https://chatgpt.com/c/']]) {
        const context = await browser.newContext();
        try {
            const page = await context.newPage();
            await mount(page, 'options', {
                accounts: [{ id: A, providerId, providerAccountId: 'test' }],
                indexes: [{ key: { accountId: A, conversationId: 'id/with?query' }, title: 'Provider link' }],
            });
            const link = page.locator('#list .open-link');
            await link.waitFor();
            assert.strictEqual(await link.getAttribute('href'), origin + 'id%2Fwith%3Fquery');
            assert.ok((await link.getAttribute('aria-label'))?.includes(providerId === 'claude' ? 'Claude' : 'ChatGPT'));
        } finally {
            await context.close();
        }
    }
});
