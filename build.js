// build.js — esbuild build pipeline (Phase 0 of the modularization plan).
//
// Strategy: per-file transform of every JS module under src/ into dist/
// (mirroring the src/ tree), NOT whole-graph bundling. The 23 UMD/IIFE
// modules still talk through window/globalThis, so bundling them into one
// file today would flip their UMD detection to the module.exports branch
// and silently break global wiring. Per-file transform is behavior-
// preserving by construction: same files, same load order (manifest/html
// decide order), minified, with sourcemaps.
//
// When modules migrate to ES imports (Phase 2+), the entryPoints switch in
// build.js is the only change needed to get single-file per-context bundles.
//
// Outputs:  dist/**  (mirrors src/**, JS only)
// Manifest/HTML reference dist/ for JS; lib/, icons/, _locales/, HTML and
// CSS are shipped from their source locations unchanged.

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

function walkSourceFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'types') {
                // src/types is reserved for pure TypeScript type definitions (no runtime emission needed)
                continue;
            }
            out.push(...walkSourceFiles(full));
        } else if (entry.name.endsWith('.d.ts')) {
            continue;
        } else if (entry.name.endsWith('.js') || entry.name.endsWith('.ts')) {
            out.push(full);
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
}

build().catch((err) => {
    console.error('[build] FAILED:', err.message || err);
    process.exit(1);
});
