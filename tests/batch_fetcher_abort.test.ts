// tests/batch_fetcher_abort.test.ts
// B2: sendToGeminiTabCancellable 的 AbortSignal race —— mock slot abort，断言在途请求即时被取消，
// 不再依赖 50ms 轮询；settled 后 controller 被清理，且重建的 signal 与 boolean 旗标保持同步。
import { historicalFixture } from './helpers/nativeFixture.js';
const test = require('node:test');
const assert = require('node:assert');

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error(message)), ms);
            })
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

test('batchFetcher - slot abort wins the race while sendToGeminiTab is in-flight', async () => {
    const origChrome = (global as any).chrome;
    (global as any).chrome = {
        runtime: {
            sendMessage: (_msg: any) => Promise.resolve()
        },
        storage: {
            session: {
                get: async (_keys: any) => ({}),
                set: async (_obj: any) => {},
                remove: async (_keys: any) => {}
            }
        }
    };

    const { TabService } = require('../src/runtime/capabilities/tabService.js');
    const {
        setSlotAborted,
        clearAllAborts,
        getSlotAbortSignal,
        __bgControllers
    } = require('../src/runtime/background/abortManager.js');
    const { fetchBatch } = require('../src/runtime/background/batchFetcher.js');

    clearAllAborts();
    const origGet = TabService.getGeminiTab;
    const origSend = TabService.sendToGeminiTab;
    // tab 存在；send 永不 resolve（模拟在途请求）
    TabService.getGeminiTab = async () => ({ id: 123 });
    let sendCalls = 0;
    let signalStarted!: () => void;
    const sendStarted = new Promise<void>(resolve => { signalStarted = resolve; });
    TabService.sendToGeminiTab = (..._args: any[]) => {
        sendCalls++;
        signalStarted();
        return new Promise(() => {});
    };

    try {
        const slot = '10000000-0000-4000-8000-000000000001';
        let response: any = null;
        const done = fetchBatch(
            [{ id: 'chat1', title: 't1' }],
            'markdown',
            false,
            (r: any) => { response = r; },
            0,
            1,
            slot
        );
        // Wait for the actual tab request instead of guessing with a 60ms sleep.
        await withTimeout(sendStarted, 3000, 'tab request never became in-flight');
        await setSlotAborted(slot, true);
        // The abort must settle the in-flight request, without leaving a test timer alive.
        await withTimeout(done, 3000, 'race did not settle promptly after abort');

        assert.ok(response, 'portSendResponse must be called');
        assert.strictEqual(response.aborted, true, 'response must carry aborted:true');
        assert.strictEqual(response.success, false, 'aborted batch must not report success');
        assert.strictEqual(sendCalls, 1, 'exactly one in-flight send was raced');
        assert.strictEqual(
            __bgControllers.has(slot), false,
            'controller must be cleaned up after the race settles'
        );
        // 旗标同步：清理后重建的 signal 仍为 aborted（boolean 旗标未清）
        assert.strictEqual(
            getSlotAbortSignal(slot).aborted, true,
            'recreated signal must follow the still-set boolean flag'
        );
    } finally {
        TabService.getGeminiTab = origGet;
        TabService.sendToGeminiTab = origSend;
        clearAllAborts();
        (global as any).chrome = origChrome;
    }
});

test('batchFetcher - no abort: sendToGeminiTab result passes through, timer released', async () => {
    const origChrome = (global as any).chrome;
    (global as any).chrome = {
        runtime: {
            sendMessage: (_msg: any) => Promise.resolve()
        },
        storage: {
            session: {
                get: async (_keys: any) => ({}),
                set: async (_obj: any) => {},
                remove: async (_keys: any) => {}
            }
        }
    };

    const { TabService } = require('../src/runtime/capabilities/tabService.js');
    const { clearAllAborts, __bgControllers } = require('../src/runtime/background/abortManager.js');
    const { fetchBatch } = require('../src/runtime/background/batchFetcher.js');

    clearAllAborts();
    const origGet = TabService.getGeminiTab;
    const origSend = TabService.sendToGeminiTab;
    TabService.getGeminiTab = async () => ({ id: 123 });
    TabService.sendToGeminiTab = async (msg: any, _slot?: string) => ({
        success: true, domainEnvelopeVersion: 3,
        data: historicalFixture({ id: msg.conversationId, title: 'ok-chat', messages: [] })
    });

    try {
        const slot = '10000000-0000-4000-8000-000000000001';
        let response: any = null;
        await fetchBatch(
            [{ id: 'chat1', title: 't1' }],
            'markdown',
            false,
            (r: any) => { response = r; },
            0,
            1,
            slot
        );
        assert.ok(response, 'portSendResponse must be called');
        assert.strictEqual(response.success, true, 'non-aborted batch reports success');
        assert.strictEqual(response.aborted, false);
        assert.strictEqual(response.results.length, 1);
        assert.strictEqual(response.results[0].conversation.index.key.conversationId, 'chat1');
        assert.strictEqual(
            __bgControllers.has(slot), false,
            'controller must be cleaned up after settle even without abort'
        );
    } finally {
        TabService.getGeminiTab = origGet;
        TabService.sendToGeminiTab = origSend;
        clearAllAborts();
        (global as any).chrome = origChrome;
    }
});
