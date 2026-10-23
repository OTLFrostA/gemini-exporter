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
// TEMPORARY audit only: enumerate owned TypeScript unknown keyword nodes using the TS parser.
// This branch is never merged.
const ts = require('typescript');
function scanFiles(dir) {
  return fs.readdirSync(path.join(root,dir),{withFileTypes:true}).flatMap(entry=>{
    const rel=path.posix.join(dir,entry.name);
    if(entry.isDirectory()) return entry.name==='vendor'?[]:scanFiles(rel);
    return entry.isFile() && /\.tsx?$/.test(rel) && !/\.d\.ts$/.test(rel)?[rel]:[];
  });
}
const sourceFiles=scanFiles('src');
const report=sourceFiles.map(rel=>{
  const src=fs.readFileSync(path.join(root,rel),'utf8');
  const source=ts.createSourceFile(rel,src,ts.ScriptTarget.Latest,true,rel.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  const lines=src.split(/\r?\n/);
  const occurrences=[];
  function visit(node){
    if(node.kind===ts.SyntaxKind.UnknownKeyword){
      const lc=source.getLineAndCharacterOfPosition(node.getStart(source));
      occurrences.push({line:lc.line+1,code:(lines[lc.line]||'').trim().slice(0,150),parent:node.parent?ts.SyntaxKind[node.parent.kind]:''});
    }
    ts.forEachChild(node,visit);
  }
  visit(source);
  return {path:rel,count:occurrences.length,occurrences};
});
report.sort((a,b)=>b.count-a.count||a.path.localeCompare(b.path));
const modules={};
for(const rec of report){const k=rec.path.split('/')[1];modules[k]=(modules[k]||0)+rec.count;}
console.log('UNKNOWN_AST_BEGIN');
console.log('UNKNOWN_AST_TOTAL',report.reduce((s,x)=>s+x.count,0),'SOURCE_FILES',report.length);
console.log('UNKNOWN_AST_MODULES',JSON.stringify(Object.entries(modules).sort((a,b)=>b[1]-a[1])));
console.log('UNKNOWN_AST_TOP_FILES',JSON.stringify(report.slice(0,35).map(({path,count})=>({path,count}))));
console.log('UNKNOWN_AST_TOP_FILE_DETAILS',JSON.stringify(report[0]));
console.log('UNKNOWN_AST_END');
// Stop CI after outputting the diagnostics; this is intentionally a failing temporary audit.
process.exitCode=1;
