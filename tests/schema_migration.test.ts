import test from 'node:test';
import assert from 'node:assert/strict';
import { indexStorage } from './helpers/indexStorage.js';
import { assertSchemaWritable, SchemaFrozenError } from '../src/core/storage/schemaState.js';
import { migrate, CURRENT_SCHEMA_VERSION, SCHEMA_VERSION_KEY, isSchemaFrozen } from '../src/core/storage/schemaMigration.js';

test('fresh storage initializes the current schema without converting or reassigning data', async () => {
    const env = indexStorage({ untouched: { evidence: true } });
    try {
        assert.deepEqual(await migrate(), { ok: true, frozen: false });
        assert.equal(env.local[SCHEMA_VERSION_KEY], CURRENT_SCHEMA_VERSION);
        assert.deepEqual(env.local.untouched, { evidence: true });
        const writes = env.writes();
        assert.deepEqual(await migrate(), { ok: true, frozen: false });
        assert.equal(env.writes(), writes);
    } finally { env.restore(); }
});
for (const version of [1, 2, CURRENT_SCHEMA_VERSION + 1]) test(`unsupported schema ${version} is preserved and blocked`, async () => {
    const seed = { [SCHEMA_VERSION_KEY]: version, evidence: ['unchanged'] };
    const env = indexStorage(seed);
    try {
        assert.deepEqual(await migrate(), { ok: false, frozen: true, error: 'Unsupported storage schema' });
        assert.equal(isSchemaFrozen(), true);
        assert.deepEqual(env.local, seed);
        assert.equal(env.writes(), 0);
    } finally { env.restore(); }
});
test('initialization never acknowledges a failed schema write and can retry', async () => {
    const env = indexStorage();
    try {
        env.fail(SCHEMA_VERSION_KEY);
        assert.equal((await migrate()).ok, false);
        assert.equal(env.local[SCHEMA_VERSION_KEY], undefined);
        env.fail();
        assert.equal((await migrate()).ok, true);
    } finally { env.restore(); }
});

for (const version of [1, 2, CURRENT_SCHEMA_VERSION + 1, '3']) test(`lazy write guard rejects unsupported schema ${version} without startup`, async () => {
    const env = indexStorage({ [SCHEMA_VERSION_KEY]: version });
    try {
        await assert.rejects(assertSchemaWritable(), SchemaFrozenError);
        assert.equal(env.writes(), 0);
    } finally { env.restore(); }
});
