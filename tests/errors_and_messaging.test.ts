export {};
const test = require('node:test');
const assert = require('node:assert');

test('errors - active TakeoutParseError extends GeminiError', () => {
    const {
        GeminiError,
        TakeoutParseError
    } = require('../src/shared/types/errors.js');

    // 1. Root GeminiError
    const rootErr = new GeminiError('Root error');
    assert.ok(rootErr instanceof Error);
    assert.ok(rootErr instanceof GeminiError);
    assert.strictEqual(rootErr.name, 'GeminiError');
    assert.strictEqual(rootErr.message, 'Root error');

    // 3. TakeoutParseError
    const takeoutErr = new TakeoutParseError('Structure changed', true, 'MyActivity.html');
    assert.ok(takeoutErr instanceof GeminiError);
    assert.strictEqual(takeoutErr.formatDrift, true);
    assert.strictEqual(takeoutErr.entryName, 'MyActivity.html');

});

test('messaging - getErrorMessage safely normalizes all error types', () => {
    const { getErrorMessage } = require('../src/runtime/ipc/messaging.js');

    assert.strictEqual(getErrorMessage('Simple error string'), 'Simple error string');
    assert.strictEqual(getErrorMessage(new Error('Standard Error object')), 'Standard Error object');
    assert.strictEqual(getErrorMessage({ message: 'Custom object message' }), 'Custom object message');
    assert.strictEqual(getErrorMessage(null), 'Unknown error');
    assert.strictEqual(getErrorMessage(undefined), 'Unknown error');
    assert.strictEqual(getErrorMessage(404), '404');

});

test('messaging - isMessageAction type guard filters actions correctly', () => {
    const { isMessageAction } = require('../src/runtime/ipc/messaging.js');

    assert.strictEqual(isMessageAction({ action: 'ping' }, 'ping'), true);
    assert.strictEqual(isMessageAction({ action: 'sync' }, 'ping'), false);
    assert.strictEqual(isMessageAction(null, 'ping'), false);
    assert.strictEqual(isMessageAction('string', 'ping'), false);
    assert.strictEqual(isMessageAction({}, 'ping'), false);
});

test('messaging - sendTypedMessage resolves response or handles chrome runtime errors', async () => {
    const { sendTypedMessage } = require('../src/runtime/ipc/messaging.js');

    const hadChrome = Object.prototype.hasOwnProperty.call(globalThis, 'chrome');
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    try {
        // Missing runtime must reject rather than silently hang.
        delete (global as any).chrome;
        await assert.rejects(sendTypedMessage({ action: 'test' }), /Chrome runtime messaging is not available/);

        // Successful callback returns the actual response payload.
        (global as any).chrome = {
            runtime: {
                sendMessage: (msg: any, cb: (res: any) => void) => cb({ success: true, echoed: msg.action })
            }
        };
        assert.deepStrictEqual(await sendTypedMessage({ action: 'echoTest' }), { success: true, echoed: 'echoTest' });

        // Chrome lastError must reject instead of treating undefined as success.
        (global as any).chrome = {
            runtime: {
                lastError: { message: 'Receiving end does not exist' },
                sendMessage: (_msg: any, cb: (res: any) => void) => cb(undefined)
            }
        };
        await assert.rejects(sendTypedMessage({ action: 'failingAction' }), /Receiving end does not exist/);

        // Synchronous sendMessage failures are converted to rejected promises.
        (global as any).chrome = {
            runtime: {
                sendMessage: () => { throw new Error('Port closed synchronously'); }
            }
        };
        await assert.rejects(sendTypedMessage({ action: 'throwingAction' }), /Port closed synchronously/);
    } finally {
        if (hadChrome && originalDescriptor) {
            Object.defineProperty(globalThis, 'chrome', originalDescriptor);
        } else {
            delete (global as any).chrome;
        }
    }
});
