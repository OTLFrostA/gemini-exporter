#!/usr/bin/env node
/**
 * scripts/generate-canonical-validator.js
 *
 * Build-time codegen for canonical structural validation (Task 05).
 *
 * Compiles src/core/export/canonical/resources/canonical-conversation-v1.schema.json
 * with Ajv 2020 (Draft 2020-12) into a standalone, dependency-free CommonJS module:
 *   src/core/export/canonical/resources/validateCanonicalStructure.generated.js
 *
 * The generated module is plain JavaScript with no eval, no new Function, no
 * network access and no runtime schema compilation, so it is safe to import from
 * the MV3 extension bundles (esbuild inlines it) and from unit tests.
 *
 * Policy (documented per spec): the generated file is CHECKED IN, and a
 * freshness test (tests/canonical-validator-freshness.test.ts) plus a build
 * pre-step (`--check`) verify it is byte-identical to what the current schema
 * and Ajv version produce. Regenerate with:
 *
 *   npm run generate:canonical-validator
 *
 * Ajv is a build/dev-only dependency; it never ships in the extension.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.join(__dirname, '..');
const SCHEMA_PATH = path.join(
    REPO_ROOT, 'src', 'core', 'export', 'canonical',
    'resources', 'canonical-conversation-v1.schema.json',
);
const OUT_PATH = path.join(
    REPO_ROOT, 'src', 'core', 'export', 'canonical',
    'resources', 'validateCanonicalStructure.generated.js',
);

function generateValidatorSource() {
    const Ajv2020 = require('ajv/dist/2020');
    let standaloneCode = require('ajv/dist/standalone');
    standaloneCode = standaloneCode.default || standaloneCode;
    const ajvVersion = require('ajv/package.json').version;

    const schemaText = fs.readFileSync(SCHEMA_PATH, 'utf8');
    const schema = JSON.parse(schemaText);
    const schemaHash = crypto.createHash('sha256').update(schemaText, 'utf8').digest('hex');

    const ajv = new Ajv2020({
        code: { source: true, esm: false },
        allErrors: true,
        strict: true,
    });
    const validate = ajv.compile(schema);
    const body = standaloneCode(ajv, validate);

    // CSP/MV3 guard: the standalone output must be plain code. Fail the
    // generation loudly if Ajv ever emits something dynamic.
    if (/new Function/.test(body) || /(^|[^_.a-zA-Z$])eval\s*\(/.test(body)) {
        throw new Error('generated validator contains dynamic code (eval/new Function); refusing to write');
    }

    const header = [
        '/**',
        ' * GENERATED FILE — do not edit by hand.',
        ' *',
        ' * Generated from canonical-conversation-v1.schema.json by',
        ' * scripts/generate-canonical-validator.js using the Ajv 2020 standalone',
        ' * compiler (Draft 2020-12). Plain dependency-free CommonJS: no eval,',
        ' * no new Function, no network, no runtime schema compilation.',
        ' *',
        ` * schema-sha256: ${schemaHash}`,
        ` * ajv-version: ${ajvVersion}`,
        ' *',
        ' * Regenerate with: npm run generate:canonical-validator',
        ' */',
        "'use strict';",
        '',
    ].join('\n');
    return header + body;
}

function main() {
    const check = process.argv.includes('--check');
    const expected = generateValidatorSource();
    if (check) {
        const actual = fs.existsSync(OUT_PATH) ? fs.readFileSync(OUT_PATH, 'utf8') : null;
        if (actual !== expected) {
            console.error(
                '[gen] canonical validator is STALE: ' + path.relative(REPO_ROOT, OUT_PATH) +
                ' does not match the current schema. Run: npm run generate:canonical-validator',
            );
            process.exit(1);
        }
        console.log('[gen] canonical validator is up to date');
        return;
    }
    fs.writeFileSync(OUT_PATH, expected);
    console.log(`[gen] wrote ${path.relative(REPO_ROOT, OUT_PATH)} (${expected.length} bytes)`);
}

if (require.main === module) {
    main();
}

module.exports = { generateValidatorSource, SCHEMA_PATH, OUT_PATH };
