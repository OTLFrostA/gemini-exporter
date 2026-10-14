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
