import { indexFixture } from './helpers/indexFixture.js';
export {};
const test = require('node:test');
const assert = require('node:assert');

// Runtime behavior checks; duplicate pagination coverage lives in pagination_contract.test.ts.

test('Batch 4 - Canonical classifyDetailError and isConfirmedDeletedError in GeminiProtocol', () => {
    const {
        isConfirmedDeletedError,
        classifyDetailError
    } = require('../src/core/protocol/protocol.js');

    // Confirmed deleted cases
    assert.strictEqual(isConfirmedDeletedError('["BardErrorInfo", 1167]'), true);
    assert.strictEqual(classifyDetailError('["BardErrorInfo", 1167]'), 'confirmed_deleted');
    assert.strictEqual(isConfirmedDeletedError('会话已在服务端删除 (c_123) [BardErrorInfo: 1167]'), true);
    assert.strictEqual(isConfirmedDeletedError('HTTP 404 Not Found'), false);
    assert.strictEqual(isConfirmedDeletedError('some error', 404), false);

    // Must NOT match 11167 or unrelated BardErrorInfo
    assert.strictEqual(isConfirmedDeletedError('["BardErrorInfo", 11167]'), false);
    assert.strictEqual(classifyDetailError('["BardErrorInfo", 11167]'), 'inaccessible');

    assert.strictEqual(isConfirmedDeletedError('["BardErrorInfo", 500]'), false);
    assert.strictEqual(classifyDetailError('["BardErrorInfo", 500]'), 'inaccessible');

    // Rate limited 1096
    assert.strictEqual(isConfirmedDeletedError('["BardErrorInfo", 1096]'), false);
    assert.strictEqual(classifyDetailError('["BardErrorInfo", 1096]'), 'rate_limited');
    assert.strictEqual(classifyDetailError('Quota exceeded', 429), 'rate_limited');

    // Parse error vs unknown
    assert.strictEqual(classifyDetailError('Unexpected token < in JSON'), 'parse_error');
    assert.strictEqual(classifyDetailError(''), 'unknown');
});
