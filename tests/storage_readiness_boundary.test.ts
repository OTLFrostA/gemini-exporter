import test from 'node:test';
import assert from 'node:assert/strict';
import { indexStorage } from './helpers/indexStorage.js';
import { ensureStorageReady, __resetStorageReadyForTest, SCHEMA_VERSION_KEY, CURRENT_SCHEMA_VERSION, SchemaFrozenError } from '../src/core/storage/schemaMigration.js';

test('readiness is single-flight and later callers reuse successful initialization', async () => {
    const env = indexStorage();
    try {
        const first = ensureStorageReady();
        assert.equal(first, ensureStorageReady());
        await first;
        assert.equal(env.local[SCHEMA_VERSION_KEY], CURRENT_SCHEMA_VERSION);
        const writes = env.writes();
        assert.equal(first, ensureStorageReady());
        await ensureStorageReady();
        assert.equal(env.writes(), writes);
    } finally { env.restore(); }
});
test('readiness rejects unsupported versions before admitting consumers', async () => {
    const env = indexStorage({ [SCHEMA_VERSION_KEY]: CURRENT_SCHEMA_VERSION + 1 });
    try {
        let admitted = false;
        await assert.rejects(ensureStorageReady().then(() => { admitted = true; }), SchemaFrozenError);
        assert.equal(admitted, false);
        assert.equal(env.writes(), 0);
    } finally { env.restore(); }
});
test('failed readiness remains rejected until explicit context restart', async () => {
    const env = indexStorage();
    try {
        env.fail(SCHEMA_VERSION_KEY);
        const first = ensureStorageReady();
        await assert.rejects(first, /write failed/);
        env.fail();
        assert.equal(ensureStorageReady(), first);
        await assert.rejects(ensureStorageReady());
        __resetStorageReadyForTest();
        await ensureStorageReady();
        assert.equal(env.local[SCHEMA_VERSION_KEY], CURRENT_SCHEMA_VERSION);
    } finally { env.restore(); }
});
