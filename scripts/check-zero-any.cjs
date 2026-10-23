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
// Audit-only: do not invoke check-domain-trust-lint, which exits this process before the audit.


// TEMPORARY, audit-only PR. Print the full source lint baseline, then exit normally.
const auditArgs = ['-A','all',
  '-W','typescript/no-explicit-any',
  '-W','typescript/no-unsafe-assignment',
  '-W','typescript/no-unsafe-argument',
  '-W','typescript/no-unsafe-call',
  '-W','typescript/no-unsafe-member-access',
  '-W','typescript/no-unsafe-return',
  '-W','typescript/no-unsafe-type-assertion',
  '-D','typescript/no-floating-promises',
  '--type-aware','src/','--format','json'];
const audit = spawnSync(process.execPath, [cli, ...auditArgs], {cwd:root, encoding:'utf8', maxBuffer: 64*1024*1024});
console.log('SOURCE_LINT_AUDIT_BEGIN');
console.log('LINT_EXIT_STATUS', audit.status);
console.log('LINT_STDERR', (audit.stderr || '').slice(0, 2500));
if (audit.error) console.log('LINT_PROCESS_ERROR', String(audit.error));
try {
  const value = JSON.parse(audit.stdout);
  console.log('JSON_ROOT', Array.isArray(value) ? 'array' : Object.keys(value));
  const allDiagnostics = Array.isArray(value) ? value.flatMap(x => x.messages || [x]) :
    (value.diagnostics || value.results?.flatMap(x => x.messages || []) || []);
  const diagnostics = allDiagnostics.filter(d => !String(d.filename || d.filePath || d.file || '').includes('/vendor/'));
  console.log('DIAGNOSTICS_WITH_VENDOR', allDiagnostics.length);
  console.log('DIAGNOSTICS_EXCLUDING_VENDOR', diagnostics.length);
  console.log('DIAGNOSTIC_SAMPLE', JSON.stringify(diagnostics.slice(0, 2)).slice(0, 3000));
  const rules = {}, modules = {}, files = {}, severities = {};
  for (const d of diagnostics) {
    const code = d.ruleId || d.code || d.rule || 'unknown-rule';
    const rule = typeof code === 'string' ? code : JSON.stringify(code);
    const filename = String(d.filename || d.filePath || d.file || 'unknown-file').replace(/^.*?(src\/)/, '$1');
    const section = filename.startsWith('src/') ? (filename.split('/').slice(0, 2).join('/')) : 'unknown-module';
    const severity = String(d.severity || 'unknown-severity');
    rules[rule] = (rules[rule] || 0) + 1;
    modules[section] = (modules[section] || 0) + 1;
    files[filename] = (files[filename] || 0) + 1;
    severities[severity] = (severities[severity] || 0) + 1;
  }
  const sort = (obj) => Object.entries(obj).sort((a,b) => b[1] - a[1]);
  console.log('SUMMARY_TOTAL', diagnostics.length);
  console.log('SUMMARY_RULES', JSON.stringify(sort(rules)));
  console.log('SUMMARY_MODULES', JSON.stringify(sort(modules)));
  console.log('SUMMARY_SEVERITIES', JSON.stringify(sort(severities)));
  console.log('SUMMARY_TOP_FILES', JSON.stringify(sort(files).slice(0,40)));
  const byModuleRule = {};
  for (const d of diagnostics) {
    const code = d.ruleId || d.code || d.rule || 'unknown-rule';
    const rule = typeof code === 'string' ? code : JSON.stringify(code);
    const filename = String(d.filename || d.filePath || d.file || 'unknown-file').replace(/^.*?(src\/)/, '$1');
    const section = filename.startsWith('src/') ? filename.split('/').slice(0,2).join('/') : 'unknown-module';
    byModuleRule[section] ||= {};
    byModuleRule[section][rule] = (byModuleRule[section][rule] || 0) + 1;
  }
  console.log('SUMMARY_MODULE_RULE', JSON.stringify(byModuleRule));
} catch (err) {
  console.log('JSON_PARSE_ERROR', String(err));
  console.log('STDOUT_SAMPLE', (audit.stdout || '').slice(0,5000));
}
console.log('SOURCE_LINT_AUDIT_END');

// This audit-only draft PR intentionally stops CI after collecting the diagnostic summary.
process.exitCode = 1;
