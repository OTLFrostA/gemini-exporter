const test = require('node:test');
const assert = require('node:assert');

const { GeminiResponseParserClass, isRealTitle } = require('../src/core/api/geminiParser.js');
const StorageService = require('../src/core/storage/storageService.js');
const TabService = require('../src/core/utils/tabService.js');
const ListView = require('../src/ui/views/listView.js');

test('audit fix: robustFirstPayload preserves , null , and control characters inside user content strings', () => {
    const testContent = "Special test message with , null , in code and [brackets]";
    const turns = [
        [ ["c_testid1234567890ab", "r1"], null, [[testContent]], [[["rc1", [["answer1"]]]]] ]
    ];
    const inner = [turns, null, "Test Title"];
    const top = [["wrb.fr", "hNvQHb", JSON.stringify(inner)]];
    const text = `)]}'\n\n${JSON.stringify(top)}`;
    const parsed = GeminiResponseParserClass.parseDetail(text, "testid1234567890ab");
    assert.ok(parsed, "Detail should be parsed successfully");
    assert.ok(parsed.messages && parsed.messages.length > 0, "Messages should be extracted");
    assert.strictEqual(parsed.messages[0].content, testContent, "Message content should not be altered by regex replacements");
});

test('audit fix: saveExportRecord serializes concurrent writes without losing records', async () => {
    const memoryStorage = {};
    global.chrome = {
        storage: {
            local: {
                get: async (keys) => {
                    const res = {};
                    const keyList = Array.isArray(keys) ? keys : [keys];
                    for (const k of keyList) {
                        if (memoryStorage[k]) res[k] = JSON.parse(JSON.stringify(memoryStorage[k]));
                    }
                    return res;
                },
                set: async (items) => {
                    // Introduce slight async jitter to simulate real storage I/O
                    await new Promise(r => setTimeout(r, Math.random() * 5));
                    for (const [k, v] of Object.entries(items)) {
                        memoryStorage[k] = JSON.parse(JSON.stringify(v));
                    }
                }
            }
        }
    };

    // Perform 10 concurrent writes
    const promises = [];
    for (let i = 1; i <= 10; i++) {
        promises.push(StorageService.saveExportRecord('u0', `chat_${i}`, { title: `Chat ${i}`, exportedAt: new Date().toISOString() }));
    }
    await Promise.all(promises);

    const saved = await StorageService.getExportedIds('u0');
    for (let i = 1; i <= 10; i++) {
        assert.ok(saved[`chat_${i}`], `Record chat_${i} must not be lost due to concurrent read-modify-write`);
    }
});

test('audit fix: isRealTitle fallback filters invalid titles properly', () => {
    assert.strictEqual(isRealTitle('Sign in with Google'), false, 'Sign in should be filtered');
    assert.strictEqual(isRealTitle('未命名对话(3)', 'c_123'), false, 'Numbered untitled should be filtered');
    assert.strictEqual(isRealTitle('搜索'), false, 'Search should be filtered');
    assert.strictEqual(isRealTitle('Valid Chat Title 2026', 'c_123'), true, 'Real title should be accepted');
});

test('audit fix: tabService strictly isolates non-u0 slots without silent cross-slot fallback', async () => {
    global.chrome = {
        tabs: {
            query: async () => [
                { id: 1, url: 'https://gemini.google.com/app/1', active: false },
                { id: 2, url: 'https://gemini.google.com/u/0/app/1', active: true }
            ]
        }
    };

    // Slot u1 has no matching tab
    const tabU1 = await TabService.getGeminiTab('u1');
    assert.strictEqual(tabU1, null, 'getGeminiTab(u1) should return null when no u1 tab is open, avoiding u0 fallback');

    await assert.rejects(
        async () => {
            await TabService.sendToGeminiTab({ action: 'ping' }, 'u1');
        },
        /未找到多账号 slot u1 对应的 Gemini 标签页/,
        'sendToGeminiTab(u1) should reject when no u1 tab exists'
    );
});

test('audit fix: listView escapes URL properly to prevent attribute injection', () => {
    const mockList = { innerHTML: '', addEventListener: () => {} };
    global.document = {
        getElementById: (id) => id === 'list' ? mockList : null
    };
    ListView.render([
        {
            id: 'test_xss',
            title: 'Test XSS Chat',
            url: 'https://gemini.google.com/app/test" onclick="alert(1)'
        }
    ], {}, new Set());

    assert.ok(mockList.innerHTML.includes('&quot; onclick=&quot;alert(1)'), 'Double quotes in URL must be escaped');
    assert.ok(!mockList.innerHTML.includes('href="https://gemini.google.com/app/test" onclick="alert(1)"'), 'Raw double quote breakout must be prevented');
});
