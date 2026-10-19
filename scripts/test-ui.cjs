#!/usr/bin/env node
// UI Tier 1 only; ports to other v2 modules are mocked by the UI browser specs.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
function run(command, args) {
    const result = spawnSync(command, args, { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
}
const types = spawnSync(path.resolve('node_modules/.bin/tsc'), ['--noEmit', '--pretty', 'false'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
if (types.error || types.signal) throw types.error ?? Error(`TypeScript terminated: ${types.signal}`);
let owned = 0, adjacent = 0, current = false;
for (const line of ((types.stdout ?? '') + (types.stderr ?? '')).split(/\r?\n/).filter(Boolean)) {
    const diagnostic = line.match(/^([^(:]+)\(\d+,\d+\): error TS\d+:/);
    if (diagnostic) {
        const file = path.relative(process.cwd(), path.resolve(diagnostic[1])).split(path.sep).join('/');
        current = file.startsWith('src/ui/') || ['src/content/badgeView.ts', 'src/content/liveSaveCoordinator.ts', 'tests/ui_v2.test.ts', 'tests/e2e/ui_v2.spec.ts'].includes(file);
        if (current) owned++; else adjacent++;
    } else if (/^error TS\d+:/.test(line)) { current = true; owned++; }
    if (current) console.error(line);
}
console.log(`UI types: ${owned} owned diagnostics; ${adjacent} adjacent diagnostics excluded.`);
if (owned || types.status && !adjacent) process.exit(1);
run(process.execPath, ['-r', './tests/ts_register.js', '--test', 'tests/ui_v2.test.ts']);
if (!process.argv.includes('--types-and-unit')) run(path.resolve('node_modules/.bin/playwright'), ['test', 'tests/e2e/ui_v2.spec.ts', '--workers=1']);
