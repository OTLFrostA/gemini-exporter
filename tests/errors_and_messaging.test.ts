export {};
const test = require('node:test');
const assert = require('node:assert');

test('errors - GeminiError and error hierarchy inheritance', () => {
    const {
        GeminiError,
        ExportPipelineError,
        TakeoutParseError,
        StorageError
    } = require('../src/types/errors.js');

    // 1. Root GeminiError
    const rootErr = new GeminiError('Root error');
    assert.ok(rootErr instanceof Error);
    assert.ok(rootErr instanceof GeminiError);
    assert.strictEqual(rootErr.name, 'GeminiError');
    assert.strictEqual(rootErr.message, 'Root error');

    // 2. ExportPipelineError
    const pipeErr = new ExportPipelineError('Permission denied', 'chat_123', 'write', true);
    assert.ok(pipeErr instanceof GeminiError);
    assert.strictEqual(pipeErr.chatId, 'chat_123');
    assert.strictEqual(pipeErr.step, 'write');
    assert.strictEqual(pipeErr.isPermissionRevoked, true);

    // 3. TakeoutParseError
    const takeoutErr = new TakeoutParseError('Structure changed', true, 'MyActivity.html');
    assert.ok(takeoutErr instanceof GeminiError);
    assert.strictEqual(takeoutErr.formatDrift, true);
    assert.strictEqual(takeoutErr.entryName, 'MyActivity.html');

    // 4. StorageError
    const storageErr = new StorageError('Quota exceeded', 'set', 'conversations_10000000-0000-4000-8000-000000000001');
    assert.ok(storageErr instanceof GeminiError);
    assert.strictEqual(storageErr.operation, 'set');
    assert.strictEqual(storageErr.key, 'conversations_10000000-0000-4000-8000-000000000001');
});

test('messaging - getErrorMessage safely normalizes all error types', () => {
    const { getErrorMessage } = require('../src/core/utils/messaging.js');
    const utils = require('../src/core/utils/utils.js');

    assert.strictEqual(getErrorMessage('Simple error string'), 'Simple error string');
    assert.strictEqual(getErrorMessage(new Error('Standard Error object')), 'Standard Error object');
    assert.strictEqual(getErrorMessage({ message: 'Custom object message' }), 'Custom object message');
    assert.strictEqual(getErrorMessage(null), 'Unknown error');
    assert.strictEqual(getErrorMessage(undefined), 'Unknown error');
    assert.strictEqual(getErrorMessage(404), '404');

    // Verify GeminiUtils facade re-export
    assert.strictEqual(typeof utils.getErrorMessage, 'function');
    assert.strictEqual(utils.getErrorMessage(new Error('Facade test')), 'Facade test');
});

test('messaging - isMessageAction type guard filters actions correctly', () => {
    const { isMessageAction } = require('../src/core/utils/messaging.js');

    assert.strictEqual(isMessageAction({ action: 'ping' }, 'ping'), true);
    assert.strictEqual(isMessageAction({ action: 'sync' }, 'ping'), false);
    assert.strictEqual(isMessageAction(null, 'ping'), false);
    assert.strictEqual(isMessageAction('string', 'ping'), false);
    assert.strictEqual(isMessageAction({}, 'ping'), false);
});

test('messaging - sendTypedMessage resolves response or handles chrome runtime errors', async () => {
    const { sendTypedMessage } = require('../src/core/utils/messaging.js');

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

test('utils facade - modular sub-utilities re-exported with full compatibility', () => {
    const utils = require('../src/core/utils/utils.js');

    // Title utils
    assert.strictEqual(typeof utils.cleanTitle, 'function');
    assert.strictEqual(typeof utils.isRealTitle, 'function');
    assert.strictEqual(typeof utils.resolveTitle, 'function');
    assert.strictEqual(utils.setTitleBySource, undefined);

    // Path utils
    assert.strictEqual(typeof utils.sanitizeFileName, 'function');
    assert.strictEqual(typeof utils.sanitizeRelativePath, 'function');
    assert.strictEqual(typeof utils.normId, 'function');
    assert.strictEqual(utils.sanitizeFileName('foo/bar:*?"<>|'), 'foo_bar');

    // Progress utils
    assert.strictEqual(typeof utils.formatExportProgress, 'function');
    const formatted = utils.formatExportProgress({ pct: 50, current: 5, total: 10 });
    assert.strictEqual(formatted.pct, 50);

    // Merge utils
    assert.strictEqual(typeof utils.mergeConversation, 'function');
    assert.strictEqual(typeof utils.deduplicateConversations, 'function');
});
