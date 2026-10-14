import test from 'node:test';
import assert from 'node:assert/strict';
import {
    collectChatGPTImagePointers,
    extractChatGPTLinearNodes,
    mergeChatGPTContinuations,
    processChatGPTMapping,
    shouldSkipChatGPTMessage,
} from '../src/core/parsers/chatgpt/conversationTree.js';
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
    uploadedFilesOfChatGPTNode,
} from '../src/core/parsers/chatgpt/conversationDetail.js';
import { parseChatGPTConversation } from '../src/core/parsers/chatgpt/parseConversation.js';
import { preprocessChatGPTMarkdown } from '../src/core/parsers/chatgpt/markdownCompatibility.js';
import {
    ensureChatGPTRegistered,
    hasChatGPTAccess,
    requestChatGPTAccess,
} from '../src/core/provider/chatgpt/chatgptAccess.js';
import { ChatGPTProvider } from '../src/core/provider/chatgpt/chatgptProvider.js';
import { ProviderRegistry } from '../src/core/provider/providerRegistry.js';
import type {
    ChatGPTApiConversationWithId,
    ChatGPTConversationNode,
} from '../src/core/parsers/chatgpt/chatgptTypes.js';

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
    const readiness = await provider.checkReadiness();
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

test('fetchConversationDetail downloads image pointers into Domain assets', async () => {
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
    const detail = await provider.fetchConversationDetail('conv-img');
    assert.equal(detail.conversation.assets.length, 2);
    assert.equal(detail.conversation.assets[0]?.kind, 'image');
    assert.equal(detail.conversation.assets[0]?.sourceUri, 'sediment://file_cat');
    assert.equal(detail.conversation.assets[0]?.mediaType, 'image/png');
    assert.ok((detail.conversation.assets[0]?.dataBase64 ?? '').length > 0);
    // In-place order preserved: text -> image -> text
    const userMsg = detail.conversation.messages.find((m) => m.id === 'u1');
    assert.deepEqual(userMsg?.content.map((b) => b.type), ['paragraph', 'image', 'paragraph']);
    // Failed download preserves placeholder asset + image block + partial completeness + diagnostic
    assert.equal(detail.conversation.assets[1]?.sourceUri, 'sediment://file_missing');
    assert.equal(detail.conversation.assets[1]?.dataBase64, undefined);
    const toolMsg = detail.conversation.messages.find((m) => m.id === 't1');
    assert.deepEqual(toolMsg?.attachmentIds, [detail.conversation.assets[1]?.id]);
    assert.ok(toolMsg?.content.some((b) => b.type === 'image'));
    assert.equal(detail.conversation.completeness, 'partial');
    assert.ok(detail.diagnostics.some((d) => d.code === 'CHATGPT_IMAGE_ASSET_UNAVAILABLE'));
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
    const parsed = parseChatGPTConversation({
        conversation: {
            id: 'conv-think', title: 't', create_time: 1, update_time: 2,
            current_node: 'a1', mapping, is_archived: false,
        },
        assetsByNode: new Map(),
    });
    const assistant = parsed.conversation.messages.find((m) => m.id === 'a1');
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
    const parsed = parseChatGPTConversation({
        conversation: {
            id: 'conv-md', title: 't', create_time: 1, update_time: 2,
            current_node: 'a1', mapping, is_archived: false,
        },
        assetsByNode: new Map(),
    });
    const kinds = parsed.conversation.messages.find((m) => m.id === 'a1')?.content.map((b) => b.type);
    assert.ok(kinds?.includes('heading'));
    assert.ok(kinds?.includes('code'));
    assert.deepEqual(
        parsed.conversation.messages.map((m) => m.model),
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
    const parsed = parseChatGPTConversation({
        conversation: {
            id: 'conv-dup', title: 't', create_time: 1, update_time: 2,
            current_node: 't2', mapping, is_archived: false,
        },
        assetsByNode: new Map([
            ['t1', { nodeId: 't1', images: [img], files: [] }],
            ['t2', { nodeId: 't2', images: [img], files: [] }],
        ]),
    });
    assert.equal(parsed.conversation.assets.length, 1);
    assert.deepEqual(
        parsed.conversation.messages.filter((m) => m.id === 't1' || m.id === 't2').map((m) => m.attachmentIds),
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
