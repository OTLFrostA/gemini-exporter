import { restoreDomainSnapshot } from '../src/core/domain/runtimeValidation.js';
export {};
const test = require('node:test');
const assert = require('node:assert');

const { getRendererStrings } = require('../src/core/renderers/shared/renderStrings.js');
const { composeDomainDocument } = require('../src/core/document/compose/composeDomainDocument.js');
const { renderTypstFixture } = require('./helpers/renderTypstFixture.js');
const { renderDocumentHtml } = require('../src/core/renderers/html/renderHtml.js');

function domainFixture(messages: any[], extra: any = {}) {
    const createdAt = require('../src/core/domain/time.js').normalizeTimestamp('createdAt' in extra ? extra.createdAt : Date.parse('2026-09-20T10:00:00Z'));
    const updatedAt = require('../src/core/domain/time.js').normalizeTimestamp(extra.updatedAt);
    return restoreDomainSnapshot({ index: { providerId: 'gemini', id: 'c1', title: 'Test convo', titleSource: 'legacy', cloudAvailability: 'unknown', hasTakeoutImport: false,
        ...(createdAt !== undefined ? { createdAt } : {}), ...(updatedAt !== undefined ? { updatedAt } : {}) },
        detail: { quality: { status: 'unknown' }, assets: extra.assets ?? [], messages } });
}

function msg(blocks: any[]) {
    return { id: 'm1', role: 'assistant', content: blocks };
}

const opts = {};

test('getRendererStrings returns zh and en copies', () => {
    const zh = getRendererStrings('zh');
    const en = getRendererStrings('en');
    assert.strictEqual(zh.thinkingSummary, '思考摘要');
    assert.strictEqual(zh.sources, '来源');
    assert.strictEqual(zh.sizeUnknown, '大小未知');
    assert.strictEqual(zh.dateUnknown, '日期未知');
    assert.strictEqual(zh.unsupportedContent, '不支持的内容');
    assert.ok(zh.mathFallback.includes('无法排版'));
    assert.strictEqual(en.thinkingSummary, 'Thinking Summary');
    assert.strictEqual(en.sources, 'Sources');
});

test('typst zh locale localizes chrome copy', () => {
    const blocks = [
        { type: 'unknown', sourceType: 'gemini.mystery', text: 'Mystery content' },
        { type: 'math', source: 'x^2' },
    ];
    const b = domainFixture([{ ...msg(blocks), reasoning: [{ type: 'paragraph', children: [{ type: 'text', text: 'Visible reasoning' }] }] }]);
    const { payload } = renderTypstFixture(composeDomainDocument(b).document, {}, { ...opts, locale: 'zh' });
    const nodes = payload.messages[0].blocks;
    const thought = nodes.find((n: any) => n.type === 'note' && n.label === '思考过程');
    assert.ok(thought, 'thought label localized');
    const unknown = nodes.find((n: any) => n.type === 'unknown');
    assert.ok(unknown.label.startsWith('不支持的内容'));
    const math = nodes.find((n: any) => n.type === 'math');
    assert.ok(math.fallbackLabel.includes('无法排版'));
});

test('typst defaults to en when locale omitted', () => {
    const b = domainFixture([{ ...msg([]), reasoning: [{ type: 'paragraph', children: [{ type: 'text', text: 'Visible reasoning' }] }] }]);
    const { payload } = renderTypstFixture(composeDomainDocument(b).document, {}, opts);
    const thought = payload.messages[0].blocks.find((n: any) => n.type === 'note');
    assert.strictEqual(thought.label, 'Thinking Process');
});

test('typst zh date unknown is localized', () => {
    const b = domainFixture([msg([])]);
    delete b.index.createdAt;
    const { payload } = renderTypstFixture(composeDomainDocument(b).document, {}, { ...opts, locale: 'zh' });
    assert.ok(payload.metadata.includes('日期未知'));
});

test('html uses the same string source', () => {
    const blocks: any[] = [];
    const zh = renderDocumentHtml(composeDomainDocument(domainFixture([{ ...msg(blocks), reasoning: [{ type: 'paragraph', children: [{ type: 'text', text: 'Visible reasoning' }] }] }])).document, {}, { locale: 'zh' });
    assert.ok(zh.html.includes('思考过程'));
    const en = renderDocumentHtml(composeDomainDocument(domainFixture([{ ...msg(blocks), reasoning: [{ type: 'paragraph', children: [{ type: 'text', text: 'Visible reasoning' }] }] }])).document, {}, { locale: 'en' });
    assert.ok(en.html.includes('Thinking Process'));
});

function roleMsg(role: string, extra: any = {}) {
    return { id: `m-${role}`, role, content: [], ...extra };
}

function firstNoteText(message: any) {
    return message.blocks[0].children[0].text;
}

test('role prefix strings live in the string table (en + zh)', () => {
    const en = getRendererStrings('en');
    assert.strictEqual(en.systemMessage, 'System message');
    assert.strictEqual(en.developerMessage, 'Developer message');
    assert.strictEqual(en.unknownRole, 'Unknown role');
    const zh = getRendererStrings('zh');
    assert.strictEqual(zh.systemMessage, '系统消息');
    assert.strictEqual(zh.developerMessage, '开发者消息');
    assert.strictEqual(zh.unknownRole, '未知角色');
});

test('typst localizes role prefix notes', () => {
    const msgs = [
        roleMsg('system'),
        roleMsg('developer'),
        roleMsg('unknown'),
    ];
    const zh = renderTypstFixture(composeDomainDocument(domainFixture(msgs)).document, {}, { ...opts, locale: 'zh' });
    assert.strictEqual(firstNoteText(zh.payload.messages[0]), '系统消息');
    assert.strictEqual(firstNoteText(zh.payload.messages[1]), '开发者消息');
    assert.strictEqual(firstNoteText(zh.payload.messages[2]), '未知角色');
    const en = renderTypstFixture(composeDomainDocument(domainFixture(msgs)).document, {}, opts);
    assert.strictEqual(firstNoteText(en.payload.messages[0]), 'System message');
    assert.strictEqual(firstNoteText(en.payload.messages[1]), 'Developer message');
    assert.strictEqual(firstNoteText(en.payload.messages[2]), 'Unknown role');
});

test('user/assistant roles get no prefix note', () => {
    const { payload } = renderTypstFixture(composeDomainDocument(domainFixture([roleMsg('user'), roleMsg('assistant')])).document, {}, opts);
    assert.strictEqual(payload.messages[0].blocks.length, 0);
    assert.strictEqual(payload.messages[1].blocks.length, 0);
});
