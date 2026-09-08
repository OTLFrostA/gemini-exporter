// build.js — esbuild build pipeline.
//
// Strategy:
// 1. Per-file transform of every source module under src/ into dist/ (mirroring src/).
// 2. Bundled entrypoint for Options Page (Phase 2):
//    src/ui/options/options.ts -> dist/ui/options.js (bundle: true, format: "iife")

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

function walkSourceFiles(dir) {
    const out = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const tsBases = new Set();
    for (const entry of entries) {
        if (!entry.isDirectory() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
            tsBases.add(entry.name.slice(0, -3));
        }
    }

    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'types') {
                // src/types is reserved for pure TypeScript type definitions (no runtime emission needed)
                continue;
            }
            out.push(...walkSourceFiles(full));
        } else if (entry.name.endsWith('.d.ts')) {
            continue;
        } else if (entry.name.endsWith('.ts')) {
            out.push(full);
        } else if (entry.name.endsWith('.js')) {
            const base = entry.name.slice(0, -3);
            if (!tsBases.has(base)) {
                out.push(full);
            }
        }
    }
    return out;
}

async function build() {
    const t0 = Date.now();
    if (!fs.existsSync(SRC)) {
        throw new Error('src/ directory not found');
    }

    // Clean dist to avoid stale artifacts from removed sources.
    fs.rmSync(DIST, { recursive: true, force: true });

    const entryPoints = walkSourceFiles(SRC);
    if (entryPoints.length === 0) {
        throw new Error('no source (.js/.ts) files found under src/');
    }

    // 1. Per-file transform for individual modules
    const result = await esbuild.build({
        entryPoints,
        outdir: DIST,
        outbase: SRC,
        bundle: false,
        minify: true,
        sourcemap: true,
        target: ['chrome120'],
        legalComments: 'none',
        logLevel: 'silent',
        write: true,
    });

    const warnings = (result.warnings || []).length;
    const errors = (result.errors || []).length;
    if (errors > 0) {
        throw new Error(`esbuild reported ${errors} error(s)`);
    }

    // 2. Options Workbench single-file bundle (PR 5)
    const optionsEntry = path.join(SRC, 'ui', 'options', 'options.ts');
    if (fs.existsSync(optionsEntry)) {
        const optionsBundleResult = await esbuild.build({
            entryPoints: {
                'ui/options': optionsEntry
            },
            outdir: DIST,
            bundle: true,
            format: 'iife',
            minify: true,
            sourcemap: true,
            target: ['chrome120'],
            legalComments: 'none',
            logLevel: 'silent',
            write: true,
        });
        if ((optionsBundleResult.errors || []).length > 0) {
            throw new Error(`Options bundle failed with ${optionsBundleResult.errors.length} error(s)`);
        }
    }

    // 3. Dual-World Content Script bundles (PR 6)
    // 3a. ISOLATED world: src/content/content.ts -> dist/content/content.js
    const contentEntry = path.join(SRC, 'content', 'content.ts');
    if (fs.existsSync(contentEntry)) {
        const contentBundleResult = await esbuild.build({
            entryPoints: {
                'content/content': contentEntry
            },
            outdir: DIST,
            bundle: true,
            format: 'iife',
            minify: true,
            sourcemap: true,
            target: ['chrome120'],
            legalComments: 'none',
            logLevel: 'silent',
            write: true,
        });
        if ((contentBundleResult.errors || []).length > 0) {
            throw new Error(`Content bundle failed with ${contentBundleResult.errors.length} error(s)`);
        }
    }

    // 3b. MAIN world: src/content/hookCredentials.ts -> dist/content/hook.js
    const hookEntry = path.join(SRC, 'content', 'hookCredentials.ts');
    if (fs.existsSync(hookEntry)) {
        const hookBundleResult = await esbuild.build({
            entryPoints: {
                'content/hook': hookEntry
            },
            outdir: DIST,
            bundle: true,
            format: 'iife',
            minify: true,
            sourcemap: true,
            target: ['chrome120'],
            legalComments: 'none',
            logLevel: 'silent',
            write: true,
        });
        if ((hookBundleResult.errors || []).length > 0) {
            throw new Error(`Hook bundle failed with ${hookBundleResult.errors.length} error(s)`);
        }
    }

    const jsFiles = [];
    (function collect(dir) {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) collect(full);
            else if (e.name.endsWith('.js')) jsFiles.push(full);
        }
    })(DIST);

    console.log(`[build] ${jsFiles.length} JS modules -> dist/ in ${Date.now() - t0}ms (${warnings} warning(s))`);

    // Sanity: every source module must have a dist counterpart (.js).
    for (const srcFile of entryPoints) {
        const rel = path.relative(SRC, srcFile);
        const relJs = rel.endsWith('.ts') ? rel.slice(0, -3) + '.js' : rel;
        if (!fs.existsSync(path.join(DIST, relJs))) {
            throw new Error(`missing dist artifact for ${relJs} (from ${rel})`);
        }
    }

    // Sanity: Options single bundle must exist
    if (!fs.existsSync(path.join(DIST, 'ui', 'options.js'))) {
        throw new Error('missing dist artifact for ui/options.js');
    }

    // Sanity: Content and Hook single bundles must exist (PR 6)
    if (!fs.existsSync(path.join(DIST, 'content', 'content.js'))) {
        throw new Error('missing dist artifact for content/content.js');
    }
    if (!fs.existsSync(path.join(DIST, 'content', 'hook.js'))) {
        throw new Error('missing dist artifact for content/hook.js');
    }
}

build().catch((err) => {
    console.error('[build] FAILED:', err.message || err);
    process.exit(1);
});
