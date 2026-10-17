#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const { readFileSync, writeFileSync, unlinkSync } = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const manifest = JSON.parse(readFileSync('tests/l1-tier1.json', 'utf8'));
const prefixes = ['src/core/api/', 'src/core/provider/', 'src/core/parsers/', 'src/core/imports/takeout/'];
const files = [
    'src/content/messageBridge.ts',
    'src/content/geminiIndexCapture.ts',
    'src/content/hookCredentials.ts',
    'src/core/provider/sourceResources.ts',
    ...manifest.typeTests,
    'tests/domain_trust.types.ts',
];

const owns = filename => {
    const relative = filename.split(path.sep).join('/');
    return prefixes.some(prefix => relative.startsWith(prefix)) || files.includes(relative);
};

const tmpConfig = path.join('/tmp', `tsconfig.l1.${process.pid}.json`);
writeFileSync(tmpConfig, JSON.stringify({
    extends: path.join(root, 'tsconfig.json'),
    compilerOptions: {
        types: ['chrome', 'node'],
        typeRoots: [path.join(root, 'node_modules/@types')],
    },
    files: [],
    include: [
        ...prefixes.map(p => path.join(root, p, '**/*.ts')),
        ...files.map(f => path.join(root, f)),
        path.join(root, 'src/types/global.d.ts'),
        path.join(root, 'node_modules/@types/chrome/index.d.ts'),
        path.join(root, 'node_modules/@types/node/index.d.ts'),
    ],
}, null, 2));

try {
    const tscBin = path.join(root, 'node_modules/.bin/tsc');
    const res = spawnSync(tscBin, ['-p', tmpConfig, '--noEmit', '--pretty', 'false'], { encoding: 'utf8' });
    const output = (res.stdout || '') + (res.stderr || '');
    const lines = output.split(/\r?\n/).filter(Boolean);
    const ownedLines = [];
    let excludedCount = 0;
    let currentOwned = false;
    for (const line of lines) {
        const match = line.match(/^([^(:]+)\(\d+,\d+\): error TS\d+:/);
        if (match) {
            currentOwned = owns(path.relative(root, path.resolve(root, match[1])));
            if (currentOwned) ownedLines.push(line);
            else excludedCount++;
        } else if (currentOwned) {
            ownedLines.push(line);
        }
    }
    if (ownedLines.length) console.error(ownedLines.join('\n'));
    console.log(`L1 type check: ${ownedLines.length} owned diagnostics; ${excludedCount} diagnostics in adjacent dependencies excluded. This is not a repository type check.`);
    process.exit(ownedLines.length ? 1 : 0);
} finally {
    try { unlinkSync(tmpConfig); } catch {}
}
