export {};
const test = require('node:test');
const assert = require('node:assert');
const LiveStorageManager = require('../src/core/storage/liveStorageManager.js');
test('non-Markdown formats suppress live save config and both write routes', async () => {
    const { STORAGE_KEYS } = require('../src/core/utils/constants.js');
    const { handleLiveSaveViaHandle } = require('../src/background/liveSaveHandler.js');
    const { writeLiveSaveMarkdown } = require('../src/core/engine/liveSaveWriter.js');
    const { saveFormat } = require('../src/core/storage/formatStore.js');
    const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    const data: Record<string, any> = {};
    (global as any).chrome = { storage: { local: {
        get: async () => ({ ...data }),
        set: async (patch: any) => { Object.assign(data, patch); }
    } } };
    try {
        for (const format of ['pdf', 'html', 'json']) {
            data[STORAGE_KEYS.FORMAT] = format;
            data[STORAGE_KEYS.LIVE_SAVE_CONFIG] = { enabledDisk: true };
            assert.strictEqual((await LiveStorageManager.getLiveConfig()).enabledDisk, false);
            assert.strictEqual((await LiveStorageManager.setLiveConfig({ enabledDisk: true })).enabledDisk, false);
            const result = await handleLiveSaveViaHandle({});
            assert.strictEqual(result.error, 'live_save_requires_markdown');
            let written = false;
            await assert.rejects(writeLiveSaveMarkdown({ writeFile: async () => { written = true; } },
                { chat: {}, safeTitle: 'Test', nid: 'abcdef' },
                { formatter: { formatMarkdownDocument: async () => ({ content: '# Test' }) } }), /only supports Markdown/);
            assert.strictEqual(written, false);
        }
        data[STORAGE_KEYS.FORMAT] = 'markdown';
        await LiveStorageManager.setLiveConfig({ enabledDisk: true });
        await saveFormat('pdf');
        assert.strictEqual(data[STORAGE_KEYS.LIVE_SAVE_CONFIG].enabledDisk, false);
        await saveFormat('markdown');
        assert.strictEqual((await LiveStorageManager.getLiveConfig()).enabledDisk, false);
        await LiveStorageManager.setLiveConfig({ enabledDisk: true });
        assert.strictEqual((await LiveStorageManager.getLiveConfig()).enabledDisk, true);
        await Promise.all([saveFormat('html'), saveFormat('markdown')]);
        assert.strictEqual(data[STORAGE_KEYS.FORMAT], 'markdown');
    } finally {
        if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
        else delete (global as any).chrome;
    }
});
