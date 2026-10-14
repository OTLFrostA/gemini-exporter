import test from 'node:test';
import assert from 'node:assert/strict';
import {
    collectChatGPTImagePointers,
    extractChatGPTLinearNodes,
    mergeChatGPTContinuations,
    processChatGPTMapping,
    shouldSkipChatGPTMessage,
} from '../src/core/provider/chatgpt/conversationTree.js';
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
