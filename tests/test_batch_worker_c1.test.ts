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
    supplementTakeoutGeneratedMedia,
} = require('../src/core/engine/export/batchWorker.js');
const detailStore = require('../src/core/storage/conversationDetailStore.js');

test('Track C1: direct vs runtime fetch fallback preserves exact transport cascade', async () => {
    // 1. Direct TabService success
    const mockDirectTabService = {
        sendToGeminiTab: async () => ({
            success: true,
            data: { id: 'chat_direct_1', title: 'Direct Tab Chat', messages: [] }
        })
    };
    let runtimeCalled = false;
    const mockRuntimeSender = async () => {
        runtimeCalled = true;
        return { success: true };
    };

    const directResult = await fetchChatDetail(
        'chat_direct_1',
        0,
        1,
        'u0',
        false,
        'md',
        null,
        { tabService: mockDirectTabService, messageSender: mockRuntimeSender }
    );
    assert.equal(directResult.success, true);
    assert.equal(directResult.results?.[0]?.title, 'Direct Tab Chat');
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
        'chat_direct_err',
        0,
        1,
        'u0',
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
        'chat_direct_malformed',
        0,
        1,
        'u0',
        false,
        'md',
        null,
        { tabService: mockDirectMalformedTabService, messageSender: mockRuntimeSender }
    );
    assert.equal(malformedResult.success, false);
    assert.equal(malformedResult.error, 'Malformed direct response envelope');
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
            success: true,
            results: [{ id: 'chat_remote_1', title: 'Remote Fallback Chat', messages: [] }]
        });
    };
    const fallbackResult = await fetchChatDetail(
        'chat_remote_1',
        0,
        1,
        'u0',
        false,
        'md',
        null,
        { tabService: mockFailingTabService, messageSender: mockFallbackSender }
    );
    assert.equal(fallbackResult.success, true);
    assert.equal(fallbackResult.results?.[0]?.title, 'Remote Fallback Chat');
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
        'chat_aborted_1',
        0,
        1,
        'u0',
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
        'chat_aborted_2',
        0,
        1,
        'u0',
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

test('Track C1: resolveConversationData respects Takeout -> stored-detail cascade and clears error/_empty', async () => {
    const id = 'c_cascade_test_1';

    // 1. Usable online conversation is returned untouched
    const usableOnline = {
        id,
        title: 'Usable Online Chat',
        messages: [{ role: 'user', content: 'hello' }, { role: 'model', content: 'world' }]
    };
    let takeoutCalls = 0;
    const dummyTakeout = {
        getTakeoutOfflineChat: () => {
            takeoutCalls++;
            return { messages: [{ role: 'model', content: 'takeout' }] };
        }
    };
    const resolvedDirect = await resolveConversationData(usableOnline, id, null, dummyTakeout, 'u0');
    assert.equal(resolvedDirect, usableOnline);
    assert.equal(takeoutCalls, 0, 'Takeout must not be called when online chat is already usable');

    // 2. Chat with error/_empty recovers from Takeout and deletes flags
    const brokenChat = {
        id,
        title: 'Broken Chat',
        error: 'Failed to fetch',
        _empty: true,
        messages: []
    };
    const recoveringTakeout = {
        getTakeoutOfflineChat: () => ({
            title: 'Recovered from Takeout',
            messages: [{ role: 'user', content: 'offline user' }, { role: 'model', content: 'offline model' }]
        })
    };
    const recoveredTakeout = await resolveConversationData(brokenChat, id, null, recoveringTakeout, 'u0');
    assert.equal(recoveredTakeout.error, undefined, 'error flag must be removed');
    assert.equal(recoveredTakeout._empty, undefined, '_empty flag must be removed');
    assert.equal(recoveredTakeout.title, 'Broken Chat', 'Real existing title is preserved');
    assert.equal(recoveredTakeout.messages?.length, 2);

    // 3. Fallback to conversationDetailStore when Takeout is unavailable
    await detailStore.saveConversationDetail(id, {
        id,
        messages: [{ role: 'user', content: 'cached user' }, { role: 'model', content: 'cached model' }],
        turns: []
    });
    try {
        const brokenChat2 = {
            id,
            error: 'Network unreachable',
            _empty: true,
            messages: []
        };
        const emptyTakeout = {
            getTakeoutOfflineChat: () => null
        };
        const recoveredStored = await resolveConversationData(brokenChat2, id, { title: 'List Title' }, emptyTakeout, 'u0');
        assert.equal(recoveredStored.error, undefined);
        assert.equal(recoveredStored._empty, undefined);
        assert.equal(recoveredStored.messages?.[0]?.content, 'cached user');
        assert.equal(recoveredStored.title, 'List Title');
    } finally {
        detailStore.__clearMemoryStore();
    }
});

test('Track C1: supplementTakeoutGeneratedMedia dedupe, correlation, and appendMarkdownRef behavior', () => {
    const chatId = 'c_gen_media_test';
    const genIdentity = {
        chatId,
        providerRequestId: 'req_gen_99',
        generationOrdinal: 0,
        imageOrdinal: 0
    };

    // 1. Default appendMarkdownRef: true appends reference and attaches image
    const chatWithTarget: GeneratedMediaTestChat = {
        id: chatId,
        messages: [
            { role: 'user', content: 'draw a nebula', providerRequestId: 'req_gen_99' },
            { role: 'model', content: 'Here is your nebula:', providerRequestId: 'req_gen_99' }
        ]
    };
    const takeoutWithMedia = {
        getTakeoutMediaForChat: () => [
            {
                filename: 'nebula_art.png',
                isGenerated: true,
                generation: genIdentity
            }
        ]
    };

    supplementTakeoutGeneratedMedia(chatWithTarget, chatId, 'u0', takeoutWithMedia);
    const modelMsg = chatWithTarget.messages[1];
    assert.ok(modelMsg);
    assert.equal(modelMsg.images?.length, 1);
    assert.equal(modelMsg.images?.[0]?.fileName, 'nebula_art.png');
    assert.equal(modelMsg.images?.[0]?.source, 'takeout');
    assert.equal(modelMsg.images?.[0]?.isGenerated, true);
    assert.match(String(modelMsg.content), /!\[Generated Image\]\(assets\/nebula_art\.png\)/);

    // 2. Dedupe: second run on same chat must NOT re-append or duplicate attachments
    supplementTakeoutGeneratedMedia(chatWithTarget, chatId, 'u0', takeoutWithMedia);
    assert.equal(modelMsg.images?.length, 1, 'Duplicate media must not be added to images');
    assert.equal(modelMsg.attachments?.length, 1, 'Duplicate media must not be added to attachments');

    // 3. appendMarkdownRef: false attaches image but does NOT mutate markdown text
    const chatNoRef: GeneratedMediaTestChat = {
        id: 'c_gen_media_no_ref',
        messages: [
            { role: 'user', content: 'generate a cat', providerRequestId: 'req_cat_1' },
            { role: 'model', content: 'Here is a cat photo.', providerRequestId: 'req_cat_1' }
        ]
    };
    const takeoutCat = {
        getTakeoutMediaForChat: () => [
            {
                filename: 'cat_photo.png',
                isGenerated: true,
                providerRequestId: 'req_cat_1',
                imageOrdinal: 0
            }
        ]
    };

    supplementTakeoutGeneratedMedia(chatNoRef, 'c_gen_media_no_ref', 'u0', takeoutCat, {
        appendMarkdownRef: false
    });
    const catModelMsg = chatNoRef.messages[1];
    assert.ok(catModelMsg);
    assert.equal(catModelMsg.images?.length, 1);
    assert.equal(catModelMsg.images?.[0]?.fileName, 'cat_photo.png');
    assert.equal(catModelMsg.content, 'Here is a cat photo.', 'Markdown text must not have image tag appended when appendMarkdownRef is false');
});

test('Track C1: resolveChat Deep Research report extraction', async () => {
    const longHtmlContent = `
        <h1>Comprehensive Quantum Computing Analysis Report</h1>
        <p>${'Detailed scientific exploration of superconducting qubits. '.repeat(100)}</p>
    `;

    const chatWithReport = {
        id: 'c_deep_research_1',
        title: 'Quantum Computing',
        messages: [
            { role: 'user', content: 'Perform deep research on quantum computing' },
            { role: 'model', content: longHtmlContent }
        ]
    };

    const resolved = await resolveChat(chatWithReport, 'c_deep_research_1');
    assert.equal(resolved.isError, false);
    const modelMsg = resolved.chat.messages?.[1];
    assert.ok(modelMsg);
    assert.equal(modelMsg.documents?.length, 1, 'Extracted report must be added to documents');
    assert.equal(modelMsg.attachments?.length, 1, 'Extracted report must be added to attachments');
    const doc = modelMsg.documents?.[0];
    assert.equal(doc?.type, 'file');
    assert.equal(doc?.source, 'extracted-report');
    assert.equal(doc?.title, 'Comprehensive Quantum Computing Analysis Report');
    assert.match(String(doc?.contentMarkdown), /# Comprehensive Quantum Computing Analysis Report/);
});

test('Track C1: resolveChat confirmed-deleted detection and title resolution writeback', async () => {
    // 1. Confirmed-deleted chat detection
    const deletedChat = {
        id: 'c_deleted_1',
        title: 'Deleted Chat',
        error: 'Conversation not found',
        isDeleted: true,
        messages: []
    };
    const deletedRes = await resolveChat(deletedChat, 'c_deleted_1');
    assert.equal(deletedRes.isConfirmedDeleted, true, 'Confirmed deleted chat must be flagged');

    // 2. Title sniffing and arbitration writeback
    const untitledChat = {
        id: 'c_sniff_1',
        title: '未命名对话',
        messages: [
            { role: 'user', content: '请问一下，Python中的协程与线程有什么区别？' },
            { role: 'model', content: 'Python中的协程是用户态轻量级线程...' }
        ]
    };
    let titleUpdatedNid = '';
    let titleUpdatedTitle = '';
    let titleUpdatedSource = '';

    const listChat = {
        id: 'c_sniff_1',
        title: '未命名对话',
        titleSource: 'default',
        titles: {}
    };

    const sniffRes = await resolveChat(
        untitledChat,
        'c_sniff_1',
        listChat,
        null,
        'u0',
        (id: string, title: string, source: string) => {
            titleUpdatedNid = id;
            titleUpdatedTitle = title;
            titleUpdatedSource = source;
        }
    );

    assert.equal(sniffRes.isError, false);
    assert.match(sniffRes.chat.title || '', /Python中的协程与线程有什么区别/);
    assert.equal(titleUpdatedNid, 'sniff_1');
    assert.match(titleUpdatedTitle, /Python中的协程与线程有什么区别/);
    assert.equal(titleUpdatedSource, 'sniff');
});
