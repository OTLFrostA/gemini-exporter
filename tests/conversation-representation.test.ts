import { fixtureAccount } from './helpers/domainFixture.js';
import { fixtureAccountFor, fixtureKey } from './helpers/domainFixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { historicalFixture } from './helpers/nativeFixture.js';
import { restoreDomainSnapshot } from '../src/core/domain/runtimeValidation.js';
import { composeDomainDocument } from '../src/core/document/compose/composeDomainDocument.js';

const captured = () => historicalFixture({ id: 'upgraded', title: 'Snapshot title', messages: [{ role: 'assistant', content: 'Saved body' }] });

test('AST: Index owns exported metadata while the body version remains capture evidence', () => {
    const parsed = {   ...captured(), sourceVersion: 100 };
    parsed.conversation.index.title = 'Current rename';
    parsed.conversation.index.updatedAt = 200;
    const document = composeDomainDocument(parsed.conversation, fixtureAccountFor(parsed.conversation));
    assert.equal(document.title, 'Current rename');
    assert.equal(document.metadata?.updatedAt, new Date(200).toISOString());
});

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
