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
// Temporary audit branch only. Print Oxlint's exact structuredContent.ts findings.
const target = 'src/l1/parsers/gemini/rpc/structuredContent.ts';
const args = ['-A','all',
  '-W','typescript/no-explicit-any',
  '-W','typescript/no-unsafe-assignment',
  '-W','typescript/no-unsafe-argument',
  '-W','typescript/no-unsafe-call',
  '-W','typescript/no-unsafe-member-access',
  '-W','typescript/no-unsafe-return',
  '-W','typescript/no-unsafe-type-assertion',
  '-D','typescript/no-floating-promises',
  '--type-aware','--format','json',target];
const lint = spawnSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
console.log('STRUCTURED_LINT_AUDIT_BEGIN');
console.log('EXIT',lint.status,'STDERR',lint.stderr?.slice(0,1500),'ERROR',String(lint.error || ''));
try {
  const parsed = JSON.parse(lint.stdout);
  const warnings = parsed.diagnostics || [];
  console.log('STRUCTURED_LINT_DIAGNOSTICS',JSON.stringify(warnings.map(x=>({
    rule:x.code,line:x.labels?.at(-1)?.span?.line,column:x.labels?.at(-1)?.span?.column,
    message:x.message,
  }))));
  console.log('STRUCTURED_LINT_TOTAL',warnings.length);
} catch(e) {console.log('PARSE_ERROR',String(e),'RAW',lint.stdout?.slice(0,4000));}
console.log('STRUCTURED_LINT_AUDIT_END');
// Fail intentionally after writing diagnostic counts; do not run expensive tests.
process.exitCode = 1;
