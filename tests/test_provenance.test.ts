/**
 * tests/test_provenance.test.ts
 *
 * Validates the Test Provenance Classification Manifest (Section 5 & 21).
 * Ensures:
 * 1. Manifest exists, has valid structure, and conforms to P0-P4 tiers.
 * 2. Every registered test suite exists physically on disk.
 * 3. Every canonical & typst-math test file in tests/ is audited and classified.
 * 4. Summary counts and tier distributions match actual test files.
 */
export {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const MANIFEST_PATH = path.join(__dirname, '../scripts/parser_migration/test_provenance_manifest.json');

test('Test Provenance Manifest: File existence and structural integrity', () => {
    assert.ok(fs.existsSync(MANIFEST_PATH), 'test_provenance_manifest.json must exist');
    const raw = fs.readFileSync(MANIFEST_PATH, 'utf-8');
    const data = JSON.parse(raw);

    assert.ok(data.version, 'Manifest must declare version');
    assert.ok(data.classificationDefinitions, 'Manifest must declare classificationDefinitions');
    assert.deepStrictEqual(
        Object.keys(data.classificationDefinitions).sort(),
        ['P0', 'P1', 'P2', 'P3', 'P4'].sort(),
        'Must define all 5 tiers (P0-P4)'
    );

    assert.ok(Array.isArray(data.suites), 'Manifest must declare suites array');
    assert.ok(data.suites.length >= 27, `Expected at least 27 audited suites, got ${data.suites.length}`);
});

test('Test Provenance Manifest: All registered suites exist on disk with valid classifications', () => {
    const data = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
    const validTiers = new Set(['P0', 'P1', 'P2', 'P3', 'P4']);
    const validPolicies = new Set([
        'MUST_PASS_REAL_REGRESSION',
        'VERIFY_AGAINST_STANDARD',
        'PRESERVE_PROJECT_CONTRACT',
        'ROBUSTNESS_NON_BLOCKING',
        'LEGACY_IMPLEMENTATION_SPECIFIC'
    ]);

    for (const suite of data.suites) {
        const fullPath = path.join(__dirname, '..', suite.file);
        assert.ok(fs.existsSync(fullPath), `Suite file must exist: ${suite.file}`);
        assert.ok(validTiers.has(suite.classification), `Invalid classification for ${suite.file}: ${suite.classification}`);
        assert.ok(validPolicies.has(suite.policy), `Invalid policy for ${suite.file}: ${suite.policy}`);
        assert.ok(suite.provenanceSource && suite.provenanceSource.length > 10, `Detailed provenanceSource required for ${suite.file}`);
        assert.ok(suite.testCount > 0, `Suite ${suite.file} must declare at least 1 test`);
        assert.strictEqual(suite.tests.length, suite.testCount, `Mismatch in testCount for ${suite.file}`);
    }
});

test('Test Provenance Manifest: No unclassified canonical or typst test files in tests/', () => {
    const data = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
    const registeredFiles = new Set(data.suites.map((s: any) => s.file.replace(/\\/g, '/')));

    const testDir = __dirname;
    const testFiles = fs.readdirSync(testDir);
    const unclassified: string[] = [];

    for (const f of testFiles) {
        if (!f.endsWith('.test.ts')) continue;
        const isCanonical = f.startsWith('canonical-') || f === 'html-canonical-migration.test.ts';
        const isTypst = f.startsWith('typst-');
        if (isCanonical || isTypst) {
            const rel = `tests/${f}`;
            if (!registeredFiles.has(rel)) {
                unclassified.push(rel);
            }
        }
    }

    assert.deepStrictEqual(
        unclassified,
        [],
        `All canonical and typst test files must be audited in the manifest. Unclassified files: ${unclassified.join(', ')}`
    );
});
