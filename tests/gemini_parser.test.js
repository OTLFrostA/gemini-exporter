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

test('gemini_parser - parseDetail with bundled MaZiqc metadata RPC extracts official RPC title', () => {
    const mockDetailInner = [
        [
            [
                ["c_d3226d9a046c1116", "r_turn_1"],
                null,
                [["然后mod要怎么打呢，我下载了一个mod文件，但是https://www.nexusmods.com/slaythespire2/mods/91"]],
                [[["rc_model_1", ["这是Mod安装解答内容"]]]]
            ]
        ],
        null,
        null
    ];
    const mockMetaInner = [
        null,
        null,
        [["c_d3226d9a046c1116", "杀戮尖塔存档删除Mod风险", null, null, null, [1774139824, 809290000], null, null, null, 2]]
    ];

    const topPayload = [
        ["wrb.fr", "hNvQHb", JSON.stringify(mockDetailInner)],
        ["wrb.fr", "MaZiqc", JSON.stringify(mockMetaInner)]
    ];
    const rawText = `)]}'\n\n${JSON.stringify(topPayload)}`;

    const parsed = GeminiResponseParserClass.parseDetail(rawText, 'd3226d9a046c1116');
    assert.strictEqual(parsed.id.replace(/^c_/, ''), 'd3226d9a046c1116');
    assert.strictEqual(parsed.title, '杀戮尖塔存档删除Mod风险');
    assert.strictEqual(parsed.titleSource, 'rpc');
    assert.strictEqual(parsed.titles.rpc, '杀戮尖塔存档删除Mod风险');
    assert.strictEqual(parsed.messages.length, 2);
});

test('gemini_parser - parseDetail with hNvQHb only falls back gracefully', () => {
    const mockDetailInner = [
        [
            [
                ["c_fallback_123", "r_turn_1"],
                null,
                [["如何用Rust写WebAssembly插件"]],
                [[["rc_model_1", ["这是Rust WebAssembly回答"]]]]
            ]
        ],
        null,
        "Rust WebAssembly 开发实战"
    ];

    const topPayload = [
        ["wrb.fr", "hNvQHb", JSON.stringify(mockDetailInner)]
    ];
    const rawText = `)]}'\n\n${JSON.stringify(topPayload)}`;

    const parsed = GeminiResponseParserClass.parseDetail(rawText, 'fallback_123');
    assert.strictEqual(parsed.id.replace(/^c_/, ''), 'fallback_123');
    assert.strictEqual(parsed.title, 'Rust WebAssembly 开发实战');
    assert.strictEqual(parsed.titleSource, 'rpc');
    assert.strictEqual(parsed.messages.length, 2);
});

test('gemini_parser - parseDetail with metadata-only payload returns empty messages and retains raw', () => {
    const mockMetaOnlyInner = [
        null,
        null,
        [["c_meta_only_456", "仅元数据标题", null, null, null, [1774139824, 809290000], null, null, null, 2]]
    ];
    const topPayload = [
        ["wrb.fr", "hNvQHb", JSON.stringify(mockMetaOnlyInner)]
    ];
    const rawText = `)]}'\n\n${JSON.stringify(topPayload)}`;

    const parsed = GeminiResponseParserClass.parseDetail(rawText, 'meta_only_456');
    assert.strictEqual(parsed.id.replace(/^c_/, ''), 'meta_only_456');
    assert.strictEqual(parsed.messages.length, 0);
    assert.ok(parsed._raw);
    assert.strictEqual(parsed._raw[2][0][0], 'c_meta_only_456');
});
