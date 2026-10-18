const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const cli = path.join(path.dirname(require.resolve('oxlint/package.json')), 'bin', 'oxlint');
// Newly governed boundaries only. Authorized assertions are audited by the compiler-based
// architecture test; this gate rejects implicit any flow without changing repository-wide lint.
const files = ['src/core/domain/runtimeValidation.ts', 'src/core/utils/nativeDetailTransport.ts'];
const result = spawnSync(process.execPath, [cli, '-A', 'all', '-D', 'typescript/no-explicit-any',
    '-D', 'typescript/no-unsafe-assignment', '-D', 'typescript/no-unsafe-argument', '-D', 'typescript/no-unsafe-return',
    '-D', 'typescript/no-unsafe-member-access', '-D', 'typescript/no-unsafe-call', '--type-aware', '--no-ignore',
    '--disable-nested-config', ...files], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
