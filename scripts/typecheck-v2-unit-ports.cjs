#!/usr/bin/env node
'use strict';
/**
 * Type-check ONLY the isolated unit mocks (and their contract-focused new
 * tests) against the actual exported TypeScript definitions from dev/v2.
 * Do not hide diagnostics in these files or globally suppress strict errors.
 * Existing unrelated cross-module/legacy diagnostics are a separate global CI
 * concern and are not part of this scoped unit-port acceptance gate.
 */
const ts = require('typescript');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = [
    'tests/helpers/l1V2UnitMocks.ts',
    'tests/helpers/l2V2UnitHarness.ts',
    'tests/l2-v2-unit-mocked.test.ts',
    'tests/helpers/l3aStorageUnitEnvironment.ts',
    'tests/helpers/l3bUnitHarness.ts',
    'tests/helpers/l4V2Fixtures.ts',
    'tests/helpers/applicationHarness.ts',
    'tests/helpers/runtimeV2ContractMocks.ts',
    'tests/helpers/uiV2Mocks.ts',
    'tests/migration-v2-mocked.test.ts',
].map(file => path.join(root, file));
const included = new Set(files.map(file => path.resolve(file)));
const configPath = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json');
if (!configPath) throw new Error('Missing tsconfig.json');
const read = ts.readConfigFile(configPath, ts.sys.readFile);
if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root);
const program = ts.createProgram(files, { ...parsed.options, noEmit: true });
const diagnostics = ts.getPreEmitDiagnostics(program).filter(diagnostic =>
    diagnostic.file && included.has(path.resolve(diagnostic.file.fileName)));
if (diagnostics.length) {
    process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: file => file,
        getCurrentDirectory: () => root,
        getNewLine: () => '\n',
    }));
    process.exit(1);
}
console.log('V2 unit-port types: ' + files.length + ' mock/test files checked against actual module definitions; 0 scoped diagnostics');
