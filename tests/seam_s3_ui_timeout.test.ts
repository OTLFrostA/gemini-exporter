import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

// S3: UI -> background hops must carry their own timeout so a lost response
// can never wedge UI state (stuck scanRunning / stuck P1-123 export guard).

// ---- Part 1: the mechanism (sendTypedMessage timeout) ---------------------

function mockChrome(impl: { sendMessage: (msg: any, cb: any) => void }) {
    (global as any).chrome = {
        runtime: {
            sendMessage: impl.sendMessage,
            lastError: null,
        },
    };
}

const { sendTypedMessage } = require('../src/core/utils/messaging.ts');

test('S3 - sendTypedMessage resolves when the response arrives', async () => {
    mockChrome({
        sendMessage: (_msg: any, cb: any) => { cb({ ok: true }); },
    });
    const res: any = await sendTypedMessage({ action: 'ping' }, 1000);
    assert.strictEqual(res.ok, true);
});

test('S3 - sendTypedMessage rejects on timeout when the response never arrives', async () => {
    mockChrome({
        sendMessage: (_msg: any, _cb: any) => { /* never calls back: SW evicted */ },
    });
    await assert.rejects(
        sendTypedMessage({ action: 'deepScan' }, 50),
        /timeout/,
        'a lost response must reject, not hang forever'
    );
});

test('S3 - sendTypedMessage rejects on chrome.runtime.lastError', async () => {
    mockChrome({
        sendMessage: (_msg: any, cb: any) => {
            (global as any).chrome.runtime.lastError = { message: 'Receiving end does not exist.' };
            cb();
            (global as any).chrome.runtime.lastError = null;
        },
    });
    await assert.rejects(sendTypedMessage({ action: 'ping' }, 1000), /Receiving end/);
});

// UI export and scan now call Application directly; their AbortSignal/lock behavior
// is exercised through real Chromium in ui-v2-adaptation.test.js. The messaging
// timeout tests above remain relevant to the Browser Runtime transport boundary.
