const test = (typeof require !== 'undefined' && require('node:test')) ? require('node:test') : (name, fn) => { try { fn(); } catch (e) { throw new Error(`FAIL: ${name} - ${e.message}`); } };
const assert = (typeof require !== 'undefined' && require('node:assert')) ? require('node:assert') : {
    strictEqual: (a, b) => { if (a !== b) throw new Error(`${a} !== ${b}`); },
    deepStrictEqual: (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`); },
    ok: (a) => { if (!a) throw new Error(`Expected truthy, got ${a}`); }
};

const Constants = (typeof require !== 'undefined') ? require('../src/core/utils/constants.js') : (typeof globalThis.GeminiConstants !== 'undefined' ? globalThis.GeminiConstants : null);
const FormatStore = (typeof require !== 'undefined') ? require('../src/core/storage/formatStore.js') : (typeof globalThis.FormatStore !== 'undefined' ? globalThis.FormatStore : null);

test('formatStore - ALLOWED_FORMATS and DEFAULT_FORMAT', () => {
    assert.deepStrictEqual(FormatStore.ALLOWED_FORMATS, ['markdown', 'json_openai', 'json', 'json_raw']);
    assert.strictEqual(FormatStore.DEFAULT_FORMAT, 'markdown');
});

test('formatStore - isAllowed', () => {
    assert.strictEqual(FormatStore.isAllowed('markdown'), true);
    assert.strictEqual(FormatStore.isAllowed('json_openai'), true);
    assert.strictEqual(FormatStore.isAllowed('json'), true);
    assert.strictEqual(FormatStore.isAllowed('json_raw'), true);
    assert.strictEqual(FormatStore.isAllowed('xml'), false);
    assert.strictEqual(FormatStore.isAllowed(''), false);
    assert.strictEqual(FormatStore.isAllowed(null), false);
});

test('formatStore - normalizeFormat with dev mode awareness', () => {
    // Normal mode: json_raw should fall back to markdown
    assert.strictEqual(FormatStore.normalizeFormat('markdown', false), 'markdown');
    assert.strictEqual(FormatStore.normalizeFormat('json_openai', false), 'json_openai');
    assert.strictEqual(FormatStore.normalizeFormat('json', false), 'json');
    assert.strictEqual(FormatStore.normalizeFormat('json_raw', false), 'markdown');
    assert.strictEqual(FormatStore.normalizeFormat('invalid', false), 'markdown');

    // Dev mode: json_raw is allowed
    assert.strictEqual(FormatStore.normalizeFormat('json_raw', true), 'json_raw');
    assert.strictEqual(FormatStore.normalizeFormat('markdown', true), 'markdown');
    assert.strictEqual(FormatStore.normalizeFormat('invalid', true), 'markdown');
});

test('formatStore - validateAgainstSelect', () => {
    const mockSelect = {
        options: [
            { value: 'markdown' },
            { value: 'json_openai' },
            { value: 'json' }
        ]
    };
    assert.strictEqual(FormatStore.validateAgainstSelect('markdown', mockSelect), true);
    assert.strictEqual(FormatStore.validateAgainstSelect('json_raw', mockSelect), false);
    assert.strictEqual(FormatStore.validateAgainstSelect('markdown', null), true);
});
