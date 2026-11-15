import { fixtureAccount } from './helpers/domainFixture.js';
const { sourceDetail, sourceMessage } = require('./helpers/l1SourceFixture.js');
const { parseGeminiRpcConversation } = require('../src/l1/parsers/gemini/rpc/parseConversation.js');
const { detailGen: geminiDetailGen } = require('./fixtures/providers/geminiDetail.js') as typeof import('./fixtures/providers/geminiDetail.js');
/**
 * Phase C 规格测试 —— 解析可观测 (P1-8 / P1-9)
 * red-by-design: 修复前失败、修复后通过。
 *
 * 运行：node -r ./tests/ts_register.js --test tests/parse_observability.test.ts
 */
export {};
const test = require('node:test');
const assert = require('node:assert');

const detailDecoder = require('../src/l1/parsers/gemini/rpc/detailDecoder.js');
const attachments = require('../src/l1/parsers/gemini/rpc/sourceAttachments.js');
const pagination = require('../src/l1/client/gemini/api/pagination.js');
const { contentQuality } = require('../src/l1/parsers/qualityEvidence.js');

function modelMessageOf(res: any): any {
    return res.messages.find((m: any) => m.role === "model");
}

test('P1-8a: 漂移夹具产出 turnsRejected=1 且 schemaDrift 非空', () => {
    const res = detailDecoder.decodeGeminiDetail(geminiDetailGen('G_OBSERVABILITY_01'));
    assert.strictEqual(res.turnsRejected, 1, 'junk 元素应被计数为拒识');
    assert.ok(Array.isArray(res.schemaDrift) && res.schemaDrift.length > 0, 'schemaDrift 应非空');
});

test('P1-8b: 正常 payload 无拒识、无漂移', () => {
    const res = detailDecoder.decodeGeminiDetail(geminiDetailGen('G_OBSERVABILITY_02'));
    assert.strictEqual(res.turnsRejected || 0, 0, '正常 turn 不应被拒识');
    assert.ok(!res.schemaDrift || res.schemaDrift.length === 0, '正常 payload 不应有 schemaDrift');
});

test('P1-8c: parser 统一质量状态，拒识内容判 partial', () => {
    const res = detailDecoder.decodeGeminiDetail(geminiDetailGen('G_OBSERVABILITY_03'));
    const result = parseGeminiRpcConversation(geminiDetailGen('G_OBSERVABILITY_04'), { providerId: 'gemini', account: fixtureAccount(), targetConvId: 'abc123def456' });
    const quality = result.conversation.detail.quality;
    assert.strictEqual(result.evidence?.rejectedTurns, 1);
    assert.ok(result.diagnostics.some((d: { code: string }) => d.code === 'GEMINI_TURNS_REJECTED'));
    assert.deepEqual(result.evidence?.heuristicDocumentIds ?? [], []);
    assert.strictEqual(quality.status, 'partial', 'turnsRejected>0 必须标 partial，不能是 ok');
});

test('P1-8d: 无漂移时状态保持 ok；heuristic 文档也判 partial', () => {
    const clean = contentQuality({ status: 'unknown' });
    assert.strictEqual(clean.status, 'unknown');
    const heur = contentQuality({ status: 'unknown', heuristicDocumentIds: ['doc'] });
    assert.strictEqual(heur.status, 'partial', 'heuristic 文档链必须标 partial');
});

test('P1-8e: pagination 跨页合并 turnsRejected 与 schemaDrift（去重）', async () => {
    const pages = [
        sourceDetail({ id: 'source_chat_123', messages: [sourceMessage('new')], schemaDrift: ['drift-a'], turnsRejected: 1, nextPageToken: 'tC_older' }),
        sourceDetail({ id: 'source_chat_123', messages: [sourceMessage('old')], schemaDrift: ['drift-b', 'drift-a'], turnsRejected: 2 }),
    ];
    let calls = 0;
    const client = { fetchConversationPage: async () => pages[calls++] };
    const res = await pagination.getConversationDetail(client, "source_chat_123");
    assert.strictEqual(res.evidence?.rejectedTurns, 3, 'turnsRejected 应跨页累加');
    assert.deepStrictEqual([...new Set(res.diagnostics.filter((d: { code: string }) => d.code === 'GEMINI_SCHEMA_DRIFT').map((d: { message: string }) => d.message))].sort(), ["drift-a", "drift-b"], 'schemaDrift 应跨页合并去重');
});

const UUID = "123e4567-e89b-12d3-a456-426614174099";
function strictDocItem(title = "Adequate Strict Title Here"): unknown[] {
    // DEEP_RESEARCH_DOC: [CHIP_URL:0, ?:1, ID:2, TITLE:3, CONTENT_ID:4, TIMESTAMP:5]
    return [["https://x/immersive_entry_chip/abc"], "filler", UUID, title];
}
function flatDocItem(title = "Adequate Flat Title Here"): unknown[] {
    // 非严格形态：item[0] 不是数组，长度 < 4
    return ["https://y/immersive_entry_chip/def", UUID, title];
}

test('P1-9a: 严格路径命中的文档不标 heuristic', () => {
    const out = attachments.extractDocumentsMeta([strictDocItem()]);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].source, 'strict', '严格身份显式标记，不能使用 heuristic 正文匹配');
    assert.strictEqual(out[0].id, UUID);
});

test('P1-9b: flat 兜底仅在严格路径产出为 0 时执行', () => {
    const out = attachments.extractDocumentsMeta([strictDocItem(), flatDocItem()]);
    assert.strictEqual(out.length, 1, '已有严格结果时 flat 兜底不应再产出');
    assert.strictEqual(out[0].source, 'strict');
});

test('P1-9c: 纯 flat 形态产出标记 source=heuristic-flat', () => {
    const out = attachments.extractDocumentsMeta([flatDocItem()]);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].source, 'heuristic-flat');
});

test('P1-9d: flat 标题至少 8 字符（短标题丢弃）', () => {
    const shortTitle = attachments.extractDocumentsMeta([["https://y/immersive_entry_chip/def", UUID, "shorty"]]);
    assert.strictEqual(shortTitle.length, 0, '6 字符标题不应被 flat 兜底采纳');
    const longTitle = attachments.extractDocumentsMeta([["https://y/immersive_entry_chip/def", UUID, "long enough title here"]]);
    assert.strictEqual(longTitle.length, 1);
    assert.strictEqual(longTitle[0].title, "long enough title here");
});

test('P1-9e: flat.length > 500 直接跳过', () => {
    const big: string[] = ["https://y/immersive_entry_chip/def", UUID, "Adequate Flat Title Here"];
    while (big.length <= 500) big.push("padding-" + big.length);
    const out = attachments.extractDocumentsMeta([big]);
    assert.strictEqual(out.length, 0, '超大 flat 数组应被跳过');
});

test('P1-9e2: strict document time uses canonical finite safe milliseconds', () => {
    const cases: Array<{ wireTime: unknown; expected: number | undefined }> = [
        { wireTime: [1700000000, 500000000], expected: 1700000000000 },
        { wireTime: [1700000000000], expected: 1700000000000 },
        { wireTime: [Number.POSITIVE_INFINITY], expected: undefined },
        { wireTime: [-123], expected: undefined },
        { wireTime: ['1700000000'], expected: undefined },
        { wireTime: [Number.MAX_VALUE], expected: undefined },
    ];
    for (const { wireTime, expected } of cases) {
        const entry = strictDocItem();
        entry[5] = wireTime;
        const result = attachments.extractDocumentsMeta([entry]);
        assert.equal(result.length, 1, 'invalid timestamps must not discard otherwise valid document metadata');
        assert.equal(result[0].createdAt, expected);
    }
});

test('P1-9j: heuristic 链的文档最终标 hasFabricatedText=true', () => {
    const clueText = "## End To End Heuristic Title\n\n" + "正文".repeat(100);
    assert.ok(clueText.length > 200);
    const res = detailDecoder.decodeGeminiDetail(geminiDetailGen('G_OBSERVABILITY_DOC_01'));
    const model = modelMessageOf(res);
    assert.ok(model && model.documents && model.documents.length > 0, '应产出 documents');
    const doc = model.documents[0];
    assert.strictEqual(doc.hasFabricatedText, true, 'heuristic 链文档必须标 hasFabricatedText');
});

test('decodeGeminiDetail: a nearby heading cannot supply a chip document body or title', () => {
    const res = detailDecoder.decodeGeminiDetail(geminiDetailGen('G_OBSERVABILITY_DOC_02'));
    const model = modelMessageOf(res);
    assert.ok(model && model.documents && model.documents.length > 0, '应产出 documents');
    const doc = model.documents[0];
    assert.equal(doc.contentMarkdown, undefined);
    assert.equal(doc.contentMissing, true);
    assert.notEqual(doc.title, '虚构城市水力建模分析', 'unowned prose cannot rename the chip');
});

test('decodeGeminiDetail: a chip URL alone retains an unresolved document without fabricated body', () => {
    const res = detailDecoder.decodeGeminiDetail(geminiDetailGen('G_OBSERVABILITY_DOC_03'));
    const model = modelMessageOf(res);
    assert.ok(model?.documents?.length);
    for (const doc of model.documents) { assert.equal(doc.contentMissing, true); assert.equal(doc.contentMarkdown, undefined); }
});



test('LP-03: Detail decoding leaves unmatched deep research content unattached', () => {
    const model = modelMessageOf(detailDecoder.decodeGeminiDetail(geminiDetailGen('G_OBSERVABILITY_DOC_04')));
    assert.ok(model, 'valid model reply remains present');
    for (const doc of model.documents ?? []) { assert.equal(doc.contentMarkdown, undefined); assert.equal(doc.contentMissing, true); }
});
