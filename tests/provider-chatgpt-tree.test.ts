import test from 'node:test';
import assert from 'node:assert/strict';
import {
    collectChatGPTImagePointers,
    extractChatGPTLinearNodes,
    mergeChatGPTContinuations,
    processChatGPTMapping,
    shouldSkipChatGPTMessage,
} from '../src/core/provider/chatgpt/conversationTree.js';
import {
    arrayBufferToBase64,
    fileIdFromPointer,
    parseFileDownloadPayload,
} from '../src/core/provider/chatgpt/imageAssets.js';
import {
    applyChatGPTHead,
    citationsOfChatGPTNode,
    collectChatGPTThinking,
    refreshChatGPTList,
    thinkingToReasoningBlocks,
    uploadedFilesOfChatGPTNode,
} from '../src/core/provider/chatgpt/conversationDetail.js';
import { ChatGPTProvider } from '../src/core/provider/chatgpt/chatgptProvider.js';
import type {
    ChatGPTApiConversationWithId,
    ChatGPTConversationNode,
} from '../src/core/provider/chatgpt/chatgptTypes.js';

function textNode(
    id: string,
    parent: string | undefined,
    role: 'user' | 'assistant' | 'system' | 'tool',
    text: string,
    extra?: Partial<ChatGPTConversationNode>,
): ChatGPTConversationNode {
    return {
        id,
        parent,
        children: [],
        message: {
            author: { role, metadata: {} },
            content: { content_type: 'text', parts: [text] },
            id: `msg-${id}`,
            recipient: 'all',
            status: 'finished_successfully',
            weight: 1,
        },
        ...extra,
    };
}

test('system and empty assistant turns are skipped, user turns kept in order', () => {
    const mapping: Record<string, ChatGPTConversationNode> = {
        root: { id: 'root', children: ['a'] },
        a: textNode('a', 'root', 'system', 'sys'),
        b: textNode('b', 'a', 'user', 'hello'),
        c: textNode('c', 'b', 'assistant', '  '),
        d: textNode('d', 'c', 'assistant', 'world'),
    };
    mapping.root.children = ['a'];
    mapping.a.children = ['b'];
    mapping.b.children = ['c'];
    mapping.c.children = ['d'];
    mapping.d.children = [];
    const linear = extractChatGPTLinearNodes(mapping, 'd');
    assert.deepEqual(linear.map((n) => n.id), ['b', 'd']);
    assert.equal(shouldSkipChatGPTMessage(mapping.c.message), true);
});

test('consecutive assistant turns merge into one node', () => {
    const nodes = [
        textNode('u1', 'root', 'user', 'q'),
        textNode('a1', 'u1', 'assistant', 'part1'),
        textNode('a2', 'a1', 'assistant', 'part2'),
    ];
    const merged = mergeChatGPTContinuations(nodes);
    assert.equal(merged.length, 2);
    assert.equal(
        (merged[1]?.message?.content as { parts: string[] }).parts.join(''),
        'part1part2',
    );
});

test('processChatGPTMapping walks from current_node to root', () => {
    const conversation: ChatGPTApiConversationWithId = {
        id: 'conv-1',
        title: 'demo',
        create_time: 1700000000,
        update_time: 1700000600,
        current_node: 'd',
        is_archived: false,
        mapping: {
            root: { id: 'root', children: ['b'] },
            b: textNode('b', 'root', 'user', 'hi'),
            d: textNode('d', 'b', 'assistant', 'hello there'),
        },
    };
    conversation.mapping.b.children = ['d'];
    conversation.mapping.d.children = [];
    const nodes = processChatGPTMapping(conversation);
    assert.deepEqual(nodes.map((n) => n.id), ['b', 'd']);
});

test('ChatGPTProvider matches only chatgpt hostnames', () => {
    const provider = new ChatGPTProvider({ fetchFn: () => Promise.reject(new Error('no-net')) });
    assert.equal(provider.matchesUrl('https://chatgpt.com/c/abc'), true);
    assert.equal(provider.matchesUrl('https://chat.openai.com/c/abc'), true);
    assert.equal(provider.matchesUrl('https://gemini.google.com/app'), false);
});

test('ChatGPTProvider checkReadiness reports logged-out session', async () => {
    const provider = new ChatGPTProvider({
        fetchFn: () =>
            Promise.resolve(
                new Response(JSON.stringify({}), { status: 200 }),
            ),
    });
    const readiness = await provider.checkReadiness();
    assert.equal(readiness.ready, false);
});

test('tool image nodes are kept and their sediment pointers collected', () => {
    const toolImage: ChatGPTConversationNode = {
        id: 't1',
        parent: 'u1',
        children: [],
        message: {
            author: { role: 'tool', metadata: {} },
            content: {
                content_type: 'multimodal_text',
                parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_abc' }],
            },
            id: 'msg-t1',
            recipient: 'all',
            status: 'finished_successfully',
            weight: 1,
        },
    };
    const toolChatter: ChatGPTConversationNode = {
        id: 't2',
        parent: 't1',
        children: [],
        message: {
            author: { role: 'tool', name: 'browser', metadata: {} },
            content: { content_type: 'text', parts: ['searching...'] },
            id: 'msg-t2',
            recipient: 'all',
            status: 'finished_successfully',
            weight: 1,
        },
    };
    assert.equal(shouldSkipChatGPTMessage(toolImage.message), false);
    assert.equal(shouldSkipChatGPTMessage(toolChatter.message), true);
    assert.deepEqual(collectChatGPTImagePointers([toolImage, toolChatter]), ['sediment://file_abc']);
});

test('files/download helpers narrow payloads and encode bytes', () => {
    assert.equal(fileIdFromPointer('sediment://file_abc'), 'file_abc');
    assert.equal(fileIdFromPointer('https://x/y.png'), null);
    assert.deepEqual(
        parseFileDownloadPayload({ status: 'success', download_url: 'https://x/dl', file_name: 'a.png', file_size_bytes: 10 }),
        { downloadUrl: 'https://x/dl', fileName: 'a.png', byteLength: 10 },
    );
    assert.equal(parseFileDownloadPayload({ status: 'error' }), null);
    assert.equal(parseFileDownloadPayload(null), null);
    assert.equal(arrayBufferToBase64(new Uint8Array([104, 105]).buffer), 'aGk=');
});

test('fetchConversationDetail downloads image pointers into Domain assets', async () => {
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const mapping: Record<string, ChatGPTConversationNode> = {
        root: { id: 'root', children: ['u1'] },
        u1: {
            id: 'u1', parent: 'root', children: ['t1'],
            message: {
                author: { role: 'user', metadata: {} },
                content: { content_type: 'text', parts: ['draw a cat'] },
                id: 'msg-u1', recipient: 'all', status: 'finished_successfully', weight: 1,
            },
        },
        t1: {
            id: 't1', parent: 'u1', children: ['a1'],
            message: {
                author: { role: 'tool', metadata: {} },
                content: {
                    content_type: 'multimodal_text',
                    parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_cat' }],
                },
                id: 'msg-t1', recipient: 'all', status: 'finished_successfully', weight: 1,
            },
        },
        a1: {
            id: 'a1', parent: 't1', children: [],
            message: {
                author: { role: 'assistant', metadata: {} },
                content: { content_type: 'text', parts: ['here is your cat'] },
                id: 'msg-a1', recipient: 'all', status: 'finished_successfully', weight: 1,
            },
        },
    };
    const provider = new ChatGPTProvider({
        fetchFn: (url) => {
            const u = String(url);
            if (u.endsWith('/api/auth/session')) {
                return Promise.resolve(new Response(JSON.stringify({ accessToken: 'tok' }), { status: 200 }));
            }
            if (u.includes('/files/download/')) {
                return Promise.resolve(new Response(JSON.stringify({
                    status: 'success', download_url: 'https://dl/img.png', file_name: 'cat.png',
                }), { status: 200 }));
            }
            if (u === 'https://dl/img.png') {
                return Promise.resolve(new Response(pngBytes, {
                    status: 200, headers: { 'content-type': 'image/png' },
                }));
            }
            if (u.includes('/conversation/')) {
                return Promise.resolve(new Response(JSON.stringify({
                    title: 'img chat', create_time: 1700000000, update_time: 1700000060,
                    current_node: 'a1', mapping, is_archived: false,
                }), { status: 200 }));
            }
            return Promise.resolve(new Response('nope', { status: 404 }));
        },
    });
    const detail = await provider.fetchConversationDetail('conv-img');
    assert.equal(detail.conversation.assets.length, 1);
    assert.equal(detail.conversation.assets[0]?.kind, 'image');
    assert.equal(detail.conversation.assets[0]?.sourceUri, 'sediment://file_cat');
    assert.equal(detail.conversation.assets[0]?.mediaType, 'image/png');
    assert.ok((detail.conversation.assets[0]?.dataBase64 ?? '').length > 0);
    const toolMsg = detail.conversation.messages.find((m) => m.id === 't1');
    assert.deepEqual(toolMsg?.attachmentIds, [detail.conversation.assets[0]?.id]);
    assert.ok(toolMsg?.content.some((b) => b.type === 'image'));
});

test('thinking walk attaches hidden reasoning to the following assistant node', () => {
    const mapping: Record<string, ChatGPTConversationNode> = {
        root: { id: 'root', children: ['u1'] },
        u1: {
            id: 'u1', parent: 'root', children: ['th'],
            message: {
                author: { role: 'user', metadata: {} },
                content: { content_type: 'text', parts: ['q'] },
                id: 'msg-u1', recipient: 'all', status: 'finished_successfully', weight: 1,
            },
        },
        th: {
            id: 'th', parent: 'u1', children: ['rc'],
            message: {
                author: { role: 'assistant', metadata: {} },
                content: { content_type: 'thoughts', thoughts: [{ summary: 'plan', content: 'step by step' }] },
                id: 'msg-th', recipient: 'all', status: 'finished_successfully', weight: 1,
            },
        },
        rc: {
            id: 'rc', parent: 'th', children: ['a1'],
            message: {
                author: { role: 'assistant', metadata: { finished_duration_sec: 12 } },
                content: { content_type: 'reasoning_recap', content: 'Thought for 12 seconds' },
                id: 'msg-rc', recipient: 'all', status: 'finished_successfully', weight: 1,
            },
        },
        a1: {
            id: 'a1', parent: 'rc', children: [],
            message: {
                author: { role: 'assistant', metadata: {} },
                content: { content_type: 'text', parts: ['answer'] },
                id: 'msg-a1', recipient: 'all', status: 'finished_successfully', weight: 1,
            },
        },
    };
    const ids = new Set(['u1', 'a1']);
    const got = collectChatGPTThinking(mapping, ids, 'a1');
    const thinking = got.get('a1');
    assert.ok(thinking);
    assert.equal(thinking?.thoughts.length, 1);
    assert.equal(thinking?.durationSeconds, 12);
    const blocks = thinkingToReasoningBlocks(thinking ?? { thoughts: [], activities: [] });
    assert.equal(blocks.length, 2);
    assert.match(JSON.stringify(blocks[0]), /12/);
});

test('citations dedupe by URL across tether and grouped references', () => {
    const node: ChatGPTConversationNode = {
        id: 'a1', children: [],
        message: {
            author: { role: 'assistant', metadata: {} },
            content: { content_type: 'text', parts: ['hi'] },
            id: 'msg-a1', recipient: 'all', status: 'finished_successfully', weight: 1,
            metadata: {
                citations: [{ metadata: { title: 'T', url: 'https://ex.com/a' } }],
                content_references: [{
                    items: [{ title: 'T', url: 'https://ex.com/a' }, { title: 'B', url: 'https://ex.com/b' }],
                }],
            },
        },
    };
    const cites = citationsOfChatGPTNode(node);
    assert.deepEqual(cites.map((c) => c.url), ['https://ex.com/a', 'https://ex.com/b']);
    assert.deepEqual(cites.map((c) => c.id), ['citation-0', 'citation-1']);
});

test('uploaded non-image files recorded, images left to the image path', () => {
    const node: ChatGPTConversationNode = {
        id: 'u1', children: [],
        message: {
            author: { role: 'user', metadata: {} },
            content: { content_type: 'text', parts: ['see files'] },
            id: 'msg-u1', recipient: 'all', status: 'finished_successfully', weight: 1,
            metadata: {
                attachments: [
                    { id: 'file-1', name: 'notes.pdf', mime_type: 'application/pdf', size: 42 },
                    { id: 'file-2', name: 'pic.png', mime_type: 'image/png' },
                ],
            },
        },
    };
    assert.deepEqual(uploadedFilesOfChatGPTNode(node), [
        { id: 'file-1', name: 'notes.pdf', mediaType: 'application/pdf', byteLength: 42 },
    ]);
});

test('incremental refresh stops at first unchanged item and merges head', () => {
    const cached = [
        { id: 'a', title: 'A', create_time: 1, update_time: 3 },
        { id: 'b', title: 'B', create_time: 1, update_time: 2 },
    ];
    const pages = [[
        { id: 'c', title: 'C', create_time: 2, update_time: 4 },
        { id: 'a', title: 'A', create_time: 1, update_time: 3 },
        { id: 'z', title: 'Z', create_time: 1, update_time: 9 },
    ]];
    const { head, reachedKnown } = refreshChatGPTList(cached, pages);
    assert.equal(reachedKnown, true);
    assert.deepEqual(head.map((c) => c.id), ['c']);
    assert.deepEqual(applyChatGPTHead(head, cached).map((c) => c.id), ['c', 'a', 'b']);
});

test('listConversations paginates until the reported total is reached', async () => {
    const calls: string[] = [];
    const provider = new ChatGPTProvider({
        fetchFn: (url) => {
            const u = String(url);
            if (u.endsWith('/api/auth/session')) {
                return Promise.resolve(new Response(JSON.stringify({ accessToken: 'tok' }), { status: 200 }));
            }
            calls.push(u);
            const items = [
                { id: 'a', title: 'A', create_time: 1 },
                { id: 'b', title: 'B', create_time: 1 },
                { id: 'c', title: 'C', create_time: 1 },
            ];
            return Promise.resolve(new Response(JSON.stringify({
                items, total: 3, limit: 100, offset: 0, has_missing_conversations: false,
            }), { status: 200 }));
        },
    });
    const page = await provider.listConversations({ maxPages: 5 });
    assert.deepEqual(page.items.map((i) => i.id), ['a', 'b', 'c']);
    assert.equal(page.exhaustive, true);
    assert.equal(page.total, 3);
    assert.equal(calls.length, 1);
});
