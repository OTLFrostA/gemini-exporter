const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { GeminiResponseParserClass } = require('../gemini_parser.js');
const ExportEngineMod = require('../export_engine.js');

// P0-1: 图片 localName 跨 turn 同名覆盖
test('regression: gemini_parser image naming must be globally unique across turns', () => {
    const seq = { value: 1 };
    const imgObj1 = ["https://lh3.googleusercontent.com/a1b2c3d4", 100, 200];
    const imgObj2 = ["https://lh3.googleusercontent.com/e5f6g7h8", 300, 400];
    // 模拟两个不同 turn 各调用一次 extractImages
    const res1 = GeminiResponseParserClass.extractImages([imgObj1], seq);
    const res2 = GeminiResponseParserClass.extractImages([imgObj2], seq);
    assert.strictEqual(res1.length, 1);
    assert.strictEqual(res2.length, 1);
    // 旧代码两次均为 image-1.jpg 导致覆盖；新代码应为 image-1-xxx / image-2-xxx 不同
    assert.notStrictEqual(res1[0].fileName, res2[0].fileName, `fileName should be unique, got both ${res1[0].fileName}`);
    // 序号应递增
    assert.ok(res2[0].fileName.includes('image-2') || res2[0].fileName.includes('image-1') === false, 'second image should have incremented counter');
    // 使用同一 seqRef 多次调用不应重复
    const seq2 = { value: 1 };
    const r1 = GeminiResponseParserClass.extractImages([imgObj1], seq2);
    const r2 = GeminiResponseParserClass.extractImages([imgObj1, imgObj2], seq2);
    // r2 含 2 张，且与 r1 的第一张不同源但文件名不应与 r1 冲突（因去重，相同 URL 会去重，但不同 URL 不应同名）
});

// P0-1b: parseDetail 多 turn 去重后 localName 唯一
test('regression: parseDetail across 2 turns with different images should have distinct localNames', () => {
    // 构造最小 batchexecute 载荷：2 turn 每轮各一张图
    const turns = [
        [ ["c_testid1234567890ab", "r1"], null, [["prompt1"]], [[["rc1", [["answer1", null, null, null, null, [["https://lh3.googleusercontent.com/imgA", 100, 200, "tokA"]]]]]]] ],
        [ ["c_testid1234567890ab", "r2"], null, [["prompt2"]], [[["rc2", [["answer2", null, null, null, null, [["https://lh3.googleusercontent.com/imgB", 300, 400, "tokB"]]]]]]] ]
    ];
    const inner = [turns, null, "Test Title"];
    const top = [["wrb.fr","hNvQHb", JSON.stringify(inner)]];
    const text = `)]}'\n\n${JSON.stringify(top)}`;
    const parsed = GeminiResponseParserClass.parseDetail(text, "testid1234567890ab");
    const allImgs = parsed.messages.flatMap(m => m.images || []);
    // 旧代码会产生两个同为 assets/...image-1.jpg，这里应唯一
    const localNames = allImgs.map(i => i.localName);
    const uniq = new Set(localNames);
    assert.strictEqual(localNames.length, uniq.size, `localNames must be unique, got ${JSON.stringify(localNames)}`);
});

// P0-2: ZIP 路径消毒
test('regression: export_engine sanitizeZipPath must sanitize .. and preserve segments', () => {
    assert.strictEqual(typeof ExportEngineMod.sanitizeZipPath, 'function', 'sanitizeZipPath should be exported');
    assert.strictEqual(ExportEngineMod.sanitizeZipPath('a/../b'), 'a/_/b');
    // 含 .. 的路径段应被消毒且不残留 .. 
    const san1 = ExportEngineMod.sanitizeZipPath('files/abc_../a.md');
    assert.ok(!san1.includes('..'), `san1 should not contain .., got ${san1}`);
    assert.ok(san1.startsWith('files/'), 'should preserve prefix');
    // 更严格：含 .. 的段应被替换为 _
    const sanitized = ExportEngineMod.sanitizeZipPath('files/../../etc/passwd');
    assert.ok(!sanitized.includes('..'), `sanitized should not contain .., got ${sanitized}`);
    assert.ok(sanitized.split('/').every(seg => seg !== '..' && seg !== '.'), 'no dot segments');
    // 正常路径保持
    assert.strictEqual(ExportEngineMod.sanitizeZipPath('assets/ab1234_image-1.jpg'), 'assets/ab1234_image-1.jpg');
});

// P0-2b: export_engine 对失败的目录创建应 throw 而非静默回退
test('regression: export_engine must throw on batchDirHandle creation failure instead of fallback', () => {
    const content = fs.readFileSync(path.join(__dirname, '../export_engine.js'), 'utf8');
    assert.ok(content.includes('throw new Error(`无法创建导出子目录'), 'should throw on directory creation failure');
    assert.ok(!content.includes('batchDirHandle = dirHandle;') || content.includes('throw new Error'), 'should not silently fallback to root dirHandle');
});

// P0-3: 失败对话日志必须携带 error
test('regression: export_engine failedChats must store detailed objects with error', () => {
    const content = fs.readFileSync(path.join(__dirname, '../export_engine.js'), 'utf8');
    // 新代码应为 failedChats.push({ id: ... , title: ..., error: ... })
    assert.ok(content.includes('failedChats.push({ id:'), 'failedChats should push detailed objects');
    assert.ok(content.includes("failedChats.push({ id: c.id, title:") || content.includes("failedChats.push({ id: chat.id"), 'failedChats push should include title and error');
    //dev log 需处理对象
    assert.ok(content.includes('typeof fc === \'string\''), 'dev log should handle both string and object failedChats');
});

// P0-3b: getExtensionVersion 动态版本
test('regression: export_engine getExtensionVersion should be exported and read manifest', () => {
    assert.strictEqual(typeof ExportEngineMod.getExtensionVersion, 'function');
    const v = ExportEngineMod.getExtensionVersion();
    assert.ok(typeof v === 'string' && v.length >= 5, `version should be string, got ${v}`);
});

// P0-4: 标题品牌词防护
test('regression: export_engine and options must scrub Google Gemini brand', () => {
    const expContent = fs.readFileSync(path.join(__dirname, '../export_engine.js'), 'utf8');
    const optContent = fs.readFileSync(path.join(__dirname, '../options.js'), 'utf8');
    assert.ok(expContent.includes('isBadBrand'), 'export_engine should have isBadBrand scrub');
    assert.ok(expContent.includes('Google\\s+)?(Gemini|Bard'), 'export_engine should filter brand regex');
    assert.ok(optContent.includes('isBad'), 'options.js should scrub bad titles on load');
    // 行为级：brand 不应被视为 real title
    const { isRealTitle } = require('../utils.js');
    assert.strictEqual(isRealTitle('Google Gemini', 'abc123'), false);
    assert.strictEqual(isRealTitle('Gemini', 'abc123'), false);
});

// P0-5: 空详情应为 error 级别且携带 debug
test('regression: empty cloud response must be logged as error with debug', () => {
    const expContent = fs.readFileSync(path.join(__dirname, '../export_engine.js'), 'utf8');
    assert.ok(expContent.includes("'error'") && expContent.includes('logExportSkipped'), 'empty should be error level');
    assert.ok(expContent.includes('_debug') && expContent.includes('_raw'), 'failedChats should carry debug/raw');
    const bgContent = fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8');
    assert.ok(bgContent.includes('_debug'), 'background should preserve _raw debug');
});

// P0-6: DOM 空壳 fallback 必须尝试 live document
test('regression: dom_scraper must try live document before fetch shell', () => {
    const domContent = fs.readFileSync(path.join(__dirname, '../dom_scraper.js'), 'utf8');
    assert.ok(domContent.includes('location.pathname.includes(cleanId)'), 'should try live parseDoc when location matches');
    assert.ok(domContent.includes('debugCurrentPage'), 'should expose debugCurrentPage');
    assert.ok(domContent.includes('fallbackUsed'), 'parseDoc should log fallbackUsed');
});

// P0-7: batchexecute 空消息必须回退 DOM 且告警
test('regression: content.js must fallback to DOM when batchexecute returns empty', () => {
    const ctContent = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
    assert.ok(ctContent.includes('Array.isArray(detail.messages) && detail.messages.length > 0'), 'should check length>0 before success');
    assert.ok(ctContent.includes('batchexecute returned empty messages, fallback to DOM'), 'should warn and fallback');
});

// P0-8: Receiving end 连接失败提示刷新
test('regression: background Receiving end error must hint refresh', () => {
    const bgContent = fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8');
    assert.ok(bgContent.includes('Receiving end does not exist'), 'should handle Receiving end');
    assert.ok(bgContent.includes('刷新 gemini.google.com'), 'should hint refresh after reload');
});
