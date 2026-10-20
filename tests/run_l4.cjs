const { spawnSync } = require('node:child_process');
const path = require('node:path');
const manifest = require('./l4-tests.json');
const root = path.resolve(__dirname, '..');
let passed = 0;
{
    const group = manifest.suites;
    const result = spawnSync(process.execPath, ['-r', './tests/ts_register.js', '--test', '--test-concurrency=2', ...group], {
        cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    });
    process.stdout.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
    const count = /^# pass (\d+)$/m.exec(result.stdout);
    if (!count) throw new Error('Missing L4 test completion summary');
    passed += Number(count[1]);
}
process.stdout.write(`L4: ${passed} tests passed; no failures.\n`);
