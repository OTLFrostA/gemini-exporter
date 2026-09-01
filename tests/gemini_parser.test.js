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

test('utils - resolveTitle multi-tier source priority arbitration', () => {
    const { resolveTitle, setTitleBySource } = require('../utils.js');

    // 1. Takeout only
    const chatTakeout = {
        id: 'chat_1',
        titles: { takeout: '什么是量子计算？' }
    };
    const res1 = resolveTitle(chatTakeout);
    assert.strictEqual(res1.title, '什么是量子计算？');
    assert.strictEqual(res1.source, 'takeout');

    // 2. Takeout + Sniffed low-tier loading title (e.g. Google Gemini)
    // Low tier should NOT trample Takeout!
    setTitleBySource(chatTakeout, 'sniff', 'Google Gemini');
    const res2 = resolveTitle(chatTakeout);
    assert.strictEqual(res2.title, '什么是量子计算？');
    assert.strictEqual(res2.source, 'takeout');

    // 3. Takeout + DOM Header (DOM should win over Takeout)
    setTitleBySource(chatTakeout, 'dom', '量子计算超导路线详解');
    const res3 = resolveTitle(chatTakeout);
    assert.strictEqual(res3.title, '量子计算超导路线详解');
    assert.strictEqual(res3.source, 'dom');

    // 4. RPC arrives (RPC Tier 1 should win over DOM and Takeout)
    setTitleBySource(chatTakeout, 'rpc', '量子计算与超导量子比特深度解析');
    const res4 = resolveTitle(chatTakeout);
    assert.strictEqual(res4.title, '量子计算与超导量子比特深度解析');
    assert.strictEqual(res4.source, 'rpc');

    // 5. Subsequent sniff should NEVER degrade RPC title
    setTitleBySource(chatTakeout, 'sniff', '辅助嗅探文本');
    const res5 = resolveTitle(chatTakeout);
    assert.strictEqual(res5.title, '量子计算与超导量子比特深度解析');
    assert.strictEqual(res5.source, 'rpc');

    // 6. Legacy fallback
    const legacyChat = { id: 'legacy_1', title: '旧版直接保存的标题' };
    const resLegacy = resolveTitle(legacyChat);
    assert.strictEqual(resLegacy.title, '旧版直接保存的标题');
    assert.strictEqual(resLegacy.source, 'legacy');
});
