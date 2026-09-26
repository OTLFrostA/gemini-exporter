// tests/arch/no_stub_pdf_in_production.test.ts
// §15 release gate (mechanical defense): the P3 StubPdfCompiler must never
// leak into the production path silently.
//  (a) `new StubPdfCompiler(` in non-test src/ is only allowed in
//      src/core/export/pdf/pdfCompiler.ts (its own definition file) and in
//      the explicit opt-in branch of src/core/export/pdf/pdfExporter.ts.
//  (b) `new PdfExporter(` in non-test src/ must always carry arguments
//      (a compiler and/or the allowStub opt-in) — bare calls that silently
//      default to the stub are forbidden.
//  (c) the `STUB_COMPILER_PLACEHOLDER` marker string only lives in
//      pdfCompiler.ts and in tests.
export {};
const test = require('node:test');
const assert = require('node:assert');
const { execSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

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

function isRealCode(text: string): boolean {
    return !text.trim().startsWith('//') && !text.trim().startsWith('*');
}

test('arch: §15 — new StubPdfCompiler( confined to pdfCompiler.ts and the pdfExporter opt-in branch', () => {
    const hits = gitGrepFixed('new StubPdfCompiler(').filter(h => isRealCode(h.text));
    const allowedFiles = new Set<string>([
        'src/core/export/pdf/pdfCompiler.ts', // definition file
        'src/core/export/pdf/pdfExporter.ts', // explicit opt-in branch only
    ]);
    const outside = hits.filter(h => !allowedFiles.has(h.file));
    assert.strictEqual(
        outside.length, 0,
        `§15: 生产代码里出现未登记的 new StubPdfCompiler(，stub 只能出现在 pdfCompiler.ts 定义处或 pdfExporter.ts 的显式 opt-in 分支：\n` +
        outside.map(h => `  ${h.file}:${h.line}: ${h.text.trim()}`).join('\n')
    );
    // The pdfExporter.ts hit must be the opt-in branch: the file must wire
    // _allowStub through the constructor for the gate to be meaningful.
    const exporterHit = hits.filter(h => h.file === 'src/core/export/pdf/pdfExporter.ts');
    if (exporterHit.length > 0) {
        const src = fs.readFileSync(path.join(REPO_ROOT, 'src/core/export/pdf/pdfExporter.ts'), 'utf8');
        assert.ok(
            src.includes('allowStub'),
            '§15: pdfExporter.ts 引用了 new StubPdfCompiler( 却没有 allowStub 显式 opt-in 接线，防线已失效'
        );
    }
});

test('arch: §15 — new PdfExporter( in src/ must carry arguments, bare calls forbidden', () => {
    const hits = gitGrepFixed('new PdfExporter(').filter(h => isRealCode(h.text));
    const bare: string[] = [];
    for (const h of hits) {
        const code = h.text.replace(/\/\/.*$/, '');
        const idx = code.indexOf('new PdfExporter(');
        if (idx === -1) continue;
        const rest = code.slice(idx + 'new PdfExporter('.length);
        if (/^\s*\)/.test(rest)) {
            bare.push(`${h.file}:${h.line}: ${h.text.trim()}`);
            continue;
        }
        // Multi-line call: `new PdfExporter(` at end of line with nothing but
        // whitespace and `)` on the next code line.
        if (/^\s*$/.test(rest)) {
            const lines = fs.readFileSync(path.join(REPO_ROOT, h.file), 'utf8').split('\n');
            let j = h.line; // 0-based index of the line after the hit
            while (j < lines.length) {
                const t = lines[j].replace(/\/\/.*$/, '').trim();
                j++;
                if (t === '') continue;
                if (t.startsWith(')')) bare.push(`${h.file}:${h.line}: ${h.text.trim()} (跨行裸调)`);
                break;
            }
        }
    }
    assert.strictEqual(
        bare.length, 0,
        `§15: 生产代码里禁止裸调 new PdfExporter()（会默默回落到 stub）：必须显式传 compiler 或 { allowStub } opt-in：\n` +
        bare.join('\n')
    );
});

test('arch: §15 — STUB_COMPILER_PLACEHOLDER only in pdfCompiler.ts and tests', () => {
    const hits = gitGrepFixed('STUB_COMPILER_PLACEHOLDER').filter(h => isRealCode(h.text));
    const outside = hits.filter(h => h.file !== 'src/core/export/pdf/pdfCompiler.ts');
    assert.strictEqual(
        outside.length, 0,
        `§15: STUB_COMPILER_PLACEHOLDER 标记只能出现在 src/core/export/pdf/pdfCompiler.ts（测试文件除外）：\n` +
        outside.map(h => `  ${h.file}:${h.line}: ${h.text.trim()}`).join('\n')
    );
});
