export {};
const test = require('node:test');
const assert = require('node:assert');

const { getRendererStrings } = require('../src/core/export/canonical/rendererStrings.js');
const { toTypstPayload } = require('../src/core/export/typst/payload.js');
const { renderCanonicalHtml } = require('../src/core/export/canonical/renderCanonicalHtml.js');

function bundle(messages: any[], extra: any = {}) {
    return {
        schemaVersion: 1,
        conversation: {
            key: { providerId: 'gemini', accountId: 't', conversationId: 'c1' },
            title: { value: 't', source: 'derived', candidates: [] },
            createdAt: '2026-09-20T10:00:00Z',
            messages,
            ...extra,
        },
        assets: [],
        citations: [],
    };
}

function msg(blocks: any[]) {
    return { id: 'm1', role: 'model', blocks };
}

const opts = { assetPath: (_a: any) => undefined };

test('getRendererStrings returns zh and en copies', () => {
    const zh = getRendererStrings('zh');
    const en = getRendererStrings('en');
    assert.strictEqual(zh.thinkingSummary, '思考摘要');
    assert.strictEqual(zh.toolCall, '工具调用');
    assert.strictEqual(zh.sources, '来源');
    assert.strictEqual(zh.sizeUnknown, '大小未知');
    assert.strictEqual(zh.dateUnknown, '日期未知');
    assert.strictEqual(zh.unsupportedContent, '不支持的内容');
    assert.ok(zh.mathFallback.includes('无法排版'));
    assert.strictEqual(en.thinkingSummary, 'Thinking Summary');
    assert.strictEqual(en.toolCall, 'Tool call');
    assert.strictEqual(en.sources, 'Sources');
});

test('typst zh locale localizes chrome copy', () => {
    const blocks = [
        { id: 't1', type: 'thought', kind: 'summary', blocks: [] },
        { id: 'c1', type: 'toolCall', toolName: 'search', callId: 'call-1' },
        { id: 'g1', type: 'citationGroup', citationIds: [] },
        { id: 'u1', type: 'unknown', sourceType: 'gemini.mystery' },
        { id: 'm1', type: 'math', source: 'x^2', notation: 'latex' },
    ];
    const b = bundle([msg(blocks)]);
    const { payload } = toTypstPayload(b, { ...opts, locale: 'zh' });
    const nodes = payload.messages[0].blocks;
    const thought = nodes.find((n: any) => n.type === 'note' && n.label === '思考摘要');
    assert.ok(thought, 'thought label localized');
    const tool = nodes.find((n: any) => n.type === 'note' && n.blocks?.[0]?.children?.[0]?.text?.startsWith('工具调用'));
    assert.ok(tool, 'tool call label localized');
    const sources = nodes.find((n: any) => n.type === 'note' && n.children?.[0]?.text === '来源');
    assert.ok(sources, 'sources localized');
    const unknown = nodes.find((n: any) => n.type === 'unknown');
    assert.ok(unknown.label.startsWith('不支持的内容'));
    const math = nodes.find((n: any) => n.type === 'math');
    assert.ok(math.fallbackLabel.includes('无法排版'));
});

test('typst defaults to en when locale omitted', () => {
    const b = bundle([msg([{ id: 't1', type: 'thought', kind: 'summary', blocks: [] }])]);
    const { payload } = toTypstPayload(b, opts);
    const thought = payload.messages[0].blocks.find((n: any) => n.type === 'note');
    assert.strictEqual(thought.label, 'Thinking Summary');
});

test('typst zh date unknown is localized', () => {
    const b = bundle([msg([])]);
    delete b.conversation.createdAt;
    const { payload } = toTypstPayload(b, { ...opts, locale: 'zh' });
    assert.strictEqual(payload.date, '日期未知');
});

test('html uses the same string source', () => {
    const blocks = [
        { id: 't1', type: 'thought', kind: 'summary', blocks: [] },
        { id: 'c1', type: 'toolCall', toolName: 'search', callId: 'call-1' },
    ];
    const zh = renderCanonicalHtml(bundle([msg(blocks)]), {});
    assert.ok(zh.html.includes('思考摘要'));
    assert.ok(zh.html.includes('工具调用'));
    const en = renderCanonicalHtml(bundle([msg(blocks)]), { lang: 'en' });
    assert.ok(en.html.includes('Thinking Summary'));
    assert.ok(en.html.includes('Tool call'));
});
