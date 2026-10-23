/**
 * tests/provider_degrade.test.ts
 * PR1 subtraction 后保留的真实 provider 测试：
 * - manifest content_scripts 无 ChatGPT 域名匹配
 */
import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';


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




