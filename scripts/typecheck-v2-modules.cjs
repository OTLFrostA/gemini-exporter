#!/usr/bin/env node
// Whole-program checking with an explicit migration ownership boundary.
// Adjacent UI/Browser Runtime errors remain visible as an excluded count.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const manifests = ['l1-tier1.json', 'l4-tests.json', 'v2-module-tests.json'].map(file => require('../tests/' + file));
const suites = new Set(manifests.flatMap(m => [...m.suites, ...m.selected.map(s => s.file), ...(m.typeTests ?? [])]));
const prefixes = ['src/core/api/', 'src/core/provider/', 'src/core/parsers/', 'src/core/imports/takeout/',
    'src/core/storage/', 'src/core/application/', 'src/core/domain/', 'src/core/document/', 'src/core/renderers/', 'src/core/resources/',
    'src/core/export/pdf/', 'src/core/export/typst/', 'src/core/export/packaging/', 'src/core/export/delivery/',
    'src/core/engine/writers/', 'tests/helpers/recordFixture/'];
const helpers = new Set(['domainFixture', 'nativeFixture', 'admitFixture', 'indexFixture', 'acquisitionFixture', 'documentFixture', 'l1SourceFixture', 'indexStorage', 'applicationHarness'].map(f => `tests/helpers/${f}.ts`));
const owned = file => prefixes.some(prefix => file.startsWith(prefix)) || suites.has(file) || helpers.has(file)
    || ['src/content/messageBridge.ts', 'src/content/hookCredentials.ts',
        'src/core/utils/titleText.ts', 'src/core/utils/devMode.ts', 'src/core/utils/errorText.ts'].includes(file);
const result = spawnSync(path.join(process.cwd(), 'node_modules/.bin/tsc'), ['--noEmit', '--pretty', 'false'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
if (result.error) throw result.error;
    if (result.signal) throw new Error(`TypeScript terminated by ${result.signal}`);
const output = (result.stdout ?? '') + (result.stderr ?? '');
let errors = 0, adjacent = 0, current = false;
for (const line of output.split(/\r?\n/).filter(Boolean)) {
    const match = line.match(/^([^(:]+)\(\d+,\d+\): error TS\d+:/);
    if (match) {
        current = owned(path.relative(process.cwd(), path.resolve(match[1])).split(path.sep).join('/'));
        if (current) errors++; else adjacent++;
    } else if (/^error TS\d+:/.test(line)) { current = true; errors++; }
    if (current) console.error(line);
}
if (result.status !== 0 && errors + adjacent === 0) { console.error(output || 'TypeScript did not complete'); process.exit(result.status ?? 1); }
console.log(`V2 module types: ${errors} owned diagnostics; ${adjacent} adjacent diagnostics excluded. Full repository type-check is still required after migration.`);
process.exit(errors ? 1 : 0);
