const Module = require('module');
const esbuild = require('esbuild');
const fs = require('fs');

// Register on-the-fly TypeScript compilation hook for Node.js CommonJS require
if (!require.extensions['.ts']) {
    require.extensions['.ts'] = function(module, filename) {
        const source = fs.readFileSync(filename, 'utf8');
        const result = esbuild.transformSync(source, {
            loader: 'ts',
            target: 'node20',
            format: 'cjs'
        });
        module._compile(result.code, filename);
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
const origReadFileSync = fs.readFileSync;
fs.readFileSync = function(pathArg, options) {
    if (typeof pathArg === 'string' && pathArg.endsWith('.js')) {
        if (!origExistsSync.call(fs, pathArg)) {
            const tsPath = pathArg.slice(0, -3) + '.ts';
            if (origExistsSync.call(fs, tsPath)) {
                const source = origReadFileSync.call(fs, tsPath, 'utf8');
                const result = esbuild.transformSync(source, {
                    loader: 'ts',
                    target: 'chrome120'
                });
                const encoding = typeof options === 'string' ? options : (options && options.encoding);
                if (encoding) {
                    return result.code;
                }
                return Buffer.from(result.code, 'utf8');
            }
        }
    }
    return origReadFileSync.apply(fs, arguments);
};

const origExistsSync = fs.existsSync;
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

