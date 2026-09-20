// build.js — esbuild pure bundle build pipeline for Gemini Exporter.
//
// Modern Architecture (Pure Bundle Pipeline):
// Directly builds the 5 self-contained production IIFE bundles loaded by Chrome MV3:
//   1. content/content    -> dist/content/content.js   (ISOLATED world content script)
//   2. content/hook       -> dist/content/hook.js      (MAIN world network interceptor)
//   3. background/background -> dist/background/background.js (Service Worker bundle)
//   4. ui/popup          -> dist/ui/popup.js          (Popup modal coordinator)
//   5. ui/options        -> dist/ui/options.js        (Options workbench coordinator)

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const MANIFEST_PATH = path.join(ROOT, 'manifest.json');
const PKG_PATH = path.join(ROOT, 'package.json');

const EXT_VERSION = (() => {
    try {
        const parsed = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
        if (!parsed.version) {
            throw new Error('manifest.json does not contain a "version" property');
        }
        return parsed.version;
    } catch (err) {
        console.error('[build] Failed to read version from manifest.json:', err.message);
        process.exit(1);
    }
})();

// Keep package.json version in sync with manifest.json (Single Source of Truth)
try {
    if (fs.existsSync(PKG_PATH)) {
        const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
        if (pkg.version !== EXT_VERSION) {
            pkg.version = EXT_VERSION;
            fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n');
            console.log(`[build] Synced package.json version to manifest.json (${EXT_VERSION})`);
        }
    }
} catch (err) {
    console.warn('[build] Warning: Could not auto-sync package.json version:', err.message);
}

// Keep README version badges in sync with manifest.json
for (const readmeFile of ['README.md', 'README_zh.md']) {
    const readmePath = path.join(ROOT, readmeFile);
    if (fs.existsSync(readmePath)) {
        try {
            const content = fs.readFileSync(readmePath, 'utf8');
            const updated = content
                .replace(/(https:\/\/img\.shields\.io\/badge\/(?:%E7%89%88%E6%9C%AC|Version)-)[0-9.]+(-orange\.svg\?style=for-the-badge)/g, `$1${EXT_VERSION}$2`)
                .replace(/(alt="(?:版本|Version): )[0-9.]+(")/g, `$1${EXT_VERSION}$2`);
            if (updated !== content) {
                fs.writeFileSync(readmePath, updated);
                console.log(`[build] Synced ${readmeFile} version badge to ${EXT_VERSION}`);
            }
        } catch (err) {
            console.warn(`[build] Warning: Could not auto-sync ${readmeFile} badge:`, err.message);
        }
    }
}

const DEFINE_VERSION = { __EXT_VERSION__: JSON.stringify(EXT_VERSION) };

const BUNDLE_ENTRIES = {
    'content/content': path.join(SRC, 'content', 'content.ts'),
    'content/hook': path.join(SRC, 'content', 'hookCredentials.ts'),
    'background/background': path.join(SRC, 'background', 'background.ts'),
    'ui/popup': path.join(SRC, 'ui', 'popup', 'popup.ts'),
    'ui/options': path.join(SRC, 'ui', 'options', 'options.ts'),
};

const EXPECTED_BUNDLES = [
    'dist/content/content.js',
    'dist/content/hook.js',
    'dist/background/background.js',
    'dist/ui/popup.js',
    'dist/ui/options.js',
];

async function build() {
    const t0 = Date.now();
    if (!fs.existsSync(SRC)) {
        throw new Error('src/ directory not found');
    }

    // Clean dist to ensure zero stale files
    fs.rmSync(DIST, { recursive: true, force: true });

    // Validate that all 5 bundle entrypoint source files exist
    for (const [entryName, entryFile] of Object.entries(BUNDLE_ENTRIES)) {
        if (!fs.existsSync(entryFile)) {
            throw new Error(`Bundle entrypoint source missing for ${entryName}: ${entryFile}`);
        }
    }

    // 1. Build all 5 production IIFE bundles in parallel
    const bundleResult = await esbuild.build({
        entryPoints: BUNDLE_ENTRIES,
        outdir: DIST,
        bundle: true,
        format: 'iife',
        minify: true,
        sourcemap: false,
        target: ['chrome120'],
        legalComments: 'none',
        define: DEFINE_VERSION,
        logLevel: 'silent',
        logOverride: {
            'commonjs-variable-in-esm': 'silent'
        },
        write: true,
    });

    const warnings = (bundleResult.warnings || []).length;
    const errors = (bundleResult.errors || []).length;
    if (errors > 0) {
        throw new Error(`esbuild bundle build failed with ${errors} error(s)`);
    }

    // 2. Verify all expected production bundles exist
    for (const bundle of EXPECTED_BUNDLES) {
        const fullPath = path.join(ROOT, bundle);
        if (!fs.existsSync(fullPath)) {
            throw new Error(`missing dist bundle artifact for ${bundle}`);
        }
    }

    const jsFiles = [];
    (function collect(dir) {
        if (!fs.existsSync(dir)) return;
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) collect(full);
            else if (e.name.endsWith('.js')) jsFiles.push(full);
        }
    })(DIST);

    console.log(`[build] ${jsFiles.length} JS bundle(s) -> dist/ in ${Date.now() - t0}ms (${warnings} warning(s))`);

    if (process.argv.includes('--pack')) {
        packageExtension();
    }
}

function packageExtension() {
    const t0 = Date.now();
    const zipName = `gemini-exporter-v${EXT_VERSION}.zip`;
    const zipPath = path.join(ROOT, zipName);
    if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath);
    }

    const { execSync } = require('child_process');
    execSync(`zip -r "${zipName}" manifest.json _locales icons lib LICENSE THIRD_PARTY_NOTICES.md README.md README_zh.md`, { cwd: ROOT, stdio: 'ignore' });
    execSync(`zip -r "${zipName}" src -x 'src/*.ts' 'src/*/*.ts' 'src/*/*/*.ts' 'src/*/*/*/*.ts' 'src/README.md'`, { cwd: ROOT, stdio: 'ignore' });
    execSync(`zip -r "${zipName}" dist -i 'dist/background/background.js' 'dist/content/content.js' 'dist/content/hook.js' 'dist/ui/options.js' 'dist/ui/popup.js'`, { cwd: ROOT, stdio: 'ignore' });

    const stats = fs.statSync(zipPath);
    const kb = (stats.size / 1024).toFixed(1);
    console.log(`[package] Created production zip: ${zipName} (${kb} KB) in ${Date.now() - t0}ms`);
}

build().catch((err) => {
    console.error('[build] FAILED:', err.message || err);
    process.exit(1);
});
