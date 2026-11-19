import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { specifiers } from '../helpers/moduleSpecifiers.js';

const root = resolve(__dirname, '../../src');
const ports = new Set(['storageService.ts', 'batchStorageService.ts', 'vaultStorageService.ts']);

function violations(owner: string, source: string): string[] {
    if (relative(root, owner).replace(/\\/g, '/').startsWith('l3a/')) return [];
    return specifiers(source).filter(specifier => {
        if (!specifier.startsWith('.')) return false;
        const target = relative(resolve(root, 'l3a'), resolve(dirname(owner), specifier))
            .replace(/\\/g, '/').replace(/\.js$/, '.ts');
        return !target.startsWith('../') && !ports.has(target);
    });
}

function files(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const path = resolve(dir, entry.name);
        return entry.isDirectory() ? files(path) : /\.(?:[cm]?[jt]s|[jt]sx)$/.test(entry.name) ? [path] : [];
    });
}

test('production L3a consumers use only declared public entrypoints', () => {
    const failures = files(root).flatMap(file =>
        violations(file, readFileSync(file, 'utf8')).map(target => `${relative(root, file)} -> ${target}`));
    assert.deepEqual(failures, []);
});

test('L3a boundary canaries reject concrete value, type, re-export and dynamic imports', () => {
    const owner = resolve(root, 'l2/canary.ts');
    const concrete = '../l3a/conversationStore.js';
    for (const source of [
        `import { getConversationSnapshot } from '${concrete}';`,
        `import type { ConversationAtomicBatchItem } from '${concrete}';`,
        `export type { ConversationAtomicBatchItem } from '${concrete}';`,
        `export * from '${concrete}';`,
        `const url = 'https://example.com'; import('${concrete}');`,
        `import '${concrete}';`,
    ]) assert.deepEqual(violations(owner, source), [concrete], source);
    assert.deepEqual(violations(owner, ''), []);
    assert.deepEqual(violations(owner, `// import '${concrete}';\nconst text = "import('${concrete}')";`), []);
    for (const port of ports) {
        assert.deepEqual(violations(owner, `export * from '../l3a/${port}';`), []);
    }
    assert.deepEqual(violations(resolve(root, 'l3a/canary.ts'), `import './conversationStore.js';`), []);
});
