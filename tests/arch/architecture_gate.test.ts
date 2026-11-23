import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { analyzeArchitecture } = require('../../scripts/check-architecture.cjs') as {
    analyzeArchitecture(srcRoot: string): {
        fileCount: number;
        layerViolations: string[];
        platformViolations: string[];
        fileCycles: string[][];
        layerCycles: string[][];
        subModuleCycles: string[][];
    };
};

function withTempSrc(files: Record<string, string>, fn: (dir: string) => void): void {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-gate-test-'));
    try {
        for (const [rel, content] of Object.entries(files)) {
            const full = path.join(root, rel);
            fs.mkdirSync(path.dirname(full), { recursive: true });
            fs.writeFileSync(full, content, 'utf8');
        }
        fn(root);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

test('arch-gate: current src/ satisfies zero layer violations and zero cycles', () => {
    const report = analyzeArchitecture(path.resolve(__dirname, '../../src'));
    assert.deepEqual(report.layerViolations, []);
    assert.deepEqual(report.platformViolations, []);
    assert.deepEqual(report.layerCycles, []);
    assert.deepEqual(report.subModuleCycles, []);
    assert.deepEqual(report.fileCycles, []);
    assert.ok(report.fileCount > 300);
});

test('arch-gate: rejects forbidden cross-layer imports (l1->runtime, l2->l3a, runtime->ui, application->concrete client)', () => {
    withTempSrc({
        'runtime/api/foo.ts': 'export const foo = 1;',
        'l1/sniffer/bad.ts': "import { foo } from '../../runtime/api/foo.js'; export const x = foo;",
        'l3a/store.ts': 'export const s = 1;',
        'l2/bad.ts': "import { s } from '../l3a/store.js'; export const y = s;",
        'ui/badge/view.ts': 'export const v = 1;',
        'runtime/content/bad.ts': "import { v } from '../../ui/badge/view.js'; export const z = v;",
        'l1/client/gemini/geminiProvider.ts': 'export const g = 1;',
        'application/sync/bad.ts': "import { g } from '../../l1/client/gemini/geminiProvider.js'; export const w = g;",
    }, dir => {
        const report = analyzeArchitecture(dir);
        assert.equal(report.layerViolations.length, 3);
        assert.ok(report.layerViolations.some(v => v.includes('l1/sniffer/bad.ts') && v.includes('l1 -> runtime')));
        assert.ok(report.layerViolations.some(v => v.includes('l2/bad.ts') && v.includes('l2 -> l3a')));
        assert.ok(report.layerViolations.some(v => v.includes('runtime/content/bad.ts') && v.includes('runtime -> ui')));
        assert.equal(report.platformViolations.length, 1);
        assert.ok(report.platformViolations[0].includes('application/sync/bad.ts'));
    });
});

test('arch-gate: detects file-level cycles including type-only imports', () => {
    withTempSrc({
        'l2/a.ts': "import type { B } from './b.js'; export interface A { b?: B }",
        'l2/b.ts': "import type { A } from './a.js'; export interface B { a?: A }",
    }, dir => {
        const report = analyzeArchitecture(dir);
        assert.equal(report.fileCycles.length, 1);
        assert.deepEqual(report.fileCycles[0], ['l2/a.ts', 'l2/b.ts']);
    });
});

test('arch-gate: detects sub-module directory cycles even without file-level cycles', () => {
    withTempSrc({
        'l1/client/a.ts': 'export const a = 1;',
        'l1/sniffer/b.ts': "import { a } from '../client/a.js'; export const b = a;",
        'l1/client/c.ts': "import { b } from '../sniffer/b.js'; export const c = b;",
    }, dir => {
        const report = analyzeArchitecture(dir);
        assert.equal(report.fileCycles.length, 0);
        assert.equal(report.subModuleCycles.length, 1);
        assert.deepEqual(report.subModuleCycles[0], ['l1/client', 'l1/sniffer']);
    });
});

