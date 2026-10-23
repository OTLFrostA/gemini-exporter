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
// TEMPORARY source scan: ignore comments and quoted strings when counting unknown tokens.
// Audit branch only. This is a lexical count rather than a TypeScript typechecker AST count.
function codeOnly(src) {
  let out='';
  for(let i=0;i<src.length;) {
    const c=src[i], n=src[i+1];
    if(c==='/'&&n==='/') {
      while(i<src.length&&src[i]!=='\n') {out+=' ';i++;}
      continue;
    }
    if(c==='/'&&n==='*') {
      out+='  ';i+=2;
      while(i<src.length) {
        if(src[i]==='*'&&src[i+1]==='/'){out+='  ';i+=2;break;}
        out+=src[i]==='\n'?'\n':' ';i++;
      }
      continue;
    }
    if(c==='"'||c==="'"||c.charCodeAt(0)===96) {
      const quote=c;out+=' ';i++;
      while(i<src.length) {
        const q=src[i];
        if(q==='\\') {out+='  ';i+=2;continue;}
        out+=q==='\n'?'\n':' ';i++;
        if(q===quote) break;
      }
      continue;
    }
    out+=c;i++;
  }
  return out;
}
function scanFiles(dir) {
  return fs.readdirSync(path.join(root,dir),{withFileTypes:true}).flatMap(entry=>{
    const rel=path.posix.join(dir,entry.name);
    if(entry.isDirectory())return entry.name==='vendor'?[]:scanFiles(rel);
    return entry.isFile()&&/\.tsx?$/.test(rel)&&!/\.d\.ts$/.test(rel)?[rel]:[];
  });
}
const report=scanFiles('src').map(rel=>{
  const text=fs.readFileSync(path.join(root,rel),'utf8');
  const srcLines=text.split(/\r?\n/),codeLines=codeOnly(text).split(/\r?\n/);
  const occurrences=[];
  for(let i=0;i<codeLines.length;i++) {
    const found=codeLines[i].match(/\bunknown\b/g);
    if(found)for(let j=0;j<found.length;j++)occurrences.push({line:i+1,code:(srcLines[i]||'').trim().slice(0,170)});
  }
  return {path:rel,count:occurrences.length,occurrences};
});
report.sort((a,b)=>b.count-a.count||a.path.localeCompare(b.path));
const modules={};
for(const r of report){const k=r.path.split('/')[1];modules[k]=(modules[k]||0)+r.count;}
console.log('UNKNOWN_SCAN_BEGIN');
console.log('UNKNOWN_SCAN_TOTAL',report.reduce((s,x)=>s+x.count,0),'SOURCE_FILES',report.length);
console.log('UNKNOWN_SCAN_MODULES',JSON.stringify(Object.entries(modules).sort((a,b)=>b[1]-a[1])));
console.log('UNKNOWN_SCAN_TOP_FILES',JSON.stringify(report.slice(0,40).map(({path,count})=>({path,count}))));
console.log('UNKNOWN_SCAN_TOP_FILE_DETAILS',JSON.stringify(report[0]));
console.log('UNKNOWN_SCAN_END');
process.exitCode=1;