const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const cli = path.join(path.dirname(require.resolve('oxlint/package.json')), 'bin', 'oxlint');
// Typed business layers reject implicit any flow. The compiler-based architecture gate
// additionally rejects all casts and non-null assertions in these owners.
const files = ['src/l2', 'src/l3b', 'src/application'];
const result = spawnSync(process.execPath, [cli, '-A', 'all', '-D', 'typescript/no-explicit-any',
    '-D', 'typescript/no-unsafe-assignment', '-D', 'typescript/no-unsafe-argument', '-D', 'typescript/no-unsafe-return',
    '-D', 'typescript/no-unsafe-member-access', '-D', 'typescript/no-unsafe-call', '--type-aware', '--no-ignore',
    '--disable-nested-config', ...files], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
