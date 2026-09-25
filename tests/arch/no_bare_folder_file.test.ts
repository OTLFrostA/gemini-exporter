// tests/arch/no_bare_folder_file.test.ts
// Phase G (G1) 门禁：全仓禁止在 `src/core/storage/` 目录边界之外直接调用 `chrome.storage.local.set(`。
// 所有 storage 写入必须收口在 `src/core/storage/` 内的受控存储模块中执行，彻底告别脆弱的硬编码行号白名单。
export {};
const test = require('node:test');
const assert = require('node:assert');
const { execSync } = require('node:child_process');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STORAGE_DIR_PREFIX = 'src/core/storage/';

// 仅允许 src/core/storage/ 下的受控存储模块调用 chrome.storage.local.set(
const ALLOWED_STORAGE_FILES = new Set<string>([
    'src/core/storage/storageService.ts',
    'src/core/storage/userPreferences.ts',
    'src/core/storage/sessionStore.ts',
    'src/core/storage/formatStore.ts',
    'src/core/storage/liveStorageManager.ts',
    'src/core/storage/schemaMigration.ts',
]);

function gitGrepFixed(pattern: string): Array<{ file: string; line: number; text: string }> {
    let out = '';
    try {
        out = execSync(`git -C "${REPO_ROOT}" grep -n -F -- "${pattern}" -- "*.ts"`, { encoding: 'utf8' });
    } catch (e: any) {
        if (e && e.status === 1) return [];
        throw e;
    }
    return out.trim().split('\n').filter(Boolean).map((l: string) => {
        const m = l.match(/^([^:]+):(\d+):(.*)$/);
        return { file: m![1], line: Number(m![2]), text: m![3] };
    }).filter(h => !h.file.startsWith('tests/'));
}

/** 去掉行内 `//` 注释后是否仍含 pattern（注释里提及的不算违规）。 */
function isRealCodeCall(text: string, pattern: string): boolean {
    const code = text.replace(/\/\/.*$/, '');
    return code.includes(pattern);
}

test('arch: no bare chrome.storage.local.set( outside src/core/storage/ boundary', () => {
    const hits = gitGrepFixed('chrome.storage.local.set(')
        .filter(h => isRealCodeCall(h.text, 'chrome.storage.local.set('));

    const outsideStorageDir = hits.filter(h => !h.file.startsWith(STORAGE_DIR_PREFIX));
    assert.strictEqual(
        outsideStorageDir.length, 0,
        `严禁在 ${STORAGE_DIR_PREFIX} 目录外直接调用 chrome.storage.local.set(，必须通过 StorageService 或存储模块收口：\n` +
        outsideStorageDir.map(h => `  ${h.file}:${h.line}: ${h.text.trim()}`).join('\n')
    );

    const unauthorizedStorageFiles = hits.filter(h => !ALLOWED_STORAGE_FILES.has(h.file));
    assert.strictEqual(
        unauthorizedStorageFiles.length, 0,
        `${STORAGE_DIR_PREFIX} 下出现未登记的新增直写模块，请走现有 StorageService 或显式纳入 ALLOWED_STORAGE_FILES：\n` +
        unauthorizedStorageFiles.map(h => `  ${h.file}:${h.line}: ${h.text.trim()}`).join('\n')
    );
});
