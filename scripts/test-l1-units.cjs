/**
 * L1-focused runtime unit gate. Deliberately independent of the repository-wide
 * TypeScript gate while unrelated v2 consumers and legacy tests migrate.
 * Every listed test is executed; none is silently skipped on a failure.
 *
 * Usage:
 *   node scripts/test-l1-units.cjs              # all L1 suites
 *   node scripts/test-l1-units.cjs client parser # selected groups
 */
'use strict';
const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');

const suites = {
    client: [
        'tests/l1_contract.test.ts',
        'tests/l1-native-acquisition.test.ts',
        'tests/l1_l2_verified_deletion.test.ts',
        'tests/gemini_client_retry.test.ts',
        'tests/client_cancellation.test.ts',
        'tests/provider_adapter.test.ts',
        'tests/provider_neutral.test.ts',
        'tests/provider_contract.test.ts',
        'tests/provider-chatgpt-tree.test.ts',
        'tests/list-source-boundary.test.ts',
    ],
    sniffer: [
        'tests/message_bridge.test.ts',
        'tests/observed_page_ingest.test.ts',
        'tests/page_observation.test.ts',
        'tests/rpc_list_ingest.test.ts',
        'tests/sniff_watermark_isolation.test.ts',
        'tests/l1_l2_frozen_contract.test.ts',
    ],
    parser: [
        'tests/l1_extracted_regressions.test.ts',
        'tests/l1-source-timestamps.test.ts',
        'tests/provider-gemini-rpc-domain.test.ts',
        'tests/provider-gemini-markup-sanitization.test.ts',
        'tests/gemini_dual_parse.test.ts',
        'tests/gemini_live_parser_regressions.test.ts',
        'tests/gemini_parser.test.ts',
        'tests/gemini_prompt_literal.test.ts',
        'tests/gemini_selected_candidate.test.ts',
        'tests/gemini_structured_citations.test.ts',
        'tests/gemini_structured_coverage.test.ts',
        'tests/gemini_text_math.test.ts',
        'tests/timestamp_honesty.test.ts',
    ],
    takeout: [
        'tests/provider-gemini-takeout-domain.test.ts',
        'tests/takeout-archive-resources.test.ts',
        'tests/takeout_generated_reconciliation.test.ts',
    ],
    resources: [
        'tests/l1-resource-admission.test.ts',
    ],
};
const requested = process.argv.slice(2);
if (requested.some(name => !(name in suites))) {
    console.error('Usage: node scripts/test-l1-units.cjs [' + Object.keys(suites).join('|') + ' ...]');
    process.exit(2);
}
const groups = requested.length ? requested : Object.keys(suites);
const tests = [...new Set(groups.flatMap(name => suites[name]))];
const root = path.resolve(__dirname, '..');
const register = path.join(root, 'tests/ts_register.js');
if (!existsSync(register)) throw new Error('Missing TypeScript test loader');
console.log('Running ' + tests.length + ' L1 unit-test files (' + groups.join(', ') + ')');
let failed = 0;
for (const file of tests) {
    if (!existsSync(path.join(root, file))) throw new Error('Missing L1 unit test: ' + file);
    const start = Date.now();
    const run = spawnSync(process.execPath, ['-r', register, '--test', file], {
        cwd: root, encoding: 'utf8', timeout: 90_000, maxBuffer: 16 * 1024 * 1024,
    });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    if (run.status === 0) {
        console.log('PASS ' + file + ' (' + elapsed + 's)');
    } else {
        failed++;
        console.error('FAIL ' + file + ' (' + elapsed + 's, exit=' + run.status + ')');
        if (run.error) console.error(run.error);
        console.error((run.stdout || '').slice(-16000));
        console.error((run.stderr || '').slice(-8000));
    }
}
console.log('L1 unit suites: ' + (tests.length - failed) + ' passed, ' + failed + ' failed / ' + tests.length + ' files');
if (failed) process.exitCode = 1;
