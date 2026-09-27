/**
 * tests/canonical-validator-freshness.test.ts
 *
 * Drift guard for the Ajv-generated structural validator (Task 05).
 *
 * Policy: src/core/export/canonical/resources/validateCanonicalStructure.generated.js
 * is CHECKED IN. This test regenerates it from the current
 * canonical-conversation-v1.schema.json with the repo's Ajv version and
 * requires byte-identical output — if the schema (or the Ajv version that
 * shapes codegen) changes without regenerating, the test fails loudly and
 * tells the developer the exact command to run.
 */
export {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { generateValidatorSource, SCHEMA_PATH, OUT_PATH } =
    require('../scripts/generate-canonical-validator.js');

test('checked-in validator is byte-identical to a fresh generation from the current schema', () => {
    assert.ok(fs.existsSync(SCHEMA_PATH), 'schema resource exists');
    assert.ok(fs.existsSync(OUT_PATH), 'generated validator is checked in');
    const expected = generateValidatorSource();
    const actual = fs.readFileSync(OUT_PATH, 'utf8');
    assert.strictEqual(
        actual,
        expected,
        'generated validator drifted from canonical-conversation-v1.schema.json; ' +
        'run: npm run generate:canonical-validator',
    );
});

test('generated validator header records the schema hash it was built from', () => {
    const schemaText = fs.readFileSync(SCHEMA_PATH, 'utf8');
    const hash = crypto.createHash('sha256').update(schemaText, 'utf8').digest('hex');
    const src = fs.readFileSync(OUT_PATH, 'utf8');
    assert.ok(
        src.includes(`schema-sha256: ${hash}`),
        'generated validator header must record the current schema sha256',
    );
});

test('generation is deterministic across runs', () => {
    assert.strictEqual(generateValidatorSource(), generateValidatorSource(), 'codegen must be deterministic');
});
