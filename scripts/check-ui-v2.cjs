#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { buildSync } = require('esbuild');
const result = spawnSync(path.join(process.cwd(), 'node_modules/.bin/tsc'), ['--noEmit', '--pretty', 'false'], {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024
});
if (result.error) throw result.error;
if (result.signal) throw new Error(`TypeScript terminated by ${result.signal}`);
const migratedTests = ['tests/conversations_store.test.ts', 'tests/diagnostic_snapshot.test.ts',
    'tests/seam_s3_ui_timeout.test.ts', 'tests/domain_downstream_boundaries.test.ts', 'tests/account_identity_isolation.test.ts'];
const owned = file => migratedTests.includes(file) || file.startsWith('src/ui/') || ['src/types/ui.ts', 'src/content/badgeView.ts',
    'src/core/utils/titleUtils.ts', 'src/core/utils/i18n.ts', 'src/core/utils/tabService.ts',
    'src/core/diagnostics/diagnosticSnapshot.ts'].includes(file) || file.startsWith('src/core/utils/locales/');
let failures = 0, adjacent = 0;
for (const line of ((result.stdout || '') + (result.stderr || '')).split(/\r?\n/)) {
    const match = line.match(/^([^(:]+)\(\d+,\d+\): error TS\d+:/);
    if (!match) continue;
    const file = path.relative(process.cwd(), path.resolve(match[1])).split(path.sep).join('/');
    if (owned(file)) { failures++; console.error(line); } else adjacent++;
}
if (result.status && failures === 0 && adjacent === 0) throw new Error(result.stdout || result.stderr || 'TypeScript failed');
console.log(`UI v2 types: ${failures} owned diagnostics; ${adjacent} adjacent diagnostics excluded.`);
if (failures) process.exit(1);
buildSync({ entryPoints: ['src/ui/options/options.ts', 'src/ui/popup/popup.ts', 'src/content/badgeView.ts'],
    bundle: true, write: false, outdir: 'dist', platform: 'browser', logLevel: 'error' });
console.log('Options, Popup and Badge bundles passed. Full extension build remains a separate gate.');
const units = spawnSync(process.execPath, ['-r', './tests/ts_register.js', '--test', ...migratedTests], { stdio: 'inherit' });
if (units.error) throw units.error;
if (units.status !== 0) process.exit(units.status ?? 1);
const tests = spawnSync(process.execPath, ['--test', 'tests/ui-v2-adaptation.test.js'], { stdio: 'inherit' });
if (tests.error) throw tests.error;
process.exit(tests.status ?? 1);
