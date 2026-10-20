import test from 'node:test';
import assert from 'node:assert/strict';
import * as storage from '../src/core/storage/storageService.js';
import { indexStorage, useIndexStorage } from './helpers/indexStorage.js';
import { fixtureKey } from './helpers/domainFixture.js';

import { validateParserDomain } from '../src/core/domain/runtimeValidation.js';
useIndexStorage();
test('Storage persists detached structured clones of accepted Index and Detail, without transport state', async () => {
    const key = fixtureKey('copy');
    const domain = validateParserDomain({ index: { key, title: 'Original', titleSource: 'provider' },
        detail: { key, quality: { status: 'complete' }, messages: [{ role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Body' }] }] }], assets: [{ id: 'asset', kind: 'file', sourceUri: 'opaque:original' }] } });
    await storage.updateConversationAtomically(key, () => ({ ...domain, result: undefined }));
    domain.index.title = 'Changed'; domain.detail.assets[0].sourceUri = 'changed';
    const read = await storage.getDetail(key); assert.ok(read);
    assert.equal((await storage.getIndex(key))?.title, 'Original');
    assert.equal(read.assets[0].sourceUri, 'opaque:original');
    read.assets.length = 0;
    assert.equal((await storage.getDetail(key))?.assets.length, 1);
    assert.doesNotMatch(JSON.stringify(read), /acquisitionHints|resourceHints|dataBase64|resourceBytes/);
});
test('L2 rejects malformed Detail before passive Storage gets a write decision', () => {
    assert.throws(() => validateParserDomain({ index: { key: fixtureKey('invalid') }, detail: JSON.parse('{"messages":[],"assets":[],"quality":{"status":"invented"}}') }), TypeError);
});
