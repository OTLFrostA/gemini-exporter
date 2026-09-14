/**
 * tests/provider_abstraction.test.ts
 * Comprehensive unit test suite for AIProvider abstraction layer,
 * ProviderRegistry, GeminiProvider, and ChatGPTProvider.
 */
import test from 'node:test';
import assert from 'node:assert';

import { ProviderRegistry, ProviderRegistryClass } from '../src/core/provider/providerRegistry.js';
import { GeminiProvider } from '../src/core/provider/gemini/geminiProvider.js';
import { ChatGPTProvider, flattenChatGPTMapping } from '../src/core/provider/chatgpt/chatgptProvider.js';
import ChatFormatter from '../src/core/engine/chatFormatter.js';
import * as TabService from '../src/core/utils/tabService.js';

test('ProviderRegistry - registration, lookup, and URL auto-matching', () => {
    const registry = new ProviderRegistryClass();
    const gemini = new GeminiProvider();
    const chatgpt = new ChatGPTProvider();

    registry.register(gemini);
    registry.register(chatgpt);

    assert.strictEqual(registry.get('gemini')?.id, 'gemini');
    assert.strictEqual(registry.get('chatgpt')?.id, 'chatgpt');
    assert.strictEqual(registry.get('nonexistent'), undefined);

    // URL resolution
    const geminiMatch = registry.findByUrl('https://gemini.google.com/app/c_12345678');
    assert.strictEqual(geminiMatch?.id, 'gemini', 'Should match gemini URL');

    const chatgptMatch1 = registry.findByUrl('https://chatgpt.com/c/66e01234-abcd-8001');
    assert.strictEqual(chatgptMatch1?.id, 'chatgpt', 'Should match chatgpt.com URL');

    const chatgptMatch2 = registry.findByUrl('https://chat.openai.com/c/legacy-uuid');
    assert.strictEqual(chatgptMatch2?.id, 'chatgpt', 'Should match chat.openai.com URL');

    const unknownMatch = registry.findByUrl('https://claude.ai/chat/123');
    assert.strictEqual(unknownMatch, undefined, 'Unregistered URL should return undefined');

    // Default provider
    registry.setDefaultProviderId('gemini');
    assert.strictEqual(registry.getDefault()?.id, 'gemini');
});

test('GeminiProvider - capabilities and contract verification', () => {
    const gemini = new GeminiProvider();
    assert.strictEqual(gemini.id, 'gemini');
    assert.strictEqual(gemini.name, 'Google Gemini');
    assert.ok(gemini.capabilities.supportsRealtimeSniffing);
    assert.ok(gemini.capabilities.supportsTakeoutImport);
    assert.ok(gemini.capabilities.supportsThoughtBlocks);
    assert.ok(gemini.capabilities.supportsIncrementalSync);
    assert.ok(gemini.capabilities.supportsMultiAccount);

    assert.ok(gemini.matchesUrl('https://gemini.google.com/app'));
    assert.ok(!gemini.matchesUrl('https://chatgpt.com'));
});

test('ChatGPTProvider - tree mapping normalization and Markdown export pipeline', () => {
    const rawChatGPTData = {
        id: 'chatgpt-test-conv-01',
        title: 'React 19 Concurrent Features',
        create_time: 1726000000,
        update_time: 1726000120,
        current_node: 'node-4',
        mapping: {
            'root': {
                id: 'root',
                message: null,
                parent: null,
                children: ['node-1']
            },
            'node-1': {
                id: 'node-1',
                parent: 'root',
                children: ['node-2'],
                message: {
                    id: 'msg-user-1',
                    author: { role: 'user' },
                    create_time: 1726000001,
                    content: {
                        content_type: 'text',
                        parts: ['How does React useActionState work?']
                    }
                }
            },
            'node-2': {
                id: 'node-2',
                parent: 'node-1',
                children: ['node-3'],
                message: {
                    id: 'msg-assistant-1',
                    author: { role: 'assistant' },
                    create_time: 1726000015,
                    metadata: {
                        thought: 'Analyze React 19 useActionState hook signature and behavior.'
                    },
                    content: {
                        content_type: 'text',
                        parts: ['`useActionState` is a React 19 hook designed to manage state based on the result of a form action.']
                    }
                }
            },
            'node-3': {
                id: 'node-3',
                parent: 'node-2',
                children: ['node-4'],
                message: {
                    id: 'msg-user-2',
                    author: { role: 'user' },
                    create_time: 1726000040,
                    content: {
                        content_type: 'text',
                        parts: ['Can you show a minimal TypeScript example?']
                    }
                }
            },
            'node-4': {
                id: 'node-4',
                parent: 'node-3',
                children: [],
                message: {
                    id: 'msg-assistant-2',
                    author: { role: 'assistant' },
                    create_time: 1726000055,
                    content: {
                        content_type: 'text',
                        parts: [
                            'Here is a minimal example:\n\n```typescript\nasync function updateName(prevState: string, formData: FormData) {\n  return formData.get("name") as string;\n}\n```'
                        ]
                    }
                }
            }
        }
    };

    // 1. Test normalization
    const normalized = flattenChatGPTMapping(rawChatGPTData);
    assert.strictEqual(normalized.id, 'chatgpt-test-conv-01');
    assert.strictEqual(normalized.title, 'React 19 Concurrent Features');
    assert.strictEqual(normalized.messages.length, 4, 'Should extract 4 linear messages along active branch');

    assert.strictEqual(normalized.messages[0].role, 'user');
    assert.strictEqual(normalized.messages[0].content, 'How does React useActionState work?');

    assert.strictEqual(normalized.messages[1].role, 'model');
    assert.ok(normalized.messages[1].thoughts?.includes('Analyze React 19 useActionState hook signature and behavior.'));

    assert.strictEqual(normalized.messages[2].role, 'user');
    assert.strictEqual(normalized.messages[3].role, 'model');
    assert.ok(normalized.messages[3].content.includes('```typescript'));

    // 2. Test feeding into ChatFormatter.toMarkdown()
    const markdown = ChatFormatter.toMarkdown(normalized);
    assert.ok(typeof markdown === 'string' && markdown.length > 0);
    assert.ok(markdown.includes('title: "React 19 Concurrent Features"'), 'Frontmatter should include title');
    assert.ok(markdown.includes('How does React useActionState work?'), 'Markdown should contain first prompt');
    assert.ok(markdown.includes('useActionState'), 'Markdown should contain assistant response');
    assert.ok(markdown.includes('```typescript'), 'Markdown should contain code block');
});

test('TabService - getAITab and sendToAITab integration', async () => {
    const origChrome = (global as any).chrome;
    try {
        (global as any).chrome = {
            tabs: {
                query: async ({ url }: { url: string }) => {
                    try {
                        const parsed = new URL(url.replace(/\*$/, ''));
                        if (parsed.hostname === 'chatgpt.com') {
                            return [{ id: 101, url: 'https://chatgpt.com/c/test', active: true }];
                        }
                        if (parsed.hostname === 'gemini.google.com') {
                            return [{ id: 202, url: 'https://gemini.google.com/app', active: true }];
                        }
                    } catch {}
                    return [];
                },
                sendMessage: (_tabId: number, _msg: any, cb: (res: any) => void) => {
                    cb({ ok: true, data: 'tab-response' });
                }
            },
            runtime: {}
        };

        const chatgptTab = await TabService.getAITab('chatgpt');
        assert.strictEqual(chatgptTab?.id, 101, 'Should resolve ChatGPT tab');

        const geminiTab = await TabService.getAITab('gemini');
        assert.strictEqual(geminiTab?.id, 202, 'Should resolve Gemini tab');

        const res = await TabService.sendToAITab('chatgpt', { action: 'test' });
        assert.strictEqual(res.ok, true);
    } finally {
        (global as any).chrome = origChrome;
    }
});
