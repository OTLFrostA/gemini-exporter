import test from 'node:test';
import assert from 'node:assert/strict';
import * as storage from '../src/core/storage/storageService.js';
import { indexStorage, useIndexStorage } from './helpers/indexStorage.js';
import { fixtureKey } from './helpers/domainFixture.js';

import { ensureUpgraded } from '../src/core/migration/upgradeV1.js';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
test('global schema manager and normal Storage legacy readers are retired', () => {
    for (const file of ['schemaMigration.ts', 'schemaState.ts', 'migrationMarker.ts']) assert.equal(existsSync('src/core/storage/' + file), false);
    for (const file of readdirSync('src/core/storage').filter(file => file.endsWith('.ts'))) {
        const source = readFileSync('src/core/storage/' + file, 'utf8');
        assert.doesNotMatch(source, /gemini_exporter_v2_initialized|conversations_|exported_|schemaVersion|ensureUpgraded/);
    }
});
for (const version of [1, 2, 999, '3']) test(`legacy schema indicator ${version} does not invent a new migration category`, async () => {
    const seed = { gemini_exporter_schema_version: version, evidence: ['unchanged'] };
    const env = indexStorage(seed);
    try {
        await ensureUpgraded();
        assert.deepEqual(env.local, { ...seed, gemini_exporter_v2_initialized: true });
        assert.deepEqual(await indexedDB.databases(), []);
    } finally { env.restore(); }
});
