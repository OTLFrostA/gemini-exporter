import { chatGPTInteractiveSnapshot } from '../src/l1/parsers/chatgpt/interactiveSnapshot.js';
import { getOrCreateAccount } from '../src/runtime/api/accountRegistry.js';
import { listIndexes as getConversations } from '../src/l3a/storageService.js';
import { getDetail } from '../src/l3a/storageService.js';
import { storageIdentity } from './helpers/admitFixture.js';
import { useIndexStorage } from './helpers/indexStorage.js';
useIndexStorage();
import { fixtureAccount } from './helpers/domainFixture.js';
import test from 'node:test';
import katex from 'katex';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    collectChatGPTImagePointers,
    extractChatGPTLinearNodes,
    mergeChatGPTContinuations,
    processChatGPTMapping,
    shouldSkipChatGPTMessage,
} from '../src/l1/parsers/chatgpt/conversationTree.js';
import {
    arrayBufferToBase64,
    fileIdFromPointer,
    parseFileDownloadPayload,
} from '../src/l1/client/chatgpt/imageAssets.js';
import {
    applyChatGPTHead,
    citationsOfChatGPTNode,
    collectChatGPTThinking,
    refreshChatGPTList,
    uploadedFilesOfChatGPTNode,
} from '../src/l1/parsers/chatgpt/conversationDetail.js';
import { parseChatGPTConversation } from '../src/l1/parsers/chatgpt/parseConversation.js';
import { preprocessChatGPTMarkdown } from '../src/l1/parsers/chatgpt/markdownCompatibility.js';
import {
    ensureChatGPTRegistered,
    hasChatGPTAccess,
    requestChatGPTAccess,
} from '../src/l1/client/chatgpt/chatgptAccess.js';
import { ChatGPTProvider } from '../src/l1/client/chatgpt/chatgptProvider.js';
import { chatgptList } from './fixtures/providers/chatgpt.js';
import { ProviderRegistry } from '../src/l1/client/providerRegistry.js';
import type {
    ChatGPTApiConversationWithId,
    ChatGPTConversationNode,
} from '../src/l1/parsers/chatgpt/chatgptTypes.js';

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

test('missing ChatGPT ancestors and cyclic mappings never claim complete Detail or loop', () => {
    const root = { id: 'root', children: ['a'] } as ChatGPTConversationNode;
    const broken: Record<string, ChatGPTConversationNode> = {
        root, a: textNode('a', 'missing', 'user', 'known body'),
    };
    const cyclic: Record<string, ChatGPTConversationNode> = {
        a: textNode('a', 'b', 'user', 'question'),
        b: textNode('b', 'a', 'assistant', 'answer'),
    };
    for (const mapping of [broken, cyclic]) {
        const parsed = parseChatGPTConversation({
            conversation: { id: 'conv-partial', title: 'Partial', create_time: 1, update_time: 2,
                current_node: 'a', mapping, is_archived: false },
            assetsByNode: new Map(),
        });
        assert.equal(parsed.conversation.detail.quality.status, 'partial');
    }
});

test('consecutive assistant turns merge into one node', () => {
    const a1 = textNode('a1', 'u1', 'assistant', 'part1');
    const a2 = textNode('a2', 'a1', 'assistant', 'part2');
    if (a2.message) {
        a2.message.metadata = {
            model_slug: 'gpt-6-pro',
            citations: [{ metadata: { title: 'Cite', url: 'https://ex.com' } }],
        };
    }
    const nodes = [
        textNode('u1', 'root', 'user', 'q'),
        a1,
        a2,
    ];
    const merged = mergeChatGPTContinuations(nodes);
    assert.equal(merged.length, 2);
    assert.equal(
        (merged[1]?.message?.content as { parts: string[] }).parts.join(''),
        'part1part2',
    );
    assert.equal(merged[1]?.message?.metadata?.model_slug, 'gpt-6-pro');
    assert.equal(merged[1]?.message?.metadata?.citations?.length, 1);
});

test('a linked but streaming or interrupted ChatGPT reply never claims complete coverage', () => {
    for (const patch of [{ status: 'in_progress' }, { status: 'interrupted' }, { end_turn: false }]) {
        const leaf = textNode('a', 'root', 'assistant', 'unfinished body');
        Object.assign(leaf.message!, patch);
        const parsed = parseChatGPTConversation({ conversation: { id: 'streaming', current_node: 'a',
            mapping: { root: { id: 'root', parent: null, children: ['a'] } as unknown as ChatGPTConversationNode, a: leaf },
            title: 'Streaming', create_time: 1, update_time: 2, is_archived: false }, assetsByNode: new Map() });
        assert.equal(parsed.conversation.detail.quality.status, 'partial');
    }
});

test('processChatGPTMapping walks from current_node to root', () => {
    const conversation: ChatGPTApiConversationWithId = {
        id: 'conv-1',
        title: 'demo',
        create_time: 1700000000,
        update_time: 1700000600,
        current_node: 'e',
        is_archived: false,
        mapping: {
            root: { id: 'root', children: ['b'] },
            b: textNode('b', 'root', 'user', 'hi'),
            d: textNode('d', 'b', 'assistant', 'hello there'),
            e: textNode('e', 'd', 'assistant', 'follow up'),
        },
    };
    conversation.mapping.b.children = ['d'];
    conversation.mapping.d.children = ['e'];
    conversation.mapping.e.children = [];
    const nodes = processChatGPTMapping(conversation);
    assert.deepEqual(nodes.map((n) => n.id), ['b', 'd', 'e']);
});

test('ChatGPTProvider matches only chatgpt hostnames', () => {
    const provider = new ChatGPTProvider({ fetchFn: () => Promise.reject(new Error('no-net')) });
    assert.equal(provider.matchesUrl('https://chatgpt.com/c/abc'), true);
    assert.equal(provider.matchesUrl('https://chat.openai.com/c/abc'), true);
    assert.equal(provider.matchesUrl('https://gemini.google.com/app'), false);
});

test('ChatGPTProvider checkReadiness reports logged-out session', async () => {
    let seenCredentials: RequestCredentials | undefined;
    const provider = new ChatGPTProvider({
        fetchFn: (_url, init) => {
            seenCredentials = init?.credentials;
            return Promise.resolve(
                new Response(JSON.stringify({}), { status: 200 }),
            );
        },
    });
    const readiness = await provider.checkReadiness(fixtureAccount('chatgpt').id);
    assert.equal(readiness.ready, false);
    assert.equal(seenCredentials, 'include');
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

test('Detail submits image identities; bytes are acquired on demand without changing body quality', async () => {
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const mapping: Record<string, ChatGPTConversationNode> = {
        root: { id: 'root', children: ['u1'] },
        u1: {
            id: 'u1', parent: 'root', children: ['t1'],
            message: {
                author: { role: 'user', metadata: {} },
                content: {
                    content_type: 'multimodal_text',
                    parts: [
                        'before image',
                        { content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_cat' },
                        'after image',
                    ],
                },
                id: 'msg-u1', recipient: 'all', status: 'finished_successfully', weight: 1,
            },
        },
        t1: {
            id: 't1', parent: 'u1', children: ['a1'],
            message: {
                author: { role: 'tool', metadata: {} },
                content: {
                    content_type: 'multimodal_text',
                    parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_missing' }],
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
            if (u.includes('/files/download/file_cat')) {
                return Promise.resolve(new Response(JSON.stringify({
                    status: 'success', download_url: 'https://dl/img.png', file_name: 'cat.png',
                }), { status: 200 }));
            }
            if (u.includes('/files/download/file_missing')) {
                return Promise.resolve(new Response(JSON.stringify({ status: 'error' }), { status: 404 }));
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
    const account = await getOrCreateAccount('chatgpt', 'default');
    assert.equal(await provider.fetchConversationDetail(account.id, 'conv-img'), undefined);
    const stored = await getDetail(storageIdentity('chatgpt', account.id, 'conv-img'));
    assert.ok(stored);
    const detail = stored;
    assert.equal(detail.savedAt, 1700000060000);
    assert.equal((await getConversations(account.id))[0].createdAt, 1700000000000);
    assert.equal(detail.assets.length, 2);
    assert.equal(detail.assets[0].sourceUri, 'sediment://file_cat');
    const key = { accountId: account.id, conversationId: 'conv-img' };
    const downloaded = await provider.acquireResource(key, detail.assets[0]);
    assert.deepEqual(downloaded.bytes, pngBytes);
    assert.equal(downloaded.mediaType, 'image/png');
    assert.equal(downloaded.name, 'cat.png');
    await assert.rejects(provider.acquireResource(key, detail.assets[1]), /404/);
    assert.equal(detail.quality.status, 'complete');
    const after = await getDetail(storageIdentity('chatgpt', account.id, 'conv-img'));
    assert.deepEqual(after?.quality, detail.quality);
    const userMsg = detail.messages.find(m => m.id === 'u1');
    assert.deepEqual(userMsg?.content.map(b => b.type), ['paragraph', 'image', 'paragraph']);
    const toolMsg = detail.messages.find(m => m.id === 't1');
    assert.equal(toolMsg?.attachmentIds, undefined);
    assert.deepEqual(toolMsg?.content.filter(b => b.type === 'image').map(b => b.assetId), [detail.assets[1].id]);

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
    // Reasoning blocks render through the full parser (markdown included).
    const parsed = parseChatGPTConversation({ account: fixtureAccount('chatgpt'),
        conversation: {
            id: 'conv-think', title: 't', create_time: 1, update_time: 2,
            current_node: 'a1', mapping, is_archived: false,
        },
        assetsByNode: new Map(),
    });
    const assistant = parsed.conversation.detail.messages.find((m) => m.id === 'a1');
    assert.ok(assistant?.reasoning && assistant.reasoning.length >= 2);
    assert.match(JSON.stringify(assistant?.reasoning[0]), /12/);
});

test('dialect preprocessing shields code and normalizes math/citations', () => {
    // Exact marker shapes captured live via 9222 (2026-10-14).
    const cite = '\ue200cite\ue202turn388160search0\ue202turn388160search1\ue201';
    const url = '\ue200url\ue202ChatGPT \u6a21\u578b\ue202https://help.openai.com/en/a\ue201';
    const src = '费用是 $5。公式 \\(x^2\\) 行内。引用' + cite + '结尾。看' + url + '。\n\n\\[y = mx\\]\n\n`代码 \\(不动\\) $10`。<br>换行';
    const out = preprocessChatGPTMarkdown(src);
    assert.match(out, /\$x\^2\$/);
    assert.match(out, /\$\$\ny = mx\n\$\$/);
    assert.ok(out.includes('`代码 \\(不动\\) $10`'));
    assert.ok(!out.includes('cite'));
    assert.ok(!out.includes('turn388160'));
    assert.ok(out.includes('[ChatGPT \u6a21\u578b](https://help.openai.com/en/a)'));
    assert.ok(!out.includes('<br>'));
    assert.ok(out.includes('$5'));
    assert.ok(!/[\ue000-\uf8ff]/.test(out));
});

test('bodies parse to structured blocks and models stay per-message', () => {
    const mapping: Record<string, ChatGPTConversationNode> = {
        root: { id: 'root', children: ['u1'] },
        u1: {
            id: 'u1', parent: 'root', children: ['a1'],
            message: {
                author: { role: 'user', metadata: {} },
                content: { content_type: 'text', parts: ['hi'] },
                id: 'msg-u1', recipient: 'all', status: 'finished_successfully', weight: 1,
                metadata: { model_slug: 'gpt-6' },
            },
        },
        a1: {
            id: 'a1', parent: 'u1', children: [],
            message: {
                author: { role: 'assistant', metadata: {} },
                content: { content_type: 'text', parts: ['# Title\n\n```python\nprint(1)\n```\n\n公式 \\(e=mc^2\\)'] },
                id: 'msg-a1', recipient: 'all', status: 'finished_successfully', weight: 1,
                metadata: { model_slug: 'gpt-6-pro' },
            },
        },
    };
    const parsed = parseChatGPTConversation({ account: fixtureAccount('chatgpt'),
        conversation: {
            id: 'conv-md', title: 't', create_time: 1, update_time: 2,
            current_node: 'a1', mapping, is_archived: false,
        },
        assetsByNode: new Map(),
    });
    assert.equal(parsed.sourceVersion, 2000);
    assert.equal(Object.hasOwn(parsed.conversation, 'updatedAt'), false);
    const kinds = parsed.conversation.detail.messages.find((m) => m.id === 'a1')?.content.map((b) => b.type);
    assert.ok(kinds?.includes('heading'));
    assert.ok(kinds?.includes('code'));
    assert.deepEqual(
        parsed.conversation.detail.messages.map((m) => m.model),
        ['gpt-6', 'gpt-6-pro'],
    );
});

test('repeated image pointers reuse one asset instead of breaking closure', () => {
    const tool = (id: string, parent: string): ChatGPTConversationNode => ({
        id, parent, children: [],
        message: {
            author: { role: 'tool', metadata: {} },
            content: {
                content_type: 'multimodal_text',
                parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_dup' }],
            },
            id: `msg-${id}`, recipient: 'all', status: 'finished_successfully', weight: 1,
        },
    });
    const mapping: Record<string, ChatGPTConversationNode> = {
        root: { id: 'root', children: ['u1'] },
        u1: {
            id: 'u1', parent: 'root', children: ['t1'],
            message: {
                author: { role: 'user', metadata: {} },
                content: { content_type: 'text', parts: ['again'] },
                id: 'msg-u1', recipient: 'all', status: 'finished_successfully', weight: 1,
            },
        },
        t1: { ...tool('t1', 'u1'), children: ['t2'] },
        t2: { ...tool('t2', 't1'), children: [] },
    };
    const img = { pointer: 'sediment://file_dup', assetId: 'img-file_dup', dataBase64: 'aGk=' };
    const parsed = parseChatGPTConversation({ account: fixtureAccount('chatgpt'),
        conversation: {
            id: 'conv-dup', title: 't', create_time: 1, update_time: 2,
            current_node: 't2', mapping, is_archived: false,
        },
        assetsByNode: new Map([
            ['t1', { nodeId: 't1', images: [img], files: [] }],
            ['t2', { nodeId: 't2', images: [img], files: [] }],
        ]),
    });
    assert.equal(parsed.conversation.detail.assets.length, 1);
    assert.deepEqual(
        parsed.conversation.detail.messages.filter((m) => m.id === 't1' || m.id === 't2').map((m) => m.content.filter(b => b.type === 'image').map(b => b.assetId)),
        [['img-file_dup'], ['img-file_dup']],
    );
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
                return Promise.resolve(new Response(JSON.stringify({ accessToken: 'tok', user: { id: 'u-list' }, account: { id: 'workspace-list' } }), { status: 200 }));
            }
            calls.push(u);
            const items = [
                { id: 'a', title: 'A', create_time: 1, update_time: 2 },
                { id: 'b', title: 'B', create_time: 1, update_time: 1 },
                { id: 'c', title: 'C', create_time: 1, update_time: 0.5 },
            ];
            return Promise.resolve(new Response(JSON.stringify(chatgptList({
                items, total: 3, hasMissingConversations: false,
            })), { status: 200 }));
        },
    });
    const account = await getOrCreateAccount('chatgpt', JSON.stringify(['u-list', 'workspace-list']));
    assert.equal(await provider.listConversations({ accountId: account.id, streamId: 'recent' }), 'source_end');
    const indexes = await getConversations(account.id);
    assert.deepEqual(indexes.map(i => i.key.conversationId), ['a', 'b', 'c']);
    assert.equal(indexes[0].createdAt, 1000); assert.equal(indexes[0].updatedAt, 2000);
    assert.equal(calls.length, 1);

});

test('ChatGPT current list schema without the legacy missing flag traverses all pages', async () => {
    const account = await getOrCreateAccount('chatgpt', JSON.stringify(['u-list', 'workspace-list']));
    const offsets: number[] = [];
    const committed: Array<{ page: number; total: number; trustedHead: boolean }> = [];
    const provider = new ChatGPTProvider({ fetchFn: async url => {
        if (url.endsWith('/api/auth/session')) return new Response(JSON.stringify({
            accessToken: 'tok', user: { id: 'u-list' }, account: { id: 'workspace-list' },
        }));
        const offset = Number(new URL(url).searchParams.get('offset'));
        offsets.push(offset);
        return new Response(JSON.stringify(chatgptList({
            items: Array.from({ length: offset === 0 ? 100 : 2 }, (_, i) => ({
                id: `conversation-${offset + i}`, title: `Conversation ${offset + i}`,
                create_time: 1, update_time: 1000 - offset - i,
            })),
            total: 102, offset,
        })));
    } });
    assert.equal(await provider.listConversations({
        accountId: account.id, streamId: 'recent',
        onPageCommitted: async page => {
            committed.push({ page: page.page, total: page.totalObserved, trustedHead: !!page.scanHead });
            return false;
        },
    }), 'source_end');
    assert.deepEqual(offsets, [0, 100]);
    assert.deepEqual(committed, [
        { page: 1, total: 100, trustedHead: true },
        { page: 2, total: 102, trustedHead: false },
    ]);
    assert.equal((await getConversations(account.id)).length, 102);
});

test('ChatGPT empty current list schema proves source exhaustion', async () => {
    const account = await getOrCreateAccount('chatgpt', JSON.stringify(['u-list', 'workspace-list']));
    const provider = new ChatGPTProvider({ fetchFn: async url => new Response(JSON.stringify(
        url.endsWith('/api/auth/session')
            ? { accessToken: 'tok', user: { id: 'u-list' }, account: { id: 'workspace-list' } }
            : { items: [], total: 0, limit: 100, offset: 0 },
    )) });
    assert.equal(await provider.listConversations({ accountId: account.id, streamId: 'recent' }), 'source_end');
    assert.equal((await getConversations(account.id)).length, 0);
});

test('ChatGPT Detail never relabels a foreign source conversation ID', async () => {
    const provider = new ChatGPTProvider({ fetchFn: url => Promise.resolve(new Response(JSON.stringify(
        String(url).endsWith('/api/auth/session') ? { accessToken: 'tok' } : { id: 'other-conversation' },
    ), { status: 200 })) });
    const account = await getOrCreateAccount('chatgpt', 'default');
    await assert.rejects(provider.fetchConversationDetail(account.id, 'requested-conversation'),
        /Detail identity mismatch/);
    assert.equal(await getDetail(storageIdentity('chatgpt', account.id, 'requested-conversation')), null);
});

test('ChatGPT list refuses source_end when pagination, ordering or completeness is unverified', async () => {
    const account = await getOrCreateAccount('chatgpt', JSON.stringify(['u-list', 'workspace-list']));
    const session = { accessToken: 'tok', user: { id: 'u-list' }, account: { id: 'workspace-list' } };
    const cases = [
        { items: [{ id: 'missing-time', title: 'Missing time' }], total: 1, limit: 100, offset: 0, has_missing_conversations: false },
        { items: [{ id: 'missing-row', title: 'Incomplete', update_time: 2 }], total: 1, limit: 100, offset: 0, has_missing_conversations: true },
        { items: [{ id: 'wrong-offset', title: 'Wrong offset', update_time: 2 }], total: 1, limit: 100, offset: 100, has_missing_conversations: false },
        { items: [{ id: 'missing-total', title: 'Missing total', update_time: 2 }], limit: 100, offset: 0, has_missing_conversations: false },
        // Omitting the legacy flag cannot compensate for incomplete page evidence.
        { items: [{ id: 'short-page', title: 'Short page', update_time: 2 }], total: 2, limit: 100, offset: 0 },
        { items: [{ id: 'no-total', title: 'No total', update_time: 2 }], limit: 100, offset: 0 },
        { items: [{ id: 'bad-offset', title: 'Bad offset', update_time: 2 }], total: 1, limit: 100, offset: 100 },
        { items: [{ id: 'no-limit', title: 'No limit', update_time: 2 }], total: 1, offset: 0 },
    ];
    for (const page of cases) {
        const provider = new ChatGPTProvider({ fetchFn: url => Promise.resolve(new Response(JSON.stringify(
            String(url).endsWith('/api/auth/session') ? session : page,
        ), { status: 200 })) });
        await assert.rejects(provider.listConversations({ accountId: account.id, streamId: 'recent' }),
            /Unverified ChatGPT list page/);
    }
});

test('optional access helper never prompts and registers only on grant', async () => {
    const holder = globalThis as unknown as { chrome?: unknown };
    const previous: unknown = holder.chrome;
    try {
        holder.chrome = undefined;
        assert.equal(await hasChatGPTAccess(), false);
        assert.equal(await requestChatGPTAccess(), false);
        assert.equal(await ensureChatGPTRegistered(), false);
        let granted = false;
        holder.chrome = {
            permissions: {
                contains: () => Promise.resolve(granted),
                request: () => {
                    granted = true;
                    return Promise.resolve(true);
                },
            },
        };
        assert.equal(await hasChatGPTAccess(), false);
        assert.equal(await requestChatGPTAccess(), true);
        assert.equal(await hasChatGPTAccess(), true);
        assert.equal(await ensureChatGPTRegistered(), true);
    } finally {
        ProviderRegistry.unregister('chatgpt');
        holder.chrome = previous;
    }
});

test('Intelligent UI questionnaires use the provider fallback without executing or exporting component code', () => {
    const raw = '<radio-group value={issue}><radio>Menu unavailable</radio></radio-group>';
    const fallback = 'Which issue?\n\nMenu unavailable\n\nCannot switch\n\nWhich platform?\n\nBrowser\n\nMobile\n\n[Diagnose]';
    const assistant = textNode('answer', 'question', 'assistant', raw);
    assistant.message!.metadata = { model_dil_v2: { fallbackMarkdown: fallback } };
    const conversation: ChatGPTApiConversationWithId = {
        id: 'questionnaire', title: 'Questionnaire', create_time: 1, update_time: 2,
        current_node: 'answer', is_archived: false,
        mapping: {
            root: { id: 'root', children: ['question'] },
            question: textNode('question', 'root', 'user', 'Help me diagnose'),
            answer: assistant,
        },
    };
    const parsed = parseChatGPTConversation({ conversation, assetsByNode: new Map() });
    const body = JSON.stringify(parsed.conversation.detail.messages[1].content);
    for (const label of ['Which issue?', 'Menu unavailable', 'Cannot switch', 'Which platform?', 'Browser', 'Mobile', 'Diagnose'])
        assert.ok(body.includes(label), `missing questionnaire label: ${label}`);
    assert.ok(!body.includes('radio-group'));
    assert.ok(!body.includes('value={issue}'));
    assert.equal(assistant.message!.content.content_type, 'text');
    assert.equal((assistant.message!.content as { parts: string[] }).parts[0], raw, 'raw source remains unchanged');
});


test('Loop-generated questionnaire data survives an official fallback that omits every question', () => {
    const raw = `{@body const questions = [{q:"Which waste?",opts:["Peels","Plastic","Glass"]},{q:"How to aerate?",opts:["Mix","Seal","Flood"]}]}
{#each questions as question, i}<text>{question.q}</text>{/each}`;
    const snapshot = chatGPTInteractiveSnapshot(raw, '# Compost quiz\n\n[Submit]');
    assert.equal(snapshot.incomplete, false);
    assert.equal(snapshot.representation, 'provider-fallback');
    assert.ok(snapshot.text.startsWith('# Compost quiz\n\n[Submit]'));
    assert.equal(snapshot.recoveredStrings, 8);
    for (const label of ['Which waste?', 'Peels', 'Plastic', 'Glass', 'How to aerate?', 'Mix', 'Seal', 'Flood', '[Submit]'])
        assert.ok(snapshot.text.includes(label), label);
    assert.ok(!snapshot.text.includes('{#each'));
    const answer = textNode('answer', 'question', 'assistant', raw);
    answer.message!.metadata = { model_dil_v2: { fallbackMarkdown: '# Compost quiz\n\n[Submit]' } };
    const parsed = parseChatGPTConversation({ assetsByNode: new Map(), conversation: {
        id: 'dynamic-quiz', title: 'Quiz', create_time: 1, update_time: 2, current_node: 'answer', is_archived: false,
        mapping: { root: { id: 'root', children: ['question'] }, question: textNode('question', 'root', 'user', 'Quiz me'), answer },
    } });
    assert.equal(parsed.conversation.detail.quality.status, 'complete');
    assert.ok(!parsed.diagnostics.some(item => item.code === 'CHATGPT_INTERACTIVE_CONTENT_INCOMPLETE'));
    const diagnostic = parsed.diagnostics.find(item => item.code === 'CHATGPT_INTERACTIVE_STATIC_SNAPSHOT');
    assert.equal(diagnostic?.severity, 'info');
    assert.deepEqual(diagnostic?.details, { representation: 'provider-fallback', recoveredStrings: 8, interactiveBehaviorPreserved: false });
    assert.ok(JSON.stringify(parsed.conversation.detail.messages).includes('Peels'));
});

test('Interactive snapshot rejects executable bindings and handles empty fallback-only source', () => {
    for (const expression of ['fetch("https://invalid.example")', '[{q:run()}]', '["hidden"].map(run)', '["hidden"] + run()', '[...secrets]', '[{get q(){return "hidden"}}]']) {
        const snapshot = chatGPTInteractiveSnapshot(`{@body const questions = ${expression}}{#each questions as q}<text>{q}</text>{/each}`, '[Submit]');
        assert.equal(snapshot.incomplete, false, 'fully preserved fallback is independent of executable component support');
        assert.equal(snapshot.text, '[Submit]');
        assert.ok(!snapshot.text.includes('hidden'));
        assert.ok(!snapshot.text.includes('fetch('));
        assert.equal(chatGPTInteractiveSnapshot(`{@body const questions = ${expression}}{#each questions as q}<text>{q}</text>{/each}`).incomplete, true);
    }
    const answer = textNode('answer', 'question', 'assistant', '');
    answer.message!.metadata = { model_dil_v2: { fallbackMarkdown: 'Question and options' } };
    assert.equal(shouldSkipChatGPTMessage(answer.message), false);
    answer.message!.metadata = { model_dil_v2: {} };
    assert.equal(shouldSkipChatGPTMessage(answer.message), false);
    assert.equal(chatGPTInteractiveSnapshot('').incomplete, true);
    assert.ok(chatGPTInteractiveSnapshot('{@body const q = [{"text" : "safe <tag> *value*", "opts": ["a", "b"]}]}{#each q as x}', 'Submit').text.includes('safe \\<tag\\> \\*value\\*'));
});

test('Complete fallback remains exact for unsupported dynamic components and source size limits', () => {
    const fallback = '# Questionnaire\n\nQuestion?\n\n- Yes\n- No\n\n[Submit]\n';
    for (const raw of [
        '{@body const questions = fetchQuestions()}{#each questions as q}{#if q.visible}<radio>{q.text}</radio>{/if}{/each}',
        '{#if state.submitted}<text>{calculateScore()}</text>{/if}',
        '<radio-group value={selection}><radio>Yes</radio></radio-group>',
        '{@body ' + ' '.repeat(1_000_001),
    ]) {
        const snapshot = chatGPTInteractiveSnapshot(raw, fallback);
        assert.equal(snapshot.text, fallback);
        assert.equal(snapshot.incomplete, false);
        assert.equal(snapshot.recoveredStrings, 0);
        assert.equal(snapshot.representation, 'provider-fallback');
    }
});

test('A fallback that already contains loop labels is not duplicated or downgraded', () => {
    const raw = '{@body const $questions = [{q:"Question?",opts:["Yes","No"]}]}'
        + '{#each $questions as q}<text>{q.q}</text>{/each}';
    const fallback = '# Complete quiz\n\nQuestion?\n\n- Yes\n- No\n\n[Submit]\n';
    const snapshot = chatGPTInteractiveSnapshot(raw, fallback);
    assert.equal(snapshot.text, fallback);
    assert.equal(snapshot.incomplete, false);
    assert.equal(snapshot.recoveredStrings, 0);
    const recovered = chatGPTInteractiveSnapshot(raw, '[Submit]');
    assert.equal(recovered.recoveredStrings, 3, 'dollar signs in valid bindings are matched literally');
    const distinctBinding = raw.replace('{#each $questions as', '{#each $questionsExtra as');
    assert.equal(chatGPTInteractiveSnapshot(distinctBinding, '[Submit]').recoveredStrings, 0,
        'a different loop binding must not expose an unrelated declaration');
});

test('Without a fallback, literal recovery remains partial and ignores arrays outside rendered loops', () => {
    const raw = '{@body const internal = ["internal-id","not-visible"]}'
        + '{@body const questions = [{q:"Question one?",opts:["Yes","No"]},{q:"Question two?",opts:["Yes","No"]}]}\n'
        + '{#each questions as q}<text>{q.q}</text>{/each}';
    const snapshot = chatGPTInteractiveSnapshot(raw, ' \n ');
    assert.equal(snapshot.incomplete, true);
    assert.equal(snapshot.representation, 'literal-recovery');
    assert.equal(snapshot.recoveredStrings, 6);
    assert.equal(snapshot.text.match(/Yes/g)?.length, 2, 'repeated options belong to both questions');
    assert.ok(!snapshot.text.includes('internal-id'));
    assert.ok(!snapshot.text.includes('not-visible'));
    assert.ok(snapshot.text.includes('no usable Markdown fallback'));
    assert.equal(chatGPTInteractiveSnapshot('', ' \n ').representation, 'unavailable');
    const answer = textNode('answer', 'question', 'assistant', raw);
    answer.message!.metadata = { model_dil_v2: {} };
    const parsed = parseChatGPTConversation({ assetsByNode: new Map(), conversation: {
        id: 'fallback-missing', title: 'Quiz', create_time: 1, update_time: 2, current_node: 'answer', is_archived: false,
        mapping: { root: { id: 'root', children: ['question'] }, question: textNode('question', 'root', 'user', 'Quiz me'), answer },
    } });
    assert.equal(parsed.conversation.detail.quality.status, 'partial');
    assert.ok(parsed.diagnostics.some(item => item.code === 'CHATGPT_INTERACTIVE_CONTENT_INCOMPLETE' && item.severity === 'warning'));
});

test('Captured live DIL quiz preserves every fallback character and recovers three questions with nine options', () => {
    const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures/chatgpt_dynamic_questionnaire.json'), 'utf8')) as {
        raw: string; fallbackMarkdown: string; expectedQuestions: number; expectedOptions: number;
    };
    const snapshot = chatGPTInteractiveSnapshot(fixture.raw, fixture.fallbackMarkdown);
    assert.ok(snapshot.text.startsWith(fixture.fallbackMarkdown));
    assert.equal(snapshot.incomplete, false);
    assert.equal(snapshot.recoveredStrings, fixture.expectedQuestions + fixture.expectedOptions);
    assert.equal(snapshot.text.split('\n').filter(line => /^- \d\. /.test(line)).length, 3);
    assert.equal(snapshot.text.split('\n').filter(line => /^  - /.test(line)).length, 9);
    for (const token of ['{#each', 'onChange', 'GenUI.issueNewTurn', 'DIL.useState']) assert.ok(!snapshot.text.includes(token));

    const answer = textNode('answer', 'question', 'assistant', fixture.raw);
    answer.message!.metadata = { model_dil_v2: { fallbackMarkdown: fixture.fallbackMarkdown } };
    const conversation: ChatGPTApiConversationWithId = {
        id: 'captured-quiz', title: 'Quiz', create_time: 1, update_time: 2, current_node: 'answer', is_archived: false,
        mapping: { root: { id: 'root', children: ['question'] }, question: textNode('question', 'root', 'user', 'Quiz me'), answer },
    };
    const parsed = parseChatGPTConversation({ conversation, assetsByNode: new Map() });
    assert.equal(parsed.conversation.detail.quality.status, 'complete');
    assert.ok(JSON.stringify(parsed.conversation.detail.messages).includes('COMPOST-END'));
    assert.equal(conversation.mapping.answer.message?.content, answer.message?.content, 'source content is not mutated');

    answer.message!.end_turn = false;
    assert.equal(parseChatGPTConversation({ conversation, assetsByNode: new Map() }).conversation.detail.quality.status, 'partial',
        'preserving the fallback cannot hide an unfinished source reply');
    answer.message!.end_turn = true;
    answer.parent = 'missing';
    assert.equal(parseChatGPTConversation({ conversation, assetsByNode: new Map() }).conversation.detail.quality.status, 'partial',
        'preserving the fallback cannot hide a broken conversation branch');
});


test('DIL AsyncImage gallery becomes one ordered image resource instead of leaked control JSON', () => {
    const url = 'https://images.openai.com/static-rsc-4/' + 'a'.repeat(300) + '?purpose=fullsize';
    const answer = textNode('answer', 'question', 'assistant', '<AsyncImage query="flow network"/>');
    answer.message!.metadata = { model_dil_v2: {
        fallbackMarkdown: 'Before\n\n\uE200image_group\uE202{"query":["flow network"]}\uE201\n\nAfter',
        appData: { opGenui: { componentResults: { image: { componentName: 'AsyncImage', status: 'resolved',
            safe_urls: [url], state: { images: [{ content_url: url }, { content_url: url }] } } } } },
    } };
    const conversation = { id: 'gallery', title: 'Gallery', create_time: 1, update_time: 2, current_node: 'answer', is_archived: false,
        mapping: { root: { id: 'root', children: ['question'] }, question: textNode('question', 'root', 'user', 'Show diagram'), answer } };
    const parsed = parseChatGPTConversation({ conversation, assetsByNode: new Map() });
    const message = parsed.conversation.detail.messages.at(-1)!;
    assert.deepEqual(message.content.map(b => b.type), ['paragraph', 'image', 'paragraph']);
    assert.equal(parsed.conversation.detail.assets.length, 1);
    assert.equal(parsed.conversation.detail.assets[0].sourceUri, url);
    assert.ok(parsed.conversation.detail.assets[0].id.length < 64);
    assert.ok(!JSON.stringify(message.content).includes('image_group'));
    assert.ok(answer.message!.metadata!.model_dil_v2!.fallbackMarkdown!.includes('image_group'), 'source stays unchanged');
    const imageResult = answer.message!.metadata!.model_dil_v2!.appData!.opGenui!.componentResults!.image;
    imageResult.safe_urls = [];
    assert.equal(parseChatGPTConversation({ conversation, assetsByNode: new Map() }).conversation.detail.assets.length, 0,
        'unapproved source URLs are never promoted into image resources');
    imageResult.safe_urls = ['https://invalid.example/x']; imageResult.state!.images = [{content_url:'https://invalid.example/x'}];
    assert.equal(parseChatGPTConversation({ conversation, assetsByNode: new Map() }).conversation.detail.assets.length, 0);
});


test('DIL galleries bind each query to its resolution ID despite reordered results', () => {
    const answer = textNode('answer', 'question', 'assistant', '<AsyncImage/>');
    const urlA = 'https://images.openai.com/static-rsc-4/winding';
    const urlB = 'https://images.openai.com/static-rsc-4/ray';
    answer.message!.metadata = { model_dil_v2: {
        fallbackMarkdown: 'Before\n\uE200image_group\uE202{"query":["winding"]}\uE201\nMiddle\n\uE200image_group\uE202{"query":["ray"]}\uE201\nAfter',
        code: '__dil.jsx(AsyncImage,{"query":"winding","__resolutionId":__dilConstants["4"]});__dil.jsx(AsyncImage,{"query":"ray","__resolutionId":__dilConstants["8"]})',
        constants: { '4': 'id-a', '8': 'id-b' },
        appData: { opGenui: { componentResults: {
            'id-b': { componentName: 'AsyncImage', status: 'resolved', safe_urls: [urlB], state: { images: [{ content_url: urlB }] } },
            'id-a': { componentName: 'AsyncImage', status: 'resolved', safe_urls: [urlA], state: { images: [{ content_url: urlA }] } },
        } } },
    } };
    const conversation = { id: 'galleries', title: 'Gallery', create_time: 1, update_time: 2, current_node: 'answer', is_archived: false,
        mapping: { root: { id: 'root', children: ['question'] }, question: textNode('question', 'root', 'user', 'Show diagrams'), answer } };
    const parsed = parseChatGPTConversation({ conversation, assetsByNode: new Map() });
    assert.deepEqual(parsed.conversation.detail.assets.map(asset => asset.sourceUri), [urlA, urlB]);
    assert.deepEqual(parsed.conversation.detail.messages.at(-1)!.content.map(block => block.type), ['paragraph', 'image', 'paragraph', 'image', 'paragraph']);
    answer.message!.metadata!.model_dil_v2!.constants = {};
    assert.equal(parseChatGPTConversation({ conversation, assetsByNode: new Map() }).conversation.detail.assets.length, 0, 'ambiguous multi-gallery ordering is never guessed');
});

test('DIL fallback norm escapes preserve all table cells and math', () => {
    const answer = textNode('answer', 'question', 'assistant', '<table/>');
    answer.message!.metadata = { model_dil_v2: { fallbackMarkdown: String.raw`| Check | Assertion | Purpose |
|---|---|---|
| Optimality | \(\\|x-\Pi(x)\\|_\infty<10^{-9}\) | Checks residual |` } };
    const conversation = { id: 'norm', title: 'Norm', create_time: 1, update_time: 2, current_node: 'answer', is_archived: false,
        mapping: { root: { id: 'root', children: ['question'] }, question: textNode('question', 'root', 'user', 'Verify'), answer } };
    const blocks = parseChatGPTConversation({ conversation, assetsByNode: new Map() }).conversation.detail.messages.at(-1)!.content;
    const serialized = JSON.stringify(blocks);
    assert.ok(serialized.includes('Checks residual'));
    const table = blocks.find(block => block.type === 'table');
    assert.ok(table && table.type === 'table');
    assert.equal(table.rows[0].cells.length, 3);
    const math = table.rows[0].cells[1].children.find(node => node.type === 'inlineMath');
    assert.ok(math && math.type === 'inlineMath');
    assert.doesNotThrow(() => katex.renderToString(math.source, { throwOnError: true }));
    assert.ok(serialized.includes('Vert{}'));
    assert.ok(!serialized.includes('inlineCode'));
});
