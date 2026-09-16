import test from 'node:test';
import assert from 'node:assert';

// S2: background router fail-closed (unknown action, empty tab response).

const msgListeners: Array<(msg: any, sender: any, sendResponse: any) => any> = [];
const sessionData: Record<string, any> = {};

// Controls what chrome.tabs.sendMessage delivers to the background.
let tabReply: any = { success: true, data: { id: 'c_1', messages: [] } };

(global as any).chrome = {
    runtime: {
        onMessage: { addListener: (fn: any) => { msgListeners.push(fn); } },
        onInstalled: { addListener: () => {} },
        setUninstallURL: (_u: string, cb?: any) => { if (cb) cb(); },
        getURL: (p: string) => `chrome-extension://test/${p}`,
        getPlatformInfo: (cb: any) => { if (cb) cb({}); },
        lastError: null,
    },
    storage: {
        session: {
            get: async (keys: any) => {
                if (keys === null) return { ...sessionData };
                if (typeof keys === 'string') return { [keys]: sessionData[keys] };
                return {};
            },
            set: async (obj: any) => { Object.assign(sessionData, obj); },
            remove: async (keys: any) => {
                const arr = Array.isArray(keys) ? keys : [keys];
                for (const k of arr) delete sessionData[k];
            },
            setAccessLevel: async () => {},
        },
    },
    tabs: {
        onActivated: { addListener: () => {} },
        onUpdated: { addListener: () => {} },
        query: async () => [{ id: 42, url: 'https://gemini.google.com/app', active: true }],
        sendMessage: (_tabId: number, _msg: any, cb: any) => { cb(tabReply); },
    },
    action: {
        setIcon: async () => {},
        setTitle: async () => {},
    },
};

// tabService.ts 末尾 `module.exports = TabService` 覆盖了 esbuild 具名导出，
// ts_register 下 `import { TabService }` 会拿到 undefined（生产 bundle 走 ESM
// 不受影响）。沿用 p1_c_regressions.test.ts 的做法：给 require 缓存打补丁，仅用于测试。
const tabServiceMod: any = require('../src/core/utils/tabService.js');
if (tabServiceMod && !tabServiceMod.TabService) tabServiceMod.TabService = tabServiceMod;

require('../src/background/background.ts');

function lastListener() {
    return msgListeners[msgListeners.length - 1];
}

async function dispatch(msg: any, waitMs = 2000): Promise<{ responses: any[]; returned: any }> {
    const responses: any[] = [];
    const returned = lastListener()(msg, {}, (r: any) => { responses.push(r); });
    const deadline = Date.now() + waitMs;
    while (responses.length === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 25));
    }
    await new Promise((r) => setTimeout(r, 50));
    return { responses, returned };
}

test('S2 - unknown action keeps the intentional "not for me" contract (no response)', async () => {
    // entrypoints.test.ts locks this: background must not reject unknown
    // actions synchronously. Senders only await responses for owned actions.
    const { responses, returned } = await dispatch({ action: 'noSuchAction' }, 300);
    assert.strictEqual(responses.length, 0, 'unknown actions get no response by design');
    assert.ok(!returned, 'listener returns falsy for unowned actions');
});

test('S2 - fetchChat with undefined tab response fails closed', async () => {
    tabReply = undefined;
    try {
        const { responses } = await dispatch({ action: 'fetchChat', id: 'c_1' });
        assert.strictEqual(responses.length, 1, 'sender must get a response');
        const r = responses[0];
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.success, false);
        assert.ok(String(r.error).includes('empty response'));
    } finally {
        tabReply = { success: true, data: { id: 'c_1', messages: [] } };
    }
});

test('S2 - fetchChat passes a real tab response through untouched', async () => {
    const { responses } = await dispatch({ action: 'fetchChat', id: 'c_1' });
    assert.strictEqual(responses.length, 1);
    assert.strictEqual(responses[0].success, true);
    assert.strictEqual(responses[0].data.id, 'c_1');
});

test('S2 - scanProgress broadcast stays fire-and-forget (no response)', async () => {
    const { responses, returned } = await dispatch({ action: 'scanProgress', percent: 50 }, 300);
    assert.strictEqual(responses.length, 0, 'broadcasts must not produce a response');
    assert.ok(!returned, 'no async response expected');
});
