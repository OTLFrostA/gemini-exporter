#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const manifest = require('../tests/v2-module-tests.json');
let executions = 0;
function run(args) {
    const result = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    process.stdout.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
    const passed = [...(result.stdout ?? '').matchAll(/^# pass (\d+)$/gm)].reduce((sum, match) => sum + Number(match[1]), 0);
    if (args[0] === '-r' && passed === 0) throw new Error('Module test group matched no passing tests');
    executions += passed;
}
run(['scripts/test-l1.cjs']);
run(['tests/run_l4.cjs']);
for (const group of [manifest.suites, ...manifest.selected.map(({ file, pattern }) => [`--test-name-pattern=${pattern}`, file])]) {
    run(['-r', './tests/ts_register.js', '--test', ...group]);
}
run(['scripts/typecheck-v2-modules.cjs']);
console.log(`V2 module gate: ${executions} test executions passed (manifests can overlap); owned type checks passed.`);
