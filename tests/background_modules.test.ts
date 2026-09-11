import test from 'node:test';
import assert from 'node:assert';

// 1. AbortManager unit tests
test('abortManager - per-slot abort isolation and session storage persistence', async () => {
    const {
        __bgAborts,
        isSlotAborted,
        setSlotAborted,
        restoreAbortFlags,
        clearAllAborts
    } = require('../src/background/abortManager.js');

    const sessionData: Record<string, any> = {};
    const origChrome = (global as any).chrome;
    (global as any).chrome = {
        storage: {
            session: {
                get: async (keys: any) => {
                    if (keys === null) return { ...sessionData };
                    if (typeof keys === 'string') return { [keys]: sessionData[keys] };
                    return {};
                },
                set: async (obj: any) => {
                    Object.assign(sessionData, obj);
                },
                remove: async (keys: any) => {
                    const arr = Array.isArray(keys) ? keys : [keys];
                    for (const k of arr) delete sessionData[k];
                }
            }
        }
    };

    try {
        clearAllAborts();
        assert.strictEqual(isSlotAborted('u0'), false);
        assert.strictEqual(isSlotAborted('u1'), false);

        // Abort slot u0
        setSlotAborted('u0', true);
        assert.strictEqual(isSlotAborted('u0'), true);
        assert.strictEqual(isSlotAborted('u1'), false, 'u1 must not be affected by u0 abort');
        assert.strictEqual(sessionData['gemini_abort_u0'], true);

        // Clear u0
        setSlotAborted('u0', false);
        assert.strictEqual(isSlotAborted('u0'), false);
        assert.strictEqual(sessionData['gemini_abort_u0'], undefined);

        // Test restoreAbortFlags
        sessionData['gemini_abort_u2'] = true;
        await restoreAbortFlags();
        assert.strictEqual(isSlotAborted('u2'), true, 'u2 abort flag must be restored from session storage');
    } finally {
        clearAllAborts();
        (global as any).chrome = origChrome;
    }
});

// 2. KeepAlive unit tests
test('keepAlive - startKeepAlive interval triggers getPlatformInfo and clears cleanly', () => {
    const origSetInterval = global.setInterval;
    const origClearInterval = global.clearInterval;
    let calls = 0;
    let clearedId: any = null;

    (global as any).setInterval = (fn: any, _ms: number) => {
        fn();
        return 9999 as any;
    };
    (global as any).clearInterval = (id: any) => {
        clearedId = id;
    };

    const origChrome = (global as any).chrome;
    (global as any).chrome = {
        runtime: {
            getPlatformInfo: (cb?: any) => {
                calls++;
                if (cb) cb();
            }
        }
    };

    try {
        const { startKeepAlive } = require('../src/background/keepAlive.js');
        const stop = startKeepAlive();
        assert.strictEqual(calls, 1, 'keepAlive should immediately trigger getPlatformInfo via mocked interval');
        assert.strictEqual(clearedId, null);

        stop();
        assert.strictEqual(clearedId, 9999, 'stopKeepAlive should clear the registered interval ID');
    } finally {
        global.setInterval = origSetInterval;
        global.clearInterval = origClearInterval;
        (global as any).chrome = origChrome;
    }
});

// 3. TabAction unit tests
test('tabAction - URL detection and icon state switching', async () => {
    const {
        isGeminiTabUrl,
        updateTabActionState,
        ACTION_COLOR_ICONS,
        ACTION_GRAY_ICONS
    } = require('../src/background/tabAction.js');

    assert.strictEqual(isGeminiTabUrl('https://gemini.google.com/app'), true);
    assert.strictEqual(isGeminiTabUrl('https://gemini.google.com/u/1/app/c_123'), true);
    assert.strictEqual(isGeminiTabUrl('https://google.com'), false);
    assert.strictEqual(isGeminiTabUrl('https://example.com/gemini.google.com'), false);
    assert.strictEqual(isGeminiTabUrl(''), false);
    assert.strictEqual(isGeminiTabUrl(null), false);

    let lastSetIcon: any = null;
    let lastSetTitle: any = null;
    const origChrome = (global as any).chrome;
    (global as any).chrome = {
        action: {
            setIcon: async (opts: any) => { lastSetIcon = opts; },
            setTitle: async (opts: any) => { lastSetTitle = opts; }
        }
    };

    try {
        // Active Gemini URL
        updateTabActionState(101, 'https://gemini.google.com/app');
        assert.strictEqual(lastSetIcon.tabId, 101);
        assert.deepStrictEqual(lastSetIcon.path, ACTION_COLOR_ICONS);
        assert.strictEqual(lastSetTitle.tabId, 101);
        assert.ok(lastSetTitle.title.includes('Active'));

        // Non-Gemini URL
        updateTabActionState(102, 'https://github.com');
        assert.strictEqual(lastSetIcon.tabId, 102);
        assert.deepStrictEqual(lastSetIcon.path, ACTION_GRAY_ICONS);
        assert.strictEqual(lastSetTitle.tabId, 102);
        assert.ok(lastSetTitle.title.includes('未激活'));
    } finally {
        (global as any).chrome = origChrome;
    }
});

// 4. LiveSaveHandler unit tests
test('liveSaveHandler - directory missing and deletion detection', async () => {
    const { handleLiveSaveViaHandle, markDirDeletedInConfig } = require('../src/background/liveSaveHandler.js');
    const origChrome = (global as any).chrome;

    let storageConfig: any = { enabledDisk: true, dirName: 'test_dir' };
    (global as any).chrome = {
        storage: {
            local: {
                get: async (keys: any) => {
                    if (keys === 'live_save_config') return { live_save_config: { ...storageConfig } };
                    return {};
                },
                set: async (items: any) => {
                    if (items.live_save_config) storageConfig = { ...items.live_save_config };
                }
            }
        }
    };

    try {
        // Test markDirDeletedInConfig
        await markDirDeletedInConfig();
        assert.strictEqual(storageConfig.enabledDisk, false);
        assert.strictEqual(storageConfig.dirName, '');
        assert.strictEqual(storageConfig.dirError, 'not_found');

        // Test missing dir handle
        const res = await handleLiveSaveViaHandle({ chat: {}, safeTitle: 'test', nid: 'c_123' }, 'u0');
        assert.strictEqual(res.ok, false);
        assert.strictEqual(res.error, 'no_dir_handle');
    } finally {
        (global as any).chrome = origChrome;
    }
});
