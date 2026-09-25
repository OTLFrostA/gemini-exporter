// tests/arch/no_circular_dependencies.test.ts
// Architectural gate: Enforce 0 circular dependencies across all modules in src/.
// Ensures clean DAG architecture and prevents TDZ (Temporal Dead Zone) bundle failures.
export {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');

function getTsFiles(dir: string): string[] {
    const files: string[] = [];
    for (const item of fs.readdirSync(dir)) {
        const full = path.join(dir, item);
        const st = fs.statSync(full);
        if (st.isDirectory()) {
            files.push(...getTsFiles(full));
        } else if (item.endsWith('.ts') && !item.endsWith('.d.ts')) {
            files.push(full);
        }
    }
    return files;
}

test('arch: zero circular dependencies across all modules in src/', () => {
    const files = getTsFiles(SRC_ROOT);
    const graph = new Map<string, string[]>();

    for (const file of files) {
        const content = fs.readFileSync(file, 'utf8');
        const imports: string[] = [];
        const lines = content.split('\n');
        for (const line of lines) {
            // Type-only imports are stripped by TypeScript and do not produce runtime cycles
            if (/^\s*import\s+type\s+/.test(line)) continue;
            const m = line.match(/^\s*(?:import|export)\s+(?:.*?from\s+)?['"]([^'"]+)['"]/);
            if (m) {
                const spec = m[1];
                if (spec.startsWith('.')) {
                    let resolved = path.resolve(path.dirname(file), spec);
                    if (resolved.endsWith('.js')) resolved = resolved.slice(0, -3) + '.ts';
                    if (!fs.existsSync(resolved) && fs.existsSync(resolved + '.ts')) resolved += '.ts';
                    if (!fs.existsSync(resolved) && fs.existsSync(path.join(resolved, 'index.ts'))) resolved = path.join(resolved, 'index.ts');
                    if (fs.existsSync(resolved)) imports.push(resolved);
                }
            }
        }
        graph.set(file, imports);
    }

    const visited = new Set<string>();
    const stack: string[] = [];
    const onStack = new Set<string>();
    const cycles: string[][] = [];

    function dfs(u: string) {
        visited.add(u);
        stack.push(u);
        onStack.add(u);

        for (const v of graph.get(u) || []) {
            if (!visited.has(v)) {
                dfs(v);
            } else if (onStack.has(v)) {
                const cycle = stack.slice(stack.indexOf(v));
                cycle.push(v);
                cycles.push(cycle.map(p => path.relative(SRC_ROOT, p)));
            }
        }

        stack.pop();
        onStack.delete(u);
    }

    for (const f of graph.keys()) {
        if (!visited.has(f)) dfs(f);
    }

    assert.strictEqual(
        cycles.length,
        0,
        `Detected circular dependencies in src/:\n` +
        cycles.map(c => '  ' + c.join(' -> ')).join('\n')
    );
});
