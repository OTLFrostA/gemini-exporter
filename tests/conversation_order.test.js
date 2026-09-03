const test = require('node:test');
const assert = require('node:assert');

// 1. Load GeminiUtils
let GeminiUtils;
try {
    GeminiUtils = require('../src/core/utils/utils.js');
} catch {
    try {
        GeminiUtils = require('./src/core/utils/utils.js');
    } catch {
        GeminiUtils = require('./utils.js');
    }
}

// 2. Load GeminiResponseParser
let GeminiParser;
try {
    GeminiParser = require('../src/core/api/geminiParser.js');
} catch {
    try {
        GeminiParser = require('./src/core/api/geminiParser.js');
    } catch {
        GeminiParser = require('./gemini_parser.js');
    }
}

test('GeminiUtils.getEffectiveTimestamp - hierarchy and type safety', () => {
    assert.strictEqual(typeof GeminiUtils.getEffectiveTimestamp, 'function', 'getEffectiveTimestamp must be exported');

    // Case 1: Empty or null
    assert.strictEqual(GeminiUtils.getEffectiveTimestamp(null), 0);
    assert.strictEqual(GeminiUtils.getEffectiveTimestamp({}), 0);

    // Case 2: Prioritizes updatedAt
    const chat1 = {
        createdAt: 1000,
        timestamp: 2000,
        updatedAt: 3000,
        lastSeen: '2026-09-03T12:00:00.000Z'
    };
    assert.strictEqual(GeminiUtils.getEffectiveTimestamp(chat1), 3000, 'updatedAt should take highest priority');

    // Case 3: Falls back to timestamp if updatedAt missing
    const chat2 = {
        createdAt: 1000,
        timestamp: 2500,
        lastSeen: '2026-09-03T12:00:00.000Z'
    };
    assert.strictEqual(GeminiUtils.getEffectiveTimestamp(chat2), 2500, 'timestamp should be fallback when updatedAt is absent');

    // Case 4: Falls back to createdAt if timestamp & updatedAt missing
    const chat3 = {
        createdAt: 1800
    };
    assert.strictEqual(GeminiUtils.getEffectiveTimestamp(chat3), 1800, 'createdAt fallback');

    // Case 5: Falls back to lastSeen string
    const isoTime = '2026-09-03T18:00:00.000Z';
    const chat4 = {
        lastSeen: isoTime
    };
    assert.strictEqual(GeminiUtils.getEffectiveTimestamp(chat4), new Date(isoTime).getTime());
});

test('GeminiParser.parseDetail - exports updatedAt as maxTs and timestamp as maxTs', () => {
    const ParserClass = GeminiParser.GeminiResponseParserClass || GeminiParser;
    assert.ok(ParserClass, 'GeminiResponseParserClass should be present');

    const mockDetailInner = [
        [
            [
                ["c_test123", "r_turn_1"],
                null,
                [["User message 1"]],
                [[["rc_model_1", ["Model answer 1"]]]],
                [1700000000, 0]
            ],
            [
                ["c_test123", "r_turn_2"],
                null,
                [["User message 2"]],
                [[["rc_model_2", ["Model answer 2"]]]],
                [1700005000, 0]
            ]
        ],
        null,
        "Conversation Title"
    ];
    const topPayload = [
        ["wrb.fr", "hNvQHb", JSON.stringify(mockDetailInner)]
    ];
    const mockEnvelope = `)]}'\n\n${JSON.stringify(topPayload)}`;

    const detail = ParserClass.parseDetail(mockEnvelope, "c_test123");
    assert.ok(detail, 'Detail should be parsed');
    assert.strictEqual(detail.id, 'c_test123');

    // Verify time semantics:
    // createdAt must be minTs (1700000000000)
    // updatedAt must be maxTs (1700005000000)
    // timestamp must be maxTs (1700005000000)
    assert.strictEqual(detail.createdAt, 1700000000000, 'createdAt should be earliest turn timestamp');
    assert.strictEqual(detail.updatedAt, 1700005000000, 'updatedAt should be latest turn timestamp (activity time)');
    assert.strictEqual(detail.timestamp, 1700005000000, 'timestamp should align with updatedAt');
    assert.strictEqual(detail.chatTime, 1700005000000, 'chatTime should align with updatedAt');
});

test('Conversation sorting - accurately orders by latest activity and never puts new chats at tail', () => {
    const getEffectiveTime = GeminiUtils.getEffectiveTimestamp;

    function sortConversations(list) {
        return [...list].sort((a, b) => {
            let valA = getEffectiveTime(a);
            let valB = getEffectiveTime(b);
            if (valA !== valB) return valB - valA;

            let idxA = typeof a.sidebarIndex === 'number' ? a.sidebarIndex : 999999;
            let idxB = typeof b.sidebarIndex === 'number' ? b.sidebarIndex : 999999;
            if (idxA !== idxB) return idxA - idxB;

            let lsA = a.lastSeen ? new Date(a.lastSeen).getTime() : 0;
            let lsB = b.lastSeen ? new Date(b.lastSeen).getTime() : 0;
            return lsB - lsA;
        });
    }

    const now = 1788460500000;

    // Chat A: created 1 year ago (1750000000000), but updated TODAY (1788460500000)
    const chatA = {
        id: 'chat_revived',
        title: 'Revived Chat',
        createdAt: 1750000000000,
        updatedAt: now,
        timestamp: now
    };

    // Chat B: created 1 month ago (1785000000000), updated 1 month ago (1785000000000)
    const chatB = {
        id: 'chat_month_old',
        title: 'Month Old Chat',
        createdAt: 1785000000000,
        updatedAt: 1785000000000,
        timestamp: 1785000000000
    };

    // Chat C: created 3 days ago (1788200000000), updated 3 days ago
    const chatC = {
        id: 'chat_3days_old',
        title: 'Three Days Old Chat',
        createdAt: 1788200000000,
        updatedAt: 1788200000000,
        timestamp: 1788200000000
    };

    // Chat D: Brand new chat captured from DOM on page (has sidebarIndex: 0 and recent lastSeen, no server timestamp yet)
    const chatD = {
        id: 'chat_brand_new_dom',
        title: 'Brand New Chat',
        lastSeen: new Date(now + 1000).toISOString(),
        sidebarIndex: 0
    };

    // Test 1: Revived old chat MUST be ranked above older inactive chats
    const sorted1 = sortConversations([chatB, chatA, chatC]);
    assert.strictEqual(sorted1[0].id, 'chat_revived', 'Revived chat must be at top due to recent updatedAt');
    assert.strictEqual(sorted1[1].id, 'chat_3days_old');
    assert.strictEqual(sorted1[2].id, 'chat_month_old');

    // Test 2: Brand new chat captured from DOM with recent lastSeen MUST NOT be pushed to tail
    const sorted2 = sortConversations([chatB, chatC, chatD]);
    assert.strictEqual(sorted2[0].id, 'chat_brand_new_dom', 'Brand new chat must be ranked at top and never at the tail');
    assert.notStrictEqual(sorted2[sorted2.length - 1].id, 'chat_brand_new_dom', 'Brand new chat must never be at the tail');
});

test('Conversation merge - updates updatedAt when conversation becomes active again', () => {
    // Simulate upsertConversations logic
    function mergeConversations(existing, incoming) {
        const map = new Map();
        existing.forEach(c => map.set(c.id, { ...c }));

        incoming.forEach(c => {
            const old = map.get(c.id);
            let cUpdated = c.updatedAt || c.timestamp || null;
            let oldUpdated = old?.updatedAt || old?.timestamp || null;

            let bestUpdatedAt = oldUpdated;
            if (cUpdated && (!bestUpdatedAt || cUpdated > bestUpdatedAt)) {
                bestUpdatedAt = cUpdated;
            }

            let bestCreatedAt = old?.createdAt || c.createdAt || null;
            if (c.createdAt && old?.createdAt && c.createdAt < old.createdAt) {
                bestCreatedAt = c.createdAt;
            }

            let bestTimestamp = bestUpdatedAt || old?.timestamp || c.timestamp || null;

            map.set(c.id, {
                ...(old || {}),
                ...c,
                timestamp: bestTimestamp,
                updatedAt: bestUpdatedAt || bestTimestamp,
                createdAt: bestCreatedAt
            });
        });

        return Array.from(map.values());
    }

    const initial = [
        { id: 'chat_1', title: 'Old Chat 1', createdAt: 1000, updatedAt: 1000, timestamp: 1000 }
    ];

    // User chats again in chat_1 at time 5000
    const update = [
        { id: 'chat_1', title: 'Old Chat 1', updatedAt: 5000, timestamp: 5000 }
    ];

    const merged = mergeConversations(initial, update);
    assert.strictEqual(merged.length, 1);
    assert.strictEqual(merged[0].updatedAt, 5000, 'updatedAt should be bumped to 5000');
    assert.strictEqual(merged[0].timestamp, 5000, 'timestamp should be updated to 5000');
    assert.strictEqual(merged[0].createdAt, 1000, 'createdAt should remain 1000');
});
