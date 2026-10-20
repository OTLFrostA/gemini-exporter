import { fixtureAccount } from './helpers/domainFixture.js';
import { fixtureAccountFor, fixtureKey } from './helpers/domainFixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { historicalFixture } from './helpers/nativeFixture.js';
import { restoreDomainSnapshot } from '../src/l2/runtimeValidation.js';
import { composeDomainDocument } from '../src/l3b/compose/composeDomainDocument.js';

const captured = () => historicalFixture({ id: 'upgraded', title: 'Snapshot title', messages: [{ role: 'assistant', content: 'Saved body' }] });

test('integration: Index owns exported metadata while the body version remains capture evidence', async () => {
    const { formatContent } = await import('../src/core/engine/chatFormatter.js');
    const parsed = {   ...captured(), sourceVersion: 100 };
    parsed.conversation.index.title = 'Current rename';
    parsed.conversation.index.updatedAt = 200;
    const json = JSON.parse(formatContent(parsed, 'json').content);
    assert.equal(json.savedAt, 100);
    assert.equal(json.conversation.index.updatedAt, 200);
    assert.deepEqual(Object.keys(json.conversation.detail).sort(), ['assets', 'key', 'messages', 'quality']);
    assert.throws(() => restoreDomainSnapshot({ ...parsed.conversation, detail: {   ...parsed.conversation.detail, title: 'Second authority' } }), TypeError);
});
