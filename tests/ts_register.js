const Module = require('module');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

try {
    if (typeof globalThis !== 'undefined' && !globalThis.__EXT_VERSION__) {
        globalThis.__EXT_VERSION__ = require('../package.json').version;
    }
} catch {}

// Capture original fs primitives before installing migrated-.js shims or test mocks.
const origReadFileSync = fs.readFileSync;
const origWriteFileSync = fs.writeFileSync;
const origRenameSync = fs.renameSync;
const origMkdirSync = fs.mkdirSync;
const origExistsSync = fs.existsSync;

let lazyEsbuild = null;
function getEsbuild() {
    if (!lazyEsbuild) lazyEsbuild = require('esbuild');
    return lazyEsbuild;
}

const CACHE_VERSION = 'ts-register-v1';
const CACHE_DIR = path.resolve(__dirname, '..', 'temp', '.ts-transform-cache');
let cacheDirEnsured = false;

function transpileCached(filename, source) {
    const hash = crypto
        .createHash('sha256')
        .update(CACHE_VERSION)
        .update('\0')
        .update(filename)
        .update('\0')
        .update(source)
        .digest('hex');
    const cacheFile = path.join(CACHE_DIR, hash + '.cjs');
    try {
        if (origExistsSync.call(fs, cacheFile)) {
            return origReadFileSync.call(fs, cacheFile, 'utf8');
        }
    } catch {}

    const code = getEsbuild().transformSync(source, {
        loader: 'ts',
        target: 'node20',
        format: 'cjs',
    }).code;

    try {
        if (!cacheDirEnsured) {
            origMkdirSync.call(fs, CACHE_DIR, { recursive: true });
            cacheDirEnsured = true;
        }
        const tmpFile = `${cacheFile}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
        origWriteFileSync.call(fs, tmpFile, code, 'utf8');
        origRenameSync.call(fs, tmpFile, cacheFile);
    } catch {}

    return code;
}

// Register on-the-fly TypeScript compilation hook for Node.js CommonJS require
if (!require.extensions['.ts']) {
    require.extensions['.ts'] = function(module, filename) {
        const source = origReadFileSync.call(fs, filename, 'utf8');
        const code = transpileCached(filename, source);
        module._compile(code, filename);

        // Smart CJS Interop: bridge ESM default/named for require()
        const m = module.exports;
        if (m && m.__esModule && m.default) {
            const def = m.default;
            if (def && (typeof def === 'function' || typeof def === 'object')) {
                for (const k of Object.keys(m)) {
                    if (k !== 'default' && k !== '__esModule' && !(k in def)) {
                        try { def[k] = m[k]; } catch (_) {}
                    }
                }
                if (!('default' in def)) { try { def.default = def; } catch (_) {} }
                try { def.__esModule = true; } catch (_) {}
                module.exports = def;
            }
        }
    };
}

// Intercept Module._resolveFilename so that require('./foo.js') resolves to './foo.ts'
// if foo.js was migrated to TypeScript.
const origResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
    try {
        return origResolve.call(this, request, parent, isMain, options);
    } catch (err) {
        if (typeof request === 'string' && request.endsWith('.js')) {
            const tsReq = request.slice(0, -3) + '.ts';
            try {
                return origResolve.call(this, tsReq, parent, isMain, options);
            } catch (_) {}
        }
        throw err;
    }
};

// Intercept fs.readFileSync & fs.existsSync so that tests reading migrated .js files
// (e.g. fs.readFileSync('.../protocol.js', 'utf8') for vm.runInContext) seamlessly read and transpile the .ts file.
fs.readFileSync = function(pathArg, options) {
    if (typeof pathArg === 'string' && pathArg.endsWith('.js')) {
        if (!origExistsSync.call(fs, pathArg)) {
            const tsPath = pathArg.slice(0, -3) + '.ts';
            if (origExistsSync.call(fs, tsPath)) {
                const source = origReadFileSync.call(fs, tsPath, 'utf8');
                if (pathArg.endsWith('protocol.js') || pathArg.endsWith('hookCredentials.js') || pathArg.endsWith('bootstrap.js')) {
                    if (pathArg.endsWith('hookCredentials.js')) {
                        const code = require('./helpers/bundleGeminiHook.cjs')();
                        const encoding = typeof options === 'string' ? options : (options && options.encoding);
                        return encoding ? code : Buffer.from(code, 'utf8');
                    }
                    if (pathArg.endsWith('bootstrap.js')) {
                        const bResult = getEsbuild().buildSync({
                            entryPoints: [tsPath],
                            bundle: true,
                            format: 'iife',
                            target: 'chrome120',
                            write: false,
                            logLevel: 'silent',
                            logOverride: { 'commonjs-variable-in-esm': 'silent' },
                        });
                        const code = bResult.outputFiles[0].text;
                        const encoding = typeof options === 'string' ? options : (options && options.encoding);
                        return encoding ? code : Buffer.from(code, 'utf8');
                    }
                    const isScript = pathArg.endsWith('protocol.js') || pathArg.endsWith('hookCredentials.js');
                    const cleanSource = isScript
                        ? source
                            .replace(/import\s+(?:type\s+)?(?:\{[^}]*\}|[\w*\s,]+)\s*from\s*['"][^'"]+['"];?\s*/g, '')
                            .replace(/import\s+['"][^'"]+['"];?\s*/g, '')
                            .replace(/export\s*\{[^}]*\};?\s*/g, '')
                            .replace(/export\s+default\s+[^;]+;?\s*/g, '')
                        : source;
                    const format = isScript ? 'iife' : undefined;
                    const globalName = pathArg.endsWith('protocol.js') ? 'GeminiProtocol' : undefined;
                    const result = getEsbuild().transformSync(cleanSource, {
                        loader: 'ts',
                        target: 'chrome120',
                        format,
                        globalName,
                        charset: 'utf8',
                    });
                    let code = result.code;
                    if (pathArg.endsWith('protocol.js')) {
                        code += "\nif (typeof GeminiProtocol !== 'undefined') { if (typeof globalThis !== 'undefined') globalThis.GeminiProtocol = GeminiProtocol; if (typeof window !== 'undefined') window.GeminiProtocol = GeminiProtocol; }";
                    }
                    const encoding = typeof options === 'string' ? options : (options && options.encoding);
                    return encoding ? code : Buffer.from(code, 'utf8');
                }
                const encoding = typeof options === 'string' ? options : (options && options.encoding);
                return encoding ? source : Buffer.from(source, 'utf8');
            }
        }
    }
    return origReadFileSync.apply(fs, arguments);
};

fs.existsSync = function(pathArg) {
    if (typeof pathArg === 'string' && pathArg.endsWith('.js')) {
        if (origExistsSync.call(fs, pathArg)) {
            return true;
        }
        const tsPath = pathArg.slice(0, -3) + '.ts';
        return origExistsSync.call(fs, tsPath);
    }
    return origExistsSync.call(fs, pathArg);
};
