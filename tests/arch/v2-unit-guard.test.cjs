'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const guard = path.join(root, 'tests/helpers/v2UnitRealModuleGuard.cjs');
function compileUnderOwner(owner, source) {
    return spawnSync(process.execPath, ['-r', './tests/ts_register.js', '-e',
        'require(' + JSON.stringify(source) + ')'], {
        cwd: root, encoding: 'utf8',
        env: { ...process.env, V2_UNIT_OWNER: owner, NODE_OPTIONS: '--require=' + guard },
    });
}
test('v2 sociable unit guard allows a real module owned by the suite', () => {
    const result = compileUnderOwner('l2', './src/l2/streamCoverage.js');
    assert.equal(result.status, 0, result.stderr);
});
test('v2 sociable unit guard allows downstream owners to load pure L2 domain helpers', () => {
    const result = compileUnderOwner('l3b', './src/l2/content/tableLayout.js');
    assert.equal(result.status, 0, result.stderr);
});
test('v2 sociable unit guard rejects upward or forbidden host-layer implementations', () => {
    const l2Leak = compileUnderOwner('l2', './src/l3a/storageService.js');
    assert.notEqual(l2Leak.status, 0);
    assert.match(l2Leak.stderr, /Unit isolation violation: l2 compiled forbidden l3a implementation/);

    const l3bLeak = compileUnderOwner('l3b', './src/l4/format/markdown/renderMarkdown.js');
    assert.notEqual(l3bLeak.status, 0);
    assert.match(l3bLeak.stderr, /Unit isolation violation: l3b compiled forbidden l4 implementation/);
});
test('v2 sociable unit guard allows Shared pure helpers across all owners', () => {
    const result = compileUnderOwner('l2', './src/shared/utils/retryUtils.js');
    assert.equal(result.status, 0, result.stderr);
});
