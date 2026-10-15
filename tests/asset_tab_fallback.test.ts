import test from 'node:test';
import assert from 'node:assert/strict';
import AssetPipeline from '../src/core/engine/assetPipeline.js';
import TabService from '../src/core/utils/tabService.js';

test('asset download retries another Gemini tab when the selected tab has no content-script receiver', async () => {
    const originalChrome = (globalThis as any).chrome;
    const sent: Array<{ tabId: number; preferBuffer: boolean }> = [];
    const writes: Array<{ name: string; content: unknown; base64: boolean }> = [];
    const runtime: any = { lastError: null };
    (globalThis as any).chrome = {
        runtime,
        tabs: {
            query: async () => [
                { id: 11, url: 'https://gemini.google.com/app/old', active: false },
                { id: 22, url: 'https://gemini.google.com/app/current', active: false }
            ],
            sendMessage(tabId: number, message: any, callback: (response?: any) => void) {
                sent.push({ tabId, preferBuffer: message.preferBuffer === true });
                if (tabId === 11) {
                    runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' };
                    callback(undefined);
                } else {
                    callback(message.preferBuffer
                        ? { success: true, dataBuffer: {} } // Chrome message serialization drops ArrayBuffer bytes
                        : { success: true, dataBase64: 'AQID' });
                }
                runtime.lastError = null;
            }
        }
    };

    try {
        const pipeline = new AssetPipeline({
            currentSlot: 'u0',
            getGeminiTab: TabService.getGeminiTab,
            sendToGeminiTab: TabService.sendToGeminiTab,
            writer: { writeFile: async (name: string, content: unknown, options?: { base64?: boolean }) => {
                writes.push({ name, content, base64: options?.base64 === true });
                return name;
            } } as any
        });
        const result = await pipeline.processAsset(
            { url: 'https://lh3.googleusercontent.com/image', localName: 'assets/image.jpg' },
            { id: 'chat_1' },
            { isImage: true, maxRetries: 0 }
        );
        const firstHealthyTab = sent.findIndex(request => request.tabId === 22);
        assert.ok(firstHealthyTab > 0, 'the missing receiver must be tried before the working tab');
        assert.ok(sent.slice(0, firstHealthyTab).some(request => request.tabId === 11));
        assert.ok(sent.some(request => request.tabId === 22 && request.preferBuffer),
            'the healthy tab must first receive a binary-buffer request');
        assert.ok(sent.some(request => request.tabId === 22 && !request.preferBuffer),
            'a dropped ArrayBuffer must trigger a base64 retry on a working tab');
        assert.equal(result.saved, true);
        assert.deepEqual(writes, [{ name: 'assets/image.jpg', content: 'AQID', base64: true }],
            'the decoded fallback must be written once using the base64 writer contract');
    } finally {
        (globalThis as any).chrome = originalChrome;
    }
});
