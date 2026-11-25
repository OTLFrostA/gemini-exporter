#!/usr/bin/env node
'use strict';

/**
 * Architectural boundary & cycle gate for src/.
 *
 * Enforces:
 *   1. Strict layer dependency allowlist (DAG across shared/l2/l3a/l3b/l4/l1/migration/application/runtime/ui/entrypoints).
 *   2. Application cannot directly import concrete platform clients under l1/client/<platform>/.
 *   3. Zero file-level cycles across src/ (including type-only edges).
 *   4. Zero cross-layer cycles across src/.
 */

const fs = require('node:fs');
const path = require('node:path');

const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['vendor', 'fonts', 'node_modules']);

const ALLOWED_LAYER_DEPS = {
    shared: new Set([]),
    l2: new Set(['shared']),
    l3a: new Set(['l2', 'shared']),
    l3b: new Set(['l2', 'shared']),
    l4: new Set(['l3b', 'l2', 'shared']),
    l1: new Set(['l2', 'shared']),
    migration: new Set(['l2', 'l3a', 'shared']),
    application: new Set(['l1', 'l2', 'l3a', 'l3b', 'l4', 'shared']),
    runtime: new Set(['application', 'l1', 'l2', 'l3a', 'migration', 'shared']),
    ui: new Set(['application', 'runtime', 'l2', 'shared']),
    entrypoints: new Set(['ui', 'runtime']),
};

const CONCRETE_PLATFORM_CLIENT_RE = /^l1\/client\/(?:gemini|chatgpt|claude|grok)\//;

function walkSourceFiles(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) walkSourceFiles(path.join(dir, entry.name), out);
        } else if (EXTS.has(path.extname(entry.name))) {
            out.push(path.join(dir, entry.name));
        }
    }
    return out;
}

function resolveRelativeImport(srcRoot, fromFile, spec) {
    if (!spec.startsWith('.')) return null;
    const base = path.resolve(path.dirname(fromFile), spec);
    const ext = path.extname(base);
    let candidates;
    if (ext === '.js') {
        const stem = base.slice(0, -3);
        candidates = [`${stem}.ts`, `${stem}.tsx`, base];
    } else if (!ext) {
        candidates = [
            `${base}.ts`,
            `${base}.tsx`,
            `${base}.js`,
            path.join(base, 'index.ts'),
            path.join(base, 'index.tsx'),
            path.join(base, 'index.js'),
        ];
    } else {
        candidates = [base];
    }
    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            const rel = path.relative(srcRoot, candidate).replace(/\\/g, '/');
            if (!rel.startsWith('..') && !path.isAbsolute(rel)) return rel;
        }
    }
    return null;
}

/** Use the compiler's syntax tree so erased type edges and literal module loads are visible. */
function readDependencies(srcRoot, files) {
    const { API } = require('typescript/unstable/sync');
    const { SyntaxKind } = require('typescript/unstable/ast');
    const api = new API({ cwd: srcRoot });
    try {
        const snapshot = api.updateSnapshot({ openFiles: files });
        const dependencies = new Map();
        for (const file of files) {
            const source = snapshot.getDefaultProjectForFile(file)?.program.getSourceFile(file);
            if (!source) throw new Error(`Cannot inspect architecture dependencies of ${file}`);
            const imports = new Set();
            function visit(node) {
                let specifier;
                switch (node.kind) {
                    case SyntaxKind.ImportDeclaration:
                    case SyntaxKind.ExportDeclaration:
                        specifier = node.moduleSpecifier;
                        break;
                    case SyntaxKind.ExternalModuleReference:
                        specifier = node.expression;
                        break;
                    case SyntaxKind.ImportType:
                        specifier = node.argument.literal;
                        break;
                    case SyntaxKind.CallExpression:
                        if (node.expression.kind === SyntaxKind.ImportKeyword ||
                            (node.expression.kind === SyntaxKind.Identifier && node.expression.text === 'require')) {
                            specifier = node.arguments[0];
                        }
                        break;
                }
                if (specifier?.kind === SyntaxKind.StringLiteral ||
                    specifier?.kind === SyntaxKind.NoSubstitutionTemplateLiteral) imports.add(specifier.text);
                node.forEachChild(visit);
            }
            visit(source);
            dependencies.set(file, imports);
        }
        snapshot.dispose();
        return dependencies;
    } finally {
        api.close();
    }
}

function tarjanScc(graph) {
    let idx = 0;
    const stack = [];
    const onStack = new Set();
    const index = new Map();
    const lowlink = new Map();
    const sccs = [];

    function visit(v) {
        index.set(v, idx);
        lowlink.set(v, idx);
        idx++;
        stack.push(v);
        onStack.add(v);

        for (const w of graph.get(v) || []) {
            if (!index.has(w)) {
                visit(w);
                lowlink.set(v, Math.min(lowlink.get(v), lowlink.get(w)));
            } else if (onStack.has(w)) {
                lowlink.set(v, Math.min(lowlink.get(v), index.get(w)));
            }
        }

        if (lowlink.get(v) === index.get(v)) {
            const comp = [];
            for (;;) {
                const w = stack.pop();
                onStack.delete(w);
                comp.push(w);
                if (w === v) break;
            }
            if (comp.length > 1) sccs.push(comp.sort());
        }
    }

    for (const v of [...graph.keys()].sort()) {
        if (!index.has(v)) visit(v);
    }
    return sccs;
}

function analyzeArchitecture(srcRoot) {
    const files = walkSourceFiles(srcRoot).sort();
    const dependencies = readDependencies(srcRoot, files);
    const fileGraph = new Map();
    const layerGraph = new Map();
    const subModuleGraph = new Map();
    const layerViolations = [];
    const platformViolations = [];

    function subModuleUnit(relPath) {
        const parts = relPath.split('/');
        const dirParts = parts.slice(0, -1);
        return dirParts.slice(0, 2).join('/') || parts[0];
    }

    for (const file of files) {
        const rel = path.relative(srcRoot, file).replace(/\\/g, '/');
        const srcLayer = rel.split('/')[0];
        const srcSubModule = subModuleUnit(rel);
        if (!fileGraph.has(rel)) fileGraph.set(rel, new Set());
        if (!layerGraph.has(srcLayer)) layerGraph.set(srcLayer, new Set());
        if (!subModuleGraph.has(srcSubModule)) subModuleGraph.set(srcSubModule, new Set());

        for (const spec of dependencies.get(file)) {
            const target = resolveRelativeImport(srcRoot, file, spec);
            if (!target || target === rel) continue;
            fileGraph.get(rel).add(target);

            const dstLayer = target.split('/')[0];
            const dstSubModule = subModuleUnit(target);
            if (srcSubModule !== dstSubModule) {
                subModuleGraph.get(srcSubModule).add(dstSubModule);
            }
            if (srcLayer !== dstLayer) {
                layerGraph.get(srcLayer).add(dstLayer);
                const allowed = ALLOWED_LAYER_DEPS[srcLayer];
                if (!allowed || !allowed.has(dstLayer)) {
                    layerViolations.push(`${rel} -> ${target} (forbidden ${srcLayer} -> ${dstLayer})`);
                }
            }
            if (srcLayer === 'application' && CONCRETE_PLATFORM_CLIENT_RE.test(target)) {
                platformViolations.push(`${rel} -> ${target} (application must use taskProvider/aiProvider, not concrete platform client)`);
            }
        }
    }

    const fileCycles = tarjanScc(fileGraph);
    const layerCycles = tarjanScc(layerGraph);
    const subModuleCycles = tarjanScc(subModuleGraph);

    return {
        fileCount: files.length,
        layerViolations: [...new Set(layerViolations)].sort(),
        platformViolations: [...new Set(platformViolations)].sort(),
        fileCycles,
        layerCycles,
        subModuleCycles,
    };
}

if (require.main === module) {
    const t0 = Date.now();
    const srcRoot = path.resolve(__dirname, '..', 'src');
    const report = analyzeArchitecture(srcRoot);
    const failed =
        report.layerViolations.length > 0 ||
        report.platformViolations.length > 0 ||
        report.fileCycles.length > 0 ||
        report.layerCycles.length > 0 ||
        report.subModuleCycles.length > 0;

    if (failed) {
        console.error('[arch-gate] FAILED:');
        for (const v of report.layerViolations) console.error('  [layer] ' + v);
        for (const v of report.platformViolations) console.error('  [platform] ' + v);
        for (const c of report.layerCycles) console.error('  [layer-cycle] ' + c.join(' <-> '));
        for (const c of report.subModuleCycles) console.error('  [submodule-cycle] ' + c.join(' <-> '));
        for (const c of report.fileCycles) console.error('  [file-cycle] ' + c.join(' <-> '));
        process.exit(1);
    }

    console.log(
        `[arch-gate] PASS: ${report.fileCount} files, 0 layer violations, 0 platform leaks, 0 file cycles, 0 layer cycles, 0 submodule cycles (${Date.now() - t0}ms)`,
    );
}

module.exports = { analyzeArchitecture };
