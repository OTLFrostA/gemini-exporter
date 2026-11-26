
const esbuild = require('esbuild');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const MANIFEST_PATH = path.join(ROOT, 'manifest.json');

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

// NOTE: package.json / README version-badge syncing used to live here. It now
// lives in scripts/release-prepare.js (`node scripts/release-prepare.js`) so that
// `node build.js` is pure and never mutates the tracked source tree.

const DEFINE_VERSION = {
    __EXT_VERSION__: JSON.stringify(EXT_VERSION),
    'process.env.NODE_ENV': JSON.stringify('production'),
};

const BUNDLE_ENTRIES = {
    'content/content': path.join(SRC, 'entrypoints', 'content', 'gemini.ts'),
    'content/hook': path.join(SRC, 'l1', 'sniffer', 'gemini', 'hookCredentials.ts'),
    'content/chatgpt-hook': path.join(SRC, 'l1', 'sniffer', 'chatgpt', 'hook.ts'),
    'content/chatgpt-content': path.join(SRC, 'entrypoints', 'content', 'chatgpt.ts'),
    'content/grok-hook': path.join(SRC, 'l1', 'sniffer', 'grok', 'hook.ts'),
    'content/grok-content': path.join(SRC, 'entrypoints', 'content', 'grok.ts'),
    'content/claude-hook': path.join(SRC, 'l1', 'sniffer', 'claude', 'hook.ts'),
    'content/claude-content': path.join(SRC, 'entrypoints', 'content', 'claude.ts'),
    'background/background': path.join(SRC, 'runtime', 'background', 'background.ts'),
    'ui/popup': path.join(SRC, 'ui', 'popup', 'popup.ts'),
    'ui/options': path.join(SRC, 'ui', 'options', 'options.ts'),
};

const SANDBOX_ENTRIES = {
    'ui/sandbox/typst-compile': path.join(SRC, 'l4', 'format', 'pdf', 'sandbox', 'typstCompileEntry.ts'),
};

const EXPECTED_BUNDLES = [
    'dist/content/content.js',
    'dist/content/hook.js',
    'dist/content/chatgpt-hook.js',
    'dist/content/chatgpt-content.js',
    'dist/content/grok-hook.js',
    'dist/content/grok-content.js',
    'dist/content/claude-hook.js',
    'dist/content/claude-content.js',
    'dist/background/background.js',
    'dist/ui/popup.js',
    'dist/ui/options.js',
    'dist/ui/sandbox/typst-compile.js',
];

async function build() {
    const t0 = Date.now();
    if (!fs.existsSync(SRC)) {
        throw new Error('src/ directory not found');
    }

    fs.rmSync(DIST, { recursive: true, force: true });

    for (const [entryName, entryFile] of Object.entries(BUNDLE_ENTRIES)) {
        if (!fs.existsSync(entryFile)) {
            throw new Error(`Bundle entrypoint source missing for ${entryName}: ${entryFile}`);
        }
    }

    const bundleResult = await esbuild.build({
        entryPoints: BUNDLE_ENTRIES,
        outdir: DIST,
        bundle: true,
        format: 'iife',
        conditions: ['worker', 'browser'],
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

    // Build the Typst sandbox entry as ESM (loaded via <script type="module"> in the sandbox page)
    for (const [entryName, entryFile] of Object.entries(SANDBOX_ENTRIES)) {
        if (!fs.existsSync(entryFile)) {
            throw new Error(`Sandbox entrypoint source missing for ${entryName}: ${entryFile}`);
        }
    }
    const sandboxResult = await esbuild.build({
        entryPoints: SANDBOX_ENTRIES,
        outdir: DIST,
        bundle: true,
        format: 'esm',
        minify: false,
        sourcemap: false,
        target: ['chrome120'],
        legalComments: 'none',
        define: DEFINE_VERSION,
        loader: { '.typ': 'text', '.tmTheme': 'text' },
        logLevel: 'silent',
        logOverride: {
            'commonjs-variable-in-esm': 'silent'
        },
        write: true,
    });
    if ((sandboxResult.errors || []).length > 0) {
        throw new Error(`esbuild sandbox build failed with ${sandboxResult.errors.length} error(s)`);
    }

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
        packageExtension(process.argv.includes('--chrome-web-store'));
    }
}

function chromeWebStoreFiles() {
    const webClient = process.env.DRIVE_WEB_CLIENT_ID;
    if (!webClient || !/^\d+-[A-Za-z0-9-]+\.apps\.googleusercontent\.com$/.test(webClient)) {
        throw new Error('Chrome Web Store packaging requires DRIVE_WEB_CLIENT_ID.');
    }
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    manifest.permissions = [...new Set([...manifest.permissions, 'identity'])];
    manifest.host_permissions = [...new Set([...manifest.host_permissions, 'https://www.googleapis.com/*'])];
    return { 'manifest.json': manifest, 'drive-account-client.json': webClient };
}

function packageExtension(chromeWebStore) {
    const t0 = Date.now();
    const zipName = `gemini-exporter-v${EXT_VERSION}.zip`;
    const zipPath = path.join(ROOT, zipName);
    const releaseFiles = chromeWebStore ? chromeWebStoreFiles() : undefined;
    if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath);
    }

    const { execFileSync, execSync } = require('child_process');
    if (releaseFiles) {
        const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-exporter-release-'));
        try {
            for (const [name, content] of Object.entries(releaseFiles)) {
                fs.writeFileSync(path.join(staging, name), JSON.stringify(content, null, 2) + '\n');
            }
            execFileSync('zip', ['-q', zipPath, ...Object.keys(releaseFiles)], { cwd: staging });
        } finally {
            fs.rmSync(staging, { recursive: true, force: true });
        }
    }
    const staticFiles = ['_locales', 'icons', 'lib', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md', 'README_zh.md'];
    if (!releaseFiles) staticFiles.unshift('manifest.json');
    execFileSync('zip', ['-qr', zipPath, ...staticFiles], { cwd: ROOT });
    execSync(`zip -r "${zipName}" src -x 'src/*.ts' 'src/*/*.ts' 'src/*/*/*.ts' 'src/*/*/*/*.ts' 'src/*.tsx' 'src/*/*.tsx' 'src/*/*/*.tsx' 'src/*/*/*/*.tsx' 'src/README.md'`, { cwd: ROOT, stdio: 'ignore' });
    execSync(`zip -r "${zipName}" dist -i ${EXPECTED_BUNDLES.map(file => `'${file}'`).join(' ')}`, { cwd: ROOT, stdio: 'ignore' });

    const stats = fs.statSync(zipPath);
    const kb = (stats.size / 1024).toFixed(1);
    console.log(`[package] Created production zip: ${zipName} (${kb} KB) in ${Date.now() - t0}ms`);
}

build().catch((err) => {
    console.error('[build] FAILED:', err.message || err);
    process.exit(1);
});
