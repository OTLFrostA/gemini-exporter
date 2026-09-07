const test = require('node:test');
const assert = require('node:assert');

// ============================================================
// Bug vs Issue 分类说明（映射到之前架构审查）
// ============================================================
// Bug = 会导致崩溃/数据损坏/安全绕过，可通过测试稳定复现
// Issue = 设计债/性能/可维护性，不会直接崩溃
//
// 本文件只覆盖 Bug 类；Issue 类见下方注释汇总

// ------------------------------------------------------------
// Bug 1: takeoutEngine.js:464 - 全局 vs 局部缓存错写
// 现象：同ID多block解析时，若第一块标题为占位符(Takeout conversation)
// 且第二块为非显式 Prompt（hasExplicitPrompt=false），localConvCache
// 应被更新但代码误写 __takeoutConvCache（全局旧值），导致离线缓存标题不更新。
// ------------------------------------------------------------
test('Bug repro - takeout title stale when second block is non-explicit prompt', async () => {
    const TakeoutEngine = require('../src/core/engine/takeoutEngine.js');
    global.JSZip = require('../lib/jszip.min.js');
    const zip = new global.JSZip();

    // Block1: 无Prompted标记 -> hasExplicitPrompt=false, title=Takeout conversation
    // Block2: 同ID, 也无Prompted标记但 content-cell含 "Corrected Title"
    const html = `
    <html><body>
      <div class="outer-cell">
        <a href="https://gemini.google.com/app/BUG_REPRO_001">Link1</a>
        <div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Takeout conversation<br><p>model response 1</p></div>
      </div>
      <div class="outer-cell">
        <a href="https://gemini.google.com/app/BUG_REPRO_001">Link2</a>
        <div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Corrected Title<br><p>model response 2</p></div>
      </div>
    </body></html>
    `;
    zip.file('Takeout/Gemini/MyActivity.html', html);
    const buf = await zip.generateAsync({ type: 'nodebuffer' });

    TakeoutEngine.clearTakeoutData();
    const res = await TakeoutEngine.parseTakeoutZip(buf);
    assert.strictEqual(res.conversations.length, 1, 'should merge to 1 conversation');
    // extractedMap 正确更新为 Corrected Title（走 shouldUpdate 分支）
    assert.strictEqual(res.conversations[0].title, 'Corrected Title', 'extractedMap title should be corrected');
    // 但 offlineCache 仍为旧值 => Bug
    const offline = TakeoutEngine.getTakeoutOfflineChat('BUG_REPRO_001');
    assert.ok(offline, 'offline chat should exist');
    // 此断言在修复前会失败（offline.title 仍为 Takeout conversation / Placeholder）
    assert.strictEqual(offline.title, 'Corrected Title', 'offlineCache title should be sync to Corrected Title (BUG: currently stale)');
    assert.strictEqual(offline.titles.takeout, 'Corrected Title', 'offlineCache titles.takeout should be sync');
});

// ------------------------------------------------------------
// Bug 2: content.js:638 - GEMINI_NETWORK_BATCHEXECUTE 丢弃 slot
// 现象：hookCredentials.js 已按 /u/1/ 推断 slot=u1 并 postMessage，
// 但 content.js 监听端解构后未将 slot 传给 upsertConversations，
// 导致 u1 会话被写入当前页面所属 slot（默认 u0），跨账号污染。
// ------------------------------------------------------------
test('Bug repro - network batchexecute slot isolation dropped', async () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const contentPath = path.resolve(__dirname, '../src/content/content.js');
    const code = fs.readFileSync(contentPath, 'utf8');

    // 检查 content.js 是否在处理 GEMINI_NETWORK_BATCHEXECUTE 时使用 slot 变量
    // 正确的应为: const { text, slot } = d.payload; ... upsertConversations(..., slot) 或按slot隔离
    // 当前错误实现：仅 const { text, slot } = ... 但后续 upsertConversations(list, 'network-list') 未传 slot

    // 1. 必须解构 slot
    assert.ok(code.includes('const { text, slot }'), 'should destructure slot from payload');

    // 2. 关键：upsertConversations 调用必须携带 slot 或 getAccountSlot 隔离
    // 统计 network-list 分支的调用
    const networkListCalls = [...code.matchAll(/upsertConversations\s*\(\s*listRes\.conversations\s*,\s*['"]network-list['"]/g)];
    assert.ok(networkListCalls.length >= 1, 'should have upsertConversations for network-list');

    // 检查这些调用附近是否包含 slot 参数或 Storage slot 隔离
    // 若代码为 upsertConversations(listRes.conversations, 'network-list') 且无 slot，则为Bug
    const hasSlotAware = code.includes("upsertConversations(listRes.conversations, 'network-list',") ||
                         code.includes('upsertConversations(listRes.conversations, "network-list",') ||
                         /getAccountSlot\s*\(\s*\)\s*!==?\s*slot/.test(code) ||
                         /Storage\.setConversations\s*\(\s*slot/.test(code);

    // 此断言在修复前会失败：证明 slot 被丢弃
    // 修复后应改为 upsertConversations(..., 'network-list', true) 前按 slot 切换或显式传 slot
    // 这里的测试强制要求至少有一个 slot 感知逻辑
    // 当前代码无 slot 感知，测试将失败以暴露 Bug
    const lines = code.split('\n');
    let bugLine = null;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes("upsertConversations(listRes.conversations, 'network-list')") ||
            lines[i].includes('upsertConversations(listRes.conversations, "network-list")')) {
            // 检查前后5行是否有 slot 使用
            const ctx = lines.slice(Math.max(0,i-5), i+6).join('\n');
            if (!ctx.includes('slot')) {
                bugLine = lines[i].trim();
                break;
            }
        }
    }
    // 若找到未使用 slot 的调用，则判定 Bug 存在，测试失败
    assert.strictEqual(bugLine, null, `Bug: network-list upsert ignores slot, found: "${bugLine}" (会导致u1数据写入u0)`);
});

// ------------------------------------------------------------
// Bug 3: exportEngine.js - 附件失败时 pendingAssetsPerChat 泄漏
// 现象：文件/图片附件下载失败分支未对 pendingAssetsPerChat 递减，
// 导致 pending 计数永不归零，finalizeChatExport 永不触发，
// 导出会话的 exportedIds 永不落盘，表现为“导出成功但历史仍显示未导出”。
// ------------------------------------------------------------
test('Bug repro - pendingAssets leak on asset failure blocks finalize', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const code = fs.readFileSync(path.resolve(__dirname, '../src/core/engine/exportEngine.js'), 'utf8');

    // 定位两类附件处理：成功时递减，失败时应同样递减
    // 成功路径有： const left = (pendingAssetsPerChat.get(nid) || 1) - 1;
    // 失败路径当前仅有 chatFailedAssetsSet.add(nid) 而无递减

    // 统计失败分支中是否包含递减
    // 匹配模式： chatFailedAssetsSet.add(nid); 之后附近是否有 pendingAssetsPerChat.set
    const failureBlocks = [...code.matchAll(/chatFailedAssetsSet\.add\(nid\)[\s\S]{0,300}pendingAssetsPerChat/g)];
    // 当前失败分支不应有递减 -> 0 匹配即暴露 Bug
    // 修复后失败分支也应递减并在 left===0 时尝试 finalize（但被 chatFailedAssetsSet 阻断）
    // 此处测试要求失败分支也递减，否则 pending 泄漏
    assert.ok(failureBlocks.length >= 1, 'failure branch should also decrement pendingAssetsPerChat, but currently does not (pending leak)');
});

// ------------------------------------------------------------
// Issue 汇总（不会直接崩溃，但需重构）- 仅文档，不生成崩溃测试
// ------------------------------------------------------------
// Issue 1: exportEngine.js:118 上帝类 1000+行，未拆 Fetch/Asset/Index 三阶段，CONCURRENCY nextIndex++ 单线程下安全但语义脆弱
// Issue 2: content.js:1 977行上帝，badge/sync/hook 全耦合，无模块化
// Issue 3: assetFetcher.js:31 FileReader base64 2倍内存，无 WritableStream 流式，MAX 50M 直接跳过
// Issue 4: 全仓 UMD IIFE + manifest 顺序耦合，无 ES Module/Vite/TS
// Issue 5: storageService 全量拉取 2000条，未分片压缩，近5M配额风险
// Issue 6: background fetchBatch 逐条串行，无并发与429退避
// Issue 7: geminiClient BL 硬编码 boq_assistant-20260802，仅靠400后刷新，无定时轮询
