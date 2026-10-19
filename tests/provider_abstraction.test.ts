/**
 * tests/provider_abstraction.test.ts
 * Comprehensive unit test suite for AIProvider abstraction layer,
 * ProviderRegistry and GeminiProvider.
 */
import test from 'node:test';
import assert from 'node:assert';

import { ProviderRegistryClass } from '../src/core/provider/providerRegistry.js';
import { GeminiProvider } from '../src/core/provider/gemini/geminiProvider.js';
import * as TabService from '../src/core/utils/tabService.js';

test('TabService - getAITab and sendToAITab integration', async () => {
    const origChrome = (global as any).chrome;
    try {
        const queries: string[] = [];
        const messages: Array<{ tabId: number; message: unknown }> = [];
        (global as any).chrome = {
            tabs: {
                query: async ({ url }: { url: string }) => {
                    queries.push(url);
                    try {
                        const parsed = new URL(url.replace(/\*$/, ''));
                        if (parsed.hostname === 'chatgpt.com') {
                            return [{ id: 101, url: 'https://chatgpt.com/c/test', active: true }];
                        }
                        if (parsed.hostname === 'gemini.google.com') {
                            return [{ id: 202, url: 'https://gemini.google.com/app', active: true }];
                        }
                    } catch {}
                    return [];
                },
                sendMessage: (tabId: number, message: unknown, cb: (res: unknown) => void) => {
                    messages.push({ tabId, message });
                    cb({ ok: true, data: 'tab-response' });
                }
            },
            runtime: {}
        };

        const chatgptTab = await TabService.getAITab('chatgpt');
        assert.strictEqual(chatgptTab?.id, 101, 'Should resolve ChatGPT tab');

        const geminiTab = await TabService.getAITab('gemini');
        assert.strictEqual(geminiTab?.id, 202, 'Should resolve Gemini tab');

        const res = await TabService.sendToAITab('chatgpt', { action: 'test' });
        assert.deepStrictEqual(res, { ok: true, data: 'tab-response' });
        assert.deepStrictEqual(queries, ['https://chatgpt.com/*', 'https://gemini.google.com/*', 'https://chatgpt.com/*']);
        assert.deepStrictEqual(messages, [{ tabId: 101, message: { action: 'test' } }]);
    } finally {
        (global as any).chrome = origChrome;
    }
});
