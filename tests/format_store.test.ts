import test from 'node:test';
import assert from 'node:assert';

import * as Constants from '../src/core/utils/constants.js';
import * as FormatStore from '../src/core/storage/formatStore.js';


test('formatStore - ALLOWED_FORMATS and DEFAULT_FORMAT', () => {
    assert.deepStrictEqual(FormatStore.ALLOWED_FORMATS, ['markdown', 'html', 'json', 'pdf']);
    assert.strictEqual(FormatStore.DEFAULT_FORMAT, 'markdown');
});

test('formatStore - isAllowed', () => {
    assert.strictEqual(FormatStore.isAllowed('markdown'), true);
    assert.strictEqual(FormatStore.isAllowed('html'), true);
    assert.strictEqual(FormatStore.isAllowed('pdf'), true);
    assert.strictEqual(FormatStore.isAllowed('json_openai'), false);
    assert.strictEqual(FormatStore.isAllowed('json'), true);
    assert.strictEqual(FormatStore.isAllowed('json_raw'), false);
    assert.strictEqual(FormatStore.isAllowed('xml'), false);
    assert.strictEqual(FormatStore.isAllowed(''), false);
    assert.strictEqual(FormatStore.isAllowed(null as any), false);
});


test('formatStore - normalizeFormat rejects removed formats', () => {
    // Normal mode: json_raw should fall back to markdown
    assert.strictEqual(FormatStore.normalizeFormat('markdown'), 'markdown');
    assert.strictEqual(FormatStore.normalizeFormat('html'), 'html');
    assert.strictEqual(FormatStore.normalizeFormat('json_openai'), 'markdown');
    assert.strictEqual(FormatStore.normalizeFormat('json'), 'json');
    assert.strictEqual(FormatStore.normalizeFormat('json_raw'), 'markdown');
    assert.strictEqual(FormatStore.normalizeFormat('invalid'), 'markdown');
});

test('formatStore - validateAgainstSelect', () => {
    const mockSelect = {
        options: [
            { value: 'markdown' },
            { value: 'html' },
            { value: 'json' }
        ]
    };
    assert.strictEqual(FormatStore.validateAgainstSelect('markdown', mockSelect), true);
    assert.strictEqual(FormatStore.validateAgainstSelect('json_raw', mockSelect), false);
    assert.strictEqual(FormatStore.validateAgainstSelect('markdown', null), true);
});

test('constants - FEEDBACK_URL is configured', () => {
    assert.strictEqual(Constants.FEEDBACK_URL, 'https://tally.so/r/Y56ZBB');
});

for (const stored of ['json_openai', 'json_raw']) for (const isDev of [false, true]) {
    test(`formatStore repairs saved ${stored} in developer mode ${isDev}`, async () => {
        const originalChrome = globalThis.chrome;
        const data: Record<string, unknown> = {
            [Constants.STORAGE_KEYS.FORMAT]: stored,
            [Constants.STORAGE_KEYS.DEV_MODE]: isDev,
        };
        globalThis.chrome = { storage: { local: {
            get: async () => ({ ...data }),
            set: async (patch: Record<string, unknown>) => { Object.assign(data, patch); },
        } } } as unknown as typeof chrome;
        const select = { value: '', options: FormatStore.ALLOWED_FORMATS.map(value => ({ value })) };
        try {
            const loaded = await FormatStore.loadFormat(select);
            assert.strictEqual(loaded.format, 'markdown');
            assert.strictEqual(loaded.stored, stored);
            assert.strictEqual(loaded.isDev, isDev);
            assert.strictEqual(select.value, 'markdown');
            assert.strictEqual(data[Constants.STORAGE_KEYS.FORMAT], 'markdown');
            assert.strictEqual(await FormatStore.saveFormat(stored), 'markdown');
        } finally {
            globalThis.chrome = originalChrome;
        }
    });
}
