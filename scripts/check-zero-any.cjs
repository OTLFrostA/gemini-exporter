const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const scopedFiles = require('./zero-any-files.json');
for (const file of scopedFiles) fs.accessSync(path.join(root, file));

// All owned post-L1 modules are zero-any by contract, including newly added files.
// Third-party generated declarations under vendor/ are excluded.
function ownedTypeScriptFiles(relativeDir) {
    return fs.readdirSync(path.join(root, relativeDir), { withFileTypes: true }).flatMap(entry => {
        const relative = path.posix.join(relativeDir, entry.name);
        if (entry.isDirectory()) return entry.name === 'vendor' ? [] : ownedTypeScriptFiles(relative);
        return entry.isFile() && /\.tsx?$/.test(entry.name) ? [relative] : [];
    });
}
const downstream = ['src/l2', 'src/l3a', 'src/l3b', 'src/application', 'src/l4']
    .flatMap(ownedTypeScriptFiles);
const files = [...new Set([...scopedFiles, ...downstream])].sort();
const cli = path.join(path.dirname(require.resolve('oxlint/package.json')), 'bin', 'oxlint');
const result = spawnSync(process.execPath, [cli, '-A', 'all', '-D', 'typescript/no-explicit-any', '--no-ignore', '--disable-nested-config', ...files], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
// TEMPORARY audit only. This branch is never merged.
const rules=['typescript/no-explicit-any','typescript/no-unsafe-assignment',
    'typescript/no-unsafe-argument','typescript/no-unsafe-call',
    'typescript/no-unsafe-member-access','typescript/no-unsafe-return',
    'typescript/no-unsafe-type-assertion'];
const filesToCheck=['src/l1/parsers/gemini/rpc/extractors.ts',
    'src/l1/parsers/gemini/rpc/detailDecoder.ts'];
const lintArgs=['-A','all',...rules.flatMap(rule=>['-W',rule]),
    '-D','typescript/no-floating-promises','--type-aware','--format','json',...filesToCheck];
const lint=spawnSync(process.execPath,[cli,...lintArgs],{
    cwd:root,encoding:'utf8',maxBuffer:16*1024*1024});
console.log('TURN_BOUNDARY_LINT_BEGIN');
console.log('TURN_BOUNDARY_LINT_PROCESS',lint.status,String(lint.error||''),String(lint.stderr||'').slice(0,1200));
try {
    const parsed=JSON.parse(lint.stdout);
    const diagnostics=parsed.diagnostics||[];
    console.log('TURN_BOUNDARY_LINT_COUNT',diagnostics.length);
    console.log('TURN_BOUNDARY_LINT_DETAILS',JSON.stringify(diagnostics.map(x=>({
        filename:x.filename,rule:x.code,message:x.message
    }))));
} catch(error) {
    console.log('TURN_BOUNDARY_LINT_PARSE_ERROR',String(error),String(lint.stdout||'').slice(0,3000));
}
console.log('TURN_BOUNDARY_LINT_END');
// Intentionally fail the temporary audit CI after printing diagnostics.
process.exitCode=1;

