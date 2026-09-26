#!/usr/bin/env node
/**
 * scripts/release-gate-checks/check-no-cjk-fonts.js
 * §16 P0 release-blocker gate: CJK 字体不得随包。
 *
 * P0 formal experiment结论 (包体增量对照 30MiB):
 *  - typst WASM + glue + NewCMMath ≈ 11.1MiB, 通过;
 *  - 关键: CJK 不随包 (实验捆绑的 16.4MB NotoSansCJK 仅为实验手段)。
 *    产品策略 = Local Font Access 本地字体优先 + 最小兜底; 若回退到
 *    "全量 CJK 随包", 单字体 16.4MB 直接吃掉一半以上预算。
 *
 * 本门禁在 `node build.js` 之后运行, 扫描商店包实际会带上的文件
 * (build.js --pack 的 zip 输入: dist/ + src/ 非 .ts + lib/ + icons/ + _locales/):
 *  1. 硬失败: 文件名命中 CJK 特征的字体文件 (改名也躲不过第 2 条);
 *  2. 硬失败: 字体文件总大小 >= 5MiB (单份全量 CJK 16.4MB; 允许的
 *     NewCMMath-Regular.otf 仅 1.3MB, 5MiB 留足余量);
 *  3. 硬失败: dist/ JS 里出现 data:font/ 内嵌字体 (字体必须以文件形式
 *     存在, 才能被 1/2 两条检查看见; base64 内嵌 CJK 会绕过文件扫描)。
 *
 * 实测基线 (2026-09-26): 当前 build 产物 dist/ 仅 5 个 JS bundle (828K),
 * 打包范围内无任何字体文件, 本门禁以 PASS 基线落地, 为 Phase D
 * (sandbox + typst WASM + 字体文件落地) 做回归防线。
 *
 * 用法: node scripts/release-gate-checks/check-no-cjk-fonts.js
 *       npm run test:release-gates
 * 退出码: 0 通过, 1 失败 (CI 红)。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
// build.js --pack 的 zip 输入范围 (精确对应, 见 build.js packageExtension)
const SCAN_ROOTS = ['dist', 'src', 'lib', 'icons', '_locales'];

const FONT_EXTS = new Set(['.ttf', '.otf', '.ttc', '.otc', '.woff', '.woff2', '.eot']);

/** 文件名命中任一模式即判为 CJK 字体 (大小写不敏感)。 */
const CJK_NAME_PATTERNS = [
    /cjk/i,
    /hansans/i, /sourcehan/i,
    /noto.*(sans|serif).*(sc|tc|jp|kr|hk)/i,
    /wqy/i, // 文泉驿
    /uming/i, /ukai/i, /zenhei/i,
    /hanazono/i,
    /pingfang/i, /songti/i, /kaiti/i, /heiti/i, /fangsong/i, /lishu/i,
    /xingkai/i, /weibei/i,
    /stheiti/i, /stsong/i, /stkaiti/i, /stfangsong/i, /stxihei/i, /stzhongsong/i,
    /simsun/i, /simhei/i, /simkai/i, /simfang/i, /simli/i, /simyou/i,
    /yahei/i, /dengxian/i,
    /meiryo/i, /msgothic/i, /msmincho/i, /yumin/i, /yugothic/i,
    /malgun/i, /gulim/i, /batang/i, /dotum/i,
    /hanzipen/i,
    /sarasa/i, /lxgw/i, // 更纱黑体 / 霞鹜文楷
    /misans/i,
    /arphic/i, /cwtex/i, // 文鼎 / cwTeX
    /dfkai/i, /mingliu/i, /pmingliu/i,
    /adobe(fan|song|hei|kai|fangsong)/i,
];

/**
 * 字体总大小预算: 5MiB。
 *  - 单份全量 CJK (NotoSansCJKsc-Regular) = 16.4MB >> 5MiB, 必被拦;
 *  - 允许的最小数学兜底 (NewCMMath-Regular.otf) = 1.3MB < 5MiB, 放行。
 */
const TOTAL_FONT_BUDGET_BYTES = 5 * 1024 * 1024;

function walkFonts(dir, out) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return; // 目录不存在 (如 lib/) 直接跳过
    }
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (e.name === 'node_modules' || e.name === '.git') continue;
            walkFonts(full, out);
        } else if (e.isFile() && FONT_EXTS.has(path.extname(e.name).toLowerCase())) {
            out.push(full);
        }
    }
}

function humanBytes(n) {
    if (n < 1024) return `${n} B`;
    const units = ['KB', 'MB', 'GB'];
    let v = n / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[i]}`;
}

function main() {
    console.log('[release-gate] check-no-cjk-fonts');
    console.log(`  scan roots: ${SCAN_ROOTS.join(', ')}`);

    const fontFiles = [];
    for (const root of SCAN_ROOTS) walkFonts(path.join(ROOT, root), fontFiles);

    let totalBytes = 0;
    const cjkHits = [];
    for (const f of fontFiles) {
        const size = fs.statSync(f).size;
        totalBytes += size;
        const base = path.basename(f);
        if (CJK_NAME_PATTERNS.some(re => re.test(base))) {
            cjkHits.push({ file: path.relative(ROOT, f), size });
        }
    }

    // 检查 3: dist/ JS 里内嵌的 data:font/ (base64 字体绕过文件扫描)
    const embeddedFontHits = [];
    const distDir = path.join(ROOT, 'dist');
    if (fs.existsSync(distDir)) {
        const jsFiles = [];
        const collectJs = dir => {
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, e.name);
                if (e.isDirectory()) collectJs(full);
                else if (e.isFile() && full.endsWith('.js')) jsFiles.push(full);
            }
        };
        collectJs(distDir);
        for (const jf of jsFiles) {
            const content = fs.readFileSync(jf, 'utf8');
            const matches = content.match(/data:font\/[a-z0-9.+-]+;base64,/gi) || [];
            if (matches.length > 0) {
                embeddedFontHits.push({ file: path.relative(ROOT, jf), count: matches.length });
            }
        }
    }

    console.log(`  font files found: ${fontFiles.length} (${humanBytes(totalBytes)})`);
    for (const f of fontFiles) {
        console.log(`    - ${path.relative(ROOT, f)} (${humanBytes(fs.statSync(f).size)})`);
    }

    const failures = [];
    if (cjkHits.length > 0) {
        failures.push(
            `CJK font file(s) bundled (${cjkHits.length}):\n` +
            cjkHits.map(h => `    - ${h.file} (${humanBytes(h.size)})`).join('\n'),
        );
    }
    if (totalBytes >= TOTAL_FONT_BUDGET_BYTES) {
        failures.push(
            `total bundled font size ${humanBytes(totalBytes)} >= budget ${humanBytes(TOTAL_FONT_BUDGET_BYTES)} ` +
            `(a full CJK font is ~16.4MB; suspected renamed CJK font)`,
        );
    }
    if (embeddedFontHits.length > 0) {
        failures.push(
            `embedded data:font/ URI(s) in dist JS (fonts must ship as files to stay auditable):\n` +
            embeddedFontHits.map(h => `    - ${h.file} (${h.count} occurrence(s))`).join('\n'),
        );
    }

    if (failures.length > 0) {
        console.error('\n[release-gate] FAIL: CJK fonts must not ship with the extension package.\n');
        for (const f of failures) console.error(`  ${f}\n`);
        console.error('  P0 policy: CJK via Local Font Access (local-first), never bundled. See P0 formal REPORT §4.');
        process.exit(1);
    }

    console.log(
        `  PASS: no CJK fonts bundled; total font size ${humanBytes(totalBytes)} ` +
        `< ${humanBytes(TOTAL_FONT_BUDGET_BYTES)} budget; no embedded data:font/ URIs`,
    );
}

main();
