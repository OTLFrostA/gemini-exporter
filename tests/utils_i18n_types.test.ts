import test from 'node:test';
import assert from 'node:assert';

import * as TabService from '../src/core/utils/tabService.js';
import * as I18n from '../src/core/utils/i18n.js';
import zhLocale from '../src/core/utils/locales/zh.js';
import enLocale from '../src/core/utils/locales/en.js';


test('TabService - type and export contract', () => {
    assert.ok(TabService, 'TabService must be exported');
    assert.strictEqual(typeof TabService.getGeminiTab, 'function');
    assert.strictEqual(typeof TabService.sendToGeminiTab, 'function');
    assert.strictEqual(typeof TabService.checkGeminiStatus, 'function');
    assert.strictEqual(typeof TabService.openGeminiPage, 'function');
    assert.strictEqual(typeof TabService.reloadGeminiTab, 'function');
});

test('TabService - getGeminiTab handles missing API and empty queries', async () => {
    const origChrome = (global as any).chrome;
    try {
        (global as any).chrome = undefined;
        const noApiTab = await TabService.getGeminiTab('u0');
        assert.strictEqual(noApiTab, null, 'Should return null when chrome.tabs is undefined');

        (global as any).chrome = {
            tabs: {
                query: async () => []
            }
        };
        const emptyTab = await TabService.getGeminiTab('u0');
        assert.strictEqual(emptyTab, null, 'Should return null when no tabs match');
    } finally {
        (global as any).chrome = origChrome;
    }
});

test('TabService - getGeminiTab slot matching and active fallback', async () => {
    const origChrome = (global as any).chrome;
    try {
        (global as any).chrome = {
            tabs: {
                query: async () => [
                    { id: 10, url: 'https://gemini.google.com/app', active: false },
                    { id: 20, url: 'https://gemini.google.com/u/1/app', active: false },
                    { id: 30, url: 'https://gemini.google.com/u/2/app', active: true }
                ]
            }
        };

        const tabU1 = await TabService.getGeminiTab('u1');
        assert.strictEqual(tabU1?.id, 20, 'Should match tab with /u/1/');

        const tabU2 = await TabService.getGeminiTab('u2');
        assert.strictEqual(tabU2?.id, 30, 'Should match tab with /u/2/');

        const tabU3 = await TabService.getGeminiTab('u3');
        assert.strictEqual(tabU3, null, 'Should return null when requested slot is not open');

        const tabU0 = await TabService.getGeminiTab('u0');
        assert.strictEqual(tabU0?.id, 10, 'Should match default u0 tab without /u/N/');

        const tabDefault = await TabService.getGeminiTab();
        assert.strictEqual(tabDefault?.id, 30, 'Should fallback to active tab when no slot is specified');
    } finally {
        (global as any).chrome = origChrome;
    }
});

test('TabService - sendToGeminiTab failover across candidates and timeouts', async () => {
    const origChrome = (global as any).chrome;
    try {
        // Test missing chrome.tabs
        (global as any).chrome = undefined;
        await assert.rejects(
            () => TabService.sendToGeminiTab({ action: 'ping' }),
            /chrome\.tabs API 不可用/
        );

        // Test failover when first tab has 'Receiving end does not exist'
        let attempts: any[] = [];
        (global as any).chrome = {
            tabs: {
                query: async () => [
                    { id: 101, url: 'https://gemini.google.com/app', active: false },
                    { id: 102, url: 'https://gemini.google.com/app', active: true }
                ],
                sendMessage: (tabId: any, msg: any, cb: any) => {
                    attempts.push(tabId);
                    if (tabId === 102) {
                        // 102 is active, so sorted first
                        (global as any).chrome.runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' };
                        cb(null);
                    } else {
                        (global as any).chrome.runtime.lastError = null;
                        cb({ success: true, fromTab: tabId });
                    }
                }
            },
            runtime: { lastError: null }
        };

        const res = await TabService.sendToGeminiTab({ action: 'ping' });
        assert.deepStrictEqual(res, { success: true, fromTab: 101 }, 'Should fail over to next candidate');
        assert.deepStrictEqual(attempts, [102, 101], 'Should try active tab first then next candidate');

        // Test timeout calculation
        let timeoutRecorded: any = null;
        const origSetTimeout = global.setTimeout;
        (global as any).setTimeout = (fn: any, ms: any) => {
            timeoutRecorded = ms;
            return origSetTimeout(fn, 1000000); // don't fire
        };
        try {
            (global as any).chrome.tabs.sendMessage = (tabId: any, msg: any, cb: any) => {
                // Immediate response so promise resolves
                cb({ ok: true });
            };
            await TabService.sendToGeminiTab({ action: 'deepScan' });
            assert.strictEqual(timeoutRecorded, 300000, 'deepScan action should default to 300000ms');

            await TabService.sendToGeminiTab({ action: 'fetchHistory' });
            assert.strictEqual(timeoutRecorded, 25000, 'other actions should default to 25000ms');

            await TabService.sendToGeminiTab({ action: 'fetchHistory' }, undefined, 12345);
            assert.strictEqual(timeoutRecorded, 12345, 'explicit timeoutMs should be respected');
        } finally {
            global.setTimeout = origSetTimeout;
        }
    } finally {
        (global as any).chrome = origChrome;
    }
});

test('TabService - checkGeminiStatus lifecycle results', async () => {
    const origChrome = (global as any).chrome;
    try {
        (global as any).chrome = undefined;
        const noApi = await TabService.checkGeminiStatus();
        assert.strictEqual(noApi.status, 'NO_TABS_API');

        (global as any).chrome = {
            tabs: {
                query: async () => []
            }
        };
        const noTab = await TabService.checkGeminiStatus();
        assert.strictEqual(noTab.status, 'NO_TAB');

        // Connected
        (global as any).chrome = {
            tabs: {
                query: async () => [{ id: 55, url: 'https://gemini.google.com/app', active: true }],
                sendMessage: (tabId: any, msg: any, cb: any) => {
                    cb({ ok: true, version: '1.0' });
                }
            },
            runtime: { lastError: null }
        };
        const connected = await TabService.checkGeminiStatus();
        assert.strictEqual(connected.status, 'CONNECTED');
        assert.strictEqual(connected.tab?.id, 55);
        assert.deepStrictEqual(connected.response, { ok: true, version: '1.0' });

        // Ping error requires refresh
        (global as any).chrome.tabs.sendMessage = (tabId: any, msg: any, cb: any) => {
            (global as any).chrome.runtime.lastError = { message: 'Port closed' };
            cb(null);
        };
        const needRefresh = await TabService.checkGeminiStatus();
        assert.strictEqual(needRefresh.status, 'NEED_REFRESH');
        assert.strictEqual(needRefresh.error, 'Port closed');
    } finally {
        (global as any).chrome = origChrome;
    }
});

test('TabService - openGeminiPage and reloadGeminiTab fallback delegation', async () => {
    const origChrome = (global as any).chrome;
    try {
        let createdUrl: any = null;
        let reloadedTabId: any = null;
        (global as any).chrome = {
            tabs: {
                create: async (opts: any) => { createdUrl = opts.url; return { id: 99 }; },
                reload: async (id: any) => { reloadedTabId = id; }
            }
        };

        await TabService.openGeminiPage();
        assert.strictEqual(createdUrl, 'https://gemini.google.com/app');

        await TabService.reloadGeminiTab(99);
        assert.strictEqual(reloadedTabId, 99);

        // Fallback to chrome.runtime.sendMessage
        let runtimeMsg: any = null;
        (global as any).chrome = {
            runtime: {
                sendMessage: async (msg: any) => { runtimeMsg = msg; }
            }
        };
        await TabService.openGeminiPage();
        assert.deepStrictEqual(runtimeMsg, { action: 'openGeminiPage' });

        await TabService.reloadGeminiTab(77);
        assert.deepStrictEqual(runtimeMsg, { action: 'reloadGeminiTab', tabId: 77 });
    } finally {
        (global as any).chrome = origChrome;
    }
});

test('I18n - contract, fallbacks and dictionary formatting', async () => {
    assert.ok(I18n, 'I18n module must be exported');
    assert.strictEqual(typeof I18n.t, 'function');
    assert.strictEqual(typeof I18n.initLanguage, 'function');
    assert.strictEqual(typeof I18n.getLang, 'function');
    assert.strictEqual(typeof I18n.setLang, 'function');
    assert.strictEqual(typeof I18n.onLanguageChange, 'function');
    assert.strictEqual(typeof I18n.applyI18n, 'function');

    // Test fallback chain
    await I18n.setLang('zh');
    assert.strictEqual(I18n.getLang(), 'zh');
    // Nonexistent key returns key itself
    assert.strictEqual(I18n.t('__non_existent_key__'), '__non_existent_key__');

    // Parametric replacements
    assert.strictEqual(I18n.t('dirCurrent', '/tmp/export'), '已选目录: /tmp/export');
    assert.strictEqual(I18n.t('dirCurrent', null), '已选目录: ');

    // Test locale dictionaries parity and direct exports
    assert.ok(zhLocale.extName, 'zh dictionary has extName');
    assert.ok(enLocale.extName, 'en dictionary has extName');
    assert.strictEqual(zhLocale.extName, enLocale.extName);

    const zhKeys = Object.keys(zhLocale).sort();
    const enKeys = Object.keys(enLocale).sort();
    assert.strictEqual(zhKeys.length, enKeys.length, 'zh and en locales must have identical key count');
    assert.deepStrictEqual(zhKeys, enKeys, 'zh and en locales must have 100% matched keys');
});
