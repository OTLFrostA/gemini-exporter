/**
 * tests/provider_degrade.test.ts
 * PR1 subtraction 后保留的真实 provider 测试：
 * - manifest content_scripts 无 ChatGPT 域名匹配
 * - 三处 resolveProvider 收口到 src/core/provider/providerResolver.ts
 */
import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { resolveProvider } from '../src/core/provider/providerResolver.js';

test('Phase E: content-script matches are scoped to explicit HTTPS provider hosts', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
    const patterns: string[] = (manifest.content_scripts || [])
        .flatMap((entry: { matches?: string[] }) => entry.matches || []);
    assert.ok(patterns.length > 0, 'at least one provider must have a content script');
    for (const pattern of patterns) {
        assert.match(pattern, /^https:\/\/[a-z0-9.-]+\/\*$/i, `not a narrowly scoped HTTPS host: ${pattern}`);
        assert.ok(!pattern.includes('*.'), `wildcard host is too broad: ${pattern}`);
    }
    assert.ok(patterns.includes('https://gemini.google.com/*'), 'Gemini remains supported');
    // Other explicitly supported providers may be added without rewriting this test.
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
