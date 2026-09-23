// tests/arch/no_bare_folder_file.test.ts
// Phase G (G1) 门禁：全仓禁止裸 `chrome.storage.local.set(` 直接调用。
// storage 写入必须经过串行化 choke 点；现状 28 处命中全部登记在 ALLOWLIST，
// 新增裸调用（或 allowlist 行号漂移）即红。更新 allowlist 时必须同步给出串行化理由。
export {};
const test = require('node:test');
const assert = require('node:assert');
const { execSync } = require('node:child_process');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

// file:line -> 串行化/无竞争理由（行号随文件编辑漂移，漂移后按报错更新本表）
const ALLOWLIST: Record<string, string> = {
    // --- storageService.ts：全部命中均在 withConversationLock / enqueueSaveRecordChain 回调内执行 ---
    'src/core/storage/storageService.ts:218': 'withConversationLock 内（_setConversationsRaw）',
    'src/core/storage/storageService.ts:292': 'withConversationLock 内（removeConversation）',
    'src/core/storage/storageService.ts:337': 'withConversationLock 内（reconcileConversations）',
    'src/core/storage/storageService.ts:381': '锁内（setExportedIds）',
    'src/core/storage/storageService.ts:464': 'enqueueSaveRecordChain 内（saveExportRecordsBatch）',
    'src/core/storage/storageService.ts:526': 'enqueueSaveRecordChain 内（removeExportRecords）',
    'src/core/storage/storageService.ts:549': 'withConversationLock 内（setLastSync）',
    'src/core/storage/storageService.ts:569': 'withConversationLock 内（setScanCheckpoint）',
    'src/core/storage/storageService.ts:580': 'withSlotLock 内（setAccountSlots）',
    'src/core/storage/storageService.ts:656': '单键盲写（setDevMode），无 read-modify-write',
    'src/core/storage/storageService.ts:672': '单键盲写（setTourCompleted），无 read-modify-write',
    'src/core/storage/storageService.ts:698': '单键盲写（setLastSeenFeatureVersion），无 read-modify-write',
    'src/core/storage/storageService.ts:715': '单键盲写（setTakeoutPromptCompleted），无 read-modify-write',
    'src/core/storage/storageService.ts:722': '单键盲写（setHasImportedTakeout），无 read-modify-write',
    // --- sessionStore.ts ---
    'src/core/storage/sessionStore.ts:72': 'setSession 是无读盲写（整包替换），无竞争',
    'src/core/storage/sessionStore.ts:96': 'updateSession 读-改-写已用 navigator.locks 包住（P2-11）',
    // --- 单键盲写，无 read-modify-write，不存在跨 tab 竞争 ---
    'src/content/badgeView.ts:93': '单键盲写（徽标拖拽位置）',
    'src/content/syncEngine.ts:677': '单键盲写（sync diagnostics 落盘）',
    'src/content/syncEngine.ts:708': '单键盲写（takeout prompt 标记）',
    'src/core/storage/formatStore.ts:67': '单键盲写（FORMAT）',
    'src/core/storage/formatStore.ts:81': '单键盲写（FORMAT）',
    'src/core/storage/liveStorageManager.ts:49': '单键盲写（live config）',
    'src/core/storage/schemaMigration.ts:198': '启动时单次 schema 版本迁移，无并发',
    'src/core/utils/i18n.ts:54': '单键盲写（语言设置）',
    'src/ui/options/modules/optionsExport.ts:426': 'UI 事件单键盲写',
    'src/ui/options/modules/optionsExport.ts:485': 'UI 事件单键盲写',
    'src/ui/options/modules/optionsExport.ts:563': 'UI 事件单键盲写',
};

function gitGrepFixed(pattern: string): Array<{ file: string; line: number }> {
    let out = '';
    try {
        out = execSync(`git -C "${REPO_ROOT}" grep -n -F -- "${pattern}" -- "*.ts"`, { encoding: 'utf8' });
    } catch (e: any) {
        if (e && e.status === 1) return [];
        throw e;
    }
    return out.trim().split('\n').filter(Boolean).map((l: string) => {
        const m = l.match(/^([^:]+):(\d+):/);
        return { file: m![1], line: Number(m![2]) };
    }).filter(h => !h.file.startsWith('tests/'));
}

test('arch: no bare chrome.storage.local.set( outside allowlist', () => {
    const hits = gitGrepFixed('chrome.storage.local.set(');
    const keys = new Set(hits.map(h => `${h.file}:${h.line}`));
    const allowed = new Set(Object.keys(ALLOWLIST));

    const unexpected = [...keys].filter(k => !allowed.has(k));
    assert.strictEqual(
        unexpected.length, 0,
        `新增裸 chrome.storage.local.set 调用，必须走锁/串行化 choke 点：\n` +
        unexpected.map(k => `  ${k}`).join('\n') +
        `\n确认为合法后，把 "文件:行号" 登记进本文件的 ALLOWLIST 并写明理由。`
    );

    const stale = [...allowed].filter(k => !keys.has(k));
    assert.strictEqual(
        stale.length, 0,
        `ALLOWLIST 行号已漂移（文件被编辑），请按当前命中更新本文件：\n` +
        stale.map(k => `  ${k}（原理由：${ALLOWLIST[k]}）`).join('\n')
    );
});
