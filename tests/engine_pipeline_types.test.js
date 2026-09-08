// tests/engine_pipeline_types.test.js - Contract and edge case tests for Layer 4 Engine
const test = require('node:test');
const assert = require('node:assert/strict');

// Setup environment and load modules via ts_register
require('./ts_register.js');
const ChatFormatter = require('../src/core/engine/chatFormatter.js');
const { AsyncQueue } = require('../src/core/engine/exportEngine.js');
const BatchWorker = require('../src/core/engine/export/batchWorker.js');

test('TDD: ChatFormatter protects code fences and converts headings properly', () => {
    const raw = [
        '# Top Heading',
        '## Sub Heading',
        '```markdown',
        '# Not a heading inside code block',
        '## Also not a heading',
        '```',
        '### Deep Heading',
        '~~~python',
        '# Python comment',
        '~~~'
    ].join('\n');

    const result = ChatFormatter.adjustHeadingHierarchy(raw, 2);
    assert.match(result, /### Top Heading/);
    assert.match(result, /#### Sub Heading/);
    assert.match(result, /# Not a heading inside code block/);
    assert.match(result, /# Python comment/);
    assert.match(result, /##### Deep Heading/);
});

test('TDD: ChatFormatter cleans Google internal tool URLs and unwraps links', () => {
    const raw = 'Check this out: [Research Report](https://googleusercontent.com/deep_research_confirmation_content/12345) and an image chip: https://googleusercontent.com/image_generation_content/abc';
    const cleaned = ChatFormatter.cleanMessageBody(raw);
    assert.ok(!cleaned.includes('https://googleusercontent.com/deep_research_confirmation_content'));
    assert.ok(!cleaned.includes('https://googleusercontent.com/image_generation_content'));
    assert.ok(cleaned.includes('Research Report'));
});

test('TDD: AsyncQueue supports concurrent queueing, abort signals, and closing', async () => {
    const q = new AsyncQueue();
    assert.equal(q.length, 0);

    // 1. Pop before push
    const popPromise1 = q.pop();
    q.push('item1');
    const res1 = await popPromise1;
    assert.equal(res1, 'item1');

    // 2. Abort signal on waiting pop
    const ac = new AbortController();
    const popPromise2 = q.pop(ac.signal);
    ac.abort();
    const res2 = await popPromise2;
    assert.equal(res2, null, 'Aborted pop must resolve to null');

    // 3. Queue close resolves all pending waiters to null
    const popPromise3 = q.pop();
    q.close();
    const res3 = await popPromise3;
    assert.equal(res3, null, 'Closing queue must resolve waiters to null');
    assert.equal(await q.pop(), null, 'Pop on closed queue must return null');
});

test('TDD: BatchWorker.resolveChat skips bad brand titles and preserves user sniff', async () => {
    const chat = {
        id: 'test_123',
        title: 'Google Gemini',
        titles: { rpc: 'Google Gemini', sniff: '如何设计微服务架构' },
        titleSource: 'sniff'
    };
    const listConv = {
        id: 'test_123',
        title: '如何设计微服务架构',
        titles: { rpc: 'Google Gemini', sniff: '如何设计微服务架构' },
        titleSource: 'sniff'
    };

    const resolved = await BatchWorker.resolveChat(
        chat,
        { id: 'test_123', title: '如何设计微服务架构' },
        listConv,
        null,
        'u0',
        () => {},
        () => {}
    );

    assert.equal(resolved.isError, false);
    assert.notEqual(resolved.listTitle, 'Google Gemini');
    assert.equal(resolved.listTitle, '如何设计微服务架构');
});

test('TDD: formatContent defaults to markdown on unknown format', () => {
    const chat = { id: 'test_fmt', title: 'Test Format', messages: [] };
    const res = ChatFormatter.formatContent(chat, 'unknown_format');
    assert.equal(res.ext, 'md');
    assert.equal(res.mime, 'text/markdown');
    assert.match(res.content, /# Test Format/);
});

test('TDD: AssetPipeline rejects path traversal in sanitizeZipPath', () => {
    const AssetPipeline = require('../src/core/engine/assetPipeline.js');
    const pipeline = new AssetPipeline();
    // sanitizeZipPath should be available or called via utils
    const sanitize = (typeof GeminiUtils !== 'undefined' && GeminiUtils.sanitizeRelativePath)
        ? GeminiUtils.sanitizeRelativePath
        : require('../src/core/utils/utils.js').sanitizeRelativePath;
    assert.equal(sanitize('../../../etc/passwd', 'file'), '_/_/_/etc/passwd');
});
