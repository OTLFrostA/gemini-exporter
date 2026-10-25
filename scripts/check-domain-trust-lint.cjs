const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const cli = path.join(path.dirname(require.resolve('oxlint/package.json')), 'bin', 'oxlint');
function ownedTypeScriptFiles(relativeDir) {
    return fs.readdirSync(path.join(root, relativeDir), { withFileTypes: true }).flatMap(entry => {
        const relative = path.posix.join(relativeDir, entry.name);
        if (entry.isDirectory()) return entry.name === 'vendor' ? [] : ownedTypeScriptFiles(relative);
        return entry.isFile() && /\.tsx?$/.test(entry.name) ? [relative] : [];
    });
}
// Typed business and downstream layers reject implicit any flow. The compiler-based
// architecture gate additionally rejects all casts and non-null assertions in these owners.
const files = ['src/l2', 'src/l3a', 'src/l3b', 'src/application', 'src/l4']
    .flatMap(ownedTypeScriptFiles).concat([
        'src/l1/parsers/gemini/shared/contentAdapter.ts', 'src/l1/parsers/gemini/shared/structuredContentAdapter.ts',
        'src/l1/parsers/gemini/rpc/detailDecoder.ts', 'src/l1/parsers/gemini/rpc/detailEvidence.ts',
        'src/l1/parsers/gemini/rpc/extractors.ts', 'src/l1/parsers/gemini/rpc/sourceAttachments.ts',
        'src/l1/parsers/gemini/rpc/turnResources.ts',
    ]);
const result = spawnSync(process.execPath, [cli, '-A', 'all', '-D', 'typescript/no-explicit-any',
    '-D', 'typescript/no-unsafe-assignment', '-D', 'typescript/no-unsafe-argument', '-D', 'typescript/no-unsafe-return',
    '-D', 'typescript/no-unsafe-member-access', '-D', 'typescript/no-unsafe-call', '--type-aware', '--no-ignore',
    '--disable-nested-config', ...files], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
