/**
 * tests/provider_degrade.test.ts
 * Phase E 验收 (P1-11)：ChatGPT 降级为 dormant 预留扩展点。
 * - chatgpt 已注册但不是 default provider
 * - capabilities.supportsRealtimeSniffing === false
 * - listConversations 误调直接抛 dormant
 * - manifest content_scripts 无 ChatGPT 域名匹配（与 matchesUrl 断言一致）
 * - 三处 resolveProvider 收口到 src/core/provider/providerResolver.ts
 */
import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { ProviderRegistry } from '../src/core/provider/providerRegistry.js';
import { ChatGPTProvider } from '../src/core/provider/chatgpt/chatgptProvider.js';
import { resolveProvider } from '../src/core/provider/providerResolver.js';

test('Phase E: chatgpt 已注册但不是 default provider', () => {
    // providerResolver 的副作用 import 已把 gemini/chatgpt 注册进单例
    assert.ok(ProviderRegistry.get('chatgpt'), 'chatgpt 应仍注册在表里');
    assert.notStrictEqual(ProviderRegistry.getDefault()?.id, 'chatgpt', 'default provider 不能是 chatgpt');
    assert.strictEqual(ProviderRegistry.getDefault()?.id, 'gemini');
});

test('Phase E: ChatGPT 能力声明降级', () => {
    const cp = new ChatGPTProvider();
    assert.strictEqual(cp.capabilities.supportsRealtimeSniffing, false,
        'dormant provider 不得虚标 supportsRealtimeSniffing');
});

test('Phase E: listConversations 误调抛 dormant', async () => {
    const cp = new ChatGPTProvider();
    await assert.rejects(() => cp.listConversations({ maxPages: 1 }), /dormant/,
        'dormant provider 的 listConversations 必须直接抛错防误调');
});

test('Phase E: manifest content_scripts 无 ChatGPT 域名匹配', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
    const cp = new ChatGPTProvider();
    const patterns: string[] = [];
    for (const cs of manifest.content_scripts || []) {
        for (const m of cs.matches || []) patterns.push(m);
    }
    assert.ok(patterns.length > 0, 'manifest 应有 content_scripts');
    for (const p of patterns) {
        assert.ok(!/chatgpt|openai/i.test(p), `content_scripts 不应覆盖 ChatGPT 域名: ${p}`);
        // 模式转成示例 URL，再用 provider 自身的 matchesUrl 复核
        const sample = p.replace(/\*/g, 'app');
        assert.strictEqual(cp.matchesUrl(sample), false,
            `matchesUrl 不应命中 content-script 模式 ${p}`);
    }
});

test('Phase E: 三处 resolveProvider 收口到共享 helper', () => {
    const files = [
        'src/content/syncEngine.ts',
        'src/content/messageRouter.ts',
        'src/content/liveSaveCoordinator.ts'
    ];
    for (const f of files) {
        const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
        assert.ok(src.includes("from '../core/provider/providerResolver.js'"),
            `${f} 应从 providerResolver 导入 resolveProvider`);
        assert.ok(!/^\s*(const|function)\s+resolveProvider\s*\(/m.test(src),
            `${f} 不应再有本地 resolveProvider 定义`);
    }
});

test('Phase E: 共享 resolveProvider 行为与原来一致（无 location 时回落 default）', () => {
    assert.strictEqual(resolveProvider()?.id, 'gemini',
        'node 环境无 location，应回落到 default provider');
});
