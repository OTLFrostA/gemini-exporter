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
    assert.strictEqual(isConfirmedDeletedError('HTTP 404 Not Found'), true);
    assert.strictEqual(isConfirmedDeletedError('some error', 404), true);

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

test('Batch 4 - listView restricts conversation URLs to http/https and blocks javascript:/data:', () => {
    const { render } = require('../src/ui/views/listView.js');

    const mockListEl: any = { innerHTML: '', addEventListener: () => {} };
    const mockStatusEl: any = { textContent: '' };
    const elements = new Map<string, any>([
        ['list', mockListEl],
        ['status', mockStatusEl]
    ]);

    const origDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
    (global as any).document = {
        getElementById: (id: string) => elements.get(id) || null
    };

    try {
        const conversations = ([
            { id: 'c_evil1', title: 'Evil JS URL', url: 'javascript:alert(1)', timestamp: 1700000000000 },
            { id: 'c_evil2', title: 'Evil Data URL', url: 'data:text/html,<script>alert(1)</script>', timestamp: 1700000000000 },
            { id: 'c_good', title: 'Good HTTPS URL', url: 'https://gemini.google.com/app/c_good', timestamp: 1700000000000 }
        ]).map(indexFixture);

        render(
            conversations,
            {},
            new Set(['c_evil1', 'c_evil2', 'c_good']),
            '',
            'all',
            new Set()
        );

        const html = mockListEl.innerHTML;
        assert.ok(!html.includes('javascript:'), 'must never render javascript: scheme in href');
        assert.ok(!html.includes('data:text/html'), 'must never render data: scheme in href');
        assert.ok(html.includes('href="https://gemini.google.com/app/evil1"'), 'must fall back to safe https Gemini URL for c_evil1');
        assert.ok(html.includes('href="https://gemini.google.com/app/evil2"'), 'must fall back to safe https Gemini URL for c_evil2');
        assert.ok(html.includes('href="https://gemini.google.com/app/good"'), 'must preserve valid https URL');
        assert.ok(html.includes('rel="noopener noreferrer"'), 'must include rel="noopener noreferrer" on external link');
    } finally {
        if (origDocumentDescriptor) Object.defineProperty(globalThis, 'document', origDocumentDescriptor);
        else delete (global as any).document;
    }
});
