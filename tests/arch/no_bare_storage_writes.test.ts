// tests/arch/no_bare_storage_writes.test.ts
// Chrome writes belong only to the Settings IO adapter and the one-time Migration markers.
export {};
const test = require('node:test');
const assert = require('node:assert');
const { execSync } = require('node:child_process');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Explicit owners: Settings data and the final Migration completion markers.
const ALLOWED_STORAGE_FILES = new Set<string>([
    'src/l3a/settingsStore.ts',
    'src/migration/upgradeV1.ts',
    'src/migration/releasedV17.ts',
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

function isRealCodeCall(text: string, pattern: string): boolean {
    const code = text.replace(/\/\/.*$/, '');
    return code.includes(pattern);
}

test('arch: Chrome writes stay within Settings IO and the Migration marker owner', () => {
    const hits = gitGrepFixed('chrome.storage.local.set(')
        .filter(h => isRealCodeCall(h.text, 'chrome.storage.local.set('));
    const unauthorized = hits.filter(h => !ALLOWED_STORAGE_FILES.has(h.file));
    assert.strictEqual(unauthorized.length, 0,
        'Unowned Chrome storage write:\n' + unauthorized.map(h => `  ${h.file}:${h.line}: ${h.text.trim()}`).join('\n'));
    const migration = require('node:fs').readFileSync(path.join(REPO_ROOT, 'src/migration/upgradeV1.ts'), 'utf8');
    assert.deepStrictEqual([...migration.matchAll(/chrome\.storage\.local\.set\(([^;]+)\);/g)].map(match => match[1]), ['{ [INITIALIZED]: true }']);
    const released = require('node:fs').readFileSync(path.join(REPO_ROOT, 'src/migration/releasedV17.ts'), 'utf8');
    assert.deepStrictEqual([...released.matchAll(/chrome\.storage\.local\.set\(([^;]+)\);/g)].map(match => match[1]), ['{ gemini_exporter_v17_migrated: true }']);
});
