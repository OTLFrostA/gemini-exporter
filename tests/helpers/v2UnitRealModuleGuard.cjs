'use strict';
/**
 * Sociable-core runtime guard for v2 module-unit suites.
 * Pure domain/AST foundations (shared, l2, l3b) and deterministic in-memory
 * storage (l3a) may be loaded by downstream owners according to the v2 DAG,
 * eliminating drifted hand-rolled validator clones while still failing fast on
 * upward, lateral, or host-layer boundary leaks.
 */
const Module = require('node:module');
const path = require('node:path');

const allowedByOwner = {
    shared: new Set(['shared']),
    l2: new Set(['shared', 'l2']),
    l3a: new Set(['shared', 'l2', 'l3a']),
    l3b: new Set(['shared', 'l2', 'l3b']),
    l1: new Set(['shared', 'l2', 'l1']),
    l4: new Set(['shared', 'l2', 'l3b', 'l4']),
    migration: new Set(['shared', 'l2', 'l3a', 'migration']),
    application: new Set(['shared', 'l2', 'l3a', 'l3b', 'l4', 'application']),
    runtime: new Set(['shared', 'l2', 'l3a', 'runtime']),
    ui: new Set(['shared', 'l2', 'ui']),
    entrypoints: new Set(['shared', 'l2', 'entrypoints']),
};

const owner = process.env.V2_UNIT_OWNER;
const allowed = owner ? allowedByOwner[owner] : undefined;
if (!allowed) {
    throw new Error('Set V2_UNIT_OWNER to an explicit v2 module when enabling the unit guard');
}
const owners = new Set(Object.keys(allowedByOwner));
const sourceRoot = path.resolve(__dirname, '../../src');
const originalCompile = Module.prototype._compile;
Module.prototype._compile = function(code, filename) {
    const relative = path.relative(sourceRoot, filename).replace(/\\/g, '/');
    if (relative !== '..' && !relative.startsWith('../') && !path.isAbsolute(relative)) {
        const sourceOwner = relative.split('/')[0];
        if (owners.has(sourceOwner) && !allowed.has(sourceOwner)) {
            throw new Error(
                'Unit isolation violation: ' + owner + ' compiled forbidden ' + sourceOwner +
                ' implementation: src/' + relative +
                '. Inject a boundary mock or move this suite to integration.'
            );
        }
    }
    return originalCompile.call(this, code, filename);
};
