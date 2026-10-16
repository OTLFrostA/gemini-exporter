import { useIndexStorage } from './helpers/indexStorage.js';
import { StorageService as catalogStorage } from '../src/core/storage/storageService.js';
useIndexStorage();
import { indexFixture } from './helpers/indexFixture.js';
const { historicalFixture } = require('./helpers/nativeFixture.js');
const { saveDomainConversation, __clearDomainMemory } = require('../src/core/storage/domain/domainStore.js');
export {};
interface GeneratedMediaTestChat {
    id: string;
    messages: {
        role: string;
        content: string;
        providerRequestId: string;
        images?: { fileName?: string; source?: string; isGenerated?: boolean }[];
        attachments?: { fileName?: string; source?: string; isGenerated?: boolean }[];
    }[];
}

const test = require('node:test');
const assert = require('node:assert/strict');

const GeminiUtils = require('../src/core/utils/utils.js');
const { __setModuleOverride } = require('../src/core/utils/moduleOverrides.js');
__setModuleOverride('GeminiUtils', GeminiUtils);

const {
    fetchChatDetail,
    resolveChat,
    resolveConversationData,
} = require('../src/core/engine/export/batchWorker.js');
const detailStore = require('../src/core/storage/conversationDetailStore.js');

test('Track C1: direct vs runtime fetch fallback preserves exact transport cascade', async () => {
    // 1. Direct TabService success
    const mockDirectTabService = {
        sendToGeminiTab: async () => ({
            success: true, domainEnvelopeVersion: 2,
            data: historicalFixture({ id: 'chat_direct_1', title: 'Direct Tab Chat', messages: [] })
        })
    };
    let runtimeCalled = false;
    const mockRuntimeSender = async () => {
        runtimeCalled = true;
        return { success: true };
    };

    const directResult = await fetchChatDetail(
        { id: 'chat_direct_1' },
        0,
        1,
        '10000000-0000-4000-8000-000000000001',
        false,
        'md',
        null,
        { tabService: mockDirectTabService, messageSender: mockRuntimeSender }
    );
    assert.equal(directResult.success, true);
    assert.equal(directResult.results?.[0]?.conversation?.index.title, 'Direct Tab Chat');
    assert.equal(runtimeCalled, false, 'Runtime sender must not be called when direct transport succeeds');

    // 2. Explicit direct error: must return error directly and NOT fall back to runtime sender
    const mockDirectErrorTabService = {
        sendToGeminiTab: async () => ({
            success: false,
            error: 'Explicit direct rpc failure'
        })
    };
    runtimeCalled = false;
    const directErrResult = await fetchChatDetail(
        { id: 'chat_direct_err' },
        0,
        1,
        '10000000-0000-4000-8000-000000000001',
        false,
        'md',
        null,
        { tabService: mockDirectErrorTabService, messageSender: mockRuntimeSender }
    );
    assert.equal(directErrResult.success, false);
    assert.match(String(directErrResult.error), /Explicit direct rpc failure/);
    assert.equal(runtimeCalled, false, 'Explicit direct error must not cascade to runtime sender');

    // 3. Malformed direct envelope: must return Malformed direct response envelope
    const mockDirectMalformedTabService = {
        sendToGeminiTab: async () => 'unexpected string response'
    };
    runtimeCalled = false;
    const malformedResult = await fetchChatDetail(
        { id: 'chat_direct_malformed' },
        0,
        1,
        '10000000-0000-4000-8000-000000000001',
        false,
        'md',
        null,
        { tabService: mockDirectMalformedTabService, messageSender: mockRuntimeSender }
    );
    assert.equal(malformedResult.success, false);
    assert.match(malformedResult.error, /unreadable/i);
    assert.equal(runtimeCalled, false, 'Malformed direct response envelope must settle without falling back');

    // 4. TabService throws or absent -> cascades to messageSender (runtime/chrome fallback)
    const mockFailingTabService = {
        sendToGeminiTab: async () => {
            throw new Error('Tab communication dropped');
        }
    };
    let remotePayload: unknown = null;
    const mockFallbackSender = (msg: unknown, callback?: (res: unknown) => void) => {
        remotePayload = msg;
        callback?.({
            success: true, domainEnvelopeVersion: 2,
            results: [historicalFixture({ id: 'chat_remote_1', title: 'Remote Fallback Chat', messages: [] })]
        });
    };
    const fallbackResult = await fetchChatDetail(
        { id: 'chat_remote_1' },
        0,
        1,
        '10000000-0000-4000-8000-000000000001',
        false,
        'md',
        null,
        { tabService: mockFailingTabService, messageSender: mockFallbackSender }
    );
    assert.equal(fallbackResult.success, true);
    assert.equal(fallbackResult.results?.[0]?.conversation?.index.title, 'Remote Fallback Chat');
    assert.ok(remotePayload, 'Fallback sender must be invoked');
});

test('Track C1: abort signal cleanup and single-settle', async () => {
    // 1. Pre-aborted signal settles immediately with abort error
    const controller = new AbortController();
    controller.abort();

    let tabCalled = false;
    const mockTabService = {
        sendToGeminiTab: async () => {
            tabCalled = true;
            return { success: true };
        }
    };

    const abortedResult = await fetchChatDetail(
        { id: 'chat_aborted_1' },
        0,
        1,
        '10000000-0000-4000-8000-000000000001',
        false,
        'md',
        controller.signal,
        { tabService: mockTabService }
    );
    assert.equal(abortedResult.success, false);
    assert.match(String(abortedResult.error), /abort/i);
    assert.equal(tabCalled, false, 'Aborted signal must prevent transport execution');

    // 2. Mid-flight abort settles cleanly
    const liveController = new AbortController();
    const hangTabService = {
        sendToGeminiTab: () => new Promise(() => {})
    };
    const pendingPromise = fetchChatDetail(
        { id: 'chat_aborted_2' },
        0,
        1,
        '10000000-0000-4000-8000-000000000001',
        false,
        'md',
        liveController.signal,
        { tabService: hangTabService }
    );
    liveController.abort();
    const midFlightResult = await pendingPromise;
    assert.equal(midFlightResult.success, false);
    assert.match(String(midFlightResult.error), /abort/i);
});

test('C1 review: malformed raw replies are reportable failures rather than native results', async () => {
    const payload = { messages: [{ role: 'model', content: 'raw' }], extension: 17 };
    const direct = await fetchChatDetail({ id: 'c_raw' }, 0, 1, '10000000-0000-4000-8000-000000000001', false, 'md', null, {
        tabService: { sendToGeminiTab: async () => ({ success: true, domainEnvelopeVersion: 2, data: payload }) }
    });
    assert.equal(direct.success, false);
    assert.equal(direct.results, undefined);
    const runtime = await fetchChatDetail({ id: 'c_raw' }, 0, 1, '10000000-0000-4000-8000-000000000001', false, 'md', null, {
        tabService: { sendToGeminiTab: async () => null },
        messageSender: (_msg: unknown, callback: (value: unknown) => void) => callback({ results: [payload], error: 0 })
    });
    assert.equal(runtime.success, false);
    assert.equal(runtime.results, undefined);
    const error = await fetchChatDetail({ id: 'c_raw' }, 0, 1, '10000000-0000-4000-8000-000000000001', false, 'md', null, {
        tabService: { sendToGeminiTab: async () => ({ error: { code: 403 } }) }
    });
    assert.equal(error.success, false);
    assert.equal(typeof error.error, 'string');
});

test('runtime detail recovery prefers native online, then native Takeout, then durable Domain', async () => {
    const id = 'cascade_test'; const slot = '10000000-0000-4000-8000-000000000003';
    const make = (text: string) => historicalFixture({ id, title: text, messages: [{ role: 'model', content: text }] });
    const online = make('online'), offline = make('offline'), stored = make('stored'); let calls = 0;
    const takeout = { getTakeoutOfflineChat() { calls++; return offline; } };
    assert.equal((await resolveConversationData(online, id, null, takeout, slot)).result, online); assert.equal(calls, 0);
    assert.equal((await resolveConversationData({ error: 'offline' }, id, null, takeout, slot)).result, offline);
    await catalogStorage.setNativeConversations(slot, [stored]);
    try {
        const recovered = await resolveConversationData({ error: 'offline' }, id, null, null, slot);
        assert.deepEqual(recovered.result.conversation.detail.messages, stored.conversation.detail.messages);
        assert.equal(recovered.result.conversation.index.title, stored.conversation.index.title);
        const rejected = await resolveChat({ id, messages: [{ role: 'model', content: 'legacy runtime' }] }, { id: 'unmigrated' }, null, null, slot);
        assert.equal(rejected.isError, true); assert.equal(rejected.chat, undefined);
    } finally { __clearDomainMemory(); }
});

test('native resolver retains unknown source blocks and arbitrates titles without reparsing', async () => {
    const native = historicalFixture({ id: 'native-title', title: 'RPC title', titleSource: 'rpc', titles: { rpc: 'RPC title' }, messages: [{ role: 'tool', content: { untouched: true } }] });
    const list = indexFixture({ id: 'native-title', title: 'Takeout title', titleSource: 'takeout' });
    const resolved = await resolveChat(native, { id: 'native-title' }, list, null, '10000000-0000-4000-8000-000000000001');
    assert.equal(resolved.isError, false); assert.equal(resolved.chat.conversation.index.title, 'RPC title');
    assert.deepEqual(resolved.chat.conversation.detail.messages, native.conversation.detail.messages);
    assert.equal(resolved.chat.conversation.detail.messages[0].role, 'unknown');
    const deleted = await resolveChat({ id: 'deleted-native', error: 'Conversation not found', isDeleted: true }, { id: 'deleted-native' }, null, null, '10000000-0000-4000-8000-000000000001');
    assert.equal(deleted.isConfirmedDeleted, true); assert.equal(deleted.chat, undefined);
});
