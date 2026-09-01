const test = require('node:test');
const assert = require('node:assert');
const { GeminiResponseParserClass, isRealTitle } = require('../gemini_parser.js');
const { isRealTitle: utilsIsRealTitle, cleanTitle } = require('../utils.js');

test('gemini_parser - isRealTitle', () => {
    assert.strictEqual(isRealTitle(''), false);
    assert.strictEqual(isRealTitle('Untitled'), false);
    assert.strictEqual(isRealTitle('未命名'), false);
    assert.strictEqual(isRealTitle('New chat'), false);
    assert.strictEqual(isRealTitle('Gemini'), false);
    assert.strictEqual(isRealTitle('Google Gemini'), false);
    assert.strictEqual(isRealTitle('Google Bard'), false);
    assert.strictEqual(isRealTitle('Google AI'), false);
    assert.strictEqual(isRealTitle('39d5b41870e49a67'), false);
    assert.strictEqual(isRealTitle('c_39d5b41870e49a67'), false);
    assert.strictEqual(isRealTitle('我拟定了一个研究方案'), false);
    assert.strictEqual(isRealTitle('量子计算的基本原理'), true);
    assert.strictEqual(isRealTitle('AI Prompt Engineering Guide'), true);
});

test('utils - cleanTitle brand suffix and prefix stripping', () => {
    assert.strictEqual(cleanTitle('Google Gemini'), '');
    assert.strictEqual(cleanTitle('Gemini'), '');
    assert.strictEqual(cleanTitle('Google Bard'), '');
    assert.strictEqual(cleanTitle('Google AI'), '');
    assert.strictEqual(cleanTitle('量子计算的基本原理 - Google Gemini'), '量子计算的基本原理');
    assert.strictEqual(cleanTitle('深度学习架构 - Gemini'), '深度学习架构');
    assert.strictEqual(cleanTitle('Python 性能优化 | Google Gemini'), 'Python 性能优化');
    assert.strictEqual(cleanTitle('Gemini - 机器学习实战'), '机器学习实战');
    assert.strictEqual(cleanTitle('Google Gemini - 分布式系统设计'), '分布式系统设计');
    assert.strictEqual(cleanTitle('AI 提示词工程 · Gemini'), 'AI 提示词工程');
    assert.strictEqual(cleanTitle('纯净标题没有后缀'), '纯净标题没有后缀');
});

test('gemini_parser - highResVariant', () => {
    const orig = 'https://lh3.googleusercontent.com/abc=s256';
    const high = GeminiResponseParserClass.highResVariant(orig);
    assert.strictEqual(high, 'https://lh3.googleusercontent.com/abc=s0');

    // Never mutate Google Places / Maps photo CDN signatures
    const places = 'https://lh3.googleusercontent.com/places/v1/media/xyz';
    assert.strictEqual(GeminiResponseParserClass.highResVariant(places), places);
});

test('gemini_parser - parseList with valid batchexecute RPC text', () => {
    const inner = JSON.stringify([null, [["c_1234567890abcdef","Test Title",[1700000000,0],[1700000000,0],5]], "tC_token123"]);
    const outer = JSON.stringify([["wrb.fr","MaZiqc",inner]]);
    const mockRpc = `)]}'\n\n${outer}`;
    const res = GeminiResponseParserClass.parseList(mockRpc);
    assert.strictEqual(res.conversations.length, 1);
    assert.strictEqual(res.conversations[0].id, '1234567890abcdef');
    assert.strictEqual(res.conversations[0].title, 'Test Title');
    assert.strictEqual(res.nextPageToken, 'tC_token123');
});
